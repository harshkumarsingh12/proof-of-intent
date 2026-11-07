/**
 * AG Studio custom widgets. Owner: @hoursgotviral-dev. Spec: docs/specs/0007-dashboard.md.
 * Registered widgets with AI descriptions for the studio agent harness.
 */
export interface StudioWidget {
  id: string;
  name: string;
  aiDescription: string;
}

export const widgets: StudioWidget[] = [
  {
    id: "dispute-grid",
    name: "Disputes",
    aiDescription:
      "An AG Grid of every dispute with its copilot class, platform, status, amount, recommended action and time left to respond. Clicking a row selects that dispute for the mandate diff and evidence preview, and the grid filters and exports to CSV.",
  },
  {
    id: "mandate-diff",
    name: "Mandate Diff",
    aiDescription:
      "Displays the shopper intent mandate alongside the merchant cart mandate, highlighting hard constraint violations and reason codes with an only-violations filter toggle.",
  },
  {
    id: "evidence-preview",
    name: "Evidence Preview",
    aiDescription:
      "Renders the drafted dispute attestation PDF with its cover note for operator verification prior to PayPal submission, with a link to the full dispute.",
  },
  {
    id: "agent-platform",
    name: "Agent Platform Breakdown",
    aiDescription:
      "Summarizes orders, overreach rate, and conceded amounts categorized by autonomous buyer agent platform.",
  },
];
