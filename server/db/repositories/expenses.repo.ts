import type pg from 'pg';
import { pool } from '../client.js';

export interface DbExpenseRowMapped {
  id: string; status: string; contactId: string | null; contactLegalName: string | null;
  supplierInvoiceRef: string | null; issueDate: string; dueDate: string | null;
  description: string; subtotalHtMinor: number; vatTotalMinor: number;
  totalTtcMinor: number; amountPaidMinor: number; currency: string;
  journalEntryId: string | null;
  lines: Array<{ accountCode?: string; vatRuleCode?: string; [k: string]: unknown }>;
}

function toDbRow(r: {
  id: string; status: string; contact_id: string | null; contact_legal_name: string | null;
  supplier_invoice_ref: string | null; issue_date: string; due_date: string | null;
  description: string; subtotal_ht_minor: number; vat_total_minor: number;
  total_ttc_minor: number; amount_paid_minor: number; currency: string;
  journal_entry_id: string | null;
  lines: Array<Record<string, unknown>>;
}): DbExpenseRowMapped {
  return {
    id: r.id, status: r.status, contactId: r.contact_id, contactLegalName: r.contact_legal_name,
    supplierInvoiceRef: r.supplier_invoice_ref, issueDate: r.issue_date, dueDate: r.due_date,
    description: r.description, subtotalHtMinor: r.subtotal_ht_minor,
    vatTotalMinor: r.vat_total_minor, totalTtcMinor: r.total_ttc_minor,
    amountPaidMinor: r.amount_paid_minor ?? 0, currency: r.currency ?? 'EUR',
    journalEntryId: r.journal_entry_id,
    lines: (r.lines ?? []) as DbExpenseRowMapped['lines'],
  };
}

const SELECT_EXPENSES = `
  SELECT e.id, e.status,
         e.supplier_contact_id AS contact_id, c.legal_name AS contact_legal_name,
         e.supplier_invoice_ref, e.expense_date::TEXT AS issue_date,
         e.due_date::TEXT, COALESCE(e.currency, 'EUR') AS currency,
         e.subtotal_ht_minor, e.vat_total_minor, e.total_ttc_minor,
         COALESCE(e.amount_paid_minor, 0) AS amount_paid_minor,
         e.journal_entry_id,
         COALESCE((SELECT el2.description FROM expense_lines el2 WHERE el2.expense_id = e.id ORDER BY el2.position LIMIT 1), e.supplier_invoice_ref, '') AS description,
         COALESCE(json_agg(DISTINCT jsonb_build_object(
           'id', el.id, 'position', el.position,
           'description', el.description,
           'accountCode', a.account_code,
           'vatRuleCode', tr.code, 'vatRate', el.vat_rate,
           'amountHtMinor', el.amount_ht_minor,
           'vatTotalMinor', el.vat_total_minor,
           'deductibilityRatio', el.deductibility_ratio,
           'amountTtcMinor', el.amount_ttc_minor
         )) FILTER (WHERE el.id IS NOT NULL), '[]') AS lines
  FROM expenses e
  LEFT JOIN contacts c ON c.id = e.supplier_contact_id
  LEFT JOIN expense_lines el ON el.expense_id = e.id
  LEFT JOIN accounts a ON a.id = el.accounting_account_id
  LEFT JOIN tax_rules tr ON tr.id = el.vat_rule_id`;

export async function getExpenses(workspaceId: string): Promise<DbExpenseRowMapped[]> {
  const { rows } = await pool.query(
    `${SELECT_EXPENSES} WHERE e.workspace_id = $1
     GROUP BY e.id, e.supplier_contact_id, c.legal_name ORDER BY e.expense_date DESC, e.created_at DESC`,
    [workspaceId],
  );
  return rows.map((r) => toDbRow(r as Parameters<typeof toDbRow>[0]));
}

export async function getExpenseById(workspaceId: string, expenseId: string): Promise<DbExpenseRowMapped | null> {
  const { rows } = await pool.query(
    `${SELECT_EXPENSES} WHERE e.workspace_id = $1 AND e.id = $2 GROUP BY e.id, e.supplier_contact_id, c.legal_name`,
    [workspaceId, expenseId],
  );
  return rows[0] ? toDbRow(rows[0] as Parameters<typeof toDbRow>[0]) : null;
}

export async function createExpense(
  client: pg.PoolClient,
  workspaceId: string,
  userId: string,
  data: {
    documentType: string; contactId: string | null; issueDate: string;
    accountingDate: string; dueDate: string | null; currency: string;
    operationCategory: string; description: string;
    subtotalHtMinor: number; vatTotalMinor: number; totalTtcMinor: number;
    supplierInvoiceRef: string | null; ocrConfidence: number | null;
    issuerSnapshot: Record<string, unknown>;
    lines: Array<{
      position: number; accountId: string; description: string;
      quantity: number; unitCode: string; unitPriceHtMinor: number; discountPercent: number;
      vatRuleId: string | null; vatRateSnapshot: number; vatCategoryCode: string;
      lineSubtotalHtMinor: number; lineVatPreviewMinor: number; lineTotalTtcPreviewMinor: number;
    }>;
    taxBreakdowns: Array<{
      vatRuleId: string | null; vatCategoryCode: string; vatRate: number;
      taxableBaseHtMinor: number; vatAmountMinor: number;
    }>;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO expenses (
       workspace_id, created_by, supplier_contact_id, status,
       expense_date, due_date, currency,
       subtotal_ht_minor, vat_total_minor, vat_deductible_minor, total_ttc_minor,
       amount_paid_minor, supplier_invoice_ref
     ) VALUES ($1,$2,$3,'draft',
       $4,$5,$6,$7,$8,$9,$10,0,$11)
     RETURNING id`,
    [
      workspaceId, userId, data.contactId,
      data.issueDate, data.dueDate, data.currency,
      data.subtotalHtMinor, data.vatTotalMinor,
      Math.round(data.vatTotalMinor * 0.8), // vat_deductible_minor estimate
      data.totalTtcMinor,
      data.supplierInvoiceRef,
    ],
  );
  const expenseId = rows[0]!.id;

  for (const line of data.lines) {
    await client.query(
      `INSERT INTO expense_lines (
         workspace_id, expense_id, position, accounting_account_id, description,
         vat_rule_id, vat_rate, deductibility_ratio,
         amount_ht_minor, vat_total_minor, vat_deductible_minor, vat_non_deductible_minor, amount_ttc_minor
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        workspaceId, expenseId, line.position, line.accountId, line.description,
        line.vatRuleId, line.vatRateSnapshot, 1.0,
        line.lineSubtotalHtMinor, line.lineVatPreviewMinor,
        Math.round(line.lineVatPreviewMinor * 0.8),
        Math.round(line.lineVatPreviewMinor * 0.2),
        line.lineTotalTtcPreviewMinor,
      ],
    );
  }

  for (const tb of data.taxBreakdowns) {
    await client.query(
      `INSERT INTO expense_tax_breakdowns (
         workspace_id, expense_id, vat_rule_id, vat_category_code, vat_rate,
         taxable_base_ht_minor, vat_amount_minor
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [workspaceId, expenseId, tb.vatRuleId, tb.vatCategoryCode, tb.vatRate, tb.taxableBaseHtMinor, tb.vatAmountMinor],
    );
  }
  return expenseId;
}

export async function updateExpenseStatus(
  client: pg.PoolClient,
  workspaceId: string,
  expenseId: string,
  status: string,
  journalEntryId: string | null,
  documentHash: string | null,
  previousDocumentHash: string | null,
): Promise<void> {
  await client.query(
    `UPDATE expenses
     SET status = $3, journal_entry_id = $4, document_hash = $5, previous_document_hash = $6
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, expenseId, status, journalEntryId, documentHash, previousDocumentHash],
  );
}

export async function recordExpensePayment(
  workspaceId: string,
  expenseId: string,
  amountPaidMinor: number,
  paymentDate: string,
  paymentMethod: string,
): Promise<void> {
  await pool.query(
    `UPDATE expenses
     SET amount_paid_minor = $3, payment_date = $4, payment_method = $5,
         status = CASE WHEN $3 >= total_ttc_minor THEN 'paid' ELSE 'partially_paid' END
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, expenseId, amountPaidMinor, paymentDate, paymentMethod],
  );
}
