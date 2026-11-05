// Owner: @hoursgotviral-dev. Spec: docs/specs/0007-dashboard.md. AG Studio lands once the trial key is in.
import { generateSeedDisputes } from "../../src/seed-disputes";
import { HomeView } from "../HomeView";

// Seed disputes are relative to "now", so render per request instead of freezing them at build time.
export const dynamic = "force-dynamic";

export default function Home() {
  const now = new Date();
  return <HomeView disputes={generateSeedDisputes(now)} nowIso={now.toISOString()} />;
}
