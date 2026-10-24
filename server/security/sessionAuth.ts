/**
 * HMAC-SHA256 signed session tokens for Haxatax API (M2 — Authentication).
 *
 * Security guarantees:
 * - Tokens are HMAC-SHA256 signed; tampered payloads fail verification.
 * - All comparisons use timingSafeEqual to prevent timing attacks.
 * - SESSION_SECRET must be a 32+ byte random value in production (env var).
 * - Passwords are stored as bcrypt hashes (12 rounds) in the DB.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { findUserByEmail, verifyUserPassword } from '../db/repositories/auth.repo.js';

export type RbacRole = 'owner' | 'admin' | 'finance' | 'accountant' | 'read_only';

export interface SessionPayload {
  userId: string;
  workspaceId: string;
  role: RbacRole;
  expiresAt: number; // ms since epoch
}

const _envSecret = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production' && (!_envSecret || _envSecret.length < 32)) {
  throw new Error('[Auth] SESSION_SECRET must be set to a 32+ character random string in production.');
}
const SESSION_SECRET =
  _envSecret && _envSecret.length >= 32
    ? _envSecret
    : 'haxatax-dev-secret-change-in-production-32chars!';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export const TEST_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export function signSession(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySession(token: string): SessionPayload {
  const dot = token.lastIndexOf('.');
  if (dot < 0) throw new Error('INVALID_TOKEN_FORMAT');
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig, 'ascii');
  const expBuf = Buffer.from(expectedSig, 'ascii');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('INVALID_SIGNATURE');
  }
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
  if (typeof payload.expiresAt !== 'number' || Date.now() > payload.expiresAt) {
    throw new Error('TOKEN_EXPIRED');
  }
  return payload;
}

export async function loginUser(email: string, password: string): Promise<SessionPayload | null> {
  const user = await findUserByEmail(email.toLowerCase().trim());
  if (!user || !user.membership) return null;
  const valid = await verifyUserPassword(user.passwordHash, password);
  if (!valid) return null;
  return {
    userId: user.id,
    workspaceId: user.membership.workspaceId,
    role: user.membership.role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

/**
 * Fastify preHandler: verifies Bearer token and attaches payload to request.
 * Returns 401 if missing or invalid.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    await reply
      .status(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentification requise.' } });
    return;
  }
  try {
    (request as unknown as { session: SessionPayload }).session = verifySession(
      authHeader.slice(7),
    );
  } catch {
    await reply
      .status(401)
      .send({ error: { code: 'INVALID_TOKEN', message: 'Token invalide ou expiré.' } });
  }
}
