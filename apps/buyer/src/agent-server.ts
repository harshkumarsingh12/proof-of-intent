/**
 * The buyer agent's server side. Owner: @srshriv. Spec: docs/specs/0003-checkout-and-verification.md.
 *
 * It holds the **agent's** key (never the shopper's, never PayPal's) and does what an AP2 agent does: take the
 * shopper's signed intent, propose a cart, sign a Payment Mandate over both, and send them to the merchant.
 * Which item to propose is either the shopper's pick (`agentCheckout`) or the agent's own choice
 * (`agentChoose`, src/agent.ts, #37); the merchant's verdict is the authority either way.
 *
 * Env: API_INTERNAL_URL (merchant API), MERCHANT_ID, AGENT_SIGNING_KEY (PKCS#8 PEM from `pnpm keys:gen`,
 * `\n` escaped), AGENT_PLATFORM (default "Northstar"). With OPERATOR_TOKEN set, the agent registers its own key
 * on first use, which is how local and demo stacks work with no setup; otherwise register it once with
 * `POST /keys/agent`. Without AGENT_SIGNING_KEY a fresh key is made per process (fine locally, not for a server
 * that restarts: each restart registers a new agent key).
 */
import { randomUUID } from "node:crypto";
import { CheckoutResponse, IntentMandate } from "@poi/contracts";
import { generateSigningKeyPair, keyIdFor, publicEs256Jwk, signMandate } from "@poi/mandates";
import { exportJWK, importPKCS8, type JWK } from "jose";
import { parseAgentMode, runChoose, runDraft, type ChooseResult, type DraftResult } from "./agent";
import { paymentMandate, proposeCart, type Merchant } from "./cart";

export const apiBase = (): string =>
  (process.env.API_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const merchantFromEnv = (): Merchant => ({
  id: process.env.MERCHANT_ID ?? "merchant-trailhead",
  name: "Trailhead Outfitters",
});

interface Agent {
  kid: string;
  platform: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

let agent: Promise<Agent> | undefined;

async function loadAgent(): Promise<Agent> {
  const pem = process.env.AGENT_SIGNING_KEY?.replace(/\\n/g, "\n").trim();
  let privateKey: CryptoKey;
  let publicJwk: JWK;
  if (pem) {
    const extractable = (await importPKCS8(pem, "ES256", { extractable: true })) as CryptoKey;
    const { d: _private, ...publicPart } = await exportJWK(extractable);
    publicJwk = publicEs256Jwk(publicPart);
    privateKey = (await importPKCS8(pem, "ES256")) as CryptoKey;
  } else {
    const pair = await generateSigningKeyPair();
    privateKey = pair.privateKey as CryptoKey;
    publicJwk = publicEs256Jwk(await exportJWK(pair.publicKey));
  }
  const platform = process.env.AGENT_PLATFORM?.trim() || "Northstar";
  const kid = await keyIdFor("agt", publicJwk);
  const token = process.env.OPERATOR_TOKEN;
  if (token) {
    const res = await fetch(`${apiBase()}/keys/agent`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ public_jwk: publicJwk, platform }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`registering the agent key failed: ${res.status} ${await res.text()}`);
  }
  return { kid, platform, privateKey, publicJwk };
}

/** One agent per process; a failed load is retried on the next request. */
function getAgent(): Promise<Agent> {
  agent ??= loadAgent().catch((err) => {
    agent = undefined;
    throw err;
  });
  return agent;
}

const PAYLOAD = /^[\w-]+\.([\w-]+)\.[\w-]+$/;

/** Reads the intent the shopper signed. The merchant API verifies the signature; here we only need its fields. */
export function intentFromJws(jws: string): IntentMandate {
  const m = PAYLOAD.exec(jws);
  if (!m) throw new Error("intent_jws is not a compact JWS");
  return IntentMandate.parse(JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")));
}

export interface AgentCheckout {
  status: number;
  body: CheckoutResponse | { error: string; message: string };
}

/** Propose `sku` under the signed intent and ask the merchant for a verdict (POST /checkout). Human present. */
export async function agentCheckout(intentJws: string, sku: string): Promise<AgentCheckout> {
  const intent = intentFromJws(intentJws);
  const a = await getAgent();
  const now = new Date();
  const cart = proposeCart(intent, sku, {
    merchant: merchantFromEnv(),
    now,
    cartId: `cart_${randomUUID()}`,
  });
  const payment = paymentMandate(intent, cart, {
    agentKid: a.kid,
    platform: a.platform,
    humanPresent: true,
    now,
    id: randomUUID(),
  });
  const res = await fetch(`${apiBase()}/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent_jws: intentJws,
      payment_mandate_jws: await signMandate(payment, a.privateKey, a.kid),
      cart,
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as AgentCheckout["body"];
  if (
    !process.env.OPERATOR_TOKEN &&
    "verdict" in body &&
    body.verdict.outcome === "REJECT" &&
    body.verdict.reasons.includes("UNKNOWN_KEY")
  ) {
    // Most likely our own agent key: nobody registered it. Say so instead of blaming the shopper's cart.
    return {
      status: 503,
      body: {
        error: "agent_key_not_registered",
        message: `The merchant doesn't know this shop's agent key (${a.kid}). Set OPERATOR_TOKEN for the shop so it registers itself, or register AGENT_SIGNING_KEY with POST /keys/agent.`,
      },
    };
  }
  return { status: res.status, body };
}

/** The agent picks the item itself under the signed intent and proposes up to three carts (src/agent.ts). */
export function agentChoose(intentJws: string): Promise<ChooseResult> {
  return runChoose({
    intent: intentFromJws(intentJws),
    mode: parseAgentMode(process.env.AI_MODE),
    checkout: (sku) => agentCheckout(intentJws, sku),
  });
}

/** The agent fills the intent form from the shopper's words. It cannot sign: the shopper does, in the browser. */
export function agentDraftIntent(text: string): Promise<DraftResult> {
  return runDraft({ text, mode: parseAgentMode(process.env.AI_MODE) });
}
