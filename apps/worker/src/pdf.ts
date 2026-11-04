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
  intent?: IntentMandate | null;
  intentHash?: string | null;
  cart?: CartMandate | null;
  constraints?: ConstraintCheck[];
  verification?: VerificationResult;
  timeline?: TimelineEntry[];
  coverNote?: string | null;
}

export function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function wrapLine(line: string, maxChars = 80): string[] {
  if (line.length <= maxChars) {
    return [line];
  }

  const indentMatch = line.match(/^(\s+)/);
  const indent = indentMatch ? indentMatch[1] : "";

  const words = line.split(" ");
  const wrapped: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        wrapped.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxChars) {
        wrapped.push(word.slice(i, i + maxChars));
      }
      continue;
    }

    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += " " + word;
    } else {
      wrapped.push(current);
      current = indent ? `${indent}  ${word}` : word;
    }
  }

  if (current) {
    wrapped.push(current);
  }

  return wrapped.length > 0 ? wrapped : [line];
}

export function renderEvidencePdfText(data: EvidencePdfData): string {
  const lines: string[] = [];

  lines.push("================================================================================");
  lines.push("                  PROOF OF INTENT: DISPUTE ATTESTATION RECORD                   ");
  lines.push("================================================================================");
  lines.push("");

  lines.push("1. DISPUTE SUMMARY");
  lines.push("------------------");
  lines.push(`Dispute ID:               ${data.summary.disputeId ?? "not available"}`);
  lines.push(`PayPal Order ID:          ${data.summary.orderId ?? "not available"}`);
  lines.push(`PayPal custom_id:         ${data.summary.customId ?? "not available"}`);
  lines.push(`Dispute Status:           ${data.summary.status ?? "not available"}`);
  lines.push(`Dispute Reason:           ${data.summary.reason ?? "not available"}`);
  lines.push(`Disputed Amount:          ${data.summary.amount ?? "not available"}`);
  if (data.summary.responseDueDate) {
    lines.push(`Response Due Date:        ${data.summary.responseDueDate}`);
  }
  lines.push("");

  lines.push("2. SIGNED INTENT MANDATE (SHOPPER WORDS & CONSTRAINTS)");
  lines.push("------------------------------------------------------");
  lines.push(`Shopper Description:      "${data.intent?.natural_language_description ?? "not available"}"`);
  lines.push(`Intent Mandate ID:        ${data.intent?.mandate_id ?? "not available"}`);
  lines.push(`Mandate Hash (SHA-256):   ${data.intentHash ?? "not available"}`);
  lines.push(`Registered Key ID:        ${data.intent?.issuer ?? "not available"}`);
  lines.push(`Intent Expiry:            ${data.intent?.intent_expiry ?? "not available"}`);
  lines.push("");

  lines.push("3. CART VS MANDATE COMPARISON");
  lines.push("-----------------------------");
  if (data.cart) {
    lines.push(
      `Merchant:                 ${data.cart.contents.merchant_name} (${data.cart.contents.merchant_id})`,
    );
    lines.push(
      `Cart Total:               ${data.cart.contents.total.currency} ${(data.cart.contents.total.value / 100).toFixed(2)}`,
    );
    lines.push("Cart Lines Purchased:");
    for (const item of data.cart.contents.lines) {
      const attrs = Object.entries(item.attributes)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      lines.push(
        `  - [${item.sku}] ${item.title} x${item.quantity} @ ${item.unit_price.currency} ${(item.unit_price.value / 100).toFixed(2)} (${attrs})`,
      );
    }
  } else {
    lines.push("Merchant:                 not available");
    lines.push("Cart Total:               not available");
    lines.push("Cart Lines Purchased:");
    lines.push("  - not available");
  }

  lines.push("Evaluated Constraint Checks:");
  if (data.constraints && data.constraints.length > 0) {
    for (const c of data.constraints) {
      const status = c.passed ? "PASS" : "FAIL";
      lines.push(`  - [${status}] ${c.name}: limit ${c.rule} | actual: ${c.actual}`);
    }
  } else {
    lines.push("  - [not available] Constraints: not available");
  }
  lines.push("");

  lines.push("4. VERIFICATION RESULT & CRYPTOGRAPHIC ATTESTATION");
  lines.push("-------------------------------------------------");
  const sigValidStr = data.verification
    ? data.verification.signatureValid
      ? "VALID"
      : "INVALID"
    : "not available";
  const algStr = data.verification?.algorithm ?? "not available";
  const keyStr = data.verification?.keyId ?? "not available";
  lines.push(`Shopper JWS Signature:    ${sigValidStr} (${algStr}, key: ${keyStr})`);
  lines.push(`Computed Mandate Hash:    ${data.verification?.computedHash ?? "not available"}`);
  lines.push(
    `Order Pointer Match:      ${data.verification ? (data.verification.customIdMatches ? "VERIFIED MATCH" : "MISMATCH") : "not available"}`,
  );
  lines.push(`Policy Engine Outcome:    ${data.verification?.verdictOutcome ?? "not available"}`);
  const reasonsStr =
    data.verification?.reasons && data.verification.reasons.length > 0
      ? data.verification.reasons.join(", ")
      : "NONE (COMPLIANT)";
  lines.push(`Reason Codes:             ${reasonsStr}`);
  lines.push("");

  lines.push("5. AUDIT TIMELINE");
  lines.push("-----------------");
  if (data.timeline && data.timeline.length > 0) {
    for (const t of data.timeline) {
      const actorStr = t.actor && t.actor !== "not available" ? ` [${t.actor}]` : "";
      lines.push(`[${t.timestamp}]${actorStr} ${t.event}`);
    }
  } else {
    lines.push("[not available] not available");
  }

  if (data.coverNote) {
    lines.push("");
    lines.push("6. COPILOT COVER NOTE");
    lines.push("---------------------");
    lines.push(data.coverNote);
  }

  return lines.join("\n");
}

/** Courier is a standard 14 font with no Unicode: fold to ASCII so nothing renders as mojibake. */
export function toPdfAscii(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "?");
}

/** 9 pt Courier, 12 pt leading, from y=760 down to a 40 pt bottom margin. */
export const LINES_PER_PAGE = 60;

export function generateEvidencePdf(data: EvidencePdfData): Uint8Array {
  const textLines = renderEvidencePdfText(data)
    .split("\n")
    .flatMap((l) => wrapLine(toPdfAscii(l), 80));

  const pages: string[][] = [];
  for (let i = 0; i < textLines.length; i += LINES_PER_PAGE)
    pages.push(textLines.slice(i, i + LINES_PER_PAGE));

  // Objects: 1 catalog, 2 page tree, then (page, content) per page, then the font. Everything is
  // ASCII, so string length is byte length and the output is byte-for-byte deterministic.
  const fontId = 3 + pages.length * 2;
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
  ];
  pages.forEach((lines, i) => {
    const body = ["BT", "/F1 9 Tf", "40 760 Td", "12 TL"];
    lines.forEach((line, j) => {
      if (j > 0) body.push("T*");
      body.push(`(${escapePdfText(line)}) Tj`);
    });
    body.push("ET");
    const stream = body.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  let out = "%PDF-1.4\n%POI-DETERMINISTIC-EVIDENCE\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const pad = (n: number) => n.toString().padStart(10, "0");
  const startXref = out.length;
  out += [
    "xref",
    `0 ${objects.length + 1}`,
    `${pad(0)} 65535 f `,
    ...offsets.map((o) => `${pad(o)} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(startXref),
    "%%EOF",
    "",
  ].join("\n");
  return new TextEncoder().encode(out);
}
