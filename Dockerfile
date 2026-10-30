# One image recipe for every app: docker build --build-arg APP=api .
# Simplification: ships the whole workspace in each image (simple, ~400 MB); slim with `pnpm deploy` if size matters.
FROM node:20-alpine
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate && chmod -R a+rX "$COREPACK_HOME"  && mkdir /repo && chown node:node /repo
USER node
WORKDIR /repo

COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/worker/package.json apps/worker/
COPY --chown=node:node apps/buyer/package.json apps/buyer/
COPY --chown=node:node apps/dashboard/package.json apps/dashboard/
COPY --chown=node:node packages/ai/package.json packages/ai/
COPY --chown=node:node packages/contracts/package.json packages/contracts/
COPY --chown=node:node packages/db/package.json packages/db/
COPY --chown=node:node packages/ledger/package.json packages/ledger/
COPY --chown=node:node packages/mandates/package.json packages/mandates/
COPY --chown=node:node packages/paypal/package.json packages/paypal/
COPY --chown=node:node packages/policy-engine/package.json packages/policy-engine/
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .
ARG APP
ENV APP=${APP} NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN if [ -f "apps/${APP}/next.config.mjs" ]; then pnpm --filter "@poi/${APP}" build; fi

CMD ["sh", "-c", "pnpm --filter @poi/${APP} start"]
