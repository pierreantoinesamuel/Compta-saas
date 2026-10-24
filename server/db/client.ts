import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// Parse BIGINT as JS number (safe for monetary minor-unit amounts up to 2^53-1)
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('[DB] DATABASE_URL environment variable is required');
}

const isNeon =
  connectionString.includes('neon.tech') || connectionString.includes('sslmode=require');

export const pool = new Pool({
  connectionString,
  ssl: isNeon ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err);
});

export type DbClient = pg.PoolClient;

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
