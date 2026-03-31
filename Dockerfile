# ----- Stage 1: Build the SPA -----
FROM node:22-alpine AS build

# Fix CVE-2026-25646, CVE-2026-33636, CVE-2026-33416 (libpng); CVE-2026-22184, CVE-2026-27171 (zlib); CVE-2026-32767, CVE-2026-32776, CVE-2026-32777, CVE-2026-32778 (expat)
RUN apk upgrade --no-cache libpng zlib expat

WORKDIR /app

# Install dependencies first (cached layer unless package files change)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build the app — no credentials needed at build time; they are injected at runtime
RUN npm run build

# ----- Stage 2: Serve with Nginx -----
FROM nginx:stable-alpine-slim

# Fix CVE-2026-25646, CVE-2026-33636, CVE-2026-33416 (libpng); CVE-2026-22184, CVE-2026-27171 (zlib); CVE-2026-32767, CVE-2026-32776, CVE-2026-32777, CVE-2026-32778 (expat); CVE-2026-27654, CVE-2026-27651, CVE-2026-27784, CVE-2026-32647, CVE-2026-28753, CVE-2026-28755 (nginx)
RUN apk upgrade --no-cache libpng zlib expat nginx

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom config and built assets
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Entrypoint script replaces placeholder tokens in env-config.js with real runtime env vars
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8085

ENTRYPOINT ["/docker-entrypoint.sh"]
