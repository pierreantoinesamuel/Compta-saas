import type { DocumentKind, ExtractedDocumentData } from './documentTypes.js';

interface AccountSuggestion {
  code: string;
  label: string;
  journalCode: 'AC' | 'VE' | 'BQ' | 'OD';
  taxRuleCode: string;
  deductibilityRatio: number;
}

function keywordAccount(description: string): AccountSuggestion | null {
  const d = description.toLowerCase();
  if (/loyer|bail|location immobilier/i.test(d)) return { code: '612000', label: 'Locations immobilières', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 1 };
  if (/assurance/i.test(d)) return { code: '616000', label: "Primes d'assurances", journalCode: 'AC', taxRuleCode: 'FR_EXONERE', deductibilityRatio: 1 };
  if (/honoraires|conseil|avocat|expert|comptable/i.test(d)) return { code: '622600', label: 'Honoraires', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 1 };
  if (/voyage|déplacement|transport|taxi|train|avion|hôtel|hotel/i.test(d)) return { code: '625100', label: 'Voyages et déplacements', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 1 };
  if (/téléphone|télécom|internet|mobile|sfr|orange|bouygues|free/i.test(d)) return { code: '626000', label: 'Frais postaux et télécom', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 1 };
  if (/restaurant|repas|nourriture|traiteur/i.test(d)) return { code: '625700', label: 'Réceptions et repas', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 0.8 };
  if (/entretien|réparation|maintenance/i.test(d)) return { code: '615000', label: 'Entretien et réparations', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 1 };
  if (/fourniture|papier|bureau|imprimante|cartouche/i.test(d)) return { code: '606100', label: 'Fournitures non stockables', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 1 };
  if (/logiciel|abonnement|saas|licence|software/i.test(d)) return { code: '606200', label: 'Fournitures consommables — logiciels', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 1 };
  if (/marchandise|produit|stock/i.test(d)) return { code: '601100', label: 'Achats de marchandises', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 1 };
  if (/publicité|marketing|communication/i.test(d)) return { code: '623000', label: 'Publicité et communication', journalCode: 'AC', taxRuleCode: 'FR_TVA_20', deductibilityRatio: 1 };
  if (/salaire|paie|rémunération/i.test(d)) return { code: '641000', label: 'Salaires et traitements', journalCode: 'OD', taxRuleCode: 'FR_EXONERE', deductibilityRatio: 1 };
  return null;
}

function vatRuleCode(rate: number | undefined): string {
  if (rate === 20) return 'FR_TVA_20';
  if (rate === 10) return 'FR_TVA_10';
  if (rate === 5.5) return 'FR_TVA_5_5';
  if (rate === 2.1) return 'FR_TVA_2_1';
  if (rate === 0) return 'FR_EXONERE';
  return 'FR_TVA_20';
}

export function suggestAccounting(kind: DocumentKind, data: ExtractedDocumentData): void {
  switch (kind) {
    case 'supplier_invoice': {
      const desc = data.description ?? data.lines?.[0]?.description ?? '';
      const kw = keywordAccount(desc);
      if (kw) {
        data.suggestedAccountCode = kw.code;
        data.suggestedAccountLabel = kw.label;
        data.suggestedJournalCode = kw.journalCode;
        data.suggestedTaxRuleCode = kw.taxRuleCode;
        data.suggestedDeductibilityRatio = kw.deductibilityRatio;
      } else {
        data.suggestedAccountCode = '607100';
        data.suggestedAccountLabel = 'Achats de services — à ventiler';
        data.suggestedJournalCode = 'AC';
        data.suggestedTaxRuleCode = vatRuleCode(data.vatRatePercent);
        data.suggestedDeductibilityRatio = 1;
      }
      break;
    }
    case 'expense_receipt': {
      const desc = data.description ?? '';
      const kw = keywordAccount(desc);
      if (kw) {
        data.suggestedAccountCode = kw.code;
        data.suggestedAccountLabel = kw.label;
        data.suggestedJournalCode = kw.journalCode;
        data.suggestedTaxRuleCode = kw.taxRuleCode;
        data.suggestedDeductibilityRatio = kw.deductibilityRatio;
      } else {
        data.suggestedAccountCode = '625100';
        data.suggestedAccountLabel = 'Frais de déplacement';
        data.suggestedJournalCode = 'AC';
        data.suggestedTaxRuleCode = vatRuleCode(data.vatRatePercent);
        data.suggestedDeductibilityRatio = 1;
      }
      break;
    }
    case 'bank_statement':
    case 'bank_transaction':
      data.suggestedAccountCode = '512000';
      data.suggestedAccountLabel = 'Banque';
      data.suggestedJournalCode = 'BQ';
      data.suggestedTaxRuleCode = 'FR_EXONERE';
      data.suggestedDeductibilityRatio = 1;
      break;
    case 'payslip':
      data.suggestedAccountCode = '641000';
      data.suggestedAccountLabel = 'Salaires et traitements';
      data.suggestedJournalCode = 'OD';
      data.suggestedTaxRuleCode = 'FR_EXONERE';
      data.suggestedDeductibilityRatio = 1;
      break;
    case 'client_invoice':
      data.suggestedAccountCode = '411000';
      data.suggestedAccountLabel = 'Clients';
      data.suggestedJournalCode = 'VE';
      data.suggestedTaxRuleCode = vatRuleCode(data.vatRatePercent);
      data.suggestedDeductibilityRatio = 1;
      break;
    default:
      break;
  }
}
