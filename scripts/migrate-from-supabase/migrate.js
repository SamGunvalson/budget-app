#!/usr/bin/env node
// Copies auth.users + every public table from a Supabase Postgres into the
// self-hosted Postgres. Source is only read (READ ONLY REPEATABLE READ snapshot).
import { parseArgs } from "node:util";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { to as copyTo, from as copyFrom } from "pg-copy-streams";

const { values: args } = parseArgs({
  options: {
    source: { type: "string" },
    target: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    truncate: { type: "boolean", default: false },
    "skip-passwordless": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (args.help) {
  console.log(`Usage: node migrate.js --source <url> --target <url> [--dry-run] [--truncate] [--skip-passwordless]

  --source / SOURCE_DATABASE_URL   Supabase direct Postgres connection string (read-only use)
  --target / TARGET_DATABASE_URL   Local Postgres superuser connection string
  --dry-run                        Print the plan and row counts; write nothing
  --truncate                       Empty target public tables and auth.users first
  --skip-passwordless              Import users without a password (unusable hash '!')`);
  process.exit(0);
}

const sourceUrl = args.source || process.env.SOURCE_DATABASE_URL;
const targetUrl = args.target || process.env.TARGET_DATABASE_URL;
const dryRun = args["dry-run"];
if (!sourceUrl || !targetUrl) {
  console.error("Both --source/SOURCE_DATABASE_URL and --target/TARGET_DATABASE_URL are required.");
  process.exit(2);
}

const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;
const AMOUNT_RE = /amount|cents|balance|price|total|cost/i;
const INT_TYPES = new Set(["int2", "int4", "int8"]);

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn("WARN:", ...a);

class Abort extends Error {}

async function listColumns(client, schema, table) {
  const { rows } = await client.query(
    `SELECT a.attname AS name, t.typname AS type
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = $1 AND c.relname = $2
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      ORDER BY a.attnum`,
    [schema, table],
  );
  return rows;
}

async function listTables(client) {
  const { rows } = await client.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      ORDER BY c.relname`,
  );
  return rows.map((r) => r.relname);
}

// Kahn's algorithm over target FKs; self-references are ignored.
async function topoOrder(target, tables) {
  const { rows } = await target.query(
    `SELECT cl.relname AS child, pl.relname AS parent
       FROM pg_constraint k
       JOIN pg_class cl ON cl.oid = k.conrelid
       JOIN pg_class pl ON pl.oid = k.confrelid
       JOIN pg_namespace cn ON cn.oid = cl.relnamespace
       JOIN pg_namespace pn ON pn.oid = pl.relnamespace
      WHERE k.contype = 'f' AND cn.nspname = 'public' AND pn.nspname = 'public'`,
  );
  const set = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of rows) {
    if (child !== parent && set.has(child) && set.has(parent)) deps.get(child).add(parent);
  }
  const order = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter((t) => [...deps.get(t)].every((d) => !remaining.has(d))).sort();
    if (!ready.length) {
      const rest = [...remaining].sort();
      warn(`FK cycle among: ${rest.join(", ")}; relying on session_replication_role=replica`);
      order.push(...rest);
      break;
    }
    for (const t of ready) {
      order.push(t);
      remaining.delete(t);
    }
  }
  return order;
}

async function count(client, schema, table) {
  const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM ${qi(schema)}.${qi(table)}`);
  return BigInt(rows[0].n);
}

async function sums(client, schema, table, cols) {
  if (!cols.length) return {};
  const sel = cols.map((c, i) => `coalesce(sum(${qi(c)})::numeric, 0)::text AS c${i}`).join(", ");
  const { rows } = await client.query(`SELECT ${sel} FROM ${qi(schema)}.${qi(table)}`);
  return Object.fromEntries(cols.map((c, i) => [c, rows[0][`c${i}`]]));
}

async function copyTable(source, target, srcQuery, destTable, destCols) {
  const out = source.query(copyTo(`COPY (${srcQuery}) TO STDOUT`));
  const inn = target.query(copyFrom(`COPY ${destTable} (${destCols.map(qi).join(", ")}) FROM STDIN`));
  await pipeline(out, inn);
  return inn.rowCount;
}

async function checkSourceUsers(source) {
  const { rows: coll } = await source.query(
    `SELECT lower(email) AS e, count(*)::int AS n FROM auth.users
      WHERE email IS NOT NULL GROUP BY 1 HAVING count(*) > 1`,
  );
  if (coll.length) {
    throw new Abort(
      `${coll.length} email(s) collide after lowercasing (${coll.reduce((s, r) => s + r.n, 0)} users). ` +
        `Resolve in Supabase first. Colliding addresses:\n  ` +
        coll.map((r) => r.e).join("\n  "),
    );
  }
  const { rows: pwless } = await source.query(
    `SELECT id FROM auth.users
      WHERE email IS NULL OR email = '' OR encrypted_password IS NULL OR encrypted_password = ''
      ORDER BY created_at`,
  );
  if (pwless.length) {
    const ids = pwless.map((r) => r.id).join("\n  ");
    if (!args["skip-passwordless"]) {
      throw new Abort(
        `${pwless.length} user(s) have no password or no email (e.g. OAuth/magic-link only):\n  ${ids}\n` +
          `Their public rows reference them, so they cannot simply be skipped. Re-run with --skip-passwordless ` +
          `to import them with an unusable password ('!'; users without an email get <id>@migrated.invalid), ` +
          `then reset passwords with the server/auth CLI 'reset-password'.`,
      );
    }
    warn(`${pwless.length} user(s) imported with an unusable password; reset via server/auth CLI reset-password:\n  ${ids}`);
  }
  return pwless.length;
}

const USERS_SELECT =
  `SELECT id, lower(coalesce(nullif(email, ''), id::text || '@migrated.invalid')), ` +
  `coalesce(nullif(encrypted_password, ''), '!'), coalesce(created_at, now()), ` +
  `coalesce(updated_at, created_at, now()), last_sign_in_at FROM auth.users ORDER BY created_at`;
const USERS_COLS = ["id", "email", "encrypted_password", "created_at", "updated_at", "last_sign_in_at"];

async function orphanReport(target) {
  const { rows: fks } = await target.query(
    `SELECT k.conname, cn.nspname AS cs, cl.relname AS ct, pn.nspname AS ps, pl.relname AS pt,
            (SELECT array_agg(a.attname::text ORDER BY u.ord) FROM unnest(k.conkey) WITH ORDINALITY u(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum) AS ccols,
            (SELECT array_agg(a.attname::text ORDER BY u.ord) FROM unnest(k.confkey) WITH ORDINALITY u(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.attnum) AS pcols
       FROM pg_constraint k
       JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_namespace cn ON cn.oid = cl.relnamespace
       JOIN pg_class pl ON pl.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = pl.relnamespace
      WHERE k.contype = 'f' AND cn.nspname IN ('public', 'auth')`,
  );
  const bad = [];
  for (const f of fks) {
    const notNull = f.ccols.map((c) => `c.${qi(c)} IS NOT NULL`).join(" AND ");
    const join = f.ccols.map((c, i) => `p.${qi(f.pcols[i])} = c.${qi(c)}`).join(" AND ");
    const { rows } = await target.query(
      `SELECT count(*)::int AS n FROM ${qi(f.cs)}.${qi(f.ct)} c
        WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${qi(f.ps)}.${qi(f.pt)} p WHERE ${join})`,
    );
    if (rows[0].n) bad.push(`${f.cs}.${f.ct} (${f.conname}): ${rows[0].n} orphan row(s)`);
  }
  return { checked: fks.length, bad };
}

async function resetSequences(target) {
  const { rows } = await target.query(
    `SELECT n.nspname AS s, c.relname AS t, a.attname AS col,
            pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) AS seq
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`,
  );
  let n = 0;
  for (const r of rows.filter((x) => x.seq)) {
    await target.query(
      `SELECT setval($1, coalesce((SELECT max(${qi(r.col)}) FROM ${qi(r.s)}.${qi(r.t)}), 1),
              (SELECT max(${qi(r.col)}) FROM ${qi(r.s)}.${qi(r.t)}) IS NOT NULL)`,
      [r.seq],
    );
    n++;
  }
  return n;
}

function printTable(headers, rows) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join("  ");
  log(line(headers));
  log(w.map((x) => "-".repeat(x)).join("  "));
  rows.forEach((r) => log(line(r)));
}

async function main() {
  const source = new pg.Client({ connectionString: sourceUrl });
  const target = new pg.Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();
  let committed = false;
  try {
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await target.query("BEGIN");

    const { rows: su } = await target.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    if (!su[0]?.rolsuper) throw new Abort("Target connection must be a superuser (needed for session_replication_role).");

    const srcTables = await listTables(source);
    const tgtTables = new Set(await listTables(target));
    const common = srcTables.filter((t) => tgtTables.has(t));
    for (const t of srcTables) if (!tgtTables.has(t)) warn(`public.${t} exists in source but not in target; NOT copied`);
    for (const t of tgtTables) if (!srcTables.includes(t)) warn(`public.${t} exists in target but not in source; left empty`);
    const order = await topoOrder(target, common);

    const passwordless = await checkSourceUsers(source);

    // Plan: column intersection per table
    const plan = [];
    for (const t of order) {
      const sc = await listColumns(source, "public", t);
      const tc = await listColumns(target, "public", t);
      const tNames = new Set(tc.map((c) => c.name));
      const sNames = new Set(sc.map((c) => c.name));
      const cols = sc.filter((c) => tNames.has(c.name));
      for (const c of sc) if (!tNames.has(c.name)) warn(`public.${t}.${c.name} only in source; dropped`);
      for (const c of tc) if (!sNames.has(c.name)) warn(`public.${t}.${c.name} only in target; will use its default`);
      plan.push({ table: t, cols: cols.map((c) => c.name), amountCols: cols.filter((c) => INT_TYPES.has(c.type) && AMOUNT_RE.test(c.name)).map((c) => c.name) });
    }

    // Target emptiness
    const nonEmpty = [];
    const tAuth = await count(target, "auth", "users");
    if (tAuth) nonEmpty.push(["auth.users", tAuth]);
    for (const t of tgtTables) {
      const n = await count(target, "public", t);
      if (n) nonEmpty.push([`public.${t}`, n]);
    }
    if (nonEmpty.length && !args.truncate) {
      throw new Abort(
        `Target is not empty (${nonEmpty.map(([t, n]) => `${t}=${n}`).join(", ")}). ` +
          `Re-run with --truncate to wipe it first, or use a fresh volume.`,
      );
    }

    const srcUsers = await count(source, "auth", "users");
    const srcCounts = new Map();
    for (const p of plan) srcCounts.set(p.table, await count(source, "public", p.table));

    log(`Plan: auth.users (${srcUsers}${passwordless ? `, ${passwordless} passwordless` : ""}) then ${order.length} public tables`);
    printTable(["order", "table", "source rows", "columns"], [
      ["0", "auth.users", srcUsers, USERS_COLS.length],
      ...plan.map((p, i) => [i + 1, `public.${p.table}`, srcCounts.get(p.table), p.cols.length]),
    ]);
    if (nonEmpty.length) log(`Target has existing rows; --truncate will remove them.`);
    if (dryRun) {
      log("\nDry run: nothing written.");
      return;
    }

    await target.query("SET LOCAL session_replication_role = replica");
    if (nonEmpty.length) {
      const all = ["auth.users", ...[...tgtTables].map((t) => `public.${qi(t)}`)];
      await target.query(`TRUNCATE ${all.join(", ")} CASCADE`);
      log("Target truncated.");
    }

    log("\nCopying...");
    await copyTable(source, target, USERS_SELECT, "auth.users", USERS_COLS);
    for (const p of plan) {
      const n = await copyTable(
        source,
        target,
        `SELECT ${p.cols.map(qi).join(", ")} FROM public.${qi(p.table)}`,
        `public.${qi(p.table)}`,
        p.cols,
      );
      log(`  public.${p.table}: ${n}`);
    }
    const seqs = await resetSequences(target);
    if (seqs) log(`Reset ${seqs} sequence(s).`);

    // Verification (still inside the target transaction)
    const report = [];
    let ok = true;
    const tu = await count(target, "auth", "users");
    report.push(["auth.users", srcUsers, tu, "", tu === srcUsers ? "OK" : "MISMATCH"]);
    if (tu !== srcUsers) ok = false;
    for (const p of plan) {
      const s = srcCounts.get(p.table);
      const t = await count(target, "public", p.table);
      let status = s === t ? "OK" : "MISMATCH";
      const ss = await sums(source, "public", p.table, p.amountCols);
      const ts = await sums(target, "public", p.table, p.amountCols);
      const badSums = p.amountCols.filter((c) => ss[c] !== ts[c]);
      if (badSums.length) status = "MISMATCH";
      if (status !== "OK") ok = false;
      report.push([
        `public.${p.table}`,
        s,
        t,
        p.amountCols.map((c) => `${c}=${ts[c]}${ss[c] === ts[c] ? "" : `(src ${ss[c]})`}`).join(" "),
        status,
      ]);
    }
    const orphans = await orphanReport(target);
    log("\nVerification:");
    printTable(["table", "source", "target", "sums", "status"], report);
    log(`FK check: ${orphans.checked} constraint(s), ${orphans.bad.length} with orphans`);
    orphans.bad.forEach((b) => log(`  ${b}`));
    if (orphans.bad.length) ok = false;

    if (!ok) throw new Abort("Verification failed; target transaction rolled back.");
    await target.query("COMMIT");
    committed = true;
    log("\nMigration committed.");
  } finally {
    if (!committed) await target.query("ROLLBACK").catch(() => {});
    await source.query("ROLLBACK").catch(() => {});
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\nERROR: ${err instanceof Abort ? "" : `${err.code || ""} `}${err.message}`);
  process.exit(1);
});
