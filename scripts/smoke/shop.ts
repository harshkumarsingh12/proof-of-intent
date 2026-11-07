/**
 * Browser smoke test of /shop (#23, spec 0001): the page itself, which the unit tests can't reach.
 *
 *   pnpm smoke:shop                                  # http://localhost:3001, system Chrome (also saves a mock wallet
 *                                                    and lets the agent pay alone)
 *   SHOP_URL=https://poi-buyer.iotkiit.in pnpm smoke:shop   # hosted shop; stops at the PayPal step
 *
 * Needs the stack running in PAYPAL_MODE=mock and AI_MODE=replay (docker compose up, or pnpm dev:api and
 * pnpm dev:buyer with OPERATOR_TOKEN set so the shop registers its agent key). It never types a credential.
 * CHROME_PATH selects another browser binary; set HEADED=1 to watch it.
 */
import { chromium, type Page } from "playwright-core";

const SHOP = (process.env.SHOP_URL ?? "http://localhost:3001").replace(/\/$/, "");
const hosted = !/localhost|127\.0\.0\.1/.test(SHOP);

let failed = 0;
const step = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}: ${(err as Error).message.split("\n")[0]}`);
  }
};

const browser = await chromium.launch({
  headless: !process.env.HEADED,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
});
const page: Page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const verdictBox = (re: RegExp) => page.locator(".verdict", { hasText: re }).first();
const cart = (price: string, color: string) =>
  page.locator(".product", { hasText: price }).filter({ hasText: color }).first();

async function freshIntent() {
  await page.goto(`${SHOP}/shop`, { waitUntil: "networkidle" });
  await page.getByText("Key id").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Sign my intent" }).click();
  await page.getByText("Signed in your browser").waitFor({ timeout: 20_000 });
}

await step("the browser makes a non-extractable key and signs an intent", async () => {
  await freshIntent();
  // Read the stored CryptoKey back: it must be ECDSA P-256 and refuse to be exported (spec 0001 criterion 6).
  const stored = await page.evaluate(
    () =>
      new Promise<{ extractable: boolean; algorithm: string; curve: string; canExport: boolean }>(
        (resolve, reject) => {
          const open = indexedDB.open("poi-shopper", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const get = open.result.transaction("keys").objectStore("keys").get("current");
            get.onerror = () => reject(get.error);
            get.onsuccess = async () => {
              const priv = (get.result?.key?.privateKey ?? get.result?.privateKey) as CryptoKey | undefined;
              if (!priv) return reject(new Error("no private key in IndexedDB"));
              const canExport = await crypto.subtle.exportKey("jwk", priv).then(
                () => true,
                () => false,
              );
              const alg = priv.algorithm as EcKeyAlgorithm;
              resolve({
                extractable: priv.extractable,
                algorithm: alg.name,
                curve: alg.namedCurve,
                canExport,
              });
            };
          };
        },
      ),
  );
  if (stored.extractable || stored.canExport) throw new Error("the shopper's private key can be exported");
  if (stored.algorithm !== "ECDSA" || stored.curve !== "P-256")
    throw new Error(`wrong key type ${stored.algorithm}/${stored.curve}`);
});

await step("the red $95 jacket is refused with the reason codes and no PayPal order", async () => {
  await cart("$95.00", "red").getByRole("button", { name: "Propose this cart" }).click();
  const box = verdictBox(/Refused/);
  await box.waitFor({ timeout: 60_000 });
  const text = await box.innerText();
  for (const code of ["AMOUNT_EXCEEDS_MAX", "ATTRIBUTE_MISMATCH"]) {
    if (!text.includes(code)) throw new Error(`missing ${code}`);
  }
  if (!/No PayPal order was created/.test(text)) throw new Error("did not say no order was created");
  if (/Order\s+ord_/.test(text)) throw new Error("an order id is shown for a refused cart");
});

await step("the refusal says what would have fit, and its button only refills the limits", async () => {
  const box = verdictBox(/Refused/);
  const text = await box.innerText();
  if (!/comes in red/.test(text) || !/already fits what you signed/.test(text))
    throw new Error("no near-miss text in the refusal");
  await box.getByRole("button", { name: /Set limits for running jackets/ }).click();
  // Nothing was signed or bought: the signed intent and the verdict are gone and the form holds the new limits.
  await page.getByRole("button", { name: "Sign my intent" }).waitFor({ timeout: 10_000 });
  if (await verdictBox(/Refused/).count()) throw new Error("the refusal is still showing");
  const color = await page.getByLabel(/color/i).first().inputValue();
  if (color !== "red") throw new Error(`the form color is ${color}, not red`);
  await freshIntent(); // back to the default limits for the steps below
});

await step("the red $95 jacket is refused again under the fresh limits", async () => {
  await cart("$95.00", "red").getByRole("button", { name: "Propose this cart" }).click();
  await verdictBox(/Refused/).waitFor({ timeout: 60_000 });
});

await step("the grey $74 jacket is approved by the merchant", async () => {
  await cart("$74.00", "grey").getByRole("button", { name: "Propose this cart" }).click();
  await verdictBox(/Fits what you signed/).waitFor({ timeout: 60_000 });
});

if (!hosted) {
  await step("mock PayPal approval captures the order", async () => {
    await page.getByRole("button", { name: /Approve with PayPal \(mock\)/ }).click();
    await page.getByText(/Capture\s+\S+/).waitFor({ timeout: 60_000 });
    if (!(await page.getByRole("heading", { name: "Paid" }).count())) throw new Error("no Paid heading");
  });
}

if (!hosted) {
  // #17, #36: save a wallet (mock PayPal sends the shopper straight back), then the agent pays with nobody asked.
  await step("saving a PayPal wallet comes back to the shop with the wallet saved", async () => {
    await page.goto(`${SHOP}/shop`, { waitUntil: "networkidle" });
    await page.getByText("Key id").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Save a PayPal wallet" }).click();
    await page.getByRole("heading", { name: "Wallet saved" }).waitFor({ timeout: 30_000 });
    await page.getByRole("link", { name: "Back to the shop" }).click();
    await page.getByText(/A PayPal wallet is saved for this key/).waitFor({ timeout: 30_000 });
  });

  await step("the agent pays alone: no PayPal step, the capture is shown", async () => {
    await page.getByRole("button", { name: "Sign my intent" }).click();
    await page.getByText("Signed in your browser").waitFor({ timeout: 20_000 });
    await page.getByLabel(/Let the agent pay alone/).check();
    await cart("$74.00", "grey").getByRole("button", { name: "Propose this cart" }).click();
    await verdictBox(/your agent paid/).waitFor({ timeout: 60_000 });
    await page.getByRole("heading", { name: "Paid by your agent" }).waitFor({ timeout: 10_000 });
    if (!(await page.getByText(/Capture\s+\S+/).count())) throw new Error("no capture shown");
    if (await page.getByRole("button", { name: /Approve with PayPal/ }).count())
      throw new Error("asked the shopper to approve a cart the agent paid alone");
  });

  await step(
    "the agent paying alone is still refused for the red $95 jacket, with nothing charged",
    async () => {
      await cart("$95.00", "red").getByRole("button", { name: "Propose this cart" }).click();
      const box = verdictBox(/Refused/);
      await box.waitFor({ timeout: 60_000 });
      const text = await box.innerText();
      if (!text.includes("AMOUNT_EXCEEDS_MAX")) throw new Error("missing AMOUNT_EXCEEDS_MAX");
      if (/Order\s+ord_/.test(text)) throw new Error("an order id is shown for a refused cart");
      if (await page.getByRole("heading", { name: "Paid by your agent" }).count())
        throw new Error("still showing the earlier payment as this cart's");
    },
  );

  await step(
    "'Let the agent choose' while paying alone settles on one cart: paid, or held for the shopper",
    async () => {
      await page.getByRole("button", { name: "Let the agent choose" }).click();
      await verdictBox(/your agent paid|Fits your limits, but please confirm/).waitFor({ timeout: 90_000 });
      const trace = await page.getByLabel("What the agent did").innerText();
      const accepted = (trace.match(/The merchant (approved|wants you to confirm) it/g) ?? []).length;
      if (accepted !== 1)
        throw new Error(`expected exactly one accepted cart, got ${accepted}: ${trace.slice(0, 200)}`);
      const paid = (await page.getByRole("heading", { name: "Paid by your agent" }).count()) > 0;
      const held = /wants you to confirm it/.test(trace);
      // A step-up with nobody present charges nothing and creates no PayPal order.
      if (paid === held) throw new Error(`paid=${paid} but held=${held}`);
      if (held && !(await page.getByText(/Nothing was charged and no PayPal order exists/).count()))
        throw new Error("a held cart didn't say nothing was charged");
    },
  );

  // #36: a cart the merchant isn't sure about is held for the shopper, who approves it in the shop (no link needed).
  await step(
    "a held cart waits in the shop, and approving it signs and charges the saved wallet",
    async () => {
      await cart("$79.00", "grey").getByRole("button", { name: "Propose this cart" }).click();
      await verdictBox(/Fits your limits, but please confirm/).waitFor({ timeout: 60_000 });
      if (await page.getByRole("heading", { name: "Paid by your agent" }).count())
        throw new Error("a held cart was charged");
      await page.getByRole("heading", { name: "Waiting for your approval" }).waitFor({ timeout: 30_000 });
      const held = page.locator(".verdict.warn", { hasText: "$79.00" }).first();
      await held.getByRole("button", { name: /Approve and pay from my wallet/ }).click();
      await page
        .locator(".panel", { hasText: "Waiting for your approval" })
        .getByRole("heading", { name: "Paid" })
        .waitFor({ timeout: 30_000 });
      const text = await page.locator(".panel", { hasText: "Waiting for your approval" }).innerText();
      if (!/Capture\s+\S+/.test(text)) throw new Error("no capture shown after approving");
    },
  );

  await step(
    "removing the wallet turns agent-alone off, and the agent can't charge it any more",
    async () => {
      await page.getByRole("button", { name: "Remove my wallet" }).click();
      await page.getByRole("button", { name: "Save a PayPal wallet" }).waitFor({ timeout: 30_000 });
      if (await page.getByLabel(/Let the agent pay alone/).isEnabled())
        throw new Error("agent-alone is still on offer");
      if (await page.getByText(/A PayPal wallet is saved for this key/).count())
        throw new Error("still says a wallet is saved");
      // Reloading asks the merchant again: the wallet really is gone, not just hidden.
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Key id").waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Save a PayPal wallet" }).waitFor({ timeout: 30_000 });
    },
  );
}

await step("the button and the Enter key fill in the limits from the words, and neither signs", async () => {
  await page.goto(`${SHOP}/shop`, { waitUntil: "networkidle" });
  await page.getByText("Key id").waitFor({ timeout: 30_000 });
  await page.locator("textarea").fill("I want white socks under $20 please");
  await page.getByRole("button", { name: "Fill in the limits from my words" }).click();
  await page.getByText(/filled in the limits below/).waitFor({ timeout: 30_000 });
  if (await page.getByText("Signed in your browser").count())
    throw new Error("the agent signed for the shopper");
  const price = await page.locator('input[inputmode="decimal"]').inputValue();
  if (price !== "20") throw new Error(`expected 20, got ${price}`);

  // Enter does the same (Shift+Enter would be a new line), and the shopper's edit is then replaced by the new words.
  await page.locator("textarea").fill("a grey running jacket under $55");
  await page.locator("textarea").press("Enter");
  await page.waitForFunction(
    () => (document.querySelector("input[inputmode=decimal]") as HTMLInputElement | null)?.value === "55",
    undefined,
    { timeout: 30_000 },
  );
  if (await page.getByText("Signed in your browser").count()) throw new Error("Enter signed for the shopper");
});

await step(
  "quick start loads a preset, a category alone changes only the category, and item and color can be 'Anything'",
  async () => {
    await page.goto(`${SHOP}/shop`, { waitUntil: "networkidle" });
    await page.getByText("Key id").waitFor({ timeout: 30_000 });
    const price = () => page.locator('input[inputmode="decimal"]').inputValue();
    await page.getByRole("button", { name: "Running socks" }).click();
    if ((await price()) !== "20") throw new Error(`quick start should load the socks cap, got ${await price()}`);
    if ((await page.getByLabel("Color").inputValue()) !== "white") throw new Error("quick start should load white");

    // Picking a category on its own leaves the price and color alone.
    await page.getByLabel("Category").selectOption("running-shoe");
    if ((await price()) !== "20") throw new Error("picking a category changed the price");
    if ((await page.getByLabel("Color").inputValue()) !== "white") throw new Error("picking a category changed the color");

    // Leave item and color open and sign: the price cap is still there.
    await page.getByLabel("Category").selectOption({ label: "Anything" });
    await page.getByLabel("Color").selectOption({ label: "Any color" });
    await page.getByRole("button", { name: "Sign my intent" }).click();
    await page.getByText("Signed in your browser").waitFor({ timeout: 20_000 });
    await page.getByRole("heading", { name: "All products" }).waitFor({ timeout: 5_000 });
    if ((await page.locator(".product").count()) < 12) throw new Error("an open item should show the whole store");
  },
);

await step("'Let the agent choose' proposes a cart and shows what it did", async () => {
  await freshIntent();
  await page.getByRole("button", { name: "Let the agent choose" }).click();
  await page.getByLabel("What the agent did").waitFor({ timeout: 90_000 });
  const trace = await page.getByLabel("What the agent did").innerText();
  if (!/Searched the store/.test(trace) || !/Proposed/.test(trace))
    throw new Error(`thin trace: ${trace.slice(0, 80)}`);
  await verdictBox(/Fits what you signed|please confirm/).waitFor({ timeout: 10_000 });
});

await step("what the words don't say stays open, and a missing price gets a proposed cap", async () => {
  await page.goto(`${SHOP}/shop`, { waitUntil: "networkidle" });
  await page.getByText("Key id").waitFor({ timeout: 30_000 });
  const price = () => page.locator('input[inputmode="decimal"]').inputValue();
  await page.locator("textarea").fill("something grey under $70");
  await page.getByRole("button", { name: /Fill in the limits/ }).click();
  await page.getByText(/filled in the limits below/).waitFor({ timeout: 30_000 });
  if ((await price()) !== "70") throw new Error(`expected 70, got ${await price()}`);
  if ((await page.getByLabel("Color").inputValue()) !== "grey") throw new Error("the color was not filled in");
  if ((await page.getByLabel("Category").inputValue()) !== "") throw new Error("an item nobody named was guessed");
  if (await page.getByText(/proposed a cap/).count()) throw new Error("a stated price was called a proposal");

  await page.locator("textarea").fill("a running jacket");
  await page.getByRole("button", { name: /Fill in the limits/ }).click();
  await page.getByText(/proposed a cap of \$80/).waitFor({ timeout: 30_000 });
  if ((await price()) !== "80") throw new Error(`expected the jacket's usual cap 80, got ${await price()}`);
  if ((await page.getByLabel("Color").inputValue()) !== "") throw new Error("a color nobody named was guessed");
  if (await page.getByText("Signed in your browser").count()) throw new Error("the agent signed for the shopper");
});

// Voice ordering (spec 0010). Headless Chrome can't recognize speech, so a fake SpeechRecognition is installed before the
// page loads and says whatever the test queues. Needs the shop started with BUYER_VOICE=1; run with VOICE=1.
if (process.env.VOICE === "1") {
  // Plain JavaScript on purpose: a function would be serialized after tsx has rewritten it with helpers (__name) that
  // don't exist in the page.
  const installFakeSpeech = `
    (() => {
      const said = [];
      window.__said = said;
      class FakeRecognition {
        constructor() { this.lang = ""; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1; this.onresult = null; this.onerror = null; this.onend = null; }
        start() {
          setTimeout(() => {
            const text = said.shift();
            if (text === undefined) { if (this.onerror) this.onerror({ error: "no-speech" }); }
            else if (this.onresult) this.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } } });
            if (this.onend) this.onend();
          }, 30);
        }
        stop() {}
        abort() {}
      }
      window.SpeechRecognition = FakeRecognition;
      window.webkitSpeechRecognition = FakeRecognition;
    })();
  `;
  const say = (p: Page, text: string) =>
    p.evaluate((t) => (window as unknown as { __said: string[] }).__said.push(t), text);
  // Headless Chrome ships a real recognizer, so "no support" has to remove it explicitly.
  const removeSpeech = `
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"])
      Object.defineProperty(window, name, { value: undefined, configurable: true });
  `;
  const voiceShop = async (fake: boolean) => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await context.newPage();
    await p.addInitScript({ content: fake ? installFakeSpeech : removeSpeech });
    await p.goto(`${SHOP}/shop`, { waitUntil: "networkidle" });
    await p.getByText("Key id").waitFor({ timeout: 30_000 });
    return p;
  };
  const speak = (p: Page) => p.getByRole("button", { name: "Speak your request" }).click();
  const signedBanner = (p: Page) => p.getByText("Signed in your browser");
  const aloneChecked = (p: Page) => p.getByLabel(/Let the agent pay alone/).isChecked();
  const priceBox = (p: Page) => p.getByLabel("Spend at most (USD)");
  const filledNote = (p: Page) => p.getByText(/filled in the limits below/);

  await step(
    "voice: a spoken request fills the box and the limits, with no confirmation, and signs nothing",
    async () => {
      const p = await voiceShop(true);
      // A request that happens to contain "confirm" is only text: it fills the form like any other.
      await say(p, "buy a grey running jacket under $80 and confirm");
      await speak(p);
      await filledNote(p).waitFor({ timeout: 30_000 });
      if ((await p.locator("textarea").inputValue()) !== "buy a grey running jacket under $80 and confirm")
        throw new Error("the transcript did not fill the box");
      if ((await priceBox(p).inputValue()) !== "80") throw new Error("the limits were not filled in from the words");
      if (await p.getByRole("region", { name: "Check before signing" }).count())
        throw new Error("a read-back card is still asking for confirmation");
      await p.waitForTimeout(1_500); // long enough that anything that could sign by itself would have
      if (await signedBanner(p).count()) throw new Error("a spoken request signed by itself");
      if (await aloneChecked(p)) throw new Error("voice ticked 'agent pays alone'");
      await p.context().close();
    },
  );

  await step("voice: speaking again replaces the limits, and the shopper can edit them and sign", async () => {
    const p = await voiceShop(true);
    await say(p, "a grey running jacket under $80");
    await speak(p);
    await filledNote(p).waitFor({ timeout: 30_000 });
    if ((await priceBox(p).inputValue()) !== "80") throw new Error("first fill missing");
    await say(p, "a grey running jacket under $60");
    await speak(p);
    await p.waitForFunction(
      () => (document.querySelector("input[inputmode=decimal]") as HTMLInputElement | null)?.value === "60",
      undefined,
      { timeout: 30_000 },
    );
    await priceBox(p).fill("65"); // the shopper edits what was filled in
    await p.getByRole("button", { name: "Sign my intent" }).click();
    await signedBanner(p).waitFor({ timeout: 20_000 });
    if (await aloneChecked(p)) throw new Error("voice ticked 'agent pays alone'");
    await p.context().close();
  });

  await step(
    "voice: without speech recognition the microphone is hidden and typing still works",
    async () => {
      const p = await voiceShop(false);
      if (await p.getByRole("button", { name: "Speak your request" }).count())
        throw new Error("the mic shows without support");
      await p.getByText(/Voice input isn.t available in this browser/).waitFor({ timeout: 10_000 });
      await p.getByRole("button", { name: "Sign my intent" }).click();
      await signedBanner(p).waitFor({ timeout: 20_000 });
      await p.context().close();
    },
  );
}

// The shop assistant (spec 0010). Needs the shop started with BUYER_CHAT=1; run with CHAT=1. In replay mode its answers
// come straight from the store's data, so they are exact.
if (process.env.CHAT === "1") {
  const assistant = () => page.getByRole("region", { name: "Shop assistant" });
  const askAssistant = async (question: string) => {
    await assistant().getByLabel("Your question").fill(question);
    await assistant().getByRole("button", { name: "Ask", exact: true }).click();
  };

  await step(
    "chat: a store question is answered from the store's data, and the chat has no way to buy",
    async () => {
      await page.goto(`${SHOP}/shop`, { waitUntil: "networkidle" });
      await page.getByText("Key id").waitFor({ timeout: 30_000 });
      await assistant().getByRole("button", { name: "Ask a question" }).click();
      await askAssistant("show me grey running jackets under $80");
      await assistant()
        .getByText("Stride Running Jacket, grey, $74.00 (JKT-GRY-M)")
        .waitFor({ timeout: 30_000 });
      const text = await assistant().innerText();
      if (/\$95|red/i.test(text.replace(/Straight from the store.s data\./g, "")))
        throw new Error("a red or $95 product leaked into the answer");
      // Everything the chat offers: no propose, buy, pay or sign button inside it, only "Use these limits".
      const buttons = await assistant().getByRole("button").allInnerTexts();
      for (const label of buttons)
        if (/propose|buy|pay|sign|approve/i.test(label))
          throw new Error(`the chat offers an action: "${label}"`);
      if (!buttons.some((b) => /Use these limits/.test(b)))
        throw new Error("no Use these limits offered for a full request");
      if (await page.getByText("Signed in your browser").count()) throw new Error("asking signed something");
    },
  );

  await step("chat: 'Use these limits' fills the form and signs nothing", async () => {
    await assistant().getByRole("button", { name: "Use these limits" }).first().click();
    const description = await page.locator("textarea").inputValue();
    if (!/grey running jacket under \$80/i.test(description))
      throw new Error(`the form says "${description}"`);
    if ((await page.locator('input[inputmode="decimal"]').inputValue()) !== "80")
      throw new Error("the price limit isn't 80");
    if (await page.getByText("Signed in your browser").count()) throw new Error("filling the form signed it");
  });

  await step("chat: after the merchant refuses a cart, it explains why in the shop's words", async () => {
    await freshIntent();
    await cart("$95.00", "red").getByRole("button", { name: "Propose this cart" }).click();
    await verdictBox(/Refused/).waitFor({ timeout: 60_000 });
    await assistant().getByRole("button", { name: "Ask a question" }).click();
    await assistant().getByRole("button", { name: "Why was my cart refused or held?" }).click();
    await assistant()
      .getByText(/no PayPal order was created and nothing was charged/)
      .waitFor({ timeout: 30_000 });
    const text = await assistant().innerText();
    for (const line of ["It costs more than your limit (AMOUNT_EXCEEDS_MAX)", "(ATTRIBUTE_MISMATCH)"])
      if (!text.includes(line)) throw new Error(`the explanation is missing "${line}"`);
  });

  await step("chat: a pasted token is refused with a reason, not answered", async () => {
    await askAssistant("my key is nvapi-AbCdEf0123456789xyz why does it fail");
    await assistant()
      .getByText(/Don.t paste those here/)
      .waitFor({ timeout: 10_000 });
  });
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nshop smoke test passed");
process.exitCode = failed ? 1 : 0;
