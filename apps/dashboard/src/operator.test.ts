import { afterEach, describe, expect, test, vi } from "vitest";
import { POST } from "../app/api/[...path]/route";
import { isOperator, isOperatorActionPath } from "./operator";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("the Studio proxy relays mode and prompt version while keeping provider and operator credentials server-side", async () => {
  vi.stubEnv("OPERATOR_TOKEN", "test-only-token");
  vi.stubEnv("OPERATOR_PASSWORD", "test-only-password");
  vi.stubEnv("API_INTERNAL_URL", "http://merchant.test");
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      { text: "Recorded answer", tool: null },
      {
        headers: { "x-poi-ai-mode": "replay", "x-poi-ai-prompt-version": "j4-v1" },
      },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const response = await POST(
    new Request("http://dashboard.test/api/ai/studio", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: basic("operator", "test-only-password") },
      body: JSON.stringify({ kind: "turn" }),
    }),
    { params: Promise.resolve({ path: ["ai", "studio"] }) },
  );
  expect(response.headers.get("x-poi-ai-mode")).toBe("replay");
  expect(response.headers.get("x-poi-ai-prompt-version")).toBe("j4-v1");
  expect(await response.text()).not.toContain("test-only-token");
  expect(fetch.mock.calls[0]?.[1].headers.authorization).toBe("Bearer test-only-token");
});

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("operator gate on the dashboard proxy", () => {
  test("only the operator with the right password passes", () => {
    expect(isOperator(basic("operator", "s3cret"), "s3cret")).toBe(true);
    expect(isOperator(basic("operator", "wrong"), "s3cret")).toBe(false);
    expect(isOperator(basic("viewer", "s3cret"), "s3cret")).toBe(false);
    expect(isOperator("Bearer s3cret", "s3cret")).toBe(false);
    expect(isOperator(null, "s3cret")).toBe(false);
  });

  test("only dispute action paths can be posted", () => {
    expect(isOperatorActionPath(["disputes", "PP-D-1", "actions", "accept-claim"])).toBe(true);
    expect(isOperatorActionPath(["checkout"])).toBe(false);
    expect(isOperatorActionPath(["disputes", "PP-D-1", "recommendation"])).toBe(false);
    expect(isOperatorActionPath(["disputes", "PP-D-1", "actions", "../../checkout"])).toBe(false);
  });
});
