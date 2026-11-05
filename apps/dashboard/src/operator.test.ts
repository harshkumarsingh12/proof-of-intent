import { describe, expect, test } from "vitest";
import { isOperator, isOperatorActionPath } from "./operator";

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
