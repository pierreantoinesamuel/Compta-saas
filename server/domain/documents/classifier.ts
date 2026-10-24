import type { DocumentKind, ExtractedDocumentData, FileFormat } from './documentTypes.js';

export function classifyDocument(
  format: FileFormat,
  filename: string,
  data: ExtractedDocumentData | null,
  documentText = ''
): { kind: DocumentKind; confidence: number } {
  const normalizeSignal = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ');
  const fname = normalizeSignal(filename);
  const normalizedText = normalizeSignal(documentText);

  if (format === 'facturx_xml' || format === 'ubl_xml') {
    return { kind: 'supplier_invoice', confidence: 0.95 };
  }
  if (format === 'camt_xml' || format === 'ofx') {
    return { kind: 'bank_statement', confidence: 0.95 };
  }

  // Sales reports contain dates, names, and totals but are not supplier invoices.
  // Check report signals before generic invoice heuristics to avoid false postings.
  const salesReportPattern = /\b(?:monthly\s+sales\s+report|sales\s+report|rapport\s+(?:mensuel\s+)?(?:simple\s+)?(?:de\s+)?ventes|modele\s+simple\s+de\s+rapport\s+mensuel\s+de\s+ventes)\b/;
  const reportNameMatch = salesReportPattern.test(fname);
  const reportTextMatch = salesReportPattern.test(normalizedText);
  if (reportNameMatch || reportTextMatch) {
    return { kind: 'sales_report', confidence: reportNameMatch && reportTextMatch ? 0.99 : reportNameMatch ? 0.97 : 0.95 };
  }
  if (format === 'csv' && data?.bankTransactions && data.bankTransactions.length > 0) {
    return { kind: 'bank_statement', confidence: 0.85 };
  }

  if (/facture|invoice|fournisseur|supplier/i.test(fname)) return { kind: 'supplier_invoice', confidence: 0.80 };
  if (/relevé|releve|statement|extrait|bank/i.test(fname)) return { kind: 'bank_statement', confidence: 0.80 };
  if (/note.?frais|expense|receipt|ticket|reçu|recu/i.test(fname)) return { kind: 'expense_receipt', confidence: 0.75 };
  if (/paie|salaire|bulletin|payslip/i.test(fname)) return { kind: 'payslip', confidence: 0.75 };
  if (/contrat|contract|accord|agreement/i.test(fname)) return { kind: 'contract', confidence: 0.70 };
  if (/devis|quote|quotation|offre/i.test(fname)) return { kind: 'quote_received', confidence: 0.70 };
  if (/déclaration|declaration|ca3|tva|impôt|impot/i.test(fname)) return { kind: 'tax_declaration', confidence: 0.75 };

  if (data) {
    if (data.issuerName || data.issuerSiren || data.issuerVat) return { kind: 'supplier_invoice', confidence: 0.70 };
    if (data.bankIban || data.bankTransactions) return { kind: 'bank_statement', confidence: 0.70 };
    if (data.amountHtMinor || data.vatAmountMinor) return { kind: 'supplier_invoice', confidence: 0.60 };
  }

  if (format === 'pdf' || format === 'image') return { kind: 'unknown', confidence: 0.30 };
  return { kind: 'unknown', confidence: 0.20 };
}
