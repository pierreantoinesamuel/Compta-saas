import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { extractWithOcr, shutdownOcrEngine } from '../domain/documents/ocrEngine.js';

afterEach(async () => shutdownOcrEngine());
import { extractInvoiceFieldsFromText, extractionConfidence } from '../domain/documents/ocrTextParser.js';

describe('local OCR text normalization', () => {
  it('extracts French invoice fields while preserving euro cents', () => {
    const data = extractInvoiceFieldsFromText(`
      FACTURE FC-2026-0042
      Date de facture : 19/10/2026
      SIREN : 123 456 782
      Total HT : 1 234,56 €
      TVA 20% : 246,91 €
      Net à payer TTC : 1 481,47 €
    `);

    expect(data).toMatchObject({
      documentDate: '2026-10-19',
      issuerSiren: '123456782',
      amountHtMinor: 123456,
      vatAmountMinor: 24691,
      amountTtcMinor: 148147,
      vatRatePercent: 20,
    });
    expect(data?.referenceNumber).toBeTruthy();
  });

  it('does not invent invoice data from unrelated text', () => {
    expect(extractInvoiceFieldsFromText('Bienvenue dans votre espace client')).toBeNull();
  });

  it('reduces confidence when the OCR finds fewer usable fields', () => {
    const sparse = extractInvoiceFieldsFromText('Total TTC : 45,00 €')!;
    const complete = extractInvoiceFieldsFromText('Facture X-123\nDate de facture : 01/02/2026\nSIREN : 123456782\nTotal HT : 10,00 €\nTVA 20% : 2,00 €\nTotal TTC : 12,00 €')!;
    expect(extractionConfidence(complete, 90)).toBeGreaterThan(extractionConfidence(sparse, 90));
  });

  it('runs the bundled French OCR model locally on a scanned receipt image', async () => {
    const canvas = createCanvas(1800, 700);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1800, 700);
    context.fillStyle = '#111';
    context.font = 'bold 64px Arial';
    context.fillText('FACTURE FC-2026-0042', 80, 115);
    context.font = '52px Arial';
    context.fillText('Date de facture : 19/10/2026', 80, 230);
    context.fillText('Total HT : 1234,56 EUR', 80, 345);
    context.fillText('TVA 20% : 246,91 EUR', 80, 460);
    context.fillText('Net a payer TTC : 1481,47 EUR', 80, 575);

    const result = await extractWithOcr(canvas.toBuffer('image/png').toString('base64'), 'image');
    expect(result.text.toUpperCase()).toContain('FACTURE');
    expect(result.extractedData?.documentDate).toBe('2026-10-19');
  }, 60_000);
});
