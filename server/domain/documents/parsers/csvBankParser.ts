import type { ExtractedBankTransaction, ExtractedDocumentData } from '../documentTypes.js';

function detectSeparator(line: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  for (const ch of line) if (ch in counts) counts[ch]!++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
}

function parseDate(raw: string): string {
  const s = raw.trim().replace(/\s+/g, '');
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1]!.padStart(2, '0')}-${mdy[2]!.padStart(2, '0')}`;
  return s;
}

const DATE_KW = ['date', 'dat', 'jour', 'day'];
const LABEL_KW = ['libellé', 'libelle', 'label', 'description', 'memo', 'opération', 'operation', 'motif', 'nature'];
const DEBIT_KW = ['débit', 'debit', 'sortie', 'withdrawal'];
const CREDIT_KW = ['crédit', 'credit', 'entrée', 'deposit'];
const AMOUNT_KW = ['montant', 'amount', 'valeur', 'value'];

function mapHeaders(headers: string[]) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const find = (keys: string[]) => lower.findIndex(h => keys.some(k => h.includes(k)));
  return {
    dateIdx: find(DATE_KW),
    labelIdx: find(LABEL_KW),
    debitIdx: find(DEBIT_KW),
    creditIdx: find(CREDIT_KW),
    amountIdx: find(AMOUNT_KW),
  };
}

export function parseCsvBank(content: string): ExtractedDocumentData {
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { bankTransactions: [] };

  const sep = detectSeparator(lines[0]!);
  const headers = lines[0]!.split(sep).map(h => h.replace(/^["']|["']$/g, '').trim());
  const { dateIdx, labelIdx, debitIdx, creditIdx, amountIdx } = mapHeaders(headers);

  const transactions: ExtractedBankTransaction[] = [];
  let firstDate: string | undefined;
  let lastDate: string | undefined;

  for (const line of lines.slice(1)) {
    const cols = line.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim());
    if (cols.every(c => c === '')) continue;

    const date = dateIdx >= 0 ? parseDate(cols[dateIdx] ?? '') : '';
    const label = labelIdx >= 0 ? (cols[labelIdx] ?? '') : cols.slice(1, 3).join(' ');

    let amountMinor = 0;
    let direction: 'debit' | 'credit' = 'debit';

    if (debitIdx >= 0 || creditIdx >= 0) {
      const debitRaw = debitIdx >= 0 ? cols[debitIdx] ?? '' : '';
      const creditRaw = creditIdx >= 0 ? cols[creditIdx] ?? '' : '';
      const toAmt = (s: string) => { const n = Number.parseFloat(s.replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '')); return Number.isNaN(n) ? 0 : Math.round(Math.abs(n) * 100); };
      const d = toAmt(debitRaw);
      const c = toAmt(creditRaw);
      if (d > 0) { amountMinor = d; direction = 'debit'; }
      else if (c > 0) { amountMinor = c; direction = 'credit'; }
    } else if (amountIdx >= 0) {
      const raw = cols[amountIdx] ?? '';
      const n = Number.parseFloat(raw.replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, ''));
      if (!Number.isNaN(n)) { amountMinor = Math.round(Math.abs(n) * 100); direction = n < 0 ? 'debit' : 'credit'; }
    }

    if (date) {
      if (!firstDate || date < firstDate) firstDate = date;
      if (!lastDate || date > lastDate) lastDate = date;
    }
    if (amountMinor > 0 || label) transactions.push({ date, label, amountMinor, direction });
  }

  const data: ExtractedDocumentData = {
    bankTransactions: transactions,
    suggestedJournalCode: 'BQ',
    description: `Relevé CSV — ${transactions.length} transaction(s)`,
  };
  if (firstDate && lastDate) {
    data.bankStatementPeriod = { from: firstDate, to: lastDate };
    data.documentDate = firstDate;
  }
  return data;
}
