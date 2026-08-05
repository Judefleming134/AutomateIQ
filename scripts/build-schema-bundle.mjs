/**
 * Build ONE paste-able SQL file from every migration in supabase/migrations.
 *
 * The point is that it is safe to run against a database in ANY state — empty,
 * fully migrated, or somewhere in between — so nobody has to remember which
 * migrations have already been applied. Running it twice does nothing the
 * second time.
 *
 * The migrations themselves are NOT rewritten. They stay exactly as they were
 * applied; this only rewrites the copy that goes into the bundle. The
 * historical files are the record of what happened and must not be edited.
 *
 * Five mechanical transforms, applied per statement:
 *
 *   create table X            -> create table if not exists X
 *   create [unique] index N   -> create [unique] index if not exists N
 *   create function F         -> create or replace function F
 *   create policy "P" on T    -> drop policy if exists "P" on T;  create ...
 *   create trigger G ... on T -> drop trigger if exists G on T;   create ...
 *
 * …plus ONE cross-file pass, which is a different kind of thing and the reason
 * this script exists at all:
 *
 *   the same constraint added N times -> only the LAST one is kept
 *
 * WHY THAT PASS IS NOT OPTIONAL. `alter table … add constraint` is validated
 * against the rows already in the table, immediately. So replaying a
 * constraint's HISTORY is only safe on an empty database:
 *
 *   0014  add ge_prospects_status_check  (11 statuses)
 *   0018  widen it                       (17)
 *   0022  widen it again                 (19)
 *
 * On a live database with a prospect at 'follow_up_sent' — legal since 0018 —
 * the bundle failed on 0014's narrower version:
 *
 *   ERROR: 23514: check constraint "ge_prospects_status_check" of relation
 *   "ge_prospects" is violated by some row
 *
 * and, being one transaction, rolled the whole paste back. This file's promise
 * is a CONVERGED STATE, not a replay: what matters is the constraint the
 * database ends up with, which is the last definition. The superseded ones are
 * commented out in place, so the bundle still reads as the history it came
 * from.
 *
 * Everything else in the repo is already idempotent: `add column if not
 * exists`, `enable row level security` (a no-op when on), `create extension if
 * not exists`, `create or replace view/function`, and every `add constraint`
 * is already preceded by its own `drop constraint if exists`.
 *
 * Usage: node scripts/build-schema-bundle.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "supabase", "migrations");
const OUT = path.join(ROOT, "supabase", "bundles", "full_schema.sql");

/**
 * Split SQL into top-level statements.
 *
 * Has to understand dollar-quoted bodies ($$ … $$ and $tag$ … $tag$), single
 * quotes and line comments, or every semicolon inside a plpgsql function ends
 * a statement and the file is shredded.
 */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let dollarTag = null;
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const ch = sql[i];
    const rest = sql.slice(i);

    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (rest.startsWith("*/")) { buf += "/"; i += 2; inBlockComment = false; continue; }
      i++;
      continue;
    }
    if (dollarTag) {
      if (rest.startsWith(dollarTag)) { buf += dollarTag; i += dollarTag.length; dollarTag = null; continue; }
      buf += ch; i++; continue;
    }
    if (inSingle) {
      buf += ch;
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (rest.startsWith("--")) { inLineComment = true; buf += ch; i++; continue; }
    if (rest.startsWith("/*")) { inBlockComment = true; buf += ch; i++; continue; }
    if (ch === "'") { inSingle = true; buf += ch; i++; continue; }
    const dollar = rest.match(/^\$[A-Za-z_]*\$/);
    if (dollar) { dollarTag = dollar[0]; buf += dollarTag; i += dollarTag.length; continue; }
    if (ch === ";") { out.push(buf + ";"); buf = ""; i++; continue; }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** The code of a statement, with leading comments stripped, for matching. */
function codeOf(stmt) {
  return stmt
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .trim();
}

const counts = {
  table: 0, index: 0, function: 0, policy: 0, trigger: 0,
  /** Superseded constraint definitions commented out by the cross-file pass. */
  superseded: 0,
  /** Already dropped by the migration itself — left exactly as written. */
  alreadySafe: 0,
  untouched: 0,
};

/**
 * Does this file already drop that object before creating it?
 *
 * Many migrations were written defensively and drop their own policy or
 * trigger first. Adding a second drop on top is harmless but it makes the
 * bundle noisy and made "one drop per create" untrue, which is exactly the
 * property worth being able to assert.
 */
function alreadyDropped(emitted, kind, name, table) {
  const want = new RegExp(
    `drop\\s+${kind}\\s+if\\s+exists\\s+${escapeRe(name)}\\s+on\\s+${escapeRe(table)}`,
    "i"
  );
  return emitted.some((s) => want.test(codeOf(s)));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function transform(stmt, emitted) {
  const code = codeOf(stmt);

  // create table X  ->  create table if not exists X
  if (/^create\s+table\s+/i.test(code) && !/^create\s+table\s+if\s+not\s+exists/i.test(code)) {
    counts.table++;
    return stmt.replace(/create\s+table\s+/i, "create table if not exists ");
  }

  // create [unique] index N  ->  ... if not exists N
  if (/^create\s+(unique\s+)?index\s+/i.test(code) && !/index\s+if\s+not\s+exists/i.test(code)) {
    counts.index++;
    return stmt.replace(/create\s+(unique\s+)?index\s+/i, (m, u) => `create ${u ?? ""}index if not exists `);
  }

  // create function F  ->  create or replace function F
  if (/^create\s+function\s+/i.test(code)) {
    counts.function++;
    return stmt.replace(/create\s+function\s+/i, "create or replace function ");
  }

  // create policy "P" on T  ->  drop policy if exists "P" on T; create policy …
  if (/^create\s+policy\s+/i.test(code)) {
    const m = code.match(/^create\s+policy\s+("(?:[^"]|"")+"|[A-Za-z_][\w$]*)\s+on\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)/i);
    if (!m) throw new Error(`Unparseable policy statement:\n${code.slice(0, 200)}`);
    if (alreadyDropped(emitted, "policy", m[1], m[2])) { counts.alreadySafe++; return stmt; }
    counts.policy++;
    return `drop policy if exists ${m[1]} on ${m[2]};\n${stmt.replace(/^\n+/, "")}`;
  }

  // create trigger G … on T  ->  drop trigger if exists G on T; create trigger …
  if (/^create\s+(constraint\s+)?trigger\s+/i.test(code)) {
    const m = code.match(/^create\s+(?:constraint\s+)?trigger\s+([A-Za-z_][\w$]*)[\s\S]*?\son\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)/i);
    if (!m) throw new Error(`Unparseable trigger statement:\n${code.slice(0, 200)}`);
    if (alreadyDropped(emitted, "trigger", m[1], m[2])) { counts.alreadySafe++; return stmt; }
    counts.trigger++;
    return `drop trigger if exists ${m[1]} on ${m[2]};\n${stmt.replace(/^\n+/, "")}`;
  }

  counts.untouched++;
  return stmt;
}

/**
 * Keep only the LAST definition of each constraint.
 *
 * Runs across the whole bundle, not per file, because a constraint is narrowed
 * in one migration and widened in another — 0014/0018/0022 for
 * ge_prospects_status_check. Every earlier `add constraint` for the same
 * (table, constraint) is commented out, together with the `drop constraint`
 * that pairs with it, so the net effect on an EMPTY database is identical and
 * a POPULATED one is never asked to satisfy a rule it has already outgrown.
 *
 * Deliberately conservative: it only ever removes an add that a LATER add of
 * the same name replaces. A constraint defined once is never touched, so this
 * cannot silently drop a rule.
 */
const ADD_CONSTRAINT =
  /^alter\s+table\s+(?:only\s+)?([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\s+add\s+constraint\s+([A-Za-z_][\w$]*)/i;
const DROP_CONSTRAINT =
  /^alter\s+table\s+(?:only\s+)?([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\s+drop\s+constraint\s+(?:if\s+exists\s+)?([A-Za-z_][\w$]*)/i;

const commentOut = (stmt, why) =>
  "\n" +
  `-- [bundle] ${why}\n` +
  stmt
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
    .split("\n")
    .map((l) => (l.length ? `-- ${l}` : "--"))
    .join("\n") +
  "\n";

function supersedeConstraints(all) {
  const byKey = new Map();
  all.forEach((entry, i) => {
    const m = ADD_CONSTRAINT.exec(codeOf(entry.stmt));
    if (!m) return;
    const key = `${m[1].toLowerCase()}.${m[2].toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(i);
  });

  for (const [key, idxs] of byKey) {
    if (idxs.length < 2) continue;
    const last = idxs[idxs.length - 1];
    const winner = all[last].file;
    for (const i of idxs.slice(0, -1)) {
      const why =
        `superseded by ${winner} — an older, narrower definition of ${key}. ` +
        `Replaying it would validate today's rows against a rule they have outgrown.`;
      all[i].stmt = commentOut(all[i].stmt, why);
      counts.superseded++;
      // The `drop constraint if exists` immediately above it is the other half
      // of the same pair; leaving it would drop the constraint and not put it
      // back until the winner runs. Harmless inside one transaction, but it
      // reads as a mistake, so it goes with its partner.
      const prev = all[i - 1];
      if (!prev) continue;
      const d = DROP_CONSTRAINT.exec(codeOf(prev.stmt));
      if (d && `${d[1].toLowerCase()}.${d[2].toLowerCase()}` === key) {
        prev.stmt = commentOut(prev.stmt, `paired with the superseded add below`);
      }
    }
  }
}

const files = readdirSync(SRC).filter((f) => f.endsWith(".sql")).sort();

// Every statement of every migration, in order, tagged with the file it came
// from — flat, because the constraint pass has to see ACROSS files.
const all = [];
for (const f of files) {
  const raw = readFileSync(path.join(SRC, f), "utf8");
  // Statements are transformed IN ORDER, each able to see what came before it
  // in the same file — that is how an existing `drop policy if exists` is
  // spotted and a duplicate avoided.
  const emitted = [];
  for (const st of splitStatements(raw)) emitted.push(transform(st, emitted));
  for (const st of emitted) all.push({ file: f, stmt: st });
}

supersedeConstraints(all);

const parts = files.map((f) => {
  const rebuilt = all.filter((e) => e.file === f).map((e) => e.stmt).join("");
  return `\n-- ${"=".repeat(70)}\n-- ${f}\n-- ${"=".repeat(70)}\n${rebuilt.trim()}\n`;
});

const header = `-- ${"=".repeat(70)}
-- AutomateIQ — the WHOLE database schema, in one paste.
--
-- Every migration from ${files[0]} to ${files[files.length - 1]}
-- (${files.length} files), in order, made safe to run against a database in ANY
-- state: empty, fully up to date, or somewhere in between.
--
-- YOU DO NOT NEED TO KNOW WHICH MIGRATIONS YOU HAVE ALREADY RUN.
-- Run it, and the database ends up correct either way. Run it twice and the
-- second run changes nothing.
--
-- HOW TO RUN IT
--   Supabase dashboard -> SQL Editor -> New query -> paste the whole file
--   -> Run. It executes top to bottom in ONE transaction: if anything fails,
--   the entire thing rolls back and your database is exactly as it was.
--
-- WHAT IT WILL NOT DO
--   It never drops a table, never drops a column, and never deletes a row.
--   Tables and columns that already exist are left exactly as they are.
--   The only things it replaces are functions, views, policies and triggers —
--   definitions, not data.
--
-- GENERATED, NOT HAND-WRITTEN
--   Built by scripts/build-schema-bundle.mjs from supabase/migrations/.
--   The migration files themselves are untouched: they are the record of what
--   was actually applied and must stay that way. Re-run the script after
--   adding a migration and this file picks it up.
--
-- ONE LIMITATION, STATED PLAINLY
--   Four tables — strategy_bookings, ca_content, crm_contacts and qa_quotes —
--   exist in production but were created directly in the dashboard, so no
--   migration in this repo knows their shape (K10 in docs/OUTSTANDING.md).
--   This file therefore does NOT create them. That is fine for the job you are
--   doing — your database already has them — but it does mean this is not yet
--   a from-nothing rebuild of an empty database.
-- ${"=".repeat(70)}

begin;
`;

writeFileSync(OUT, header + parts.join("") + "\ncommit;\n");

const total = Object.entries(counts)
  .filter(([k]) => k !== "untouched" && k !== "alreadySafe")
  .reduce((n, [, v]) => n + v, 0);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${files.length} migrations, ${counts.untouched + total} statements`);
console.log(`  made idempotent: ${counts.table} tables, ${counts.index} indexes, ${counts.function} functions, ${counts.policy} policies, ${counts.trigger} triggers (${total} total)`);
console.log(`  superseded constraint definitions commented out: ${counts.superseded}`);
console.log(`  already dropped by the migration itself, left alone: ${counts.alreadySafe}`);
console.log(`  already idempotent, untouched: ${counts.untouched}`);
