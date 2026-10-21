# Budget App Auth Service

Standalone Fastify service issuing HS256 JWTs (compatible with PostgREST using the same `JWT_SECRET`). Uses tables `auth.users` and `auth.refresh_tokens` only, connecting as `auth_admin`.

## Environment

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | – (required) | Postgres connection as `auth_admin` |
| `JWT_SECRET` | – (required) | ≥ 32 bytes, else refuses to start |
| `AUTH_ISSUER` | `budget-app-auth` | `iss` claim |
| `ACCESS_TOKEN_TTL` | `900` | seconds |
| `REFRESH_TOKEN_TTL` | `2592000` | seconds (30 d) |
| `ALLOW_SIGNUP` | `true` | `false` → signup returns 403 |
| `PASSWORD_MIN_LENGTH` | `8` | max is 72 bytes |
| `BCRYPT_COST` | `12` | |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | |
| `TRUST_PROXY` | `true` | set `false` if not behind a proxy |
| `RATE_LIMIT_MAX` | `100` | per IP per window, global |
| `AUTH_RATE_LIMIT_MAX` | `10` | per IP per window on `/token`, `/signup`, `/user/password` |
| `RATE_LIMIT_WINDOW_MS` | `60000` | |
| `LOGIN_FAIL_MAX` / `LOGIN_FAIL_WINDOW_MS` | `5` / `900000` | per-email failed-login lockout (in memory) |
| `LOG_LEVEL` | `info` | |

## Endpoints (`/auth/v1`)

- `GET /health` → `{ok, signupEnabled}`
- `POST /signup` `{email, password}` → 201 Session
- `POST /token` `{grant_type:"password", email, password}` or `{grant_type:"refresh_token", refresh_token}` → Session (refresh tokens rotate; reuse revokes the family)
- `POST /logout` `{refresh_token}` → 204
- `GET /user` (Bearer) → `{id, email, created_at}`
- `PUT /user/password` (Bearer) `{current_password, new_password, refresh_token?}` → 204; revokes all other sessions

Session: `{access_token, token_type:"bearer", expires_in, expires_at, refresh_token, user}`.
Errors: `{error:{code,message}}` (400/401/403/404/409/429/500). Codes include `invalid_credentials`, `invalid_grant`, `user_exists`, `signup_disabled`, `too_many_attempts`, `rate_limited`.

## CLI

```
DATABASE_URL=... npm run cli -- create-user you@example.com --password 'secret123'
echo 'newpass123' | DATABASE_URL=... npm run cli -- reset-password you@example.com
```
`reset-password` also revokes all refresh tokens.

## Tests

`npm test` — uses `TEST_DATABASE_URL` if set, otherwise starts a throwaway `postgres:16-alpine` Docker container (removed afterwards).
