// Capture the actual Studio adapter requests and answers for all three starters, using the running live stack.
// Credentials stay in the environment. Only hashes, validated replies and timing measurements are saved.
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { readReplay, replayPath, type ReplayFile } from "../../packages/ai/src/runtime";
import {
  J4_PROMPT_VERSION,
  J4_REPLAY,
  recordableAnswer,
  StudioAnswer,
  StudioTurn,
  studioReplayKey,
} from "../../packages/ai/src/studio";

const url = process.env.STUDIO_URL ?? "http://localhost:3002/analytics/studio";
const verifyReplay = process.argv.includes("--verify-replay");
const password = process.env.OPERATOR_PASSWORD;
if (!password) throw new Error("Set OPERATOR_PASSWORD in the environment for the running dashboard.");
if (!/^https?:\/\//.test(url)) throw new Error("STUDIO_URL must be an HTTP or HTTPS dashboard URL.");

const browser = await chromium.launch({
  headless: !process.env.HEADED,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
});
const context = await browser.newContext({
  httpCredentials: { username: "operator", password, origin: new URL(url).origin },
});
const entries: ReplayFile<StudioAnswer> = {};
const measurements: { label: string; elapsedMs: number; turns: number }[] = [];
const labels = ["Explain a defended dispute", "Draft a buyer reply", "What needs my attention?"];

try {
  for (const label of labels) {
    const page = await context.newPage();
    const pending: Promise<void>[] = [];
    let finalAnswer = false;
    let failure: Error | undefined;
    let turns = 0;
    page.on("response", (res) => {
      if (new URL(res.url()).pathname !== "/api/ai/studio" || res.request().method() !== "POST") return;
      pending.push(
        (async () => {
          const body: unknown = res.request().postDataJSON();
          const parsed = StudioTurn.safeParse(body);
          if (!parsed.success) return; // The tools are fetched again on replay and are never recorded as tool requests.
          if (!res.ok())
            throw new Error(`${label} returned HTTP ${res.status()}. Check live AI and operator access.`);
          const expectedMode = verifyReplay ? "replay" : "live";
          if (
            res.headers()["x-poi-ai-mode"] !== expectedMode ||
            res.headers()["x-poi-ai-prompt-version"] !== J4_PROMPT_VERSION
          )
            throw new Error(`The API must run ${expectedMode} mode with this checkout's J4 prompt version.`);
          const output = StudioAnswer.parse(await res.json());
          entries[studioReplayKey(parsed.data)] = { label, output: recordableAnswer(parsed.data, output) };
          turns++;
          if (!output.tool && output.text.trim()) finalAnswer = true;
        })().catch((error: unknown) => {
          failure = error instanceof Error ? error : new Error("Capture failed");
        }),
      );
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Ask the AI", exact: true }).click();
    const modeText = verifyReplay
      ? "Replay answers recorded questions"
      : "Ask about a dispute or ask for a buyer reply draft.";
    if (!(await page.getByText(modeText, { exact: false }).count()))
      throw new Error(
        `Set ${verifyReplay ? "replay" : "live"} mode on both the dashboard and API before running this command.`,
      );
    const started = Date.now();
    await page.getByText(label, { exact: true }).click();
    const deadline = started + 120_000;
    while (!finalAnswer && !failure && Date.now() < deadline) await page.waitForTimeout(100);
    await Promise.all(pending);
    if (failure) throw failure;
    if (!finalAnswer) throw new Error(`${label} did not finish within 120 seconds. Recordings were kept.`);
    measurements.push({ label, elapsedMs: Date.now() - started, turns });
    await page.close();
  }

  if (verifyReplay) {
    console.log("All three starters finished in replay mode. Recordings were kept.");
  } else {
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const report = [
      `# Studio starter capture for ${date}`,
      "",
      `Captured from ${new URL(url).origin}. Review every answer against the dispute facts before publishing.`,
      "",
      "| Starter | Elapsed ms | Adapter turns |",
      "| --- | ---: | ---: |",
      ...measurements.map((m) => `| ${m.label} | ${m.elapsedMs} | ${m.turns} |`),
      "",
      "Timings cover the browser's tool and turn requests. Repeat in replay mode against the same data before recording the video.",
      "",
    ].join("\n");
    writeFileSync(
      replayPath(J4_REPLAY),
      `${JSON.stringify({ ...readReplay(J4_REPLAY), ...entries }, null, 2)}\n`,
    );
    writeFileSync(new URL(`../../docs/evals/studio-${date}.md`, import.meta.url), report);
    console.log(
      `Captured all three starters (${Object.keys(entries).length} turns). Review the replay file and docs/evals/studio-${date}.md.`,
    );
  }
} finally {
  await browser.close();
}
