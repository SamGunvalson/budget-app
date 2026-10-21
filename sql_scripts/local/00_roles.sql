-- Run as the database owner/superuser; psql variables are supplied by init.sh.
SELECT format('CREATE ROLE %I %s', role_name, options)
FROM (VALUES
  ('anon', 'NOLOGIN'),
  ('authenticated', 'NOLOGIN'),
  ('authenticator', 'LOGIN NOINHERIT'),
  ('auth_admin', 'LOGIN')
) AS roles(role_name, options)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
\gexec

ALTER ROLE anon NOLOGIN;
ALTER ROLE authenticated NOLOGIN;
ALTER ROLE authenticator LOGIN NOINHERIT;
ALTER ROLE auth_admin LOGIN;
SELECT format('ALTER ROLE authenticator PASSWORD %L', :'authenticator_password')
\gexec
SELECT format('ALTER ROLE auth_admin PASSWORD %L', :'auth_admin_password')
\gexec
GRANT anon, authenticated TO authenticator;
