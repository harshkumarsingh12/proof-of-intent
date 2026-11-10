"use client";

// Step-up approval (docs/specs/0003, #35). The buyer agent wasn't sure enough to buy alone, so the merchant sent
// this link. The shopper checks the cart and approves it with the key this browser made when they signed the
// intent; the merchant re-checks and only then charges their saved PayPal wallet.
import type { ReasonCode, StepUpApproveResponse, StepUpView } from "@poi/contracts";
import { useCallback, useEffect, useState } from "react";
import { loadShopper, type StoredShopper } from "../../../src/key-store";
import { REASON_TEXT } from "../../../src/reasons";
import { signCompact } from "../../../src/signing";
import { canApprove, stepUpApproval } from "../../../src/stepup";

interface ApiError {
  error: string;
  message: string;
  reasons?: ReasonCode[];
}

const isError = (b: unknown): b is ApiError => typeof b === "object" && b !== null && "error" in b;

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function readJson<T>(res: Response): Promise<T | ApiError> {
  try {
    return (await res.json()) as T | ApiError;
  } catch {
    return { error: "bad_response", message: `The shop server answered ${res.status}` };
  }
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

const STATUS_TEXT: Record<StepUpView["status"], string> = {
  PENDING: "",
  APPROVING: "This approval is being processed.",
  APPROVED: "You approved this purchase.",
  REJECTED: "This cart no longer fits your signed intent, so it can't be bought. Nothing was charged.",
  EXPIRED: "This link has expired. Nothing was charged.",
  FAILED: "PayPal couldn't complete this purchase. Ask your agent to try again.",
};

export default function ApproveFlow({ token }: { token: string }) {
  const [view, setView] = useState<StepUpView>();
  const [loadError, setLoadError] = useState<string>();
  const [shopper, setShopper] = useState<StoredShopper | null>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StepUpApproveResponse>();
  const [error, setError] = useState<ApiError>();

  const load = useCallback(async () => {
    const body = await readJson<StepUpView>(await fetch(`/api/stepup/${encodeURIComponent(token)}`));
    if (isError(body)) setLoadError(body.message);
    else setView(body);
  }, [token]);

  useEffect(() => {
    load().catch(() => setLoadError("The shop couldn't be reached. Try again in a moment."));
    loadShopper()
      .then((s) => setShopper(s ?? null))
      .catch(() => setShopper(null));
  }, [load]);

  const approve = useCallback(async () => {
    if (!view || !shopper) return;
    setBusy(true);
    setError(undefined);
    try {
      const jws = await signCompact(stepUpApproval(view, new Date()), shopper.key.privateKey, shopper.kid);
      const res = await fetch(`/api/stepup/${encodeURIComponent(token)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approval_jws: jws }),
      });
      const body = await readJson<StepUpApproveResponse>(res);
      if (isError(body)) {
        setError(body);
        await load();
      } else {
        setResult(body);
      }
    } finally {
      setBusy(false);
    }
  }, [view, shopper, token, load]);

  if (loadError) {
    return (
      <div className="wrap shop">
        <section className="panel">
          <h2>Approve a purchase</h2>
          <p className="error">{loadError}</p>
        </section>
      </div>
    );
  }
  if (!view || shopper === undefined) {
    return (
      <div className="wrap shop">
        <section className="panel">
          <p className="sub">Loading…</p>
        </section>
      </div>
    );
  }

  const done =
    result ?? (view.status === "APPROVED" && view.order_id ? { order_id: view.order_id } : undefined);
  const wrongDevice = view.status === "PENDING" && shopper?.kid !== view.shopper_kid;

  return (
    <div className="wrap shop">
      <section className="panel">
        <h2>Approve a purchase</h2>
        <p className="sub">
          Your {view.agent_platform} shopping agent picked this from {view.merchant_name} but wasn&apos;t sure
          enough to buy it on its own. Nothing is charged unless you approve.
        </p>
        {view.lines.map((l) => (
          <div className="cart" key={l.sku}>
            <span>
              <strong>{l.title}</strong>
              <small>
                {Object.values(l.attributes).join(" · ")} · qty {l.quantity}
              </small>
            </span>
            <span className="price">{money(l.unit_price.value * l.quantity)}</span>
          </div>
        ))}
        <p className="meta">
          Total {money(view.total.value)} {view.total.currency} · link expires{" "}
          {new Date(view.expires_at).toLocaleString()}
        </p>
        <Reasons reasons={view.reasons} />

        {result?.status === "CAPTURE_PENDING" ? (
          <div className="verdict warn">
            <p>
              Approved. PayPal accepted the payment but hasn&apos;t completed it yet, so you may still be
              charged. It counts as paid only once PayPal confirms it. Order <code>{result.order_id}</code>.
            </p>
          </div>
        ) : done ? (
          <div className="verdict ok">
            <p>
              Approved and paid with your saved PayPal wallet. Order <code>{done.order_id}</code>.
            </p>
          </div>
        ) : view.status !== "PENDING" ? (
          <p className="error">{STATUS_TEXT[view.status]}</p>
        ) : wrongDevice ? (
          <p className="error">
            Open this link in the browser you signed your intent with. Only that browser holds the key that
            can approve this purchase.
          </p>
        ) : null}

        {error && (
          <>
            <p className="error">
              {error.error === "no_vaulted_wallet"
                ? "You haven't saved a PayPal wallet yet. Save one, then come back to this link."
                : error.message}
            </p>
            {error.reasons && <Reasons reasons={error.reasons} />}
          </>
        )}

        {!done && canApprove(view, shopper?.kid) && (
          <button className="btn btn-primary" disabled={busy} onClick={approve}>
            {busy ? "Approving…" : `Approve and pay ${money(view.total.value)}`}
          </button>
        )}
      </section>
    </div>
  );
}
