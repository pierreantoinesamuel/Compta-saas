/**
 * Core types for the Haxatax Document Ingestion Pipeline.
 * Handles all document sources (email, cloud, bank, ERP) and formats.
 */

export type FileFormat =
  | 'facturx_xml'   // Factur-X / EN 16931 CII XML
  | 'ubl_xml'       // UBL 2.1 XML
  | 'camt_xml'      // CAMT.053 / CAMT.054 SEPA XML
  | 'ofx'           // OFX / QFX bank export (SGML/XML)
  | 'pdf'           // Generic PDF (requires manual entry or OCR)
  | 'image'         // JPEG / PNG / HEIC / TIFF
  | 'csv'           // CSV spreadsheet
  | 'excel'         // XLSX / XLS
  | 'xml_generic'   // Unknown XML dialect
  | 'json'          // API export (Pennylane, Tiime…)
  | 'zip'           // Archive containing documents
  | 'txt'           // Plain text
  | 'unknown';

export type DocumentKind =
  | 'supplier_invoice'    // Facture fournisseur
  | 'client_invoice'      // Facture client (émise par nous)
  | 'expense_receipt'     // Note de frais / ticket de caisse
  | 'bank_statement'      // Relevé bancaire (ensemble de transactions)
  | 'bank_transaction'    // Transaction isolée OFX / CAMT
  | 'payslip'             // Bulletin de paie
  | 'tax_declaration'     // Déclaration fiscale (CA3, IS, CVAE, DAS2)
  | 'contract'            // Contrat commercial
  | 'quote_received'      // Devis reçu d'un fournisseur
  | 'sales_report'        // Rapport de ventes / tableau de suivi non comptable
  | 'unknown';

export type ProcessingStatus =
  | 'pending'       // Reçu, en attente
  | 'analyzed'      // Analysé — données extraites
  | 'confirmed'     // Confirmé par l'utilisateur
  | 'posted'        // Comptabilisé (écriture créée)
  | 'rejected'      // Rejeté / ignoré
  | 'duplicate'     // Doublon détecté
  | 'error';        // Erreur de traitement

export type DocumentSource =
  | 'manual_upload'
  | 'email_attachment'
  | 'google_drive'
  | 'onedrive'
  | 'dropbox'
  | 'bank_export'
  | 'erp_export'
  | 'api';

export interface ExtractedBankTransaction {
  date: string;
  label: string;
  amountMinor: number;
  direction: 'debit' | 'credit';
  reference?: string;
  counterparty?: string;
}

export interface VatBreakdown {
  ratePercent: number;
  baseHtMinor: number;
  vatAmountMinor: number;
}

export interface ExtractedInvoiceLine {
  description: string;
  quantity?: number;
  unitPriceHtMinor?: number;
  totalHtMinor?: number;
  taxRatePercent?: number;
  taxRuleCode?: string;
  accountCode?: string;
}

export interface ExtractedDocumentData {
  documentDate?: string;
  dueDate?: string;
  referenceNumber?: string;
  description?: string;
  currency?: string;
  amountHtMinor?: number;
  vatRatePercent?: number;
  vatAmountMinor?: number;
  amountTtcMinor?: number;
  issuerName?: string;
  issuerSiren?: string;
  issuerVat?: string;
  issuerAddress?: string;
  recipientName?: string;
  recipientSiren?: string;
  recipientVat?: string;
  suggestedAccountCode?: string;
  suggestedAccountLabel?: string;
  suggestedJournalCode?: 'AC' | 'VE' | 'BQ' | 'OD';
  suggestedTaxRuleCode?: string;
  suggestedDeductibilityRatio?: number;
  vatBreakdowns?: VatBreakdown[];
  lines?: ExtractedInvoiceLine[];
  issuerIban?: string;
  bankTransactions?: ExtractedBankTransaction[];
  bankIban?: string;
  bankAccountName?: string;
  bankOpeningBalanceMinor?: number;
  bankClosingBalanceMinor?: number;
  bankStatementPeriod?: { from: string; to: string };
  salesReportAmountMinor?: number;
}

export interface IbanAlert {
  type: 'IBAN_MISMATCH';
  severity: 'critical';
  maskedDocumentIban: string;
  maskedCertifiedIban: string;
  supplierContactId: string;
  detectedAt: string;
  alertMessage: string;
  emailSent: boolean;
  emailSentAt: string | null;
}

export interface IngestedDocument {
  id: string;
  uploadedAt: string;
  filename: string;
  fileSizeBytes: number;
  mimeType: string;
  source: DocumentSource;
  detectedFormat: FileFormat;
  detectedKind: DocumentKind;
  classificationConfidenceScore?: number;
  extractionConfidenceScore?: number | null;
  confidenceScore: number;
  extractionMethod?: 'facturx_xml' | 'structured_parser' | 'ocr_llm' | 'ocr_local' | 'none';
  status: ProcessingStatus;
  errorMessage: string | null;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  extractedData: ExtractedDocumentData | null;
  validationMessages: string[];
  confirmedKind?: DocumentKind;
  confirmedData?: ExtractedDocumentData;
  postedEntityId?: string;
  postedEntityType?: 'invoice' | 'expense' | 'journal_entry' | 'bank_import';
  postedAt?: string;
  ibanAlerts?: IbanAlert[];
}

export interface DocumentUploadPayload {
  filename: string;
  mimeType: string;
  contentBase64: string;
  source?: DocumentSource;
}

export interface PostDocumentAsExpensePayload {
  documentId: string;
  supplierContactId: string;
  expenseDate: string;
  description: string;
  accountingAccountCode: string;
  taxRuleCode: string;
  deductibilityRatio: number;
  amountHtMinor: number;
}
