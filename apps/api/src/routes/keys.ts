/**
 * Key registry (docs/specs/0001, issue #22). Key ids are the key's RFC 7638 thumbprint, so registering is
 * idempotent and nobody can claim someone else's id.
 *
 * - POST /keys/shopper: public. A shopper's browser registers its own P-256 public key and gets a shopper id.
 *   Registering someone else's public key gains nothing: mandates still need the private half.
 * - POST /keys/agent: operator only. Which agent platforms may pay is the merchant's call (KYA-lite).
 * - POST /keys/:kind/:kid/retire: operator only. Mandates created before the retirement still verify.
 */
import type { FastifyPluginAsync } from "fastify";
import { keyIdFor, publicEs256Jwk } from "@poi/mandates";
import type { AppDeps } from "../app";
import { RATE_LIMITS } from "../rate-limits";
import { operator } from "./disputes";

type Body = { public_jwk?: unknown; platform?: unknown; at?: unknown } | undefined;

export const keyRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  const parseJwk = (body: Body) => {
    try {
      return publicEs256Jwk(body?.public_jwk);
    } catch (err) {
      return (err as Error).message;
    }
  };

  app.post<{ Body: Body }>(
    "/keys/shopper",
    { bodyLimit: 4 * 1024, config: { rateLimit: RATE_LIMITS.keys } },
    async (req, reply) => {
      const jwk = parseJwk(req.body);
      if (typeof jwk === "string") return reply.code(400).send({ error: "invalid_key", message: jwk });
      if (!deps.db)
        return reply.code(503).send({ error: "database_not_configured", message: "DATABASE_URL is not set" });
      const kid = await keyIdFor("shp", jwk);
      const { shopperId, created } = await deps.db.registerShopperKey({ kid, publicJwk: { ...jwk } });
      if (created) {
        await deps.db.appendAudit({
          actor: `shopper:${shopperId}`,
          action: "key.registered",
          subjectId: kid,
          requestBody: { kind: "shopper", publicJwk: jwk },
        });
      }
      return reply.code(created ? 201 : 200).send({ kid, shopper_id: shopperId });
    },
  );

  app.post<{ Body: Body }>("/keys/agent", { bodyLimit: 4 * 1024 }, async (req, reply) => {
    const actor = operator(req, reply, deps.operatorToken);
    if (!actor) return;
    const jwk = parseJwk(req.body);
    if (typeof jwk === "string") return reply.code(400).send({ error: "invalid_key", message: jwk });
    const platform = req.body?.platform;
    if (typeof platform !== "string" || !/^[\w .-]{1,64}$/.test(platform)) {
      return reply.code(400).send({ error: "invalid_request", message: "Expected { public_jwk, platform }" });
    }
    if (!deps.db)
      return reply.code(503).send({ error: "database_not_configured", message: "DATABASE_URL is not set" });
    const kid = await keyIdFor("agt", jwk);
    if (!(await deps.db.registerAgentKey({ kid, platform, owner: actor, publicJwk: { ...jwk } }))) {
      const existing = await deps.db.findKey("agent", kid);
      if (existing?.platform !== platform) {
        return reply
          .code(409)
          .send({ error: "key_registered", message: `This key belongs to ${existing?.platform}` });
      }
      return reply.code(200).send({ kid, platform });
    }
    await deps.db.appendAudit({
      actor,
      action: "key.registered",
      subjectId: kid,
      requestBody: { kind: "agent", platform, publicJwk: jwk },
    });
    return reply.code(201).send({ kid, platform });
  });

  app.post<{ Params: { kind: string; kid: string }; Body: Body }>(
    "/keys/:kind/:kid/retire",
    async (req, reply) => {
      const actor = operator(req, reply, deps.operatorToken);
      if (!actor) return;
      const { kind, kid } = req.params;
      if (kind !== "shopper" && kind !== "agent") {
        return reply.code(404).send({ error: "not_found", message: "Kinds: shopper, agent" });
      }
      const at = req.body?.at ?? new Date().toISOString();
      if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "at must be an ISO 8601 timestamp" });
      }
      if (!deps.db)
        return reply.code(503).send({ error: "database_not_configured", message: "DATABASE_URL is not set" });
      const retiredAt = await deps.db.retireKey(kind, kid, at);
      if (!retiredAt) return reply.code(404).send({ error: "key_not_found", message: "Unknown key" });
      await deps.db.appendAudit({
        actor,
        action: "key.retired",
        subjectId: kid,
        requestBody: { kind, retiredAt },
      });
      return { kid, retired_at: retiredAt };
    },
  );
};
