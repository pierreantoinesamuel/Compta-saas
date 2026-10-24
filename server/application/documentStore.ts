import { randomUUID } from 'node:crypto';
import { classifyDocument } from '../domain/documents/classifier.js';
import { detectFileFormat, tryDecodeAsText } from '../domain/documents/fileDetector.js';
import { suggestAccounting } from '../domain/documents/normalizer.js';
import { parseCsvBank } from '../domain/documents/parsers/csvBankParser.js';
import { parseCamt } from '../domain/documents/parsers/camtParser.js';
import { parseFacturxXml } from '../domain/documents/parsers/facturxParser.js';
import { parseOfx } from '../domain/documents/parsers/ofxParser.js';
import { extractWithOcr } from '../domain/documents/ocrEngine.js';
import { extractInvoiceFieldsFromText, extractSalesReportFigures } from '../domain/documents/ocrTextParser.js';
import * as XLSX from 'xlsx';
import type {
  DocumentKind,
  DocumentUploadPayload,
  ExtractedDocumentData,
  IngestedDocument,
  ProcessingStatus,
} from '../domain/documents/documentTypes.js';

const store = new Map<string, IngestedDocument[]>();

function getWorkspace(workspaceId: string): IngestedDocument[] {
  if (!store.has(workspaceId)) store.set(workspaceId, []);
  return store.get(workspaceId)!;
}

function detectDuplicate(docs: IngestedDocument[], candidate: IngestedDocument): string | null {
  const d = candidate.extractedData;
  if (!d) return null;
  for (const existing of docs) {
    if (existing.id === candidate.id || existing.status === 'rejected') continue;
    const e = existing.extractedData;
    if (!e) continue;
    if (d.referenceNumber && e.referenceNumber === d.referenceNumber && e.issuerSiren && e.issuerSiren === d.issuerSiren) return existing.id;
    if (d.amountTtcMinor && e.amountTtcMinor === d.amountTtcMinor && d.documentDate && e.documentDate === d.documentDate && d.issuerName && e.issuerName === d.issuerName) return existing.id;
  }
  return null;
}

function hasValidBankTransactions(data: ExtractedDocumentData | null): boolean {
  return Boolean(data?.bankTransactions?.length && data.bankTransactions.every(transaction =>
    Boolean(transaction.date && transaction.label.trim())
    && Number.isSafeInteger(transaction.amountMinor)
    && transaction.amountMinor > 0));
}

function parseDocument(format: string, textContent: string | null, contentBase64: string): ExtractedDocumentData | null {
  try {
    if (format === 'excel') {
      const workbook = XLSX.read(Buffer.from(contentBase64, 'base64'), { type: 'buffer', cellDates: false });
      const sheetText = workbook.SheetNames
        .map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name]!, { FS: ' ', RS: '\n' }))
        .join('\n');
      const bankData = parseCsvBank(sheetText);
      return hasValidBankTransactions(bankData) ? bankData : extractInvoiceFieldsFromText(sheetText);
    }
    if (!textContent) return null;
    if (format === 'facturx_xml' || format === 'ubl_xml') return parseFacturxXml(textContent);
    if (format === 'camt_xml') return parseCamt(textContent);
    if (format === 'ofx') return parseOfx(textContent);
    if (format === 'csv') {
      const bankData = parseCsvBank(textContent);
      return hasValidBankTransactions(bankData) ? bankData : extractInvoiceFieldsFromText(textContent);
    }
    if (format === 'json' || format === 'xml_generic' || format === 'txt') return extractInvoiceFieldsFromText(textContent);
  } catch (err) {
    console.warn('[documentStore] parseDocument failed for format %s:', format, err);
    return null;
  }
  return null;
}

function confidenceForFormat(format: string): number {
  if (format === 'facturx_xml' || format === 'ubl_xml') return 1.0;
  if (format === 'camt_xml' || format === 'ofx') return 0.95;
  if (format === 'csv') return 0.7;
  if (format === 'pdf' || format === 'image') return 0.3;
  return 0.5;
}

const BINARY_FORMATS = new Set(['pdf', 'image', 'excel', 'zip']);

/** Attempt UTF-8 decode regardless of format; returns null if content looks binary. */
function tryDecodeForSniffing(contentBase64: string): string | null {
  try {
    const decoded = Buffer.from(contentBase64, 'base64').toString('utf-8');
    const sample = decoded.slice(0, 512);
    const binaryChars = (sample.match(/[\x00-\x08\x0E-\x1F\x7F]/g) ?? []).length;
    return binaryChars > 5 ? null : decoded;
  } catch {
    return null;
  }
}

export async function ingestDocument(workspaceId: string, payload: DocumentUploadPayload): Promise<IngestedDocument> {
  const docs = getWorkspace(workspaceId);
  // Initial guess from filename + MIME (no content yet)
  const format = detectFileFormat(payload.filename, payload.mimeType, null);
  // Always attempt text decode for content sniffing — a Factur-X XML or CSV that
  // arrives with a wrong MIME (application/pdf, application/octet-stream, etc.)
  // is still correctly identified via content rather than staying as 'pdf'/'image'.
  const sniffText = tryDecodeAsText(payload.contentBase64, format) ?? tryDecodeForSniffing(payload.contentBase64);
  const refinedFormat = sniffText ? detectFileFormat(payload.filename, payload.mimeType, sniffText) : format;
  // Only pass text to parsers for non-binary formats
  const textContent = BINARY_FORMATS.has(refinedFormat) ? null : sniffText;

  let extractedData: ExtractedDocumentData | null = parseDocument(refinedFormat, textContent, payload.contentBase64);
  let extractionMethod: IngestedDocument['extractionMethod'] = extractedData
    ? (refinedFormat === 'facturx_xml' || refinedFormat === 'ubl_xml' ? 'facturx_xml' : 'structured_parser')
    : 'none';
  let ocrConfidence: number | null = null;
  let extractedText = textContent ?? '';
  if (!extractedData && (refinedFormat === 'pdf' || refinedFormat === 'image')) {
    try {
      const result = await extractWithOcr(payload.contentBase64, refinedFormat);
      extractedText = result.text;
      const facturxData = result.embeddedFacturxXml ? parseFacturxXml(result.embeddedFacturxXml) : null;
      extractedData = facturxData ?? result.extractedData;
      ocrConfidence = facturxData ? 1 : result.confidence;
      if (facturxData) extractionMethod = 'facturx_xml';
      else if (extractedData) extractionMethod = result.extractionMethod;
    } catch (err) {
      console.error('[OCR] extractWithOcr failed for %s (%s):', payload.filename, refinedFormat, err);
      // Keep the source document available for review if a file is malformed or OCR fails.
    }
  }
  const { kind, confidence } = classifyDocument(refinedFormat, payload.filename, extractedData, extractedText);
  // The generic invoice parser can read arbitrary report tables as invoice fields.
  // Discard those suggestions for a report so it cannot receive a purchase account.
  if (kind === 'sales_report') extractedData = extractSalesReportFigures(extractedText);
  if (extractedData) suggestAccounting(kind, extractedData);

  const fileSizeBytes = Math.round((payload.contentBase64.length * 3) / 4);
  const extractionConfidenceScore = ocrConfidence ?? (extractedData ? confidenceForFormat(refinedFormat) : null);
  const validationMessages: string[] = [];
  if (kind === 'sales_report') {
    validationMessages.push('Rapport de ventes détecté : les montants OCR sont des propositions à vérifier par une personne. Aucune dépense ni écriture comptable ne sera créée.');
  }
  if (refinedFormat === 'pdf' || refinedFormat === 'image') {
    validationMessages.push(extractedData
      ? 'Extraction OCR locale proposée — vérifiez les champs avant de confirmer la pièce.'
      : "Aucune donnée exploitable n'a été extraite automatiquement — vérifiez la pièce et complétez les champs manquants.");
  }
  if (!extractedData && refinedFormat !== 'pdf' && refinedFormat !== 'image') {
    validationMessages.push("Aucune donnée n'a été extraite de ce format — vérifiez le document et saisissez les informations nécessaires.");
  }
  if (extractedData && kind !== 'sales_report' && !extractedData.documentDate) {
    validationMessages.push('Date du document manquante — à compléter manuellement.');
  }

  const doc: IngestedDocument = {
    id: randomUUID(),
    uploadedAt: new Date().toISOString(),
    filename: payload.filename,
    fileSizeBytes,
    mimeType: payload.mimeType,
    source: payload.source ?? 'manual_upload',
    detectedFormat: refinedFormat,
    detectedKind: kind,
    classificationConfidenceScore: confidence,
    extractionConfidenceScore,
    confidenceScore: extractionConfidenceScore ?? confidence * confidenceForFormat(refinedFormat),
    extractionMethod,
    status: extractedData ? 'analyzed' : 'pending',
    errorMessage: null,
    isDuplicate: false,
    duplicateOfId: null,
    extractedData,
    validationMessages,
  };

  const dupId = detectDuplicate(docs, doc);
  if (dupId) {
    doc.isDuplicate = true;
    doc.duplicateOfId = dupId;
    doc.status = 'duplicate';
    doc.validationMessages.push(`Doublon détecté — document similaire existant (ID: ${dupId.slice(0, 8)}…)`);
  }

  docs.push(doc);
  return doc;
}

export function listDocuments(workspaceId: string): IngestedDocument[] {
  return [...getWorkspace(workspaceId)].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function getDocument(workspaceId: string, documentId: string): IngestedDocument | null {
  return getWorkspace(workspaceId).find(d => d.id === documentId) ?? null;
}

export function confirmDocument(
  workspaceId: string,
  documentId: string,
  confirmedKind: DocumentKind,
  confirmedData: ExtractedDocumentData
): IngestedDocument | null {
  const doc = getDocument(workspaceId, documentId);
  if (!doc) return null;
  doc.confirmedKind = confirmedKind;
  doc.confirmedData = confirmedData;
  doc.status = 'confirmed';
  return doc;
}

export function markPosted(
  workspaceId: string,
  documentId: string,
  postedEntityId: string,
  postedEntityType: IngestedDocument['postedEntityType']
): IngestedDocument | null {
  const doc = getDocument(workspaceId, documentId);
  if (!doc) return null;
  doc.postedEntityId = postedEntityId;
  doc.postedEntityType = postedEntityType;
  doc.postedAt = new Date().toISOString();
  doc.status = 'posted';
  return doc;
}

export function updateDocumentStatus(
  workspaceId: string,
  documentId: string,
  status: ProcessingStatus,
  errorMessage?: string
): IngestedDocument | null {
  const doc = getDocument(workspaceId, documentId);
  if (!doc) return null;
  doc.status = status;
  if (errorMessage) doc.errorMessage = errorMessage;
  return doc;
}

export function deleteDocument(workspaceId: string, documentId: string): boolean {
  const docs = getWorkspace(workspaceId);
  const idx = docs.findIndex(d => d.id === documentId);
  if (idx < 0) return false;
  docs.splice(idx, 1);
  return true;
}
