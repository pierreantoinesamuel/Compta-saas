/**
 * auth.repo.ts — DB-backed user management with bcrypt password hashing.
 * Callers: server/security/sessionAuth.ts
 * Schema: users (id, email, password_hash, full_name, is_active, created_at)
 *         workspace_memberships (user_id, workspace_id, role)
 */
import bcrypt from 'bcryptjs';
import { pool } from '../client.js';
import type { RbacRole } from '../../security/sessionAuth.js';

const BCRYPT_ROUNDS = 12;

export interface DbUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  passwordHash: string;
  membership: { workspaceId: string; role: RbacRole } | null;
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const { rows } = await pool.query<{
    id: string;
    email: string;
    full_name: string;
    is_active: boolean;
    password_hash: string;
    workspace_id: string | null;
    role: string | null;
  }>(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.password_hash,
            wm.workspace_id, wm.role
     FROM users u
     LEFT JOIN workspace_memberships wm ON wm.user_id = u.id
     WHERE u.email = $1 AND u.is_active = true
     LIMIT 1`,
    [email.toLowerCase().trim()],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    isActive: row.is_active,
    passwordHash: row.password_hash,
    membership: row.workspace_id
      ? { workspaceId: row.workspace_id, role: row.role as RbacRole }
      : null,
  };
}

export async function verifyUserPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function createUser(params: {
  email: string;
  password: string;
  fullName: string;
  workspaceId: string;
  role: RbacRole;
}): Promise<string> {
  const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id`,
      [params.email.toLowerCase().trim(), passwordHash, params.fullName],
    );
    const userId = rows[0]!.id;
    await client.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = EXCLUDED.role`,
      [userId, params.workspaceId, params.role],
    );
    await client.query('COMMIT');
    return userId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
