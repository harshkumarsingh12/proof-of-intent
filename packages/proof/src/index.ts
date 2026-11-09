/**
 * The proof package (#177): everything that backs one purchase, in one JSON file someone else can check on their own
 * machine, plus the verifier that says which checks passed. Spec: docs/specs/0001-mandate-model.md §Proof package.
 *
 * It carries the three signed mandates as the compact JWS strings that were signed (the shopper's Intent, the buyer agent's
 * Payment, the merchant's Cart), the public keys that verify them, the PayPal references, the version of the policy rules that
 * judged the purchase, and an integrity manifest. Nothing in it is secret: public keys, signatures over what the shopper
 * agreed to, and ids.
 *
 * What a pass means, and does not. Verifying needs only this file. A pass shows that the signatures are valid for the keys in
 * the file, that the three mandates point at one another, that the order's PayPal pointer names this intent, and that the
 * hard rules held at the time of payment. It does not show who holds each key (compare the `kid`s with the merchant's key
 * registry), and the PayPal references are the merchant's own record: look them up in PayPal to confirm the capture. The
 * manifest detects a changed file; it is not a signature, and someone who rewrites the whole file can recompute it.
 */
import { createHash } from "node:crypto";
import { CartMandate, IntentMandate, PaymentMandate } from "@poi/contracts";
import {
  canonicalJson,
  customId,
  keyIdFor,
  mandateHash,
  publicEs256Jwk,
  verifyMandate,
  type KeyResolver,
} from "@poi/mandates";
import { evaluate, POLICY_VERSION } from "@poi/policy-engine";
import { importJWK, type JWK } from "jose";
import { z } from "zod";

export const PROOF_SCHEMA_VERSION = "poi-proof/0.1";

const iso = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "lowercase hex SHA-256");

const PublicKey = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().min(1),
  y: z.string().min(1),
});

const KeyEntry = z.object({
  role: z.enum(["shopper", "agent", "merchant"]),
  kid: z.string().min(1),
  public_jwk: PublicKey,
  /** When the merchant retired the key, if it did. A retired key still verifies what it signed before then. */
  retired_at: iso.optional(),
  /** Agent keys: the platform the key was registered to. */
  platform: z.string().min(1).optional(),
});

const SignedMandate = z.object({ jws: z.string().min(1), hash: sha256, kid: z.string().min(1) });

const References = z.object({
  order_id: z.string().min(1),
  merchant_id: z.string().min(1),
  /** The pointer written to the PayPal order: `poi:<intent id>:<first 16 hex of the intent hash>`. */
  custom_id: z.string().min(1),
  paypal_order_id: z.string().min(1).optional(),
  authorization_id: z.string().min(1).optional(),
  capture_id: z.string().min(1).optional(),
  captured_at: iso.optional(),
  order_status: z.string().min(1).optional(),
  agent_platform: z.string().min(1).optional(),
  human_present: z.boolean().optional(),
});

const Mandates = z.object({ intent: SignedMandate, payment: SignedMandate, cart: SignedMandate });
const Policy = z.object({ version: z.string().min(1), engine: z.literal("@poi/policy-engine") });

export const ProofPackage = z.object({
  schema_version: z.literal(PROOF_SCHEMA_VERSION),
  created_at: iso,
  mandates: Mandates,
  keys: z.array(KeyEntry).min(1),
  references: References,
  policy: Policy,
  manifest: z.object({ algorithm: z.literal("sha256"), entries: z.record(sha256), package_hash: sha256 }),
});
export type ProofPackage = z.infer<typeof ProofPackage>;

// ---------- building ----------

export interface ProofKeyInput {
  role: "shopper" | "agent" | "merchant";
  kid: string;
  publicJwk: Record<string, unknown>;
  retiredAt?: string;
  platform?: string;
}

export interface BuildProofInput {
  createdAt: string;
  /** The compact JWS strings exactly as they were signed and stored. */
  intentJws: string;
  paymentJws: string;
  cartJws: string;
  keys: ProofKeyInput[];
  references: z.input<typeof References>;
}

const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

/** The header, mandates, keys, references and policy sections, each hashed, and one hash over those hashes. */
function manifestOf(parts: {
  header: unknown;
  mandates: unknown;
  keys: unknown;
  references: unknown;
  policy: unknown;
}) {
  const entries = {
    header: digest(parts.header),
    mandates: digest(parts.mandates),
    keys: digest(parts.keys),
    references: digest(parts.references),
    policy: digest(parts.policy),
  };
  return { algorithm: "sha256" as const, entries, package_hash: digest(entries) };
}

/** Reads a compact JWS without verifying it: the signed payload and the key id from its header. Throws on a malformed one. */
function readJws(jws: string): { payload: unknown; kid: string } {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("not a compact JWS");
  const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as { kid?: unknown };
  if (typeof header.kid !== "string" || !header.kid) throw new Error("the JWS header has no kid");
  return { payload: JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")), kid: header.kid };
}

/**
 * Packs the three signed mandates, their public keys, the references and the policy version into a proof package, and seals it
 * with the manifest. It does not verify anything: a package built from a bad signature is built, and the verifier says so.
 */
export function buildProofPackage(input: BuildProofInput): ProofPackage {
  const signed = (jws: string) => {
    const { payload, kid } = readJws(jws);
    return { jws, hash: mandateHash(payload), kid };
  };
  const header = { schema_version: PROOF_SCHEMA_VERSION, created_at: input.createdAt };
  const mandates = {
    intent: signed(input.intentJws),
    payment: signed(input.paymentJws),
    cart: signed(input.cartJws),
  };
  const keys = input.keys.map((k) => ({
    role: k.role,
    kid: k.kid,
    public_jwk: publicEs256Jwk(k.publicJwk) as z.infer<typeof PublicKey>,
    ...(k.retiredAt ? { retired_at: k.retiredAt } : {}),
    ...(k.platform ? { platform: k.platform } : {}),
  }));
  const references = References.parse(input.references);
  const policy = { version: POLICY_VERSION, engine: "@poi/policy-engine" as const };
  return ProofPackage.parse({
    ...header,
    mandates,
    keys,
    references,
    policy,
    manifest: manifestOf({ header, mandates, keys, references, policy }),
  });
}

// ---------- verifying ----------

export interface ProofCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ProofReport {
  /** True only when every check passed. A check that could not run counts as failed, never as passed. */
  ok: boolean;
  checks: ProofCheck[];
  /** What a pass does not establish, and anything the reader should look at themselves. Always present. */
  notes: string[];
}

const short = (s: string) => (s.length > 18 ? `${s.slice(0, 18)}…` : s);

/**
 * Checks a proof package offline, using only what is in it. Anything that is not a well-formed package is one failed check;
 * a check whose prerequisite failed says "not checked" and fails, so a pass is never claimed for something not looked at.
 */
export async function verifyProofPackage(input: unknown): Promise<ProofReport> {
  const checks: ProofCheck[] = [];
  const add = (id: string, label: string, passed: boolean, detail: string) =>
    checks.push({ id, label, passed, detail });
  const notes = [
    "Keys are taken from this file. A valid signature shows the holder of that key signed; it does not show who holds it. Compare each key id with the merchant's registry.",
    "The PayPal references are the merchant's own record. Look the order and capture up in PayPal to confirm the money moved.",
    "The manifest detects a changed file. It is not a signature: someone who rewrites the whole file can recompute it. The signatures on the mandates are what carry the proof.",
  ];

  const parsed = ProofPackage.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    add("package.schema", "The file is a proof package", false, first.join("; "));
    return { ok: false, checks, notes };
  }
  const pkg = parsed.data;
  add("package.schema", "The file is a proof package", true, `${pkg.schema_version}, made ${pkg.created_at}`);

  // 1. Manifest: the sections are what they were when the package was sealed.
  const expected = manifestOf({
    header: { schema_version: pkg.schema_version, created_at: pkg.created_at },
    mandates: pkg.mandates,
    keys: pkg.keys,
    references: pkg.references,
    policy: pkg.policy,
  });
  const changed = Object.keys(expected.entries).filter(
    (k) => expected.entries[k as keyof typeof expected.entries] !== pkg.manifest.entries[k],
  );
  const extra = Object.keys(pkg.manifest.entries).filter((k) => !(k in expected.entries));
  const manifestOk =
    changed.length === 0 && extra.length === 0 && expected.package_hash === pkg.manifest.package_hash;
  add(
    "manifest.integrity",
    "The file is unchanged since it was sealed",
    manifestOk,
    manifestOk
      ? `5 sections match; package hash ${short(pkg.manifest.package_hash)}`
      : `changed: ${[...changed, ...extra].join(", ") || "the package hash"}`,
  );

  // 2. Keys: a shopper or agent key id is the key's own RFC 7638 thumbprint, so the key in the file cannot be swapped for another.
  const bad: string[] = [];
  for (const k of pkg.keys) {
    if (k.role === "merchant") continue;
    const want = await keyIdFor(k.role === "shopper" ? "shp" : "agt", k.public_jwk as JWK).catch(() => "");
    if (want !== k.kid) bad.push(k.kid);
  }
  add(
    "keys.kid_binding",
    "Each shopper and agent key id is the thumbprint of its key",
    bad.length === 0,
    bad.length === 0
      ? `${pkg.keys.filter((k) => k.role !== "merchant").length} key(s) checked`
      : `does not match its key: ${bad.join(", ")}`,
  );

  // 3. Signatures, each against the keys of the role that must have signed it.
  const resolverFor =
    (role: "shopper" | "agent" | "merchant"): KeyResolver =>
    async (kid) => {
      const entry = pkg.keys.find((k) => k.role === role && k.kid === kid);
      if (!entry) return undefined;
      try {
        return (await importJWK(entry.public_jwk as JWK, "ES256")) as Awaited<ReturnType<KeyResolver>>;
      } catch {
        return undefined;
      }
    };
  const signature = async (
    which: "intent" | "payment" | "cart",
    role: "shopper" | "agent" | "merchant",
    label: string,
  ) => {
    const m = pkg.mandates[which];
    const res = await verifyMandate(m.jws, resolverFor(role));
    if (!res.ok) {
      add(
        `sig.${which}`,
        label,
        false,
        res.reason === "UNKNOWN_KEY"
          ? `no ${role} key with id ${m.kid} in the package`
          : `the signature does not verify against the ${role} key ${short(m.kid)}`,
      );
      return undefined;
    }
    const hash = mandateHash(res.payload);
    const consistent = res.kid === m.kid && hash === m.hash;
    add(
      `sig.${which}`,
      label,
      consistent,
      consistent
        ? `valid ES256 signature by ${short(res.kid)}; hash ${short(hash)}`
        : `the signature is valid but the package's declared ${res.kid === m.kid ? "hash" : "key id"} for it is wrong`,
    );
    return consistent ? { payload: res.payload, kid: res.kid, hash } : undefined;
  };
  const intentSig = await signature("intent", "shopper", "The shopper signed the Intent Mandate");
  const paymentSig = await signature("payment", "agent", "The buyer agent signed the Payment Mandate");
  const cartSig = await signature("cart", "merchant", "The merchant signed the Cart Mandate");

  // 4. The signed payloads are the shapes the rest of the system uses.
  const intent = intentSig ? IntentMandate.safeParse(intentSig.payload) : undefined;
  const payment = paymentSig ? PaymentMandate.safeParse(paymentSig.payload) : undefined;
  const cart = cartSig ? CartMandate.safeParse(cartSig.payload) : undefined;
  const shaped = intent?.success && payment?.success && cart?.success;
  add(
    "schema.mandates",
    "The signed payloads are well-formed mandates",
    Boolean(shaped),
    shaped
      ? "intent, payment and cart parse against the shared contracts"
      : !intentSig || !paymentSig || !cartSig
        ? "not checked: a signature above did not verify"
        : "a signed payload does not match the mandate schema",
  );

  const ready =
    intent?.success && payment?.success && cart?.success && intentSig && paymentSig && cartSig
      ? { intent: intent.data, payment: payment.data, cart: cart.data, intentSig, paymentSig, cartSig }
      : undefined;
  const skipped = "not checked: the mandates above did not all verify";
  const bind = (id: string, label: string, test: (r: NonNullable<typeof ready>) => [boolean, string]) => {
    if (!ready) return add(id, label, false, skipped);
    const [passed, detail] = test(ready);
    add(id, label, passed, detail);
  };

  bind("bind.payment_intent", "The Payment Mandate commits to this Intent Mandate", (r) => [
    r.payment.intent_mandate_hash === r.intentSig.hash,
    r.payment.intent_mandate_hash === r.intentSig.hash
      ? "the payment's intent hash equals the intent's hash"
      : "the payment names a different intent",
  ]);
  bind("bind.payment_cart", "The Payment Mandate commits to this Cart Mandate", (r) => [
    r.payment.cart_mandate_hash === r.cartSig.hash,
    r.payment.cart_mandate_hash === r.cartSig.hash
      ? "the payment's cart hash equals the cart's hash"
      : "the payment names a different cart",
  ]);
  bind("bind.cart_intent", "The Cart Mandate points at this Intent Mandate, for this merchant", (r) => {
    const ok =
      r.cart.intent_mandate_hash === r.intentSig.hash &&
      r.cart.intent_mandate_id === r.intent.mandate_id &&
      r.cart.contents.merchant_id === pkg.references.merchant_id;
    return [
      ok,
      ok
        ? `cart ${r.cart.contents.cart_id} → intent ${r.intent.mandate_id}`
        : "the cart names a different intent or merchant",
    ];
  });
  bind("bind.agent_key", "The Payment Mandate names the key that signed it", (r) => {
    const key = pkg.keys.find((k) => k.role === "agent" && k.kid === r.paymentSig.kid);
    const ok =
      r.payment.agent_key_id === r.paymentSig.kid &&
      (!key?.platform || key.platform === r.payment.agent_platform);
    return [
      ok,
      ok
        ? `agent key ${short(r.paymentSig.kid)}, platform ${r.payment.agent_platform}`
        : "the key id or platform does not match",
    ];
  });
  bind("paypal.pointer", "The PayPal order's pointer names this Intent Mandate", (r) => {
    let want = "";
    try {
      want = customId(r.intent.mandate_id, r.intentSig.hash);
    } catch {
      /* an over-long id: no pointer can match */
    }
    return [
      want !== "" && want === pkg.references.custom_id,
      want === pkg.references.custom_id
        ? `custom_id ${want}`
        : `expected ${want}, the package says ${pkg.references.custom_id}`,
    ];
  });

  // 5. The hard rules, replayed at the time of payment. There is no ledger in the package, so this assumes no earlier purchase.
  bind("policy.replay", "The hard rules held when the payment was made", (r) => {
    const result = evaluate({ intent: r.intent, cart: r.cart, now: r.payment.timestamp });
    return [
      result.pass,
      result.pass
        ? `no rule failed at ${r.payment.timestamp} (assumes no earlier purchase under this intent: the package carries no ledger)`
        : `failed at ${r.payment.timestamp}: ${result.reasons.join(", ")}`,
    ];
  });
  if (ready && !ready.payment.human_present) {
    const allowed = ready.intent.constraints.unattended_payment;
    const ok =
      !!allowed &&
      (!allowed.allowed_agent_platforms ||
        allowed.allowed_agent_platforms.includes(ready.payment.agent_platform));
    add(
      "policy.unattended",
      "The shopper signed permission for the agent to pay alone",
      ok,
      ok
        ? "the signed intent allows unattended payment"
        : "the payment says nobody was present, and the signed intent does not allow that",
    );
  }

  if (pkg.policy.version !== POLICY_VERSION) {
    notes.push(
      `This package was made under ${pkg.policy.version}; this verifier runs ${POLICY_VERSION}. The rules may differ, so read the policy replay with that in mind.`,
    );
  }
  for (const k of pkg.keys.filter((k) => k.retired_at)) {
    notes.push(
      `Key ${short(k.kid)} was retired at ${k.retired_at}. Whether the mandate it signed predates that depends on when the merchant first saw it, which this package does not carry.`,
    );
  }
  return { ok: checks.every((c) => c.passed), checks, notes };
}
