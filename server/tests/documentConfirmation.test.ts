import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';
import { signSession, TEST_WORKSPACE_ID } from '../security/sessionAuth.js';

const ownerToken = signSession({
  userId: 'user-owner-1',
  workspaceId: TEST_WORKSPACE_ID,
  role: 'owner',
  expiresAt: Date.now() + 8 * 60 * 60 * 1000,
});
const authHeader = { Authorization: `Bearer ${ownerToken}` };

describe('document extraction review gate', () => {
  const app = buildApp();

  afterEach(async () => {
    await app.close();
  });

  it('requires a human confirmation before extracted fields can create an expense', async () => {
    const source = JSON.stringify({
      note: 'FACTURE FC-2026-0042 Date de facture : 19/10/2026 SIREN : 123456782 Total HT : 10,00 EUR TVA 20% : 2,00 EUR Net à payer TTC : 12,00 EUR',
    });
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/upload`,
      headers: authHeader,
      payload: {
        filename: 'invoice.json',
        mimeType: 'application/json',
        contentBase64: Buffer.from(source).toString('base64'),
      },
    });
    expect(upload.statusCode).toBe(201);
    const document = upload.json();
    expect(document.status).toBe('analyzed');
    expect(document.extractedData.amountTtcMinor).toBe(1200);

    const postBeforeReview = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${document.id}/post-as-expense`,
      headers: authHeader,
      payload: { supplierContactId: 'supplier-not-yet-used' },
    });
    expect(postBeforeReview.statusCode).toBe(409);

    const confirmed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/documents/${document.id}/confirm`,
      headers: authHeader,
      payload: { confirmedKind: 'supplier_invoice' },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe('confirmed');
  });
});
