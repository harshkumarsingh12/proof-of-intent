"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- ag-studio types custom widgets through a heavy registry generic; the widgets read their data mapping by key, so Studio's params are typed loosely on purpose */

/**
 * The three AG Studio custom widgets from spec 0007 (owner: @hoursgotviral-dev): mandate diff, evidence preview and
 * agent platform breakdown. Each reads its data through Studio's data engine (so Studio's filters and cross filters
 * apply) and draws with the dashboard's own theme tokens. The pure shaping lives in src/studio-data.ts.
 */
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellStyle,
  type ColDef,
  type GridApi,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { createWidgets } from "ag-studio-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { gridTheme } from "../../../src/grid-theme";
import {
  actionLabel,
  cells,
  diffView,
  disputePath,
  dueLabel,
  evidencePdfPath,
  hasEvidence,
  isUrgent,
  NO_MANDATE_LABEL,
  platformCards,
  statusLabel,
  urgency,
  type GridDispute,
  type PlatformGroup,
  type StudioCheckRow,
} from "../../../src/studio-data";
import { getUnfilteredTotal, useFilterRevision } from "../../../src/studio-filters";
import { useSelectedDispute } from "../../../src/studio-selection";
import { fontStack, palette, v } from "../../../src/theme";
import { widgets as widgetInfo } from "../../../src/widgets";

ModuleRegistry.registerModules([AllCommunityModule]);

const info = (id: string) => {
  const w = widgetInfo.find((x) => x.id === id);
  if (!w) throw new Error(`widget ${id} is not described in src/widgets.ts`);
  return w;
};

type Mapped = AgWidgetField;

/**
 * What Studio mapped to a data mapping slot. In ag-studio 3.0.0 a slot holds the hydrated field
 * (`{ fieldId, key, name, ... }`), not the `{ id }` the docs show; getData wants those objects back, and result rows
 * are read by the field's `fieldId`.
 */
const slot = (mapping: Partial<Record<string, Mapped[]>>, key: string): Mapped => {
  const item = mapping[key]?.[0];
  if (!item?.fieldId) throw new Error(`data mapping "${key}" is empty`);
  return item;
};

const idOf = (item: Mapped): string => String(item.fieldId);

/** The same field asked for as an aggregate (count, sum). */
const aggregated = (item: Mapped, aggregation: "count" | "sum"): Mapped =>
  ({ ...item, type: "implicitMeasure", aggregation }) as unknown as Mapped;

const frame: CSSProperties = {
  fontFamily: fontStack,
  color: v("text"),
  height: "100%",
  overflow: "auto",
  padding: 12,
  boxSizing: "border-box",
};

/**
 * The rows for a widget's query. `use(widgetApi.getData(...))`, as the docs show, suspends forever here because each
 * render makes a new promise, so load in an effect instead. It reloads when the field mapping changes or when Studio
 * hands the widget a new `config` (filters and cross filters change it), and shows a line while loading.
 */
function useRows(
  { widgetApi, config }: AgWidgetParams<any>,
  fields: Mapped[],
): { rows?: Record<string, unknown>[]; error?: string } {
  const [state, setState] = useState<{ rows?: Record<string, unknown>[]; error?: string }>({});
  const key = JSON.stringify(fields.map((f) => [idOf(f), f.aggregation]));
  // Studio gives a custom widget no event for a cross filter, so the Studio view publishes one (studio-filters.ts).
  const filters = useFilterRevision();
  useEffect(() => {
    let live = true;
    widgetApi.getData({ fields } as any).then(
      (response: { results: { rows: Record<string, unknown>[] } }) =>
        live && setState({ rows: response.results.rows }),
      (err: unknown) => live && setState({ error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
    // `fields` is covered by `key`; `config` and `filters` change when Studio's filters do.
  }, [widgetApi, config, key, filters]);
  return state;
}

const Status = ({ children }: { children: string }) => (
  <div style={{ ...frame, color: v("textMuted"), display: "grid", placeItems: "center", fontSize: 14 }}>
    {children}
  </div>
);

/** ag-studio-react 3.0.0 ships no overlay components, so an empty widget says so itself. */
const NoData = () => (
  <div style={{ ...frame, color: v("textMuted"), display: "grid", placeItems: "center", fontSize: 14 }}>
    No data for this widget with the current filters.
  </div>
);

/**
 * Studio draws a custom widget's title itself, from the title in the report state or the edit form, but only when
 * `format.title.enabled` is true, and it is false unless the state says so. So the report state (StudioView) sets
 * `enabled: true` on each of these and the widgets draw no title of their own, which would show it twice.
 */

const chip = (bg: string, fg: string, border: string): CSSProperties => ({
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  background: bg,
  color: fg,
  border: `1px solid ${border}`,
});

const passChip = chip(v("successBg"), v("success"), v("successBorder"));
const failChip = chip(v("dangerBg"), v("danger"), v("dangerBorder"));

// ---------- mandate diff ----------

const DIFF_FIELDS = ["dispute", "check", "mandateRule", "cartActual", "status", "reasonCode"] as const;

function MandateDiff(props: AgWidgetParams<any>) {
  const items = DIFF_FIELDS.map((k) => slot(props.dataMapping, k));
  const ids = items.map(idOf);
  const { rows: raw, error } = useRows(props, items);
  const [onlyViolations, setOnlyViolations] = useState(false);
  const [picked, setPicked] = useSelectedDispute();

  if (error) return <Status>{`Couldn't load the signed limits: ${error}`}</Status>;
  if (!raw) return <Status>Loading the signed limits…</Status>;
  const rows: StudioCheckRow[] = raw.map((row: Record<string, unknown>) => {
    const [dispute = "", check = "", mandateRule = "", cartActual = "", status = "", reasonCode = ""] = cells(
      row,
      ids,
    ).map((x) => String(x ?? ""));
    return {
      dispute,
      check,
      mandateRule,
      cartActual,
      status: status === "FAIL" ? "FAIL" : "PASS",
      reasonCode,
    };
  });
  if (rows.length === 0) return <NoData />;
  const view = diffView(rows, picked, onlyViolations);

  return (
    <div style={frame}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <label style={{ fontSize: 13 }}>
          Dispute{" "}
          <select value={view.selected} onChange={(e) => setPicked(e.target.value)}>
            {view.disputes.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        {view.selected && (
          <a href={disputePath(view.selected)} style={{ fontSize: 13 }}>
            Open in dispute detail
          </a>
        )}
        <label style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={onlyViolations}
            onChange={(e) => setOnlyViolations(e.target.checked)}
          />{" "}
          Only violations
        </label>
        <span style={view.failed ? failChip : passChip}>
          {view.failed ? `${view.failed} of ${view.total} limits broken` : `All ${view.total} limits met`}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: v("textMuted") }}>
            <th style={{ padding: "4px 8px" }}>Limit</th>
            <th style={{ padding: "4px 8px" }}>Shopper signed</th>
            <th style={{ padding: "4px 8px" }}>Cart had</th>
            <th style={{ padding: "4px 8px" }}>Result</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((l) => (
            <tr
              key={l.check}
              style={{
                background: l.status === "FAIL" ? v("dangerBg") : undefined,
                borderTop: `1px solid ${v("border")}`,
              }}
            >
              <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>{l.check}</td>
              <td style={{ padding: "6px 8px" }}>{l.mandateRule}</td>
              <td style={{ padding: "6px 8px", fontWeight: l.status === "FAIL" ? 700 : 400 }}>
                {l.cartActual}
              </td>
              <td style={{ padding: "6px 8px" }}>
                <span style={l.status === "FAIL" ? failChip : passChip}>
                  {l.status === "FAIL" ? "Broken" : "Met"}
                </span>
                {l.reasonCode && l.status === "FAIL" && (
                  <code style={{ marginLeft: 8, fontSize: 12, color: v("textMuted") }}>{l.reasonCode}</code>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- evidence preview ----------

const EVIDENCE_FIELDS = ["dispute", "disputeClass", "coverNote"] as const;

function EvidencePreview(props: AgWidgetParams<any>) {
  const items = EVIDENCE_FIELDS.map((k) => slot(props.dataMapping, k));
  const ids = items.map(idOf);
  const { rows: raw, error } = useRows(props, items);
  const [picked, setPicked] = useSelectedDispute();

  if (error) return <Status>{`Couldn't load the disputes: ${error}`}</Status>;
  if (!raw) return <Status>Loading the disputes…</Status>;
  const rows = raw.map((row: Record<string, unknown>) => {
    const [dispute = "", disputeClass = "", coverNote = ""] = cells(row, ids).map((x) => String(x ?? ""));
    return { dispute, disputeClass, coverNote };
  });
  if (rows.length === 0) return <NoData />;
  const current = rows.find((r: { dispute: string }) => r.dispute === picked) ?? rows[0];
  if (!current) return <NoData />;

  return (
    <div style={{ ...frame, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 13 }}>
          Dispute{" "}
          <select value={current.dispute} onChange={(e) => setPicked(e.target.value)}>
            {rows.map((r: { dispute: string }) => (
              <option key={r.dispute}>{r.dispute}</option>
            ))}
          </select>
        </label>
        {hasEvidence(current.disputeClass) && (
          <a
            href={evidencePdfPath(current.dispute)}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13 }}
          >
            Open the PDF in a new tab
          </a>
        )}
        <a href={disputePath(current.dispute)} style={{ fontSize: 13 }}>
          Open in dispute detail
        </a>
      </div>
      {current.coverNote && (
        <details style={{ fontSize: 13 }} open>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: v("heading") }}>
            Cover note submitted with the PDF
          </summary>
          <p style={{ margin: "6px 0 0", color: v("text"), lineHeight: "20px" }}>{current.coverNote}</p>
        </details>
      )}
      {hasEvidence(current.disputeClass) ? (
        <iframe
          key={current.dispute}
          title={`Attestation PDF for ${current.dispute}`}
          src={evidencePdfPath(current.dispute)}
          style={{ flex: 1, minHeight: 240, border: `1px solid ${v("border")}`, borderRadius: 6 }}
        />
      ) : (
        <p style={{ color: v("textMuted"), fontSize: 14 }}>
          {current.dispute} is classified {current.disputeClass}. The attestation PDF is drafted only for
          orders that met every signed limit, so there is no evidence to preview. The recommendation is in the
          dispute detail.
        </p>
      )}
    </div>
  );
}

// ---------- agent platform breakdown ----------

const PLATFORM_FIELDS = ["platform", "disputeClass", "dispute", "amount"] as const;

function AgentPlatform(props: AgWidgetParams<any>) {
  const [platform, disputeClass, dispute, amount] = PLATFORM_FIELDS.map((k) => slot(props.dataMapping, k));
  const queried = [platform!, disputeClass!, aggregated(dispute!, "count"), aggregated(amount!, "sum")];
  const { rows: raw, error } = useRows(props, queried);
  if (error) return <Status>{`Couldn't load the platforms: ${error}`}</Status>;
  if (!raw) return <Status>Loading the platforms…</Status>;
  const ids = queried.map(idOf);
  const groups: PlatformGroup[] = raw.map((row: Record<string, unknown>) => {
    const [p, c, n, a] = cells(row, ids);
    return {
      platform: String(p ?? ""),
      disputeClass: String(c ?? ""),
      disputes: Number(n ?? 0),
      amount: Number(a ?? 0),
    };
  });
  if (groups.length === 0) return <NoData />;
  const cards = platformCards(groups);
  // A class or platform filter changes what these cards count, so say so instead of letting 0% or 100% read as fact.
  const shown = cards.reduce((n, c) => n + c.disputes, 0);
  const all = getUnfilteredTotal();
  const narrowed = all !== undefined && shown < all;

  return (
    <div style={frame}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {cards.map((c) => {
          const hot = c.overreachRate > 0.25;
          return (
            <div
              key={c.platform}
              style={{
                border: `1px solid ${hot ? v("dangerBorder") : v("border")}`,
                background: v("surface"),
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ color: v("heading"), fontWeight: 700, lineHeight: "20px" }}>{c.platform}</div>
              {c.platform === NO_MANDATE_LABEL && (
                <div style={{ fontSize: 12, lineHeight: "16px", color: v("textMuted") }}>
                  not an agent order
                </div>
              )}
              <div style={{ fontSize: 13, lineHeight: "18px", color: v("textMuted") }}>
                {c.disputes} {c.disputes === 1 ? "dispute" : "disputes"}
              </div>
              <div
                style={{
                  fontSize: 28,
                  lineHeight: "36px",
                  fontWeight: 700,
                  color: hot ? v("danger") : v("text"),
                }}
              >
                {Math.round(c.overreachRate * 100)}%
              </div>
              <div style={{ fontSize: 12, lineHeight: "16px", color: v("textMuted") }}>
                overreach rate ({c.overreach} of {c.disputes})
              </div>
              <div style={{ fontSize: 13, lineHeight: "18px", marginTop: 6 }}>
                Conceded:{" "}
                <strong>${c.concededAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
              </div>
            </div>
          );
        })}
      </div>
      {narrowed && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: "16px", color: v("textMuted") }}>
          A filter is on: these rates are of the {shown} disputes it leaves, not all {all}.
        </div>
      )}
    </div>
  );
}

// ---------- disputes grid ----------

const GRID_FIELDS = [
  "dispute",
  "disputeClass",
  "platform",
  "status",
  "amount",
  "action",
  "dueAt",
  "hoursToDue",
] as const;

const CLASS_CHIP: Record<string, { fg: string; bg: string }> = {
  MANDATE_COMPLIANT: { fg: palette.success, bg: palette.successBg },
  AGENT_OVERREACH: { fg: palette.danger, bg: palette.dangerBg },
  INTENT_MISREAD: { fg: palette.warning, bg: palette.warningBg },
  NO_MANDATE: { fg: palette.textMuted, bg: palette.surfaceMuted },
};

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function DisputeGrid(props: AgWidgetParams<any>) {
  const items = GRID_FIELDS.map((k) => slot(props.dataMapping, k));
  const ids = items.map(idOf);
  const { rows: raw, error } = useRows(props, items);
  const [selected, setSelected] = useSelectedDispute();
  const [quick, setQuick] = useState("");
  const api = useRef<GridApi<GridDispute>>(null);

  const rows = useMemo<GridDispute[]>(
    () =>
      (raw ?? []).map((row) => {
        const [
          id = "",
          disputeClass = "",
          platform = "",
          status = "",
          amount = 0,
          action = "",
          dueAt = "",
          hours = 0,
        ] = cells(row, ids);
        return {
          id: String(id),
          disputeClass: String(disputeClass),
          platform: String(platform),
          status: String(status),
          amount: Number(amount),
          action: String(action),
          dueAt: String(dueAt),
          hoursToDue: Number(hours),
        };
      }),
    [raw],
  );

  // Repaint the rows when the shared selection changes (rows are styled from it).
  useEffect(() => {
    api.current?.redrawRows();
  }, [selected]);

  const columns = useMemo<ColDef<GridDispute>[]>(
    () => [
      {
        field: "id",
        headerName: "Dispute",
        minWidth: 130,
        cellStyle: { fontFamily: "ui-monospace, monospace", fontSize: 12 } as CellStyle,
      },
      {
        field: "disputeClass",
        headerName: "Class",
        minWidth: 150,
        cellStyle: { display: "flex", alignItems: "center" } as CellStyle,
        cellRenderer: ({ value }: { value: string }) => {
          const tone = CLASS_CHIP[value] ?? CLASS_CHIP.NO_MANDATE!;
          return (
            <span
              style={{
                ...chip(tone.bg, tone.fg, tone.bg),
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
              }}
            >
              {value}
            </span>
          );
        },
      },
      { field: "platform", headerName: "Platform", minWidth: 120 },
      {
        field: "status",
        headerName: "Status",
        minWidth: 150,
        valueFormatter: ({ value }) => statusLabel(String(value ?? "")),
      },
      {
        field: "amount",
        headerName: "Amount",
        type: "rightAligned",
        minWidth: 110,
        valueFormatter: ({ value }) => money(Number(value ?? 0)),
      },
      {
        field: "action",
        headerName: "Recommended",
        minWidth: 170,
        valueFormatter: ({ value }) => actionLabel(String(value ?? "")),
      },
      {
        colId: "respondBy",
        headerName: "Respond in",
        minWidth: 130,
        sort: "asc",
        valueGetter: ({ data }) => (data ? urgency(data) : 0),
        valueFormatter: ({ data }) => (data ? dueLabel(data) : ""),
        cellStyle: ({ data }) =>
          data && isUrgent(data) ? { color: palette.danger, fontWeight: 700 } : undefined,
        tooltipValueGetter: ({ data }) => (data?.dueAt ? new Date(data.dueAt).toLocaleString() : ""),
      },
    ],
    [],
  );

  if (error) return <Status>{`Couldn't load the disputes: ${error}`}</Status>;
  if (!raw) return <Status>Loading the disputes…</Status>;
  if (rows.length === 0) return <NoData />;

  return (
    <div style={{ ...frame, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          aria-label="Filter disputes"
          placeholder="Filter disputes"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${v("border")}`, minWidth: 200 }}
        />
        <button
          type="button"
          onClick={() => api.current?.exportDataAsCsv({ fileName: "disputes.csv" })}
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            border: `1px solid ${v("navy")}`,
            background: v("surface"),
            color: v("navy"),
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Export CSV
        </button>
        <span style={{ color: v("textMuted"), fontSize: 13 }}>
          {rows.length} disputes. Click a row to see its limits and PDF below.
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 200 }}>
        <AgGridReact<GridDispute>
          theme={gridTheme}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={{ flex: 1, minWidth: 90, resizable: true }}
          quickFilterText={quick}
          getRowId={({ data }) => data.id}
          onGridReady={(e) => {
            api.current = e.api;
          }}
          onRowClicked={(e) => e.data && setSelected(e.data.id)}
          onCellKeyDown={(e) => {
            const key = (e.event as KeyboardEvent | undefined)?.key;
            if (key === "Enter" && e.data) setSelected(e.data.id);
          }}
          getRowStyle={({ data }) =>
            data?.id === (selected ?? rows[0]?.id)
              ? { background: palette.navHoverBg, fontWeight: 600 }
              : undefined
          }
          rowStyle={{ cursor: "pointer" }}
          tooltipShowDelay={300}
          animateRows={false}
        />
      </div>
    </div>
  );
}

// ---------- definitions ----------

const aiField = (aiDescription: string, supportedRoles: string[]) => ({
  type: "field" as const,
  supportedRoles,
  requires: { cardinality: "one" as const },
  required: true,
  aiDescription,
});

const definition = (
  id: string,
  dataMapping: Record<string, ReturnType<typeof aiField>>,
  labels: Record<string, string>,
  comp: (p: AgWidgetParams<any>) => React.ReactNode,
  size: { width: number; height: number },
): any => ({
  id,
  label: info(id).name,
  dataMapping,
  form: (params: any) =>
    params.createDefaults({
      dataMappingItems: Object.keys(dataMapping).map((key) => ({ key, label: labels[key] })),
    }),
  comp,
  defaultSize: size,
  minSize: { width: 240, height: 160 },
  ai: { description: info(id).aiDescription },
});

export const customWidgetDefinitions: any[] = [
  definition(
    "dispute-grid",
    {
      dispute: aiField(
        "The dispute id; one row per dispute. Clicking a row selects it for the other widgets.",
        ["category"],
      ),
      disputeClass: aiField(
        "The copilot's class: MANDATE_COMPLIANT, AGENT_OVERREACH, INTENT_MISREAD or NO_MANDATE.",
        ["category"],
      ),
      platform: aiField("The agent platform, or No mandate when the order had no signed mandate.", [
        "category",
      ]),
      status: aiField("PayPal's dispute status, such as WAITING_FOR_SELLER_RESPONSE or RESOLVED.", [
        "category",
      ]),
      amount: aiField("The disputed amount in US dollars.", ["numeric"]),
      action: aiField("The copilot's recommended PayPal action, such as PROVIDE_EVIDENCE or ACCEPT_CLAIM.", [
        "category",
      ]),
      dueAt: aiField("When the seller's response is due, as an ISO date.", ["category"]),
      hoursToDue: aiField("Hours until the response is due; negative once it is late.", ["numeric"]),
    },
    {
      dispute: "Dispute",
      disputeClass: "Class",
      platform: "Platform",
      status: "Status",
      amount: "Amount",
      action: "Recommended action",
      dueAt: "Respond by",
      hoursToDue: "Hours to respond",
    },
    DisputeGrid,
    { width: 900, height: 360 },
  ),
  definition(
    "mandate-diff",
    {
      dispute: aiField("The dispute id; one dispute's limits are shown at a time.", ["category"]),
      check: aiField("The name of the signed limit, such as amount_max or attributes.color.", ["category"]),
      mandateRule: aiField("What the shopper signed for that limit.", ["category"]),
      cartActual: aiField("What the cart actually had for that limit.", ["category"]),
      status: aiField("PASS when the cart met the limit, FAIL when it broke it.", ["category"]),
      reasonCode: aiField("The reason code for a broken limit, empty when met.", ["category"]),
    },
    {
      dispute: "Dispute",
      check: "Limit",
      mandateRule: "Shopper signed",
      cartActual: "Cart had",
      status: "Result",
      reasonCode: "Reason code",
    },
    MandateDiff,
    { width: 640, height: 360 },
  ),
  definition(
    "evidence-preview",
    {
      dispute: aiField("The dispute id whose attestation PDF to show.", ["category"]),
      disputeClass: aiField("The copilot's class for the dispute; only MANDATE_COMPLIANT has a PDF.", [
        "category",
      ]),
      coverNote: aiField("The cover note drafted to go with the evidence PDF, empty when there is none.", [
        "category",
      ]),
    },
    { dispute: "Dispute", disputeClass: "Class", coverNote: "Cover note" },
    EvidencePreview,
    { width: 520, height: 420 },
  ),
  definition(
    "agent-platform",
    {
      platform: aiField("The agent platform that placed the order.", ["category"]),
      disputeClass: aiField("The copilot's class for the dispute; AGENT_OVERREACH counts as overreach.", [
        "category",
      ]),
      dispute: aiField("The dispute id, counted per platform and class.", ["category"]),
      amount: aiField("The disputed amount in US dollars, summed per platform and class.", ["numeric"]),
    },
    { platform: "Platform", disputeClass: "Class", dispute: "Dispute", amount: "Amount" },
    AgentPlatform,
    { width: 640, height: 240 },
  ),
];

/** Studio's widgets config: the defaults plus ours, in a "Dispute tools" group of the widget menu. */
export const studioWidgets = (base: {
  menu: { label: string; widgetIds: readonly string[]; collapsed?: boolean }[];
}) =>
  createWidgets<any>({
    additionalTypes: customWidgetDefinitions,
    menu: [...base.menu, { label: "Dispute tools", widgetIds: customWidgetDefinitions.map((d) => d.id) }],
  });
