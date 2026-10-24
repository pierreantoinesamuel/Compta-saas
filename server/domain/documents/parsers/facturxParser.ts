/**
 * Factur-X / EN 16931 CII XML parser.
 * Extracts invoice data from the CII XML structure.
 */

import type { ExtractedDocumentData, ExtractedInvoiceLine } from '../documentTypes.js';

function getTag(xml: string, localName: string): string | null {
  const re = new RegExp(`<[^>]*:?${localName}[\\s>][^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'i');
  const m = xml.match(re);
  return m ? m[1]!.trim() : null;
}

function getAllTags(xml: string, localName: string): string[] {
  const re = new RegExp(`<[^>]*:?${localName}[\\s>][^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'gi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1]!.trim());
  return results;
}

function parseCents(str: string | null): number | undefined {
  if (!str) return undefined;
  const n = Number.parseFloat(str.trim());
  return Number.isNaN(n) ? undefined : Math.round(n * 100);
}

export function parseFacturxXml(xmlContent: string): ExtractedDocumentData {
  const data: ExtractedDocumentData = {};

  // Reference number
  const id = getTag(xmlContent, 'ID');
  if (id) data.referenceNumber = id;

  // Issue date (format YYYYMMDD in CII)
  const dateStr = getTag(xmlContent, 'DateTimeString') ?? getTag(xmlContent, 'IssueDateTime');
  if (dateStr) {
    const s = dateStr.replace(/\D/g, '');
    if (s.length === 8) data.documentDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  data.currency = getTag(xmlContent, 'InvoiceCurrencyCode') ?? 'EUR';

  // Seller
  const sellerBlock = getTag(xmlContent, 'SellerTradeParty');
  if (sellerBlock) {
    data.issuerName = getTag(sellerBlock, 'Name') ?? undefined;
    const siren = getTag(sellerBlock, 'GlobalID') ?? getTag(sellerBlock, 'ID');
    if (siren && /^\d{9}$/.test(siren)) data.issuerSiren = siren;
    else if (siren && siren.startsWith('FR')) data.issuerVat = siren;
  }

  // Buyer
  const buyerBlock = getTag(xmlContent, 'BuyerTradeParty');
  if (buyerBlock) {
    data.recipientName = getTag(buyerBlock, 'Name') ?? undefined;
  }

  // Totals
  data.amountHtMinor = parseCents(getTag(xmlContent, 'TaxBasisTotalAmount'));
  data.vatAmountMinor = parseCents(getTag(xmlContent, 'TaxTotalAmount'));
  data.amountTtcMinor = parseCents(getTag(xmlContent, 'GrandTotalAmount'));

  // VAT rate
  const rate = getTag(xmlContent, 'CalculatedRate') ?? getTag(xmlContent, 'RateApplicablePercent');
  if (rate) {
    const r = Number.parseFloat(rate);
    if (!Number.isNaN(r)) data.vatRatePercent = r;
  }

  // Lines
  const lineBlocks = getAllTags(xmlContent, 'IncludedSupplyChainTradeLineItem');
  if (lineBlocks.length > 0) {
    data.lines = lineBlocks.map((block): ExtractedInvoiceLine => ({
      description: getTag(block, 'Name') ?? getTag(block, 'Description') ?? 'Prestation',
      quantity: (() => { const q = getTag(block, 'BilledQuantity'); return q ? Number.parseFloat(q) : undefined; })(),
      unitPriceHtMinor: parseCents(getTag(block, 'ChargeAmount')),
      totalHtMinor: parseCents(getTag(block, 'LineTotalAmount')),
      taxRatePercent: (() => { const r2 = getTag(block, 'CalculatedRate'); return r2 ? Number.parseFloat(r2) : undefined; })(),
    }));
  }

  // Accounting suggestion
  data.suggestedJournalCode = 'AC';
  data.suggestedTaxRuleCode = data.vatRatePercent === 20 ? 'FR_TVA_20'
    : data.vatRatePercent === 10 ? 'FR_TVA_10'
    : data.vatRatePercent === 5.5 ? 'FR_TVA_5_5'
    : 'FR_TVA_20';
  data.suggestedAccountCode = '606100';
  data.suggestedAccountLabel = 'Charges externes — à ventiler';
  data.suggestedDeductibilityRatio = 1.0;

  return data;
}
