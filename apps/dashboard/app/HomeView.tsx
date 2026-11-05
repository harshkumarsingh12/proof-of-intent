"use client";
// Home: welcome header, a tabbed card of disputes that need the operator, and round quick links.
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { calculateSla, formatMoney } from "../src/api";
import type { DisputeItem } from "../src/dispute-types";
import {
  byDeadline,
  classLabel,
  dueSubtitle,
  dueWithin,
  forTab,
  HOME_RANGES,
  HOME_TABS,
  inRange,
  type HomeRange,
  type HomeTab,
} from "../src/home";
import { ChartIcon, ChevronDownIcon, DocIcon, ExternalIcon, FileCheckIcon, PulseIcon, ScaleIcon, WebhookIcon } from "./icons";
import { REPO_URL } from "../src/merchant";
import { card, pageSubtitle, pageTitle, v } from "../src/theme";

const API_HEALTH_URL = "https://poi-api.iotkiit.in/healthz";

/** Flat color band per tile, like the colored headers on the screenshot's product cards. */
const band = (d: DisputeItem) => {
  if (d.status === "RESOLVED") return { bg: v("bandResolved"), fg: v("text") };
  if (d.decision === "defend") return { bg: v("bandDefend"), fg: "#ffffff" };
  if (d.decision === "concede") return { bg: v("bandConcede"), fg: v("text") };
  return { bg: v("bandStandard"), fg: v("text") };
};

export function HomeView({ disputes, nowIso }: { disputes: DisputeItem[]; nowIso: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [range, setRange] = useState<HomeRange>("7d");
  const [tab, setTab] = useState<HomeTab>("action");

  const scoped = useMemo(() => inRange(disputes, range, now), [disputes, range, now]);
  const dueSoon = useMemo(() => dueWithin(disputes, 24, now), [disputes, now]);
  const counts = useMemo(
    () => Object.fromEntries(HOME_TABS.map((t) => [t.id, forTab(scoped, t.id).length])) as Record<HomeTab, number>,
    [scoped],
  );
  const tiles = useMemo(() => byDeadline(forTab(scoped, tab)).slice(0, 3), [scoped, tab]);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 32 }}>
        <div>
          <h1 style={{ ...pageTitle, fontSize: 44 }}>Welcome back</h1>
          <p style={{ ...pageSubtitle, fontSize: 18 }}>{dueSubtitle(dueSoon.length)}</p>
        </div>
        <RangeSelect value={range} onChange={setRange} />
      </div>

      <section aria-labelledby="needs-you" style={{ ...card, padding: "32px 40px 36px", marginBottom: 40 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
          <h2 id="needs-you" style={{ margin: 0, fontSize: 22, fontWeight: 700, color: v("text") }}>
            Which disputes need you?
          </h2>
          <Link href="/disputes" style={{ fontSize: 16, fontWeight: 700, color: v("blue"), textDecoration: "none" }}>
            Open the dispute queue →
          </Link>
        </div>
        <p style={{ margin: "8px 0 24px", fontSize: 15, color: v("textMuted") }}>
          The copilot sorts each dispute into defend or concede. You make the final call on every action.
        </p>

        <div role="tablist" aria-label="Dispute groups" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
          {HOME_TABS.map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={on}
                aria-controls="tab-panel"
                className="poi-tab"
                onClick={() => setTab(t.id)}
                style={{
                  padding: "10px 20px",
                  borderRadius: 9999,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 17,
                  fontWeight: on ? 700 : 500,
                  background: on ? v("surface") : "transparent",
                  boxShadow: on ? v("shadowLg") : "none",
                  color: on ? v("navy") : v("text"),
                }}
              >
                {t.label}
                <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 600, color: v("textMuted") }}>{counts[t.id]}</span>
              </button>
            );
          })}
        </div>

        <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tiles.length === 0 ? (
            <p style={{ margin: 0, padding: "32px 0", textAlign: "center", fontSize: 15, color: v("textMuted") }}>
              Nothing here for this range.
            </p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 28 }}>
              {tiles.map((d) => (
                <DisputeTile key={d.id} dispute={d} now={now} />
              ))}
            </div>
          )}
        </div>
      </section>

      <nav aria-label="Quick links" style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        <QuickLink href="/disputes" icon={<ScaleIcon size={28} />} label="Dispute queue" />
        <QuickLink href="/analytics" icon={<ChartIcon size={28} />} label="Analytics" />
        <QuickLink href="/disputes/PP-D-1001" icon={<FileCheckIcon size={28} />} label="Evidence sample" />
        <QuickLink href={API_HEALTH_URL} icon={<PulseIcon size={28} />} label="API health" external />
        <QuickLink
          href={`${REPO_URL}/blob/main/docs/specs/0004-paypal-integration.md`}
          icon={<WebhookIcon size={28} />}
          label="Webhooks spec"
          external
        />
        <QuickLink href={`${REPO_URL}/tree/main/docs/specs`} icon={<DocIcon size={28} />} label="All specs" external />
      </nav>
    </div>
  );
}

function RangeSelect({ value, onChange }: { value: HomeRange; onChange: (r: HomeRange) => void }) {
  return (
    <label style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Date range</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as HomeRange)}
        style={{
          appearance: "none",
          padding: "12px 48px 12px 20px",
          fontSize: 16,
          color: v("text"),
          background: v("surface"),
          border: `1px solid ${v("textSubtle")}`,
          borderRadius: 8,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {HOME_RANGES.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={18} style={{ position: "absolute", right: 18, pointerEvents: "none", color: v("text") }} />
    </label>
  );
}

function DisputeTile({ dispute: d, now }: { dispute: DisputeItem; now: Date }) {
  const b = band(d);
  const sla = calculateSla(d.sellerResponseDueDate, now);
  return (
    <Link href={`/disputes/${encodeURIComponent(d.id)}`} className="poi-tile" style={{ display: "block", textDecoration: "none", borderRadius: 12 }}>
      <div
        style={{
          height: 150,
          borderRadius: 12,
          background: b.bg,
          color: b.fg,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>{d.agentPlatform}</span>
        <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>{formatMoney(d.amount)}</span>
      </div>
      <div style={{ padding: "14px 2px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontSize: 18, color: v("text") }}>
            {d.id} · {classLabel(d.disputeClass)}
          </span>
          {d.status !== "RESOLVED" && (
            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", color: sla.isUrgent ? v("danger") : v("textMuted") }}>
              {sla.text}
            </span>
          )}
        </div>
        {d.shopperNotes && (
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 15,
              color: v("textMuted"),
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {d.shopperNotes}
          </p>
        )}
      </div>
    </Link>
  );
}

function QuickLink({ href, icon, label, external }: { href: string; icon: ReactNode; label: string; external?: boolean }) {
  const body = (
    <>
      <span
        className="poi-quick-circle"
        style={{
          width: 72,
          height: 72,
          borderRadius: 9999,
          background: v("surfaceMuted"),
          color: v("text"),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background 0.15s ease",
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 14, color: v("text"), display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {external && <ExternalIcon size={12} />}
      </span>
    </>
  );
  const style: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    width: 128,
    textDecoration: "none",
  };
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className="poi-quick" style={style}>
      {body}
    </a>
  ) : (
    <Link href={href} className="poi-quick" style={style}>
      {body}
    </Link>
  );
}
