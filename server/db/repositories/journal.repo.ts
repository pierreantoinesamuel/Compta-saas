import type pg from 'pg';
import { pool } from '../client.js';
import type { LedgerEntryRecord } from '../../application/workspaceStore.js';

export async function getJournalEntries(workspaceId: string): Promise<LedgerEntryRecord[]> {
  const { rows } = await pool.query<{
    id: string; entry_number: string; entry_date: string; piece_ref: string; piece_date: string;
    description: string; validated_at: string; status: string; source_type: string;
    source_id: string | null; previous_entry_hash: string; entry_hash: string;
    journal_code: string; journal_label: string;
    lines: Array<{
      account_code: string; account_label: string | null; auxiliary_account_code: string | null;
      auxiliary_account_label: string | null; description: string;
      debit_minor: number; credit_minor: number; lettering_code: string | null;
      lettered_at: string | null;
    }>;
  }>(
    `SELECT je.id, je.entry_number, je.entry_date::TEXT, je.piece_ref, je.piece_date::TEXT,
            je.description, COALESCE(je.validated_at::TEXT, je.entry_date::TEXT) as validated_at,
            je.status, je.source_type, je.source_id,
            COALESCE(je.previous_entry_hash, '') as previous_entry_hash,
            COALESCE(je.entry_hash, '') as entry_hash,
            j.code as journal_code, j.label as journal_label,
            COALESCE(
              json_agg(
                json_build_object(
                  'account_code', a.account_code,
                  'account_label', a.account_label,
                  'auxiliary_account_code', jl.auxiliary_account_code,
                  'auxiliary_account_label', jl.auxiliary_account_label,
                  'description', jl.description,
                  'debit_minor', jl.debit_minor,
                  'credit_minor', jl.credit_minor,
                  'lettering_code', jl.lettering_code,
                  'lettered_at', jl.lettered_at
                ) ORDER BY jl.position
              ) FILTER (WHERE jl.id IS NOT NULL), '[]'
            ) as lines
     FROM journal_entries je
     JOIN journals j ON j.id = je.journal_id
     LEFT JOIN journal_entry_lines jl ON jl.entry_id = je.id
     LEFT JOIN accounts a ON a.id = jl.account_id
     WHERE je.workspace_id = $1 AND je.status = 'posted'
     GROUP BY je.id, j.code, j.label
     ORDER BY je.entry_date, je.entry_number`,
    [workspaceId],
  );

  return rows.map((r) => ({
    id: r.id,
    journalCode: r.journal_code,
    journalLabel: r.journal_label,
    entryNumber: r.entry_number,
    entryDate: r.entry_date,
    pieceRef: r.piece_ref,
    pieceDate: r.piece_date,
    validatedAt: r.validated_at,
    periodStatus: 'open' as const,
    status: r.status as 'draft' | 'posted' | 'reversed',
    sourceType: r.source_type,
    sourceId: r.source_id,
    previousEntryHash: r.previous_entry_hash,
    entryHash: r.entry_hash,
    lines: r.lines.map((l) => ({
      accountCode: l.account_code,
      accountLabel: l.account_label ?? l.account_code,
      auxiliaryAccountCode: l.auxiliary_account_code ?? undefined,
      auxiliaryAccountLabel: l.auxiliary_account_label ?? undefined,
      description: l.description,
      debitMinor: l.debit_minor,
      creditMinor: l.credit_minor,
      letteringCode: l.lettering_code ?? undefined,
      letteredAt: l.lettered_at ?? undefined,
    })),
  }));
}

export async function insertJournalEntryWithLines(
  client: pg.PoolClient,
  params: {
    workspaceId: string;
    journalId: string;
    periodId: string;
    entryNumber: string;
    entryDate: string;
    pieceRef: string;
    pieceDate: string;
    description: string;
    sourceType: string;
    sourceId: string | null;
    previousEntryHash: string;
    entryHash: string;
    userId: string;
    lines: Array<{
      accountId: string;
      contactId: string | null;
      auxiliaryAccountCode: string | null;
      auxiliaryAccountLabel: string | null;
      description: string;
      debitMinor: number;
      creditMinor: number;
    }>;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries (
       workspace_id, journal_id, period_id, entry_number, entry_date, piece_ref, piece_date,
       description, status, source_type, source_id, validated_at, posted_at, posted_by,
       previous_entry_hash, entry_hash, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted',$9,$10,$11::DATE,NOW(),$12,$13,$14,$12)
     RETURNING id`,
    [
      params.workspaceId, params.journalId, params.periodId, params.entryNumber,
      params.entryDate, params.pieceRef, params.pieceDate, params.description,
      params.sourceType, params.sourceId, params.entryDate, params.userId,
      params.previousEntryHash, params.entryHash,
    ],
  );
  const entryId = rows[0]!.id;
  for (let i = 0; i < params.lines.length; i++) {
    const line = params.lines[i]!;
    await client.query(
      `INSERT INTO journal_entry_lines (
         workspace_id, entry_id, position, account_id, contact_id,
         auxiliary_account_code, auxiliary_account_label, description, debit_minor, credit_minor
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        params.workspaceId, entryId, i + 1, line.accountId, line.contactId,
        line.auxiliaryAccountCode, line.auxiliaryAccountLabel, line.description,
        line.debitMinor, line.creditMinor,
      ],
    );
  }
  return entryId;
}

export async function getNextLetteringCode(workspaceId: string): Promise<string> {
  const { rows } = await pool.query<{ lettering_code: string }>(
    `SELECT lettering_code FROM journal_entry_lines
     WHERE workspace_id = $1 AND lettering_code IS NOT NULL
     ORDER BY lettered_at DESC, lettering_code DESC LIMIT 1`,
    [workspaceId],
  );
  if (!rows[0]) return 'AA';
  const last = rows[0].lettering_code;
  const first = last.charCodeAt(0) - 65;
  const second = last.charCodeAt(1) - 65;
  if (second < 25) return String.fromCharCode(65 + first) + String.fromCharCode(65 + second + 1);
  if (first < 25) return String.fromCharCode(65 + first + 1) + 'A';
  return 'ZZ';
}

export async function updateLineLettering(
  workspaceId: string,
  lineIds: string[],
  letteringCode: string,
  letteredAt: string,
): Promise<void> {
  await pool.query(
    `UPDATE journal_entry_lines
     SET lettering_code = $3, lettered_at = $4::DATE
     WHERE workspace_id = $1 AND id = ANY($2::UUID[])`,
    [workspaceId, lineIds, letteringCode, letteredAt],
  );
}

export async function getVatAccountBalances(workspaceId: string): Promise<{
  collectedExigibleMinor: number;
  collectedPendingCashMinor: number;
  deductiblePurchasesMinor: number;
}> {
  const { rows } = await pool.query<{ account_code: string; net_minor: number }>(
    `SELECT a.account_code,
            SUM(jl.credit_minor - jl.debit_minor) as net_minor
     FROM journal_entry_lines jl
     JOIN accounts a ON a.id = jl.account_id
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.workspace_id = $1 AND je.status = 'posted'
       AND (a.account_code LIKE '44571%' OR a.account_code LIKE '44574%' OR a.account_code LIKE '44566%')
     GROUP BY a.account_code`,
    [workspaceId],
  );
  let collectedExigibleMinor = 0;
  let collectedPendingCashMinor = 0;
  let deductiblePurchasesMinor = 0;
  for (const row of rows) {
    if (row.account_code.startsWith('44571')) collectedExigibleMinor += row.net_minor;
    else if (row.account_code.startsWith('44574')) collectedPendingCashMinor += row.net_minor;
    else if (row.account_code.startsWith('44566')) deductiblePurchasesMinor -= row.net_minor;
  }
  return { collectedExigibleMinor, collectedPendingCashMinor, deductiblePurchasesMinor };
}

export async function getJournalLineIdsByAuxCode(
  workspaceId: string,
  auxiliaryAccountCode: string,
): Promise<Array<{ id: string; entryId: string; debitMinor: number; creditMinor: number; letteringCode: string | null }>> {
  const { rows } = await pool.query<{
    id: string; entry_id: string; debit_minor: number; credit_minor: number; lettering_code: string | null;
  }>(
    `SELECT jl.id, jl.entry_id, jl.debit_minor, jl.credit_minor, jl.lettering_code
     FROM journal_entry_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.workspace_id = $1 AND jl.auxiliary_account_code = $2 AND je.status = 'posted'`,
    [workspaceId, auxiliaryAccountCode],
  );
  return rows.map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    debitMinor: r.debit_minor,
    creditMinor: r.credit_minor,
    letteringCode: r.lettering_code,
  }));
}
