import type pg from 'pg';
import { pool } from '../client.js';

export interface ExpenseClaimRow {
  id: string;
  workspaceId: string;
  employeeUserId: string;
  claimDate: string;
  description: string;
  totalTtcMinor: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
  journalEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: ExpenseClaimLineRow[];
}

export interface ExpenseClaimLineRow {
  id: string;
  claimId: string;
  expenseDate: string;
  description: string;
  category: string;
  amountTtcMinor: number;
  vatRatePercent: number;
  vatAmountMinor: number;
  amountHtMinor: number;
  accountCode: string;
  deductibilityRatio: number;
  kmDistance: number | null;
  kmRate: number | null;
  createdAt: string;
}

function mapClaim(r: Record<string, unknown>): ExpenseClaimRow {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    employeeUserId: r.employee_user_id as string,
    claimDate: r.claim_date as string,
    description: r.description as string,
    totalTtcMinor: r.total_ttc_minor as number,
    status: r.status as ExpenseClaimRow['status'],
    journalEntryId: r.journal_entry_id as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function mapLine(r: Record<string, unknown>): ExpenseClaimLineRow {
  return {
    id: r.id as string,
    claimId: r.claim_id as string,
    expenseDate: r.expense_date as string,
    description: r.description as string,
    category: r.category as string,
    amountTtcMinor: r.amount_ttc_minor as number,
    vatRatePercent: Number(r.vat_rate_percent),
    vatAmountMinor: r.vat_amount_minor as number,
    amountHtMinor: r.amount_ht_minor as number,
    accountCode: r.account_code as string,
    deductibilityRatio: Number(r.deductibility_ratio),
    kmDistance: r.km_distance != null ? Number(r.km_distance) : null,
    kmRate: r.km_rate != null ? Number(r.km_rate) : null,
    createdAt: r.created_at as string,
  };
}

export async function createExpenseClaim(
  client: pg.PoolClient,
  workspaceId: string,
  userId: string,
  input: { claimDate: string; description: string },
): Promise<ExpenseClaimRow> {
  const { rows } = await client.query(
    `INSERT INTO expense_claims (workspace_id, employee_user_id, claim_date, description)
     VALUES ($1,$2,$3::DATE,$4) RETURNING *`,
    [workspaceId, userId, input.claimDate, input.description],
  );
  return mapClaim(rows[0] as Record<string, unknown>);
}

export async function addExpenseClaimLine(
  client: pg.PoolClient,
  claimId: string,
  workspaceId: string,
  line: {
    expenseDate: string;
    description: string;
    category: string;
    amountTtcMinor: number;
    vatRatePercent?: number;
    vatAmountMinor?: number;
    amountHtMinor: number;
    accountCode?: string;
    deductibilityRatio?: number;
    kmDistance?: number;
    kmRate?: number;
  },
): Promise<ExpenseClaimLineRow> {
  const { rows } = await client.query(
    `INSERT INTO expense_claim_lines (
       claim_id, workspace_id, expense_date, description, category,
       amount_ttc_minor, vat_rate_percent, vat_amount_minor, amount_ht_minor,
       account_code, deductibility_ratio, km_distance, km_rate
     ) VALUES ($1,$2,$3::DATE,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      claimId, workspaceId, line.expenseDate, line.description, line.category,
      line.amountTtcMinor, line.vatRatePercent ?? 0, line.vatAmountMinor ?? 0, line.amountHtMinor,
      line.accountCode ?? '625100', line.deductibilityRatio ?? 1.0,
      line.kmDistance ?? null, line.kmRate ?? null,
    ],
  );
  // Update claim total
  await client.query(
    `UPDATE expense_claims
     SET total_ttc_minor = (SELECT COALESCE(SUM(amount_ttc_minor),0) FROM expense_claim_lines WHERE claim_id = $1),
         updated_at = NOW()
     WHERE id = $1`,
    [claimId],
  );
  return mapLine(rows[0] as Record<string, unknown>);
}

export async function getExpenseClaims(workspaceId: string): Promise<ExpenseClaimRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM expense_claims WHERE workspace_id = $1 ORDER BY claim_date DESC, created_at DESC`,
    [workspaceId],
  );
  return rows.map((r) => mapClaim(r as Record<string, unknown>));
}

export async function getExpenseClaimById(
  workspaceId: string,
  claimId: string,
): Promise<(ExpenseClaimRow & { lines: ExpenseClaimLineRow[] }) | null> {
  const { rows } = await pool.query(
    `SELECT * FROM expense_claims WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, claimId],
  );
  if (!rows[0]) return null;
  const claim = mapClaim(rows[0] as Record<string, unknown>);
  const { rows: lineRows } = await pool.query(
    `SELECT * FROM expense_claim_lines WHERE claim_id = $1 ORDER BY expense_date`,
    [claimId],
  );
  return { ...claim, lines: lineRows.map((r) => mapLine(r as Record<string, unknown>)) };
}

export async function updateExpenseClaimStatus(
  client: pg.PoolClient,
  workspaceId: string,
  claimId: string,
  status: ExpenseClaimRow['status'],
  journalEntryId?: string,
): Promise<void> {
  await client.query(
    `UPDATE expense_claims
     SET status = $3, updated_at = NOW()${journalEntryId ? ', journal_entry_id = $4' : ''}
     WHERE workspace_id = $1 AND id = $2`,
    journalEntryId
      ? [workspaceId, claimId, status, journalEntryId]
      : [workspaceId, claimId, status],
  );
}
