/**
 * db/seed.ts — Applies the initial migration and seeds the default workspace.
 *
 * Usage:
 *   npm run db:migrate    — DDL only (idempotent: CREATE TABLE IF NOT EXISTS)
 *   npm run db:seed       — DDL + workspace data (idempotent via ON CONFLICT)
 *
 * Requires DATABASE_URL to be set in the environment (see .env).
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('[seed] DATABASE_URL is required');

pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('neon.tech') || DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: true }
    : false,
});

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@haxatax.fr';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Haxatax2026!';

async function run() {
  const client = await pool.connect();
  try {
    // ── 1. DDL Migration ──────────────────────────────────────────────────
    console.log('[seed] Applying migration 001_initial_schema.sql …');
    const migration = readFileSync(
      join(__dirname, 'migrations', '001_initial_schema.sql'),
      'utf8',
    );
    try {
      await client.query(migration);
      console.log('[seed] Migration applied.');
    } catch (err: any) {
      if (err.code === '42P07') {
        await client.query('ROLLBACK');
        console.log('[seed] Migration already applied (tables exist), skipping.');
      } else {
        throw err;
      }
    }

    // ── 2. Tax rules ──────────────────────────────────────────────────────
    console.log('[seed] Seeding official FR/EU tax rules …');
    const taxRulesSql = readFileSync(
      join(__dirname, 'seeds', 'pcg2025', 'tax_rules_fr_eu.sql'),
      'utf8',
    );
    await client.query(taxRulesSql);
    console.log('[seed] Tax rules seeded.');

    // ── 3. Default workspace ──────────────────────────────────────────────
    console.log('[seed] Creating default workspace …');
    await client.query(
      `INSERT INTO workspaces (id, legal_name, siren, siret, legal_form, fiscal_regime, accounting_mode, vat_regime, vat_exigibility, registered_address)
       VALUES ($1, 'Haxatax Conseil', '732829320', '73282932000012', 'SASU', 'REEL_NORMAL', 'DOUBLE_ENTRY_PCG2025', 'REEL_NORMAL', 'DEBITS',
               '{"streetLine1":"1 rue de la Paix","postalCode":"75001","city":"Paris","countryCode":"FR"}')
       ON CONFLICT (id) DO NOTHING`,
      [WORKSPACE_ID],
    );
    console.log('[seed] Workspace ready.');

    // ── 4. PCG 2025 Accounts & Journals ───────────────────────────────────
    console.log('[seed] Creating seed_workspace_pcg2025 function …');
    const pcgSql = readFileSync(
      join(__dirname, 'seeds', 'pcg2025', 'pcg2025_accounts.sql'),
      'utf8',
    );
    await client.query(pcgSql);
    await client.query('SELECT seed_workspace_pcg2025($1)', [WORKSPACE_ID]);
    console.log('[seed] PCG 2025 chart of accounts seeded.');

    // ── 5. Current accounting period ─────────────────────────────────────
    console.log('[seed] Creating 2026 accounting period …');
    await client.query(
      `INSERT INTO accounting_periods (workspace_id, name, period_start, period_end, status)
       VALUES ($1, 'Exercice 2026', '2026-01-01', '2026-12-31', 'open')
       ON CONFLICT DO NOTHING`,
      [WORKSPACE_ID],
    );
    console.log('[seed] Accounting period ready.');

    // ── 6. Admin user ─────────────────────────────────────────────────────
    console.log('[seed] Creating admin user …');
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const { rows: userRows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, is_active)
       VALUES ($1, $2, 'Administrateur Haxatax', true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true
       RETURNING id`,
      [ADMIN_EMAIL, passwordHash],
    );
    const userId = userRows[0]!.id;
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner', status = 'active'`,
      [WORKSPACE_ID, userId],
    );
    console.log(`[seed] Admin user ready: ${ADMIN_EMAIL}`);

    // ── 7. Demo data ──────────────────────────────────────────────────────
    console.log('[seed] Inserting demo data (contacts, invoices, journal entries, bank) …');
    const demoSql = readFileSync(
      join(__dirname, 'seeds', 'demo_data.sql'),
      'utf8',
    );
    await client.query(demoSql);
    console.log('[seed] Demo data ready.');

    // Step 8 — extended demo data (all menu sections)
    const demoExtSql = readFileSync(
      join(__dirname, 'seeds', 'demo_data_extended.sql'),
      'utf8',
    );
    await client.query(demoExtSql);
    console.log('[seed] Extended demo data ready.');

    console.log('\n✓ Seed complete. You can now start the server with npm run dev:server');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
