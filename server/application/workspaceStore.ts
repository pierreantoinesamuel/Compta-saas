/**
 * Authoritative Transactional Application Service & Store for Haxatax.
 * Coordinates:
 * - Workspace Legal Identity (Micro-entreprise vs Société PCG 2025, TVA sur les débits vs encaissements)
 * - Gapless Sequential Numbering (`document_sequences` lock pattern)
 * - Third-Parties (`Tiers`: Customers & Suppliers with SIREN/SIRET, VIES VAT, and CompAuxNum 411/401)
 * - Sales Lifecycle: Quotes (`Devis`), Deposit Invoices (`Acomptes`), Standard Invoices (`Factures`), Credit Notes (`Avoirs`)
 * - Native Factur-X (EN 16931 CII XML) generation on issuance
 * - Multi-rate Expenses with partial VAT deductibility (e.g. 80% fuel), 3-pane Inbox (`Boîte de réception`), and AI Bank Matching Suggestions
 * - Grouped / Multi-Invoice Bank Reconciliation (`Traitement des virements et prélèvements groupés`)
 * - Automatic & Manual Auxiliary Account Lettering (`Lettrer auto.` EcritureLet / DateLet) and Cash-Basis VAT realization (`44574` -> `44571`)
 * - 18-Column Statutory FEC Generator & Cryptographic `SHA-256` Audit Log (`BlockedLog`)
 */

import { randomUUID } from 'node:crypto';
import {
  computeFrenchVatNumber,
  generateAuxiliaryAccountCode,
  validateEuVatNumber,
  validateSiren,
  validateSiret,
} from '../domain/contacts/frenchLegalValidators.js';
import {
  calculateCashBasisVatRealization,
  calculateExpenseLineVat,
  calculateInvoiceTotals,
  type CalculatedInvoiceLine,
  type CalculatedTaxBreakdown,
  type InvoiceLineInput,
  type SalesDocumentType,
} from '../domain/tax/vatEngine.js';
import { generateFacturxXml } from '../domain/einvoicing/facturxGenerator.js';
import {
  generateStatutoryFec,
  validateAuxiliaryLetteringGroup,
  validateJournalEntryForPosting,
  type JournalEntryInput,
  type JournalEntryLineInput,
} from '../domain/accounting/pcg2025.js';
import {
  computeChainedRecordHash,
  verifyHashChain,
  type VerifiableChainItem,
} from '../domain/audit/hashChain.js';

export interface WorkspaceProfile {
  id: string;
  legalName: string;
  tradeName: string;
  siren: string;
  siret: string;
  nafCode: string;
  legalForm: 'MICRO_ENTREPRISE' | 'SASU' | 'SAS' | 'EURL' | 'SARL' | 'EI';
  shareCapitalMinor: number | null;
  rcsCity: string;
  rcsNumber: string;
  vatNumber: string;
  fiscalRegime: 'MICRO' | 'REEL_SIMPLIFIE' | 'REEL_NORMAL';
  accountingMode: 'CASH_MICRO' | 'DOUBLE_ENTRY_PCG2025';
  vatRegime: 'FRANCHISE_293B' | 'REEL_SIMPLIFIE' | 'REEL_NORMAL';
  vatExigibility: 'DEBITS' | 'ENCAISSEMENTS';
  registeredAddress: {
    streetLine1: string;
    postalCode: string;
    city: string;
    countryCode: string;
  };
  defaultLatePenaltyRate: string;
  defaultRecoveryIndemnityMinor: number;
  defaultDiscountTerms: string;
}

export interface ContactRecord {
  id: string;
  kind: 'customer' | 'supplier' | 'both';
  isBusiness: boolean;
  taxZone: 'DOMESTIC_FR' | 'DOM_TOM' | 'INTRA_EU' | 'EXPORT_NON_EU';
  legalName: string;
  siren: string | null;
  siret: string | null;
  vatIdentifier: string | null;
  email: string;
  billingAddress: {
    streetLine1: string;
    postalCode: string;
    city: string;
    countryCode: string;
  };
  customerAuxiliaryCode: string | null;
  supplierAuxiliaryCode: string | null;
  certifiedIban: string | null;
  defaultPaymentTermsDays: number;
  archivedAt: string | null;
}

export interface SalesDocumentRecord {
  id: string;
  documentType: SalesDocumentType;
  provisionalRef: string;
  number: string | null;
  status: 'draft' | 'issued' | 'cancelled_by_credit_note';
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid';
  einvoiceStatus: 'not_applicable' | 'pending_submission' | 'deposited' | 'accepted' | 'cashed';
  contactId: string;
  contactLegalName: string;
  originalInvoiceId: string | null;
  originalInvoiceNumber: string | null;
  operationCategory: 'goods' | 'services' | 'mixed';
  issueDate: string;
  deliveryOrServiceDate: string;
  dueDate: string;
  purchaseOrderRef: string | null;
  currency: string;
  lines: CalculatedInvoiceLine[];
  taxBreakdowns: CalculatedTaxBreakdown[];
  subtotalHtMinor: number;
  vatTotalMinor: number;
  totalTtcMinor: number;
  depositsDeductedTtcMinor: number;
  netToPayTtcMinor: number;
  amountPaidMinor: number;
  realizedVatByRuleMinor: Record<string, number>;
  latePenaltyRatePercent: string;
  recoveryIndemnityMinor: number;
  discountTerms: string;
  vatExemptionMention: string | null;
  vatOnDebitsMention: boolean;
  facturxXml: string | null;
  previousDocumentHash: string | null;
  documentHash: string | null;
  journalEntryId: string | null;
  issuedAt: string | null;
}

export interface ExpenseRecord {
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
  source: 'Factur-X PDP' | 'OCR IA UE' | 'OCR locale' | 'Import manuel' | 'Email' | 'GoogleDrive';
  journalEntryId: string | null;
  reconciledTransactionId: string | null;
  rejectedTransactionIds: string[];
  pagesCount: number;
  categoryLabel: string;
}

export interface LedgerEntryRecord extends JournalEntryInput {
  id: string;
  status: 'draft' | 'posted' | 'reversed';
  sourceType: string;
  sourceId: string | null;
  previousEntryHash: string;
  entryHash: string;
}

export interface BankReconciliationAllocation {
  id: string;
  documentId: string;
  documentKind: 'invoice' | 'expense';
  documentNumber: string;
  thirdPartyName: string;
  allocatedAmountMinor: number;
  reconciledAt: string;
  letteringCode: string | null;
}

export interface BankTransactionComment {
  id: string;
  author: string;
  createdAt: string;
  text: string;
}

export interface BankTransactionRecord {
  id: string;
  transactionDate: string;
  description: string;
  counterpartyName: string;
  bankName: string;
  bankAccountCode: string;
  sourceLabel: string;
  amountMinor: number; // positive = inflow, negative = outflow
  status: 'unmatched' | 'matched';
  workflowStatus: 'a_traiter' | 'demande_comptable' | 'a_confirmer' | 'rapprochee' | 'supprime';
  matchedDocumentId: string | null;
  matchedDocumentNumber: string | null;
  letteringCode: string | null;
  reconciledAllocations: BankReconciliationAllocation[];
  comments: BankTransactionComment[];
  ruleName: string | null;
}

class HaxataxWorkspaceEngine {
  private workspace: WorkspaceProfile = {
    id: '00000000-0000-4000-8000-000000000001',
    legalName: 'Haxatax Conseil & Technologies SAS',
    tradeName: 'Haxatax',
    siren: '732829320',
    siret: '73282932000074',
    nafCode: '6201Z',
    legalForm: 'SAS',
    shareCapitalMinor: 1000000, // 10 000,00 €
    rcsCity: 'Paris',
    rcsNumber: 'Paris B 732 829 320',
    vatNumber: computeFrenchVatNumber('732829320'),
    fiscalRegime: 'REEL_NORMAL',
    accountingMode: 'DOUBLE_ENTRY_PCG2025',
    vatRegime: 'REEL_NORMAL',
    vatExigibility: 'ENCAISSEMENTS',
    registeredAddress: {
      streetLine1: '14 Rue de la Paix',
      postalCode: '75002',
      city: 'Paris',
      countryCode: 'FR',
    },
    defaultLatePenaltyRate: '15.000',
    defaultRecoveryIndemnityMinor: 4000,
    defaultDiscountTerms: "Pas d'escompte pour paiement anticipé",
  };

  private periodStatus: 'open' | 'closing_review' | 'closed' = 'open';
  private sequences = new Map<string, { value: number; lastHash: string | null }>();
  private letteringCounter = 0;

  private contacts: ContactRecord[] = [];
  private invoices: SalesDocumentRecord[] = [];
  private expenses: ExpenseRecord[] = [];
  private journalEntries: LedgerEntryRecord[] = [];
  private bankTransactions: BankTransactionRecord[] = [];
  private auditChain: VerifiableChainItem[] = [];

  constructor() {
    this.seedInitialDemoData();
  }

  private nextSequence(seqKey: string, prefix: string, pad = 5): {
    formatted: string;
    seqNum: number;
    lastHash: string | null;
  } {
    const current = this.sequences.get(seqKey) ?? { value: 0, lastHash: null };
    const nextVal = current.value + 1;
    const formatted = `${prefix}${nextVal.toString().padStart(pad, '0')}`;
    this.sequences.set(seqKey, { value: nextVal, lastHash: current.lastHash });
    return { formatted, seqNum: nextVal, lastHash: current.lastHash };
  }

  private updateSequenceHash(seqKey: string, recordHash: string): void {
    const current = this.sequences.get(seqKey);
    if (current) {
      current.lastHash = recordHash;
    }
  }

  private nextLetteringCode(): string {
    const first = Math.floor(this.letteringCounter / 26);
    const second = this.letteringCounter % 26;
    this.letteringCounter += 1;
    return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
  }

  private appendAudit(action: string, entityType: string, payload: Record<string, unknown>): void {
    const seq = this.auditChain.length + 1;
    const prevHash = seq === 1 ? null : this.auditChain[seq - 2]!.recordHash;
    const occurredAtIso = new Date().toISOString();
    const base = {
      workspaceId: this.workspace.id,
      sequenceNumberOrRef: seq,
      occurredAtIso,
      entityType: `${entityType}:${action}`,
      payload,
    };
    const { previousHash, recordHash } = computeChainedRecordHash(prevHash, base);
    this.auditChain.push({
      ...base,
      previousHash,
      recordHash,
    });
  }

  private seedInitialDemoData(): void {
    // 1. Seed realistic French & EU Customers and Suppliers
    const c1 = this.createContact({
      kind: 'customer',
      isBusiness: true,
      taxZone: 'DOMESTIC_FR',
      legalName: 'Automobiles Peugeot SA',
      siren: '552100554',
      siret: '55210055400013',
      email: 'comptabilite@peugeot-demo.fr',
      billingAddress: {
        streetLine1: '7 Rue Henri Sainte-Claire Deville',
        postalCode: '92500',
        city: 'Rueil-Malmaison',
        countryCode: 'FR',
      },
      defaultPaymentTermsDays: 30,
    });

    const c2 = this.createContact({
      kind: 'customer',
      isBusiness: true,
      taxZone: 'DOMESTIC_FR',
      legalName: 'Doctolib France SAS',
      siren: '794598813',
      siret: null,
      email: 'finances@doctolib-demo.fr',
      billingAddress: {
        streetLine1: '54 Quai Charles Pasqua',
        postalCode: '92300',
        city: 'Levallois-Perret',
        countryCode: 'FR',
      },
      defaultPaymentTermsDays: 30,
    });

    const c3 = this.createContact({
      kind: 'customer',
      isBusiness: true,
      taxZone: 'INTRA_EU',
      legalName: 'Berlin Cloud Systems GmbH',
      siren: null,
      siret: null,
      vatIdentifier: 'DE123456789',
      email: 'finance@berlincloud.de',
      billingAddress: {
        streetLine1: 'Friedrichstraße 100',
        postalCode: '10117',
        city: 'Berlin',
        countryCode: 'DE',
      },
      defaultPaymentTermsDays: 30,
    });

    const s0 = this.createContact({
      kind: 'supplier',
      isBusiness: true,
      taxZone: 'DOMESTIC_FR',
      legalName: 'SFR Business Distribution SA',
      siren: '343059564',
      siret: null,
      email: 'factures@sfr-business-demo.fr',
      billingAddress: {
        streetLine1: '16 Rue du Général Alain de Boissieu',
        postalCode: '75015',
        city: 'Paris',
        countryCode: 'FR',
      },
      defaultPaymentTermsDays: 15,
    });

    const s1 = this.createContact({
      kind: 'supplier',
      isBusiness: true,
      taxZone: 'DOMESTIC_FR',
      legalName: 'Scaleway Cloud France SAS',
      siren: '433115904',
      siret: null,
      email: 'billing@scaleway-demo.fr',
      billingAddress: {
        streetLine1: '8 Rue de la Ville l’Évêque',
        postalCode: '75008',
        city: 'Paris',
        countryCode: 'FR',
      },
      defaultPaymentTermsDays: 30,
    });

    const s2 = this.createContact({
      kind: 'supplier',
      isBusiness: true,
      taxZone: 'DOMESTIC_FR',
      legalName: 'SNCF Voyageurs SA',
      siren: '552049447',
      siret: null,
      email: 'factures@sncf-demo.fr',
      billingAddress: {
        streetLine1: '9 Rue Jean-Philippe Rameau',
        postalCode: '93200',
        city: 'Saint-Denis',
        countryCode: 'FR',
      },
      defaultPaymentTermsDays: 30,
    });

    const s3 = this.createContact({
      kind: 'supplier',
      isBusiness: true,
      taxZone: 'DOMESTIC_FR',
      legalName: 'TotalEnergies Mobilités',
      siren: '542051180',
      siret: null,
      email: 'flotte@totalenergies-demo.fr',
      billingAddress: {
        streetLine1: '2 Place Jean Millier',
        postalCode: '92400',
        city: 'Courbevoie',
        countryCode: 'FR',
      },
      defaultPaymentTermsDays: 30,
    });

    const s4 = this.createContact({
      kind: 'supplier',
      isBusiness: true,
      taxZone: 'INTRA_EU',
      legalName: 'Google Cloud EMEA Ltd',
      siren: null,
      siret: null,
      vatIdentifier: 'IE6388047V',
      email: 'invoicing@google-emea-demo.ie',
      billingAddress: {
        streetLine1: 'Barrow Street 4',
        postalCode: 'D04 E5W5',
        city: 'Dublin',
        countryCode: 'IE',
      },
      defaultPaymentTermsDays: 30,
    });

    // 2. Seed an issued & already paid/reconciled invoice (FA-2026-00001)
    const draft1 = this.createDraftInvoice({
      documentType: 'standard_invoice',
      contactId: c2.id,
      issueDate: '2026-09-18',
      deliveryOrServiceDate: '2026-09-18',
      dueDate: '2026-10-18',
      purchaseOrderRef: 'BC-DOC-2026-412',
      lines: [
        {
          description: 'Déploiement Architecture Micro-Services & Sécurité RGPD / HDS',
          lineNature: 'services',
          quantity: '10',
          unitCode: 'DAY',
          unitPriceHtMinor: 84483, // 844,83 € HT / j -> 8 448,30 € HT -> 10 137,96 € TTC
          taxRuleCode: 'FR_TVA_20',
        },
      ],
    });
    const issued1 = this.issueSalesDocument(draft1.id);
    this.recordInvoicePayment({
      invoiceId: issued1.id,
      paymentDate: '2026-10-02',
      amountMinor: issued1.netToPayTtcMinor,
    });

    // 3. Seed an issued B2B Invoice awaiting bank reconciliation (FA-2026-00002: 5 520,00 € TTC)
    const draft2 = this.createDraftInvoice({
      documentType: 'standard_invoice',
      contactId: c1.id,
      issueDate: '2026-10-05',
      deliveryOrServiceDate: '2026-10-05',
      dueDate: '2026-11-04',
      purchaseOrderRef: 'BC-PEU-2026-8841',
      lines: [
        {
          description: 'Architecture SaaS Comptable & Conformité Factur-X (EN 16931)',
          lineNature: 'services',
          quantity: '4',
          unitCode: 'DAY',
          unitPriceHtMinor: 75000, // 3 000,00 € HT
          taxRuleCode: 'FR_TVA_20',
        },
        {
          description: 'Audit Piste d’Audit Fiable (PAF) & Scellement SHA-256',
          lineNature: 'services',
          quantity: '2',
          unitCode: 'DAY',
          unitPriceHtMinor: 80000, // 1 600,00 € HT
          taxRuleCode: 'FR_TVA_20',
        },
      ],
    });
    this.issueSalesDocument(draft2.id);

    // 4. Seed a Deposit Invoice (Facture d'acompte AC-2026-00001: 1 800,00 € TTC)
    const depositDraft = this.createDraftInvoice({
      documentType: 'deposit_invoice',
      contactId: c1.id,
      issueDate: '2026-10-12',
      deliveryOrServiceDate: '2026-10-12',
      dueDate: '2026-10-25',
      purchaseOrderRef: 'BC-PEU-2026-9100',
      lines: [
        {
          description: 'Acompte 30 % sur intégration connecteur PDP Chorus Pro (Art. 289-I-1-c CGI)',
          lineNature: 'services',
          quantity: '1',
          unitCode: 'C62',
          unitPriceHtMinor: 150000, // 1 500,00 € HT -> 1 800,00 € TTC
          taxRuleCode: 'FR_TVA_20',
        },
      ],
    });
    this.issueSalesDocument(depositDraft.id);

    // 5. Seed a draft Intra-EU B2B invoice ready for review & issuance
    this.createDraftInvoice({
      documentType: 'standard_invoice',
      contactId: c3.id,
      issueDate: '2026-10-18',
      deliveryOrServiceDate: '2026-10-18',
      dueDate: '2026-11-17',
      purchaseOrderRef: 'PO-EU-902',
      lines: [
        {
          description: 'Licence logicielle & Support B2B Intracommunautaire (Autoliquidation)',
          lineNature: 'services',
          quantity: '1',
          unitCode: 'C62',
          unitPriceHtMinor: 240000, // 2 400,00 € HT (Autoliquidation 0%)
          taxRuleCode: 'EU_B2B_SERVICES_REVERSE_CHARGE',
        },
      ],
    });

    // 6. Seed supplier expenses across Boîte de réception, À payer, and Payé (Image 3)
    this.createExpense({
      supplierContactId: s0.id,
      supplierInvoiceRef: 'SFR-2026-0912',
      expenseDate: '2026-05-09',
      dueDate: '2026-05-24',
      description: 'Forfait Fibre Pro Dédiée & IP Fixe Siège Paris (21,98 € TTC dont 3,66 € TVA)',
      accountingAccountCode: '626000',
      taxRuleCode: 'FR_TVA_20',
      deductibilityRatio: '1.00',
      amountHtMinor: 1832, // 18,32 € HT + 3,66 € TVA = 21,98 € TTC!
      status: 'needs_review',
      inboxState: 'inbox',
      paymentState: 'to_pay',
      source: 'OCR IA UE',
      pagesCount: 2,
      categoryLabel: 'Télécoms & Internet',
    });

    this.createExpense({
      supplierContactId: s4.id,
      supplierInvoiceRef: 'GCP-IE-2026-4410',
      expenseDate: '2026-06-22',
      dueDate: '2026-07-22',
      description: 'API Cloud & Stockage Multi-Région ($99.00 USD / 91,50 € HT — Autoliquidation UE)',
      accountingAccountCode: '613500',
      taxRuleCode: 'EU_B2B_SERVICES_REVERSE_CHARGE',
      deductibilityRatio: '1.00',
      amountHtMinor: 9150,
      currency: 'USD',
      foreignAmountTtcMinor: 9900, // $99.00 USD
      status: 'needs_review',
      inboxState: 'inbox',
      paymentState: 'to_pay',
      source: 'Email',
      pagesCount: 1,
      categoryLabel: 'Logiciels & Cloud (Devise USD)',
    });

    this.createExpense({
      supplierContactId: s2.id,
      supplierInvoiceRef: 'SNCF-2026-33109',
      expenseDate: '2026-10-15',
      dueDate: '2026-10-30',
      description: 'Déplacements TGV Paris-Lyon Équipe Audit (TVA 0% transport personnes)',
      accountingAccountCode: '625100',
      taxRuleCode: 'FR_TVA_10',
      deductibilityRatio: '0.00',
      amountHtMinor: 32000, // 352,00 € TTC
      status: 'needs_review',
      inboxState: 'inbox',
      paymentState: 'to_pay',
      source: 'Email',
      pagesCount: 1,
      categoryLabel: 'Déplacements & Missions',
    });

    this.createExpense({
      supplierContactId: s3.id,
      supplierInvoiceRef: 'TOT-2026-88412',
      expenseDate: '2026-10-11',
      dueDate: '2026-10-26',
      description: 'Carburant Flotte Véhicules (Quotité TVA déductible 80% — Art. 206 CGI)',
      accountingAccountCode: '606100',
      taxRuleCode: 'FR_TVA_20',
      deductibilityRatio: '0.80',
      amountHtMinor: 45000, // 450,00 € HT + 90 € TVA = 540,00 € TTC
      status: 'approved',
      inboxState: 'to_pay',
      paymentState: 'to_pay',
      source: 'OCR IA UE',
      pagesCount: 1,
      categoryLabel: 'Flotte & Carburant',
    });

    const expScw = this.createExpense({
      supplierContactId: s1.id,
      supplierInvoiceRef: 'SCW-2026-10992',
      expenseDate: '2026-10-04',
      dueDate: '2026-10-19',
      description: 'Infrastructure Cloud Souverain Paris (eu-west-3) & Stockage WORM PAF',
      accountingAccountCode: '613500',
      taxRuleCode: 'FR_TVA_20',
      deductibilityRatio: '1.00',
      amountHtMinor: 120000, // 1 200,00 € HT -> 1 440,00 € TTC
      status: 'reconciled',
      inboxState: 'paid',
      paymentState: 'paid',
      source: 'Factur-X PDP',
      pagesCount: 2,
      categoryLabel: 'Hébergement Souverain UE',
    });

    // 7. Seed Bank Transactions (Image 1 & Image 3)
    const txGroupedOutId = randomUUID();
    const txSfrOutId = randomUUID();
    const txSncfOutId = randomUUID();
    const txTotalOutId = randomUUID();

    this.bankTransactions.push(
      {
        id: txGroupedOutId,
        transactionDate: '2026-10-17',
        description: 'VIREMENT SEPA EMIS /MOTIF REGLEMENT GROUPE FOURNISSEURS OCTOBRE /REF LOT-2026-10',
        counterpartyName: 'Lot Prélèvements & Virements Fournisseurs',
        bankName: 'Crédit Agricole',
        bankAccountCode: '512100',
        sourceLabel: 'Flux DSP2 Temps Réel',
        amountMinor: -50000, // -500,00 € (exactly as in Image 1!)
        status: 'unmatched',
        workflowStatus: 'a_traiter',
        matchedDocumentId: null,
        matchedDocumentNumber: null,
        letteringCode: null,
        reconciledAllocations: [],
        comments: [
          {
            id: randomUUID(),
            author: 'Camille Laurent (Expert-Comptable)',
            createdAt: '2026-10-17 14:20',
            text: 'Virement groupé à ventiler sur les factures fournisseurs du mois.',
          },
        ],
        ruleName: 'Détection virements groupés SEPA',
      },
      {
        id: txSfrOutId,
        transactionDate: '2026-05-12',
        description: 'PRLV SEPA SFR BUSINESS DISTRIBUTION /INV SFR-2026-0912 FIBRE PRO',
        counterpartyName: 'SFR Business Distribution SA',
        bankName: 'Crédit Agricole',
        bankAccountCode: '512100',
        sourceLabel: 'Flux DSP2 Temps Réel',
        amountMinor: -2198, // -21,98 € (matches SFR invoice in Image 3!)
        status: 'unmatched',
        workflowStatus: 'a_traiter',
        matchedDocumentId: null,
        matchedDocumentNumber: null,
        letteringCode: null,
        reconciledAllocations: [],
        comments: [],
        ruleName: 'Règle auto Télécoms (626000)',
      },
      {
        id: randomUUID(),
        transactionDate: '2026-10-15',
        description: 'VIR SEPA RECU AUTOMOBILES PEUGEOT SA REF FA-2026-00002',
        counterpartyName: 'Automobiles Peugeot SA',
        bankName: 'Qonto',
        bankAccountCode: '512100',
        sourceLabel: 'API Qonto Connect',
        amountMinor: 552000, // Matches FA-2026-00002 (5 520,00 € TTC)
        status: 'unmatched',
        workflowStatus: 'a_confirmer',
        matchedDocumentId: null,
        matchedDocumentNumber: null,
        letteringCode: null,
        reconciledAllocations: [],
        comments: [],
        ruleName: 'Rapprochement auto Factur-X Client',
      },
      {
        id: randomUUID(),
        transactionDate: '2026-10-16',
        description: 'VIR SEPA RECU AUTOMOBILES PEUGEOT SA ACOMPTE AC-2026-00001',
        counterpartyName: 'Automobiles Peugeot SA',
        bankName: 'Crédit Agricole',
        bankAccountCode: '512100',
        sourceLabel: 'Flux DSP2 Temps Réel',
        amountMinor: 180000, // Matches AC-2026-00001 (1 800,00 € TTC)
        status: 'unmatched',
        workflowStatus: 'a_traiter',
        matchedDocumentId: null,
        matchedDocumentNumber: null,
        letteringCode: null,
        reconciledAllocations: [],
        comments: [],
        ruleName: null,
      },
      {
        id: txTotalOutId,
        transactionDate: '2026-10-13',
        description: 'CARTE AFFAIRES TOTALENERGIES MOBILITES REF TOT-2026-88412',
        counterpartyName: 'TotalEnergies Mobilités',
        bankName: 'BNP Paribas',
        bankAccountCode: '512100',
        sourceLabel: 'Import CFONB / EBICS',
        amountMinor: -54000, // -540,00 €
        status: 'unmatched',
        workflowStatus: 'demande_comptable',
        matchedDocumentId: null,
        matchedDocumentNumber: null,
        letteringCode: null,
        reconciledAllocations: [],
        comments: [
          {
            id: randomUUID(),
            author: 'Cabinet Haxatax Audit',
            createdAt: '2026-10-14 09:15',
            text: 'Merci de confirmer le justificatif de carburant (TVA déductible à 80 % véhicule utilitaire/tourisme).',
          },
        ],
        ruleName: 'Quotité TVA Carburant 80%',
      },
      {
        id: txSncfOutId,
        transactionDate: '2026-10-15',
        description: 'CARTE AFFAIRES SNCF VOYAGEURS PARIS LYON REF SNCF-2026-33109',
        counterpartyName: 'SNCF Voyageurs SA',
        bankName: 'Crédit Agricole',
        bankAccountCode: '512100',
        sourceLabel: 'Flux DSP2 Temps Réel',
        amountMinor: -35200, // -352,00 €
        status: 'unmatched',
        workflowStatus: 'a_traiter',
        matchedDocumentId: null,
        matchedDocumentNumber: null,
        letteringCode: null,
        reconciledAllocations: [],
        comments: [],
        ruleName: null,
      },
      {
        id: randomUUID(),
        transactionDate: '2026-10-06',
        description: 'PRLV SEPA SCALEWAY CLOUD FRANCE SAS REF SCW-2026-10992',
        counterpartyName: 'Scaleway Cloud France SAS',
        bankName: 'Qonto',
        bankAccountCode: '512100',
        sourceLabel: 'API Qonto Connect',
        amountMinor: -144000, // -1 440,00 €
        status: 'matched',
        workflowStatus: 'rapprochee',
        matchedDocumentId: expScw.id,
        matchedDocumentNumber: expScw.supplierInvoiceRef,
        letteringCode: 'AB',
        reconciledAllocations: [
          {
            id: randomUUID(),
            documentId: expScw.id,
            documentKind: 'expense',
            documentNumber: expScw.supplierInvoiceRef,
            thirdPartyName: expScw.supplierName,
            allocatedAmountMinor: 144000,
            reconciledAt: '2026-10-06',
            letteringCode: 'AB',
          },
        ],
        comments: [],
        ruleName: 'Rapprochement auto Factur-X Fournisseur',
      },
      {
        id: randomUUID(),
        transactionDate: '2026-10-02',
        description: 'VIR SEPA RECU DOCTOLIB FRANCE SAS REF FA-2026-00001',
        counterpartyName: 'Doctolib France SAS',
        bankName: 'Qonto',
        bankAccountCode: '512100',
        sourceLabel: 'API Qonto Connect',
        amountMinor: issued1.netToPayTtcMinor,
        status: 'matched',
        workflowStatus: 'rapprochee',
        matchedDocumentId: issued1.id,
        matchedDocumentNumber: issued1.number,
        letteringCode: 'AA',
        reconciledAllocations: [
          {
            id: randomUUID(),
            documentId: issued1.id,
            documentKind: 'invoice',
            documentNumber: issued1.number ?? 'FA-2026-00001',
            thirdPartyName: issued1.contactLegalName,
            allocatedAmountMinor: issued1.netToPayTtcMinor,
            reconciledAt: '2026-10-02',
            letteringCode: 'AA',
          },
        ],
        comments: [],
        ruleName: 'Rapprochement auto Factur-X Client',
      }
    );
  }

  getWorkspace(): WorkspaceProfile {
    return this.workspace;
  }

  updateWorkspace(
    patch: Partial<
      Pick<
        WorkspaceProfile,
        'legalName' | 'siren' | 'siret' | 'legalForm' | 'accountingMode' | 'vatRegime' | 'vatExigibility'
      >
    >
  ): WorkspaceProfile {
    if (patch.siren) {
      const check = validateSiren(patch.siren);
      if (!check.valid) {
        throw new Error(check.errorMessage);
      }
      this.workspace.siren = check.normalized;
      this.workspace.vatNumber = computeFrenchVatNumber(check.normalized);
    }
    if (patch.siret) {
      const check = validateSiret(patch.siret);
      if (!check.valid) {
        throw new Error(check.errorMessage);
      }
      this.workspace.siret = check.normalized;
    }
    if (patch.legalName) this.workspace.legalName = patch.legalName;
    if (patch.legalForm) {
      this.workspace.legalForm = patch.legalForm;
      if (patch.legalForm === 'MICRO_ENTREPRISE') {
        this.workspace.fiscalRegime = 'MICRO';
        this.workspace.accountingMode = 'CASH_MICRO';
      }
    }
    if (patch.accountingMode) this.workspace.accountingMode = patch.accountingMode;
    if (patch.vatRegime) this.workspace.vatRegime = patch.vatRegime;
    if (patch.vatExigibility) this.workspace.vatExigibility = patch.vatExigibility;

    this.appendAudit('WORKSPACE_UPDATED', 'workspace', {
      accountingMode: this.workspace.accountingMode,
      vatRegime: this.workspace.vatRegime,
      vatExigibility: this.workspace.vatExigibility,
    });
    return this.workspace;
  }

  getContacts(): ContactRecord[] {
    return this.contacts;
  }

  createContact(input: {
    kind: 'customer' | 'supplier' | 'both';
    isBusiness: boolean;
    taxZone: 'DOMESTIC_FR' | 'DOM_TOM' | 'INTRA_EU' | 'EXPORT_NON_EU';
    legalName: string;
    siren?: string | null;
    siret?: string | null;
    vatIdentifier?: string | null;
    email?: string;
    billingAddress: {
      streetLine1: string;
      postalCode: string;
      city: string;
      countryCode: string;
    };
    defaultPaymentTermsDays?: number;
    certifiedIban?: string | null;
  }): ContactRecord {
    const legalName = input.legalName.trim();
    if (!legalName) {
      throw new Error('La raison sociale ou le nom du tiers est obligatoire.');
    }
    if (input.isBusiness && input.taxZone === 'DOMESTIC_FR' && !input.siren?.trim()) {
      throw new Error('Le SIREN est obligatoire pour une entreprise française.');
    }

    let normalizedSiren: string | null = null;
    let normalizedVat: string | null = input.vatIdentifier ?? null;

    if (input.siren && input.siren.trim().length > 0) {
      const check = validateSiren(input.siren);
      if (!check.valid) {
        throw new Error(check.errorMessage);
      }
      normalizedSiren = check.normalized;
      if (this.contacts.some((contact) => contact.isBusiness && contact.siren === normalizedSiren)) {
        throw new Error('Un tiers professionnel avec ce SIREN existe déjà.');
      }
      if (!normalizedVat && input.taxZone === 'DOMESTIC_FR') {
        normalizedVat = computeFrenchVatNumber(normalizedSiren);
      }
    }

    if (normalizedVat) {
      const vatCheck = validateEuVatNumber(normalizedVat);
      if (!vatCheck.valid) {
        throw new Error(vatCheck.errorMessage);
      }
      normalizedVat = vatCheck.normalized;
    }

    const idx = this.contacts.length + 1;
    const customerAuxiliaryCode =
      input.kind === 'customer' || input.kind === 'both'
        ? generateAuxiliaryAccountCode('customer', idx)
        : null;
    const supplierAuxiliaryCode =
      input.kind === 'supplier' || input.kind === 'both'
        ? generateAuxiliaryAccountCode('supplier', idx)
        : null;

    const contact: ContactRecord = {
      id: randomUUID(),
      kind: input.kind,
      isBusiness: input.isBusiness,
      taxZone: input.taxZone,
      legalName,
      siren: normalizedSiren,
      siret: input.siret ?? null,
      vatIdentifier: normalizedVat,
      email: input.email?.trim() ?? '',
      billingAddress: input.billingAddress,
      customerAuxiliaryCode,
      supplierAuxiliaryCode,
      certifiedIban: input.certifiedIban ?? null,
      defaultPaymentTermsDays: Math.min(60, Math.max(0, input.defaultPaymentTermsDays ?? 30)),
      archivedAt: null,
    };

    this.contacts.push(contact);
    this.appendAudit('CONTACT_CREATED', 'contact', {
      id: contact.id,
      legalName: contact.legalName,
      siren: contact.siren,
      customerAuxiliaryCode,
      supplierAuxiliaryCode,
    });
    return contact;
  }

  getInvoices(): SalesDocumentRecord[] {
    return this.invoices;
  }

  createDraftInvoice(input: {
    documentType: SalesDocumentType;
    contactId: string;
    originalInvoiceId?: string | null;
    issueDate: string;
    deliveryOrServiceDate?: string;
    dueDate: string;
    purchaseOrderRef?: string | null;
    lines: InvoiceLineInput[];
  }): SalesDocumentRecord {
    const contact = this.contacts.find((c) => c.id === input.contactId);
    if (!contact) {
      throw new Error('CONTACT_NOT_FOUND: Tiers introuvable.');
    }
    if (contact.kind !== 'customer' && contact.kind !== 'both') {
      throw new Error('CONTACT_NOT_CUSTOMER: Sélectionnez un client pour créer un document de vente.');
    }

    let originalInvoiceNumber: string | null = null;
    if (input.documentType === 'credit_note') {
      const orig = this.invoices.find((i) => i.id === input.originalInvoiceId && i.status === 'issued');
      if (!orig || !orig.number) {
        throw new Error(
          'CREDIT_NOTE_REQUIRES_ISSUED_INVOICE: Un avoir doit cibler une facture déjà émise et numérotée.'
        );
      }
      originalInvoiceNumber = orig.number;
    }

    const calculated = calculateInvoiceTotals({
      documentType: input.documentType,
      isCustomerBusiness: contact.isBusiness,
      customerTaxZone: contact.taxZone,
      customerSiren: contact.siren,
      customerVatIdentifier: contact.vatIdentifier,
      workspaceVatRegime: this.workspace.vatRegime,
      workspaceVatExigibility: this.workspace.vatExigibility,
      originalInvoiceId: input.originalInvoiceId ?? null,
      lines: input.lines,
    });

    const provSeq = this.nextSequence('PROV_DRAFT', 'PROV-', 4);
    const record: SalesDocumentRecord = {
      id: randomUUID(),
      documentType: input.documentType,
      provisionalRef: `(${provSeq.formatted})`,
      number: null,
      status: 'draft',
      paymentStatus: 'unpaid',
      einvoiceStatus: 'not_applicable',
      contactId: contact.id,
      contactLegalName: contact.legalName,
      originalInvoiceId: input.originalInvoiceId ?? null,
      originalInvoiceNumber,
      operationCategory: calculated.operationCategory,
      issueDate: input.issueDate,
      deliveryOrServiceDate: input.deliveryOrServiceDate ?? input.issueDate,
      dueDate: input.dueDate,
      purchaseOrderRef: input.purchaseOrderRef ?? null,
      currency: 'EUR',
      lines: calculated.lines,
      taxBreakdowns: calculated.taxBreakdowns,
      subtotalHtMinor: calculated.subtotalHtMinor,
      vatTotalMinor: calculated.vatTotalMinor,
      totalTtcMinor: calculated.totalTtcMinor,
      depositsDeductedTtcMinor: calculated.depositsDeductedTtcMinor,
      netToPayTtcMinor: calculated.netToPayTtcMinor,
      amountPaidMinor: 0,
      realizedVatByRuleMinor: {},
      latePenaltyRatePercent: calculated.latePenaltyRatePercent,
      recoveryIndemnityMinor: calculated.recoveryIndemnityMinor,
      discountTerms: calculated.discountTerms,
      vatExemptionMention: calculated.vatExemptionMention,
      vatOnDebitsMention: calculated.vatOnDebitsMention,
      facturxXml: null,
      previousDocumentHash: null,
      documentHash: null,
      journalEntryId: null,
      issuedAt: null,
    };

    this.invoices.unshift(record);
    this.appendAudit('DRAFT_CREATED', 'invoice', {
      id: record.id,
      provisionalRef: record.provisionalRef,
      documentType: record.documentType,
      totalTtcMinor: record.totalTtcMinor,
    });
    return record;
  }

  issueSalesDocument(invoiceId: string): SalesDocumentRecord {
    if (this.periodStatus === 'closed') {
      throw new Error('PERIOD_CLOSED: Impossible d’émettre une facture sur un exercice clôturé.');
    }

    const doc = this.invoices.find((i) => i.id === invoiceId);
    if (!doc) {
      throw new Error('INVOICE_NOT_FOUND: Document introuvable.');
    }
    if (doc.status !== 'draft') {
      throw new Error(`INVOICE_ALREADY_ISSUED: Le document ${doc.number ?? doc.provisionalRef} est déjà émis et immuable.`);
    }

    const contact = this.contacts.find((c) => c.id === doc.contactId)!;

    const seqPrefix =
      doc.documentType === 'credit_note'
        ? 'AV-2026-'
        : doc.documentType === 'deposit_invoice'
        ? 'AC-2026-'
        : doc.documentType === 'quote'
        ? 'DEV-2026-'
        : 'FA-2026-';
    const seqKey = `DOC_${doc.documentType.toUpperCase()}_2026`;
    const { formatted: docNumber, lastHash } = this.nextSequence(seqKey, seqPrefix, 5);

    const issuedAt = new Date().toISOString();
    const { previousHash, recordHash } = computeChainedRecordHash(lastHash, {
      workspaceId: this.workspace.id,
      sequenceNumberOrRef: docNumber,
      occurredAtIso: issuedAt,
      entityType: doc.documentType,
      payload: {
        number: docNumber,
        contactId: doc.contactId,
        subtotalHtMinor: doc.subtotalHtMinor,
        vatTotalMinor: doc.vatTotalMinor,
        totalTtcMinor: doc.totalTtcMinor,
      },
    });
    this.updateSequenceHash(seqKey, recordHash);

    const facturxXml = generateFacturxXml({
      invoiceNumber: docNumber,
      issueDateIso: doc.issueDate,
      dueDateIso: doc.dueDate,
      deliveryDateIso: doc.deliveryOrServiceDate,
      currency: doc.currency,
      buyerReference: doc.purchaseOrderRef,
      originalInvoiceNumber: doc.originalInvoiceNumber,
      issuer: {
        legalName: this.workspace.legalName,
        siren: this.workspace.siren,
        siret: this.workspace.siret,
        vatNumber: this.workspace.vatNumber,
        streetLine1: this.workspace.registeredAddress.streetLine1,
        postalCode: this.workspace.registeredAddress.postalCode,
        city: this.workspace.registeredAddress.city,
        countryCode: this.workspace.registeredAddress.countryCode,
      },
      customer: {
        legalName: contact.legalName,
        siren: contact.siren ?? '000000000',
        siret: contact.siret,
        vatNumber: contact.vatIdentifier,
        streetLine1: contact.billingAddress.streetLine1,
        postalCode: contact.billingAddress.postalCode,
        city: contact.billingAddress.city,
        countryCode: contact.billingAddress.countryCode,
      },
      calculated: {
        documentType: doc.documentType,
        operationCategory: doc.operationCategory,
        lines: doc.lines,
        taxBreakdowns: doc.taxBreakdowns,
        subtotalHtMinor: doc.subtotalHtMinor,
        vatTotalMinor: doc.vatTotalMinor,
        totalTtcMinor: doc.totalTtcMinor,
        depositsDeductedTtcMinor: doc.depositsDeductedTtcMinor,
        netToPayTtcMinor: doc.netToPayTtcMinor,
        latePenaltyRatePercent: doc.latePenaltyRatePercent,
        recoveryIndemnityMinor: doc.recoveryIndemnityMinor,
        discountTerms: doc.discountTerms,
        vatExemptionMention: doc.vatExemptionMention,
        vatOnDebitsMention: doc.vatOnDebitsMention,
      },
    });

    doc.number = docNumber;
    doc.status = 'issued';
    doc.einvoiceStatus = 'deposited';
    doc.facturxXml = facturxXml;
    doc.previousDocumentHash = previousHash;
    doc.documentHash = recordHash;
    doc.issuedAt = issuedAt;

    if (doc.documentType !== 'quote') {
      const isCreditNote = doc.documentType === 'credit_note';
      const entryLines: JournalEntryLineInput[] = [];
      const primaryVatRate = doc.taxBreakdowns[0]
        ? `${Number.parseFloat(doc.taxBreakdowns[0].vatRatePercent).toFixed(0)}% (FR)`
        : '0% (Exonéré)';

      entryLines.push({
        accountCode: '411000',
        accountLabel: 'Clients — Ventes de biens ou de prestations de services (Collectif)',
        requiresAuxiliary: true,
        auxiliaryAccountCode: contact.customerAuxiliaryCode ?? '411CLI0001',
        auxiliaryAccountLabel: contact.legalName,
        description: `${isCreditNote ? 'Avoir' : 'Facture'} ${docNumber} — ${contact.legalName}`,
        debitMinor: isCreditNote ? 0 : doc.totalTtcMinor,
        creditMinor: isCreditNote ? doc.totalTtcMinor : 0,
        dueDate: doc.dueDate,
        invoiceNumber: docNumber,
        vatRateLabel: primaryVatRate,
        categoryLabel: 'Ventes B2B SaaS & Conseil',
      });

      for (const line of doc.lines) {
        const revAccount =
          doc.documentType === 'deposit_invoice' ? '419100' : line.accountingAccountCode;
        const revLabel =
          doc.documentType === 'deposit_invoice'
            ? 'Clients — Avances et acomptes reçus sur commandes'
            : line.lineNature === 'goods'
            ? 'Ventes de marchandises'
            : 'Prestations de services';

        entryLines.push({
          accountCode: revAccount,
          accountLabel: revLabel,
          description: `${docNumber} — ${line.description}`,
          debitMinor: isCreditNote ? line.lineSubtotalHtMinor : 0,
          creditMinor: isCreditNote ? 0 : line.lineSubtotalHtMinor,
          dueDate: doc.dueDate,
          invoiceNumber: docNumber,
          vatRateLabel: `${Number.parseFloat(line.vatRatePercent).toFixed(0)}% (FR)`,
          categoryLabel: 'Prestations & Licences',
        });
      }

      for (const tb of doc.taxBreakdowns) {
        if (tb.vatAmountMinor > 0) {
          const usePendingCashVat =
            this.workspace.vatExigibility === 'ENCAISSEMENTS' && doc.operationCategory !== 'goods';
          const vatAccountCode = usePendingCashVat ? '445740' : '445710';
          const vatAccountLabel = usePendingCashVat
            ? 'TVA collectée sur encaissements 20 % — En attente d’encaissement'
            : 'TVA collectée 20 % (exigible)';

          entryLines.push({
            accountCode: vatAccountCode,
            accountLabel: vatAccountLabel,
            description: `TVA ${Number.parseFloat(tb.vatRatePercent).toFixed(1)} % sur ${docNumber}`,
            debitMinor: isCreditNote ? tb.vatAmountMinor : 0,
            creditMinor: isCreditNote ? 0 : tb.vatAmountMinor,
            dueDate: doc.dueDate,
            invoiceNumber: docNumber,
            vatRateLabel: `${Number.parseFloat(tb.vatRatePercent).toFixed(0)}% (FR)`,
            categoryLabel: 'TVA sur ventes',
          });
        }
      }

      const postedEntry = this.postJournalEntryInternal({
        journalCode: 'VE',
        journalLabel: 'Journal des Ventes',
        entryDate: doc.issueDate,
        pieceRef: docNumber,
        pieceDate: doc.issueDate,
        description: `${isCreditNote ? 'Avoir client' : 'Facture client'} ${docNumber}`,
        sourceType: doc.documentType,
        sourceId: doc.id,
        lines: entryLines,
      });

      doc.journalEntryId = postedEntry.id;

      if (isCreditNote && doc.originalInvoiceId) {
        const orig = this.invoices.find((i) => i.id === doc.originalInvoiceId);
        if (orig && doc.totalTtcMinor >= orig.totalTtcMinor) {
          orig.status = 'cancelled_by_credit_note';
        }
      }
    }

    this.appendAudit('DOCUMENT_ISSUED', 'invoice', {
      id: doc.id,
      number: doc.number,
      documentType: doc.documentType,
      totalTtcMinor: doc.totalTtcMinor,
      documentHash: doc.documentHash,
    });

    return doc;
  }

  createAndIssueCreditNote(originalInvoiceId: string): SalesDocumentRecord {
    const orig = this.invoices.find((i) => i.id === originalInvoiceId);
    if (!orig || orig.status !== 'issued' || !orig.number) {
      throw new Error('ORIGINAL_INVOICE_NOT_ISSUED: Seule une facture émise peut faire l’objet d’un avoir.');
    }

    const today = new Date().toISOString().slice(0, 10);
    const creditDraft = this.createDraftInvoice({
      documentType: 'credit_note',
      contactId: orig.contactId,
      originalInvoiceId: orig.id,
      issueDate: today,
      deliveryOrServiceDate: today,
      dueDate: today,
      purchaseOrderRef: orig.purchaseOrderRef,
      lines: orig.lines.map((l) => ({
        description: `Annulation / Avoir sur facture ${orig.number} — ${l.description}`,
        lineNature: l.lineNature,
        quantity: l.quantity,
        unitCode: l.unitCode,
        unitPriceHtMinor: l.unitPriceHtMinor,
        taxRuleCode: l.taxRuleCode,
      })),
    });

    return this.issueSalesDocument(creditDraft.id);
  }

  recordInvoicePayment(input: {
    invoiceId: string;
    paymentDate: string;
    amountMinor: number;
    bankTransactionId?: string;
  }): {
    invoice: SalesDocumentRecord;
    bankEntry: LedgerEntryRecord;
    vatRealizationEntry: LedgerEntryRecord | null;
    letteringCode: string | null;
  } {
    const inv = this.invoices.find((i) => i.id === input.invoiceId);
    if (!inv || inv.status !== 'issued' || !inv.number) {
      throw new Error('PAYMENT_REQUIRES_ISSUED_INVOICE: Le règlement doit porter sur une facture émise.');
    }
    const remaining = inv.netToPayTtcMinor - inv.amountPaidMinor;
    if (input.amountMinor <= 0 || input.amountMinor > remaining) {
      throw new Error(
        `INVALID_PAYMENT_AMOUNT: Le montant du règlement (${input.amountMinor} cts) dépasse le reste à payer (${remaining} cts).`
      );
    }

    const contact = this.contacts.find((c) => c.id === inv.contactId)!;
    const previouslyPaid = inv.amountPaidMinor;
    inv.amountPaidMinor += input.amountMinor;
    inv.paymentStatus = inv.amountPaidMinor === inv.netToPayTtcMinor ? 'paid' : 'partially_paid';
    if (inv.paymentStatus === 'paid') {
      inv.einvoiceStatus = 'cashed';
    }

    let letteringCode: string | null = null;
    if (inv.paymentStatus === 'paid') {
      letteringCode = this.nextLetteringCode();
      const origEntry = this.journalEntries.find((e) => e.id === inv.journalEntryId);
      if (origEntry) {
        for (const line of origEntry.lines) {
          if (line.accountCode === '411000') {
            line.letteringCode = letteringCode;
            line.letteredAt = input.paymentDate;
          }
        }
      }
    }

    const bankEntry = this.postJournalEntryInternal({
      journalCode: 'BQ',
      journalLabel: 'Journal de Banque',
      entryDate: input.paymentDate,
      pieceRef: `REG-${inv.number}`,
      pieceDate: input.paymentDate,
      description: `Règlement client ${contact.legalName} sur ${inv.number}`,
      sourceType: 'payment',
      sourceId: inv.id,
      lines: [
        {
          accountCode: '512100',
          accountLabel: 'Banque — Compte courant principal',
          description: `Encaissement SEPA ${inv.number}`,
          debitMinor: input.amountMinor,
          creditMinor: 0,
          dueDate: inv.dueDate,
          invoiceNumber: inv.number,
          vatRateLabel: 'N/A',
          categoryLabel: 'Encaissement Client',
        },
        {
          accountCode: '411000',
          accountLabel: 'Clients — Ventes de biens ou de prestations de services (Collectif)',
          requiresAuxiliary: true,
          auxiliaryAccountCode: contact.customerAuxiliaryCode ?? '411CLI0001',
          auxiliaryAccountLabel: contact.legalName,
          description: `Règlement facture ${inv.number}`,
          debitMinor: 0,
          creditMinor: input.amountMinor,
          letteringCode,
          letteredAt: letteringCode ? input.paymentDate : null,
          dueDate: inv.dueDate,
          invoiceNumber: inv.number,
          vatRateLabel: '20% (FR)',
          categoryLabel: 'Encaissement Client',
        },
      ],
    });

    let vatRealizationEntry: LedgerEntryRecord | null = null;
    if (this.workspace.vatExigibility === 'ENCAISSEMENTS' && inv.operationCategory !== 'goods') {
      const transfers = calculateCashBasisVatRealization({
        invoiceTotalTtcMinor: inv.totalTtcMinor,
        previouslyPaidTtcMinor: previouslyPaid,
        currentPaymentAllocationTtcMinor: input.amountMinor,
        taxBreakdowns: inv.taxBreakdowns,
        previouslyRealizedVatByRuleMinor: inv.realizedVatByRuleMinor,
      });

      if (transfers.length > 0) {
        const vatLines: JournalEntryLineInput[] = [];
        for (const tr of transfers) {
          inv.realizedVatByRuleMinor[tr.taxRuleCode] =
            (inv.realizedVatByRuleMinor[tr.taxRuleCode] ?? 0) + tr.vatToTransferMinor;

          vatLines.push({
            accountCode: tr.pendingAccountCode,
            accountLabel: 'TVA collectée sur encaissements — En attente',
            description: `Exigibilité TVA sur encaissement ${inv.number}`,
            debitMinor: tr.vatToTransferMinor,
            creditMinor: 0,
            dueDate: inv.dueDate,
            invoiceNumber: inv.number,
            vatRateLabel: '20% (FR)',
            categoryLabel: 'Exigibilité TVA (CA3)',
          });
          vatLines.push({
            accountCode: tr.collectedAccountCode,
            accountLabel: 'TVA collectée exigible (CA3)',
            description: `TVA collectée devenue exigible sur ${inv.number}`,
            debitMinor: 0,
            creditMinor: tr.vatToTransferMinor,
            dueDate: inv.dueDate,
            invoiceNumber: inv.number,
            vatRateLabel: '20% (FR)',
            categoryLabel: 'Exigibilité TVA (CA3)',
          });
        }

        vatRealizationEntry = this.postJournalEntryInternal({
          journalCode: 'OD',
          journalLabel: 'Journal des Opérations Diverses',
          entryDate: input.paymentDate,
          pieceRef: `TVA-${inv.number}`,
          pieceDate: input.paymentDate,
          description: `Transfert TVA sur encaissement ${inv.number} (44574 -> 44571)`,
          sourceType: 'vat_transfer',
          sourceId: inv.id,
          lines: vatLines,
        });
      }
    }

    if (input.bankTransactionId) {
      const tx = this.bankTransactions.find((t) => t.id === input.bankTransactionId);
      if (tx) {
        tx.reconciledAllocations.push({
          id: randomUUID(),
          documentId: inv.id,
          documentKind: 'invoice',
          documentNumber: inv.number,
          thirdPartyName: inv.contactLegalName,
          allocatedAmountMinor: input.amountMinor,
          reconciledAt: input.paymentDate,
          letteringCode,
        });
        const totalAllocated = tx.reconciledAllocations.reduce(
          (sum, a) => sum + a.allocatedAmountMinor,
          0
        );
        if (totalAllocated >= Math.abs(tx.amountMinor)) {
          tx.status = 'matched';
          tx.workflowStatus = 'rapprochee';
        }
        tx.matchedDocumentId = inv.id;
        tx.matchedDocumentNumber = inv.number;
        tx.letteringCode = letteringCode;
      }
    }

    this.appendAudit('PAYMENT_RECORDED_AND_LETTERED', 'payment', {
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      amountMinor: input.amountMinor,
      letteringCode,
      vatRealizedEntryId: vatRealizationEntry?.id ?? null,
    });

    return {
      invoice: inv,
      bankEntry,
      vatRealizationEntry,
      letteringCode,
    };
  }

  /**
   * Reconciles a single bank transaction (e.g. a grouped SEPA transfer `-500,00 €` or batch inflow)
   * against one or multiple invoices/expenses (`Traitement des virements et prélèvements groupés` — Image 1).
   */
  reconcileBankTransactionGroup(input: {
    transactionId: string;
    allocations: Array<{
      documentId: string;
      documentKind: 'invoice' | 'expense';
      amountMinor: number;
    }>;
  }): BankTransactionRecord {
    const tx = this.bankTransactions.find((t) => t.id === input.transactionId);
    if (!tx) {
      throw new Error('BANK_TX_NOT_FOUND: Transaction bancaire introuvable.');
    }
    if (!input.allocations || input.allocations.length === 0) {
      throw new Error('EMPTY_ALLOCATIONS: Sélectionnez au moins une facture ou un achat à rapprocher.');
    }

    for (const alloc of input.allocations) {
      if (alloc.amountMinor <= 0) continue;

      if (alloc.documentKind === 'invoice') {
        this.recordInvoicePayment({
          invoiceId: alloc.documentId,
          paymentDate: tx.transactionDate,
          amountMinor: alloc.amountMinor,
          bankTransactionId: tx.id,
        });
      } else {
        const exp = this.expenses.find((e) => e.id === alloc.documentId);
        if (!exp) {
          throw new Error('EXPENSE_NOT_FOUND: Facture fournisseur introuvable.');
        }
        const supplier = this.contacts.find((c) => c.id === exp.supplierContactId);
        const letCode = this.nextLetteringCode();

        // Letter original 401000 line if full amount is covered
        if (alloc.amountMinor >= exp.amountTtcMinor && exp.journalEntryId) {
          const origEntry = this.journalEntries.find((e) => e.id === exp.journalEntryId);
          if (origEntry) {
            for (const line of origEntry.lines) {
              if (line.accountCode === '401000') {
                line.letteringCode = letCode;
                line.letteredAt = tx.transactionDate;
              }
            }
          }
        }

        this.postJournalEntryInternal({
          journalCode: 'BQ',
          journalLabel: 'Journal de Banque',
          entryDate: tx.transactionDate,
          pieceRef: `DEC-${exp.supplierInvoiceRef}`,
          pieceDate: tx.transactionDate,
          description: `Règlement fournisseur ${exp.supplierName} — ${exp.supplierInvoiceRef}`,
          sourceType: 'expense_payment',
          sourceId: exp.id,
          lines: [
            {
              accountCode: '401000',
              accountLabel: 'Fournisseurs — Achats de biens et prestations de services (Collectif)',
              requiresAuxiliary: true,
              auxiliaryAccountCode: supplier?.supplierAuxiliaryCode ?? '401FOU0001',
              auxiliaryAccountLabel: exp.supplierName,
              description: `Apurement facture fournisseur ${exp.supplierInvoiceRef}`,
              debitMinor: alloc.amountMinor,
              creditMinor: 0,
              letteringCode: alloc.amountMinor >= exp.amountTtcMinor ? letCode : null,
              letteredAt: alloc.amountMinor >= exp.amountTtcMinor ? tx.transactionDate : null,
              dueDate: exp.dueDate,
              invoiceNumber: exp.supplierInvoiceRef,
              vatRateLabel: exp.taxRuleCode === 'FR_TVA_20' ? '20% (FR)' : '0%',
              categoryLabel: exp.categoryLabel,
            },
            {
              accountCode: '512100',
              accountLabel: 'Banque — Compte courant principal',
              description: `Décaissement SEPA ${exp.supplierInvoiceRef}`,
              debitMinor: 0,
              creditMinor: alloc.amountMinor,
              dueDate: exp.dueDate,
              invoiceNumber: exp.supplierInvoiceRef,
              vatRateLabel: 'N/A',
              categoryLabel: exp.categoryLabel,
            },
          ],
        });

        exp.status = 'reconciled';
        exp.inboxState = 'paid';
        exp.paymentState = 'paid';
        exp.reconciledTransactionId = tx.id;

        tx.reconciledAllocations.push({
          id: randomUUID(),
          documentId: exp.id,
          documentKind: 'expense',
          documentNumber: exp.supplierInvoiceRef,
          thirdPartyName: exp.supplierName,
          allocatedAmountMinor: alloc.amountMinor,
          reconciledAt: tx.transactionDate,
          letteringCode: letCode,
        });
        tx.matchedDocumentId = exp.id;
        tx.matchedDocumentNumber = exp.supplierInvoiceRef;
        tx.letteringCode = letCode;
      }
    }

    const totalAllocated = tx.reconciledAllocations.reduce(
      (sum, a) => sum + a.allocatedAmountMinor,
      0
    );
    if (totalAllocated >= Math.abs(tx.amountMinor)) {
      tx.status = 'matched';
      tx.workflowStatus = 'rapprochee';
    }

    this.appendAudit('BANK_GROUP_RECONCILED', 'banking', {
      transactionId: tx.id,
      allocationsCount: input.allocations.length,
      totalAllocatedMinor: totalAllocated,
    });

    return tx;
  }

  updateBankTransactionStatus(
    transactionId: string,
    workflowStatus: BankTransactionRecord['workflowStatus'],
    commentText?: string
  ): BankTransactionRecord {
    const tx = this.bankTransactions.find((t) => t.id === transactionId);
    if (!tx) {
      throw new Error('BANK_TX_NOT_FOUND: Transaction introuvable.');
    }
    tx.workflowStatus = workflowStatus;
    if (workflowStatus === 'rapprochee') {
      tx.status = 'matched';
    }
    if (commentText && commentText.trim().length > 0) {
      tx.comments.push({
        id: randomUUID(),
        author: 'Expert-Comptable Haxatax',
        createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        text: commentText.trim(),
      });
    }
    this.appendAudit('BANK_TX_STATUS_UPDATED', 'banking', {
      transactionId: tx.id,
      workflowStatus,
    });
    return tx;
  }

  /**
   * Automatic Auxiliary Account Lettering (`⚡ Lettrer auto.` button in Grand Livre — Image 2).
   * Scans all unlettered 411000 & 401000 lines grouped by `auxiliaryAccountCode` (`CompAuxNum`)
   * and letters matching Debit/Credit pairs or balanced groups.
   */
  autoLetterAuxiliaryAccounts(): {
    groupsLettered: number;
    linesLettered: number;
    assignedCodes: string[];
  } {
    const today = new Date().toISOString().slice(0, 10);
    const unletteredByAux = new Map<string, JournalEntryLineInput[]>();

    for (const entry of this.journalEntries) {
      for (const line of entry.lines) {
        if (
          (line.accountCode === '411000' || line.accountCode === '401000') &&
          line.auxiliaryAccountCode &&
          !line.letteringCode
        ) {
          const list = unletteredByAux.get(line.auxiliaryAccountCode) ?? [];
          list.push(line);
          unletteredByAux.set(line.auxiliaryAccountCode, list);
        }
      }
    }

    let groupsLettered = 0;
    let linesLettered = 0;
    const assignedCodes: string[] = [];

    for (const [, lines] of unletteredByAux.entries()) {
      const debits = lines.filter((l) => l.debitMinor > 0 && !l.letteringCode);
      const credits = lines.filter((l) => l.creditMinor > 0 && !l.letteringCode);

      // 1. Exact pair matching first
      for (const d of debits) {
        if (d.letteringCode) continue;
        const matchingCredit = credits.find(
          (c) => !c.letteringCode && c.creditMinor === d.debitMinor
        );
        if (matchingCredit) {
          const code = this.nextLetteringCode();
          validateAuxiliaryLetteringGroup(code, [d, matchingCredit]);
          d.letteringCode = code;
          d.letteredAt = today;
          matchingCredit.letteringCode = code;
          matchingCredit.letteredAt = today;
          groupsLettered += 1;
          linesLettered += 2;
          assignedCodes.push(code);
        }
      }

      // 2. Full auxiliary balance equilibrium check for remaining unlettered lines
      const rem = lines.filter((l) => !l.letteringCode);
      if (rem.length >= 2) {
        const sumD = rem.reduce((s, l) => s + l.debitMinor, 0);
        const sumC = rem.reduce((s, l) => s + l.creditMinor, 0);
        if (sumD > 0 && sumD === sumC) {
          const code = this.nextLetteringCode();
          validateAuxiliaryLetteringGroup(code, rem);
          for (const l of rem) {
            l.letteringCode = code;
            l.letteredAt = today;
          }
          groupsLettered += 1;
          linesLettered += rem.length;
          assignedCodes.push(code);
        }
      }
    }

    this.appendAudit('AUTO_LETTERING_EXECUTED', 'accounting', {
      groupsLettered,
      linesLettered,
      assignedCodes,
    });

    return { groupsLettered, linesLettered, assignedCodes };
  }

  /**
   * Creates a manual double-entry journal entry (`+ Nouvelle écriture` in Grand Livre — Image 2).
   */
  createManualJournalEntry(input: {
    journalCode: 'OD' | 'VE' | 'AC' | 'BQ';
    entryDate: string;
    pieceRef: string;
    description: string;
    dueDate?: string;
    invoiceNumber?: string;
    lines: Array<{
      accountCode: string;
      accountLabel: string;
      auxiliaryAccountCode?: string | null;
      auxiliaryAccountLabel?: string | null;
      description: string;
      debitMinor: number;
      creditMinor: number;
      vatRateLabel?: string;
      categoryLabel?: string;
    }>;
  }): LedgerEntryRecord {
    const journalLabels: Record<string, string> = {
      OD: 'Journal des Opérations Diverses',
      VE: 'Journal des Ventes',
      AC: 'Journal des Achats',
      BQ: 'Journal de Banque',
    };

    const entry = this.postJournalEntryInternal({
      journalCode: input.journalCode,
      journalLabel: journalLabels[input.journalCode] ?? 'Journal Comptable',
      entryDate: input.entryDate,
      pieceRef: input.pieceRef,
      pieceDate: input.entryDate,
      description: input.description,
      sourceType: 'manual_entry',
      sourceId: null,
      lines: input.lines.map((l) => ({
        accountCode: l.accountCode,
        accountLabel: l.accountLabel,
        requiresAuxiliary: l.accountCode === '411000' || l.accountCode === '401000',
        auxiliaryAccountCode: l.auxiliaryAccountCode ?? null,
        auxiliaryAccountLabel: l.auxiliaryAccountLabel ?? null,
        description: l.description,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
        dueDate: input.dueDate ?? input.entryDate,
        invoiceNumber: input.invoiceNumber ?? input.pieceRef,
        vatRateLabel: l.vatRateLabel ?? 'N/A',
        categoryLabel: l.categoryLabel ?? 'Opération Diverse',
      })),
    });

    this.appendAudit('MANUAL_ENTRY_POSTED', 'accounting', {
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      pieceRef: entry.pieceRef,
    });

    return entry;
  }

  getExpenses(): ExpenseRecord[] {
    return this.expenses;
  }

  createExpense(input: {
    supplierContactId: string;
    supplierInvoiceRef: string;
    expenseDate: string;
    dueDate?: string;
    description: string;
    accountingAccountCode: string;
    taxRuleCode: string;
    deductibilityRatio?: string;
    amountHtMinor: number;
    currency?: 'EUR' | 'USD';
    foreignAmountTtcMinor?: number | null;
    status?: 'needs_review' | 'approved' | 'paid' | 'reconciled';
    inboxState?: 'inbox' | 'to_pay' | 'paid';
    paymentState?: 'to_pay' | 'paid';
    source?: 'Factur-X PDP' | 'OCR IA UE' | 'OCR locale' | 'Import manuel' | 'Email' | 'GoogleDrive';
    pagesCount?: number;
    categoryLabel?: string;
  }): ExpenseRecord {
    const supplier = this.contacts.find((c) => c.id === input.supplierContactId);
    if (!supplier) {
      throw new Error('SUPPLIER_NOT_FOUND: Fournisseur introuvable.');
    }
    if (supplier.kind !== 'supplier' && supplier.kind !== 'both') {
      throw new Error('CONTACT_NOT_SUPPLIER: Sélectionnez un fournisseur pour créer une dépense.');
    }

    const calc = calculateExpenseLineVat({
      amountHtMinor: input.amountHtMinor,
      taxRuleCode: input.taxRuleCode,
      deductibilityRatio: input.deductibilityRatio ?? '1.00',
    });

    const resolvedDueDate = input.dueDate ?? input.expenseDate;
    const resolvedCategory = input.categoryLabel ?? 'Achats & Frais généraux';
    const isForeign = input.currency === 'USD' && input.foreignAmountTtcMinor != null;
    const vatLabel =
      input.taxRuleCode === 'FR_TVA_20'
        ? '20% (FR)'
        : input.taxRuleCode === 'FR_TVA_10'
        ? '10% (FR)'
        : '0% (Exonéré/UE)';

    const lines: JournalEntryLineInput[] = [
      {
        accountCode: input.accountingAccountCode,
        accountLabel: 'Charge d’exploitation (PCG 2025)',
        description: `${input.supplierInvoiceRef} — ${input.description}`,
        debitMinor: calc.accountingExpenseChargeMinor,
        creditMinor: 0,
        currencyCode: isForeign ? 'USD' : 'EUR',
        amountCurrencyMinor: isForeign ? input.foreignAmountTtcMinor : null,
        dueDate: resolvedDueDate,
        invoiceNumber: input.supplierInvoiceRef,
        vatRateLabel: vatLabel,
        categoryLabel: resolvedCategory,
      },
    ];

    if (calc.vatDeductibleMinor > 0) {
      lines.push({
        accountCode: '445660',
        accountLabel: 'TVA déductible sur autres biens et services',
        description: `TVA déductible (${Number.parseFloat(input.deductibilityRatio ?? '1') * 100}%) ${input.supplierInvoiceRef}`,
        debitMinor: calc.vatDeductibleMinor,
        creditMinor: 0,
        dueDate: resolvedDueDate,
        invoiceNumber: input.supplierInvoiceRef,
        vatRateLabel: vatLabel,
        categoryLabel: resolvedCategory,
      });
    }

    lines.push({
      accountCode: '401000',
      accountLabel: 'Fournisseurs — Achats de biens et prestations de services (Collectif)',
      requiresAuxiliary: true,
      auxiliaryAccountCode: supplier.supplierAuxiliaryCode ?? '401FOU0001',
      auxiliaryAccountLabel: supplier.legalName,
      description: `Facture fournisseur ${input.supplierInvoiceRef}`,
      debitMinor: 0,
      creditMinor: calc.amountTtcMinor,
      currencyCode: isForeign ? 'USD' : 'EUR',
      amountCurrencyMinor: isForeign ? input.foreignAmountTtcMinor : null,
      dueDate: resolvedDueDate,
      invoiceNumber: input.supplierInvoiceRef,
      vatRateLabel: vatLabel,
      categoryLabel: resolvedCategory,
    });

    const entry = this.postJournalEntryInternal({
      journalCode: 'AC',
      journalLabel: 'Journal des Achats',
      entryDate: input.expenseDate,
      pieceRef: input.supplierInvoiceRef,
      pieceDate: input.expenseDate,
      description: `Achat ${supplier.legalName} — ${input.supplierInvoiceRef}`,
      sourceType: 'expense',
      sourceId: null,
      lines,
    });

    const expense: ExpenseRecord = {
      id: randomUUID(),
      supplierContactId: supplier.id,
      supplierName: supplier.legalName,
      supplierInvoiceRef: input.supplierInvoiceRef,
      expenseDate: input.expenseDate,
      dueDate: resolvedDueDate,
      description: input.description,
      accountingAccountCode: input.accountingAccountCode,
      taxRuleCode: input.taxRuleCode,
      deductibilityRatio: input.deductibilityRatio ?? '1.00',
      amountHtMinor: calc.amountHtMinor,
      vatTotalMinor: calc.vatTotalMinor,
      vatDeductibleMinor: calc.vatDeductibleMinor,
      vatNonDeductibleMinor: calc.vatNonDeductibleMinor,
      amountTtcMinor: calc.amountTtcMinor,
      currency: input.currency ?? 'EUR',
      foreignAmountTtcMinor: input.foreignAmountTtcMinor ?? null,
      status: input.status ?? 'approved',
      inboxState: input.inboxState ?? 'to_pay',
      paymentState: input.paymentState ?? 'to_pay',
      source: input.source ?? 'Factur-X PDP',
      journalEntryId: entry.id,
      reconciledTransactionId: null,
      rejectedTransactionIds: [],
      pagesCount: input.pagesCount ?? 1,
      categoryLabel: resolvedCategory,
    };

    this.expenses.unshift(expense);
    this.appendAudit('EXPENSE_APPROVED_AND_VENTILATED', 'expense', {
      id: expense.id,
      supplierInvoiceRef: expense.supplierInvoiceRef,
      amountTtcMinor: expense.amountTtcMinor,
      vatDeductibleMinor: expense.vatDeductibleMinor,
    });
    return expense;
  }

  /**
   * Updates `Cette facture est... (À payer | Payée)` in Achats Boîte de réception (Image 3).
   */
  updateExpensePaymentState(
    expenseId: string,
    paymentState: 'to_pay' | 'paid'
  ): ExpenseRecord {
    const exp = this.expenses.find((e) => e.id === expenseId);
    if (!exp) {
      throw new Error('EXPENSE_NOT_FOUND: Facture d’achat introuvable.');
    }
    exp.paymentState = paymentState;
    exp.inboxState = paymentState === 'paid' ? 'paid' : 'to_pay';
    exp.status = paymentState === 'paid' ? 'paid' : 'approved';
    this.appendAudit('EXPENSE_STATE_UPDATED', 'expense', {
      expenseId: exp.id,
      paymentState,
      inboxState: exp.inboxState,
    });
    return exp;
  }

  /**
   * Confirms or rejects a suggested bank transaction on a supplier invoice in `Achats` (`✨ 3 suggestions de transaction` — Image 3).
   */
  handleExpenseTransactionSuggestion(input: {
    expenseId: string;
    transactionId: string;
    action: 'confirm' | 'reject';
  }): ExpenseRecord {
    const exp = this.expenses.find((e) => e.id === input.expenseId);
    if (!exp) {
      throw new Error('EXPENSE_NOT_FOUND: Facture d’achat introuvable.');
    }
    if (input.action === 'reject') {
      if (!exp.rejectedTransactionIds.includes(input.transactionId)) {
        exp.rejectedTransactionIds.push(input.transactionId);
      }
      return exp;
    }

    const tx = this.bankTransactions.find((t) => t.id === input.transactionId);
    if (!tx) {
      throw new Error('BANK_TX_NOT_FOUND: Transaction bancaire introuvable.');
    }

    this.reconcileBankTransactionGroup({
      transactionId: tx.id,
      allocations: [
        {
          documentId: exp.id,
          documentKind: 'expense',
          amountMinor: exp.amountTtcMinor,
        },
      ],
    });

    return exp;
  }

  private postJournalEntryInternal(input: {
    journalCode: string;
    journalLabel: string;
    entryDate: string;
    pieceRef: string;
    pieceDate: string;
    description: string;
    sourceType: string;
    sourceId: string | null;
    lines: JournalEntryLineInput[];
  }): LedgerEntryRecord {
    const seqKey = `JOURNAL_${input.journalCode}_2026`;
    const { formatted: entryNumber, lastHash } = this.nextSequence(
      seqKey,
      `${input.journalCode}-2026-`,
      5
    );

    const candidate: JournalEntryInput = {
      journalCode: input.journalCode,
      journalLabel: input.journalLabel,
      entryNumber,
      entryDate: input.entryDate,
      pieceRef: input.pieceRef,
      pieceDate: input.pieceDate,
      validatedAt: input.entryDate,
      periodStatus: this.periodStatus,
      lines: input.lines,
    };

    const { totalDebitMinor, totalCreditMinor } = validateJournalEntryForPosting(candidate);
    const { previousHash, recordHash } = computeChainedRecordHash(lastHash, {
      workspaceId: this.workspace.id,
      sequenceNumberOrRef: entryNumber,
      occurredAtIso: new Date().toISOString(),
      entityType: 'journal_entry',
      payload: {
        entryNumber,
        journalCode: input.journalCode,
        pieceRef: input.pieceRef,
        totalDebitMinor,
        totalCreditMinor,
      },
    });
    this.updateSequenceHash(seqKey, recordHash);

    const record: LedgerEntryRecord = {
      ...candidate,
      id: randomUUID(),
      status: 'posted',
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      previousEntryHash: previousHash,
      entryHash: recordHash,
    };

    this.journalEntries.push(record);
    return record;
  }

  getJournalEntries(): LedgerEntryRecord[] {
    return this.journalEntries;
  }

  addBankTransactionsImport(
    transactions: Array<{
      transactionDate: string;
      description: string;
      amountSignedMinor: number;
      counterpartyName?: string;
      sourceRef?: string;
    }>,
    sourceLabel: string,
    bankAccountName?: string
  ): BankTransactionRecord[] {
    const created: BankTransactionRecord[] = [];
    for (const tx of transactions) {
      const record: BankTransactionRecord = {
        id: randomUUID(),
        transactionDate: tx.transactionDate,
        description: tx.description,
        counterpartyName: tx.counterpartyName ?? '',
        bankName: bankAccountName ?? 'Import',
        bankAccountCode: '512000',
        sourceLabel,
        amountMinor: tx.amountSignedMinor,
        status: 'unmatched',
        workflowStatus: 'a_traiter',
        matchedDocumentId: null,
        matchedDocumentNumber: null,
        letteringCode: null,
        reconciledAllocations: [],
        comments: [],
        ruleName: null,
      };
      this.bankTransactions.push(record);
      created.push(record);
    }
    return created;
  }

  getBankTransactions(): BankTransactionRecord[] {
    return this.bankTransactions;
  }

  getVatSummary() {
    let collectedExigibleMinor = 0;
    let collectedPendingCashMinor = 0;
    let deductiblePurchasesMinor = 0;

    for (const entry of this.journalEntries) {
      for (const line of entry.lines) {
        if (line.accountCode.startsWith('44571')) {
          collectedExigibleMinor += line.creditMinor - line.debitMinor;
        } else if (line.accountCode.startsWith('44574')) {
          collectedPendingCashMinor += line.creditMinor - line.debitMinor;
        } else if (line.accountCode.startsWith('44566')) {
          deductiblePurchasesMinor += line.debitMinor - line.creditMinor;
        }
      }
    }

    const netVatPayableMinor = Math.max(0, collectedExigibleMinor - deductiblePurchasesMinor);
    const vatCreditMinor = Math.max(0, deductiblePurchasesMinor - collectedExigibleMinor);

    return {
      vatExigibilityMode: this.workspace.vatExigibility,
      vatRegime: this.workspace.vatRegime,
      collectedExigibleMinor,
      collectedPendingCashMinor,
      deductiblePurchasesMinor,
      netVatPayableMinor,
      vatCreditMinor,
    };
  }

  exportFec() {
    return generateStatutoryFec(this.workspace.siren, '2026-12-31', this.journalEntries);
  }

  getAuditVerification() {
    return {
      verification: verifyHashChain(this.auditChain),
      events: this.auditChain.slice().reverse(),
    };
  }
}

export const workspaceStore = new HaxataxWorkspaceEngine();
