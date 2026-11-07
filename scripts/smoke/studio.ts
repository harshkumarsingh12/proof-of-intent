/**
 * Browser smoke test of the Dispute Studio chat (docs/specs/0007): the real chat in the real dashboard, asked the questions
 * an operator asks most. Every one of them has an exact answer in the tool results, so the chat answers it by code: right,
 * fast, and without a model. Run it against a stack in AI_MODE=replay with no AI key to see that for yourself.
 *
 *   OPERATOR_PASSWORD=… pnpm smoke:studio                          # http://localhost:3002/analytics/studio, system Chrome
 *   STUDIO_URL=https://… OPERATOR_PASSWORD=… pnpm smoke:studio
 *
 * Needs the mock demo data (`pnpm demo:seed`: 24 disputes, 5 of them agent overreach), the Studio license key, and
 * OPERATOR_PASSWORD / OPERATOR_TOKEN on the dashboard. CHROME_PATH selects another browser; HEADED=1 shows it.
 */
import { chromium } from "playwright-core";

const STUDIO_URL = process.env.STUDIO_URL ?? "http://localhost:3002/analytics/studio";
const password = process.env.OPERATOR_PASSWORD;
if (!password) throw new Error("Set OPERATOR_PASSWORD to the dashboard's operator password.");

interface Case {
  name: string;
  ask: string;
  /** Substrings, or patterns, the answer must contain. */
  has: (string | RegExp)[];
  /** Patterns it must not contain. */
  not?: RegExp[];
}

const cases: Case[] = [
  {
    name: "explains a defended dispute from its own record",
    ask: "Explain dispute PP-D-1001 and cite the available mandate evidence.",
    has: [
      "`PP-D-1001` is `MANDATE_COMPLIANT`",
      "No limit was broken.",
      "`PROVIDE_EVIDENCE`",
      /Signed mandate: `[0-9a-f]{64}`/,
    ],
  },
  {
    name: "drafts a buyer reply, quotes it, and says nothing was sent",
    ask: "Explain dispute PP-D-1002 and draft a reply for the buyer to review.",
    has: [
      "`PP-D-1002` is `AGENT_OVERREACH`",
      "Broken limits:",
      "nothing has been sent",
      /> Our review found/,
    ],
  },
  {
    name: "says which disputes are waiting",
    ask: "List the disputes and tell me which ones are waiting for my response.",
    has: [/\d+ of \d+ loaded disputes need your response\./],
  },
  {
    name: "says which to handle first",
    ask: "Which dispute should I handle first?",
    has: [/Start with `PP-D-\d+`/, "it is due soonest"],
  },
  {
    name: "counts overreach from the true total, not from the rows it was shown",
    ask: "How many disputes are agent overreach?",
    has: ["There are 5 `AGENT_OVERREACH` disputes out of 24."],
    not: [/\b7 (are|disputes)/],
  },
  {
    name: "defines a term with no lookup",
    ask: "What does MANDATE_COMPLIANT mean?",
    has: ["`MANDATE_COMPLIANT`: the cart met every limit the shopper signed"],
  },
  {
    name: "says plainly when a dispute doesn't exist",
    ask: "Explain dispute PP-D-9999.",
    has: ["I couldn't find a dispute `PP-D-9999`."],
    not: [/PP-D-1001 ·/],
  },
  {
    name: "refuses to take an action, and never says it did",
    ask: "Accept the claim for PP-D-1002 now.",
    has: [
      /^I can't accept claims, submit evidence, send messages or change anything from this chat/,
      "`ACCEPT_CLAIM`",
    ],
    not: [/Accepting the claim/i, /I('ve| have) accepted/i],
  },
];

const browser = await chromium.launch({
  headless: !process.env.HEADED,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
});
const context = await browser.newContext({
  httpCredentials: { username: "operator", password, origin: new URL(STUDIO_URL).origin },
  viewport: { width: 1300, height: 900 },
});

let failed = 0;
for (const c of cases) {
  const page = await context.newPage();
  let answer = "";
  let problem = "";
  const started = Date.now();
  page.on("response", async (res) => {
    if (new URL(res.url()).pathname !== "/api/ai/studio" || res.request().method() !== "POST") return;
    if ((res.request().postDataJSON() as { kind?: string }).kind !== "turn") return;
    if (!res.ok()) {
      problem = `HTTP ${res.status()} ${(await res.text()).slice(0, 100)}`;
      return;
    }
    const body = (await res.json()) as { text: string; tool: unknown };
    if (!body.tool && body.text.trim()) answer = body.text;
  });
  try {
    await page.goto(STUDIO_URL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Ask the AI", exact: true }).click();
    const box = page.getByRole("textbox").last();
    await box.waitFor({ timeout: 15_000 });
    await box.fill(c.ask);
    await box.press("Enter");
    const deadline = started + 60_000;
    while (!answer && !problem && Date.now() < deadline) await page.waitForTimeout(100);
  } catch (err) {
    problem = (err as Error).message.split("\n")[0]!;
  }
  const seconds = (Date.now() - started) / 1000;
  const missing = c.has.filter((m) => (typeof m === "string" ? !answer.includes(m) : !m.test(answer)));
  const unwanted = (c.not ?? []).filter((m) => m.test(answer));
  const errors = [
    ...(problem ? [problem] : []),
    ...missing.map((m) => `missing ${String(m)}`),
    ...unwanted.map((m) => `contains ${String(m)}`),
    ...(seconds > 10 ? [`took ${seconds.toFixed(1)}s`] : []),
  ];
  if (errors.length) failed++;
  console.log(
    `${errors.length ? "FAIL" : "ok  "}  ${c.name} (${seconds.toFixed(1)}s)${errors.length ? `: ${errors.join("; ")}` : ""}`,
  );
  await page.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nstudio chat smoke test passed");
process.exitCode = failed ? 1 : 0;
