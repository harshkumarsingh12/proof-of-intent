"use client";

// Journey A in the browser (docs/PROJECT.md §5, specs 0001 and 0003). Owner: @srshriv.
//   1. a non-extractable key, made and kept on this device, registered with the merchant
//   2. the shopper's words and limits, signed as an Intent Mandate
//   3. the agent proposes a cart; the merchant answers APPROVE, STEP_UP or REJECT before any PayPal order exists
//   4. PayPal approval, then the shopper countersigns the exact cart and the merchant captures or voids
// Optional (#17, #36): save a PayPal wallet with Vault v3, then let the agent pay alone. The merchant runs the same
// checks; an approved cart is charged to the saved wallet at once, and a step-up charges nothing.
import type {
  CheckoutResponse,
  IntentMandate,
  ReasonCode,
  StepUpApproveResponse,
  StepUpView,
} from "@poi/contracts";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  CATALOG,
  CATEGORIES,
  COLORS,
  PRESETS,
  categoryLabel,
  presetFor,
  type Product,
} from "../../src/catalog";
import type { TraceStep } from "../../src/agent";
import { buildIntent, type IntentForm } from "../../src/intent";
import { forgetShopper, loadShopper, saveShopper, type StoredShopper } from "../../src/key-store";
import { nearMiss } from "../../src/near-miss";
import { REASON_TEXT } from "../../src/reasons";
import { generateShopperKey, jwsPayloadText, publicJwk, sha256Hex, signCompact } from "../../src/signing";
import { stepUpApproval, stepUpListProof } from "../../src/stepup";
import { initialVoice, voiceReducer } from "../../src/voice";
import { removeProof, setupProof } from "../../src/wallet";
import ChatPanel from "./ChatPanel";
import { useSpeech } from "./useVoice";

export interface ShopConfig {
  merchantId: string;
  paypalMode: "mock" | "sandbox";
  paypalClientId?: string;
  /** Voice ordering (spec 0010), off unless BUYER_VOICE=1. */
  voiceEnabled?: boolean;
  /** The shop assistant (spec 0010), off unless BUYER_CHAT=1. */
  chatEnabled?: boolean;
}

/** The form for a category's demo words (catalog PRESETS), which replay mode has recorded J1 answers for. */
function presetForm(category: string, confirmEachCart = false): IntentForm {
  const preset = presetFor(category) ?? PRESETS[0]!;
  return {
    description: preset.description,
    maxPrice: String(preset.amountMax.value / 100),
    category: preset.category,
    color: preset.color,
    validDays: 7,
    confirmEachCart,
  };
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

function AgentTrace({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="trace" aria-label="What the agent did">
      {steps.map((s, i) =>
        s.kind === "search" ? (
          <li key={i}>
            Searched the store
            {s.query.category ? ` for ${categoryLabel(s.query.category).toLowerCase()}` : ""}
            {s.query.color ? `, ${s.query.color}` : ""}
            {s.query.max_price_usd ? `, up to ${money(Math.round(s.query.max_price_usd * 100))}` : ""}:{" "}
            {s.found} found.
          </li>
        ) : (
          <li key={i}>
            {s.outcome === "OUT_OF_LIMITS" ? "Considered" : "Proposed"} <strong>{s.title}</strong> (
            {money(s.price_cents)}). {s.reason && <em>{s.reason} </em>}
            <strong>
              {s.outcome === "APPROVE"
                ? "The merchant approved it."
                : s.outcome === "STEP_UP"
                  ? "The merchant wants you to confirm it."
                  : s.outcome === "REJECT"
                    ? "The merchant refused it."
                    : s.outcome === "OUT_OF_LIMITS"
                      ? "Skipped: it breaks your signed limits, so the merchant wasn't asked."
                      : "The merchant couldn't answer."}
            </strong>
            {s.reasons.length > 0 && (
              <>
                {" "}
                {s.reasons.map((r) => (
                  <code key={r}>{r} </code>
                ))}
              </>
            )}
          </li>
        ),
      )}
    </ol>
  );
}

export default function ShopFlow({ config }: { config: ShopConfig }) {
  const [shopper, setShopper] = useState<StoredShopper>();
  const [keyError, setKeyError] = useState<string>();
  const [form, setForm] = useState<IntentForm>(() => presetForm(CATEGORIES[0] ?? ""));
  // The latest form, for async steps that must not read a stale render (a spoken request drafts the limits asynchronously).
  const formRef = useRef(form);
  formRef.current = form;
  const [resetting, setResetting] = useState(false);
  const [signed, setSigned] = useState<Signed>();
  const [formError, setFormError] = useState<string>();
  const [busySku, setBusySku] = useState<string>();
  const [checkout, setCheckout] = useState<{ sku: string; res: CheckoutResponse; alone: boolean }>();
  const [wallet, setWallet] = useState<"unknown" | "none" | "saved">("unknown");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string>();
  const [alone, setAlone] = useState(false);
  // Carts the merchant is holding for this shopper (agent alone, not sure enough), fetched with a signed proof.
  const [waiting, setWaiting] = useState<StepUpView[]>([]);
  const [waitingBusy, setWaitingBusy] = useState<string>();
  const [waitingError, setWaitingError] = useState<string>();
  const [waitingPaid, setWaitingPaid] = useState<StepUpApproveResponse>();
  const [checkoutError, setCheckoutError] = useState<string>();
  const [approval, setApproval] = useState<Approval>();
  const [approveError, setApproveError] = useState<string>();
  const [approving, setApproving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const [agentNote, setAgentNote] = useState<string>();
  const [agentTrace, setAgentTrace] = useState<TraceStep[]>([]);

  useEffect(() => {
    ensureShopper().then(setShopper, (err: Error) => setKeyError(err.message));
  }, []);

  // Whether this key already has a saved wallet (a yes or no: the merchant never shows the vault id).
  useEffect(() => {
    if (!shopper) return;
    let cancelled = false;
    fetch(`/api/vault/${encodeURIComponent(shopper.kid)}`)
      .then((r) => r.json() as Promise<{ wallet?: boolean }>)
      .then((b) => !cancelled && setWallet(b.wallet ? "saved" : "none"))
      .catch(() => !cancelled && setWallet("none"));
    return () => {
      cancelled = true;
    };
  }, [shopper]);

  /** The carts waiting for this shopper: asked with a fresh signature from their key, so no link is needed. */
  const refreshWaiting = useCallback(async () => {
    if (!shopper) return;
    try {
      const proof = await signCompact(stepUpListProof(new Date()), shopper.key.privateKey, shopper.kid);
      const res = await postJson<{ stepups: StepUpView[] }>("/api/stepups/pending", { proof_jws: proof });
      if (!isError(res.body)) setWaiting(res.body.stepups);
    } catch {
      // The list is a convenience: the shopper's other steps don't depend on it.
    }
  }, [shopper]);

  useEffect(() => {
    void refreshWaiting();
  }, [refreshWaiting]);

  /** Approve a waiting cart: sign this step-up and this exact cart, and the merchant charges the saved wallet. */
  const approveWaiting = async (view: StepUpView) => {
    if (!shopper) return;
    setWaitingBusy(view.stepup_id);
    setWaitingError(undefined);
    setWaitingPaid(undefined);
    try {
      const jws = await signCompact(stepUpApproval(view, new Date()), shopper.key.privateKey, shopper.kid);
      const res = await postJson<StepUpApproveResponse>(`/api/stepups/${view.stepup_id}/approve`, {
        approval_jws: jws,
      });
      if (isError(res.body)) setWaitingError(res.body.message);
      else setWaitingPaid(res.body);
      await refreshWaiting();
    } finally {
      setWaitingBusy(undefined);
    }
  };

  /** Vault v3: prove it's us, get PayPal's approval link, and go approve. PayPal sends us back to /shop/wallet. */
  const saveWallet = async () => {
    if (!shopper) return;
    setWalletBusy(true);
    setWalletError(undefined);
    try {
      const proof = await signCompact(setupProof(new Date()), shopper.key.privateKey, shopper.kid);
      const res = await postJson<{ approval_url: string }>("/api/vault/setup", { proof_jws: proof });
      if (isError(res.body)) {
        setWalletError(res.body.message);
        setWalletBusy(false);
        return;
      }
      window.location.assign(res.body.approval_url);
    } catch (err) {
      setWalletError((err as Error).message);
      setWalletBusy(false);
    }
  };

  /** Forget the saved wallet: the agent can no longer pay alone, and PayPal is told to revoke it. */
  const removeWallet = async () => {
    if (!shopper) return;
    setWalletBusy(true);
    setWalletError(undefined);
    try {
      const proof = await signCompact(removeProof(new Date()), shopper.key.privateKey, shopper.kid);
      const res = await postJson<{ wallet: false }>("/api/vault/remove", { proof_jws: proof });
      if (isError(res.body)) {
        setWalletError(res.body.message);
      } else {
        setWallet("none");
        setAlone(false);
        setCheckout(undefined);
      }
    } catch (err) {
      setWalletError((err as Error).message);
    } finally {
      setWalletBusy(false);
    }
  };

  const newKey = async () => {
    if (resetting) return;
    setResetting(true);
    await forgetShopper();
    shopperLoad = undefined;
    setWallet("unknown");
    setAlone(false);
    setWaiting([]);
    setShopper(undefined);
    setSigned(undefined);
    setCheckout(undefined);
    setApproval(undefined);
    ensureShopper()
      .then(setShopper, (err: Error) => setKeyError(err.message))
      .finally(() => setResetting(false));
  };

  /** Signs `f` with the browser key and remembers it. Returns what it signed, so callers can chain on the result. */
  const signIntent = async (f: IntentForm): Promise<Signed | undefined> => {
    if (!shopper) return undefined;
    setFormError(undefined);
    try {
      const intent = buildIntent(f, {
        kid: shopper.kid,
        merchantId: config.merchantId,
        now: new Date(),
        mandateId: crypto.randomUUID(),
        nonce: crypto.randomUUID().replace(/-/g, ""),
      });
      const jws = await signCompact(intent, shopper.key.privateKey, shopper.kid);
      const next = { intent, jws, hash: await sha256Hex(jwsPayloadText(jws)) };
      setSigned(next);
      setCheckout(undefined);
      setApproval(undefined);
      return next;
    } catch (err) {
      setFormError((err as Error).message);
      return undefined;
    }
  };

  const sign = () => signIntent(form);

  const propose = async (sku: string) => {
    if (!signed) return;
    setBusySku(sku);
    setCheckoutError(undefined);
    setApproval(undefined);
    setApproveError(undefined);
    const payAlone = alone;
    try {
      const res = await postJson<CheckoutResponse>("/api/agent/checkout", {
        intent_jws: signed.jws,
        sku,
        human_present: !payAlone,
      });
      if (isError(res.body)) {
        setCheckout(undefined);
        setCheckoutError(res.body.message);
      } else {
        setCheckout({ sku, res: res.body, alone: payAlone });
        if (res.body.verdict.outcome === "STEP_UP") void refreshWaiting();
      }
    } finally {
      setBusySku(undefined);
    }
  };

  /** The agent fills the form from the shopper's words. It only drafts: the shopper still signs. */
  const draftFrom = async (text: string): Promise<{ form: IntentForm } | { error: string }> => {
    setDrafting(true);
    setDraftNote(undefined);
    setFormError(undefined);
    try {
      const res = await postJson<{ source: "live" | "scripted"; draft: { form: IntentForm } }>(
        "/api/agent/draft-intent",
        { text },
      );
      if (isError(res.body)) {
        setFormError(res.body.message);
        return { error: res.body.message };
      }
      const { draft, source } = res.body;
      // Only the shopper's own switch survives a draft: the agent can't turn "ask me before every purchase" on or off.
      const next = { ...draft.form, confirmEachCart: formRef.current.confirmEachCart };
      setForm(next);
      setDraftNote(
        `${source === "live" ? "The agent" : "The scripted agent (no model in replay mode)"} filled in the limits below. Check them, then sign.`,
      );
      return { form: next };
    } finally {
      setDrafting(false);
    }
  };

  const draftWithAgent = () => draftFrom(form.description);

  /** The agent picks the item itself; the merchant still answers for each cart it tries. */
  const chooseWith = async (s: Signed) => {
    setChoosing(true);
    setCheckoutError(undefined);
    setAgentNote(undefined);
    setAgentTrace([]);
    setApproval(undefined);
    setApproveError(undefined);
    const payAlone = alone;
    try {
      const res = await postJson<{
        source: "live" | "scripted";
        trace: TraceStep[];
        attempts: { sku: string; body: CheckoutResponse | ApiError }[];
        message?: string;
      }>("/api/agent/choose", { intent_jws: s.jws, human_present: !payAlone });
      if (isError(res.body)) {
        setCheckout(undefined);
        setCheckoutError(res.body.message);
        return;
      }
      setAgentTrace(res.body.trace);
      const last = res.body.attempts.at(-1);
      if (last && isError(last.body)) {
        // The merchant answered with an error, such as "no saved wallet", not with a verdict: say so.
        setCheckout(undefined);
        setCheckoutError(last.body.message);
        return;
      }
      if (!last || isError(last.body)) {
        setCheckout(undefined);
        setAgentNote(
          "The agent didn't find anything to propose within your limits. Pick a cart yourself below.",
        );
        return;
      }
      setCheckout({ sku: last.sku, res: last.body, alone: payAlone });
      if (last.body.verdict.outcome === "STEP_UP") void refreshWaiting();
      const refused = res.body.attempts.length - 1;
      setAgentNote(
        `${res.body.source === "live" ? "The agent" : "The scripted agent (no model in replay mode)"} proposed ${res.body.attempts.length} cart${res.body.attempts.length === 1 ? "" : "s"}${refused > 0 ? `; the merchant refused ${refused} before this one` : ""}.${res.body.message ? ` ${res.body.message}` : ""}`,
      );
    } finally {
      setChoosing(false);
    }
  };

  const chooseWithAgent = () => (signed ? chooseWith(signed) : undefined);

  // ---- voice input (spec 0010) ----
  // Speech only ever fills the request box. The agent then fills in the limits, the shopper can edit them or speak
  // again, and signing is still their own click on "Sign my intent": nothing is signed or bought from what was said.
  const { ready, supported, listen, stop } = useSpeech();
  const [voice, dispatchVoice] = useReducer(voiceReducer, initialVoice);
  const voiceIdle = voice.phase === "idle" || voice.phase === "failed";

  const draftFromVoice = async (text: string) => {
    const drafted = await draftFrom(text);
    dispatchVoice("error" in drafted ? { type: "FAILED", message: drafted.error } : { type: "DRAFTED" });
  };

  const startVoice = () => {
    if (!shopper) return;
    dispatchVoice({ type: "LISTEN" });
    listen({
      onResult: (text, final) => {
        dispatchVoice({ type: "HEARD", text, final });
        setForm((f) => ({ ...f, description: text }));
        if (final) void draftFromVoice(text);
      },
      onEnd: (error) => dispatchVoice(error ? { type: "FAILED", message: error } : { type: "LISTEN_ENDED" }),
    });
  };

  // The microphone is only on while listening for the request.
  useEffect(() => {
    if (voice.phase !== "listening") stop();
  }, [voice.phase, stop]);

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
  const paidAlone = Boolean(checkout?.alone && verdict?.outcome === "APPROVE" && checkout.res.order_id);
  // A human-present order waits for the shopper at PayPal; an agent-alone one was charged when it was created.
  const hasOrder = Boolean(checkout?.res.paypal_order_id) && !checkout?.alone;
  const set = <K extends keyof IntentForm>(k: K, v: IntentForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  // After a refusal: what would have fit, worked out from the signed limits and the store (no model).
  const signedMax = signed?.intent.constraints.amount_max?.value;
  const hint =
    verdict?.outcome === "REJECT" && checkout && signed && signedMax !== undefined
      ? nearMiss({
          sku: checkout.sku,
          reasons: verdict.reasons,
          limits: {
            maxCents: signedMax,
            category: signed.intent.constraints.attributes?.category,
            color: signed.intent.constraints.attributes?.color,
          },
        })
      : undefined;

  // The signed intent's category first: that's where the agent shops. Everything else is a click away, so a
  // cross-category cart can still be tried (and refused with ATTRIBUTE_MISMATCH).
  // An intent signed with no category ("Anything") shops the whole store, so there is no "elsewhere".
  const shownCategory = signed ? (signed.intent.constraints.attributes?.category ?? "") : form.category;
  const inCategory = shownCategory
    ? CATALOG.filter((p) => p.line.attributes.category === shownCategory)
    : CATALOG;
  const others = shownCategory ? CATALOG.filter((p) => p.line.attributes.category !== shownCategory) : [];
  const card = (p: Product) => (
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
  );

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
            <button className="btn btn-ghost btn-small" disabled={resetting} onClick={newKey}>
              Use a new key
            </button>
            <h3 className="group">PayPal wallet (optional)</h3>
            <p className="sub">
              Save a PayPal wallet and your agent can pay without you at the PayPal step. The merchant still
              checks every cart against your signed limits first, and asks you when it isn&apos;t sure.
            </p>
            {wallet === "saved" && (
              <p className="meta">
                A PayPal wallet is saved for this key.{" "}
                {config.paypalMode === "mock" && "(Mock PayPal: nothing real is saved.)"}
              </p>
            )}
            <button
              className="btn btn-ghost btn-small"
              disabled={walletBusy || wallet === "unknown"}
              onClick={saveWallet}
            >
              {walletBusy
                ? "Opening PayPal…"
                : wallet === "saved"
                  ? "Save a different wallet"
                  : "Save a PayPal wallet"}
            </button>{" "}
            {wallet === "saved" && (
              <button className="btn btn-ghost btn-small" disabled={walletBusy} onClick={removeWallet}>
                Remove my wallet
              </button>
            )}
            {walletError && <p className="error">{walletError}</p>}
          </>
        ) : (
          <p className="sub">Making your key…</p>
        )}
      </section>

      <section id="limits" className={`panel${shopper ? "" : " muted"}`}>
        <h2>
          <span className="num">2</span> Say what you want, then sign it
        </h2>
        <p className="sub">
          The merchant checks every cart against these limits before PayPal takes any money.
        </p>
        <p className="meta">
          Quick start:{" "}
          {PRESETS.map((p) => (
            <button
              key={p.category}
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => setForm((f) => presetForm(p.category, f.confirmEachCart))}
            >
              {p.label}
            </button>
          ))}
        </p>
        <label className="field">
          What should the agent buy?
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            onKeyDown={(e) => {
              // Enter fills in the limits from the words (Shift+Enter is a new line); the shopper still signs.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (shopper && !drafting && form.description.trim()) void draftWithAgent();
              }
            }}
          />
          <span className="meta">Press Enter and the agent fills in the limits below. You can edit them.</span>
        </label>
        {config.voiceEnabled && (
          <div className="voice">
            {supported ? (
              <>
                <button
                  className="btn btn-ghost btn-small"
                  disabled={!shopper || !voiceIdle}
                  onClick={startVoice}
                  aria-label="Speak your request"
                >
                  {voice.phase === "listening" ? "Listening…" : "Speak your request"}
                </button>{" "}
                <p className="meta">
                  Your browser sends the audio to its own speech service (Google, Apple or Microsoft). Typing
                  works too.
                </p>
              </>
            ) : (
              ready && <p className="meta">Voice input isn&apos;t available in this browser. Typing works.</p>
            )}
            {voice.phase === "listening" && (
              <p className="meta" aria-live="polite">
                {voice.transcript || "Say what you want to buy, like “a grey running jacket under $80”."}
              </p>
            )}
            {voice.phase === "drafting" && <p className="meta">Reading your limits…</p>}
            {voice.message && voiceIdle && (
              <p className={voice.phase === "failed" ? "error" : "meta"} role="status">
                {voice.message}
              </p>
            )}
          </div>
        )}
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
              <option value="">Anything</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Color
            <select value={form.color} onChange={(e) => set("color", e.target.value)}>
              <option value="">Any color</option>
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
        <button className="btn btn-ghost" disabled={!shopper || drafting} onClick={draftWithAgent}>
          {drafting ? "Agent is reading…" : "Fill in the limits from my words"}
        </button>{" "}
        <button className="btn btn-primary" disabled={!shopper} onClick={sign}>
          Sign my intent
        </button>
        {draftNote && <p className="meta">{draftNote}</p>}
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

      {config.chatEnabled && (
        <ChatPanel
          form={form}
          lastVerdict={
            checkout
              ? { outcome: checkout.res.verdict.outcome, reasons: checkout.res.verdict.reasons }
              : undefined
          }
          onUseLimits={(suggested) => {
            // Only the limits move: the shopper's own "ask me before every purchase" switch stays as they set it.
            setForm({ ...suggested, confirmEachCart: formRef.current.confirmEachCart });
            setDraftNote("Filled in from the assistant. Check the limits, then sign.");
          }}
        />
      )}

      <section className={`panel${signed ? "" : " muted"}`}>
        <h2>
          <span className="num">3</span> The agent proposes a cart
        </h2>
        <p className="sub">
          Pick what the agent sends to the merchant. Try one that breaks your limits: it&apos;s refused before
          any PayPal order exists.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={alone}
            disabled={wallet !== "saved"}
            onChange={(e) => {
              setAlone(e.target.checked);
              setCheckout(undefined);
              setCheckoutError(undefined);
              setApproval(undefined);
            }}
          />
          Let the agent pay alone from my saved wallet (no PayPal approval from me)
          {wallet !== "saved" && " — save a PayPal wallet above first"}
        </label>
        <button
          className="btn btn-primary"
          disabled={!signed || choosing || busySku !== undefined}
          onClick={chooseWithAgent}
        >
          {choosing ? "The agent is shopping…" : "Let the agent choose"}
        </button>
        {agentNote && <p className="meta">{agentNote}</p>}
        {agentTrace.length > 0 && <AgentTrace steps={agentTrace} />}
        <h3 className="group">{shownCategory ? categoryLabel(shownCategory) : "All products"}</h3>
        <div className="products">{inCategory.map(card)}</div>
        {others.length > 0 && (
          <details className="others">
            <summary>Elsewhere in the store ({others.length})</summary>
            <div className="products">{others.map(card)}</div>
          </details>
        )}
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
                  : paidAlone
                    ? "Fits what you signed, so your agent paid"
                    : "Fits what you signed"}
            </h3>
            {verdict.outcome === "REJECT" && <p>No PayPal order was created. Nothing was charged.</p>}
            {verdict.outcome === "STEP_UP" && checkout?.alone && (
              <p>
                Nothing was charged and no PayPal order exists. The merchant is holding this cart for you:
                approve it below, or from the link it sends you.
              </p>
            )}
            <Reasons reasons={verdict.reasons} />
            {hint && (
              <div className="near-miss">
                <p>{hint.text}</p>
                {hint.apply && (
                  <p>
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() => {
                        // Only the limits form changes. The old signed intent is dropped, so the shopper reviews the
                        // new limits and signs again: nothing is signed or bought from here.
                        setForm((f) => ({ ...f, ...hint.apply!.patch }));
                        setSigned(undefined);
                        setCheckout(undefined);
                        setCheckoutError(undefined);
                        setDraftNote("Limits filled in from the suggestion. Check them, then sign.");
                        document.getElementById("limits")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      {hint.apply.label}
                    </button>{" "}
                    <span className="meta">Fills the limits form. You still review and sign it.</span>
                  </p>
                )}
              </div>
            )}
            {checkout?.res.order_id && (
              <p className="meta">
                Order <code>{checkout.res.order_id}</code> · PayPal{" "}
                <code>{checkout.res.paypal_order_id}</code>
              </p>
            )}
          </div>
        )}
      </section>

      {(waiting.length > 0 || waitingPaid || waitingError) && (
        <section className="panel">
          <h2>Waiting for your approval</h2>
          <p className="sub">
            Your agent proposed these, but the merchant wasn&apos;t sure they&apos;re what you meant, so
            nothing is charged until you approve. Approving signs that exact cart with your key; the merchant
            checks it against your limits once more and charges your saved PayPal wallet.
          </p>
          {waiting.map((w) => (
            <div className="verdict warn" key={w.stepup_id}>
              <h3>
                {w.lines.map((l) => l.title).join(", ")}: {money(w.total.value)}
              </h3>
              <Reasons reasons={w.reasons} />
              <p className="meta">
                Proposed by {w.agent_platform} · expires {new Date(w.expires_at).toLocaleString()}
              </p>
              <button
                className="btn btn-primary btn-small"
                disabled={waitingBusy !== undefined}
                onClick={() => approveWaiting(w)}
              >
                {waitingBusy === w.stepup_id ? "Approving…" : "Approve and pay from my wallet"}
              </button>
            </div>
          ))}
          {waitingError && <p className="error">{waitingError}</p>}
          {waitingPaid && (
            <div className="verdict ok">
              <h3>Paid</h3>
              <p className="meta">
                Capture <code>{waitingPaid.capture_id ?? "pending"}</code>. You approved this cart, so your
                approval is on record with the signed intent.
              </p>
            </div>
          )}
        </section>
      )}

      <section className={`panel${(hasOrder && !approval) || paidAlone ? "" : " muted"}`}>
        <h2>
          <span className="num">4</span> {paidAlone ? "Paid by your agent" : "Pay with PayPal"}
        </h2>
        <p className="sub">
          {paidAlone
            ? "You weren't asked at PayPal: the merchant charged the wallet you saved, because this cart fits what you signed."
            : "PayPal holds the money first. The merchant captures only after your browser signs this exact cart."}
        </p>
        {paidAlone && checkout && (
          <div className="verdict ok">
            <h3>Paid</h3>
            <p className="meta">
              Capture <code>{checkout.res.capture_id ?? "pending"}</code>. The signed intent and the
              agent&apos;s payment mandate are on record for any dispute; there is no shopper approval because
              nobody was asked.
            </p>
          </div>
        )}
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
