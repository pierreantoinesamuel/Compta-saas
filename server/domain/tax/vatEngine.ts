/**
 * Authoritative French (DGFiP / CGI) & European (EN 16931 / Factur-X)
 * Monetary & VAT Calculation Engine.
 *
 * Enforces:
 * 1. Zero binary floating-point arithmetic: uses Decimal.js with ROUND_HALF_UP.
 * 2. EN 16931 Rate-Level VAT Rounding:
 *    - Each line net HT is computed and rounded to the nearest cent (ROUND_HALF_UP).
 *    - Lines are grouped by VAT rule / rate into `taxBreakdowns`.
 *    - VAT is calculated and rounded ONCE per VAT rate on the sum of net bases for that rate:
 *        VATAmount_r = ROUND_HALF_UP(SumBaseHT_r * Rate_r / 100)
 * 3. Deposit Invoice (Facture d'acompte) deductions on final settlement invoices.
 * 4. Mandatory French B2B Mentions (€40 recovery indemnity, late penalty rate, exemption mentions).
 * 5. Cash-Basis VAT Exigibility (TVA sur les encaissements - 44574 -> 44571) exact pro-rata allocation.
 * 6. Multi-rate Expense VAT split with partial deductibility ratio (e.g. 80% vehicle fuel).
 */

import Decimal from 'decimal.js';
import { OFFICIAL_FR_EU_TAX_RULES, type TaxRuleTemplate } from '../../../db/seeds/pcg2025/pcg2025_catalog.js';

// Configure Decimal for high-precision financial calculations with commercial half-up rounding
const FinancialDecimal = Decimal.clone({
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
});

export type SalesDocumentType = 'quote' | 'deposit_invoice' | 'standard_invoice' | 'credit_note';
export type OperationCategory = 'goods' | 'services' | 'mixed';

export interface InvoiceLineInput {
  description: string;
  lineNature: 'goods' | 'services';
  quantity: string | number; // e.g. "2.5"
  unitCode?: string; // UN/ECE Rec 20 default 'C62'
  unitPriceHtMinor: number; // integer cents e.g. 12500 = 125.00 EUR
  discountPercent?: string | number; // 0 to 100
  discountAmountHtMinor?: number; // integer cents
  taxRuleCode: string; // e.g. 'FR_TVA_20', 'FR_FRANCHISE_293B', 'EU_B2B_SERVICES_REVERSE_CHARGE'
  accountingAccountCode?: string;
}

export interface AppliedDepositInput {
  depositInvoiceId: string;
  depositNumber: string;
  appliedHtMinor: number;
  appliedVatMinor: number;
  appliedTtcMinor: number;
}

export interface CalculateInvoiceInput {
  documentType: SalesDocumentType;
  isCustomerBusiness: boolean; // B2B vs B2C
  customerTaxZone: 'DOMESTIC_FR' | 'DOM_TOM' | 'INTRA_EU' | 'EXPORT_NON_EU';
  customerSiren?: string | null;
  customerVatIdentifier?: string | null;
  workspaceVatRegime: 'FRANCHISE_293B' | 'REEL_SIMPLIFIE' | 'REEL_NORMAL' | 'MINI_REEL';
  workspaceVatExigibility: 'DEBITS' | 'ENCAISSEMENTS';
  lines: InvoiceLineInput[];
  appliedDeposits?: AppliedDepositInput[];
  latePenaltyRatePercent?: string;
  discountTerms?: string;
  originalInvoiceId?: string | null;
}

export interface CalculatedInvoiceLine {
  position: number;
  description: string;
  lineNature: 'goods' | 'services';
  quantity: string;
  unitCode: string;
  unitPriceHtMinor: number;
  discountPercent: string;
  discountAmountHtMinor: number;
  taxRuleCode: string;
  vatRatePercent: string;
  vatCategoryCode: 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G';
  exemptionReasonCode: string | null;
  accountingAccountCode: string;
  lineSubtotalHtMinor: number;
  lineVatPreviewMinor: number;
  lineTotalTtcPreviewMinor: number;
}

export interface CalculatedTaxBreakdown {
  taxRuleCode: string;
  vatCategoryCode: 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G';
  vatRatePercent: string;
  taxableBaseHtMinor: number;
  vatAmountMinor: number;
  exemptionReasonCode: string | null;
  exemptionReasonText: string | null;
}

export interface CalculatedInvoiceResult {
  documentType: SalesDocumentType;
  operationCategory: OperationCategory;
  lines: CalculatedInvoiceLine[];
  taxBreakdowns: CalculatedTaxBreakdown[];
  subtotalHtMinor: number;
  vatTotalMinor: number;
  totalTtcMinor: number;
  depositsDeductedTtcMinor: number;
  netToPayTtcMinor: number;
  latePenaltyRatePercent: string;
  recoveryIndemnityMinor: number;
  discountTerms: string;
  vatExemptionMention: string | null;
  vatOnDebitsMention: boolean;
}

const TAX_RULES_BY_CODE = new Map<string, TaxRuleTemplate>(
  OFFICIAL_FR_EU_TAX_RULES.map((rule) => [rule.ruleCode, rule])
);

export function getTaxRuleOrThrow(ruleCode: string): TaxRuleTemplate {
  const rule = TAX_RULES_BY_CODE.get(ruleCode);
  if (!rule) {
    throw new Error(`UNKNOWN_TAX_RULE: Code de règle TVA inconnu (${ruleCode}).`);
  }
  return rule;
}

/**
 * Rounds a Decimal value to integer minor units (cents) using commercial ROUND_HALF_UP.
 */
export function roundToMinorUnits(amountMinorDecimal: Decimal): number {
  return amountMinorDecimal.toDecimalPlaces(0, FinancialDecimal.ROUND_HALF_UP).toNumber();
}

/**
 * Authoritative EN 16931 / DGFiP Invoice Calculation.
 */
export function calculateInvoiceTotals(input: CalculateInvoiceInput): CalculatedInvoiceResult {
  if (!input.lines || input.lines.length === 0) {
    throw new Error('INVOICE_EMPTY_LINES: Un document de vente doit comporter au moins une ligne.');
  }

  if (input.documentType === 'credit_note' && !input.originalInvoiceId) {
    throw new Error(
      'CREDIT_NOTE_MISSING_ORIGINAL_INVOICE: Une facture d’avoir doit obligatoirement référencer la facture d’origine.'
    );
  }

  if (input.isCustomerBusiness && input.customerTaxZone === 'DOMESTIC_FR') {
    if (!input.customerSiren || !/^[0-9]{9}$/.test(input.customerSiren.replace(/[\s.-]/g, ''))) {
      throw new Error(
        'B2B_FR_MISSING_SIREN: Le numéro SIREN du client professionnel français est obligatoire (Réforme Facturation Électronique / Art. 242 nonies A CGI).'
      );
    }
  }

  let hasGoods = false;
  let hasServices = false;

  const calculatedLines: CalculatedInvoiceLine[] = [];
  const breakdownAccumulator = new Map<
    string,
    {
      rule: TaxRuleTemplate;
      taxableBaseHtMinor: number;
    }
  >();

  for (let idx = 0; idx < input.lines.length; idx++) {
    const rawLine = input.lines[idx]!;
    const rule = getTaxRuleOrThrow(rawLine.taxRuleCode);

    // Enforce Franchise en base consistency
    if (input.workspaceVatRegime === 'FRANCHISE_293B' && rule.ruleCode !== 'FR_FRANCHISE_293B') {
      throw new Error(
        `FRANCHISE_VAT_VIOLATION: En franchise en base de TVA (Art. 293 B CGI), seule la règle FR_FRANCHISE_293B (0 %) est autorisée (reçu : ${rule.ruleCode}).`
      );
    }

    // Enforce Intra-EU Reverse Charge VAT ID requirement
    if (
      (rule.ruleCode === 'EU_B2B_SERVICES_REVERSE_CHARGE' || rule.ruleCode === 'EU_B2B_GOODS_EXEMPT') &&
      (!input.customerVatIdentifier || input.customerVatIdentifier.trim().length < 4)
    ) {
      throw new Error(
        'EU_REVERSE_CHARGE_MISSING_VAT_ID: Le numéro de TVA intracommunautaire du client UE est obligatoire pour appliquer l’autoliquidation ou l’exonération intracommunautaire.'
      );
    }

    const qty = new FinancialDecimal(rawLine.quantity);
    if (qty.lte(0)) {
      throw new Error(`INVALID_LINE_QUANTITY: La quantité de la ligne ${idx + 1} doit être strictement positive.`);
    }

    if (!Number.isInteger(rawLine.unitPriceHtMinor) || rawLine.unitPriceHtMinor < 0) {
      throw new Error(
        `INVALID_LINE_UNIT_PRICE: Le prix unitaire HT en centimes de la ligne ${idx + 1} doit être un entier positif ou nul.`
      );
    }

    const unitPriceMinor = new FinancialDecimal(rawLine.unitPriceHtMinor);
    const discountPercent = new FinancialDecimal(rawLine.discountPercent ?? 0);
    if (discountPercent.lt(0) || discountPercent.gt(100)) {
      throw new Error(`INVALID_LINE_DISCOUNT_PERCENT: La remise en % de la ligne ${idx + 1} doit être entre 0 et 100.`);
    }

    const discountAmountHtMinor = rawLine.discountAmountHtMinor ?? 0;
    if (!Number.isInteger(discountAmountHtMinor) || discountAmountHtMinor < 0) {
      throw new Error(`INVALID_LINE_DISCOUNT_AMOUNT: La remise en centimes de la ligne ${idx + 1} est invalide.`);
    }

    const grossLineMinor = qty.mul(unitPriceMinor);
    const afterPercentMinor = grossLineMinor.mul(
      new FinancialDecimal(1).minus(discountPercent.div(100))
    );
    const netLineMinorDecimal = afterPercentMinor.minus(discountAmountHtMinor);
    const lineSubtotalHtMinor = roundToMinorUnits(netLineMinorDecimal);

    if (lineSubtotalHtMinor < 0) {
      throw new Error(`NEGATIVE_LINE_SUBTOTAL: Le total net HT de la ligne ${idx + 1} ne peut pas être négatif.`);
    }

    const vatRate = new FinancialDecimal(rule.ratePercent);
    const lineVatPreviewMinor = roundToMinorUnits(
      new FinancialDecimal(lineSubtotalHtMinor).mul(vatRate).div(100)
    );
    const lineTotalTtcPreviewMinor = lineSubtotalHtMinor + lineVatPreviewMinor;

    if (rawLine.lineNature === 'goods') {
      hasGoods = true;
    } else {
      hasServices = true;
    }

    const defaultAccountCode = rawLine.lineNature === 'goods' ? '707000' : '706000';

    calculatedLines.push({
      position: idx + 1,
      description: rawLine.description.trim(),
      lineNature: rawLine.lineNature,
      quantity: qty.toFixed(4),
      unitCode: rawLine.unitCode ?? 'C62',
      unitPriceHtMinor: rawLine.unitPriceHtMinor,
      discountPercent: discountPercent.toFixed(3),
      discountAmountHtMinor,
      taxRuleCode: rule.ruleCode,
      vatRatePercent: rule.ratePercent,
      vatCategoryCode: rule.vatCategoryCode,
      exemptionReasonCode: rule.exemptionReasonCode,
      accountingAccountCode: rawLine.accountingAccountCode ?? defaultAccountCode,
      lineSubtotalHtMinor,
      lineVatPreviewMinor,
      lineTotalTtcPreviewMinor,
    });

    const existingGroup = breakdownAccumulator.get(rule.ruleCode);
    if (existingGroup) {
      existingGroup.taxableBaseHtMinor += lineSubtotalHtMinor;
    } else {
      breakdownAccumulator.set(rule.ruleCode, {
        rule,
        taxableBaseHtMinor: lineSubtotalHtMinor,
      });
    }
  }

  // EN 16931 Rate-Level VAT Breakdown Calculation (Round ONCE per tax rate/rule)
  const taxBreakdowns: CalculatedTaxBreakdown[] = [];
  let subtotalHtMinor = 0;
  let vatTotalMinor = 0;
  const exemptionMentions = new Set<string>();

  for (const { rule, taxableBaseHtMinor } of breakdownAccumulator.values()) {
    const rate = new FinancialDecimal(rule.ratePercent);
    const vatAmountMinor = roundToMinorUnits(
      new FinancialDecimal(taxableBaseHtMinor).mul(rate).div(100)
    );

    subtotalHtMinor += taxableBaseHtMinor;
    vatTotalMinor += vatAmountMinor;

    if (rule.legalMention) {
      exemptionMentions.add(rule.legalMention);
    }

    taxBreakdowns.push({
      taxRuleCode: rule.ruleCode,
      vatCategoryCode: rule.vatCategoryCode,
      vatRatePercent: rule.ratePercent,
      taxableBaseHtMinor,
      vatAmountMinor,
      exemptionReasonCode: rule.exemptionReasonCode,
      exemptionReasonText: rule.legalMention,
    });
  }

  const totalTtcMinor = subtotalHtMinor + vatTotalMinor;

  // Deduct applied deposit invoices (Factures d'acompte) on a final settlement invoice
  let depositsDeductedTtcMinor = 0;
  if (input.appliedDeposits && input.appliedDeposits.length > 0) {
    if (input.documentType !== 'standard_invoice') {
      throw new Error(
        'DEPOSIT_DEDUCTION_ONLY_ON_STANDARD_INVOICE: Les factures d’acompte ne peuvent être déduites que sur une facture de solde standard.'
      );
    }
    for (const dep of input.appliedDeposits) {
      if (dep.appliedTtcMinor <= 0 || dep.appliedHtMinor + dep.appliedVatMinor !== dep.appliedTtcMinor) {
        throw new Error(`INVALID_APPLIED_DEPOSIT: Montants d'acompte incohérents (${dep.depositNumber}).`);
      }
      depositsDeductedTtcMinor += dep.appliedTtcMinor;
    }
    if (depositsDeductedTtcMinor > totalTtcMinor) {
      throw new Error(
        'DEPOSIT_EXCEEDS_INVOICE_TOTAL: Le total des acomptes déduits ne peut pas dépasser le montant TTC de la facture.'
      );
    }
  }

  const netToPayTtcMinor = totalTtcMinor - depositsDeductedTtcMinor;

  const operationCategory: OperationCategory =
    hasGoods && hasServices ? 'mixed' : hasGoods ? 'goods' : 'services';

  // Mandatory €40 recovery indemnity for B2B (Art. L441-10 & D441-5 Code de commerce)
  const recoveryIndemnityMinor = input.isCustomerBusiness ? 4000 : 0;

  return {
    documentType: input.documentType,
    operationCategory,
    lines: calculatedLines,
    taxBreakdowns,
    subtotalHtMinor,
    vatTotalMinor,
    totalTtcMinor,
    depositsDeductedTtcMinor,
    netToPayTtcMinor,
    latePenaltyRatePercent: input.latePenaltyRatePercent ?? '15.000',
    recoveryIndemnityMinor,
    discountTerms: input.discountTerms ?? "Pas d'escompte pour paiement anticipé",
    vatExemptionMention: exemptionMentions.size > 0 ? Array.from(exemptionMentions).join(' — ') : null,
    vatOnDebitsMention: input.workspaceVatExigibility === 'DEBITS',
  };
}

/**
 * Cash-Basis VAT Realization (TVA sur les encaissements - 44574 -> 44571).
 * When a payment is allocated to an invoice under `ENCAISSEMENTS`, computes the exact
 * VAT amount per tax breakdown that becomes exigible upon this payment.
 *
 * Ensures that when cumulative paid TTC reaches 100% of invoice total TTC,
 * the cumulative realized VAT equals 100% of each rate's `vatAmountMinor` without cent drift.
 */
export interface CashVatRealizationInput {
  invoiceTotalTtcMinor: number;
  previouslyPaidTtcMinor: number;
  currentPaymentAllocationTtcMinor: number;
  taxBreakdowns: CalculatedTaxBreakdown[];
  previouslyRealizedVatByRuleMinor: Record<string, number>;
}

export interface CashVatTransferLine {
  taxRuleCode: string;
  vatRatePercent: string;
  pendingAccountCode: string; // e.g. 445740 (Debited)
  collectedAccountCode: string; // e.g. 445710 (Credited)
  vatToTransferMinor: number;
}

export function calculateCashBasisVatRealization(
  input: CashVatRealizationInput
): CashVatTransferLine[] {
  if (input.currentPaymentAllocationTtcMinor <= 0) {
    throw new Error('Payment allocation must be strictly positive');
  }
  const newCumulativePaidTtc = input.previouslyPaidTtcMinor + input.currentPaymentAllocationTtcMinor;
  if (newCumulativePaidTtc > input.invoiceTotalTtcMinor) {
    throw new Error('OVERPAYMENT_EXCEEDS_INVOICE_TTC: Le cumul des règlements dépasse le total TTC de la facture.');
  }

  const transfers: CashVatTransferLine[] = [];
  const cumulativeRatio = new FinancialDecimal(newCumulativePaidTtc).div(input.invoiceTotalTtcMinor);

  for (const breakdown of input.taxBreakdowns) {
    if (breakdown.vatAmountMinor === 0) {
      continue;
    }
    const rule = getTaxRuleOrThrow(breakdown.taxRuleCode);
    const previouslyRealized = input.previouslyRealizedVatByRuleMinor[breakdown.taxRuleCode] ?? 0;

    const targetCumulativeVatMinor =
      newCumulativePaidTtc === input.invoiceTotalTtcMinor
        ? breakdown.vatAmountMinor
        : roundToMinorUnits(new FinancialDecimal(breakdown.vatAmountMinor).mul(cumulativeRatio));

    const vatToTransferMinor = Math.max(0, targetCumulativeVatMinor - previouslyRealized);
    if (vatToTransferMinor > 0) {
      transfers.push({
        taxRuleCode: breakdown.taxRuleCode,
        vatRatePercent: breakdown.vatRatePercent,
        pendingAccountCode: rule.collectedAccountPendingCashCode,
        collectedAccountCode: rule.collectedAccountDebitsCode,
        vatToTransferMinor,
      });
    }
  }

  return transfers;
}

/**
 * Multi-Rate Expense Line VAT & Non-Deductible VAT Split (PCG 2025).
 * When a purchase has a partial VAT deductibility ratio (e.g. 80% on vehicle fuel),
 * the non-deductible VAT portion (20% of the VAT) is added to the 6xx expense account!
 */
export interface ExpenseLineCalculationInput {
  amountHtMinor: number;
  taxRuleCode: string;
  deductibilityRatio?: string | number; // 0.0 to 1.0, default 1.0
}

export interface CalculatedExpenseLineVat {
  amountHtMinor: number;
  vatTotalMinor: number;
  vatDeductibleMinor: number;
  vatNonDeductibleMinor: number;
  accountingExpenseChargeMinor: number; // amountHtMinor + vatNonDeductibleMinor (posted to 6xx)
  amountTtcMinor: number;
}

export function calculateExpenseLineVat(
  input: ExpenseLineCalculationInput
): CalculatedExpenseLineVat {
  const rule = getTaxRuleOrThrow(input.taxRuleCode);
  const ratio = new FinancialDecimal(input.deductibilityRatio ?? 1);
  if (ratio.lt(0) || ratio.gt(1)) {
    throw new Error('INVALID_DEDUCTIBILITY_RATIO: Le coefficient de déduction de TVA doit être compris entre 0 et 1.');
  }

  const rate = new FinancialDecimal(rule.ratePercent);
  const vatTotalMinor = roundToMinorUnits(
    new FinancialDecimal(input.amountHtMinor).mul(rate).div(100)
  );
  const vatDeductibleMinor = roundToMinorUnits(new FinancialDecimal(vatTotalMinor).mul(ratio));
  const vatNonDeductibleMinor = vatTotalMinor - vatDeductibleMinor;
  const accountingExpenseChargeMinor = input.amountHtMinor + vatNonDeductibleMinor;
  const amountTtcMinor = input.amountHtMinor + vatTotalMinor;

  return {
    amountHtMinor: input.amountHtMinor,
    vatTotalMinor,
    vatDeductibleMinor,
    vatNonDeductibleMinor,
    accountingExpenseChargeMinor,
    amountTtcMinor,
  };
}
