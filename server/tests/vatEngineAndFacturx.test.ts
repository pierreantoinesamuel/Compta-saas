import { describe, expect, it } from 'vitest';
import {
  calculateCashBasisVatRealization,
  calculateExpenseLineVat,
  calculateInvoiceTotals,
} from '../domain/tax/vatEngine.js';
import { generateFacturxXml } from '../domain/einvoicing/facturxGenerator.js';

describe('EN 16931 / DGFiP VAT Calculation Engine & Factur-X Generator', () => {
  it('enforces EN 16931 rate-level VAT rounding (rounds once per rate on total taxable base, NOT sum of rounded line VATs)', () => {
    // Classic DGFiP / Factur-X divergence case:
    // 10 lines, each 1.03 EUR HT (103 cents) at 20% VAT.
    // - Line-level VAT preview: 103 * 0.20 = 20.6 cents -> rounds to 21 cents per line.
    //   If you summed rounded line VATs, you would get 10 * 21 = 210 cents (2.10 EUR) -> REJECTED by Chorus Pro / Factur-X!
    // - Authoritative EN 16931 rate-level calculation:
    //   Total Base HT for 20% = 10 * 103 = 1030 cents (10.30 EUR).
    //   VAT for 20% = ROUND_HALF_UP(1030 * 0.20) = 206 cents (2.06 EUR)!
    const lines = Array.from({ length: 10 }, (_, idx) => ({
      description: `Article #${idx + 1}`,
      lineNature: 'goods' as const,
      quantity: '1',
      unitPriceHtMinor: 103,
      taxRuleCode: 'FR_TVA_20',
    }));

    const result = calculateInvoiceTotals({
      documentType: 'standard_invoice',
      isCustomerBusiness: true,
      customerTaxZone: 'DOMESTIC_FR',
      customerSiren: '552100554',
      workspaceVatRegime: 'REEL_NORMAL',
      workspaceVatExigibility: 'DEBITS',
      lines,
    });

    // Verify each individual line preview is 21 cents, but the authoritative invoice VAT is 206 cents!
    expect(result.lines[0]?.lineVatPreviewMinor).toBe(21);
    expect(result.subtotalHtMinor).toBe(1030);
    expect(result.taxBreakdowns).toHaveLength(1);
    expect(result.taxBreakdowns[0]?.taxableBaseHtMinor).toBe(1030);
    expect(result.taxBreakdowns[0]?.vatAmountMinor).toBe(206);
    expect(result.vatTotalMinor).toBe(206);
    expect(result.totalTtcMinor).toBe(1236);
    expect(result.recoveryIndemnityMinor).toBe(4000); // €40 B2B mandatory indemnity
    expect(result.operationCategory).toBe('goods');
  });

  it('enforces Micro-entreprise Franchise en base de TVA (Art. 293 B CGI) rules and legal mention', () => {
    const microResult = calculateInvoiceTotals({
      documentType: 'standard_invoice',
      isCustomerBusiness: true,
      customerTaxZone: 'DOMESTIC_FR',
      customerSiren: '732829320',
      workspaceVatRegime: 'FRANCHISE_293B',
      workspaceVatExigibility: 'ENCAISSEMENTS',
      lines: [
        {
          description: 'Développement application web',
          lineNature: 'services',
          quantity: '5',
          unitCode: 'DAY',
          unitPriceHtMinor: 50000,
          taxRuleCode: 'FR_FRANCHISE_293B',
        },
      ],
    });

    expect(microResult.subtotalHtMinor).toBe(250000);
    expect(microResult.vatTotalMinor).toBe(0);
    expect(microResult.totalTtcMinor).toBe(250000);
    expect(microResult.vatExemptionMention).toBe('TVA non applicable, art. 293 B du CGI');

    // Attempting to charge 20% VAT while in FRANCHISE_293B must throw
    expect(() =>
      calculateInvoiceTotals({
        documentType: 'standard_invoice',
        isCustomerBusiness: true,
        customerTaxZone: 'DOMESTIC_FR',
        customerSiren: '732829320',
        workspaceVatRegime: 'FRANCHISE_293B',
        workspaceVatExigibility: 'ENCAISSEMENTS',
        lines: [
          {
            description: 'Prestation invalide',
            lineNature: 'services',
            quantity: '1',
            unitPriceHtMinor: 10000,
            taxRuleCode: 'FR_TVA_20',
          },
        ],
      })
    ).toThrow(/FRANCHISE_VAT_VIOLATION/);
  });

  it('deducts applied Deposit Invoices (Factures d’acompte) on final settlement invoices and validates Credit Notes', () => {
    const finalSettlement = calculateInvoiceTotals({
      documentType: 'standard_invoice',
      isCustomerBusiness: true,
      customerTaxZone: 'DOMESTIC_FR',
      customerSiren: '552100554',
      workspaceVatRegime: 'REEL_NORMAL',
      workspaceVatExigibility: 'ENCAISSEMENTS',
      lines: [
        {
          description: 'Projet complet',
          lineNature: 'services',
          quantity: '1',
          unitPriceHtMinor: 100000, // 1000.00 EUR HT
          taxRuleCode: 'FR_TVA_20',
        },
      ],
      appliedDeposits: [
        {
          depositInvoiceId: 'dep-1',
          depositNumber: 'AC-2026-00001',
          appliedHtMinor: 30000,
          appliedVatMinor: 6000,
          appliedTtcMinor: 36000, // 360.00 EUR TTC deposit already paid
        },
      ],
    });

    expect(finalSettlement.totalTtcMinor).toBe(120000);
    expect(finalSettlement.depositsDeductedTtcMinor).toBe(36000);
    expect(finalSettlement.netToPayTtcMinor).toBe(84000); // 840.00 EUR remaining to pay

    // Credit note without originalInvoiceId must be rejected
    expect(() =>
      calculateInvoiceTotals({
        documentType: 'credit_note',
        isCustomerBusiness: true,
        customerTaxZone: 'DOMESTIC_FR',
        customerSiren: '552100554',
        workspaceVatRegime: 'REEL_NORMAL',
        workspaceVatExigibility: 'ENCAISSEMENTS',
        originalInvoiceId: null,
        lines: [
          {
            description: 'Avoir sur erreur',
            lineNature: 'services',
            quantity: '1',
            unitPriceHtMinor: 10000,
            taxRuleCode: 'FR_TVA_20',
          },
        ],
      })
    ).toThrow(/CREDIT_NOTE_MISSING_ORIGINAL_INVOICE/);
  });

  it('realizes Cash-Basis VAT (TVA sur les encaissements 44574 -> 44571) across 3 partial payments without cent drift', () => {
    // Invoice of 100.00 EUR HT + 20.00 EUR VAT = 120.00 EUR TTC (12000 cents)
    // Paid in 3 installments of 40.00 EUR TTC (4000 cents each)
    const taxBreakdowns = [
      {
        taxRuleCode: 'FR_TVA_20',
        vatCategoryCode: 'S' as const,
        vatRatePercent: '20.000',
        taxableBaseHtMinor: 10000,
        vatAmountMinor: 2000,
        exemptionReasonCode: null,
        exemptionReasonText: null,
      },
    ];

    // Installment 1: 4000 / 12000 = 1/3 of 2000 cents = 667 cents
    const step1 = calculateCashBasisVatRealization({
      invoiceTotalTtcMinor: 12000,
      previouslyPaidTtcMinor: 0,
      currentPaymentAllocationTtcMinor: 4000,
      taxBreakdowns,
      previouslyRealizedVatByRuleMinor: {},
    });
    expect(step1[0]?.vatToTransferMinor).toBe(667);
    expect(step1[0]?.pendingAccountCode).toBe('445740');
    expect(step1[0]?.collectedAccountCode).toBe('445710');

    // Installment 2: cumulative 8000 / 12000 = 2/3 of 2000 cents = 1333 cents -> delta = 1333 - 667 = 666 cents
    const step2 = calculateCashBasisVatRealization({
      invoiceTotalTtcMinor: 12000,
      previouslyPaidTtcMinor: 4000,
      currentPaymentAllocationTtcMinor: 4000,
      taxBreakdowns,
      previouslyRealizedVatByRuleMinor: { FR_TVA_20: 667 },
    });
    expect(step2[0]?.vatToTransferMinor).toBe(666);

    // Installment 3 (Final settlement): cumulative 12000 / 12000 = 2000 cents -> delta = 2000 - 1333 = 667 cents
    const step3 = calculateCashBasisVatRealization({
      invoiceTotalTtcMinor: 12000,
      previouslyPaidTtcMinor: 8000,
      currentPaymentAllocationTtcMinor: 4000,
      taxBreakdowns,
      previouslyRealizedVatByRuleMinor: { FR_TVA_20: 1333 },
    });
    expect(step3[0]?.vatToTransferMinor).toBe(667);
    // Total realized across the 3 installments = 667 + 666 + 667 = 2000 cents (exact match!)
  });

  it('splits partially deductible expense VAT (e.g. 80% vehicle fuel) between 445660 and 6xx expense charge', () => {
    const fuelLine = calculateExpenseLineVat({
      amountHtMinor: 10000, // 100.00 EUR HT
      taxRuleCode: 'FR_TVA_20', // 20.00 EUR VAT
      deductibilityRatio: '0.80', // 80% deductible (16.00 EUR), 20% non-deductible (4.00 EUR)
    });

    expect(fuelLine.vatTotalMinor).toBe(2000);
    expect(fuelLine.vatDeductibleMinor).toBe(1600);
    expect(fuelLine.vatNonDeductibleMinor).toBe(400);
    expect(fuelLine.accountingExpenseChargeMinor).toBe(10400); // 100.00 HT + 4.00 non-deductible VAT posted to 606100
    expect(fuelLine.amountTtcMinor).toBe(12000);
  });

  it('generates valid EN 16931 Factur-X CII XML for standard invoices and credit notes', () => {
    const calculated = calculateInvoiceTotals({
      documentType: 'credit_note',
      isCustomerBusiness: true,
      customerTaxZone: 'DOMESTIC_FR',
      customerSiren: '552100554',
      originalInvoiceId: 'inv-orig-1',
      workspaceVatRegime: 'REEL_NORMAL',
      workspaceVatExigibility: 'ENCAISSEMENTS',
      lines: [
        {
          description: 'Remise commerciale sur prestation',
          lineNature: 'services',
          quantity: '1',
          unitCode: 'C62',
          unitPriceHtMinor: 50000,
          taxRuleCode: 'FR_TVA_20',
        },
      ],
    });

    const xml = generateFacturxXml({
      invoiceNumber: 'AV-2026-00001',
      issueDateIso: '2026-10-18',
      dueDateIso: '2026-10-18',
      currency: 'EUR',
      originalInvoiceNumber: 'FA-2026-00012',
      originalInvoiceDateIso: '2026-10-01',
      issuer: {
        legalName: 'Haxatax SAS',
        siren: '732829320',
        vatNumber: 'FR44732829320',
        streetLine1: '10 Rue de la Paix',
        postalCode: '75002',
        city: 'Paris',
        countryCode: 'FR',
      },
      customer: {
        legalName: 'Client Pro SAS',
        siren: '552100554',
        streetLine1: '1 Avenue des Champs',
        postalCode: '75008',
        city: 'Paris',
        countryCode: 'FR',
      },
      calculated,
    });

    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
    expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>'); // 381 = Credit Note
    expect(xml).toContain('<ram:IssuerAssignedID>FA-2026-00012</ram:IssuerAssignedID>');
    expect(xml).toContain('<ram:GrandTotalAmount>600.00</ram:GrandTotalAmount>');
  });
});
