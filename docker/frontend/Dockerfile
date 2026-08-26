# Build the static bundle, then serve it from nginx. Nothing from the build
# stage ships: the final image is the bundle plus a web server.

# ---------- builder ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Both workspace manifests, because npm ci validates the lockfile against all
# of them even when installing only one.
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

RUN npm ci --workspace frontend --include-workspace-root

COPY apps/frontend ./apps/frontend

RUN npm run build --workspace frontend

# ---------- production ----------
FROM nginx:1.27-alpine AS production

COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80
