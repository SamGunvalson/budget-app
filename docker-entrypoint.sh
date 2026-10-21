#!/bin/sh
set -e

# Renders runtime config for a single image that serves both backends:
#   BACKEND_MODE=supabase (default) – SPA talks to Supabase directly
#   BACKEND_MODE=local              – nginx proxies /rest/v1 -> PostgREST and /auth/v1 -> auth service

ENV_CONFIG=/usr/share/nginx/html/env-config.js
SNIPPETS=/etc/nginx/snippets
TEMPLATES=/opt/nginx-templates

if [ ! -f "$ENV_CONFIG" ]; then
  echo "ERROR: $ENV_CONFIG not found." >&2
  exit 1
fi

BACKEND_MODE="${BACKEND_MODE:-supabase}"
case "$BACKEND_MODE" in
  supabase|local) ;;
  *) echo "ERROR: BACKEND_MODE must be 'supabase' or 'local' (got '$BACKEND_MODE')." >&2; exit 1 ;;
esac

if [ "$BACKEND_MODE" = "supabase" ]; then
  if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
    echo "ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set when BACKEND_MODE=supabase." >&2
    exit 1
  fi
  CSP_CONNECT_SRC="'self' https://*.supabase.co wss://*.supabase.co"
else
  SUPABASE_URL=""
  SUPABASE_ANON_KEY=""
  CSP_CONNECT_SRC="'self'"
fi

sed -i "s|__BACKEND_MODE__|${BACKEND_MODE}|g" "$ENV_CONFIG"
sed -i "s|__SUPABASE_URL__|${SUPABASE_URL}|g" "$ENV_CONFIG"
sed -i "s|__SUPABASE_ANON_KEY__|${SUPABASE_ANON_KEY}|g" "$ENV_CONFIG"

mkdir -p "$SNIPPETS"
sed "s|__CSP_CONNECT_SRC__|${CSP_CONNECT_SRC}|" "$TEMPLATES/security-headers.conf.template" > "$SNIPPETS/security-headers.conf"
cp "$TEMPLATES/cors.conf" "$SNIPPETS/cors.conf"

if [ "$BACKEND_MODE" = "local" ]; then
  export POSTGREST_UPSTREAM="${POSTGREST_UPSTREAM:-postgrest:3000}"
  export AUTH_UPSTREAM="${AUTH_UPSTREAM:-auth:3001}"
  envsubst '${POSTGREST_UPSTREAM} ${AUTH_UPSTREAM}' < "$TEMPLATES/local-proxy.conf.template" > "$SNIPPETS/local-proxy.conf"
else
  : > "$SNIPPETS/local-proxy.conf"
fi

nginx -t
exec nginx -g "daemon off;"
