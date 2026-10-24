/**
 * db/migrate.ts — Applies the initial DDL migration only (idempotent).
 * Use this to set up the schema without inserting any seed data.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('[migrate] DATABASE_URL is required');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('neon.tech') || DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: true }
    : false,
});

const migration = readFileSync(
  join(__dirname, 'migrations', '001_initial_schema.sql'),
  'utf8',
);

const client = await pool.connect();
try {
  await client.query(migration);
  console.log('✓ Migration 001_initial_schema.sql applied.');
} finally {
  client.release();
  await pool.end();
}
