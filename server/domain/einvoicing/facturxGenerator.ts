/**
 * Native Factur-X 1.0.07 / EU Standard EN 16931 Cross Industry Invoice (CII) XML Generator.
 *
 * Supports:
 * - Standard Invoices (TypeCode 380)
 * - Credit Notes / Factures d'avoir (TypeCode 381, referencing BT-25 original invoice)
 * - Deposit Invoices / Factures d'acompte (TypeCode 386)
 * - EN 16931 Rate-Level VAT Breakdowns (ApplicableTradeTax)
 * - French Mandatory B2B Identifiers (SIREN schemeID="0002", SIRET schemeID="0009", Intra-EU VAT)
 */

import type { CalculatedInvoiceResult } from '../tax/vatEngine.js';

export interface FacturxPartySnapshot {
  legalName: string;
  siren: string;
  siret?: string | null;
  vatNumber?: string | null;
  streetLine1: string;
  postalCode: string;
  city: string;
  countryCode: string;
}

export interface GenerateFacturxXmlInput {
  invoiceNumber: string;
  issueDateIso: string; // YYYY-MM-DD
  dueDateIso: string; // YYYY-MM-DD
  deliveryDateIso?: string | null;
  currency: string;
  buyerReference?: string | null; // Purchase Order / Chorus Pro BT-13
  originalInvoiceNumber?: string | null; // Mandatory for Credit Notes (BT-25)
  originalInvoiceDateIso?: string | null;
  issuer: FacturxPartySnapshot;
  customer: FacturxPartySnapshot;
  calculated: CalculatedInvoiceResult;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatCiiDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

function formatMinorToDotDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const units = Math.floor(abs / 100);
  const cents = (abs % 100).toString().padStart(2, '0');
  return `${sign}${units}.${cents}`;
}

/**
 * Maps internal document type to UNTDID 1001 Document Type Code required by EN 16931 / Factur-X:
 * - 380: Commercial invoice (Facture standard)
 * - 381: Credit note (Facture d'avoir)
 * - 386: Prepayment / Deposit invoice (Facture d'acompte)
 */
export function getUntdid1001TypeCode(
  docType: CalculatedInvoiceResult['documentType']
): '380' | '381' | '386' {
  switch (docType) {
    case 'credit_note':
      return '381';
    case 'deposit_invoice':
      return '386';
    default:
      return '380';
  }
}

/**
 * Generates an EN 16931 compliant Factur-X CII XML string (`factur-x.xml`).
 */
export function generateFacturxXml(input: GenerateFacturxXmlInput): string {
  if (input.calculated.documentType === 'credit_note' && !input.originalInvoiceNumber) {
    throw new Error('FACTURX_CREDIT_NOTE_MISSING_REF: Un avoir Factur-X (381) exige le numéro de la facture d’origine (BT-25).');
  }

  const typeCode = getUntdid1001TypeCode(input.calculated.documentType);
  const issueDateCii = formatCiiDate(input.issueDateIso);
  const dueDateCii = formatCiiDate(input.dueDateIso);

  const lineItemsXml = input.calculated.lines
    .map(
      (line) => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${line.position}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${escapeXml(line.description)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${formatMinorToDotDecimal(line.unitPriceHtMinor)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${escapeXml(line.unitCode)}">${line.quantity}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${line.vatCategoryCode}</ram:CategoryCode>
          <ram:RateApplicablePercent>${Number.parseFloat(line.vatRatePercent).toFixed(2)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${formatMinorToDotDecimal(line.lineSubtotalHtMinor)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`
    )
    .join('\n');

  const tradeTaxesXml = input.calculated.taxBreakdowns
    .map((tb) => {
      const exemptionXml = tb.exemptionReasonText
        ? `\n        <ram:ExemptionReason>${escapeXml(tb.exemptionReasonText)}</ram:ExemptionReason>`
        : '';
      const exemptionCodeXml = tb.exemptionReasonCode
        ? `\n        <ram:ExemptionReasonCode>${escapeXml(tb.exemptionReasonCode)}</ram:ExemptionReasonCode>`
        : '';
      return `      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${formatMinorToDotDecimal(tb.vatAmountMinor)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>${exemptionXml}
        <ram:BasisAmount>${formatMinorToDotDecimal(tb.taxableBaseHtMinor)}</ram:BasisAmount>
        <ram:CategoryCode>${tb.vatCategoryCode}</ram:CategoryCode>${exemptionCodeXml}
        <ram:RateApplicablePercent>${Number.parseFloat(tb.vatRatePercent).toFixed(2)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
    })
    .join('\n');

  const invoiceRefOrderXml = input.originalInvoiceNumber
    ? `      <ram:InvoiceReferencedDocument>
        <ram:IssuerAssignedID>${escapeXml(input.originalInvoiceNumber)}</ram:IssuerAssignedID>${
          input.originalInvoiceDateIso
            ? `\n        <ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${formatCiiDate(input.originalInvoiceDateIso)}</qdt:DateTimeString></ram:FormattedIssueDateTime>`
            : ''
        }
      </ram:InvoiceReferencedDocument>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(input.invoiceNumber)}</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${issueDateCii}</udt:DateTimeString>
    </ram:IssueDateTime>
    <ram:IncludedNote>
      <ram:Content>Catégorie d'opération : ${input.calculated.operationCategory.toUpperCase()} — Pénalités de retard : ${input.calculated.latePenaltyRatePercent} % — Indemnité forfaitaire pour frais de recouvrement : ${formatMinorToDotDecimal(input.calculated.recoveryIndemnityMinor)} EUR</ram:Content>
    </ram:IncludedNote>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${lineItemsXml}
    <ram:ApplicableHeaderTradeAgreement>
      ${input.buyerReference ? `<ram:BuyerReference>${escapeXml(input.buyerReference)}</ram:BuyerReference>` : ''}
      <ram:SellerTradeParty>
        <ram:Name>${escapeXml(input.issuer.legalName)}</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${escapeXml(input.issuer.siren)}</ram:ID>
        </ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${escapeXml(input.issuer.postalCode)}</ram:PostcodeCode>
          <ram:LineOne>${escapeXml(input.issuer.streetLine1)}</ram:LineOne>
          <ram:CityName>${escapeXml(input.issuer.city)}</ram:CityName>
          <ram:CountryID>${escapeXml(input.issuer.countryCode)}</ram:CountryID>
        </ram:PostalTradeAddress>${
          input.issuer.vatNumber
            ? `\n        <ram:SpecifiedTaxRegistration>\n          <ram:ID schemeID="VA">${escapeXml(input.issuer.vatNumber)}</ram:ID>\n        </ram:SpecifiedTaxRegistration>`
            : ''
        }
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${escapeXml(input.customer.legalName)}</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${escapeXml(input.customer.siren)}</ram:ID>
        </ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${escapeXml(input.customer.postalCode)}</ram:PostcodeCode>
          <ram:LineOne>${escapeXml(input.customer.streetLine1)}</ram:LineOne>
          <ram:CityName>${escapeXml(input.customer.city)}</ram:CityName>
          <ram:CountryID>${escapeXml(input.customer.countryCode)}</ram:CountryID>
        </ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${escapeXml(input.currency)}</ram:InvoiceCurrencyCode>
${ tradeTaxesXml }
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${dueDateCii}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${formatMinorToDotDecimal(input.calculated.subtotalHtMinor)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${formatMinorToDotDecimal(input.calculated.subtotalHtMinor)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${escapeXml(input.currency)}">${formatMinorToDotDecimal(input.calculated.vatTotalMinor)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${formatMinorToDotDecimal(input.calculated.totalTtcMinor)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>${formatMinorToDotDecimal(input.calculated.depositsDeductedTtcMinor)}</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${formatMinorToDotDecimal(input.calculated.netToPayTtcMinor)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${invoiceRefOrderXml}    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}
