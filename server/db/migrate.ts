import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../db/migrations');

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrations = ['001_initial_schema.sql', '002_new_features.sql'];

    for (const name of migrations) {
      const { rowCount } = await client.query(
        'SELECT id FROM schema_migrations WHERE name = $1',
        [name],
      );
      if (rowCount && rowCount > 0) {
        console.log(`[DB] Migration already ran: ${name}`);
        continue;
      }
      const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      console.log(`[DB] Migration applied: ${name}`);
    }

    console.log('[DB] Migrations complete.');
  } finally {
    client.release();
  }
}

// Run directly: `npx tsx server/db/migrate.ts`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[DB] Migration failed:', err);
      process.exit(1);
    });
}
