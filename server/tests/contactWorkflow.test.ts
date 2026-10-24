import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';
import { signSession, TEST_WORKSPACE_ID } from '../security/sessionAuth.js';

const ownerToken = signSession({
  userId: 'user-owner-1',
  workspaceId: TEST_WORKSPACE_ID,
  role: 'owner',
  expiresAt: Date.now() + 8 * 60 * 60 * 1000,
});
const authHeader = { Authorization: `Bearer ${ownerToken}` };

describe('customer and supplier creation workflows', () => {
  const app = buildApp();

  afterAll(async () => app.close());

  async function createContact(kind: 'customer' | 'supplier', legalName: string, siren: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: authHeader,
      payload: {
        kind,
        isBusiness: true,
        taxZone: 'DOMESTIC_FR',
        legalName,
        siren,
        email: '',
        billingAddress: {
          streetLine1: '10 rue de Test',
          postalCode: '75001',
          city: 'Paris',
          countryCode: 'FR',
        },
      },
    });
  }

  it('creates a customer and makes it usable in sales drafts', async () => {
    const created = await createContact('customer', `Client workflow ${Date.now()}`, '100000009');
    expect(created.statusCode).toBe(200);
    const client = created.json();
    expect(client.customerAuxiliaryCode).toMatch(/^411CLI/);

    const duplicateSiren = await createContact('customer', `Autre raison sociale ${Date.now()}`, '100000009');
    expect(duplicateSiren.statusCode).toBe(422);
    expect(duplicateSiren.json().error.message).toContain('SIREN existe déjà');

    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/invoices',
      headers: authHeader,
      payload: {
        documentType: 'quote',
        contactId: client.id,
        issueDate: '2026-10-19',
        deliveryOrServiceDate: '2026-10-19',
        dueDate: '2026-11-18',
        lines: [{ description: 'Prestation de test', lineNature: 'services', quantity: '1', unitPriceHtMinor: 10000, taxRuleCode: 'FR_TVA_20' }],
      },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().contactId).toBe(client.id);
  });

  it('requires a business legal name and a valid French business SIREN', async () => {
    const basePayload = {
      kind: 'customer',
      isBusiness: true,
      taxZone: 'DOMESTIC_FR',
      legalName: 'Entreprise de contrôle',
      billingAddress: { streetLine1: '1 rue de Test', postalCode: '75001', city: 'Paris', countryCode: 'FR' },
    };
    const missingSiren = await app.inject({ method: 'POST', url: '/api/v1/contacts', headers: authHeader, payload: basePayload });
    expect(missingSiren.statusCode).toBe(422);
    expect(missingSiren.json().error.message).toContain('SIREN est obligatoire');

    const missingName = await app.inject({ method: 'POST', url: '/api/v1/contacts', headers: authHeader, payload: { ...basePayload, legalName: '  ', siren: '552100554' } });
    expect(missingName.statusCode).toBe(400);
  });

  it('creates a supplier, uses it on an expense, and rejects customer-as-supplier', async () => {
    const created = await createContact('supplier', `Fournisseur workflow ${Date.now()}`, '100001007');
    expect(created.statusCode).toBe(200);
    const supplier = created.json();
    expect(supplier.supplierAuxiliaryCode).toMatch(/^401FOU/);

    const expense = await app.inject({
      method: 'POST',
      url: '/api/v1/expenses',
      headers: authHeader,
      payload: {
        supplierContactId: supplier.id,
        supplierInvoiceRef: `TEST-${Date.now()}`,
        expenseDate: '2026-10-19',
        description: 'Achat de test',
        accountingAccountCode: '607100',
        taxRuleCode: 'FR_TVA_20',
        amountHtMinor: 10000,
      },
    });
    expect(expense.statusCode).toBe(200);
    expect(expense.json().supplierContactId).toBe(supplier.id);

    const wrongSalesRole = await app.inject({
      method: 'POST',
      url: '/api/v1/invoices',
      headers: authHeader,
      payload: {
        documentType: 'quote',
        contactId: supplier.id,
        issueDate: '2026-10-19',
        deliveryOrServiceDate: '2026-10-19',
        dueDate: '2026-11-18',
        lines: [{ description: 'Test contrôle rôle', lineNature: 'services', quantity: '1', unitPriceHtMinor: 10000, taxRuleCode: 'FR_TVA_20' }],
      },
    });
    expect(wrongSalesRole.statusCode).toBe(422);
    expect(wrongSalesRole.json().error.message).toContain('client');

    const customer = (await app.inject({ method: 'GET', url: '/api/v1/contacts', headers: authHeader })).json()
      .find((contact: { kind: string }) => contact.kind === 'customer');
    const wrongRole = await app.inject({
      method: 'POST',
      url: '/api/v1/expenses',
      headers: authHeader,
      payload: {
        supplierContactId: customer.id,
        supplierInvoiceRef: 'TEST-WRONG-ROLE',
        expenseDate: '2026-10-19',
        description: 'Test contrôle rôle',
        accountingAccountCode: '607100',
        taxRuleCode: 'FR_TVA_20',
        amountHtMinor: 10000,
      },
    });
    expect(wrongRole.statusCode).toBe(422);
    expect(wrongRole.json().error.message).toContain('fournisseur');
  });
});
