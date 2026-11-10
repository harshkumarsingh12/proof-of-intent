"use client";

// What is left of the signed intent, and a control to stop it (docs/specs/0013, #176). Both are signed in this browser with
// the key that signed the intent; the merchant answers from its own records and enforces the revocation on every path.
import type { IntentReceipt } from "@poi/contracts";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { intentReceiptProof, intentRevocation, receiptRows } from "../../src/intent-controls";
import type { StoredShopper } from "../../src/key-store";
import { signCompact } from "../../src/signing";

interface Props {
  intent: { mandate_id: string };
  /** SHA-256 of the signed bytes: the intent's mandate hash. */
  hash: string;
  shopper: StoredShopper;
  /** Changes whenever something may have spent or released authority, so the receipt is asked for again. */
  refreshKey: string;
  /** The merchant's revocation time, or null when the merchant never received the intent. */
  onRevoked: (revokedAt: string | null) => void;
}

async function post(
  url: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> | undefined }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined,
  };
}

const message = (b: Record<string, unknown> | undefined, fallback: string) =>
  typeof b?.message === "string" ? b.message : fallback;

export default function IntentControls({ intent, hash, shopper, refreshKey, onRevoked }: Props) {
  const [receipt, setReceipt] = useState<IntentReceipt | "unseen">();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Several refreshes can be in flight (an order created, then captured). Only the latest one's answer is shown, so an
  // older answer arriving last can't put a stale figure back.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    const proof = await signCompact(
      intentReceiptProof(hash, new Date()),
      shopper.key.privateKey,
      shopper.kid,
    );
    const res = await post(`/api/intents/${intent.mandate_id}/receipt`, { proof_jws: proof });
    if (mine !== latest.current) return;
    if (res.status === 404) setReceipt("unseen");
    else if (res.status === 200 && res.body) setReceipt(res.body as unknown as IntentReceipt);
    else setError(message(res.body, "The merchant didn't answer; try again in a moment."));
  }, [intent.mandate_id, hash, shopper]);

  useEffect(() => {
    setError(undefined);
    load().catch(() => setError("The shop couldn't be reached. Try again in a moment."));
  }, [load, refreshKey]);

  const revoke = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const jws = await signCompact(
        intentRevocation(intent.mandate_id, hash, new Date()),
        shopper.key.privateKey,
        shopper.kid,
      );
      const res = await post(`/api/intents/${intent.mandate_id}/revoke`, { revocation_jws: jws });
      if (res.status === 404) onRevoked(null);
      else if (res.status === 200 && typeof res.body?.revoked_at === "string") onRevoked(res.body.revoked_at);
      else setError(message(res.body, "The merchant didn't accept the revocation. Try again."));
    } catch {
      setError("The shop couldn't be reached. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const revoked = receipt !== "unseen" && receipt?.state === "REVOKED";
  return (
    <div className="intent-controls">
      <h4>What&apos;s left</h4>
      {receipt === "unseen" ? (
        <p className="meta">
          The merchant hasn&apos;t received this intent yet, so nothing has been spent and everything above is
          still available.
        </p>
      ) : receipt ? (
        <dl className="authz" aria-label="What is left">
          {receiptRows(receipt).map((row) => (
            <Fragment key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        !error && <p className="meta">Checking with the merchant…</p>
      )}
      {error && <p className="error">{error}</p>}
      {!revoked &&
        (confirming ? (
          <div className="revoke-confirm">
            <p className="meta">
              Revoking stops your agent from buying anything more under this intent, including carts waiting
              for your approval. Purchases already made aren&apos;t undone. You can&apos;t take this back;
              sign a new intent to shop again.
            </p>
            <button className="btn btn-primary btn-small" disabled={busy} onClick={revoke}>
              {busy ? "Revoking…" : "Yes, revoke it"}
            </button>{" "}
            <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-small" onClick={() => setConfirming(true)}>
            Revoke this intent
          </button>
        ))}
    </div>
  );
}
