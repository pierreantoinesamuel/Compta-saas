/**
 * Haxatax Backend API Server (Fastify + TypeScript)
 * Exposes authoritative French & EU domain endpoints (Factur-X, PCG 2025, Lettrage, TVA, FEC, BlockedLog).
 */

import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  loginUser,
  requireAuth,
  signSession,
  type SessionPayload,
} from './security/sessionAuth.js';
import { z } from 'zod';
import {
  OFFICIAL_FR_EU_TAX_RULES,
  PCG_2025_ACCOUNTS,
  STANDARD_FRENCH_JOURNALS,
} from '../db/seeds/pcg2025/pcg2025_catalog.js';
import {
  computeFrenchVatNumber,
  validateEuVatNumber,
  validateSiren,
  validateSiret,
} from './domain/contacts/frenchLegalValidators.js';
import { calculateInvoiceTotals } from './domain/tax/vatEngine.js';
import { workspaceService } from './application/workspaceService.js';
import {
  confirmDocument,
  deleteDocument,
  getDocument,
  ingestDocument,
  listDocuments,
  markPosted,
} from './application/documentStore.js';
import type { DocumentKind, ExtractedDocumentData } from './domain/documents/documentTypes.js';
import { shutdownOcrEngine } from './domain/documents/ocrEngine.js';
import { generateInvoiceHtml } from './domain/invoices/invoiceHtmlGenerator.js';
import { checkIbanAnomaly } from './domain/documents/phacetAgent.js';
import { sendIbanAlertEmail } from './domain/notifications/emailSender.js';

export function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 28 * 1024 * 1024,
  });
  app.addHook('onClose', async () => shutdownOcrEngine());

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(rateLimit, { global: false });

  const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL]
    : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'];
  app.register(cors, { origin: allowedOrigins, credentials: true });

  // ── Authentication middleware ─────────────────────────────────────────────
  // Public paths: no Bearer token required
  const PUBLIC_PATH_EXACT = new Set([
    '/api/v1/health',
    '/api/v1/auth/login',
    '/api/v1/accounting/catalog',
  ]);
  const PUBLIC_PATH_PREFIXES = [
    '/api/v1/contacts/validate-identifiers',
    '/api/v1/invoices/calculate-preview',
  ];

  app.addHook('preHandler', async (request, reply) => {
    const path = (request.url.split('?')[0] ?? request.url) as string;
    if (PUBLIC_PATH_EXACT.has(path) || PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p))) {
      return;
    }
    await requireAuth(request, reply);
    if (reply.sent) return;
    // Cross-tenant guard: session workspaceId must match :workspaceId param in URL
    const params = request.params as Record<string, string>;
    const urlWorkspaceId = params.workspaceId;
    const session = (request as unknown as { session?: SessionPayload }).session;
    if (urlWorkspaceId && session && session.workspaceId !== urlWorkspaceId) {
      await reply.status(403).send({
        error: { code: 'FORBIDDEN_WORKSPACE', message: 'Accès refusé à cet espace de travail.' },
      });
    }
  });

  // POST /api/v1/auth/login — public (rate-limited: max 10 attempts / 15 min / IP)
  app.post('/api/v1/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.status(400).send({
        error: { code: 'MISSING_CREDENTIALS', message: 'Email et mot de passe requis.' },
      });
    }
    const payload = await loginUser(body.email, body.password);
    if (!payload) {
      return reply.status(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' },
      });
    }
    return { token: signSession(payload), role: payload.role, workspaceId: payload.workspaceId };
  });

  // GET /api/v1/auth/session — returns current session info (protected by global hook above)
  app.get('/api/v1/auth/session', async (request) => {
    const session = (request as unknown as { session: SessionPayload }).session;
    return { userId: session.userId, workspaceId: session.workspaceId, role: session.role };
  });

  app.get('/api/v1/health', async () => {
    return {
      status: 'ok',
      service: 'haxatax-api',
      compliance: {
        pcgVersion: 'PCG_2025_ANC_2022_06',
        einvoicingStandard: 'Factur-X 1.0.07 / EN 16931',
        fecStandard: 'Art. L47 A-I LPF (18 columns)',
        hostingRegion: 'EU',
      },
    };
  });

  app.get('/api/v1/accounting/catalog', async () => {
    return {
      chartVersion: 'PCG_2025_ANC_2022_06',
      accounts: PCG_2025_ACCOUNTS,
      journals: STANDARD_FRENCH_JOURNALS,
      taxRules: OFFICIAL_FR_EU_TAX_RULES,
    };
  });

  const getSession = (req: FastifyRequest) =>
    (req as unknown as { session: SessionPayload }).session;

  // Workspace profile
  app.get('/api/v1/workspaces/current', async (request) => {
    return workspaceService.getWorkspace(getSession(request).workspaceId);
  });

  const WorkspacePatchSchema = z.object({
    legalName: z.string().trim().min(1).optional(),
    tradeName: z.string().trim().optional(),
    siren: z.string().optional(),
    siret: z.string().optional(),
    nafCode: z.string().optional(),
    legalForm: z.string().optional(),
    shareCapitalMinor: z.number().int().nonnegative().optional(),
    rcsCity: z.string().optional(),
    rcsNumber: z.string().optional(),
    vatNumber: z.string().optional(),
    fiscalRegime: z.string().optional(),
    vatRegime: z.enum(['FRANCHISE_293B', 'REEL_SIMPLIFIE', 'REEL_NORMAL', 'MINI_REEL']).optional(),
    vatExigibility: z.enum(['DEBITS', 'ENCAISSEMENTS']).optional(),
    registeredAddress: z.object({
      streetLine1: z.string().trim().min(1),
      postalCode: z.string().trim().min(1),
      city: z.string().trim().min(1),
      countryCode: z.string().regex(/^[A-Z]{2}$/).default('FR'),
    }).optional(),
    defaultLatePenaltyRate: z.string().optional(),
    defaultRecoveryIndemnityMinor: z.number().int().nonnegative().optional(),
    defaultDiscountTerms: z.string().optional(),
  }).strict();

  app.patch('/api/v1/workspaces/current', async (request, reply) => {
    const parsed = WorkspacePatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_WORKSPACE_PATCH', message: 'Données de mise à jour invalides.', details: parsed.error.flatten() },
      });
    }
    try {
      return await workspaceService.updateWorkspace(getSession(request).workspaceId, parsed.data);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'WORKSPACE_UPDATE_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  // Contacts (Tiers)
  app.get('/api/v1/contacts', async (request) => {
    return workspaceService.getContacts(getSession(request).workspaceId);
  });

  app.post('/api/v1/contacts', async (request, reply) => {
    const parsed = z.object({
      kind: z.enum(['customer', 'supplier', 'both']),
      isBusiness: z.boolean(),
      taxZone: z.enum(['DOMESTIC_FR', 'DOM_TOM', 'INTRA_EU', 'EXPORT_NON_EU']),
      legalName: z.string().trim().min(1, 'La raison sociale ou le nom est obligatoire.'),
      siren: z.string().nullable().optional(),
      siret: z.string().nullable().optional(),
      vatIdentifier: z.string().nullable().optional(),
      email: z.union([z.string().email(), z.literal('')]).optional(),
      billingAddress: z.object({
        streetLine1: z.string().trim().min(1, 'L’adresse est obligatoire.'),
        postalCode: z.string().trim().min(1, 'Le code postal est obligatoire.'),
        city: z.string().trim().min(1, 'La ville est obligatoire.'),
        countryCode: z.string().regex(/^[A-Z]{2}$/),
      }),
      defaultPaymentTermsDays: z.number().int().min(0).max(60).optional(),
      certifiedIban: z.string().nullable().optional(),
    }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_CONTACT', message: 'Vérifiez les champs obligatoires du tiers.', details: parsed.error.flatten() },
      });
    }
    try {
      return await workspaceService.createContact(getSession(request).workspaceId, getSession(request).userId, parsed.data);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'CONTACT_CREATE_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  const ValidateIdentifiersSchema = z.object({
    siren: z.string().optional(),
    siret: z.string().optional(),
    vatNumber: z.string().optional(),
  });

  app.post('/api/v1/contacts/validate-identifiers', async (request, reply) => {
    const parsed = ValidateIdentifiersSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Paramètres de validation invalides.',
          details: parsed.error.flatten(),
        },
      });
    }

    const { siren, siret, vatNumber } = parsed.data;
    const sirenResult = siren ? validateSiren(siren) : null;
    const siretResult = siret ? validateSiret(siret) : null;
    const computedFrVat =
      sirenResult?.valid ? computeFrenchVatNumber(sirenResult.normalized) : null;
    const vatResult = vatNumber ? validateEuVatNumber(vatNumber) : null;

    return {
      siren: sirenResult,
      siret: siretResult,
      computedFrenchVatNumber: computedFrVat,
      vatNumber: vatResult,
    };
  });

  // Sales Documents (Quotes, Deposit Invoices, Standard Invoices, Credit Notes)
  app.get('/api/v1/invoices', async (request) => {
    return workspaceService.getInvoices(getSession(request).workspaceId);
  });

  const CreateInvoiceSchema = z.object({
    documentType: z.enum(['quote', 'deposit_invoice', 'standard_invoice', 'credit_note']),
    contactId: z.string().uuid(),
    originalInvoiceId: z.string().uuid().nullable().optional(),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    deliveryOrServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    purchaseOrderRef: z.string().max(100).nullable().optional(),
    lines: z.array(z.object({
      description: z.string().min(1).max(500),
      lineNature: z.enum(['goods', 'services']),
      quantity: z.union([z.string(), z.number()]),
      unitCode: z.string().max(10).optional(),
      unitPriceHtMinor: z.number().int().nonnegative(),
      discountPercent: z.union([z.string(), z.number()]).optional(),
      discountAmountHtMinor: z.number().int().nonnegative().optional(),
      taxRuleCode: z.string().max(50),
    })).min(1),
  });

  app.post('/api/v1/invoices', async (request, reply) => {
    const parsed = CreateInvoiceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_INVOICE_PAYLOAD', message: 'Données de facturation invalides.', details: parsed.error.flatten() },
      });
    }
    try {
      return await workspaceService.createDraftInvoice(getSession(request).workspaceId, getSession(request).userId, parsed.data);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'INVOICE_DRAFT_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.post('/api/v1/invoices/:invoiceId/issue', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      return await workspaceService.issueSalesDocument(getSession(request).workspaceId, getSession(request).userId, invoiceId);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'INVOICE_ISSUE_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.post('/api/v1/invoices/:invoiceId/credit-notes', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      return await workspaceService.createAndIssueCreditNote(getSession(request).workspaceId, getSession(request).userId, invoiceId);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'CREDIT_NOTE_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.post('/api/v1/invoices/:invoiceId/payments', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      const body = request.body as {
        paymentDate: string;
        amountMinor: number;
        bankTransactionId?: string;
      };
      return await workspaceService.recordInvoicePayment(getSession(request).workspaceId, getSession(request).userId, {
        invoiceId,
        paymentDate: body.paymentDate,
        amountMinor: body.amountMinor,
        bankTransactionId: body.bankTransactionId,
      });
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'PAYMENT_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.get('/api/v1/invoices/:invoiceId/preview', async (request, reply) => {
    const { invoiceId } = request.params as { invoiceId: string };
    const wid = getSession(request).workspaceId;
    const invoices = await workspaceService.getInvoices(wid);
    const doc = invoices.find((i) => i.id === invoiceId);
    if (!doc) {
      return reply.status(404).send({ error: { code: 'INVOICE_NOT_FOUND', message: 'Document introuvable.' } });
    }
    const ws = await workspaceService.getWorkspace(wid);
    const html = generateInvoiceHtml(doc, ws);
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(html);
  });

  const CalculateInvoicePreviewSchema = z.object({
    documentType: z.enum(['quote', 'deposit_invoice', 'standard_invoice', 'credit_note']),
    isCustomerBusiness: z.boolean(),
    customerTaxZone: z.enum(['DOMESTIC_FR', 'DOM_TOM', 'INTRA_EU', 'EXPORT_NON_EU']),
    customerSiren: z.string().nullable().optional(),
    customerVatIdentifier: z.string().nullable().optional(),
    workspaceVatRegime: z.enum(['FRANCHISE_293B', 'REEL_SIMPLIFIE', 'REEL_NORMAL', 'MINI_REEL']),
    workspaceVatExigibility: z.enum(['DEBITS', 'ENCAISSEMENTS']),
    originalInvoiceId: z.string().nullable().optional(),
    lines: z.array(
      z.object({
        description: z.string().min(1),
        lineNature: z.enum(['goods', 'services']),
        quantity: z.union([z.string(), z.number()]),
        unitCode: z.string().optional(),
        unitPriceHtMinor: z.number().int().nonnegative(),
        discountPercent: z.union([z.string(), z.number()]).optional(),
        discountAmountHtMinor: z.number().int().nonnegative().optional(),
        taxRuleCode: z.string(),
      })
    ),
  });

  app.post('/api/v1/invoices/calculate-preview', async (request, reply) => {
    const parsed = CalculateInvoicePreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_INVOICE_PAYLOAD',
          message: 'Données de facturation invalides.',
          details: parsed.error.flatten(),
        },
      });
    }

    try {
      const result = calculateInvoiceTotals(parsed.data);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de calcul';
      return reply.status(422).send({
        error: {
          code: 'DOMAIN_INVARIANT_VIOLATION',
          message,
        },
      });
    }
  });

  // Purchases & Expenses
  app.get('/api/v1/expenses', async (request) => {
    return workspaceService.getExpenses(getSession(request).workspaceId);
  });

  const CreateExpenseSchema = z.object({
    supplierContactId: z.string().uuid(),
    supplierInvoiceRef: z.string().min(1).max(100),
    expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().min(1).max(500),
    accountingAccountCode: z.string().regex(/^\d{3,8}$/),
    taxRuleCode: z.string().max(50),
    deductibilityRatio: z.string().optional(),
    amountHtMinor: z.number().int().positive(),
    currency: z.enum(['EUR', 'USD']).optional(),
    foreignAmountTtcMinor: z.number().int().nullable().optional(),
    status: z.string().optional(),
    inboxState: z.string().optional(),
    paymentState: z.string().optional(),
    source: z.string().max(200).optional(),
    pagesCount: z.number().int().positive().optional(),
    categoryLabel: z.string().max(200).optional(),
  });

  app.post('/api/v1/expenses', async (request, reply) => {
    const parsed = CreateExpenseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_EXPENSE_PAYLOAD', message: 'Données de dépense invalides.', details: parsed.error.flatten() },
      });
    }
    try {
      return await workspaceService.createExpense(getSession(request).workspaceId, getSession(request).userId, parsed.data);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'EXPENSE_CREATE_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.patch('/api/v1/expenses/:expenseId/payment-state', async (request, reply) => {
    try {
      const { expenseId } = request.params as { expenseId: string };
      const body = request.body as { paymentState: 'to_pay' | 'paid' };
      return await workspaceService.updateExpensePaymentState(getSession(request).workspaceId, expenseId, body.paymentState);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'EXPENSE_STATE_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.post('/api/v1/expenses/:expenseId/suggestions', async (request, reply) => {
    try {
      const { expenseId } = request.params as { expenseId: string };
      const body = request.body as { transactionId: string; action: 'confirm' | 'reject' };
      return await workspaceService.handleExpenseTransactionSuggestion(getSession(request).workspaceId, getSession(request).userId, {
        expenseId,
        transactionId: body.transactionId,
        action: body.action as 'accept' | 'reject',
      });
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'EXPENSE_SUGGESTION_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  // Banking, Ledger, VAT, FEC & Audit
  app.get('/api/v1/banking/transactions', async (request) => {
    return workspaceService.getBankTransactions(getSession(request).workspaceId);
  });

  app.post('/api/v1/banking/transactions/:transactionId/reconcile-group', async (request, reply) => {
    try {
      const { transactionId } = request.params as { transactionId: string };
      const body = request.body as {
        allocations: Array<{
          documentId: string;
          documentKind: 'invoice' | 'expense';
          amountMinor: number;
        }>;
      };
      return await workspaceService.reconcileBankTransactionGroup(getSession(request).workspaceId, getSession(request).userId, {
        transactionId,
        allocations: body.allocations,
      });
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'BANK_RECONCILE_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.patch('/api/v1/banking/transactions/:transactionId/status', async (request, reply) => {
    try {
      const { transactionId } = request.params as { transactionId: string };
      const body = request.body as {
        workflowStatus: 'a_traiter' | 'demande_comptable' | 'a_confirmer' | 'rapprochee' | 'supprime';
      };
      return await workspaceService.updateBankTransactionStatus(getSession(request).workspaceId, transactionId, 'unmatched', body.workflowStatus);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'BANK_STATUS_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.get('/api/v1/accounting/entries', async (request) => {
    return workspaceService.getJournalEntries(getSession(request).workspaceId);
  });

  const CreateJournalEntrySchema = z.object({
    journalCode: z.enum(['OD', 'VE', 'AC', 'BQ']),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pieceRef: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    invoiceNumber: z.string().max(100).optional(),
    lines: z.array(z.object({
      accountCode: z.string().regex(/^\d{3,8}$/),
      accountLabel: z.string().min(1).max(200),
      auxiliaryAccountCode: z.string().max(50).nullable().optional(),
      auxiliaryAccountLabel: z.string().max(200).nullable().optional(),
      description: z.string().min(1).max(500),
      debitMinor: z.number().int().nonnegative(),
      creditMinor: z.number().int().nonnegative(),
      vatRateLabel: z.string().max(50).optional(),
      categoryLabel: z.string().max(200).optional(),
    })).min(2),
  });

  app.post('/api/v1/accounting/entries', async (request, reply) => {
    const parsed = CreateJournalEntrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_ENTRY_PAYLOAD', message: 'Données d\'écriture comptable invalides.', details: parsed.error.flatten() },
      });
    }
    try {
      return await workspaceService.createManualJournalEntry(getSession(request).workspaceId, getSession(request).userId, parsed.data);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'MANUAL_ENTRY_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.post('/api/v1/accounting/auto-letter', async (request, reply) => {
    try {
      return await workspaceService.autoLetterAuxiliaryAccounts(getSession(request).workspaceId, getSession(request).userId);
    } catch (err) {
      return reply.status(422).send({
        error: { code: 'AUTO_LETTER_FAILED', message: err instanceof Error ? err.message : 'Erreur' },
      });
    }
  });

  app.get('/api/v1/tax/vat-summary', async (request) => {
    return workspaceService.getVatSummary(getSession(request).workspaceId);
  });

  app.get('/api/v1/exports/fec', async (request, reply) => {
    const result = await workspaceService.exportFec(getSession(request).workspaceId);
    const { download } = request.query as { download?: string };
    if (download === 'true') {
      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.content);
    }
    return result;
  });

  app.get('/api/v1/audit/verify-integrity', async (request) => {
    return workspaceService.getAuditVerification(getSession(request).workspaceId);
  });

  // ── Document Ingestion Pipeline ──────────────────────────────────────────

  app.post('/api/v1/workspaces/:workspaceId/documents/upload', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as { filename?: string; mimeType?: string; contentBase64?: string; source?: string };
    if (!body.filename || !body.mimeType || !body.contentBase64) {
      return reply.code(400).send({ error: 'filename, mimeType and contentBase64 are required' });
    }
    const contentSizeBytes = Math.floor(body.contentBase64.length * 3 / 4);
    if (contentSizeBytes > 20 * 1024 * 1024) {
      return reply.code(413).send({ error: 'Document limit is 20 MB' });
    }
    const doc = await ingestDocument(workspaceId, {
      filename: body.filename,
      mimeType: body.mimeType,
      contentBase64: body.contentBase64,
      source: (body.source as any) ?? 'manual_upload',
    });

    // Phacet Agent: detect IBAN mismatch (fraude au virement fournisseur / BEC)
    if (doc.extractedData?.issuerIban && doc.extractedData.issuerSiren) {
      const contacts = await workspaceService.getContacts(workspaceId);
      const supplier = contacts.find(
        (c) =>
          (c.kind === 'supplier' || c.kind === 'both') &&
          c.siren === doc.extractedData!.issuerSiren &&
          c.certifiedIban != null,
      );
      if (supplier) {
        const alert = checkIbanAnomaly({ extractedIban: doc.extractedData.issuerIban, supplier });
        if (alert) {
          doc.ibanAlerts = [alert];
        }
      }
    }

    return reply.code(201).send(doc);
  });

  app.get('/api/v1/workspaces/:workspaceId/documents', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    return reply.send(listDocuments(workspaceId));
  });

  app.get('/api/v1/workspaces/:workspaceId/documents/:documentId', async (req, reply) => {
    const { workspaceId, documentId } = req.params as { workspaceId: string; documentId: string };
    const doc = getDocument(workspaceId, documentId);
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    return reply.send(doc);
  });

  app.patch('/api/v1/workspaces/:workspaceId/documents/:documentId/confirm', async (req, reply) => {
    const { workspaceId, documentId } = req.params as { workspaceId: string; documentId: string };
    const body = req.body as { confirmedKind?: DocumentKind; confirmedData?: ExtractedDocumentData };
    const validKinds: DocumentKind[] = ['supplier_invoice', 'client_invoice', 'expense_receipt', 'bank_statement', 'bank_transaction', 'payslip', 'tax_declaration', 'contract', 'quote_received', 'sales_report', 'unknown'];
    if (!body.confirmedKind || !validKinds.includes(body.confirmedKind)) return reply.code(400).send({ error: 'A valid confirmedKind is required' });
    const existing = getDocument(workspaceId, documentId);
    if (!existing) return reply.code(404).send({ error: 'Document not found' });
    if (existing.status === 'posted' || existing.status === 'rejected') return reply.code(409).send({ error: 'This document can no longer be confirmed' });
    const confirmedData = body.confirmedData ?? existing.extractedData;
    if (!confirmedData) return reply.code(422).send({ error: 'No extracted fields to confirm' });
    const doc = confirmDocument(workspaceId, documentId, body.confirmedKind, confirmedData);
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    return reply.send(doc);
  });

  app.patch('/api/v1/workspaces/:workspaceId/documents/:documentId/reject', async (req, reply) => {
    const { workspaceId, documentId } = req.params as { workspaceId: string; documentId: string };
    const doc = getDocument(workspaceId, documentId);
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    doc.status = 'rejected';
    return reply.send(doc);
  });

  app.delete('/api/v1/workspaces/:workspaceId/documents/:documentId', async (req, reply) => {
    const { workspaceId, documentId } = req.params as { workspaceId: string; documentId: string };
    const deleted = deleteDocument(workspaceId, documentId);
    if (!deleted) return reply.code(404).send({ error: 'Document not found' });
    return reply.code(204).send();
  });

  // POST document → expense (supplier_invoice / expense_receipt)
  app.post('/api/v1/workspaces/:workspaceId/documents/:documentId/post-as-expense', async (req, reply) => {
    const { workspaceId, documentId } = req.params as { workspaceId: string; documentId: string };
    const body = req.body as { supplierContactId: string; accountCode?: string; taxRuleCode?: string; deductibilityRatio?: string };
    if (!body.supplierContactId) return reply.code(400).send({ error: 'supplierContactId is required' });

    const doc = getDocument(workspaceId, documentId);
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    const data = doc.confirmedData;
    if (doc.status !== 'confirmed' || !data) return reply.code(409).send({ error: 'Review and confirm the extracted fields before creating an expense' });
    if (doc.detectedKind === 'sales_report') return reply.code(422).send({ error: 'A sales report cannot be posted as a supplier expense' });
    if (!['supplier_invoice', 'expense_receipt'].includes(doc.confirmedKind ?? '')) {
      return reply.code(422).send({ error: 'Confirm the document as a supplier invoice or expense receipt before creating an expense' });
    }
    const expenseDate = data.documentDate;
    const parsedExpenseDate = expenseDate ? new Date(`${expenseDate}T00:00:00.000Z`) : null;
    const validExpenseDate = Boolean(expenseDate && /^\d{4}-\d{2}-\d{2}$/.test(expenseDate)
      && parsedExpenseDate && !Number.isNaN(parsedExpenseDate.valueOf())
      && parsedExpenseDate.toISOString().slice(0, 10) === expenseDate);
    if (!expenseDate || !validExpenseDate || data.amountHtMinor === undefined || !Number.isSafeInteger(data.amountHtMinor) || data.amountHtMinor <= 0) {
      return reply.code(422).send({ error: 'A valid expense date and positive HT amount are required after review' });
    }

    const session = getSession(req);
    try {
      const expense = await workspaceService.createExpense(workspaceId, session.userId, {
        supplierContactId: body.supplierContactId,
        supplierInvoiceRef: data.referenceNumber ?? doc.filename,
        expenseDate,
        description: data.description ?? data.lines?.[0]?.description ?? doc.filename,
        accountingAccountCode: body.accountCode ?? data.suggestedAccountCode ?? '607100',
        taxRuleCode: body.taxRuleCode ?? data.suggestedTaxRuleCode ?? 'FR_TVA_20',
        deductibilityRatio: body.deductibilityRatio ?? String(data.suggestedDeductibilityRatio ?? 1),
        amountHtMinor: data.amountHtMinor,
        currency: (data.currency as 'EUR' | 'USD') ?? 'EUR',
        source: doc.extractionMethod === 'ocr_local'
          ? 'OCR locale'
          : doc.extractionMethod === 'facturx_xml'
            ? 'Factur-X PDP'
            : 'Import manuel',
        status: 'needs_review',
        inboxState: 'inbox',
      });

      const posted = markPosted(workspaceId, documentId, expense.id, 'expense');
      return reply.send({ expense, document: posted });
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : 'Erreur lors de la comptabilisation' });
    }
  });

  // POST send IBAN mismatch alert email to supplier (Phacet Agent)
  app.post('/api/v1/workspaces/:workspaceId/documents/:documentId/send-iban-alert', async (req, reply) => {
    const { workspaceId, documentId } = req.params as { workspaceId: string; documentId: string };
    const doc = getDocument(workspaceId, documentId);
    if (!doc) return reply.code(404).send({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' } });

    const alert = doc.ibanAlerts?.[0];
    if (!alert) {
      return reply.code(422).send({
        error: { code: 'NO_IBAN_ALERT', message: 'Aucune alerte IBAN détectée sur ce document.' },
      });
    }

    const contacts = await workspaceService.getContacts(workspaceId);
    const supplier = contacts.find((c) => c.id === alert.supplierContactId);
    if (!supplier) {
      return reply.code(404).send({ error: { code: 'SUPPLIER_NOT_FOUND', message: 'Fournisseur introuvable.' } });
    }
    if (!supplier.email) {
      return reply.code(422).send({
        error: { code: 'NO_SUPPLIER_EMAIL', message: 'Aucune adresse e-mail enregistrée pour ce fournisseur.' },
      });
    }

    try {
      const ws = await workspaceService.getWorkspace(workspaceId);
      const result = await sendIbanAlertEmail({
        alert,
        supplier,
        workspace: ws,
      });
      // Mark alert as sent in the stored document
      alert.emailSent = true;
      alert.emailSentAt = new Date().toISOString();
      return reply.send({ alertMessage: alert.alertMessage, email: result });
    } catch (err) {
      return reply.code(502).send({
        error: { code: 'EMAIL_SEND_FAILED', message: err instanceof Error ? err.message : 'Erreur envoi e-mail' },
      });
    }
  });

  // POST document → bank import (bank_statement)
  app.post('/api/v1/workspaces/:workspaceId/documents/:documentId/post-as-bank-import', async (req, reply) => {
    const { workspaceId, documentId } = req.params as { workspaceId: string; documentId: string };

    const doc = getDocument(workspaceId, documentId);
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    const data = doc.confirmedData;
    if (doc.status !== 'confirmed' || !data) {
      return reply.code(409).send({ error: 'Review and confirm the extracted fields before importing transactions' });
    }
    if (doc.confirmedKind !== 'bank_statement') {
      return reply.code(422).send({ error: 'Confirm the document as a bank statement before importing transactions' });
    }
    if (!data?.bankTransactions?.length) {
      return reply.code(422).send({ error: 'No bank transactions found in this document' });
    }

    const mapped = data.bankTransactions.map((tx: { date: string; label: string; amountMinor: number; direction: 'debit' | 'credit'; reference?: string; counterparty?: string }) => ({
      transactionDate: tx.date,
      description: tx.label,
      amountSignedMinor: tx.direction === 'debit' ? -Math.abs(tx.amountMinor) : Math.abs(tx.amountMinor),
      counterpartyName: tx.counterparty ?? '',
      sourceRef: tx.reference,
    }));

    const sourceLabel = `Import ${doc.filename} — ${new Date().toISOString().slice(0, 10)}`;
    const created = await workspaceService.addBankTransactionsImport(workspaceId, mapped, sourceLabel, data.bankAccountName as string | undefined);
    const posted = markPosted(workspaceId, documentId, (created as Array<{ id?: string }>)[0]?.id ?? 'batch', 'bank_import');

    return reply.send({ importedCount: created.length, transactions: created, document: posted });
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    void app.register(fastifyStatic, { root: distPath, index: ['index.html'] });
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));
  }

  return app;
}

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3001);
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    console.log(`Haxatax API server listening on http://localhost:${port}`);
  });
}
