"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- ag-studio types custom widgets through a heavy registry generic; the widgets read their data mapping by key, so Studio's params are typed loosely on purpose */

/**
 * The three AG Studio custom widgets from spec 0007 (owner: @hoursgotviral-dev): mandate diff, evidence preview and
 * agent platform breakdown. Each reads its data through Studio's data engine (so Studio's filters and cross filters
 * apply) and draws with the dashboard's own theme tokens. The pure shaping lives in src/studio-data.ts.
 */
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { createWidgets } from "ag-studio-react";
import { useEffect, useState, type CSSProperties } from "react";
import {
  cells,
  diffView,
  evidencePdfPath,
  hasEvidence,
  platformCards,
  type PlatformGroup,
  type StudioCheckRow,
} from "../../../src/studio-data";
import { useSelectedDispute } from "../../../src/studio-selection";
import { fontStack, v } from "../../../src/theme";
import { widgets as widgetInfo } from "../../../src/widgets";

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
    // `fields` is covered by `key`; `config` changes when Studio's filters do.
  }, [widgetApi, config, key]);
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
 * A custom widget draws its own title. Studio hands over `format` from the edit form, but without a `formatShape` it
 * did not carry the title we set in the report state, so each widget falls back to a title of its own.
 */
const WidgetTitle = ({
  format,
  fallback,
}: {
  format?: { title?: { text?: string; enabled?: boolean } };
  fallback: string;
}) =>
  format?.title?.enabled === false ? null : (
    <div style={{ color: v("heading"), fontWeight: 700, fontSize: 15, lineHeight: "20px", marginBottom: 8 }}>
      {format?.title?.text || fallback}
    </div>
  );

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
      <WidgetTitle format={props.format} fallback="Mandate diff: what the shopper signed against the cart" />
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <label style={{ fontSize: 13 }}>
          Dispute{" "}
          <select value={view.selected} onChange={(e) => setPicked(e.target.value)}>
            {view.disputes.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
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

const EVIDENCE_FIELDS = ["dispute", "disputeClass"] as const;

function EvidencePreview(props: AgWidgetParams<any>) {
  const items = EVIDENCE_FIELDS.map((k) => slot(props.dataMapping, k));
  const ids = items.map(idOf);
  const { rows: raw, error } = useRows(props, items);
  const [picked, setPicked] = useSelectedDispute();

  if (error) return <Status>{`Couldn't load the disputes: ${error}`}</Status>;
  if (!raw) return <Status>Loading the disputes…</Status>;
  const rows = raw.map((row: Record<string, unknown>) => {
    const [dispute = "", disputeClass = ""] = cells(row, ids).map((x) => String(x ?? ""));
    return { dispute, disputeClass };
  });
  if (rows.length === 0) return <NoData />;
  const current = rows.find((r: { dispute: string }) => r.dispute === picked) ?? rows[0];
  if (!current) return <NoData />;

  return (
    <div style={{ ...frame, display: "flex", flexDirection: "column", gap: 8 }}>
      <WidgetTitle format={props.format} fallback="Evidence preview: the attestation PDF" />
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
      </div>
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

  return (
    <div style={frame}>
      <WidgetTitle format={props.format} fallback="Agent platforms: overreach and conceded dollars" />
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
              <div style={{ fontSize: 13, lineHeight: "18px", color: v("textMuted") }}>
                {c.disputes} disputes
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
              <div style={{ fontSize: 12, lineHeight: "16px", color: v("textMuted") }}>overreach rate</div>
              <div style={{ fontSize: 13, lineHeight: "18px", marginTop: 6 }}>
                Conceded:{" "}
                <strong>${c.concededAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
              </div>
            </div>
          );
        })}
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
    },
    { dispute: "Dispute", disputeClass: "Class" },
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
