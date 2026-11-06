/**
 * Browser smoke test of /shop (#23, spec 0001): the page itself, which the unit tests can't reach.
 *
 *   pnpm smoke:shop                                  # http://localhost:3001, system Chrome
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
