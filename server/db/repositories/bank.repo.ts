import { pool } from '../client.js';
import type { BankTransactionRecord } from '../../application/workspaceStore.js';

export async function getBankTransactions(workspaceId: string): Promise<BankTransactionRecord[]> {
  const { rows: accountRows } = await pool.query<{ id: string; bank_name: string }>(
    `SELECT id, COALESCE(bank_name, 'Banque') as bank_name
     FROM bank_accounts WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`,
    [workspaceId],
  );
  if (!accountRows[0]) return [];

  const { rows } = await pool.query<{
    id: string; transaction_date: string; description: string; counterparty_name: string;
    amount_minor: number; status: string; external_ref: string | null;
  }>(
    `SELECT id, transaction_date::TEXT, description, COALESCE(counterparty_name,'') as counterparty_name,
            amount_minor, status, external_ref
     FROM bank_transactions
     WHERE workspace_id = $1 AND bank_account_id = $2
     ORDER BY transaction_date DESC, created_at DESC`,
    [workspaceId, accountRows[0].id],
  );

  const bankName = accountRows[0].bank_name;
  return rows.map((r) => ({
    id: r.id,
    transactionDate: r.transaction_date,
    description: r.description,
    counterpartyName: r.counterparty_name,
    bankName,
    bankAccountCode: '512000',
    sourceLabel: 'Import',
    amountMinor: r.amount_minor,
    status: r.status as 'unmatched' | 'matched',
    workflowStatus: (r.external_ref ?? 'a_traiter') as BankTransactionRecord['workflowStatus'],
    matchedDocumentId: null,
    matchedDocumentNumber: null,
    letteringCode: null,
    reconciledAllocations: [],
    comments: [],
    ruleName: null,
  }));
}

export async function insertBankTransactions(
  workspaceId: string,
  bankAccountId: string,
  transactions: Array<{
    transactionDate: string;
    description: string;
    amountMinor: number;
    counterpartyName?: string;
    fingerprint: string;
  }>,
): Promise<BankTransactionRecord[]> {
  const created: BankTransactionRecord[] = [];
  for (const tx of transactions) {
    const { rows } = await pool.query<{ id: string; transaction_date: string }>(
      `INSERT INTO bank_transactions (
         workspace_id, bank_account_id, transaction_date, description, counterparty_name,
         amount_minor, fingerprint, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'unmatched')
       ON CONFLICT (workspace_id, bank_account_id, fingerprint) DO NOTHING
       RETURNING id, transaction_date::TEXT`,
      [
        workspaceId, bankAccountId, tx.transactionDate, tx.description,
        tx.counterpartyName ?? '', tx.amountMinor, tx.fingerprint,
      ],
    );
    if (rows[0]) {
      created.push({
        id: rows[0].id,
        transactionDate: rows[0].transaction_date,
        description: tx.description,
        counterpartyName: tx.counterpartyName ?? '',
        bankName: 'Import',
        bankAccountCode: '512000',
        sourceLabel: 'Import',
        amountMinor: tx.amountMinor,
        status: 'unmatched',
        workflowStatus: 'a_traiter',
        matchedDocumentId: null,
        matchedDocumentNumber: null,
        letteringCode: null,
        reconciledAllocations: [],
        comments: [],
        ruleName: null,
      });
    }
  }
  return created;
}

export async function updateBankTransactionWorkflow(
  workspaceId: string,
  transactionId: string,
  workflowStatus: string,
): Promise<void> {
  await pool.query(
    `UPDATE bank_transactions SET external_ref = $3 WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, transactionId, workflowStatus],
  );
}

export async function getDefaultBankAccountId(workspaceId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM bank_accounts WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`,
    [workspaceId],
  );
  return rows[0]?.id ?? null;
}

export async function markBankTransactionMatched(
  workspaceId: string,
  transactionId: string,
): Promise<void> {
  await pool.query(
    `UPDATE bank_transactions SET status = 'matched' WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, transactionId],
  );
}
