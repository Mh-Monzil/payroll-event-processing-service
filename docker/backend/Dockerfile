# Multi-stage build for the NestJS backend.

# ---------- builder ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy only the manifests first, so `npm ci` is cached and does not re-run on
# every source change.
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

# Only the backend workspace: the frontend manifest is here because npm ci
# validates the lockfile against every workspace, not because we install it.
RUN npm ci --workspace backend --include-workspace-root

COPY apps/backend ./apps/backend

RUN npm run build --workspace backend

# ---------- production ----------
FROM node:22-alpine AS production

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

COPY --chown=nestjs:nodejs package.json package-lock.json ./
COPY --chown=nestjs:nodejs apps/backend/package.json ./apps/backend/
COPY --chown=nestjs:nodejs apps/frontend/package.json ./apps/frontend/

RUN npm ci --workspace backend --include-workspace-root --omit=dev \
  && npm cache clean --force

COPY --from=builder --chown=nestjs:nodejs /app/apps/backend/dist ./apps/backend/dist

USER nestjs
WORKDIR /app/apps/backend

EXPOSE 3000

# Default is the API. The worker service overrides this in docker-compose.
CMD ["node", "dist/main"]
