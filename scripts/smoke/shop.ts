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

await step("'Let the agent fill in the limits' drafts but does not sign", async () => {
  await page.goto(`${SHOP}/shop`, { waitUntil: "networkidle" });
  await page.getByText("Key id").waitFor({ timeout: 30_000 });
  await page.locator("textarea").fill("I want white socks under $20 please");
  await page.getByRole("button", { name: /Let the agent fill in the limits/ }).click();
  await page.getByText(/filled in the limits below/).waitFor({ timeout: 30_000 });
  if (await page.getByText("Signed in your browser").count())
    throw new Error("the agent signed for the shopper");
  const price = await page.locator('input[inputmode="decimal"]').inputValue();
  if (price !== "20") throw new Error(`expected 20, got ${price}`);
});

await step("'Let the agent choose' proposes a cart and shows what it did", async () => {
  await freshIntent();
  await page.getByRole("button", { name: "Let the agent choose" }).click();
  await page.getByLabel("What the agent did").waitFor({ timeout: 90_000 });
  const trace = await page.getByLabel("What the agent did").innerText();
  if (!/Searched the store/.test(trace) || !/Proposed/.test(trace))
    throw new Error(`thin trace: ${trace.slice(0, 80)}`);
  await verdictBox(/Fits what you signed|please confirm/).waitFor({ timeout: 10_000 });
});

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nshop smoke test passed");
process.exitCode = failed ? 1 : 0;
