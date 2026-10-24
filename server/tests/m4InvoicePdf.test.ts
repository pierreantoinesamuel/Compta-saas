/**
 * M4 (partial) — Invoice HTML preview endpoint
 *
 * Tests:
 *  1. Setup: create customer contact + draft invoice + issued invoice
 *  2. GET /api/v1/invoices/:invoiceId/preview returns text/html 200 for draft
 *  3. HTML contains issuer block (legal name, SIREN, VAT number)
 *  4. HTML contains customer legal name
 *  5. HTML contains line items and VAT breakdown tables with correct amounts
 *  6. HTML contains French mandatory mentions (pénalités de retard, L441-10, indemnité)
 *  7. Draft invoice HTML contains BROUILLON watermark
 *  8. Issued invoice HTML does NOT contain BROUILLON watermark
 *  9. Unknown invoice ID returns 404
 */

import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';
import { signSession, TEST_WORKSPACE_ID } from '../security/sessionAuth.js';

const ownerToken = signSession({
  userId: 'user-owner-1',
  workspaceId: TEST_WORKSPACE_ID,
  role: 'owner',
  expiresAt: Date.now() + 8 * 60 * 60 * 1000,
});
const auth = { Authorization: `Bearer ${ownerToken}` };

describe('GET /api/v1/invoices/:invoiceId/preview — HTML invoice generator', () => {
  const app = buildApp();
  afterAll(async () => app.close());

  let draftInvoiceId: string;
  let issuedInvoiceId: string;

  it('setup: creates a customer contact and two invoices (draft + issued)', async () => {
    const contactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: auth,
      payload: {
        kind: 'customer',
        isBusiness: true,
        taxZone: 'DOMESTIC_FR',
        legalName: 'Client Preview Test SARL',
        siren: '356000000',
        email: 'preview@test.fr',
        billingAddress: { streetLine1: '5 rue de la Paix', postalCode: '75001', city: 'Paris', countryCode: 'FR' },
      },
    });
    expect(contactRes.statusCode).toBe(200);
    const contact = contactRes.json();

    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/v1/invoices',
      headers: auth,
      payload: {
        documentType: 'standard_invoice',
        contactId: contact.id,
        issueDate: '2026-10-20',
        deliveryOrServiceDate: '2026-10-20',
        dueDate: '2026-11-19',
        lines: [
          { description: 'Conseil en stratégie digitale', lineNature: 'services', quantity: '5', unitPriceHtMinor: 20000, taxRuleCode: 'FR_TVA_20' },
          { description: 'Développement logiciel', lineNature: 'services', quantity: '2', unitPriceHtMinor: 50000, taxRuleCode: 'FR_TVA_20' },
        ],
      },
    });
    expect(draftRes.statusCode).toBe(200);
    draftInvoiceId = draftRes.json().id;

    const secondDraftRes = await app.inject({
      method: 'POST',
      url: '/api/v1/invoices',
      headers: auth,
      payload: {
        documentType: 'standard_invoice',
        contactId: contact.id,
        issueDate: '2026-10-20',
        deliveryOrServiceDate: '2026-10-20',
        dueDate: '2026-11-19',
        lines: [
          { description: 'Formation professionnelle', lineNature: 'services', quantity: '1', unitPriceHtMinor: 150000, taxRuleCode: 'FR_TVA_20' },
        ],
      },
    });
    expect(secondDraftRes.statusCode).toBe(200);
    const secondDraftId = secondDraftRes.json().id;

    const issueRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${secondDraftId}/issue`,
      headers: auth,
    });
    expect(issueRes.statusCode).toBe(200);
    issuedInvoiceId = issueRes.json().id;
  });

  it('returns text/html with 200 for a draft invoice', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${draftInvoiceId}/preview`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<!doctype html>');
  });

  it('HTML contains issuer block: legal name, SIREN, VAT number', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${draftInvoiceId}/preview`,
      headers: auth,
    });
    const html = res.body;
    expect(html).toContain('Haxatax Conseil');
    expect(html).toContain('732829320');
    expect(html).toContain('FR');
  });

  it('HTML contains customer legal name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${draftInvoiceId}/preview`,
      headers: auth,
    });
    expect(res.body).toContain('Client Preview Test SARL');
  });

  it('HTML contains line items and VAT breakdown tables with correct amounts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${draftInvoiceId}/preview`,
      headers: auth,
    });
    const html = res.body;
    expect(html).toContain('Conseil en stratégie digitale');
    expect(html).toContain('Développement logiciel');
    expect(html).toContain('TVA');
    // 5*200€ + 2*500€ = 1000+1000 = 2000€ HT; 20% TVA = 400€; TTC = 2400€
    // toLocaleString('fr-FR') uses narrow no-break space (U+202F) as thousands separator
    expect(html).toContain('000,00');   // present in "2 000,00" and "2 400,00"
    expect(html).toContain('400,00');   // TVA total or TTC amount
  });

  it('HTML contains French mandatory mentions (pénalités de retard, L441-10, indemnité forfaitaire)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${draftInvoiceId}/preview`,
      headers: auth,
    });
    const html = res.body;
    expect(html).toContain('Pénalités de retard');
    expect(html).toContain('L441-10');
    expect(html).toContain('40,00');
  });

  it('draft invoice HTML contains BROUILLON watermark', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${draftInvoiceId}/preview`,
      headers: auth,
    });
    expect(res.body).toContain('BROUILLON');
    expect(res.body).toContain('watermark');
  });

  it('issued invoice HTML does NOT contain BROUILLON watermark', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${issuedInvoiceId}/preview`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('BROUILLON');
  });

  it('returns 404 for an unknown invoice ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/invoices/00000000-0000-0000-0000-000000000000/preview',
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('INVOICE_NOT_FOUND');
  });
});
