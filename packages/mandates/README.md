# @poi/mandates

**Path:** `packages/mandates/` | **Owner:** @srshriv | **Backup:** @harshkumarsingh12 | **Spec:** [0001-mandate-model.md](../../docs/specs/0001-mandate-model.md) | **Milestones:** M0, M1

RFC 8785 canonicalization, `mandateHash`, `customId`, ES256 JWS `signMandate` / `verifyMandate`, and the key
registry: `createKeyRegistry()` (register / retire / resolve), `keyValidAt` (the one retirement rule, used by
checkout), `publicEs256Jwk` (P-256 public keys only) and `keyIdFor` (`kid` = RFC 7638 thumbprint). **Built and
tested.**

## Test

```bash
pnpm vitest run packages/mandates
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
