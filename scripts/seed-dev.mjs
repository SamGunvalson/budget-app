#!/usr/bin/env node
/**
 * Dev seed: creates a test user (plus a split partner) on a LOCAL self-hosted
 * stack and fills it with ~4 months of realistic data, so `npm run dev` has
 * something to log in to and look at.
 *
 * Goes through the real HTTP API (auth signup → PostgREST as that user), so
 * RLS, triggers, and constraints apply exactly as they do for the app.
 *
 *   npm run seed:dev                       # dev@example.test / devpassword
 *   npm run seed:dev -- --email me2@example.test
 *   npm run seed:dev -- --target http://localhost:8085 --no-partner
 *
 * Target: --target, else SEED_API_TARGET, else DEV_API_PROXY_TARGET /
 * VITE_API_ORIGIN from .env, else http://localhost:8085. Non-local targets
 * are refused unless --allow-remote is passed, so this never writes junk data
 * into a real server by accident.
 *
 * Re-running for a user that already has categories does nothing; pick a new
 * --email, or wipe the stack (`docker compose --env-file .env.selfhost down -v`).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { COLOR_FAMILIES } from '../src/constants/palette.js';

// ── Args & config ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag('help')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

function readDotEnv() {
  try {
    const out = {};
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}
const dotenv = readDotEnv();
const TARGET = (
  opt('target') ||
  process.env.SEED_API_TARGET ||
  dotenv.VITE_API_ORIGIN ||
  dotenv.DEV_API_PROXY_TARGET ||
  'http://localhost:8085'
).replace(/\/+$/, '');
const EMAIL = opt('email') || process.env.SEED_EMAIL || 'dev@example.test';
const PASSWORD = opt('password') || process.env.SEED_PASSWORD || 'devpassword';
const PARTNER_EMAIL = opt('partner-email') || EMAIL.replace('@', '+partner@');
const WITH_PARTNER = !flag('no-partner');

const host = new URL(TARGET).hostname;
const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal'].includes(host);
if (!isLocal && !flag('allow-remote')) {
  console.error(`Refusing to seed non-local target ${TARGET}.\nPass --allow-remote if this really is a throwaway server.`);
  process.exit(1);
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function http(path, { method = 'GET', body, token, prefer } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  let res;
  try {
    res = await fetch(`${TARGET}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    throw new Error(`Cannot reach ${TARGET} (${err.cause?.code || err.message}). Is the stack running?\n` +
      '  docker compose --env-file .env.selfhost up -d', { cause: err });
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.message || data?.error_description || data?.error || text;
    const e = new Error(`${method} ${path} → ${res.status}: ${msg}`);
    e.status = res.status;
    e.code = data?.code || data?.error;
    throw e;
  }
  return data;
}

const rest = (token) => ({
  get: (path) => http(`/rest/v1/${path}`, { token }),
  insert: (table, rows) =>
    http(`/rest/v1/${table}`, { method: 'POST', body: rows, token, prefer: 'return=representation' }),
  patch: (path, body) =>
    http(`/rest/v1/${path}`, { method: 'PATCH', body, token, prefer: 'return=representation' }),
});

async function session(email, password) {
  try {
    return { ...(await http('/auth/v1/token', { method: 'POST', body: { grant_type: 'password', email, password } })), created: false };
  } catch (err) {
    if (err.status !== 401) throw err;
  }
  try {
    return { ...(await http('/auth/v1/signup', { method: 'POST', body: { email, password } })), created: true };
  } catch (err) {
    if (err.code === 'signup_disabled') {
      throw new Error(`${email} does not exist and signups are disabled. Set ALLOW_SIGNUP=true in .env.selfhost and recreate the stack.`, { cause: err });
    }
    if (err.code === 'user_exists') throw new Error(`${email} exists with a different password. Pass --password.`, { cause: err });
    throw err;
  }
}

// ── Deterministic randomness, so every seed looks the same ───────────────────
let seed = 20261127;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const between = (lo, hi) => Math.round(lo + rand() * (hi - lo)); // cents
const pick = (list) => list[Math.floor(rand() * list.length)];

// ── Dates (local, YYYY-MM-DD) ────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
today.setHours(0, 0, 0, 0);
const start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
const horizon = new Date(today);
horizon.setDate(horizon.getDate() + 21); // projected items for the cashflow forecast
const days = [];
for (const d = new Date(start); d <= horizon; d.setDate(d.getDate() + 1)) days.push(new Date(d));
const statusFor = (d) => (d > today ? 'projected' : 'posted');

// ── Palette helpers ──────────────────────────────────────────────────────────
const fam = Object.fromEntries(COLOR_FAMILIES.map((f) => [f.id, f.shades]));
const [PALE, LIGHT, MID, DEEP] = [0, 1, 2, 3];

/*
 * Categories are grouped by color family the way a user would (Food = rose,
 * Home = clay, Getting around = blue …). A few keep OLD Tailwind preset colors
 * or a custom hex, so Categories → Colors shows its "not in the palette"
 * update banner.
 */
const CATEGORIES = [
  ['Salary', 'income', fam.jade[MID]],
  ['Side Gigs', 'income', fam.jade[LIGHT]],
  ['Interest', 'income', fam.jade[PALE]],
  ['Rent', 'needs', fam.clay[DEEP]],
  ['Utilities', 'needs', fam.clay[MID]],
  ['Internet & Phone', 'needs', fam.clay[LIGHT]],
  ['Groceries', 'needs', fam.rose[DEEP]],
  ['Gas', 'needs', fam.blue[DEEP]],
  ['Transit', 'needs', fam.blue[LIGHT]],
  ['Insurance', 'needs', fam.stone[DEEP]],
  ['Health', 'needs', '#EF4444'], // legacy red preset
  ['Dining Out', 'wants', fam.rose[MID]],
  ['Coffee', 'wants', fam.rose[LIGHT]],
  ['Entertainment', 'wants', fam.violet[MID]],
  ['Streaming', 'wants', '#8B5CF6'], // legacy violet preset
  ['Shopping', 'wants', fam.orchid[MID]],
  ['Gifts', 'wants', '#EC4899'], // legacy pink preset
  ['Pets', 'wants', '#F59E0B'], // legacy amber preset
  ['Garden', 'wants', '#22c55e'], // custom off-palette hex
  ['Emergency Fund', 'savings', fam.teal[MID]],
  ['Vacation Fund', 'savings', fam.teal[LIGHT]],
  ['Retirement', 'savings', fam.teal[DEEP]],
  ['Account Transfer', 'transfer', fam.stone[MID]],
];

const ACCOUNTS = [
  { key: 'checking', name: 'Everyday Checking', type: 'checking', starting_balance: 420000 },
  { key: 'savings', name: 'High-Yield Savings', type: 'savings', starting_balance: 1250000 },
  { key: 'card', name: 'Rewards Visa', type: 'credit_card', starting_balance: 0, statement_close_day: 22, payment_due_day: 17 },
  { key: 'brokerage', name: 'Index Brokerage', type: 'brokerage', starting_balance: 3480000 },
  { key: 'retirement', name: '401(k)', type: 'retirement', starting_balance: 6125000 },
];

// Monthly plan amounts (cents) for budget_items.
const PLAN = {
  Rent: 185000, Utilities: 16000, 'Internet & Phone': 12000, Groceries: 65000, Gas: 18000,
  Transit: 6000, Insurance: 14500, Health: 8000, 'Dining Out': 30000, Coffee: 6000,
  Entertainment: 12000, Streaming: 4500, Shopping: 20000, Gifts: 7500, Pets: 9000,
  Garden: 4000, 'Emergency Fund': 40000, 'Vacation Fund': 25000, Retirement: 50000,
};

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const health = await http('/auth/v1/health');
  console.log(`Seeding ${TARGET} (signups ${health.signupEnabled ? 'enabled' : 'disabled'})`);

  const me = await session(EMAIL, PASSWORD);
  const api = rest(me.access_token);
  const userId = me.user.id;
  console.log(`${me.created ? 'Created' : 'Logged in as'} ${EMAIL}`);

  const existingAccounts = await api.get('accounts?select=id&limit=1');
  if (existingAccounts.length > 0) {
    console.log(`${EMAIL} already has data; nothing to do.\nUse --email <new address>, or wipe the stack with: docker compose --env-file .env.selfhost down -v`);
    return;
  }

  // Categories (reused if an earlier run stopped after creating them)
  const seedNames = new Set(CATEGORIES.map(([name]) => name));
  const prior = (await api.get('categories?select=id,name&is_active=eq.true')).filter((c) => seedNames.has(c.name));
  const missing = CATEGORIES.filter(([name]) => !prior.some((c) => c.name === name));
  const created = missing.length === 0 ? [] : await api.insert('categories', missing.map(([name, type, color]) => ({
    user_id: userId, name, type, color, sort_order: CATEGORIES.findIndex(([n]) => n === name),
  })));
  const cat = Object.fromEntries([...prior, ...created].map((c) => [c.name, c.id]));
  console.log(`  ${created.length} categories${prior.length ? ` (+${prior.length} from an earlier run)` : ''}`);

  // Accounts (card is paid from checking)
  // PostgREST bulk inserts need identical keys on every row.
  const accts = await api.insert('accounts', ACCOUNTS.map(({ key: _key, ...a }) => ({
    user_id: userId, statement_close_day: null, payment_due_day: null, ...a,
  })));
  const acct = Object.fromEntries(ACCOUNTS.map((a, i) => [a.key, accts[i].id]));
  await api.patch(`accounts?id=eq.${acct.card}`, { payment_account_id: acct.checking });
  console.log(`  ${accts.length} accounts`);

  // Transactions
  const txns = [];
  const add = (d, account, category, amount, description, { income = false, payee = null, group = null } = {}) => {
    txns.push({
      user_id: userId, account_id: acct[account], category_id: cat[category], amount, description, payee,
      transaction_date: ymd(d), is_income: income, status: statusFor(d), transfer_group_id: group,
    });
  };
  const transfer = (d, from, to, amount, description) => {
    const group = randomUUID();
    add(d, from, 'Account Transfer', amount, description, { group });
    add(d, to, 'Account Transfer', amount, description, { income: true, group });
  };

  const firstFriday = days.findIndex((d) => d.getDay() === 5);
  days.forEach((d, i) => {
    const dom = d.getDate();
    const dow = d.getDay();
    if (i >= firstFriday && (i - firstFriday) % 14 === 0) {
      add(d, 'checking', 'Salary', 286450, 'Payroll deposit', { income: true, payee: 'Acme Corp' });
      transfer(d, 'checking', 'savings', 40000, 'Emergency fund contribution');
    }
    if (dom === 1) add(d, 'checking', 'Rent', 185000, 'Rent', { payee: 'Maple Court Apartments' });
    if (dom === 3) add(d, 'card', 'Streaming', 1599, 'Streaming subscription', { payee: 'StreamFlix' });
    if (dom === 5) add(d, 'card', 'Streaming', 1099, 'Music subscription', { payee: 'Tunely' });
    if (dom === 8) add(d, 'checking', 'Insurance', 14250, 'Auto insurance', { payee: 'Safeguard Mutual' });
    if (dom === 12) add(d, 'checking', 'Utilities', between(9500, 16500), 'Electric bill', { payee: 'City Power' });
    if (dom === 14) add(d, 'card', 'Internet & Phone', 11999, 'Internet + phone', { payee: 'FiberNet' });
    if (dom === 15) {
      transfer(d, 'checking', 'retirement', 50000, 'Retirement contribution');
      transfer(d, 'checking', 'savings', 25000, 'Vacation savings');
    }
    if (dom === 17) {
      // Pay the card from checking (statement payment)
      transfer(d, 'checking', 'card', between(90000, 140000), 'Rewards Visa payment');
    }
    if (dom === 20) add(d, 'checking', 'Utilities', between(3500, 6000), 'Water & trash', { payee: 'City Utilities' });
    if (dom === 28) add(d, 'savings', 'Interest', between(3800, 4600), 'Interest paid', { income: true, payee: 'High-Yield Savings' });
    if (dow === 6) add(d, 'card', 'Groceries', between(9500, 18500), 'Weekly groceries', { payee: pick(['Green Basket', 'FreshMart', 'Corner Co-op']) });
    if (dow === 3 && rand() < 0.6) add(d, 'card', 'Groceries', between(1800, 4500), 'Grocery top-up', { payee: 'Corner Co-op' });
    if ((dow === 5 || dow === 6) && rand() < 0.7) add(d, 'card', 'Dining Out', between(2800, 9500), 'Dinner out', { payee: pick(['Luna Bistro', 'Taqueria Sol', 'Noodle Bar', 'Pizza Forno']) });
    if (dow >= 1 && dow <= 5 && rand() < 0.45) add(d, 'card', 'Coffee', between(450, 850), 'Coffee', { payee: pick(['Bean There', 'Daily Grind']) });
    if (dow === 2 && rand() < 0.8) add(d, 'card', 'Gas', between(3800, 6200), 'Fuel', { payee: pick(['QuickFuel', 'Shell Station']) });
    if (dow === 1 && rand() < 0.5) add(d, 'checking', 'Transit', 2500, 'Transit pass reload', { payee: 'Metro' });
    if (rand() < 0.06) add(d, 'card', 'Shopping', between(2500, 14000), 'Online order', { payee: pick(['ShopHub', 'Home Goods Co']) });
    if (rand() < 0.05) add(d, 'card', 'Entertainment', between(1500, 7500), pick(['Movie night', 'Concert tickets', 'Bowling']));
    if (rand() < 0.04) add(d, 'card', 'Pets', between(2500, 8000), 'Pet supplies', { payee: 'Paws & Claws' });
    if (rand() < 0.03) add(d, 'card', 'Garden', between(1500, 6000), 'Garden center', { payee: 'Bloom Nursery' });
    if (rand() < 0.03) add(d, 'card', 'Health', between(2000, 9000), 'Pharmacy', { payee: 'WellCare Pharmacy' });
    if (rand() < 0.025) add(d, 'card', 'Gifts', between(2500, 9000), 'Gift', { payee: 'ShopHub' });
    if (dom === 18 && d <= today) add(d, 'checking', 'Side Gigs', between(25000, 60000), 'Freelance invoice', { income: true, payee: 'Client LLC' });
  });
  // A spending credit (refund in a spending category) to exercise classification.
  const refundDay = days.find((d) => d.getDate() === 10 && d <= today) ?? today;
  add(refundDay, 'card', 'Shopping', 3499, 'Return refund', { income: true, payee: 'ShopHub' });

  for (let i = 0; i < txns.length; i += 200) await api.insert('transactions', txns.slice(i, i + 200));
  console.log(`  ${txns.length} transactions (${txns.filter((t) => t.status === 'projected').length} projected)`);

  // Budgets: one plan per month in range, with an allocation per spending category
  const months = [];
  for (let m = new Date(start); m <= today; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(m);
  const plans = await api.insert('budget_plans', months.map((m) => ({
    user_id: userId, month: m.getMonth() + 1, year: m.getFullYear(),
    name: m.toLocaleString('en-US', { month: 'long', year: 'numeric' }), total_income: 620000,
  })));
  await api.insert('budget_items', plans.flatMap((p) =>
    Object.entries(PLAN).map(([name, planned]) => ({ budget_plan_id: p.id, category_id: cat[name], planned_amount: planned })),
  ));
  console.log(`  ${plans.length} monthly budgets`);

  // Splits: partner account + active partnership + a few shared expenses
  if (WITH_PARTNER) {
    const partner = await session(PARTNER_EMAIL, PASSWORD);
    const papi = rest(partner.access_token);
    const [invite] = await api.insert('partnerships', [{ user_a_id: userId, invited_email: PARTNER_EMAIL }]);
    const [p] = await papi.patch(`partnerships?id=eq.${invite.id}&status=eq.pending`, {
      user_b_id: partner.user.id, status: 'active', updated_at: new Date().toISOString(),
    });
    const ago = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return ymd(d); };
    const split = (paidBy, description, total, payerShare, date, settlement = false) => ({
      partnership_id: p.id, paid_by_user_id: paidBy, description, total_amount: total,
      payer_share: payerShare, partner_share: total - payerShare, expense_date: date, is_settlement: settlement,
    });
    await api.insert('split_expenses', [
      split(userId, 'Groceries for the week', 14280, 7140, ago(40)),
      split(userId, 'Concert tickets', 18000, 9000, ago(26)),
      split(userId, 'Utilities (split 60/40)', 15500, 9300, ago(12)),
      split(userId, 'Dinner at Luna Bistro', 8640, 4320, ago(3)),
    ]);
    await papi.insert('split_expenses', [
      split(partner.user.id, 'Weekend cabin deposit', 32000, 16000, ago(33)),
      split(partner.user.id, 'Takeout', 4250, 2125, ago(8)),
      split(partner.user.id, 'Settle up', 5000, 5000, ago(20), true),
    ]);
    console.log(`  partner ${PARTNER_EMAIL} + 7 split expenses`);
  }

  console.log(`\nDone. Log in at http://localhost:5173 with:\n  ${EMAIL} / ${PASSWORD}` +
    (WITH_PARTNER ? `\n  ${PARTNER_EMAIL} / ${PASSWORD}  (split partner)` : ''));
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
