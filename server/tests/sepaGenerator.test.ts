import { describe, expect, it } from 'vitest';
import { generateSepaPain001 } from '../domain/payments/sepaGenerator.js';
import type { SepaPaymentInput } from '../domain/payments/sepaGenerator.js';

const baseTx = {
  endToEndId: 'FA-2026-0042',
  amount: 1_234_56,
  creditorName: 'Fournisseur SAS',
  creditorIban: 'FR76 3000 6000 0112 3456 7890 189',
  remittanceInfo: 'Facture FA-2026-0042',
};

const base: SepaPaymentInput = {
  batchRef: 'HAXATAX-2026-001',
  executionDate: '2026-11-01',
  debtorName: 'Cabinet Dupont',
  debtorIban: 'FR76 3000 4000 0300 0100 0000 042',
  transactions: [baseTx],
};

describe('generateSepaPain001 — ISO 20022 pain.001.001.03', () => {
  it('produces valid XML declaration and correct namespace', () => {
    const xml = generateSepaPain001(base);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"');
  });

  it('includes correct transaction count and control sum', () => {
    const xml = generateSepaPain001(base);
    expect(xml).toContain('<NbOfTxs>1</NbOfTxs>');
    expect(xml).toContain('<CtrlSum>1234.56</CtrlSum>');
  });

  it('formats amounts as euros with 2 decimal places', () => {
    const xml = generateSepaPain001({ ...base, transactions: [{ ...baseTx, amount: 10_00 }] });
    expect(xml).toContain('<InstdAmt Ccy="EUR">10.00</InstdAmt>');
  });

  it('strips spaces from IBANs', () => {
    const xml = generateSepaPain001(base);
    expect(xml).not.toMatch(/<IBAN>[^<]*\s[^<]*<\/IBAN>/);
    expect(xml).toContain('<IBAN>FR7630004000030001000000042</IBAN>');
  });

  it('escapes & in debtor name', () => {
    const xml = generateSepaPain001({ ...base, debtorName: 'A & B' });
    const nm = xml.match(/<Nm>([^<]+)<\/Nm>/)?.[1] ?? '';
    expect(nm).toContain('&amp;');
    expect(nm).not.toContain(' & ');
  });

  it('handles multiple transactions with correct total', () => {
    const input: SepaPaymentInput = {
      ...base,
      transactions: [
        { endToEndId: 'TX1', amount: 1_000_00, creditorName: 'A', creditorIban: 'FR7630006000011234567890189', remittanceInfo: 'inv1' },
        { endToEndId: 'TX2', amount: 2_500_50, creditorName: 'B', creditorIban: 'FR7630006000011234567890189', remittanceInfo: 'inv2' },
      ],
    };
    const xml = generateSepaPain001(input);
    expect(xml).toContain('<NbOfTxs>2</NbOfTxs>');
    expect(xml).toContain('<CtrlSum>3500.50</CtrlSum>');
  });

  it('includes BIC when provided', () => {
    const xml = generateSepaPain001({ ...base, debtorBic: 'BNPAFRPPXXX' });
    expect(xml).toContain('<BIC>BNPAFRPPXXX</BIC>');
  });

  it('falls back to NOTPROVIDED when BIC is absent', () => {
    const xml = generateSepaPain001(base);
    expect(xml).toContain('<Id>NOTPROVIDED</Id>');
  });

  it('truncates endToEndId to 35 characters', () => {
    const xml = generateSepaPain001({ ...base, transactions: [{ ...baseTx, endToEndId: 'X'.repeat(50) }] });
    expect(xml).toContain('<EndToEndId>' + 'X'.repeat(35) + '</EndToEndId>');
  });
});
