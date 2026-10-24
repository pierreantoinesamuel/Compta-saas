/**
 * DB-backed async workspace service — replaces in-memory HaxataxWorkspaceEngine.
 * All methods accept workspaceId and return Promises backed by Neon PostgreSQL.
 */

import { randomUUID } from 'node:crypto';
import { pool } from '../db/client.js';
import * as contactsRepo from '../db/repositories/contacts.repo.js';
import * as invoicesRepo from '../db/repositories/invoices.repo.js';
import * as expensesRepo from '../db/repositories/expenses.repo.js';
import * as journalRepo from '../db/repositories/journal.repo.js';
import * as bankRepo from '../db/repositories/bank.repo.js';
import * as auditRepo from '../db/repositories/audit.repo.js';
import * as sequencesRepo from '../db/repositories/sequences.repo.js';
import * as workspaceRepo from '../db/repositories/workspace.repo.js';

import {
  computeFrenchVatNumber,
  generateAuxiliaryAccountCode,
  validateEuVatNumber,
  validateSiren,
  validateSiret,
} from '../domain/contacts/frenchLegalValidators.js';
import {
  calculateExpenseLineVat,
  calculateInvoiceTotals,
  getTaxRuleOrThrow,
  type InvoiceLineInput,
} from '../domain/tax/vatEngine.js';
import { generateFacturxXml } from '../domain/einvoicing/facturxGenerator.js';
import {
  generateStatutoryFec,
  validateAuxiliaryLetteringGroup,
  validateJournalEntryForPosting,
} from '../domain/accounting/pcg2025.js';
import {
  computeChainedRecordHash,
  verifyHashChain,
} from '../domain/audit/hashChain.js';

export type {
  WorkspaceProfile,
  ContactRecord,
  SalesDocumentRecord,
  LedgerEntryRecord,
  BankTransactionRecord,
  BankReconciliationAllocation,
  BankTransactionComment,
} from './workspaceStore.js';

// DB-compatible expense record (returned to clients, backward-compatible with old ExpenseRecord)
export interface DbExpenseRecord {
  id: string;
  supplierContactId: string;
  supplierName: string;
  supplierInvoiceRef: string;
  expenseDate: string;
  dueDate: string;
  description: string;
  accountingAccountCode: string;
  taxRuleCode: string;
  deductibilityRatio: string;
  amountHtMinor: number;
  vatTotalMinor: number;
  vatDeductibleMinor: number;
  vatNonDeductibleMinor: number;
  amountTtcMinor: number;
  currency: 'EUR' | 'USD';
  foreignAmountTtcMinor: number | null;
  status: 'needs_review' | 'approved' | 'paid' | 'reconciled';
  inboxState: 'inbox' | 'to_pay' | 'paid';
  paymentState: 'to_pay' | 'paid';
  source: string;
  journalEntryId: string | null;
  reconciledTransactionId: string | null;
  rejectedTransactionIds: string[];
  pagesCount: number;
  categoryLabel: string;
}

export type ExpenseRecord = DbExpenseRecord;

const FISCAL_YEAR = 2026;

function mapDbStatusToOldStatus(dbStatus: string): DbExpenseRecord['status'] {
  const map: Record<string, DbExpenseRecord['status']> = {
    pending_review: 'needs_review', approved: 'approved', paid: 'paid',
    partially_paid: 'needs_review', reconciled: 'reconciled',
  };
  return map[dbStatus] ?? 'needs_review';
}

function dbExpenseToRecord(row: {
  id: string; contactId: string | null; contactLegalName: string | null;
  supplierInvoiceRef: string | null; issueDate: string; dueDate: string | null;
  description: string; subtotalHtMinor: number; vatTotalMinor: number; totalTtcMinor: number;
  amountPaidMinor: number; currency: string; status: string;
  journalEntryId: string | null; lines: Array<{ accountCode?: string; vatRuleCode?: string }>;
}): DbExpenseRecord {
  const deductibilityRatio = '1.00';
  const vatDeductible = row.vatTotalMinor;
  return {
    id: row.id,
    supplierContactId: row.contactId ?? '',
    supplierName: row.contactLegalName ?? '',
    supplierInvoiceRef: row.supplierInvoiceRef ?? '',
    expenseDate: row.issueDate,
    dueDate: row.dueDate ?? row.issueDate,
    description: row.description,
    accountingAccountCode: row.lines?.[0]?.accountCode ?? '607100',
    taxRuleCode: row.lines?.[0]?.vatRuleCode ?? 'FR_TVA_20',
    deductibilityRatio,
    amountHtMinor: row.subtotalHtMinor,
    vatTotalMinor: row.vatTotalMinor,
    vatDeductibleMinor: vatDeductible,
    vatNonDeductibleMinor: 0,
    amountTtcMinor: row.totalTtcMinor,
    currency: (row.currency ?? 'EUR') as 'EUR' | 'USD',
    foreignAmountTtcMinor: null,
    status: mapDbStatusToOldStatus(row.status ?? 'pending_review'),
    inboxState: row.status === 'paid' || row.status === 'reconciled' ? 'paid' : row.status === 'approved' ? 'to_pay' : 'inbox',
    paymentState: row.amountPaidMinor >= row.totalTtcMinor ? 'paid' : 'to_pay',
    source: 'Import manuel',
    journalEntryId: row.journalEntryId,
    reconciledTransactionId: null,
    rejectedTransactionIds: [],
    pagesCount: 1,
    categoryLabel: 'Achats & Frais généraux',
  };
}

class HaxataxWorkspaceService {
  // ─── Workspace ─────────────────────────────────────────────────────────────

  async getWorkspace(workspaceId: string) {
    const ws = await workspaceRepo.getWorkspace(workspaceId);
    if (!ws) throw new Error('WORKSPACE_NOT_FOUND');
    return ws;
  }

  async updateWorkspace(workspaceId: string, patch: Record<string, unknown>) {
    if (patch.siren) {
      const check = validateSiren(patch.siren as string);
      if (!check.valid) throw new Error(check.errorMessage);
      patch.siren = check.normalized;
      patch.vatNumber = computeFrenchVatNumber(check.normalized);
    }
    if (patch.siret) {
      const check = validateSiret(patch.siret as string);
      if (!check.valid) throw new Error(check.errorMessage);
      patch.siret = check.normalized;
    }
    return workspaceRepo.updateWorkspace(workspaceId, patch);
  }

  // ─── Contacts ──────────────────────────────────────────────────────────────

  async getContacts(workspaceId: string) {
    return contactsRepo.getContacts(workspaceId);
  }

  async createContact(workspaceId: string, userId: string, input: {
    kind: 'customer' | 'supplier' | 'both'; isBusiness: boolean;
    taxZone: 'DOMESTIC_FR' | 'DOM_TOM' | 'INTRA_EU' | 'EXPORT_NON_EU';
    legalName: string; siren?: string | null; siret?: string | null;
    vatIdentifier?: string | null; email?: string;
    billingAddress: { streetLine1: string; postalCode: string; city: string; countryCode: string };
    defaultPaymentTermsDays?: number; certifiedIban?: string | null;
  }) {
    const legalName = input.legalName?.trim();
    if (!legalName) throw new Error('La raison sociale ou le nom du tiers est obligatoire.');

    let siren = input.siren ?? null;
    let vatId = input.vatIdentifier ?? null;

    if (siren?.trim()) {
      const check = validateSiren(siren);
      if (!check.valid) throw new Error(check.errorMessage);
      siren = check.normalized;
      if (!vatId && input.taxZone === 'DOMESTIC_FR') vatId = computeFrenchVatNumber(siren);
    }
    if (vatId) {
      const vatCheck = validateEuVatNumber(vatId);
      if (!vatCheck.valid) throw new Error(vatCheck.errorMessage);
      vatId = vatCheck.normalized;
    }

    const existingContacts = await contactsRepo.getContacts(workspaceId);
    const idx = existingContacts.length + 1;
    const customerAux = input.kind === 'customer' || input.kind === 'both' ? generateAuxiliaryAccountCode('customer', idx) : null;
    const supplierAux = input.kind === 'supplier' || input.kind === 'both' ? generateAuxiliaryAccountCode('supplier', idx) : null;

    return contactsRepo.createContact(workspaceId, userId, {
      kind: input.kind, isBusiness: input.isBusiness, taxZone: input.taxZone,
      legalName, siren, siret: input.siret ?? null, vatIdentifier: vatId,
      email: input.email?.trim() ?? '', billingAddress: input.billingAddress,
      customerAuxiliaryCode: customerAux, supplierAuxiliaryCode: supplierAux,
      certifiedIban: input.certifiedIban ?? null, defaultPaymentTermsDays: Math.min(60, Math.max(0, input.defaultPaymentTermsDays ?? 30)),
    });
  }

  async archiveContact(workspaceId: string, contactId: string) {
    return contactsRepo.archiveContact(workspaceId, contactId);
  }

  // ─── Invoices ──────────────────────────────────────────────────────────────

  async getInvoices(workspaceId: string) {
    return invoicesRepo.getInvoices(workspaceId);
  }

  async createDraftInvoice(workspaceId: string, userId: string, input: {
    documentType: string; contactId: string; originalInvoiceId?: string | null;
    issueDate: string; deliveryOrServiceDate?: string; dueDate: string;
    purchaseOrderRef?: string | null; lines: InvoiceLineInput[];
  }) {
    const contact = await contactsRepo.getContactById(workspaceId, input.contactId);
    if (!contact) throw new Error('CONTACT_NOT_FOUND: Tiers introuvable.');
    if (contact.kind !== 'customer' && contact.kind !== 'both') throw new Error('CONTACT_NOT_CUSTOMER: Sélectionnez un client pour créer un document de vente.');

    const ws = await this.getWorkspace(workspaceId);
    const calculated = calculateInvoiceTotals({
      documentType: input.documentType as Parameters<typeof calculateInvoiceTotals>[0]['documentType'],
      isCustomerBusiness: contact.isBusiness, customerTaxZone: contact.taxZone,
      customerSiren: contact.siren, customerVatIdentifier: contact.vatIdentifier,
      workspaceVatRegime: ws.vatRegime, workspaceVatExigibility: ws.vatExigibility,
      originalInvoiceId: input.originalInvoiceId ?? null, lines: input.lines,
    });

    const provRef = `(PROV-${randomUUID().slice(0, 8).toUpperCase()})`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const getTaxRuleId = async (code: string) => workspaceRepo.getTaxRuleId(workspaceId, code);
      const lines = await Promise.all(calculated.lines.map(async (l, idx) => {
        const vatRuleId = await getTaxRuleId(l.taxRuleCode ?? 'FR_TVA_20') ?? await getTaxRuleId('FR_TVA_0');
        return { position: idx + 1, productCode: null, description: l.description, quantity: parseFloat(l.quantity), unitCode: l.unitCode, unitPriceHtMinor: l.unitPriceHtMinor, discountPercent: parseFloat(l.discountPercent), vatRuleId: vatRuleId ?? '', vatRateSnapshot: parseFloat(l.vatRatePercent), vatCategoryCode: l.vatCategoryCode ?? 'S', lineSubtotalHtMinor: l.lineSubtotalHtMinor, lineVatPreviewMinor: l.lineVatPreviewMinor, lineTotalTtcPreviewMinor: l.lineTotalTtcPreviewMinor };
      }));
      const taxBreakdowns = await Promise.all(calculated.taxBreakdowns.map(async (tb) => {
        const vatRuleId = await getTaxRuleId(tb.taxRuleCode ?? 'FR_TVA_20') ?? await getTaxRuleId('FR_TVA_0');
        return { vatRuleId: vatRuleId ?? '', vatCategoryCode: tb.vatCategoryCode ?? 'S', vatRate: parseFloat(tb.vatRatePercent), taxableBaseHtMinor: tb.taxableBaseHtMinor, vatAmountMinor: tb.vatAmountMinor };
      }));

      const invoiceId = await invoicesRepo.createDraftInvoice(client, workspaceId, userId, {
        documentType: input.documentType, provisionalRef: provRef, contactId: contact.id,
        issueDate: input.issueDate, deliveryOrServiceDate: input.deliveryOrServiceDate ?? input.issueDate,
        dueDate: input.dueDate, purchaseOrderRef: input.purchaseOrderRef ?? null, currency: 'EUR',
        operationCategory: calculated.operationCategory,
        subtotalHtMinor: calculated.subtotalHtMinor, vatTotalMinor: calculated.vatTotalMinor, totalTtcMinor: calculated.totalTtcMinor,
        depositsDeductedTtcMinor: calculated.depositsDeductedTtcMinor, netToPayTtcMinor: calculated.netToPayTtcMinor,
        latePenaltyRatePercent: calculated.latePenaltyRatePercent, recoveryIndemnityMinor: calculated.recoveryIndemnityMinor,
        discountTerms: calculated.discountTerms, vatExemptionMention: calculated.vatExemptionMention, vatOnDebitsMention: calculated.vatOnDebitsMention,
        issuerSnapshot: { legalName: ws.legalName, siren: ws.siren }, customerSnapshot: { legalName: contact.legalName, siren: contact.siren },
        originalInvoiceId: input.originalInvoiceId ?? null, lines, taxBreakdowns,
      });
      await client.query('COMMIT');
      return (await invoicesRepo.getInvoiceById(workspaceId, invoiceId))!;
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }

  async issueSalesDocument(workspaceId: string, userId: string, invoiceId: string) {
    const periodStatus = await workspaceRepo.getWorkspacePeriodStatus(workspaceId);
    if (periodStatus === 'closed') throw new Error('PERIOD_CLOSED: Impossible d\'émettre une facture sur un exercice clôturé.');
    const doc = await invoicesRepo.getInvoiceById(workspaceId, invoiceId);
    if (!doc) throw new Error('INVOICE_NOT_FOUND: Document introuvable.');
    if (doc.status !== 'draft') throw new Error(`INVOICE_ALREADY_ISSUED: ${doc.number ?? doc.provisionalRef} est déjà émis.`);
    const contact = await contactsRepo.getContactById(workspaceId, doc.contactId);
    if (!contact) throw new Error('CONTACT_NOT_FOUND: Tiers introuvable.');
    const ws = await this.getWorkspace(workspaceId);

    const seqType = doc.documentType === 'credit_note' ? 'credit_note' : doc.documentType === 'deposit_invoice' ? 'deposit_invoice' : doc.documentType === 'quote' ? 'quote' : 'invoice';
    const seqPrefix = doc.documentType === 'credit_note' ? 'AV-2026-' : doc.documentType === 'deposit_invoice' ? 'AC-2026-' : doc.documentType === 'quote' ? 'DEV-2026-' : 'FA-2026-';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { seqNum, previousHash } = await sequencesRepo.allocateNextSequence(client, workspaceId, seqType, FISCAL_YEAR);
      const docNumber = `${seqPrefix}${String(seqNum).padStart(5, '0')}`;
      const issuedAt = new Date().toISOString();
      const { previousHash: prevDocHash, recordHash } = computeChainedRecordHash(previousHash, {
        workspaceId, sequenceNumberOrRef: docNumber, occurredAtIso: issuedAt, entityType: doc.documentType,
        payload: { number: docNumber, contactId: doc.contactId, subtotalHtMinor: doc.subtotalHtMinor, totalTtcMinor: doc.totalTtcMinor },
      });
      await sequencesRepo.updateSequenceHash(client, workspaceId, seqType, FISCAL_YEAR, recordHash);

      const facturxXml = generateFacturxXml({
        invoiceNumber: docNumber, issueDateIso: doc.issueDate, dueDateIso: doc.dueDate,
        deliveryDateIso: doc.deliveryOrServiceDate, currency: doc.currency, buyerReference: doc.purchaseOrderRef, originalInvoiceNumber: doc.originalInvoiceNumber,
        issuer: { legalName: ws.legalName, siren: ws.siren, siret: ws.siret, vatNumber: ws.vatNumber, streetLine1: ws.registeredAddress.streetLine1, postalCode: ws.registeredAddress.postalCode, city: ws.registeredAddress.city, countryCode: ws.registeredAddress.countryCode },
        customer: { legalName: contact.legalName, siren: contact.siren ?? '000000000', siret: contact.siret, vatNumber: contact.vatIdentifier, streetLine1: contact.billingAddress.streetLine1, postalCode: contact.billingAddress.postalCode, city: contact.billingAddress.city, countryCode: contact.billingAddress.countryCode },
        calculated: { documentType: doc.documentType, operationCategory: doc.operationCategory, lines: doc.lines, taxBreakdowns: doc.taxBreakdowns, subtotalHtMinor: doc.subtotalHtMinor, vatTotalMinor: doc.vatTotalMinor, totalTtcMinor: doc.totalTtcMinor, depositsDeductedTtcMinor: doc.depositsDeductedTtcMinor, netToPayTtcMinor: doc.netToPayTtcMinor, latePenaltyRatePercent: doc.latePenaltyRatePercent, recoveryIndemnityMinor: doc.recoveryIndemnityMinor, discountTerms: doc.discountTerms, vatExemptionMention: doc.vatExemptionMention, vatOnDebitsMention: doc.vatOnDebitsMention },
      });

      let journalEntryId: string | null = null;
      if (doc.documentType !== 'quote') {
        const journalId = await workspaceRepo.getJournalId(workspaceId, 'VE');
        const periodId = await workspaceRepo.getCurrentPeriodId(workspaceId);
        if (journalId && periodId) {
          const isCreditNote = doc.documentType === 'credit_note';
          const clientAccountId = await workspaceRepo.getAccountId(workspaceId, '411000');
          const revenueAccountId = await workspaceRepo.getAccountId(workspaceId, '706000');
          const vatAccountCode = ws.vatExigibility === 'ENCAISSEMENTS' ? '44574' : '44571';
          const vatAccountId = await workspaceRepo.getAccountId(workspaceId, vatAccountCode);
          const { seqNum: js, previousHash: jph } = await sequencesRepo.allocateNextSequence(client, workspaceId, 'journal_VE', FISCAL_YEAR);
          const jNum = `VE-2026-${String(js).padStart(5, '0')}`;
          const { recordHash: jHash } = computeChainedRecordHash(jph, {
            workspaceId, sequenceNumberOrRef: jNum, occurredAtIso: issuedAt, entityType: 'journal_entry',
            payload: { entryNumber: jNum, journalCode: 'VE', totalDebitMinor: doc.totalTtcMinor, totalCreditMinor: doc.totalTtcMinor },
          });
          await sequencesRepo.updateSequenceHash(client, workspaceId, 'journal_VE', FISCAL_YEAR, jHash);
          const sign = isCreditNote ? -1 : 1;
          const entryLines = [
            { accountId: clientAccountId!, contactId: contact.id, auxiliaryAccountCode: contact.customerAuxiliaryCode, auxiliaryAccountLabel: contact.legalName, description: `${isCreditNote ? 'Avoir' : 'Facture'} ${docNumber}`, debitMinor: isCreditNote ? 0 : doc.netToPayTtcMinor, creditMinor: isCreditNote ? doc.netToPayTtcMinor : 0 },
            { accountId: revenueAccountId!, contactId: null, auxiliaryAccountCode: null, auxiliaryAccountLabel: null, description: 'Prestations de services', debitMinor: isCreditNote ? doc.subtotalHtMinor : 0, creditMinor: isCreditNote ? 0 : doc.subtotalHtMinor },
          ];
          if (doc.vatTotalMinor > 0 && vatAccountId) {
            entryLines.push({ accountId: vatAccountId, contactId: null, auxiliaryAccountCode: null, auxiliaryAccountLabel: null, description: 'TVA collectée', debitMinor: isCreditNote ? doc.vatTotalMinor : 0, creditMinor: isCreditNote ? 0 : doc.vatTotalMinor });
          }
          journalEntryId = await journalRepo.insertJournalEntryWithLines(client, {
            workspaceId, journalId, periodId, entryNumber: jNum, entryDate: doc.issueDate,
            pieceRef: docNumber, pieceDate: doc.issueDate, description: `${isCreditNote ? 'Avoir' : 'Facture'} ${docNumber} — ${contact.legalName}`,
            sourceType: isCreditNote ? 'credit_note' : 'invoice', sourceId: invoiceId,
            previousEntryHash: jph ?? '', entryHash: jHash, userId, lines: entryLines,
          });
        }
      }

      await invoicesRepo.issueInvoice(client, workspaceId, invoiceId, docNumber, recordHash, prevDocHash, journalEntryId, facturxXml);
      await client.query('COMMIT');
      return (await invoicesRepo.getInvoiceById(workspaceId, invoiceId))!;
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }

  async createAndIssueCreditNote(workspaceId: string, userId: string, originalInvoiceId: string) {
    const orig = await invoicesRepo.getInvoiceById(workspaceId, originalInvoiceId);
    if (!orig || orig.status !== 'issued') throw new Error('CREDIT_NOTE_REQUIRES_ISSUED_INVOICE: La facture originale doit être émise.');
    const draft = await this.createDraftInvoice(workspaceId, userId, {
      documentType: 'credit_note', contactId: orig.contactId, originalInvoiceId,
      issueDate: new Date().toISOString().slice(0, 10), dueDate: new Date().toISOString().slice(0, 10),
      lines: orig.lines.map((l) => ({ description: l.description, lineNature: l.lineNature, quantity: l.quantity, unitCode: l.unitCode, unitPriceHtMinor: -Math.abs(l.unitPriceHtMinor), discountPercent: l.discountPercent, taxRuleCode: l.taxRuleCode })),
    });
    const issued = await this.issueSalesDocument(workspaceId, userId, draft.id);
    const cl = await pool.connect();
    try { await invoicesRepo.cancelInvoiceByCreditNote(cl, workspaceId, originalInvoiceId); }
    finally { cl.release(); }
    return issued;
  }

  async recordInvoicePayment(workspaceId: string, userId: string, input: { invoiceId: string; paymentDate: string; amountMinor: number; bankTransactionId?: string | null; paymentMethod?: string }) {
    const inv = await invoicesRepo.getInvoiceById(workspaceId, input.invoiceId);
    if (!inv) throw new Error('INVOICE_NOT_FOUND: Facture introuvable.');
    const ws = await this.getWorkspace(workspaceId);
    const newTotal = (inv.amountPaidMinor ?? 0) + input.amountMinor;
    const newStatus = newTotal >= inv.netToPayTtcMinor ? 'paid' : 'partially_paid';
    const letteringCode = await journalRepo.getNextLetteringCode(workspaceId);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await invoicesRepo.recordInvoicePayment(client, workspaceId, input.invoiceId, newTotal, newStatus);
      const journalId = await workspaceRepo.getJournalId(workspaceId, 'BQ');
      const periodId = await workspaceRepo.getCurrentPeriodId(workspaceId);
      if (journalId && periodId) {
        const clientAccountId = await workspaceRepo.getAccountId(workspaceId, '411000');
        const bankAccountId = await workspaceRepo.getAccountId(workspaceId, '512000');
        if (clientAccountId && bankAccountId) {
          const { seqNum, previousHash } = await sequencesRepo.allocateNextSequence(client, workspaceId, 'journal_BQ', FISCAL_YEAR);
          const entryNumber = `BQ-2026-${String(seqNum).padStart(5, '0')}`;
          const { recordHash } = computeChainedRecordHash(previousHash, { workspaceId, sequenceNumberOrRef: entryNumber, occurredAtIso: new Date().toISOString(), entityType: 'journal_entry', payload: { entryNumber, journalCode: 'BQ', totalDebitMinor: input.amountMinor, totalCreditMinor: input.amountMinor } });
          await sequencesRepo.updateSequenceHash(client, workspaceId, 'journal_BQ', FISCAL_YEAR, recordHash);
          await journalRepo.insertJournalEntryWithLines(client, {
            workspaceId, journalId, periodId, entryNumber, entryDate: input.paymentDate, pieceRef: inv.number ?? input.invoiceId, pieceDate: input.paymentDate,
            description: `Encaissement ${inv.number} — ${inv.contactLegalName}`, sourceType: 'payment', sourceId: input.invoiceId, previousEntryHash: previousHash ?? '', entryHash: recordHash, userId,
            lines: [
              { accountId: bankAccountId, contactId: null, auxiliaryAccountCode: null, auxiliaryAccountLabel: null, description: `Encaissement ${inv.number}`, debitMinor: input.amountMinor, creditMinor: 0 },
              { accountId: clientAccountId, contactId: null, auxiliaryAccountCode: inv.contactLegalName, auxiliaryAccountLabel: inv.contactLegalName, description: `Règlement ${inv.number} — ${inv.contactLegalName}`, debitMinor: 0, creditMinor: input.amountMinor },
            ],
          });
          // Cash-basis VAT realization
          if (ws.vatExigibility === 'ENCAISSEMENTS' && inv.vatTotalMinor > 0) {
            const vatPendingId = await workspaceRepo.getAccountId(workspaceId, '44574');
            const vatCollectedId = await workspaceRepo.getAccountId(workspaceId, '44571');
            if (vatPendingId && vatCollectedId) {
              const ratio = input.amountMinor / inv.netToPayTtcMinor;
              const vatRealized = Math.round(inv.vatTotalMinor * ratio);
              const odJournalId = await workspaceRepo.getJournalId(workspaceId, 'OD');
              if (odJournalId) {
                const { seqNum: s2, previousHash: p2 } = await sequencesRepo.allocateNextSequence(client, workspaceId, 'journal_OD', FISCAL_YEAR);
                const odNum = `OD-2026-${String(s2).padStart(5, '0')}`;
                const { recordHash: rh2 } = computeChainedRecordHash(p2, { workspaceId, sequenceNumberOrRef: odNum, occurredAtIso: new Date().toISOString(), entityType: 'journal_entry', payload: { entryNumber: odNum, journalCode: 'OD', totalDebitMinor: vatRealized, totalCreditMinor: vatRealized } });
                await sequencesRepo.updateSequenceHash(client, workspaceId, 'journal_OD', FISCAL_YEAR, rh2);
                await journalRepo.insertJournalEntryWithLines(client, {
                  workspaceId, journalId: odJournalId, periodId, entryNumber: odNum, entryDate: input.paymentDate, pieceRef: `TVA-${inv.number ?? input.invoiceId}`, pieceDate: input.paymentDate,
                  description: `Transfert TVA sur encaissement ${inv.number} (44574→44571)`, sourceType: 'vat_transfer', sourceId: input.invoiceId, previousEntryHash: p2 ?? '', entryHash: rh2, userId,
                  lines: [
                    { accountId: vatPendingId, contactId: null, auxiliaryAccountCode: null, auxiliaryAccountLabel: null, description: 'TVA en attente (44574)', debitMinor: vatRealized, creditMinor: 0 },
                    { accountId: vatCollectedId, contactId: null, auxiliaryAccountCode: null, auxiliaryAccountLabel: null, description: 'TVA collectée (44571)', debitMinor: 0, creditMinor: vatRealized },
                  ],
                });
              }
            }
          }
        }
      }
      if (input.bankTransactionId) await bankRepo.markBankTransactionMatched(workspaceId, input.bankTransactionId);
      await client.query('COMMIT');
      return { invoice: await invoicesRepo.getInvoiceById(workspaceId, input.invoiceId), letteringCode };
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }

  // ─── Expenses ──────────────────────────────────────────────────────────────

  async getExpenses(workspaceId: string): Promise<DbExpenseRecord[]> {
    const rows = await expensesRepo.getExpenses(workspaceId);
    return rows.map((r) => dbExpenseToRecord({
      id: r.id, contactId: r.contactId, contactLegalName: r.contactLegalName,
      supplierInvoiceRef: r.supplierInvoiceRef, issueDate: r.issueDate, dueDate: r.dueDate,
      description: r.description, subtotalHtMinor: r.subtotalHtMinor, vatTotalMinor: r.vatTotalMinor,
      totalTtcMinor: r.totalTtcMinor, amountPaidMinor: r.amountPaidMinor, currency: r.currency,
      status: r.status, journalEntryId: r.journalEntryId,
      lines: r.lines as Array<{ accountCode?: string; vatRuleCode?: string }>,
    }));
  }

  async createExpense(workspaceId: string, userId: string, input: {
    supplierContactId: string; supplierInvoiceRef: string; expenseDate: string; dueDate?: string;
    description: string; accountingAccountCode: string; taxRuleCode: string; deductibilityRatio?: string;
    amountHtMinor: number; currency?: 'EUR' | 'USD'; foreignAmountTtcMinor?: number | null;
    status?: string; inboxState?: string; paymentState?: string; source?: string; pagesCount?: number; categoryLabel?: string;
  }): Promise<DbExpenseRecord> {
    const contact = await contactsRepo.getContactById(workspaceId, input.supplierContactId);
    if (!contact) throw new Error('SUPPLIER_NOT_FOUND: Fournisseur introuvable.');
    if (contact.kind !== 'supplier' && contact.kind !== 'both') throw new Error('CONTACT_NOT_SUPPLIER: Sélectionnez un fournisseur pour créer une dépense.');

    const calc = calculateExpenseLineVat({ amountHtMinor: input.amountHtMinor, taxRuleCode: input.taxRuleCode, deductibilityRatio: input.deductibilityRatio ?? '1.00' });
    const accountId = await workspaceRepo.getAccountId(workspaceId, input.accountingAccountCode) ?? await workspaceRepo.ensureAccountExists(workspaceId, input.accountingAccountCode, input.accountingAccountCode, 6);
    const vatRuleId = await workspaceRepo.getTaxRuleId(workspaceId, input.taxRuleCode);
    const acAccountId = await workspaceRepo.getAccountId(workspaceId, '401000');
    const vatDeductId = calc.vatDeductibleMinor > 0 ? await workspaceRepo.getAccountId(workspaceId, '44566') : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const expenseId = await expensesRepo.createExpense(client, workspaceId, userId, {
        documentType: 'supplier_invoice', contactId: contact.id, issueDate: input.expenseDate, accountingDate: input.expenseDate,
        dueDate: input.dueDate ?? input.expenseDate, currency: input.currency ?? 'EUR', operationCategory: 'services',
        description: input.description, subtotalHtMinor: input.amountHtMinor, vatTotalMinor: calc.vatTotalMinor,
        totalTtcMinor: calc.amountTtcMinor, supplierInvoiceRef: input.supplierInvoiceRef, ocrConfidence: null,
        issuerSnapshot: { source: input.source ?? 'Import manuel', inboxState: input.inboxState ?? 'inbox', deductibilityRatio: input.deductibilityRatio ?? '1.00', accountingAccountCode: input.accountingAccountCode, taxRuleCode: input.taxRuleCode, pagesCount: input.pagesCount ?? 1, categoryLabel: input.categoryLabel ?? 'Achats & Frais généraux', foreignAmountTtcMinor: input.foreignAmountTtcMinor ?? null },
        lines: [{ position: 1, accountId: accountId!, description: input.description, quantity: 1, unitCode: 'C62', unitPriceHtMinor: input.amountHtMinor, discountPercent: 0, vatRuleId: vatRuleId ?? null, vatRateSnapshot: parseFloat(getTaxRuleOrThrow(input.taxRuleCode).ratePercent), vatCategoryCode: 'S', lineSubtotalHtMinor: input.amountHtMinor, lineVatPreviewMinor: calc.vatTotalMinor, lineTotalTtcPreviewMinor: calc.amountTtcMinor }],
        taxBreakdowns: [{ vatRuleId: vatRuleId ?? null, vatCategoryCode: 'S', vatRate: parseFloat(getTaxRuleOrThrow(input.taxRuleCode).ratePercent), taxableBaseHtMinor: input.amountHtMinor, vatAmountMinor: calc.vatTotalMinor }],
      });

      let journalEntryId: string | null = null;
      const journalId = await workspaceRepo.getJournalId(workspaceId, 'AC');
      const periodId = await workspaceRepo.getCurrentPeriodId(workspaceId);
      if (journalId && periodId && accountId && acAccountId) {
        const { seqNum, previousHash } = await sequencesRepo.allocateNextSequence(client, workspaceId, 'journal_AC', FISCAL_YEAR);
        const entryNumber = `AC-2026-${String(seqNum).padStart(5, '0')}`;
        const { recordHash } = computeChainedRecordHash(previousHash, { workspaceId, sequenceNumberOrRef: entryNumber, occurredAtIso: new Date().toISOString(), entityType: 'journal_entry', payload: { entryNumber, journalCode: 'AC', totalDebitMinor: calc.amountTtcMinor, totalCreditMinor: calc.amountTtcMinor } });
        await sequencesRepo.updateSequenceHash(client, workspaceId, 'journal_AC', FISCAL_YEAR, recordHash);
        const entryLines: Parameters<typeof journalRepo.insertJournalEntryWithLines>[1]['lines'] = [
          { accountId: accountId!, contactId: contact.id, auxiliaryAccountCode: null, auxiliaryAccountLabel: null, description: input.description, debitMinor: input.amountHtMinor, creditMinor: 0 },
        ];
        if (calc.vatDeductibleMinor > 0 && vatDeductId) entryLines.push({ accountId: vatDeductId, contactId: null, auxiliaryAccountCode: null, auxiliaryAccountLabel: null, description: `TVA déductible ${input.taxRuleCode}`, debitMinor: calc.vatDeductibleMinor, creditMinor: 0 });
        entryLines.push({ accountId: acAccountId, contactId: contact.id, auxiliaryAccountCode: contact.supplierAuxiliaryCode, auxiliaryAccountLabel: contact.legalName, description: `Fournisseur ${contact.legalName} — ${input.supplierInvoiceRef}`, debitMinor: 0, creditMinor: calc.amountTtcMinor });
        journalEntryId = await journalRepo.insertJournalEntryWithLines(client, { workspaceId, journalId, periodId, entryNumber, entryDate: input.expenseDate, pieceRef: input.supplierInvoiceRef, pieceDate: input.expenseDate, description: `Facture fournisseur ${contact.legalName} — ${input.supplierInvoiceRef}`, sourceType: 'expense', sourceId: expenseId, previousEntryHash: previousHash ?? '', entryHash: recordHash, userId, lines: entryLines });
        await expensesRepo.updateExpenseStatus(client, workspaceId, expenseId, 'pending_review', journalEntryId, null, null);
      }
      await client.query('COMMIT');
      return { id: expenseId, supplierContactId: contact.id, supplierName: contact.legalName, supplierInvoiceRef: input.supplierInvoiceRef, expenseDate: input.expenseDate, dueDate: input.dueDate ?? input.expenseDate, description: input.description, accountingAccountCode: input.accountingAccountCode, taxRuleCode: input.taxRuleCode, deductibilityRatio: input.deductibilityRatio ?? '1.00', amountHtMinor: input.amountHtMinor, vatTotalMinor: calc.vatTotalMinor, vatDeductibleMinor: calc.vatDeductibleMinor, vatNonDeductibleMinor: calc.vatNonDeductibleMinor, amountTtcMinor: calc.amountTtcMinor, currency: input.currency ?? 'EUR', foreignAmountTtcMinor: input.foreignAmountTtcMinor ?? null, status: 'needs_review', inboxState: (input.inboxState as DbExpenseRecord['inboxState']) ?? 'inbox', paymentState: 'to_pay', source: input.source ?? 'Import manuel', journalEntryId, reconciledTransactionId: null, rejectedTransactionIds: [], pagesCount: input.pagesCount ?? 1, categoryLabel: input.categoryLabel ?? 'Achats & Frais généraux' };
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }

  async updateExpensePaymentState(workspaceId: string, expenseId: string, paymentState: string) {
    if (paymentState === 'paid') await expensesRepo.recordExpensePayment(workspaceId, expenseId, 999999999, new Date().toISOString().slice(0, 10), 'virement');
    const r = await expensesRepo.getExpenseById(workspaceId, expenseId);
    return r ? dbExpenseToRecord({ id: r.id, contactId: r.contactId, contactLegalName: r.contactLegalName, supplierInvoiceRef: r.supplierInvoiceRef, issueDate: r.issueDate, dueDate: r.dueDate, description: r.description, subtotalHtMinor: r.subtotalHtMinor, vatTotalMinor: r.vatTotalMinor, totalTtcMinor: r.totalTtcMinor, amountPaidMinor: r.amountPaidMinor, currency: r.currency, status: r.status, journalEntryId: r.journalEntryId, lines: r.lines as Array<{ accountCode?: string; vatRuleCode?: string }> }) : null;
  }

  async handleExpenseTransactionSuggestion(workspaceId: string, _userId: string, input: { expenseId: string; transactionId: string; action: 'accept' | 'reject' }) {
    if (input.action === 'accept') {
      await bankRepo.markBankTransactionMatched(workspaceId, input.transactionId);
      await bankRepo.updateBankTransactionWorkflow(workspaceId, input.transactionId, 'rapprochee');
    } else {
      await bankRepo.updateBankTransactionWorkflow(workspaceId, input.transactionId, 'a_traiter');
    }
    return expensesRepo.getExpenseById(workspaceId, input.expenseId);
  }

  // ─── Bank ──────────────────────────────────────────────────────────────────

  async getBankTransactions(workspaceId: string) {
    return bankRepo.getBankTransactions(workspaceId);
  }

  async addBankTransactionsImport(workspaceId: string, transactions: Array<{ transactionDate: string; description: string; amountSignedMinor: number; counterpartyName?: string; sourceRef?: string }>, sourceLabel: string, _bankAccountName?: string) {
    const bankAccountId = await bankRepo.getDefaultBankAccountId(workspaceId);
    if (!bankAccountId) throw new Error('BANK_ACCOUNT_NOT_FOUND: Aucun compte bancaire configuré.');
    return bankRepo.insertBankTransactions(workspaceId, bankAccountId, transactions.map((tx) => ({
      transactionDate: tx.transactionDate, description: tx.description, amountMinor: tx.amountSignedMinor,
      counterpartyName: tx.counterpartyName, fingerprint: `${tx.transactionDate}:${tx.description.slice(0, 40)}:${tx.amountSignedMinor}:${tx.sourceRef ?? ''}`,
    })));
  }

  async reconcileBankTransactionGroup(workspaceId: string, userId: string, input: { transactionId: string; allocations: Array<{ documentId: string; documentKind: 'invoice' | 'expense'; amountMinor: number }> }) {
    const txs = await bankRepo.getBankTransactions(workspaceId);
    const tx = txs.find((t) => t.id === input.transactionId);
    if (!tx) throw new Error('BANK_TX_NOT_FOUND: Transaction bancaire introuvable.');
    for (const alloc of input.allocations) {
      if (alloc.amountMinor <= 0) continue;
      if (alloc.documentKind === 'invoice') {
        await this.recordInvoicePayment(workspaceId, userId, { invoiceId: alloc.documentId, paymentDate: tx.transactionDate, amountMinor: alloc.amountMinor, bankTransactionId: tx.id });
      } else {
        await expensesRepo.recordExpensePayment(workspaceId, alloc.documentId, alloc.amountMinor, tx.transactionDate, 'virement');
        await bankRepo.markBankTransactionMatched(workspaceId, tx.id);
      }
    }
    await bankRepo.updateBankTransactionWorkflow(workspaceId, tx.id, 'rapprochee');
    const updated = await bankRepo.getBankTransactions(workspaceId);
    return updated.find((t) => t.id === input.transactionId) ?? tx;
  }

  async updateBankTransactionStatus(workspaceId: string, transactionId: string, status: string, workflowStatus: string) {
    if (status === 'matched') await bankRepo.markBankTransactionMatched(workspaceId, transactionId);
    await bankRepo.updateBankTransactionWorkflow(workspaceId, transactionId, workflowStatus);
    const txs = await bankRepo.getBankTransactions(workspaceId);
    return txs.find((t) => t.id === transactionId);
  }

  // ─── Journal ───────────────────────────────────────────────────────────────

  async getJournalEntries(workspaceId: string) {
    return journalRepo.getJournalEntries(workspaceId);
  }

  async createManualJournalEntry(workspaceId: string, userId: string, input: {
    journalCode: 'OD' | 'VE' | 'AC' | 'BQ'; entryDate: string; pieceRef: string; description: string;
    dueDate?: string; invoiceNumber?: string;
    lines: Array<{ accountCode: string; accountLabel: string; auxiliaryAccountCode?: string | null; auxiliaryAccountLabel?: string | null; description: string; debitMinor: number; creditMinor: number; vatRateLabel?: string; categoryLabel?: string }>;
  }) {
    const journalId = await workspaceRepo.getJournalId(workspaceId, input.journalCode);
    const periodId = await workspaceRepo.getCurrentPeriodId(workspaceId);
    if (!journalId || !periodId) throw new Error('JOURNAL_OR_PERIOD_NOT_FOUND: Journal ou exercice introuvable.');

    validateJournalEntryForPosting({ journalCode: input.journalCode, journalLabel: input.journalCode, entryNumber: 'MANUAL', entryDate: input.entryDate, pieceRef: input.pieceRef, pieceDate: input.entryDate, validatedAt: input.entryDate, periodStatus: 'open', lines: input.lines.map((l) => ({ accountCode: l.accountCode, accountLabel: l.accountLabel, requiresAuxiliary: l.accountCode === '411000' || l.accountCode === '401000', auxiliaryAccountCode: l.auxiliaryAccountCode ?? null, auxiliaryAccountLabel: l.auxiliaryAccountLabel ?? null, description: l.description, debitMinor: l.debitMinor, creditMinor: l.creditMinor, dueDate: input.dueDate ?? input.entryDate, invoiceNumber: input.invoiceNumber ?? input.pieceRef, vatRateLabel: l.vatRateLabel ?? 'N/A', categoryLabel: l.categoryLabel ?? 'Opération Diverse' })) });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { seqNum, previousHash } = await sequencesRepo.allocateNextSequence(client, workspaceId, `journal_${input.journalCode}`, FISCAL_YEAR);
      const entryNumber = `${input.journalCode}-2026-${String(seqNum).padStart(5, '0')}`;
      const totalDebit = input.lines.reduce((s, l) => s + l.debitMinor, 0);
      const { recordHash } = computeChainedRecordHash(previousHash, { workspaceId, sequenceNumberOrRef: entryNumber, occurredAtIso: new Date().toISOString(), entityType: 'journal_entry', payload: { entryNumber, journalCode: input.journalCode, totalDebitMinor: totalDebit, totalCreditMinor: totalDebit } });
      await sequencesRepo.updateSequenceHash(client, workspaceId, `journal_${input.journalCode}`, FISCAL_YEAR, recordHash);

      const lineAccountIds = await Promise.all(input.lines.map(async (l) => workspaceRepo.getAccountId(workspaceId, l.accountCode) ?? workspaceRepo.ensureAccountExists(workspaceId, l.accountCode, l.accountLabel, parseInt(l.accountCode[0] ?? '6', 10))));
      const entryId = await journalRepo.insertJournalEntryWithLines(client, {
        workspaceId, journalId, periodId, entryNumber, entryDate: input.entryDate, pieceRef: input.pieceRef, pieceDate: input.entryDate,
        description: input.description, sourceType: 'manual_entry', sourceId: null, previousEntryHash: previousHash ?? '', entryHash: recordHash, userId,
        lines: input.lines.map((l, i) => ({ accountId: lineAccountIds[i]!, contactId: null, auxiliaryAccountCode: l.auxiliaryAccountCode ?? null, auxiliaryAccountLabel: l.auxiliaryAccountLabel ?? null, description: l.description, debitMinor: l.debitMinor, creditMinor: l.creditMinor })),
      });
      await client.query('COMMIT');
      const entries = await journalRepo.getJournalEntries(workspaceId);
      return entries.find((e) => e.id === entryId);
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }

  async autoLetterAuxiliaryAccounts(workspaceId: string, userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const entries = await journalRepo.getJournalEntries(workspaceId);
    const auxCodes = new Set<string>();
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.auxiliaryAccountCode && !line.letteringCode) auxCodes.add(line.auxiliaryAccountCode);
      }
    }
    let groupsLettered = 0, linesLettered = 0;
    const assignedCodes: string[] = [];
    for (const auxCode of auxCodes) {
      const lines = await journalRepo.getJournalLineIdsByAuxCode(workspaceId, auxCode);
      const unlettered = lines.filter((l) => !l.letteringCode);
      const debits = unlettered.filter((l) => l.debitMinor > 0 && l.creditMinor === 0);
      const credits = unlettered.filter((l) => l.creditMinor > 0 && l.debitMinor === 0);
      for (const d of debits) {
        const match = credits.find((c) => c.creditMinor === d.debitMinor);
        if (match) {
          const code = await journalRepo.getNextLetteringCode(workspaceId);
          try {
            validateAuxiliaryLetteringGroup(code, [{ auxiliaryAccountCode: auxCode, debitMinor: d.debitMinor, creditMinor: 0 }, { auxiliaryAccountCode: auxCode, debitMinor: 0, creditMinor: match.creditMinor }]);
            await journalRepo.updateLineLettering(workspaceId, [d.id, match.id], code, today);
            assignedCodes.push(code); groupsLettered++; linesLettered += 2;
          } catch { /* skip */ }
        }
      }
    }
    await auditRepo.appendAuditEvent(workspaceId, userId, 'AUTO_LETTERING_EXECUTED', 'accounting', null, { groupsLettered, linesLettered, assignedCodes }, '', randomUUID());
    return { groupsLettered, linesLettered, assignedCodes };
  }

  // ─── VAT / FEC / Audit ─────────────────────────────────────────────────────

  async getVatSummary(workspaceId: string) {
    const ws = await this.getWorkspace(workspaceId);
    const balances = await journalRepo.getVatAccountBalances(workspaceId);
    const net = Math.max(0, balances.collectedExigibleMinor - balances.deductiblePurchasesMinor);
    return { vatExigibilityMode: ws.vatExigibility, vatRegime: ws.vatRegime, collectedExigibleMinor: balances.collectedExigibleMinor, collectedPendingCashMinor: balances.collectedPendingCashMinor, deductiblePurchasesMinor: balances.deductiblePurchasesMinor, netVatPayableMinor: net, vatCreditMinor: Math.max(0, balances.deductiblePurchasesMinor - balances.collectedExigibleMinor) };
  }

  async exportFec(workspaceId: string) {
    const ws = await this.getWorkspace(workspaceId);
    const entries = await journalRepo.getJournalEntries(workspaceId);
    return generateStatutoryFec(ws.siren, '2026-12-31', entries);
  }

  async getAuditVerification(workspaceId: string) {
    const events = await auditRepo.getAuditEvents(workspaceId);
    return { verification: verifyHashChain(events), events: events.slice().reverse() };
  }
}

export const workspaceService = new HaxataxWorkspaceService();
