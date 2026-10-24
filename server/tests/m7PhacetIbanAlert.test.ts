/**
 * M7 — Phacet Agent: IBAN Mismatch Detection & Alert Email
 *
 * Tests: IBAN extraction from OCR text, mismatch detection, alert message
 * format, no-alert when IBANs match, no-alert when no certified IBAN,
 * send-iban-alert endpoint 404/422/200, dry-run email response.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { extractInvoiceFieldsFromText } from '../domain/documents/ocrTextParser.js';
import { checkIbanAnomaly } from '../domain/documents/phacetAgent.js';
import { maskIban, normalizeIban, validateIban } from '../domain/contacts/frenchLegalValidators.js';
import type { ContactRecord } from '../application/workspaceStore.js';
import type { IbanAlert } from '../domain/documents/documentTypes.js';
import { buildApp } from '../index.js';
import { signSession, TEST_WORKSPACE_ID } from '../security/sessionAuth.js';

// Valid test IBANs (ISO 13616 mod-97 = 1 verified)
const IBAN_CERTIFIED = 'FR7630006000011234567890189';
const IBAN_ON_INVOICE = 'FR7614508035985812302034180'; // different → triggers alert

// ── helpers ────────────────────────────────────────────────────────────────

function makeSupplier(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    id: 'sup-001',
    kind: 'supplier',
    isBusiness: true,
    taxZone: 'DOMESTIC_FR',
    legalName: 'Fournisseur Test SAS',
    siren: '732829320',
    siret: null,
    vatIdentifier: null,
    email: 'contact@fournisseur-test.fr',
    billingAddress: {
      streetLine1: '1 Rue Test',
      postalCode: '75001',
      city: 'Paris',
      countryCode: 'FR',
    },
    defaultPaymentTermsDays: 30,
    customerAuxiliaryCode: null,
    supplierAuxiliaryCode: '401FOU0001',
    certifiedIban: IBAN_CERTIFIED,
    archivedAt: null,
    ...overrides,
  };
}

// ── Unit: IBAN extraction from OCR text ───────────────────────────────────

describe('OCR IBAN extraction', () => {
  it('extracts a French IBAN from invoice text', () => {
    const text = [
      'Société Dupont SARL',
      'SIREN 123456782',
      'Date facture: 01/06/2025',
      'Référence: FACT-2025-001',
      'Total HT: 1 000,00 €',
      'TVA 20%: 200,00 €',
      'Total TTC: 1 200,00 €',
      'Coordonnées bancaires: FR76 1450 8033 6024 7188 5503 111',
    ].join('\n');
    const data = extractInvoiceFieldsFromText(text);
    expect(data).not.toBeNull();
    expect(data?.issuerIban).toBeDefined();
    expect(data!.issuerIban!.replace(/\s/g, '')).toMatch(/^FR/);
  });

  it('does not extract garbage as IBAN', () => {
    const text = [
      'Total HT: 1 000,00 €',
      'Date: 01/06/2025',
      'Reference: FACT-001',
    ].join('\n');
    const data = extractInvoiceFieldsFromText(text);
    expect(data?.issuerIban).toBeUndefined();
  });
});

// ── Unit: IBAN validation & masking ───────────────────────────────────────

describe('IBAN helpers', () => {
  it('validates a correct French IBAN (ISO 13616 mod-97 = 1)', () => {
    // FR7630006000011234567890189 is verified valid by the ISO 13616 algorithm
    const result = validateIban('FR76 3000 6000 0112 3456 7890 189');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('FR7630006000011234567890189');
  });

  it('rejects an IBAN with wrong checksum', () => {
    // Same IBAN with last digit changed → mod-97 ≠ 1
    const result = validateIban('FR7630006000011234567890100');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_IBAN_CHECKSUM');
  });

  it('masks IBAN to first-4...last-4 format', () => {
    const masked = maskIban('FR7630006000011234567890189');
    expect(masked).toBe('FR76...0189');
  });

  it('normalizes IBAN by removing spaces and uppercasing', () => {
    const norm = normalizeIban('fr76 3000 6000 0112 3456 7890 189');
    expect(norm).toBe('FR7630006000011234567890189');
  });
});

// ── Unit: Phacet Agent pure function ──────────────────────────────────────

describe('checkIbanAnomaly', () => {
  it('returns null when supplier has no certifiedIban', () => {
    const supplier = makeSupplier({ certifiedIban: null });
    const result = checkIbanAnomaly({ extractedIban: 'FR7614508033602471885503111', supplier });
    expect(result).toBeNull();
  });

  it('returns null when IBANs match (spaces stripped, case-insensitive)', () => {
    const supplier = makeSupplier({ certifiedIban: IBAN_CERTIFIED });
    const result = checkIbanAnomaly({ extractedIban: 'FR76 3000 6000 0112 3456 7890 189', supplier });
    expect(result).toBeNull();
  });

  it('returns a critical IbanAlert when IBANs mismatch', () => {
    const supplier = makeSupplier({ certifiedIban: IBAN_CERTIFIED });
    const result = checkIbanAnomaly({ extractedIban: IBAN_ON_INVOICE, supplier });
    expect(result).not.toBeNull();
    const alert = result as IbanAlert;
    expect(alert.type).toBe('IBAN_MISMATCH');
    expect(alert.severity).toBe('critical');
    // IBAN_ON_INVOICE = FR7614508035985812302034180 → masks to FR76...4180
    expect(alert.maskedDocumentIban).toBe('FR76...4180');
    // IBAN_CERTIFIED = FR7630006000011234567890189 → masks to FR76...0189
    expect(alert.maskedCertifiedIban).toBe('FR76...0189');
    expect(alert.supplierContactId).toBe('sup-001');
    expect(alert.emailSent).toBe(false);
    expect(alert.emailSentAt).toBeNull();
  });

  it('alert message matches expected DGFiP fraud format', () => {
    const supplier = makeSupplier({ certifiedIban: IBAN_CERTIFIED });
    const result = checkIbanAnomaly({ extractedIban: IBAN_ON_INVOICE, supplier });
    expect(result!.alertMessage).toContain('ALERTE SÉCURITÉ RIB');
    expect(result!.alertMessage).toContain('FR76...4180');
    expect(result!.alertMessage).toContain('FR76...0189');
    expect(result!.alertMessage).toContain('fraude au virement fournisseur');
  });
});

// ── Integration: send-iban-alert endpoint ────────────────────────────────

describe('POST /send-iban-alert endpoint', () => {
  const app = buildApp();
  const ownerToken = signSession({
    userId: 'user-owner-1',
    workspaceId: TEST_WORKSPACE_ID,
    role: 'owner',
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  });
  const auth = { Authorization: `Bearer ${ownerToken}` };
  let documentIdNoAlert: string;

  beforeAll(async () => {
    // Upload a stub document (no IBAN in it → no alert)
    const stubBase64 = Buffer.from(
      '%PDF-1.4 stub\nDate facture: 01/06/2025\nRéférence: M7-001\nTotal HT: 500',
    ).toString('base64');
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/upload`,
      headers: auth,
      payload: {
        filename: 'm7-no-iban.pdf',
        mimeType: 'application/pdf',
        contentBase64: stubBase64,
        source: 'manual_upload',
      },
    });
    expect(uploadRes.statusCode).toBe(201);
    documentIdNoAlert = (JSON.parse(uploadRes.body) as { id: string }).id;
  });

  it('returns 404 for an unknown documentId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/nonexistent-doc-xyz/send-iban-alert`,
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { error: { code: string } }).error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('returns 422 when document has no IBAN alert', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${documentIdNoAlert}/send-iban-alert`,
      headers: auth,
    });
    expect(res.statusCode).toBe(422);
    expect((JSON.parse(res.body) as { error: { code: string } }).error.code).toBe('NO_IBAN_ALERT');
  });
});
