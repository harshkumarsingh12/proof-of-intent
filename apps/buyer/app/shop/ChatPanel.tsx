"use client";

// The shop assistant (docs/specs/0010). It answers questions about the store, the shopper's limits and why the merchant
// refused or held a cart. It cannot sign, buy or propose a checkout: its only action is "Use these limits", which fills
// the form the shopper then reviews and signs themselves. Only the limits (numbers and words) and the last answer's
// outcome and reason codes are sent as context: never the signed intent, ids or anything about the wallet.
import type { ReasonCode } from "@poi/contracts";
import { useState } from "react";
// Types only: the chat's server code must not be bundled into the page.
import type { ChatResult } from "../../src/chat";
import type { IntentForm } from "../../src/intent";

interface Turn {
  role: "user" | "assistant";
  text: string;
  result?: ChatResult;
}

interface Props {
  form: IntentForm;
  lastVerdict?: { outcome: "APPROVE" | "STEP_UP" | "REJECT"; reasons: ReasonCode[] };
  /** Fills the limits form. The shopper still reviews and signs. */
  onUseLimits: (form: IntentForm) => void;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STARTERS = [
  "What's in the store?",
  "Compare the grey running jackets",
  "What do my limits mean?",
  "How does this work?",
];

export default function ChatPanel({ form, lastVerdict, onUseLimits }: Props) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /** The limits as numbers and words, or nothing if the price box doesn't hold a plain amount yet. */
  const limits = /^\d{1,6}(\.\d{1,2})?$/.test(form.maxPrice.trim())
    ? {
        maxPrice: form.maxPrice.trim(),
        ...(form.category ? { category: form.category } : {}),
        ...(form.color ? { color: form.color } : {}),
        validDays: Math.min(Math.max(Math.round(form.validDays) || 7, 1), 30),
        confirmEachCart: form.confirmEachCart,
      }
    : undefined;

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setError(undefined);
    setInput("");
    const next: Turn[] = [...turns, { role: "user", text: question.slice(0, 500) }];
    setTurns(next);
    setBusy(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // The last 8 turns; an answer can be longer than a message may be, so it is cut to fit.
          messages: next.slice(-8).map((t) => ({ role: t.role, content: t.text.slice(0, 500) })),
          context: {
            ...(limits ? { limits } : {}),
            ...(lastVerdict ? { lastVerdict } : {}),
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ChatResult & { message?: string };
      if (!res.ok) {
        setError(body.message ?? `The assistant answered ${res.status}.`);
        return;
      }
      setTurns([...next, { role: "assistant", text: body.text, result: body }]);
    } catch {
      setError("The assistant couldn't be reached. The rest of the shop still works.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-label="Shop assistant">
      <h2>Ask the shop assistant</h2>
      {!open ? (
        <>
          <p className="sub">
            Ask about the store, compare products, understand your limits, or find out why a cart was refused.
            It can&apos;t sign or buy anything.
          </p>
          <button className="btn btn-ghost" onClick={() => setOpen(true)}>
            Ask a question
          </button>
        </>
      ) : (
        <>
          <p className="sub">
            It answers from the store&apos;s own data and can&apos;t sign, pay or buy: that is always you.
          </p>
          {turns.length === 0 && (
            <p>
              {[...STARTERS, ...(lastVerdict ? ["Why was my cart refused or held?"] : [])].map((s) => (
                <button key={s} className="btn btn-ghost btn-small" disabled={busy} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </p>
          )}
          <ol className="trace" aria-label="Conversation" aria-live="polite">
            {turns.map((t, i) => (
              <li key={i}>
                <strong>{t.role === "user" ? "You" : "Assistant"}:</strong>{" "}
                <span style={{ whiteSpace: "pre-wrap" }}>{t.text}</span>
                {t.result && t.result.products.length > 0 && (
                  <ul className="reasons" aria-label="Products mentioned">
                    {t.result.products.map((p) => (
                      <li key={p.sku}>
                        {p.title}, {p.color} · {money(p.price_cents)} <code>{p.sku}</code>
                      </li>
                    ))}
                  </ul>
                )}
                {t.result?.suggestion && (
                  <p>
                    <button
                      className="btn btn-primary btn-small"
                      onClick={() => onUseLimits(t.result!.suggestion!.form)}
                    >
                      Use these limits
                    </button>{" "}
                    <span className="meta">Fills the form below. You still review and sign it.</span>
                  </p>
                )}
                {t.result?.note && <p className="meta">{t.result.note}</p>}
                {t.result && (
                  <p className="meta">
                    {t.result.source === "live"
                      ? "Written by the assistant from the store's data."
                      : "Straight from the store's data."}
                  </p>
                )}
              </li>
            ))}
            {busy && <li className="meta">Thinking…</li>}
          </ol>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <label className="field">
              Your question
              <input
                value={input}
                maxLength={500}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. show me grey running jackets under $80"
              />
            </label>
            <button className="btn btn-primary btn-small" type="submit" disabled={busy || !input.trim()}>
              Ask
            </button>{" "}
            <button className="btn btn-ghost btn-small" type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </form>
        </>
      )}
    </section>
  );
}
