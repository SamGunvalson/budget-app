#!/bin/sh
set -e

# Renders nginx snippets, then starts nginx. nginx serves the SPA and proxies
# /rest/v1 -> PostgREST and /auth/v1 -> the auth service.

SNIPPETS=/etc/nginx/snippets
TEMPLATES=/opt/nginx-templates

mkdir -p "$SNIPPETS"
cp "$TEMPLATES/security-headers.conf.template" "$SNIPPETS/security-headers.conf"
cp "$TEMPLATES/cors.conf" "$SNIPPETS/cors.conf"

export POSTGREST_UPSTREAM="${POSTGREST_UPSTREAM:-postgrest:3000}"
export AUTH_UPSTREAM="${AUTH_UPSTREAM:-auth:3001}"
envsubst '${POSTGREST_UPSTREAM} ${AUTH_UPSTREAM}' < "$TEMPLATES/local-proxy.conf.template" > "$SNIPPETS/local-proxy.conf"

nginx -t
exec nginx -g "daemon off;"
