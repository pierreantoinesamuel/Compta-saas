/**
 * PCG 2025 (Règlement ANC n° 2022-06) Double-Entry Ledger, Auxiliary Lettering (`Lettrage`),
 * and Statutory 18-Column FEC (Fichier des Écritures Comptables — Art. L47 A-I LPF)
 * Domain Validator & Exporter.
 */

import { PCG_2025_ACCOUNTS } from '../../../db/seeds/pcg2025/pcg2025_catalog.js';

export const FEC_18_COLUMNS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
] as const;

export interface JournalEntryLineInput {
  accountCode: string;
  accountLabel: string;
  requiresAuxiliary?: boolean;
  auxiliaryAccountCode?: string | null;
  auxiliaryAccountLabel?: string | null;
  description: string;
  debitMinor: number;
  creditMinor: number;
  currencyCode?: string;
  amountCurrencyMinor?: number | null;
  letteringCode?: string | null;
  letteredAt?: string | null; // ISO YYYY-MM-DD
  dueDate?: string | null; // ISO YYYY-MM-DD (Échéance)
  invoiceNumber?: string | null; // Numéro de facture
  vatRateLabel?: string | null; // Taux d'attribution TVA (e.g. '20% (FR)', 'N/A')
  categoryLabel?: string | null; // Catégories analytiques
}

export interface JournalEntryInput {
  journalCode: string;
  journalLabel: string;
  entryNumber: string;
  entryDate: string; // ISO YYYY-MM-DD
  pieceRef: string;
  pieceDate: string; // ISO YYYY-MM-DD
  validatedAt: string; // ISO YYYY-MM-DD
  periodStatus: 'open' | 'closing_review' | 'closed';
  lines: JournalEntryLineInput[];
}

const COLLECTIVE_ACCOUNTS = new Set(
  PCG_2025_ACCOUNTS.filter((a) => a.requiresAuxiliary).map((a) => a.code)
);

/**
 * Validates a PCG 2025 account code:
 * - Must start with class 1..7 and have at least 6 characters.
 * - Must NOT start with 79 (Account 79 "Transferts de charges" was abolished on Jan 1, 2025 by ANC 2022-06).
 */
export function validatePcg2025AccountCode(code: string): void {
  if (/^79/.test(code)) {
    throw new Error(
      `PCG_2025_ABOLISHED_ACCOUNT_79: Le compte ${code} (Transferts de charges) est supprimé par le règlement ANC n° 2022-06 (PCG 2025). Utilisez les comptes 649, 708 ou 758.`
    );
  }
  if (!/^[1-7][0-9A-Z]{5,11}$/.test(code)) {
    throw new Error(
      `INVALID_PCG_ACCOUNT_CODE: Le numéro de compte ${code} doit commencer par une classe 1 à 7 et comporter au moins 6 caractères.`
    );
  }
}

/**
 * Validates all French double-entry invariants before posting (`Validation définitive`) a journal entry.
 */
export function validateJournalEntryForPosting(entry: JournalEntryInput): {
  totalDebitMinor: number;
  totalCreditMinor: number;
} {
  if (entry.periodStatus === 'closed') {
    throw new Error(
      'PERIOD_CLOSED: Impossible de comptabiliser une écriture sur un exercice définitivement clôturé.'
    );
  }
  if (!entry.pieceRef || entry.pieceRef.trim().length === 0) {
    throw new Error('MISSING_PIECE_REF: La référence de pièce justificative (PieceRef FEC) est obligatoire.');
  }
  if (!entry.lines || entry.lines.length < 2) {
    throw new Error('INSUFFICIENT_LINES: Une écriture en partie double doit comporter au moins 2 lignes.');
  }

  let totalDebitMinor = 0;
  let totalCreditMinor = 0;

  for (let i = 0; i < entry.lines.length; i++) {
    const line = entry.lines[i]!;
    validatePcg2025AccountCode(line.accountCode);

    if (!Number.isInteger(line.debitMinor) || !Number.isInteger(line.creditMinor)) {
      throw new Error(`NON_INTEGER_MINOR_UNIT: Les montants débit/crédit de la ligne ${i + 1} doivent être en centimes entiers.`);
    }
    if (line.debitMinor < 0 || line.creditMinor < 0) {
      throw new Error(`NEGATIVE_LINE_AMOUNT: Les montants débit/crédit ne peuvent pas être négatifs (ligne ${i + 1}).`);
    }
    if ((line.debitMinor === 0 && line.creditMinor === 0) || (line.debitMinor > 0 && line.creditMinor > 0)) {
      throw new Error(
        `INVALID_LINE_SIDE: Chaque ligne d’écriture doit avoir soit un débit strictement positif, soit un crédit strictement positif (ligne ${i + 1}).`
      );
    }

    const isCollective = line.requiresAuxiliary ?? COLLECTIVE_ACCOUNTS.has(line.accountCode);
    if (isCollective && (!line.auxiliaryAccountCode || !line.auxiliaryAccountLabel)) {
      throw new Error(
        `MISSING_AUXILIARY_ACCOUNT: Le compte collectif ${line.accountCode} exige un compte auxiliaire (CompAuxNum et CompAuxLib obligatoires pour le FEC).`
      );
    }

    if (
      (line.letteringCode && !line.letteredAt) ||
      (!line.letteringCode && line.letteredAt)
    ) {
      throw new Error(
        `INCONSISTENT_LETTERING: Le code de lettrage (EcritureLet) et la date de lettrage (DateLet) doivent être tous deux renseignés ou tous deux vides.`
      );
    }

    totalDebitMinor += line.debitMinor;
    totalCreditMinor += line.creditMinor;
  }

  if (totalDebitMinor !== totalCreditMinor) {
    throw new Error(
      `UNBALANCED_JOURNAL_ENTRY: L’écriture n’est pas équilibrée (Débit = ${totalDebitMinor} cts, Crédit = ${totalCreditMinor} cts).`
    );
  }

  return { totalDebitMinor, totalCreditMinor };
}

/**
 * Validates that a third-party auxiliary lettering group (`Lettrage` EcritureLet) balances to 0.
 */
export function validateAuxiliaryLetteringGroup(
  letteringCode: string,
  lines: readonly Pick<
    JournalEntryLineInput,
    'auxiliaryAccountCode' | 'debitMinor' | 'creditMinor'
  >[]
): void {
  if (!letteringCode || !/^[A-Z0-9]{1,10}$/.test(letteringCode)) {
    throw new Error('INVALID_LETTERING_CODE: Le code de lettrage (EcritureLet) est invalide.');
  }
  if (lines.length < 2) {
    throw new Error('LETTERING_MIN_TWO_LINES: Un lettrage doit relier au moins deux lignes (ex: facture et règlement).');
  }

  const auxCodes = new Set(lines.map((l) => l.auxiliaryAccountCode));
  if (auxCodes.size !== 1 || auxCodes.has(null) || auxCodes.has(undefined) || auxCodes.has('')) {
    throw new Error(
      'LETTERING_MIXED_AUXILIARY: Toutes les lignes lettrées ensemble doivent appartenir au même compte auxiliaire tiers (CompAuxNum).'
    );
  }

  let debitSum = 0;
  let creditSum = 0;
  for (const line of lines) {
    debitSum += line.debitMinor;
    creditSum += line.creditMinor;
  }

  if (debitSum !== creditSum) {
    throw new Error(
      `UNBALANCED_LETTERING: Le groupe de lettrage ${letteringCode} est déséquilibré (Débit = ${debitSum} cts, Crédit = ${creditSum} cts).`
    );
  }
}

/**
 * Formats an ISO date `YYYY-MM-DD` into the mandatory 8-digit FEC date format `YYYYMMDD`.
 */
export function formatFecDate(isoDate: string): string {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(isoDate)) {
    throw new Error(`INVALID_ISO_DATE_FOR_FEC: Date invalide (${isoDate}), format attendu YYYY-MM-DD.`);
  }
  return isoDate.replace(/-/g, '');
}

/**
 * Formats integer cents into the mandatory French FEC decimal format with a comma separator (e.g. `1250,50`).
 */
export function formatFecAmount(minorUnits: number): string {
  const abs = Math.abs(minorUnits);
  const euros = Math.floor(abs / 100);
  const cents = (abs % 100).toString().padStart(2, '0');
  return `${euros},${cents}`;
}

/**
 * Generates a statutory 18-column FEC file (pipe `|` delimited, CRLF line endings)
 * and computes its official filename `{SIREN}FEC{YYYYMMDD}.txt`.
 */
export function generateStatutoryFec(
  siren: string,
  closingDateIso: string,
  entries: readonly JournalEntryInput[]
): { filename: string; content: string; totalDebitMinor: number; totalCreditMinor: number; lineCount: number } {
  const cleanSiren = siren.replace(/\s+/g, '');
  if (!/^[0-9]{9}$/.test(cleanSiren)) {
    throw new Error('FEC_INVALID_SIREN: Le SIREN doit comporter 9 chiffres pour nommer le fichier FEC.');
  }
  const closingFecDate = formatFecDate(closingDateIso);
  const filename = `${cleanSiren}FEC${closingFecDate}.txt`;

  const rows: string[] = [FEC_18_COLUMNS.join('|')];
  let grandTotalDebitMinor = 0;
  let grandTotalCreditMinor = 0;
  let lineCount = 0;

  for (const entry of entries) {
    validateJournalEntryForPosting(entry);

    for (const line of entry.lines) {
      grandTotalDebitMinor += line.debitMinor;
      grandTotalCreditMinor += line.creditMinor;
      lineCount += 1;

      const isForeignCurrency =
        line.currencyCode && line.currencyCode !== 'EUR' && line.amountCurrencyMinor != null;

      const columns: string[] = [
        entry.journalCode.replace(/\|/g, ' '),
        entry.journalLabel.replace(/\|/g, ' '),
        entry.entryNumber.replace(/\|/g, ' '),
        formatFecDate(entry.entryDate),
        line.accountCode.replace(/\|/g, ' '),
        line.accountLabel.replace(/\|/g, ' '),
        (line.auxiliaryAccountCode ?? '').replace(/\|/g, ' '),
        (line.auxiliaryAccountLabel ?? '').replace(/\|/g, ' '),
        entry.pieceRef.replace(/\|/g, ' '),
        formatFecDate(entry.pieceDate),
        line.description.replace(/\|/g, ' '),
        formatFecAmount(line.debitMinor),
        formatFecAmount(line.creditMinor),
        (line.letteringCode ?? '').replace(/\|/g, ' '),
        line.letteredAt ? formatFecDate(line.letteredAt) : '',
        formatFecDate(entry.validatedAt),
        isForeignCurrency ? formatFecAmount(line.amountCurrencyMinor!) : '',
        isForeignCurrency ? line.currencyCode! : '',
      ];

      rows.push(columns.join('|'));
    }
  }

  return {
    filename,
    content: rows.join('\r\n'),
    totalDebitMinor: grandTotalDebitMinor,
    totalCreditMinor: grandTotalCreditMinor,
    lineCount,
  };
}
