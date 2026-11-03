import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const sqlDirectory = resolve(fileURLToPath(new URL('../sql_scripts/', import.meta.url)));
const setupScripts = [
  'supabase_schema_create.sql',
  'supabase_split_expenses.sql',
  'supabase_add_updated_at.sql',
  'supabase_category_archiving.sql',
  'supabase_phase3_aggregations.sql',
  'supabase_phase4_mutations.sql',
  'supabase_rls_complete.sql',
];
const migrationScripts = [
  'supabase_accounts_closed.sql',
  'supabase_asymmetric_transfer.sql',
  'supabase_custom_interval.sql',
  'supabase_partnership_seen.sql',
  'supabase_recurring_occurrence_date.sql',
  'supabase_split_dedup.sql',
  'supabase_split_fix_rls.sql',
  'supabase_split_recurring.sql',
  'supabase_transactions_soft_delete_rls.sql',
];
const readSqlFile = (file) => readFileSync(join(sqlDirectory, file), 'utf8');
const applyOrder = readSqlFile('local/apply_order.txt').split('\n')
  .filter((line) => line && !line.startsWith('#'));

test('fresh setup contains all current scripts and no historical repairs', () => {
  assert.deepEqual(readdirSync(sqlDirectory).filter((file) => file.endsWith('.sql')).sort(),
    [...setupScripts].sort());
  assert.deepEqual(readdirSync(join(sqlDirectory, 'migrations'))
    .filter((file) => file.endsWith('.sql')).sort(), migrationScripts);
  assert.deepEqual(applyOrder, [
    'local/00_roles.sql',
    'local/01_auth_schema.sql',
    ...setupScripts,
    'local/99_grants.sql',
  ]);
  for (const file of applyOrder) {
    assert.ok(existsSync(join(sqlDirectory, file)), `Missing setup file: ${file}`);
  }
  const documentedOrder = [...readSqlFile('README.md')
    .matchAll(/^\d+\. \[[^\]]+\]\(\.\/([^)]*\.sql)\)/gm)].map((match) => match[1]);
  assert.deepEqual(documentedOrder, setupScripts);
});

test('base occurrence lookup index matches the retained upgrade definition', () => {
  const index = /CREATE INDEX(?: IF NOT EXISTS)? idx_transactions_recurring_occurrence\s+ON transactions\([^;]+;/;
  const base = readSqlFile('supabase_schema_create.sql').match(index)?.[0];
  const migration = readSqlFile('migrations/supabase_recurring_occurrence_date.sql').match(index)?.[0];
  assert.ok(base);
  assert.ok(migration);
  const normalize = (sql) => sql.replace(' IF NOT EXISTS', '').replace(/\s+/g, ' ');
  assert.equal(normalize(base), normalize(migration));
});

test('legacy repair include resolves and database image bundles historical migrations', () => {
  const include = readSqlFile('local/98_local_fixes.sql').match(/^\\ir (.+)$/m)?.[1];
  assert.ok(include);
  assert.equal(resolve(sqlDirectory, 'local', include),
    join(sqlDirectory, 'migrations/supabase_transactions_soft_delete_rls.sql'));
  assert.ok(existsSync(resolve(sqlDirectory, 'local', include)));
  const dockerfile = readSqlFile('Dockerfile');
  assert.match(dockerfile, /^COPY \*\.sql \/sql_scripts\/$/m);
  assert.match(dockerfile, /^COPY migrations\/ \/sql_scripts\/migrations\/$/m);
  assert.match(dockerfile, /^COPY local\/ \/sql_scripts\/local\/$/m);
});

test('fresh base already supplies the soft-delete RPC and grants from the legacy repair', () => {
  const rpc = /CREATE OR REPLACE FUNCTION public\.soft_delete_transaction\(txn_id uuid\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.soft_delete_transaction\(uuid\) TO authenticated;/;
  const base = readSqlFile('supabase_schema_create.sql').match(rpc)?.[0];
  const migration = readSqlFile('migrations/supabase_transactions_soft_delete_rls.sql').match(rpc)?.[0];
  assert.ok(base);
  assert.ok(migration);
  assert.equal(base, migration);
});

function runInitializer(failAt) {
  const directory = mkdtempSync(join(tmpdir(), 'budget-sql-layout-'));
  const executable = join(directory, 'psql');
  const log = join(directory, 'calls.jsonl');
  writeFileSync(executable, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.SQL_TEST_LOG, JSON.stringify(args) + '\\n');
if (args.includes(process.env.SQL_TEST_FAIL_AT)) process.exit(7);
`, { mode: 0o755 });
  try {
    const result = spawnSync('sh', [join(sqlDirectory, 'local/init.sh')], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        SQL_DIR: sqlDirectory,
        POSTGRES_USER: 'fixture-owner',
        POSTGRES_DB: 'fixture-db',
        AUTHENTICATOR_PASSWORD: 'fixture-authenticator',
        AUTH_ADMIN_PASSWORD: 'fixture-auth-admin',
        SQL_TEST_LOG: log,
        SQL_TEST_FAIL_AT: failAt ? join(sqlDirectory, failAt) : '',
      },
    });
    assert.ifError(result.error);
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      : [];
    return { ...result, calls };
  } finally {
    if (existsSync(log)) unlinkSync(log);
    unlinkSync(executable);
    rmdirSync(directory);
  }
}

test('initializer invokes psql in dependency order from an unrelated working directory', () => {
  const result = runInitializer();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.map((args) => args[args.indexOf('--file') + 1]),
    applyOrder.map((file) => join(sqlDirectory, file)));
  for (const args of result.calls) {
    assert.ok(args.includes('ON_ERROR_STOP=1'));
    assert.ok(args.includes('fixture-owner'));
    assert.ok(args.includes('fixture-db'));
    assert.ok(args.includes('authenticator_password=fixture-authenticator'));
    assert.ok(args.includes('auth_admin_password=fixture-auth-admin'));
  }
});

test('initializer stops immediately when a setup script fails', () => {
  const failedScript = 'supabase_add_updated_at.sql';
  const result = runInitializer(failedScript);
  assert.equal(result.status, 7, result.stderr);
  assert.equal(result.calls.length, applyOrder.indexOf(failedScript) + 1);
  assert.equal(result.calls.at(-1).at(-1), join(sqlDirectory, failedScript));
});
