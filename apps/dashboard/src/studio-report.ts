/**
 * The Studio report the Dispute Studio page opens with (docs/specs/0007): two pages, "disputes" and "queues". Plain data,
 * so a test can check what Studio is told. Everything reads the two tables defined in StudioView.
 */
/**
 * Page "disputes": four headline numbers, a donut of disputes by class (a click filters every widget), the agent
 * platform cards, the disputes grid (a click selects a dispute), and the mandate diff and evidence preview for the
 * selected dispute. Page "queues": a defend queue and a concede queue. Each widget's title is `enabled: true`, because
 * Studio draws a custom widget's title itself and only when it is enabled.
 */
/** A headline number: the sum of one column, titled. */
const kpi = (title: string, field: string) => ({
  type: "value",
  dataMapping: { value: [{ id: field, aggregation: "sum" }] },
  format: { title: { text: title, enabled: true } },
});

/** A filter on the copilot's decision column. */
const decisionFilter = (decision: string) => ({
  field: { id: "disputes.decision" },
  model: { operator: "equals", value: decision },
});

/**
 * One dispute grid per decision: the work to do (defend with evidence) and the refunds to issue (concede). A widget-level
 * filter on the decision (see `filter` on the page) narrows only that grid, so the page's other widgets are untouched.
 */
const queueGrid = (title: string) => ({
  type: "dispute-grid",
  dataMapping: {
    dispute: [{ id: "disputes.id" }],
    disputeClass: [{ id: "disputes.disputeClass" }],
    platform: [{ id: "disputes.agentPlatform" }],
    status: [{ id: "disputes.status" }],
    amount: [{ id: "disputes.amount" }],
    action: [{ id: "disputes.action" }],
    dueAt: [{ id: "disputes.dueAt" }],
    hoursToDue: [{ id: "disputes.hoursToDue" }],
  },
  format: { title: { text: title, enabled: true } },
});

export const initialState = {
  selectedPageId: "disputes",
  // The filters panel starts collapsed so it does not sit over the widgets on a narrower screen.
  panels: { filters: { collapsed: true } },
  pages: [
    {
      id: "disputes",
      layout: { columns: 12, rowHeight: 40 },
      widgets: {
        // Four headline numbers. Each is a plain sum of a 0/1 or dollar column, so it follows Studio's filters.
        kpiOpen: kpi("Open disputes", "disputes.open"),
        kpiDue: kpi("Due within 24 hours", "disputes.dueSoon"),
        kpiOverdue: kpi("Overdue", "disputes.overdue"),
        kpiAtStake: kpi("Dollars at stake", "disputes.atStake"),
        kpiConceded: kpi("Recommended to concede (agent overreach)", "disputes.conceded"),
        classes: {
          type: "donut-chart",
          dataMapping: {
            categoryKey: [{ id: "disputes.disputeClass" }],
            valueKey: [{ id: "disputes.id", aggregation: "count" }],
          },
          format: {
            title: { text: "Disputes by class (click a slice to filter everything)", enabled: true },
          },
        },
        platforms: {
          type: "agent-platform",
          dataMapping: {
            platform: [{ id: "disputes.agentPlatform" }],
            disputeClass: [{ id: "disputes.disputeClass" }],
            dispute: [{ id: "disputes.id" }],
            amount: [{ id: "disputes.amount" }],
          },
          format: { title: { text: "Agent platforms: overreach and conceded dollars", enabled: true } },
        },
        grid: {
          type: "dispute-grid",
          dataMapping: {
            dispute: [{ id: "disputes.id" }],
            disputeClass: [{ id: "disputes.disputeClass" }],
            platform: [{ id: "disputes.agentPlatform" }],
            status: [{ id: "disputes.status" }],
            amount: [{ id: "disputes.amount" }],
            action: [{ id: "disputes.action" }],
            dueAt: [{ id: "disputes.dueAt" }],
            hoursToDue: [{ id: "disputes.hoursToDue" }],
          },
          format: { title: { text: "Disputes: pick one to see its limits and evidence", enabled: true } },
        },
        diff: {
          type: "mandate-diff",
          dataMapping: {
            dispute: [{ id: "checks.dispute" }],
            check: [{ id: "checks.check" }],
            mandateRule: [{ id: "checks.mandateRule" }],
            cartActual: [{ id: "checks.cartActual" }],
            status: [{ id: "checks.status" }],
            reasonCode: [{ id: "checks.reasonCode" }],
          },
          format: {
            title: { text: "Mandate diff: what the shopper signed against the cart", enabled: true },
          },
        },
        evidence: {
          type: "evidence-preview",
          dataMapping: {
            dispute: [{ id: "disputes.id" }],
            disputeClass: [{ id: "disputes.disputeClass" }],
            coverNote: [{ id: "disputes.coverNote" }],
          },
          format: { title: { text: "Evidence preview: the attestation PDF", enabled: true } },
        },
      },
      widgetLayout: {
        kpiOpen: { xTrack: 0, yTrack: 0, xSpan: 2, ySpan: 3 },
        kpiDue: { xTrack: 2, yTrack: 0, xSpan: 2, ySpan: 3 },
        kpiOverdue: { xTrack: 4, yTrack: 0, xSpan: 2, ySpan: 3 },
        kpiAtStake: { xTrack: 6, yTrack: 0, xSpan: 3, ySpan: 3 },
        kpiConceded: { xTrack: 9, yTrack: 0, xSpan: 3, ySpan: 3 },
        classes: { xTrack: 0, yTrack: 3, xSpan: 4, ySpan: 7 },
        platforms: { xTrack: 4, yTrack: 3, xSpan: 8, ySpan: 7 },
        grid: { xTrack: 0, yTrack: 10, xSpan: 12, ySpan: 9 },
        diff: { xTrack: 0, yTrack: 19, xSpan: 7, ySpan: 10 },
        evidence: { xTrack: 7, yTrack: 19, xSpan: 5, ySpan: 10 },
      },
    },
    {
      id: "queues",
      layout: { columns: 12, rowHeight: 40 },
      widgets: {
        defendQueue: queueGrid("Defend queue: the evidence to send"),
        concedeQueue: queueGrid("Concede queue: the refunds to issue"),
        diff: {
          type: "mandate-diff",
          dataMapping: {
            dispute: [{ id: "checks.dispute" }],
            check: [{ id: "checks.check" }],
            mandateRule: [{ id: "checks.mandateRule" }],
            cartActual: [{ id: "checks.cartActual" }],
            status: [{ id: "checks.status" }],
            reasonCode: [{ id: "checks.reasonCode" }],
          },
          format: {
            title: { text: "Mandate diff: what the shopper signed against the cart", enabled: true },
          },
        },
      },
      widgetLayout: {
        defendQueue: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 9 },
        concedeQueue: { xTrack: 0, yTrack: 9, xSpan: 12, ySpan: 8 },
        diff: { xTrack: 0, yTrack: 17, xSpan: 12, ySpan: 10 },
      },
      filter: {
        widget: {
          defendQueue: [decisionFilter("defend")],
          concedeQueue: [decisionFilter("concede")],
        },
      },
    },
  ],
};
