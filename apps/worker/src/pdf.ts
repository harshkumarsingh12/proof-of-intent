import type { CartMandate, IntentMandate, ReasonCode } from "@poi/contracts";

export interface TimelineEntry {
  timestamp: string;
  event: string;
  actor?: string;
}

export interface DisputeSummary {
  disputeId: string;
  orderId: string;
  customId: string;
  status: string;
  reason: string;
  amount: string;
  responseDueDate?: string;
}

export interface VerificationResult {
  signatureValid: boolean;
  keyId: string;
  algorithm: string;
  computedHash: string;
  customIdMatches: boolean;
  verdictOutcome: string;
  reasons: ReasonCode[];
}

export interface ConstraintCheck {
  name: string;
  rule: string;
  actual: string;
  passed: boolean;
}

export interface EvidencePdfData {
  summary: DisputeSummary;
  intent: IntentMandate;
  intentHash: string;
  cart: CartMandate;
  constraints: ConstraintCheck[];
  verification: VerificationResult;
  timeline: TimelineEntry[];
  coverNote?: string;
}

export function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function renderEvidencePdfText(data: EvidencePdfData): string {
  const lines: string[] = [];

  lines.push("================================================================================");
  lines.push("                  PROOF OF INTENT: DISPUTE ATTESTATION RECORD                   ");
  lines.push("================================================================================");
  lines.push("");

  lines.push("1. DISPUTE SUMMARY");
  lines.push("------------------");
  lines.push(`Dispute ID:               ${data.summary.disputeId}`);
  lines.push(`PayPal Order ID:          ${data.summary.orderId}`);
  lines.push(`PayPal custom_id:         ${data.summary.customId}`);
  lines.push(`Dispute Status:           ${data.summary.status}`);
  lines.push(`Dispute Reason:           ${data.summary.reason}`);
  lines.push(`Disputed Amount:          ${data.summary.amount}`);
  if (data.summary.responseDueDate) {
    lines.push(`Response Due Date:        ${data.summary.responseDueDate}`);
  }
  lines.push("");

  lines.push("2. SIGNED INTENT MANDATE (SHOPPER WORDS & CONSTRAINTS)");
  lines.push("------------------------------------------------------");
  lines.push(`Shopper Description:      "${data.intent.natural_language_description}"`);
  lines.push(`Intent Mandate ID:        ${data.intent.mandate_id}`);
  lines.push(`Mandate Hash (SHA-256):   ${data.intentHash}`);
  lines.push(`Registered Key ID:        ${data.intent.issuer}`);
  lines.push(`Intent Expiry:            ${data.intent.intent_expiry}`);
  lines.push("");

  lines.push("3. CART VS MANDATE COMPARISON");
  lines.push("-----------------------------");
  lines.push(`Merchant:                 ${data.cart.contents.merchant_name} (${data.cart.contents.merchant_id})`);
  lines.push(`Cart Total:               ${data.cart.contents.total.currency} ${(data.cart.contents.total.value / 100).toFixed(2)}`);
  lines.push("Cart Lines Purchased:");
  for (const item of data.cart.contents.lines) {
    const attrs = Object.entries(item.attributes)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`  - [${item.sku}] ${item.title} x${item.quantity} @ ${item.unit_price.currency} ${(item.unit_price.value / 100).toFixed(2)} (${attrs})`);
  }
  lines.push("Evaluated Constraint Checks:");
  for (const c of data.constraints) {
    const status = c.passed ? "PASS" : "FAIL";
    lines.push(`  - [${status}] ${c.name}: limit ${c.rule} | actual: ${c.actual}`);
  }
  lines.push("");

  lines.push("4. VERIFICATION RESULT & CRYPTOGRAPHIC ATTESTATION");
  lines.push("-------------------------------------------------");
  lines.push(`Shopper JWS Signature:    ${data.verification.signatureValid ? "VALID" : "INVALID"} (${data.verification.algorithm}, key: ${data.verification.keyId})`);
  lines.push(`Computed Mandate Hash:    ${data.verification.computedHash}`);
  lines.push(`Order Pointer Match:      ${data.verification.customIdMatches ? "VERIFIED MATCH" : "MISMATCH"}`);
  lines.push(`Policy Engine Outcome:    ${data.verification.verdictOutcome}`);
  lines.push(`Reason Codes:             ${data.verification.reasons.length > 0 ? data.verification.reasons.join(", ") : "NONE (COMPLIANT)"}`);
  lines.push("");

  lines.push("5. AUDIT TIMELINE");
  lines.push("-----------------");
  for (const t of data.timeline) {
    const actorStr = t.actor ? ` [${t.actor}]` : "";
    lines.push(`[${t.timestamp}]${actorStr} ${t.event}`);
  }

  if (data.coverNote) {
    lines.push("");
    lines.push("6. COPILOT COVER NOTE");
    lines.push("---------------------");
    lines.push(data.coverNote);
  }

  return lines.join("\n");
}

export function generateEvidencePdf(data: EvidencePdfData): Uint8Array {
  const textContent = renderEvidencePdfText(data);
  const textLines = textContent.split("\n");

  // Construct PDF stream layout commands
  const streamCommands: string[] = [
    "BT",
    "/F1 9 Tf",
    "40 760 Td",
    "12 TL",
  ];

  for (let i = 0; i < textLines.length; i++) {
    const rawLine = textLines[i] ?? "";
    const escaped = escapePdfText(rawLine);
    if (i === 0) {
      streamCommands.push(`(${escaped}) Tj`);
    } else {
      streamCommands.push("T*");
      streamCommands.push(`(${escaped}) Tj`);
    }
  }

  streamCommands.push("ET");
  const streamBody = streamCommands.join("\n");
  const streamLength = Buffer.byteLength(streamBody, "utf8");

  // Build PDF objects with static structure for byte-for-byte determinism
  const obj1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  const obj2 = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  const obj3 = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n";
  const obj4 = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n";
  const obj5 = `5 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamBody}\nendstream\nendobj\n`;

  const header = "%PDF-1.4\n%POI-DETERMINISTIC-EVIDENCE\n";

  // Calculate byte offsets for xref
  const offset0 = 0;
  const offset1 = Buffer.byteLength(header, "utf8");
  const offset2 = offset1 + Buffer.byteLength(obj1, "utf8");
  const offset3 = offset2 + Buffer.byteLength(obj2, "utf8");
  const offset4 = offset3 + Buffer.byteLength(obj3, "utf8");
  const offset5 = offset4 + Buffer.byteLength(obj4, "utf8");
  const startXref = offset5 + Buffer.byteLength(obj5, "utf8");

  const pad = (n: number) => n.toString().padStart(10, "0");
  const xref = [
    "xref",
    "0 6",
    `${pad(offset0)} 65535 f `,
    `${pad(offset1)} 00000 n `,
    `${pad(offset2)} 00000 n `,
    `${pad(offset3)} 00000 n `,
    `${pad(offset4)} 00000 n `,
    `${pad(offset5)} 00000 n `,
    "trailer",
    "<< /Size 6 /Root 1 0 R >>",
    "startxref",
    startXref.toString(),
    "%%EOF",
    "",
  ].join("\n");

  const fullPdf = header + obj1 + obj2 + obj3 + obj4 + obj5 + xref;
  return new TextEncoder().encode(fullPdf);
}
