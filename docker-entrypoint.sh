#!/bin/sh
set -e

# Replace placeholder tokens in the built env-config.js with actual runtime environment variables.
# This allows a single Docker image to work across different environments (dev, staging, prod)
# without baking credentials into the image at build time.

ENV_CONFIG=/usr/share/nginx/html/env-config.js

if [ ! -f "$ENV_CONFIG" ]; then
  echo "ERROR: $ENV_CONFIG not found." >&2
  exit 1
fi

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set." >&2
  exit 1
fi

sed -i "s|__SUPABASE_URL__|${SUPABASE_URL}|g" "$ENV_CONFIG"
sed -i "s|__SUPABASE_ANON_KEY__|${SUPABASE_ANON_KEY}|g" "$ENV_CONFIG"

exec nginx -g "daemon off;"
