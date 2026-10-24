/**
 * OFX / QFX bank export parser. Handles both SGML (legacy OFX 1.x) and XML (OFX 2.x) variants.
 */

import type { ExtractedBankTransaction, ExtractedDocumentData } from '../documentTypes.js';

function sgmlVal(content: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\n\\r]*)`, 'i');
  const m = content.match(re);
  return m ? m[1]!.trim() : null;
}

function xmlBlocks(content: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const res: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) res.push(m[1]!);
  return res;
}

function ofxDate(raw: string): string {
  const s = raw.replace(/[^\d]/g, '').slice(0, 8);
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : raw;
}

export function parseOfx(content: string): ExtractedDocumentData {
  const data: ExtractedDocumentData = {};
  const transactions: ExtractedBankTransaction[] = [];

  data.bankIban = sgmlVal(content, 'ACCTID') ?? undefined;

  const dtStart = sgmlVal(content, 'DTSTART');
  const dtEnd = sgmlVal(content, 'DTEND');
  if (dtStart && dtEnd) {
    data.bankStatementPeriod = { from: ofxDate(dtStart), to: ofxDate(dtEnd) };
    data.documentDate = ofxDate(dtStart);
  }

  const balAmt = sgmlVal(content, 'BALAMT') ?? sgmlVal(content, 'AVAILBAL');
  if (balAmt) data.bankClosingBalanceMinor = Math.round(Number.parseFloat(balAmt) * 100);

  // Collect transaction blocks (XML-style first, then SGML split)
  let txBlocks = xmlBlocks(content, 'STMTTRN');
  if (txBlocks.length === 0) {
    txBlocks = content.split(/<STMTTRN>/i).slice(1).map((p) => p.split(/<\/STMTTRN>/i)[0] ?? p);
  }

  for (const block of txBlocks) {
    const trntype = sgmlVal(block, 'TRNTYPE') ?? 'CREDIT';
    const dtposted = sgmlVal(block, 'DTPOSTED') ?? '';
    const trnamt = sgmlVal(block, 'TRNAMT') ?? '0';
    const memo = sgmlVal(block, 'MEMO') ?? sgmlVal(block, 'NAME') ?? '';
    const fitid = sgmlVal(block, 'FITID') ?? '';

    const raw = Number.parseFloat(trnamt);
    const amountMinor = Math.abs(Math.round(raw * 100));
    const direction: 'debit' | 'credit' =
      raw < 0 || trntype.toUpperCase() === 'DEBIT' ? 'debit' : 'credit';

    transactions.push({ date: ofxDate(dtposted), label: memo, amountMinor, direction, reference: fitid || undefined });
  }

  data.bankTransactions = transactions;
  data.suggestedJournalCode = 'BQ';
  data.description = `Relevé OFX — ${transactions.length} transaction(s)`;
  return data;
}
