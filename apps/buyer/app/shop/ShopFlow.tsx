"use client";

// Journey A in the browser (docs/PROJECT.md §5, specs 0001 and 0003). Owner: @srshriv.
//   1. a non-extractable key, made and kept on this device, registered with the merchant
//   2. the shopper's words and limits, signed as an Intent Mandate
//   3. the agent proposes a cart; the merchant answers APPROVE, STEP_UP or REJECT before any PayPal order exists
//   4. PayPal approval, then the shopper countersigns the exact cart and the merchant captures or voids
import type { CheckoutResponse, IntentMandate, ReasonCode } from "@poi/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOG, CATEGORIES, COLORS } from "../../src/catalog";
import { buildIntent, type IntentForm } from "../../src/intent";
import { forgetShopper, loadShopper, saveShopper, type StoredShopper } from "../../src/key-store";
import { REASON_TEXT } from "../../src/reasons";
import { generateShopperKey, jwsPayloadText, publicJwk, sha256Hex, signCompact } from "../../src/signing";

export interface ShopConfig {
  merchantId: string;
  paypalMode: "mock" | "sandbox";
  paypalClientId?: string;
  defaultDescription: string;
}

interface Signed {
  intent: IntentMandate;
  jws: string;
  hash: string;
}

type Approval = { status: "CAPTURED"; capture_id?: string } | { status: "VOIDED"; reasons?: ReasonCode[] };

interface ApiError {
  error: string;
  message: string;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const short = (hash: string) => `${hash.slice(0, 12)}…`;

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; body: T | ApiError }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: T | ApiError;
  try {
    parsed = (await res.json()) as T | ApiError;
  } catch {
    parsed = { error: "bad_response", message: `The shop server answered ${res.status}` };
  }
  return { status: res.status, body: parsed };
}

const isError = (b: unknown): b is ApiError => typeof b === "object" && b !== null && "error" in b;

let shopperLoad: Promise<StoredShopper> | undefined;

/** Makes a key the first time, registers it, and keeps it in IndexedDB. One in flight at a time. */
function ensureShopper(): Promise<StoredShopper> {
  shopperLoad ??= makeOrLoadShopper().catch((err) => {
    shopperLoad = undefined;
    throw err;
  });
  return shopperLoad;
}

async function makeOrLoadShopper(): Promise<StoredShopper> {
  const existing = await loadShopper();
  if (existing) return existing;
  const key = await generateShopperKey();
  const res = await postJson<{ kid: string; shopper_id: string }>("/api/keys/shopper", {
    public_jwk: await publicJwk(key),
  });
  if (isError(res.body)) throw new Error(res.body.message);
  const shopper = { key, kid: res.body.kid, shopperId: res.body.shopper_id };
  await saveShopper(shopper);
  return shopper;
}

function Reasons({ reasons }: { reasons: ReasonCode[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="reasons">
      {reasons.map((r) => (
        <li key={r}>
          {REASON_TEXT[r] ?? r} <code>{r}</code>
        </li>
      ))}
    </ul>
  );
}

export default function ShopFlow({ config }: { config: ShopConfig }) {
  const [shopper, setShopper] = useState<StoredShopper>();
  const [keyError, setKeyError] = useState<string>();
  const [form, setForm] = useState<IntentForm>({
    description: config.defaultDescription,
    maxPrice: "80",
    category: CATEGORIES[0] ?? "",
    color: COLORS.includes("grey") ? "grey" : (COLORS[0] ?? ""),
    validDays: 7,
    confirmEachCart: false,
  });
  const [signed, setSigned] = useState<Signed>();
  const [formError, setFormError] = useState<string>();
  const [busySku, setBusySku] = useState<string>();
  const [checkout, setCheckout] = useState<{ sku: string; res: CheckoutResponse }>();
  const [checkoutError, setCheckoutError] = useState<string>();
  const [approval, setApproval] = useState<Approval>();
  const [approveError, setApproveError] = useState<string>();
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    ensureShopper().then(setShopper, (err: Error) => setKeyError(err.message));
  }, []);

  const newKey = async () => {
    await forgetShopper();
    shopperLoad = undefined;
    setShopper(undefined);
    setSigned(undefined);
    setCheckout(undefined);
    setApproval(undefined);
    ensureShopper().then(setShopper, (err: Error) => setKeyError(err.message));
  };

  const sign = async () => {
    if (!shopper) return;
    setFormError(undefined);
    try {
      const intent = buildIntent(form, {
        kid: shopper.kid,
        merchantId: config.merchantId,
        now: new Date(),
        mandateId: crypto.randomUUID(),
        nonce: crypto.randomUUID().replace(/-/g, ""),
      });
      const jws = await signCompact(intent, shopper.key.privateKey, shopper.kid);
      setSigned({ intent, jws, hash: await sha256Hex(jwsPayloadText(jws)) });
      setCheckout(undefined);
      setApproval(undefined);
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const propose = async (sku: string) => {
    if (!signed) return;
    setBusySku(sku);
    setCheckoutError(undefined);
    setApproval(undefined);
    setApproveError(undefined);
    try {
      const res = await postJson<CheckoutResponse>("/api/agent/checkout", { intent_jws: signed.jws, sku });
      if (isError(res.body)) {
        setCheckout(undefined);
        setCheckoutError(res.body.message);
      } else {
        setCheckout({ sku, res: res.body });
      }
    } finally {
      setBusySku(undefined);
    }
  };

  /** onApprove: countersign the exact Cart Mandate the merchant signed, then let the merchant capture. */
  const approve = useCallback(async () => {
    if (!shopper || !checkout?.res.order_id || !checkout.res.cart_mandate_jws) return;
    setApproving(true);
    setApproveError(undefined);
    try {
      const approvalJws = await signCompact(
        {
          order_id: checkout.res.order_id,
          cart_mandate_hash: await sha256Hex(jwsPayloadText(checkout.res.cart_mandate_jws)),
          approved_at: new Date().toISOString(),
        },
        shopper.key.privateKey,
        shopper.kid,
      );
      const res = await postJson<Approval>(`/api/checkout/${checkout.res.order_id}/approve`, {
        approval_jws: approvalJws,
      });
      if (isError(res.body)) {
        setApproveError(
          res.body.error === "shopper_has_not_approved"
            ? "PayPal doesn't have your approval yet. Approve in the PayPal window first."
            : res.body.message,
        );
      } else {
        setApproval(res.body);
      }
    } finally {
      setApproving(false);
    }
  }, [shopper, checkout]);

  const verdict = checkout?.res.verdict;
  const product = CATALOG.find((p) => p.line.sku === checkout?.sku);
  const hasOrder = Boolean(checkout?.res.paypal_order_id);
  const set = <K extends keyof IntentForm>(k: K, v: IntentForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="wrap shop">
      <section className="panel">
        <h2>
          <span className="num">1</span> Your signing key
        </h2>
        {keyError ? (
          <p className="error">Couldn&apos;t set up your key: {keyError}</p>
        ) : shopper ? (
          <>
            <p className="sub">
              Made in this browser and kept here. It can sign, but it can&apos;t be copied out, not even by
              this page.
            </p>
            <p className="meta">
              Key id <code>{shopper.kid}</code> · shopper <code>{shopper.shopperId}</code>
            </p>
            <button className="btn btn-ghost btn-small" onClick={newKey}>
              Use a new key
            </button>
          </>
        ) : (
          <p className="sub">Making your key…</p>
        )}
      </section>

      <section className={`panel${shopper ? "" : " muted"}`}>
        <h2>
          <span className="num">2</span> Say what you want, then sign it
        </h2>
        <p className="sub">
          The merchant checks every cart against these limits before PayPal takes any money.
        </p>
        <label className="field">
          What should the agent buy?
          <textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
        </label>
        <div className="row">
          <label className="field">
            Spend at most (USD)
            <input
              inputMode="decimal"
              value={form.maxPrice}
              onChange={(e) => set("maxPrice", e.target.value)}
            />
          </label>
          <label className="field">
            Category
            <select value={form.category} onChange={(e) => set("category", e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Color
            <select value={form.color} onChange={(e) => set("color", e.target.value)}>
              {COLORS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Valid for (days)
            <input
              type="number"
              min={1}
              max={30}
              value={form.validDays}
              onChange={(e) => set("validDays", Number(e.target.value))}
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={form.confirmEachCart}
            onChange={(e) => set("confirmEachCart", e.target.checked)}
          />
          Ask me to confirm every cart, even ones that fit
        </label>
        <button className="btn btn-primary" disabled={!shopper} onClick={sign}>
          Sign my intent
        </button>
        {formError && <p className="error">{formError}</p>}
        {signed && (
          <div className="verdict ok">
            <h3>Signed in your browser</h3>
            <p className="meta">
              Mandate <code>{signed.intent.mandate_id}</code> · hash <code>{short(signed.hash)}</code> ·
              expires {new Date(signed.intent.intent_expiry).toLocaleDateString()}
            </p>
          </div>
        )}
      </section>

      <section className={`panel${signed ? "" : " muted"}`}>
        <h2>
          <span className="num">3</span> The agent proposes a cart
        </h2>
        <p className="sub">
          Pick what the agent sends to the merchant. Try one that breaks your limits: it&apos;s refused before
          any PayPal order exists.
        </p>
        <div className="products">
          {CATALOG.map((p) => (
            <div className="product" key={p.line.sku}>
              <strong>{p.line.title}</strong>
              <small>
                {p.line.attributes.color} · {p.line.attributes.category} · {p.line.sku}
              </small>
              <small>{p.blurb}</small>
              <span className="price">{money(p.line.unit_price.value)}</span>
              <button
                className="btn btn-ghost btn-small"
                disabled={!signed || busySku !== undefined}
                onClick={() => propose(p.line.sku)}
              >
                {busySku === p.line.sku ? "Asking the merchant…" : "Propose this cart"}
              </button>
            </div>
          ))}
        </div>
        {checkoutError && <p className="error">{checkoutError}</p>}
        {verdict && product && (
          <div
            className={`verdict ${verdict.outcome === "APPROVE" ? "ok" : verdict.outcome === "STEP_UP" ? "warn" : "no"}`}
          >
            <h3>
              {verdict.outcome === "REJECT"
                ? `Refused: ${product.line.title}, ${product.line.attributes.color}, ${money(product.line.unit_price.value)}`
                : verdict.outcome === "STEP_UP"
                  ? "Fits your limits, but please confirm it's what you meant"
                  : "Fits what you signed"}
            </h3>
            {verdict.outcome === "REJECT" && <p>No PayPal order was created. Nothing was charged.</p>}
            <Reasons reasons={verdict.reasons} />
            {checkout?.res.order_id && (
              <p className="meta">
                Order <code>{checkout.res.order_id}</code> · PayPal{" "}
                <code>{checkout.res.paypal_order_id}</code>
              </p>
            )}
          </div>
        )}
      </section>

      <section className={`panel${hasOrder && !approval ? "" : " muted"}`}>
        <h2>
          <span className="num">4</span> Pay with PayPal
        </h2>
        <p className="sub">
          PayPal holds the money first. The merchant captures only after your browser signs this exact cart.
        </p>
        {hasOrder && !approval && checkout && (
          <PayPalStep config={config} res={checkout.res} onApproved={approve} approving={approving} />
        )}
        {approveError && <p className="error">{approveError}</p>}
        {approval?.status === "CAPTURED" && (
          <div className="verdict ok">
            <h3>Paid</h3>
            <p className="meta">
              Capture <code>{approval.capture_id}</code>. The signed intent, cart and your approval are on
              record for any dispute.
            </p>
          </div>
        )}
        {approval?.status === "VOIDED" && (
          <div className="verdict no">
            <h3>Hold released, nothing charged</h3>
            <Reasons reasons={approval.reasons ?? []} />
          </div>
        )}
      </section>
    </div>
  );
}

interface PayPalButtons {
  render(el: HTMLElement): Promise<void>;
  close?(): Promise<void>;
}
interface PayPalNamespace {
  Buttons(opts: {
    createOrder: () => Promise<string>;
    onApprove: () => Promise<void>;
    onError: (err: unknown) => void;
  }): PayPalButtons;
}

const sdkLoads = new Map<string, Promise<PayPalNamespace>>();

function loadPayPal(clientId: string): Promise<PayPalNamespace> {
  const src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=USD`;
  let load = sdkLoads.get(src);
  if (!load) {
    load = new Promise<PayPalNamespace>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => {
        const paypal = (window as unknown as { paypal?: PayPalNamespace }).paypal;
        if (paypal) resolve(paypal);
        else reject(new Error("PayPal's script loaded without its buttons"));
      };
      script.onerror = () => reject(new Error("Couldn't load PayPal's script"));
      document.head.appendChild(script);
    });
    sdkLoads.set(src, load);
  }
  return load;
}

function PayPalStep(props: {
  config: ShopConfig;
  res: CheckoutResponse;
  onApproved: () => Promise<void>;
  approving: boolean;
}) {
  const { config, res, onApproved, approving } = props;
  const slot = useRef<HTMLDivElement>(null);
  const [sdkError, setSdkError] = useState<string>();
  const sandbox = config.paypalMode === "sandbox" && Boolean(config.paypalClientId);

  useEffect(() => {
    if (!sandbox || !slot.current || !res.paypal_order_id) return;
    const el = slot.current;
    let buttons: PayPalButtons | undefined;
    let cancelled = false;
    loadPayPal(config.paypalClientId!)
      .then((paypal) => {
        if (cancelled) return;
        buttons = paypal.Buttons({
          // The merchant already created this order after its checks; PayPal just shows it.
          createOrder: async () => res.paypal_order_id!,
          onApprove: onApproved,
          onError: (err) => setSdkError(String((err as Error)?.message ?? err)),
        });
        return buttons.render(el);
      })
      .catch((err: Error) => setSdkError(err.message));
    return () => {
      cancelled = true;
      el.innerHTML = "";
      void buttons?.close?.().catch(() => undefined);
    };
  }, [sandbox, config.paypalClientId, res.paypal_order_id, onApproved]);

  if (!sandbox) {
    return (
      <>
        <p className="meta">
          Mock PayPal (PAYPAL_MODE=mock): approving here stands in for logging in to PayPal.
        </p>
        <button className="btn btn-primary" disabled={approving} onClick={onApproved}>
          {approving ? "Capturing…" : "Approve with PayPal (mock)"}
        </button>
      </>
    );
  }
  return (
    <>
      <div className="paypal-slot" ref={slot} />
      {sdkError && <p className="error">PayPal: {sdkError}</p>}
      {res.approval_url && (
        <p className="meta">
          Buttons not showing?{" "}
          <a href={res.approval_url} target="_blank" rel="noreferrer">
            Approve on PayPal
          </a>
          , then{" "}
          <button className="btn btn-ghost btn-small" disabled={approving} onClick={onApproved}>
            {approving ? "Capturing…" : "I've approved"}
          </button>
        </p>
      )}
    </>
  );
}
