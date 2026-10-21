#!/bin/sh
set -eu

: "${AUTHENTICATOR_PASSWORD:?AUTHENTICATOR_PASSWORD must be set and non-empty}"
: "${AUTH_ADMIN_PASSWORD:?AUTH_ADMIN_PASSWORD must be set and non-empty}"
: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
SQL_DIR=${SQL_DIR:-/sql_scripts}

while IFS= read -r script || [ -n "$script" ]; do
  case "$script" in
    ''|\#*) continue ;;
  esac
  printf 'Applying %s\n' "$script"
  psql -X -v ON_ERROR_STOP=1 \
    -v authenticator_password="$AUTHENTICATOR_PASSWORD" \
    -v auth_admin_password="$AUTH_ADMIN_PASSWORD" \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --file "$SQL_DIR/$script"
done < "$SQL_DIR/local/apply_order.txt"
