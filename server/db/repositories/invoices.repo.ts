import type pg from 'pg';
import { pool } from '../client.js';
import type { SalesDocumentRecord } from '../../application/workspaceStore.js';

interface DbInvoiceRow {
  id: string; document_type: string; provisional_ref: string; number: string | null;
  status: string; payment_status: string; einvoice_status: string;
  contact_id: string; contact_legal_name: string;
  original_invoice_id: string | null; original_invoice_number: string | null;
  operation_category: string; issue_date: string; delivery_or_service_date: string;
  due_date: string; purchase_order_ref: string | null; currency: string;
  subtotal_ht_minor: number; vat_total_minor: number; total_ttc_minor: number;
  deposits_deducted_ttc_minor: number; net_to_pay_ttc_minor: number;
  amount_paid_minor: number; late_penalty_rate_percent: string;
  recovery_indemnity_minor: number; discount_terms: string;
  vat_exemption_mention: string | null; vat_on_debits_mention: boolean;
  facturx_xml: string | null; previous_document_hash: string | null;
  document_hash: string | null; journal_entry_id: string | null; issued_at: string | null;
  realized_vat_by_rule_minor: Record<string, number>;
  lines: Array<Record<string, unknown>>;
  tax_breakdowns: Array<Record<string, unknown>>;
}

function toSalesRecord(r: DbInvoiceRow): SalesDocumentRecord {
  return {
    id: r.id,
    documentType: r.document_type as SalesDocumentRecord['documentType'],
    provisionalRef: r.provisional_ref,
    number: r.number,
    status: r.status as SalesDocumentRecord['status'],
    paymentStatus: r.payment_status as SalesDocumentRecord['paymentStatus'],
    einvoiceStatus: r.einvoice_status as SalesDocumentRecord['einvoiceStatus'],
    contactId: r.contact_id,
    contactLegalName: r.contact_legal_name,
    originalInvoiceId: r.original_invoice_id,
    originalInvoiceNumber: r.original_invoice_number,
    operationCategory: r.operation_category as SalesDocumentRecord['operationCategory'],
    issueDate: r.issue_date,
    deliveryOrServiceDate: r.delivery_or_service_date,
    dueDate: r.due_date,
    purchaseOrderRef: r.purchase_order_ref,
    currency: r.currency,
    lines: (r.lines ?? []) as unknown as SalesDocumentRecord['lines'],
    taxBreakdowns: (r.tax_breakdowns ?? []) as unknown as SalesDocumentRecord['taxBreakdowns'],
    subtotalHtMinor: r.subtotal_ht_minor,
    vatTotalMinor: r.vat_total_minor,
    totalTtcMinor: r.total_ttc_minor,
    depositsDeductedTtcMinor: r.deposits_deducted_ttc_minor ?? 0,
    netToPayTtcMinor: r.net_to_pay_ttc_minor,
    amountPaidMinor: r.amount_paid_minor ?? 0,
    realizedVatByRuleMinor: r.realized_vat_by_rule_minor ?? {},
    latePenaltyRatePercent: r.late_penalty_rate_percent ?? '15.000',
    recoveryIndemnityMinor: r.recovery_indemnity_minor ?? 4000,
    discountTerms: r.discount_terms ?? '',
    vatExemptionMention: r.vat_exemption_mention,
    vatOnDebitsMention: r.vat_on_debits_mention ?? false,
    facturxXml: r.facturx_xml,
    previousDocumentHash: r.previous_document_hash,
    documentHash: r.document_hash,
    journalEntryId: r.journal_entry_id,
    issuedAt: r.issued_at,
  };
}

const SELECT_INVOICES = `
  SELECT i.id, i.document_type, i.provisional_ref, i.number, i.status, i.payment_status,
         COALESCE(i.einvoice_status,'not_applicable') as einvoice_status,
         i.contact_id, c.legal_name as contact_legal_name,
         i.original_invoice_id,
         (SELECT n.number FROM invoices n WHERE n.id = i.original_invoice_id) as original_invoice_number,
         COALESCE(i.operation_category,'services') as operation_category,
         i.issue_date::TEXT, i.delivery_or_service_date::TEXT as delivery_or_service_date,
         i.due_date::TEXT, i.purchase_order_ref, COALESCE(i.currency,'EUR') as currency,
         i.subtotal_ht_minor, i.vat_total_minor, i.total_ttc_minor,
         COALESCE(i.deposits_deducted_ttc_minor,0) as deposits_deducted_ttc_minor,
         i.net_to_pay_ttc_minor, COALESCE(i.amount_paid_minor,0) as amount_paid_minor,
         COALESCE(i.late_penalty_rate,'15.000') as late_penalty_rate_percent,
         COALESCE(i.recovery_indemnity_minor,4000) as recovery_indemnity_minor,
         COALESCE(i.discount_terms,'') as discount_terms,
         i.vat_exemption_mention, COALESCE(i.vat_on_debits_mention,false) as vat_on_debits_mention,
         i.facturx_xml, i.previous_document_hash, i.document_hash, i.journal_entry_id,
         i.issued_at::TEXT, '{}'::JSONB as realized_vat_by_rule_minor,
         COALESCE(json_agg(DISTINCT jsonb_build_object(
           'id',il.id,'position',il.position,'productCode',il.product_code,
           'description',il.description,'quantity',il.quantity,'unitCode',il.unit_code,
           'unitPriceHtMinor',il.unit_price_ht_minor,'discountPercent',il.discount_percent,
           'vatRuleCode',tr.code,'vatRatePercent',il.vat_rate_snapshot,
           'vatCategoryCode',il.vat_category_code,'lineSubtotalHtMinor',il.line_subtotal_ht_minor,
           'lineVatPreviewMinor',il.line_vat_preview_minor,'lineTotalTtcPreviewMinor',il.line_total_ttc_preview_minor
         )) FILTER (WHERE il.id IS NOT NULL), '[]') as lines,
         COALESCE(json_agg(DISTINCT jsonb_build_object(
           'vatRuleCode',tr2.code,'vatRate',tb.vat_rate,
           'taxableBaseHtMinor',tb.taxable_base_ht_minor,'vatAmountMinor',tb.vat_amount_minor,
           'vatCategoryCode',tb.vat_category_code
         )) FILTER (WHERE tb.id IS NOT NULL), '[]') as tax_breakdowns
  FROM invoices i
  JOIN contacts c ON c.id = i.contact_id
  LEFT JOIN invoice_lines il ON il.invoice_id = i.id
  LEFT JOIN tax_rules tr ON tr.id = il.vat_rule_id
  LEFT JOIN invoice_tax_breakdowns tb ON tb.invoice_id = i.id
  LEFT JOIN tax_rules tr2 ON tr2.id = tb.vat_rule_id`;

export async function getInvoices(workspaceId: string): Promise<SalesDocumentRecord[]> {
  const { rows } = await pool.query<DbInvoiceRow>(
    `${SELECT_INVOICES} WHERE i.workspace_id = $1 GROUP BY i.id, c.legal_name ORDER BY i.created_at DESC`,
    [workspaceId],
  );
  return rows.map(toSalesRecord);
}

export async function getInvoiceById(workspaceId: string, invoiceId: string): Promise<SalesDocumentRecord | null> {
  const { rows } = await pool.query<DbInvoiceRow>(
    `${SELECT_INVOICES} WHERE i.workspace_id = $1 AND i.id = $2 GROUP BY i.id, c.legal_name`,
    [workspaceId, invoiceId],
  );
  return rows[0] ? toSalesRecord(rows[0]) : null;
}

export async function createDraftInvoice(
  client: pg.PoolClient,
  workspaceId: string,
  userId: string,
  data: {
    documentType: string; provisionalRef: string; contactId: string;
    issueDate: string; deliveryOrServiceDate: string; dueDate: string;
    purchaseOrderRef: string | null; currency: string; operationCategory: string;
    subtotalHtMinor: number; vatTotalMinor: number; totalTtcMinor: number;
    depositsDeductedTtcMinor: number; netToPayTtcMinor: number;
    latePenaltyRatePercent: string; recoveryIndemnityMinor: number; discountTerms: string;
    vatExemptionMention: string | null; vatOnDebitsMention: boolean;
    issuerSnapshot: Record<string, unknown>; customerSnapshot: Record<string, unknown>;
    originalInvoiceId: string | null;
    lines: Array<{
      position: number; productCode: string | null; description: string;
      quantity: number; unitCode: string; unitPriceHtMinor: number; discountPercent: number;
      vatRuleId: string; vatRateSnapshot: number; vatCategoryCode: string;
      lineSubtotalHtMinor: number; lineVatPreviewMinor: number; lineTotalTtcPreviewMinor: number;
    }>;
    taxBreakdowns: Array<{
      vatRuleId: string; vatCategoryCode: string; vatRate: number;
      taxableBaseHtMinor: number; vatAmountMinor: number;
    }>;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO invoices (
       workspace_id, created_by, contact_id, document_type, provisional_ref,
       original_invoice_id, status, payment_status, einvoice_status,
       issue_date, delivery_or_service_date, due_date, purchase_order_ref, currency, operation_category,
       subtotal_ht_minor, vat_total_minor, total_ttc_minor,
       deposits_deducted_ttc_minor, net_to_pay_ttc_minor, amount_paid_minor,
       late_penalty_rate, recovery_indemnity_minor, discount_terms,
       vat_exemption_mention, vat_on_debits_mention, issuer_snapshot, customer_snapshot
     ) VALUES ($1,$2,$3,$4,$5,$6,'draft','unpaid','not_applicable',
       $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,0,$18,$19,$20,$21,$22,$23,$24)
     RETURNING id`,
    [
      workspaceId, userId, data.contactId, data.documentType, data.provisionalRef,
      data.originalInvoiceId,
      data.issueDate, data.deliveryOrServiceDate, data.dueDate, data.purchaseOrderRef,
      data.currency, data.operationCategory,
      data.subtotalHtMinor, data.vatTotalMinor, data.totalTtcMinor,
      data.depositsDeductedTtcMinor, data.netToPayTtcMinor,
      data.latePenaltyRatePercent, data.recoveryIndemnityMinor, data.discountTerms,
      data.vatExemptionMention, data.vatOnDebitsMention,
      JSON.stringify(data.issuerSnapshot), JSON.stringify(data.customerSnapshot),
    ],
  );
  const invoiceId = rows[0]!.id;

  for (const line of data.lines) {
    await client.query(
      `INSERT INTO invoice_lines (
         workspace_id, invoice_id, position, product_code, description, quantity, unit_code,
         unit_price_ht_minor, discount_percent, discount_amount_ht_minor,
         vat_rule_id, vat_rate_snapshot, vat_category_code,
         line_subtotal_ht_minor, line_vat_preview_minor, line_total_ttc_preview_minor
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15)`,
      [
        workspaceId, invoiceId, line.position, line.productCode, line.description,
        line.quantity, line.unitCode, line.unitPriceHtMinor, line.discountPercent,
        line.vatRuleId, line.vatRateSnapshot, line.vatCategoryCode,
        line.lineSubtotalHtMinor, line.lineVatPreviewMinor, line.lineTotalTtcPreviewMinor,
      ],
    );
  }
  for (const tb of data.taxBreakdowns) {
    await client.query(
      `INSERT INTO invoice_tax_breakdowns (
         workspace_id, invoice_id, vat_rule_id, vat_category_code, vat_rate,
         taxable_base_ht_minor, vat_amount_minor
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [workspaceId, invoiceId, tb.vatRuleId, tb.vatCategoryCode, tb.vatRate, tb.taxableBaseHtMinor, tb.vatAmountMinor],
    );
  }
  return invoiceId;
}

export async function issueInvoice(
  client: pg.PoolClient,
  workspaceId: string,
  invoiceId: string,
  number: string,
  documentHash: string,
  previousDocumentHash: string | null,
  journalEntryId: string | null,
  facturxXml: string | null,
): Promise<void> {
  await client.query(
    `UPDATE invoices SET number=$3, status='issued', issued_at=NOW(),
       document_hash=$4, previous_document_hash=$5, journal_entry_id=$6, facturx_xml=$7
     WHERE workspace_id=$1 AND id=$2 AND status='draft'`,
    [workspaceId, invoiceId, number, documentHash, previousDocumentHash, journalEntryId, facturxXml],
  );
}

export async function recordInvoicePayment(
  client: pg.PoolClient,
  workspaceId: string,
  invoiceId: string,
  newAmountPaidMinor: number,
  newPaymentStatus: string,
): Promise<void> {
  await client.query(
    `UPDATE invoices SET amount_paid_minor=$3, payment_status=$4 WHERE workspace_id=$1 AND id=$2`,
    [workspaceId, invoiceId, newAmountPaidMinor, newPaymentStatus],
  );
}

export async function cancelInvoiceByCreditNote(
  client: pg.PoolClient,
  workspaceId: string,
  invoiceId: string,
): Promise<void> {
  await client.query(
    `UPDATE invoices SET status='cancelled_by_credit_note' WHERE workspace_id=$1 AND id=$2`,
    [workspaceId, invoiceId],
  );
}
