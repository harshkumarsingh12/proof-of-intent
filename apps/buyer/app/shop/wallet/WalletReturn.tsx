"use client";

// Where PayPal sends the shopper after they approve saving a wallet (`?approval_token_id=…`, spec 0004 §Vault).
// The browser signs a "save this setup token" proof with the key it holds, and the merchant turns the approved
// setup token into the wallet it will charge when the agent buys alone.
import { useEffect, useRef, useState } from "react";
import { loadShopper } from "../../../src/key-store";
import { signCompact } from "../../../src/signing";
import { isNotApprovedYet, saveProof, setupTokenFromQuery } from "../../../src/wallet";

type State = { kind: "working" } | { kind: "saved" } | { kind: "failed"; message: string };

export default function WalletReturn() {
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    // One save per visit: React may run effects twice in development, and the setup token works once.
    if (started.current) return;
    started.current = true;
    (async () => {
      const setupTokenId = setupTokenFromQuery(window.location.search);
      if (!setupTokenId)
        throw new Error("PayPal didn't send back a wallet approval. Start again from the shop.");
      const shopper = await loadShopper();
      if (!shopper)
        throw new Error(
          "This browser's signing key is gone, so it can't save a wallet. Start again from the shop.",
        );
      const proof = await signCompact(
        saveProof(setupTokenId, new Date()),
        shopper.key.privateKey,
        shopper.kid,
      );
      const res = await fetch("/api/vault/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setup_token_id: setupTokenId, proof_jws: proof }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        issue?: string;
      };
      if (!res.ok) {
        throw new Error(
          isNotApprovedYet(body.issue)
            ? "PayPal doesn't have your approval yet. Go back and approve the wallet."
            : (body.message ?? `The shop answered ${res.status}`),
        );
      }
      setState({ kind: "saved" });
    })().catch((err: Error) => setState({ kind: "failed", message: err.message }));
  }, []);

  return (
    <div className="wrap shop">
      <section className="panel">
        <h2>Saving your PayPal wallet</h2>
        {state.kind === "working" && <p className="sub">Finishing with PayPal…</p>}
        {state.kind === "saved" && (
          <>
            <div className="verdict ok">
              <h3>Wallet saved</h3>
              <p className="meta">
                When you let the agent pay alone, the merchant charges this wallet, and only for a cart that
                fits what you signed.
              </p>
            </div>
            <a className="btn btn-primary" href="/shop">
              Back to the shop
            </a>
          </>
        )}
        {state.kind === "failed" && (
          <>
            <p className="error">{state.message}</p>
            <a className="btn btn-ghost" href="/shop">
              Back to the shop
            </a>
          </>
        )}
      </section>
    </div>
  );
}
