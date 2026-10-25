import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SIGNATURE_SECRET = process.env.SESSION_SECRET ?? 'dev-sig-secret';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SignatureTokenData {
  documentId: string;
  signerEmail: string;
  expiresAt: number;
}

export interface SignatureRequestInput {
  documentId: string;
  documentType: string;
  signerName: string;
  signerEmail: string;
  token: string;
  expiresAt: string;
}

export function generateSignatureToken(documentId: string, signerEmail: string): {
  token: string;
  expiresAt: string;
} {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const nonce = randomBytes(16).toString('hex');
  const payload = `${documentId}:${signerEmail}:${expiresAt}:${nonce}`;
  const sig = createHmac('sha256', SIGNATURE_SECRET).update(payload).digest('base64url');
  const token = Buffer.from(payload).toString('base64url') + '.' + sig;
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function verifySignatureToken(token: string, documentId: string, signerEmail: string): boolean {
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return false;
    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const payload = Buffer.from(data, 'base64url').toString('utf8');
    const parts = payload.split(':');
    if (parts.length < 4) return false;
    const [tokDocId, tokEmail, tokExpires] = parts;
    if (tokDocId !== documentId || tokEmail !== signerEmail) return false;
    if (Date.now() > Number(tokExpires)) return false;
    const expectedSig = createHmac('sha256', SIGNATURE_SECRET).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig, 'ascii');
    const expBuf = Buffer.from(expectedSig, 'ascii');
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export function hashDocument(content: Buffer | string): string {
  const hash = createHash('sha256');
  hash.update(typeof content === 'string' ? content : content);
  return hash.digest('hex');
}

export function buildAuditTrail(events: Array<{
  action: string;
  timestamp: string;
  ip?: string;
  userAgent?: string;
}>): string {
  const lines = ['=== PISTE D\'AUDIT DE SIGNATURE ÉLECTRONIQUE ===', ''];
  for (const ev of events) {
    lines.push(`[${ev.timestamp}] ${ev.action}`);
    if (ev.ip) lines.push(`  IP: ${ev.ip}`);
    if (ev.userAgent) lines.push(`  User-Agent: ${ev.userAgent.slice(0, 200)}`);
    lines.push('');
  }
  lines.push('=== FIN DE LA PISTE D\'AUDIT ===');
  return lines.join('\n');
}
