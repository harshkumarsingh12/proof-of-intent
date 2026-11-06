"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type CellStyle, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useState, type CSSProperties } from "react";
import { formatMoney } from "../../src/api";
import { orderKpis, type OrderRow, type OrdersData, type Outcome, type VerdictRow } from "../../src/orders";
import { card, fontStack, kpiLabel, palette, v } from "../../src/theme";
import { SampleDataNotice } from "../SampleDataNotice";

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid on the dashboard palette (src/theme.ts). */
const gridTheme = themeQuartz.withParams({
  accentColor: palette.blue,
  foregroundColor: palette.text,
  backgroundColor: palette.surface,
  borderColor: palette.border,
  headerBackgroundColor: palette.surfaceMuted,
  headerTextColor: palette.heading,
  oddRowBackgroundColor: palette.bg,
  rowHoverColor: palette.navHoverBg,
  fontFamily: fontStack,
  fontSize: 13,
  wrapperBorderRadius: 12,
});

const OUTCOME_STYLE: Record<Outcome, { label: string; fg: string; bg: string }> = {
  APPROVE: { label: "Approved", fg: palette.success, bg: palette.successBg },
  STEP_UP: { label: "Step-up", fg: palette.warning, bg: palette.warningBg },
  REJECT: { label: "Rejected", fg: palette.danger, bg: palette.dangerBg },
};

const chip = (fg: string, bg: string): CSSProperties => ({
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: "20px",
  color: fg,
  background: bg,
});

const MONO_FONT = "ui-monospace, SFMono-Regular, Consolas, monospace";
const mono: CSSProperties = { fontFamily: MONO_FONT, fontSize: 12 };
const monoCell: CellStyle = { fontFamily: MONO_FONT, fontSize: "12px" };

function OutcomeChip({ value }: { value?: Outcome }) {
  if (!value) return <span style={{ color: v("textSubtle") }}>—</span>;
  const s = OUTCOME_STYLE[value];
  return <span style={chip(s.fg, s.bg)}>{s.label}</span>;
}

function Reasons({ value }: { value?: string[] }) {
  if (!value?.length) return <span style={{ color: v("textSubtle") }}>None</span>;
  return <span style={{ ...mono, color: palette.danger }}>{value.join(", ")}</span>;
}

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";

const orderColumns: ColDef<OrderRow>[] = [
  { field: "orderId", headerName: "Order", cellStyle: monoCell, minWidth: 330, tooltipField: "orderId" },
  { field: "agentPlatform", headerName: "Agent platform", filter: true },
  {
    colId: "humanPresent",
    headerName: "Shopper",
    // A string, not the boolean: AG Grid would draw a checkbox, and the filter and search need the words.
    valueGetter: (p) => (p.data?.humanPresent === undefined ? "" : p.data.humanPresent ? "Present" : "Agent alone"),
    filter: true,
  },
  { field: "verdict", headerName: "Verdict", cellRenderer: OutcomeChip, filter: true },
  { field: "reasons", headerName: "Reason codes", cellRenderer: Reasons, sortable: false, flex: 1.4, minWidth: 200 },
  {
    field: "amount",
    headerName: "Amount",
    valueFormatter: (p) => (p.value ? formatMoney(p.value) : ""),
    comparator: (a, b) => (a?.value ?? 0) - (b?.value ?? 0),
    type: "rightAligned",
  },
  { field: "status", headerName: "PayPal status", filter: true },
  { field: "createdAt", headerName: "Created", valueFormatter: (p) => when(p.value), sort: "desc" },
  { field: "capturedAt", headerName: "Captured", valueFormatter: (p) => when(p.value) },
];

const verdictColumns: ColDef<VerdictRow>[] = [
  { field: "createdAt", headerName: "Decided", valueFormatter: (p) => when(p.value), sort: "desc" },
  { field: "outcome", headerName: "Verdict", cellRenderer: OutcomeChip, filter: true },
  { field: "reasons", headerName: "Reason codes", cellRenderer: Reasons, sortable: false, flex: 1.6 },
  { field: "cartId", headerName: "Cart", cellStyle: monoCell, minWidth: 200 },
  {
    field: "orderId",
    headerName: "PayPal order",
    // Invariant 1: a rejected cart never reaches PayPal.
    cellRenderer: ({ value }: { value?: string }) => value ?? "None, nothing charged",
    cellStyle: monoCell,
    minWidth: 220,
  },
];

const defaultColDef: ColDef = { sortable: true, resizable: true, flex: 1, minWidth: 120 };

export function OrdersView({ data }: { data: OrdersData }) {
  const [tab, setTab] = useState<"orders" | "verdicts">("orders");
  const [query, setQuery] = useState("");
  const kpis = useMemo(() => orderKpis(data), [data]);

  const tiles: [string, string, string][] = [
    ["Orders captured", String(kpis.captured), "Paid through PayPal after every check passed"],
    [
      "Captured value",
      kpis.capturedValue.map(formatMoney).join(" + ") || formatMoney({ value: 0, currency: "USD" }),
      "Summed per currency",
    ],
    ["Carts blocked", String(kpis.blocked), "Rejected before any PayPal order existed"],
    ["Sent to the shopper", String(kpis.stepUp), "Step-up: the shopper confirms the cart"],
  ];

  const tabButton = (id: typeof tab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      style={{
        padding: "8px 16px",
        borderRadius: 999,
        border: `1px solid ${tab === id ? palette.navy : palette.border}`,
        background: tab === id ? palette.navy : palette.surface,
        color: tab === id ? "#fff" : palette.text,
        fontWeight: 600,
        fontSize: 14,
        cursor: "pointer",
      }}
    >
      {label} ({count})
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {data.isSample && (
        <SampleDataNotice>
          These rows come from the built-in demo set (300 checkout orders). Live orders appear here once the
          merchant API is reachable.
        </SampleDataNotice>
      )}

      <div className="poi-grid-4" style={{ display: "grid", gap: 16 }}>
        {tiles.map(([label, value, hint]) => (
          <div key={label} style={card}>
            <div style={kpiLabel}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: v("heading"), margin: "6px 0 4px" }}>{value}</div>
            <div style={{ fontSize: 12, color: v("textMuted") }}>{hint}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div role="tablist" aria-label="Orders or checkout verdicts" style={{ display: "flex", gap: 8 }}>
            {tabButton("orders", "Agent orders", data.orders.length)}
            {tabButton("verdicts", "Checkout verdicts", data.verdicts.length)}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search orders, platforms, reason codes"
            aria-label="Search the grid"
            style={{
              minWidth: 260,
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${palette.border}`,
              fontSize: 14,
            }}
          />
        </div>

        <div style={{ height: 560 }}>
          {tab === "orders" ? (
            <AgGridReact<OrderRow>
              theme={gridTheme}
              rowData={data.orders}
              columnDefs={orderColumns}
              defaultColDef={defaultColDef}
              quickFilterText={query}
              getRowId={(p) => p.data.orderId}
              pagination
              paginationPageSize={20}
              paginationPageSizeSelector={[20, 50, 100]}
              overlayNoRowsTemplate="No agent orders yet"
            />
          ) : (
            <AgGridReact<VerdictRow>
              theme={gridTheme}
              rowData={data.verdicts}
              columnDefs={verdictColumns}
              defaultColDef={defaultColDef}
              quickFilterText={query}
              getRowId={(p) => String(p.data.id)}
              pagination
              paginationPageSize={20}
              paginationPageSizeSelector={[20, 50, 100]}
              overlayNoRowsTemplate="No checkout verdicts yet"
            />
          )}
        </div>
      </div>
    </div>
  );
}
