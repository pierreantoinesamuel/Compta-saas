/**
 * CAMT.053 / CAMT.054 ISO 20022 SEPA XML parser.
 */

import type { ExtractedBankTransaction, ExtractedDocumentData } from '../documentTypes.js';

function tag(xml: string, localName: string): string | null {
  const re = new RegExp(`<[^>]*:?${localName}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'i');
  const m = xml.match(re);
  return m ? m[1]!.trim() : null;
}

function allTags(xml: string, localName: string): string[] {
  const re = new RegExp(`<[^>]*:?${localName}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'gi');
  const res: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) res.push(m[1]!);
  return res;
}

function cents(str: string | null): number | undefined {
  if (!str) return undefined;
  const n = Number.parseFloat(str.trim());
  return Number.isNaN(n) ? undefined : Math.round(n * 100);
}

export function parseCamt(xmlContent: string): ExtractedDocumentData {
  const data: ExtractedDocumentData = {};
  const transactions: ExtractedBankTransaction[] = [];

  data.bankIban = tag(xmlContent, 'IBAN') ?? undefined;
  data.bankAccountName = tag(xmlContent, 'Nm') ?? undefined;

  const frDt = tag(xmlContent, 'FrDt') ?? tag(xmlContent, 'FrDtTm');
  const toDt = tag(xmlContent, 'ToDt') ?? tag(xmlContent, 'ToDtTm');
  if (frDt && toDt) {
    data.bankStatementPeriod = { from: frDt.slice(0, 10), to: toDt.slice(0, 10) };
    data.documentDate = frDt.slice(0, 10);
  }

  for (const bal of allTags(xmlContent, 'Bal')) {
    const code = tag(bal, 'Cd');
    const amt = cents(tag(bal, 'Amt'));
    const dbt = tag(bal, 'CdtDbtInd');
    if (amt === undefined) continue;
    const signed = dbt === 'DBIT' ? -amt : amt;
    if (code === 'OPBD') data.bankOpeningBalanceMinor = signed;
    if (code === 'CLBD') data.bankClosingBalanceMinor = signed;
  }

  for (const entry of allTags(xmlContent, 'Ntry')) {
    const amountMinor = cents(tag(entry, 'Amt')) ?? 0;
    const direction: 'debit' | 'credit' = tag(entry, 'CdtDbtInd') === 'DBIT' ? 'debit' : 'credit';
    const bookDt = tag(tag(entry, 'BookgDt') ?? entry, 'Dt') ?? data.documentDate ?? '';
    const label =
      tag(tag(entry, 'RmtInf') ?? entry, 'Ustrd') ??
      tag(entry, 'AddtlNtryInf') ??
      tag(entry, 'NtryRef') ??
      'Opération bancaire';
    const ref = tag(entry, 'NtryRef') ?? tag(entry, 'AcctSvcrRef');
    transactions.push({ date: bookDt.slice(0, 10), label, amountMinor, direction, reference: ref ?? undefined });
  }

  data.bankTransactions = transactions;
  data.suggestedJournalCode = 'BQ';
  data.description = `Relevé CAMT.053 SEPA — ${transactions.length} opération(s)`;
  return data;
}
