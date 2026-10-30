import { describe, expect } from "vitest";
import { ledger } from "@poi/ledger";
import { toolNames } from "./agent";
import { KEY_ALGORITHM } from "./signing";

// The buyer app's acceptance criteria. Browser behaviour is tested with the Playwright smoke test
// once it exists; these entries keep the work visible in the burndown until then.
describe("buyer app (unbuilt)", () => {
  ledger("M1", "srshriv", "signing key is generated as non-extractable WebCrypto ES256", () => {
    expect(KEY_ALGORITHM).toEqual({ name: "ECDSA", namedCurve: "P-256" });
  });

  ledger("M2", "srshriv", "buyer agent tools never include PayPal credentials", () => {
    expect(toolNames).toEqual(["create_intent_mandate", "search_catalog", "request_checkout"]);
  });
});
