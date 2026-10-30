import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "reports/**", "**/next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Unbuilt acceptance criteria go through ledger() so CI can attribute them to an owner.
    files: ["**/*.test.ts"],
    ignores: ["packages/ledger/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "test", property: "fails", message: "Use ledger() from @poi/ledger." },
        { object: "it", property: "fails", message: "Use ledger() from @poi/ledger." },
      ],
    },
  },
);
