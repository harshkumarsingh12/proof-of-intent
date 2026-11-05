"use client";
// Top-bar search: find a dispute by dispute id, order id or PayPal order id, then jump to it.
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchDisputes, formatMoney } from "../src/api";
import type { DisputeItem } from "../src/dispute-types";
import { searchDisputes } from "../src/home";
import { SearchIcon } from "./icons";
import { v } from "../src/theme";

const DECISION_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  defend: { bg: v("successBg"), fg: v("success"), label: "Defend" },
  concede: { bg: v("warningBg"), fg: v("warning"), label: "Concede" },
  standard: { bg: v("surfaceMuted"), fg: v("textMuted"), label: "Standard" },
};

export function DisputeSearch() {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    let live = true;
    fetchDisputes().then((rows) => live && setDisputes(rows));
    return () => {
      live = false;
    };
  }, []);

  // "/" focuses the search, as on most docs sites, unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => searchDisputes(disputes, query), [disputes, query]);
  const showList = open && query.trim().length > 0;

  const go = (d: DisputeItem | undefined) => {
    if (!d) return;
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(`/disputes/${encodeURIComponent(d.id)}`);
  };

  return (
    <div className="poi-search" style={{ position: "relative", width: "100%", maxWidth: 520 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 20px",
          height: 48,
          borderRadius: 9999,
          border: `1px solid ${v("textSubtle")}`,
          background: v("surface"),
          color: v("textMuted"),
        }}
      >
        <SearchIcon size={18} />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Find a dispute or order"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && results[highlight] ? `${listId}-${highlight}` : undefined}
          aria-autocomplete="list"
          placeholder="Find a dispute or order (e.g. PP-D-1001)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(results[highlight]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 16,
            color: v("text"),
            minWidth: 0,
          }}
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching disputes"
          style={{
            position: "absolute",
            top: 56,
            left: 0,
            right: 0,
            margin: 0,
            padding: 6,
            listStyle: "none",
            background: v("surface"),
            border: `1px solid ${v("border")}`,
            borderRadius: 16,
            boxShadow: v("shadowLg"),
            zIndex: 30,
          }}
        >
          {results.length === 0 ? (
            <li style={{ padding: "12px 14px", fontSize: 14, color: v("textMuted") }}>No dispute or order matches “{query.trim()}”.</li>
          ) : (
            results.map((d, i) => {
              const badge = DECISION_STYLE[d.decision] ?? DECISION_STYLE.standard!;
              return (
                <li
                  key={d.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  className="poi-suggestion"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(d);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: v("navy") }}>{d.id}</span>
                  <span style={{ fontSize: 13, color: v("textMuted"), flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.orderId}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: v("text") }}>{formatMoney(d.amount)}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "2px 10px",
                      borderRadius: 9999,
                      background: badge.bg,
                      color: badge.fg,
                    }}
                  >
                    {badge.label}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
