/**
 * M2 — Authentication, Cross-Tenant, SIREN Validation, Gapless Sequences & Audit
 *
 * Acceptance criteria (implementation_plan.md M2):
 *  1. Unauthenticated requests rejected with 401
 *  2. Cross-tenant requests rejected with 403
 *  3. Invalid SIREN/SIRET rejected with 422
 *  4. audit_events table has PostgreSQL BEFORE UPDATE OR DELETE trigger
 *  5. Hash chain integrity verified after workspace operations
 *  6. Gapless sequence: consecutive drafts differ by exactly 1
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';
import { signSession, TEST_WORKSPACE_ID } from '../security/sessionAuth.js';

const app = buildApp();
afterAll(async () => app.close());

const ownerToken = signSession({
  userId: 'user-owner-1',
  workspaceId: TEST_WORKSPACE_ID,
  role: 'owner',
  expiresAt: Date.now() + 8 * 60 * 60 * 1000,
});
const auth = { Authorization: `Bearer ${ownerToken}` };

// ─── 1. Unauthenticated access → 401 ────────────────────────────────────────

describe('unauthenticated requests are rejected with 401', () => {
  it('GET /workspaces/current without token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/workspaces/current' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /contacts without token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /audit/verify-integrity without token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify-integrity' });
    expect(res.statusCode).toBe(401);
  });

  it('public endpoints remain accessible without token', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.statusCode).toBe(200);

    const catalog = await app.inject({ method: 'GET', url: '/api/v1/accounting/catalog' });
    expect(catalog.statusCode).toBe(200);
  });
});

// ─── 2. Login endpoint ───────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  it('valid credentials return a signed token with role and workspaceId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@haxatax.test', password: 'owner-test-password' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.includes('.')).toBe(true);
    expect(body.role).toBe('owner');
    expect(body.workspaceId).toBe(TEST_WORKSPACE_ID);
  });

  it('wrong password → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@haxatax.test', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('unknown email → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@haxatax.test', password: 'anything' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('missing fields → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@haxatax.test' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── 3. Authenticated access succeeds ───────────────────────────────────────

describe('authenticated requests succeed', () => {
  it('GET /workspaces/current with token → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/workspaces/current', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().siren).toBeDefined();
  });

  it('GET /auth/session reflects token claims', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('owner');
    expect(res.json().workspaceId).toBe(TEST_WORKSPACE_ID);
  });

  it('tampered token → 401', async () => {
    const badToken = ownerToken.slice(0, -5) + 'XXXXX';
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: { Authorization: `Bearer ${badToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });
});

// ─── 4. Cross-tenant rejection → 403 ────────────────────────────────────────

describe('cross-tenant document access is rejected with 403', () => {
  it('accessing a different workspace documents → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/other-tenant-workspace-id/documents',
      headers: auth,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN_WORKSPACE');
  });

  it('accessing own workspace documents → 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
  });
});

// ─── 5. Invalid SIREN rejected at workspace update → 422 ────────────────────

describe('PATCH /workspaces/current — SIREN validation', () => {
  it('invalid SIREN (fails INSEE Luhn) → 422', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workspaces/current',
      headers: auth,
      payload: { siren: '123456789' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/SIREN/i);
  });

  it('valid SIREN (BNP Paribas 552032534) → 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workspaces/current',
      headers: auth,
      payload: { siren: '552032534' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().siren).toBe('552032534');
  });
});

// ─── 6. PostgreSQL trigger: audit_events is append-only ─────────────────────

describe('audit_events PostgreSQL append-only trigger (French compliance)', () => {
  it('migration declares BEFORE UPDATE OR DELETE OR TRUNCATE trigger on audit_events', () => {
    const sql = readFileSync(
      join(process.cwd(), 'db/migrations/001_initial_schema.sql'),
      'utf8',
    );
    expect(sql).toContain('enforce_audit_events_append_only');
    expect(sql).toContain('BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events');
    expect(sql).toContain('FRENCH_COMPLIANCE_VIOLATION');
  });
});

// ─── 7. Hash chain integrity ─────────────────────────────────────────────────

describe('SHA-256 audit hash chain integrity', () => {
  it('verify-integrity returns valid=true after workspace operations', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/workspaces/current',
      headers: auth,
      payload: { vatExigibility: 'ENCAISSEMENTS' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit/verify-integrity',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verification.valid).toBe(true);
    expect(body.verification.checkedCount).toBeGreaterThan(0);
  });
});

// ─── 8. Gapless sequence: consecutive drafts differ by 1 ────────────────────

describe('gapless sequence engine', () => {
  it('consecutive invoice drafts have sequential provisionalRef numbers', async () => {
    const contactsRes = await app.inject({ method: 'GET', url: '/api/v1/contacts', headers: auth });
    const contacts = contactsRes.json() as Array<{ id: string; kind: string }>;
    const customer = contacts.find((c) => c.kind === 'customer' || c.kind === 'both');
    expect(customer).toBeDefined();

    const commonPayload = {
      documentType: 'invoice',
      contactId: customer!.id,
      issueDate: '2026-10-20',
      deliveryOrServiceDate: '2026-10-20',
      dueDate: '2026-11-20',
      lines: [{ description: 'Seq test', lineNature: 'services', quantity: '1', unitPriceHtMinor: 10000, taxRuleCode: 'FR_TVA_20' }],
    };

    const inv1 = await app.inject({ method: 'POST', url: '/api/v1/invoices', headers: auth, payload: commonPayload });
    const inv2 = await app.inject({ method: 'POST', url: '/api/v1/invoices', headers: auth, payload: { ...commonPayload, lines: [{ ...commonPayload.lines[0]!, unitPriceHtMinor: 20000 }] } });

    expect(inv1.statusCode).toBe(200);
    expect(inv2.statusCode).toBe(200);

    const ref1 = inv1.json().provisionalRef as string;
    const ref2 = inv2.json().provisionalRef as string;
    const n1 = parseInt(/(\d+)/.exec(ref1)?.[1] ?? '0', 10);
    const n2 = parseInt(/(\d+)/.exec(ref2)?.[1] ?? '0', 10);
    expect(n1).toBeGreaterThan(0);
    expect(n2 - n1).toBe(1);
  });
});
