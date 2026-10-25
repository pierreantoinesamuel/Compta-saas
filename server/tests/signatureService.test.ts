import { describe, expect, it } from 'vitest';
import {
  generateSignatureToken,
  verifySignatureToken,
  hashDocument,
  buildAuditTrail,
} from '../domain/esignature/signatureService.js';

const DOC_ID = '550e8400-e29b-41d4-a716-446655440000';
const EMAIL = 'signer@example.com';

describe('signatureService — native e-signature helpers', () => {
  describe('generateSignatureToken / verifySignatureToken', () => {
    it('generates a non-empty token with a future expiry', () => {
      const { token, expiresAt } = generateSignatureToken(DOC_ID, EMAIL);
      expect(token).toBeTruthy();
      expect(token).toContain('.');
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('round-trips: verify accepts a freshly generated token', () => {
      const { token } = generateSignatureToken(DOC_ID, EMAIL);
      expect(verifySignatureToken(token, DOC_ID, EMAIL)).toBe(true);
    });

    it('rejects token with wrong document ID', () => {
      const { token } = generateSignatureToken(DOC_ID, EMAIL);
      expect(verifySignatureToken(token, 'wrong-doc-id', EMAIL)).toBe(false);
    });

    it('rejects token with wrong signer email', () => {
      const { token } = generateSignatureToken(DOC_ID, EMAIL);
      expect(verifySignatureToken(token, DOC_ID, 'other@example.com')).toBe(false);
    });

    it('rejects a malformed token with no dot separator', () => {
      expect(verifySignatureToken('notavalidtoken', DOC_ID, EMAIL)).toBe(false);
    });

    it('rejects a token with a corrupted payload', () => {
      const { token } = generateSignatureToken(DOC_ID, EMAIL);
      const dot = token.lastIndexOf('.');
      const tampered = Buffer.from('tampered-payload').toString('base64url') + '.' + token.slice(dot + 1);
      expect(verifySignatureToken(tampered, DOC_ID, EMAIL)).toBe(false);
    });

    it('two tokens for the same inputs differ due to nonce', () => {
      const t1 = generateSignatureToken(DOC_ID, EMAIL).token;
      const t2 = generateSignatureToken(DOC_ID, EMAIL).token;
      expect(t1).not.toBe(t2);
    });
  });

  describe('hashDocument', () => {
    it('produces a 64-char hex SHA-256 hash', () => {
      const hash = hashDocument('Hello, Haxatax!');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('is deterministic', () => {
      expect(hashDocument('same')).toBe(hashDocument('same'));
    });

    it('produces different hashes for different content', () => {
      expect(hashDocument('v1')).not.toBe(hashDocument('v2'));
    });

    it('accepts Buffer input', () => {
      expect(hashDocument(Buffer.from('test'))).toHaveLength(64);
    });
  });

  describe('buildAuditTrail', () => {
    it('contains header, events, and footer', () => {
      const trail = buildAuditTrail([
        { action: 'TOKEN_SENT', timestamp: '2026-10-25T10:00:00Z' },
        { action: 'DOCUMENT_VIEWED', timestamp: '2026-10-25T11:00:00Z', ip: '192.168.1.1' },
        { action: 'SIGNED', timestamp: '2026-10-25T11:05:00Z', ip: '192.168.1.1', userAgent: 'Firefox/120' },
      ]);
      expect(trail).toContain('PISTE');
      expect(trail).toContain('TOKEN_SENT');
      expect(trail).toContain('DOCUMENT_VIEWED');
      expect(trail).toContain('SIGNED');
      expect(trail).toContain('192.168.1.1');
      expect(trail).toContain('Firefox/120');
      expect(trail).toContain('FIN DE LA PISTE');
    });

    it('omits IP/UA lines when not provided', () => {
      const trail = buildAuditTrail([{ action: 'TOKEN_SENT', timestamp: '2026-10-25T10:00:00Z' }]);
      expect(trail).not.toContain('IP:');
      expect(trail).not.toContain('User-Agent:');
    });
  });
});
