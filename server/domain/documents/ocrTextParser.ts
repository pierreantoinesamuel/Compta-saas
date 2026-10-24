import type { ExtractedDocumentData } from './documentTypes.js';

function amountMinor(value: string): number | undefined {
  const normalized = value
    .replace(/\s/g, '')
    .replace(/€/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : undefined;
}

function labeledAmount(text: string, labels: string): number | undefined {
  const regex = new RegExp(`(?:${labels})[^\\d]{0,28}([\\d][\\d\\s.,]*)(?:\\s?€)?`, 'i');
  const match = text.match(regex);
  return match?.[1] ? amountMinor(match[1]) : undefined;
}

function findDate(text: string): string | undefined {
  const label = text.match(/(?:date[_ -]?(?:de[_ -]?)?facture|invoice[_ -]?date|émis(?:e|sion)?\s+le|date\s+du\s+document)[^\d]{0,20}(\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  const match = label?.[1] ?? text.match(/\b(\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4})\b/)?.[1];
  if (!match) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(match)) return match;
  const parts = match.split(/[/. -]/);
  if (parts.length !== 3) return undefined;
  const [day, month, rawYear] = parts;
  const year = rawYear!.length === 2 ? `20${rawYear}` : rawYear;
  if (Number(day) < 1 || Number(day) > 31 || Number(month) < 1 || Number(month) > 12) return undefined;
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
}

export function extractInvoiceFieldsFromText(text: string): ExtractedDocumentData | null {
  const cleanText = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (!cleanText) return null;

  const data: ExtractedDocumentData = {};
  const date = findDate(cleanText);
  if (date) data.documentDate = date;

  const reference = cleanText.match(/(?:facture|invoice|référence|reference|invoice[_ -]?number|n°|no\.?)[\s:#-]{0,15}([A-Z0-9][A-Z0-9./_-]{2,})/i)?.[1];
  if (reference) data.referenceNumber = reference;

  const siren = cleanText.match(/SIREN\s*[:#-]?\s*([\d\s]{9,14})/i)?.[1]?.replace(/\D/g, '').slice(0, 9);
  if (siren?.length === 9) data.issuerSiren = siren;

  data.amountTtcMinor = labeledAmount(cleanText, 'total[_\\s-]*(?:ttc|à payer)|net\\s+à\\s+payer|montant[_\\s-]+ttc|amount[_\\s-]+due|total[_\\s-]+amount');
  data.amountHtMinor = labeledAmount(cleanText, 'total[_\\s-]*(?:ht|hors taxes)|montant[_\\s-]+ht|total[_\\s-]+hors[_\\s-]+taxes|amount[_\\s-]+before[_\\s-]+tax');
  data.vatAmountMinor = labeledAmount(cleanText, 'total[_\\s-]+tva|montant[_\\s-]+de[_\\s-]+la[_\\s-]+tva|tva[_\\s-]+totale|tva(?:\\s+\\d+(?:[,.]\\d+)?\\s*%)?|vat[_\\s-]+amount');

  const vatRate = cleanText.match(/(?:TVA|VAT)[^\d]{0,16}(20|10|5[,.]5|2[,.]1|0)\s*%/i)?.[1]?.replace(',', '.');
  if (vatRate) data.vatRatePercent = Number(vatRate);

  if (data.amountHtMinor === undefined && data.amountTtcMinor !== undefined && data.vatAmountMinor !== undefined) {
    data.amountHtMinor = data.amountTtcMinor - data.vatAmountMinor;
  }
  if (data.amountTtcMinor === undefined && data.amountHtMinor !== undefined && data.vatAmountMinor !== undefined) {
    data.amountTtcMinor = data.amountHtMinor + data.vatAmountMinor;
  }

  const lines = cleanText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const issuer = lines.find(line => /[a-zà-ÿ]{3}/i.test(line) && !/facture|invoice|siren|tva|total|date/i.test(line));
  if (issuer) data.issuerName = issuer.slice(0, 120);
  if (lines.length) data.description = lines.slice(0, 3).join(' — ').slice(0, 300);

  // IBAN detection — enables Phacet Agent to compare against certified supplier IBAN
  const ibanMatch = cleanText.match(/\b([A-Z]{2}[0-9]{2}(?:\s*[A-Z0-9]{4}){3,7}\s*[A-Z0-9]{1,4})\b/);
  if (ibanMatch) {
    const normalized = ibanMatch[1]!.replace(/\s/g, '');
    if (normalized.length >= 15 && normalized.length <= 34) data.issuerIban = normalized;
  }

  const hasUsefulField = Boolean(data.documentDate || data.referenceNumber || data.issuerSiren || data.amountHtMinor !== undefined || data.amountTtcMinor !== undefined);
  return hasUsefulField ? data : null;
}

/** Extract the actual-sales column as an unverified suggestion, never as an invoice total. */
export function extractSalesReportFigures(text: string): ExtractedDocumentData {
  const lines = text.replace(/\u00a0/g, ' ').replace(/\r/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
  const headers = lines.find(line => /planifi[eé]|r[eé]el|[eé]cart/i.test(line)) ?? '';
  const headerColumns = [...headers.matchAll(/planifi[eé]|r[eé]el|[eé]cart/gi)].map(match => match[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  const actualIndex = headerColumns.findIndex(column => column.startsWith('reel'));
  const rows = lines.filter(line => /valeur\s+des\s+ventes|sales\s+value/i.test(line));
  const amounts = rows.flatMap(line => {
    const label = line.search(/(?:valeur\s+des\s+ventes|sales\s+value)/i);
    const labelMatch = line.match(/(?:valeur\s+des\s+ventes|sales\s+value)/i);
    const values = [...line.slice(label + (labelMatch?.[0].length ?? 0)).matchAll(/(?<!\d)(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.]\d{1,2})?(?!\d)/g)]
      .map(value => amountMinor(value[0]))
      .filter((value): value is number => value !== undefined);
    return values.length ? [values] : [];
  });
  const chosen = amounts
    .map(values => values.length > 1 && actualIndex >= 0 ? values[actualIndex] : values[0])
    .find(value => value !== undefined);
  return chosen === undefined ? {} : { salesReportAmountMinor: chosen };
}

export function extractionConfidence(data: ExtractedDocumentData, ocrConfidence: number): number {
  const populated = [data.documentDate, data.referenceNumber, data.issuerSiren, data.amountHtMinor, data.vatAmountMinor, data.amountTtcMinor]
    .filter(value => value !== undefined && value !== '').length;
  return Math.min(0.9, Math.max(0.3, (ocrConfidence / 100) * (0.55 + populated * 0.08)));
}
