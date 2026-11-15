FROM python:3.12-alpine AS manifests
WORKDIR /repo
COPY . .
RUN python3 scripts/build-codelens-manifest.py

FROM node:22-alpine AS builder

WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile

COPY . .
COPY --from=manifests /repo/apps/web/src/lib/codelens-sources.json apps/web/src/lib/codelens-sources.json
COPY --from=manifests /repo/apps/web/src/lib/phase1-python-sources.json apps/web/src/lib/phase1-python-sources.json

ARG NEXT_PUBLIC_API_URL=https://croplens-api.abhaysaiamakam.workers.dev
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN cd apps/web && ./node_modules/.bin/next build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "server.js"]
