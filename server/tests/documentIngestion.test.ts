import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { ingestDocument } from '../application/documentStore.js';
import { classifyDocument } from '../domain/documents/classifier.js';
import { extractSalesReportFigures } from '../domain/documents/ocrTextParser.js';

describe('purchase document ingestion', () => {
  it('recognizes a monthly sales report before generic invoice heuristics', () => {
    const classified = classifyDocument('pdf', 'IC-Simple-Monthly-Sales-Report-11456_WORD_FR.pdf', {
      documentDate: '2028-02-08',
      issuerName: 'EXCLUSION DE RESPONSABILITÉ',
      referenceNumber: 'tables',
      amountHtMinor: 1000,
    });

    expect(classified).toMatchObject({ kind: 'sales_report', confidence: 0.97 });
  });

  it('recognizes the report title in extracted PDF text', () => {
    const classified = classifyDocument('pdf', 'document-sans-titre.pdf', null,
      'MODÈLE SIMPLE DE RAPPORT MENSUEL DE VENTES');

    expect(classified).toMatchObject({ kind: 'sales_report', confidence: 0.95 });
  });

  it('extracts sales report figures as unverified amounts', () => {
    expect(extractSalesReportFigures('Planifié Réel Écart\nValeur des ventes 1 200,50 1 400,00 199,50\nMarge des ventes'))
      .toEqual({ salesReportAmountMinor: 140000 });
  });

  it('discards generic invoice fields from a sales-report template', async () => {
    const contentBase64 = Buffer.from('MODÈLE SIMPLE DE RAPPORT MENSUEL DE VENTES\nDate 08/02/2028\nEXCLUSION DE RESPONSABILITÉ\nTotal HT 10,00 EUR').toString('base64');
    const document = await ingestDocument('sales-report-workspace', {
      filename: 'modele-document.txt',
      mimeType: 'text/plain',
      contentBase64,
    });

    expect(document).toMatchObject({
      detectedKind: 'sales_report',
      classificationConfidenceScore: 0.95,
      status: 'analyzed',
      extractedData: {},
    });
    expect(document.validationMessages.join(' ')).toContain('Aucune dépense ni écriture comptable ne sera créée');
  });

  it('extracts invoice candidates from an Excel workbook for human review', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['FACTURE FC-2026-0042'],
      ['Date de facture', '19/10/2026'],
      ['SIREN', '123456782'],
      ['Total HT', '10,00 EUR'],
      ['TVA 20%', '2,00 EUR'],
      ['Net à payer TTC', '12,00 EUR'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Facture');
    const contentBase64 = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })).toString('base64');

    const document = await ingestDocument('xlsx-review-workspace', {
      filename: 'facture-fournisseur.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBase64,
    });

    expect(document).toMatchObject({
      detectedFormat: 'excel',
      status: 'analyzed',
      extractionMethod: 'structured_parser',
      extractedData: {
        documentDate: '2026-10-19',
        issuerSiren: '123456782',
        amountHtMinor: 1000,
        vatAmountMinor: 200,
        amountTtcMinor: 1200,
      },
    });
  });
});
