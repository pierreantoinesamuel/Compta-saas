/**
 * R1–R4 feature regression tests
 *
 * R1 — Auto-navigation after document post: response includes expense.id + document.postedEntityId
 * R2 — Duplicate / fraud detection: server flags duplicate uploads correctly
 * R3 — OCR amount validation gate: post-as-expense blocked without amountHtMinor in confirmedData
 * R4 — Tiers detail panel data: contacts API returns all fields needed by the drawer
 */

import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';
import { signSession, TEST_WORKSPACE_ID } from '../security/sessionAuth.js';

const ownerToken = signSession({
  userId: 'user-r1r4-test',
  workspaceId: TEST_WORKSPACE_ID,
  role: 'owner',
  expiresAt: Date.now() + 8 * 60 * 60 * 1000,
});
const auth = { Authorization: `Bearer ${ownerToken}` };

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeInvoiceJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    note: [
      'FACTURE FC-TEST-001',
      'Date : 2026-10-20',
      'SIREN : 987654321',
      'Nom : Fournisseur Test SARL',
      'Total HT : 100,00 EUR',
      'TVA 20% : 20,00 EUR',
      'Net à payer TTC : 120,00 EUR',
    ].join('\n'),
    ...overrides,
  });
}

async function uploadJson(app: ReturnType<typeof buildApp>, body: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/upload`,
    headers: auth,
    payload: {
      filename: `test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
      mimeType: 'application/json',
      contentBase64: Buffer.from(body).toString('base64'),
    },
  });
}

async function confirmDoc(
  app: ReturnType<typeof buildApp>,
  docId: string,
  confirmedData: Record<string, unknown>,
) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${docId}/confirm`,
    headers: auth,
    payload: { confirmedKind: 'supplier_invoice', confirmedData },
  });
}

async function createSupplier(app: ReturnType<typeof buildApp>, siren: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    headers: auth,
    payload: {
      kind: 'supplier',
      isBusiness: true,
      taxZone: 'DOMESTIC_FR',
      legalName: `Fournisseur R1R4 ${siren}`,
      siren,
      email: `supplier-${siren}@test.example`,
      billingAddress: {
        streetLine1: '1 rue du Test',
        postalCode: '75001',
        city: 'Paris',
        countryCode: 'FR',
      },
    },
  });
}

// ─── R1: auto-navigation link after document → expense ────────────────────────

describe('R1 — post-as-expense response includes navigation link fields', () => {
  const app = buildApp();
  afterAll(async () => app.close());

  it('response contains expense.id, document.postedEntityId, and document.postedEntityType', async () => {
    const uploaded = await uploadJson(app, makeInvoiceJson());
    expect(uploaded.statusCode).toBe(201);
    const doc = uploaded.json<{ id: string; extractedData: { amountHtMinor: number } }>();
    expect(doc.extractedData.amountHtMinor).toBeGreaterThan(0);

    const confirmed = await confirmDoc(app, doc.id, {
      documentDate: '2026-10-20',
      amountHtMinor: doc.extractedData.amountHtMinor,
      amountTtcMinor: 12000,
    });
    expect(confirmed.statusCode).toBe(200);

    const supplierRes = await createSupplier(app, '552032534');
    expect(supplierRes.statusCode).toBe(200);
    const supplier = supplierRes.json<{ id: string }>();

    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${doc.id}/post-as-expense`,
      headers: auth,
      payload: { supplierContactId: supplier.id },
    });
    expect(posted.statusCode).toBe(200);

    const body = posted.json<{
      expense: { id: string };
      document: { postedEntityId: string; postedEntityType: string; status: string };
    }>();

    // expense.id must be a UUID (used by frontend for auto-navigation to the new expense)
    expect(body.expense.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // document must point back at the expense (bidirectional navigation link)
    expect(body.document.postedEntityId).toBe(body.expense.id);
    expect(body.document.postedEntityType).toBe('expense');
    expect(body.document.status).toBe('posted');
  });

  it('expense is linked to supplierContactId for the Achats tab in tiers detail', async () => {
    const supplierRes = await createSupplier(app, '100001007');
    expect(supplierRes.statusCode).toBe(200);
    const supplier = supplierRes.json<{ id: string }>();

    const uploaded = await uploadJson(app, makeInvoiceJson());
    const doc = uploaded.json<{ id: string; extractedData: { amountHtMinor: number } }>();

    await confirmDoc(app, doc.id, {
      documentDate: '2026-10-20',
      amountHtMinor: doc.extractedData.amountHtMinor ?? 10000,
      amountTtcMinor: 12000,
    });

    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${doc.id}/post-as-expense`,
      headers: auth,
      payload: { supplierContactId: supplier.id },
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.json<{ expense: { supplierContactId: string } }>().expense.supplierContactId)
      .toBe(supplier.id);
  });
});

// ─── R2: duplicate / fraud detection ─────────────────────────────────────────

describe('R2 — duplicate document detection (fraud prevention)', () => {
  const app = buildApp();
  afterAll(async () => app.close());

  it('second upload with same issuerSiren + referenceNumber is flagged isDuplicate', async () => {
    const uniqueRef = `DUPTEST-${Date.now()}`;
    const body = JSON.stringify({
      note: `FACTURE ${uniqueRef} Date: 2026-10-20 SIREN: 123456789 Net à payer TTC: 99,00 EUR Total HT: 82,50 EUR`,
    });

    const first = await uploadJson(app, body);
    expect(first.statusCode).toBe(201);
    const firstDoc = first.json<{ id: string; isDuplicate: boolean; status: string }>();
    expect(firstDoc.isDuplicate).toBe(false);
    expect(firstDoc.status).not.toBe('duplicate');

    const second = await uploadJson(app, body);
    expect(second.statusCode).toBe(201);
    const secondDoc = second.json<{
      isDuplicate: boolean;
      status: string;
      duplicateOfId: string;
      validationMessages: string[];
    }>();
    expect(secondDoc.isDuplicate).toBe(true);
    expect(secondDoc.status).toBe('duplicate');
    expect(secondDoc.duplicateOfId).toBe(firstDoc.id);
    expect(secondDoc.validationMessages.some((m) => m.includes('Doublon'))).toBe(true);
  });

  it('documents with different amounts are not duplicates', async () => {
    const ts = Date.now();
    const bodyA = JSON.stringify({ note: `FACTURE AMT-A-${ts} SIREN: 222222222 Net à payer TTC: 50,00 EUR` });
    const bodyB = JSON.stringify({ note: `FACTURE AMT-B-${ts} SIREN: 222222222 Net à payer TTC: 75,00 EUR` });

    const first = await uploadJson(app, bodyA);
    expect(first.statusCode).toBe(201);
    const second = await uploadJson(app, bodyB);
    expect(second.statusCode).toBe(201);
    expect(second.json<{ isDuplicate: boolean }>().isDuplicate).toBe(false);
  });

  it('rejected document is excluded from duplicate checks', async () => {
    const uniqueRef = `REJTEST-${Date.now()}`;
    const body = JSON.stringify({
      note: `FACTURE ${uniqueRef} SIREN: 333333333 Net à payer TTC: 60,00 EUR Total HT: 50,00 EUR`,
    });

    const first = await uploadJson(app, body);
    const firstId = first.json<{ id: string }>().id;

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${firstId}/reject`,
      headers: auth,
    });
    expect(rejected.statusCode).toBe(200);

    const second = await uploadJson(app, body);
    expect(second.statusCode).toBe(201);
    expect(second.json<{ isDuplicate: boolean }>().isDuplicate).toBe(false);
  });
});

// ─── R3: OCR amount validation gate ──────────────────────────────────────────

describe('R3 — OCR amount validation gate (server enforcement)', () => {
  const app = buildApp();
  afterAll(async () => app.close());

  it('post-as-expense is blocked when confirmedData has no amountHtMinor', async () => {
    const uploaded = await uploadJson(app, JSON.stringify({
      note: 'TICKET DE CAISSE Net à payer TTC: 25,00 EUR',
    }));
    expect(uploaded.statusCode).toBe(201);
    const doc = uploaded.json<{ id: string }>();

    // Confirm with TTC only (no amountHtMinor — simulates receipt without HT breakdown)
    const confirmed = await confirmDoc(app, doc.id, {
      documentDate: '2026-10-20',
      amountTtcMinor: 2500,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<{ status: string }>().status).toBe('confirmed');

    const supplierRes = await createSupplier(app, '100002005');
    const supplier = supplierRes.json<{ id: string }>();

    // Server blocks posting — amountHtMinor is required
    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${doc.id}/post-as-expense`,
      headers: auth,
      payload: { supplierContactId: supplier.id },
    });
    expect(posted.statusCode).toBe(422);
    expect(posted.json<{ error: string }>().error).toMatch(/HT/i);
  });

  it('post-as-expense succeeds once user adds amountHtMinor to confirmedData', async () => {
    const uploaded = await uploadJson(app, JSON.stringify({
      note: 'TICKET DE CAISSE Net à payer TTC: 30,00 EUR',
    }));
    expect(uploaded.statusCode).toBe(201);
    const doc = uploaded.json<{ id: string }>();

    // User fills in amountHtMinor (the gate the UI enforces)
    const confirmed = await confirmDoc(app, doc.id, {
      documentDate: '2026-10-20',
      amountHtMinor: 2500,
      amountTtcMinor: 3000,
    });
    expect(confirmed.statusCode).toBe(200);

    const supplierRes = await createSupplier(app, '100003003');
    const supplier = supplierRes.json<{ id: string }>();

    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${doc.id}/post-as-expense`,
      headers: auth,
      payload: { supplierContactId: supplier.id },
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.json<{ expense: { id: string } }>().expense.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-/,
    );
  });

  it('expense uses user-corrected amountHtMinor, not the original OCR value', async () => {
    const uploaded = await uploadJson(app, makeInvoiceJson());
    expect(uploaded.statusCode).toBe(201);
    const doc = uploaded.json<{ id: string }>();

    // User modifies the extracted amount during review
    await confirmDoc(app, doc.id, {
      documentDate: '2026-10-20',
      amountHtMinor: 9000,   // user-corrected (OCR extracted 10000)
      amountTtcMinor: 10800,
    });

    const supplierRes = await createSupplier(app, '100004001');
    const supplier = supplierRes.json<{ id: string }>();

    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${doc.id}/post-as-expense`,
      headers: auth,
      payload: { supplierContactId: supplier.id },
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.json<{ expense: { amountHtMinor: number } }>().expense.amountHtMinor).toBe(9000);
  });
});

// ─── R4: Tiers detail panel — API data ───────────────────────────────────────

describe('R4 — Tiers detail panel: API provides all required data', () => {
  const app = buildApp();
  afterAll(async () => app.close());

  it('GET /contacts returns contacts with all fields needed by the Fiche tab', async () => {
    // Seed a contact so the list is non-empty (200000008 is a valid Luhn SIREN)
    await createSupplier(app, '200000008');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/contacts',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const contacts = res.json<Array<Record<string, unknown>>>();
    expect(Array.isArray(contacts)).toBe(true);
    expect(contacts.length).toBeGreaterThan(0);

    const contact = contacts[0]!;
    // Fiche tab requires these fields
    expect(contact).toHaveProperty('id');
    expect(contact).toHaveProperty('legalName');
    expect(contact).toHaveProperty('kind');
    expect(contact).toHaveProperty('isBusiness');
    expect(contact).toHaveProperty('taxZone');
  });

  it('supplier contact has supplierAuxiliaryCode for the Comptabilité tab filter', async () => {
    // 200002004 is a valid Luhn SIREN
    const res = await createSupplier(app, '200002004');
    expect(res.statusCode).toBe(200);
    const supplier = res.json<{
      supplierAuxiliaryCode: string;
      customerAuxiliaryCode: string | null;
    }>();
    // Comptabilité tab filters entries by auxiliaryAccountCode === supplierAuxiliaryCode
    expect(supplier.supplierAuxiliaryCode).toMatch(/^401FOU/);
    expect(supplier.customerAuxiliaryCode).toBeNull();
  });

  it('customer contact has siren and customerAuxiliaryCode for Factures + Documents tabs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: auth,
      payload: {
        kind: 'customer',
        isBusiness: true,
        taxZone: 'DOMESTIC_FR',
        legalName: 'Client Tiers Detail Test SARL',
        siren: '200003002',
        email: 'client-tiers@test.example',
        billingAddress: {
          streetLine1: '5 avenue du Test',
          postalCode: '69001',
          city: 'Lyon',
          countryCode: 'FR',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const customer = res.json<{
      siren: string;
      customerAuxiliaryCode: string;
      supplierAuxiliaryCode: string | null;
    }>();
    // Documents tab filters documents by confirmedData.issuerSiren === contact.siren
    expect(customer.siren).toBe('200003002');
    // Factures tab filters invoices by contactId; Comptabilité tab by customerAuxiliaryCode
    expect(customer.customerAuxiliaryCode).toMatch(/^411CLI/);
    expect(customer.supplierAuxiliaryCode).toBeNull();
  });

  it('posted document links to expense via postedEntityId for the Documents tab', async () => {
    // 200004000 is a valid Luhn SIREN
    const supplierRes = await createSupplier(app, '200004000');
    const supplier = supplierRes.json<{ id: string }>();

    const uploaded = await uploadJson(app, makeInvoiceJson());
    const doc = uploaded.json<{ id: string; extractedData: { amountHtMinor: number } }>();

    await confirmDoc(app, doc.id, {
      documentDate: '2026-10-20',
      amountHtMinor: doc.extractedData.amountHtMinor ?? 10000,
      amountTtcMinor: 12000,
    });

    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${doc.id}/post-as-expense`,
      headers: auth,
      payload: { supplierContactId: supplier.id },
    });
    expect(posted.statusCode).toBe(200);
    const body = posted.json<{
      expense: { id: string; supplierContactId: string };
      document: { postedEntityId: string; postedEntityType: string };
    }>();

    // Documents tab: document.postedEntityId → expense.id → expense.supplierContactId → tiers
    expect(body.document.postedEntityId).toBe(body.expense.id);
    expect(body.expense.supplierContactId).toBe(supplier.id);

    // Verify via list endpoint
    const docs = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents`,
      headers: auth,
    });
    expect(docs.statusCode).toBe(200);
    const docList = docs.json<Array<{ id: string; status: string; postedEntityId: string }>>();
    const theDoc = docList.find((d) => d.id === doc.id);
    expect(theDoc?.status).toBe('posted');
    expect(theDoc?.postedEntityId).toBe(body.expense.id);
  });
});
