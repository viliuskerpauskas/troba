# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/web/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) .
# Web:     docker run <image>
# Migrate: docker run <image> node migrate.js
# Admin:   docker run -it <image> node scripts/create-admin.js <email>

# Keep the node tag in step with .nvmrc. Literal tags (not an ARG) so Dependabot can update them.
FROM node:24.18.0-alpine AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Typecheck first: next build checks types against the packages' tsc -b declarations.
RUN pnpm typecheck && pnpm build && node apps/web/src/build-cli.ts /out/cli

FROM node:24.18.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Files stay owned by root, so the app user can't modify them.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# migrate.js, migrations/ and scripts/create-admin.js
COPY --from=build /out/cli ./
# Next writes its cache here at runtime; users' files go in /data/uploads (mount a volume there).
RUN mkdir -p apps/web/.next/cache /data/uploads \
    && chown node:node apps/web/.next/cache /data/uploads
ENV UPLOADS_DIR=/data/uploads
USER node
EXPOSE 3000
# Last, so a new sha doesn't invalidate the layers above. Reported by /api/health.
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
CMD ["node", "apps/web/server.js"]
