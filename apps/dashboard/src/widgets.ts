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
    id: "mandate-diff",
    name: "Mandate Diff",
    aiDescription:
      "Displays the shopper intent mandate alongside the merchant cart mandate, highlighting hard constraint violations and reason codes with an only-violations filter toggle.",
  },
  {
    id: "evidence-preview",
    name: "Evidence Preview",
    aiDescription:
      "Renders the drafted dispute attestation PDF and cover note for operator verification prior to PayPal submission.",
  },
  {
    id: "agent-platform",
    name: "Agent Platform Breakdown",
    aiDescription:
      "Summarizes orders, overreach rate, and conceded amounts categorized by autonomous buyer agent platform.",
  },
];
