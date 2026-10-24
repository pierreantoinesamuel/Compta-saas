/**
 * M6 (partial) — LLM OCR extraction + FEC download
 *
 * Tests:
 *  1. extractWithLlm returns null when no API keys configured
 *  2. OpenAI response parsed correctly (mocked fetch)
 *  3. Anthropic response parsed correctly (mocked fetch)
 *  4. Multi-rate VAT breakdowns (10% + 20%) parsed from LLM response
 *  5. Malformed LLM JSON response handled gracefully
 *  6. LLM JSON with no monetary amounts returns null
 *  7. GET /api/v1/exports/fec returns JSON by default
 *  8. GET /api/v1/exports/fec?download=true serves file with Content-Disposition header
 *  9. FEC file starts with 18-column header line
 */

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../index.js';
import { signSession, TEST_WORKSPACE_ID } from '../security/sessionAuth.js';
import { extractWithLlm } from '../domain/documents/llmExtractor.js';

const ownerToken = signSession({
  userId: 'user-owner-1',
  workspaceId: TEST_WORKSPACE_ID,
  role: 'owner',
  expiresAt: Date.now() + 8 * 60 * 60 * 1000,
});
const auth = { Authorization: `Bearer ${ownerToken}` };

// ─── 1–6. extractWithLlm unit tests ──────────────────────────────────────────

describe('extractWithLlm — LLM invoice field extraction', () => {
  const savedOpenAi = process.env.OPENAI_API_KEY;
  const savedAnthropic = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedOpenAi !== undefined) process.env.OPENAI_API_KEY = savedOpenAi;
    else delete process.env.OPENAI_API_KEY;
    if (savedAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropic;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null when no API keys are set', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const result = await extractWithLlm({ textContent: 'FACTURE FC-001 Total HT: 100,00 EUR TVA 20%: 20,00 TTC: 120,00' });
    expect(result).toBeNull();
  });

  it('parses OpenAI JSON response into ExtractedDocumentData', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    delete process.env.ANTHROPIC_API_KEY;
    const payload = {
      issuerName: 'Fournisseur Test SARL',
      issuerSiren: '552032534',
      documentDate: '2026-10-19',
      referenceNumber: 'FC-2026-0042',
      description: 'Honoraires de conseil',
      amountHtMinor: 10000,
      vatBreakdowns: [{ ratePercent: 20, baseHtMinor: 10000, vatAmountMinor: 2000 }],
      amountTtcMinor: 12000,
      suggestedPcgCode: '622600',
      suggestedPcgLabel: 'Honoraires',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    }));
    const result = await extractWithLlm({ textContent: 'FACTURE FC-2026-0042 HT: 100,00 TTC: 120,00' });
    expect(result).not.toBeNull();
    expect(result!.issuerName).toBe('Fournisseur Test SARL');
    expect(result!.issuerSiren).toBe('552032534');
    expect(result!.documentDate).toBe('2026-10-19');
    expect(result!.amountHtMinor).toBe(10000);
    expect(result!.amountTtcMinor).toBe(12000);
    expect(result!.vatRatePercent).toBe(20);
    expect(result!.vatAmountMinor).toBe(2000);
    expect(result!.suggestedAccountCode).toBe('622600');
    expect(result!.suggestedAccountLabel).toBe('Honoraires');
  });

  it('parses Anthropic response into ExtractedDocumentData', async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const payload = {
      issuerName: 'Telecom SA',
      documentDate: '2026-10-15',
      referenceNumber: 'TEL-1234',
      description: 'Abonnement téléphonique',
      amountHtMinor: 5000,
      vatBreakdowns: [{ ratePercent: 20, baseHtMinor: 5000, vatAmountMinor: 1000 }],
      amountTtcMinor: 6000,
      suggestedPcgCode: '626000',
      suggestedPcgLabel: 'Frais postaux et télécom',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] }),
    }));
    const result = await extractWithLlm({ textContent: 'Facture téléphone 50,00 EUR HT' });
    expect(result).not.toBeNull();
    expect(result!.issuerName).toBe('Telecom SA');
    expect(result!.amountHtMinor).toBe(5000);
    expect(result!.suggestedAccountCode).toBe('626000');
  });

  it('parses multi-rate VAT breakdowns (restaurant: 10% food + 20% alcohol)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    delete process.env.ANTHROPIC_API_KEY;
    const payload = {
      issuerName: 'Le Bistrot',
      documentDate: '2026-10-20',
      referenceNumber: 'REST-0042',
      amountHtMinor: 8000,
      vatBreakdowns: [
        { ratePercent: 10, baseHtMinor: 6000, vatAmountMinor: 600 },
        { ratePercent: 20, baseHtMinor: 2000, vatAmountMinor: 400 },
      ],
      amountTtcMinor: 9000,
      suggestedPcgCode: '625700',
      suggestedPcgLabel: 'Réceptions et repas',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    }));
    const result = await extractWithLlm({ textContent: 'Ticket restaurant TVA 10%+20%' });
    expect(result).not.toBeNull();
    expect(result!.vatBreakdowns).toHaveLength(2);
    expect(result!.vatBreakdowns![0]!.ratePercent).toBe(10);
    expect(result!.vatBreakdowns![1]!.ratePercent).toBe(20);
    expect(result!.vatAmountMinor).toBe(1000); // 600 + 400
    expect(result!.vatRatePercent).toBe(10);   // primary = first breakdown
  });

  it('returns null when LLM returns non-JSON text', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    delete process.env.ANTHROPIC_API_KEY;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Je ne peux pas extraire ce document.' } }] }),
    }));
    const result = await extractWithLlm({ textContent: 'some text' });
    expect(result).toBeNull();
  });

  it('returns null when LLM response contains no monetary amounts', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    delete process.env.ANTHROPIC_API_KEY;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ issuerName: 'Test', documentDate: '2026-10-20' }) } }],
      }),
    }));
    const result = await extractWithLlm({ textContent: 'some text' });
    expect(result).toBeNull();
  });
});

// ─── 7–9. FEC export HTTP endpoint ───────────────────────────────────────────

describe('GET /api/v1/exports/fec — statutory FEC export', () => {
  const app = buildApp();
  afterAll(async () => app.close());

  it('returns JSON metadata by default (no ?download)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/exports/fec', headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.filename).toBe('string');
    expect(body.filename).toMatch(/FEC\d{8}\.txt$/);
    expect(typeof body.content).toBe('string');
    expect(typeof body.lineCount).toBe('number');
    expect(typeof body.totalDebitMinor).toBe('number');
    expect(typeof body.totalCreditMinor).toBe('number');
  });

  it('?download=true serves the file with Content-Disposition attachment header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/exports/fec?download=true', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    const disposition = res.headers['content-disposition'] as string;
    expect(disposition).toMatch(/^attachment; filename=".*FEC\d{8}\.txt"$/);
    // Body is raw FEC text, not JSON
    expect(() => JSON.parse(res.body)).toThrow();
  });

  it('FEC file contains the 18-column header line', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/exports/fec?download=true', headers: auth });
    expect(res.statusCode).toBe(200);
    const firstLine = res.body.split('\n')[0]!;
    expect(firstLine).toContain('JournalCode');
    expect(firstLine).toContain('EcritureNum');
    expect(firstLine).toContain('CompteNum');
    expect(firstLine).toContain('EcritureLib');
    expect(firstLine).toContain('Debit');
    expect(firstLine).toContain('Credit');
  });
});
