# Conventions

Small rules that prevent the bugs that cost a day to find.

## Data

- **Money** is `{ value: integer minor units, currency: "USD" }`. Never floats, never strings like `"79.99"`.
  Convert to PayPal's string amounts only inside `packages/paypal`.
- **Time** is ISO 8601 with an offset, stored and compared in UTC. Pure code takes `now` as a parameter;
  only the edges (API handlers, jobs) read the clock.
- **IDs**: mandate ids are UUIDv7; our order ids are `ord_<ulid or uuid>`; PayPal ids are kept as PayPal gives them.
- **Hashes** are lowercase hex SHA-256 over RFC 8785 canonical JSON (`mandateHash()` in `packages/mandates`).
- **`custom_id`** is `poi:<mandate_id>:<first 16 hex of hash>` (57 characters). Never put mandate data in it.

## Reason codes

The `ReasonCode` enum in `packages/contracts` is the only vocabulary. The same strings appear in API responses,
the copilot's reasons, the dashboard chips and the evidence PDF. Adding one is a contracts change (spec + review).

## API

- JSON in and out. Validate every request body with the zod schema from `packages/contracts` at the edge.
- Errors: `{ "error": "snake_case_code", "message": "human text", "reasons"?: ReasonCode[] }`.
- A REJECT verdict is a successful request: HTTP 200 with `verdict.outcome = "REJECT"`. 4xx is for malformed or
  unauthenticated requests.
- Idempotency: anything that creates something on PayPal sends `PayPal-Request-Id` equal to our id.

## Code

- TypeScript strict everywhere. No `any` without a comment saying why.
- A stub throws `NotImplementedError(what, owner, spec)` so a half-built path names who to ask.
- File names are kebab-case; React components PascalCase; tests sit next to the code as `*.test.ts`.
- Logs go through the framework logger with a request id. Never log secrets, full addresses or mandate payloads
  above debug.

## Git

See [CONTRIBUTING.md](../CONTRIBUTING.md): branch per change, Conventional Commit PR titles, squash merge,
one approval, never push to `main`.

## When you find a violation

Fix it in its own small PR (`fix:` or `refactor:`), or open an issue tagged with the area if it's not yours.
