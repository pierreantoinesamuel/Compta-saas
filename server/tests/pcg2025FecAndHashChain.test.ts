import { describe, expect, it } from 'vitest';
import {
  FEC_18_COLUMNS,
  generateStatutoryFec,
  validateAuxiliaryLetteringGroup,
  validateJournalEntryForPosting,
  validatePcg2025AccountCode,
} from '../domain/accounting/pcg2025.js';
import {
  computeChainedRecordHash,
  GENESIS_PREVIOUS_HASH,
  verifyHashChain,
  type VerifiableChainItem,
} from '../domain/audit/hashChain.js';
import { buildApp } from '../index.js';

describe('PCG 2025 Ledger, Auxiliary Lettering, 18-Column FEC & Cryptographic Hash Chain', () => {
  it('rejects abolished account 79 (Transferts de charges) per PCG 2025 (ANC 2022-06)', () => {
    expect(() => validatePcg2025AccountCode('791000')).toThrow(/PCG_2025_ABOLISHED_ACCOUNT_79/);
    expect(() => validatePcg2025AccountCode('649000')).not.toThrow();
    expect(() => validatePcg2025AccountCode('706000')).not.toThrow();
  });

  it('enforces balanced double-entry, open period, PieceRef, and mandatory CompAuxNum on 411000/401000', () => {
    // Missing auxiliary account on collective account 411000 must fail
    expect(() =>
      validateJournalEntryForPosting({
        journalCode: 'VE',
        journalLabel: 'Journal des Ventes',
        entryNumber: 'VE-2026-00001',
        entryDate: '2026-10-18',
        pieceRef: 'FA-2026-00001',
        pieceDate: '2026-10-18',
        validatedAt: '2026-10-18',
        periodStatus: 'open',
        lines: [
          {
            accountCode: '411000',
            accountLabel: 'Clients',
            description: 'Facture client sans compte auxiliaire',
            debitMinor: 120000,
            creditMinor: 0,
          },
          {
            accountCode: '706000',
            accountLabel: 'Prestations de services',
            description: 'Prestation',
            debitMinor: 0,
            creditMinor: 120000,
          },
        ],
      })
    ).toThrow(/MISSING_AUXILIARY_ACCOUNT/);

    // Closed period must reject posting
    expect(() =>
      validateJournalEntryForPosting({
        journalCode: 'VE',
        journalLabel: 'Journal des Ventes',
        entryNumber: 'VE-2026-00001',
        entryDate: '2026-10-18',
        pieceRef: 'FA-2026-00001',
        pieceDate: '2026-10-18',
        validatedAt: '2026-10-18',
        periodStatus: 'closed',
        lines: [
          {
            accountCode: '411000',
            accountLabel: 'Clients',
            auxiliaryAccountCode: '411CLI0001',
            auxiliaryAccountLabel: 'Client SAS',
            description: 'Facture',
            debitMinor: 120000,
            creditMinor: 0,
          },
          {
            accountCode: '706000',
            accountLabel: 'Prestations',
            description: 'Prestation',
            debitMinor: 0,
            creditMinor: 120000,
          },
        ],
      })
    ).toThrow(/PERIOD_CLOSED/);
  });

  it('validates third-party auxiliary lettering equilibrium (Lettrage EcritureLet) and generates a compliant 18-column FEC', () => {
    validateAuxiliaryLetteringGroup('AA', [
      { auxiliaryAccountCode: '411CLI0001', debitMinor: 120000, creditMinor: 0 },
      { auxiliaryAccountCode: '411CLI0001', debitMinor: 0, creditMinor: 120000 },
    ]);

    expect(() =>
      validateAuxiliaryLetteringGroup('AB', [
        { auxiliaryAccountCode: '411CLI0001', debitMinor: 120000, creditMinor: 0 },
        { auxiliaryAccountCode: '411CLI0001', debitMinor: 0, creditMinor: 50000 },
      ])
    ).toThrow(/UNBALANCED_LETTERING/);

    const fec = generateStatutoryFec('732829320', '2026-12-31', [
      {
        journalCode: 'VE',
        journalLabel: 'Journal des Ventes',
        entryNumber: 'VE-2026-00001',
        entryDate: '2026-10-18',
        pieceRef: 'FA-2026-00001',
        pieceDate: '2026-10-18',
        validatedAt: '2026-10-18',
        periodStatus: 'open',
        lines: [
          {
            accountCode: '411000',
            accountLabel: 'Clients',
            auxiliaryAccountCode: '411CLI0001',
            auxiliaryAccountLabel: 'ACME SAS',
            description: 'Facture FA-2026-00001',
            debitMinor: 120000,
            creditMinor: 0,
            letteringCode: 'AA',
            letteredAt: '2026-10-20',
          },
          {
            accountCode: '706000',
            accountLabel: 'Prestations de services',
            description: 'Conseil architecture',
            debitMinor: 0,
            creditMinor: 100000,
          },
          {
            accountCode: '445710',
            accountLabel: 'TVA collectée 20 %',
            description: 'TVA 20 %',
            debitMinor: 0,
            creditMinor: 20000,
          },
        ],
      },
    ]);

    expect(fec.filename).toBe('732829320FEC20261231.txt');
    expect(fec.totalDebitMinor).toBe(120000);
    expect(fec.totalCreditMinor).toBe(120000);

    const lines = fec.content.split('\r\n');
    expect(lines).toHaveLength(4); // 1 header + 3 lines
    expect(lines[0]?.split('|')).toEqual([...FEC_18_COLUMNS]);
    expect(lines[1]?.split('|')).toHaveLength(18);
    expect(lines[1]).toContain('1200,00|0,00|AA|20261020|20261018');
  });

  it('verifies SHA-256 cryptographic hash chains (BlockedLog / PAF) and detects tampering', () => {
    const item1Base = {
      workspaceId: 'ws-1',
      sequenceNumberOrRef: 'FA-2026-00001',
      occurredAtIso: '2026-10-18T10:00:00.000Z',
      entityType: 'invoice',
      payload: { totalTtcMinor: 120000, customerSiren: '552100554' },
    };
    const h1 = computeChainedRecordHash(null, item1Base);

    const item2Base = {
      workspaceId: 'ws-1',
      sequenceNumberOrRef: 'FA-2026-00002',
      occurredAtIso: '2026-10-18T11:00:00.000Z',
      entityType: 'invoice',
      payload: { totalTtcMinor: 240000, customerSiren: '732829320' },
    };
    const h2 = computeChainedRecordHash(h1.recordHash, item2Base);

    const chain: VerifiableChainItem[] = [
      { ...item1Base, ...h1 },
      { ...item2Base, ...h2 },
    ];

    expect(h1.previousHash).toBe(GENESIS_PREVIOUS_HASH);
    expect(verifyHashChain(chain)).toEqual({ valid: true, checkedCount: 2 });

    // Tamper with invoice #1 amount by 1 cent
    const tamperedChain: VerifiableChainItem[] = [
      {
        ...chain[0]!,
        payload: { totalTtcMinor: 120001, customerSiren: '552100554' },
      },
      chain[1]!,
    ];
    const verification = verifyHashChain(tamperedChain);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtIndex).toBe(0);
  });

  it('serves /api/v1/health, /api/v1/contacts/validate-identifiers, and /api/v1/invoices/calculate-preview', async () => {
    const app = buildApp();

    const healthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().compliance.pcgVersion).toBe('PCG_2025_ANC_2022_06');

    const idRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts/validate-identifiers',
      payload: {
        siren: '552 100 554',
      },
    });
    expect(idRes.statusCode).toBe(200);
    expect(idRes.json().siren.valid).toBe(true);
    expect(idRes.json().computedFrenchVatNumber).toMatch(/^FR[0-9]{2}552100554$/);

    const calcRes = await app.inject({
      method: 'POST',
      url: '/api/v1/invoices/calculate-preview',
      payload: {
        documentType: 'standard_invoice',
        isCustomerBusiness: true,
        customerTaxZone: 'DOMESTIC_FR',
        customerSiren: '552100554',
        workspaceVatRegime: 'REEL_NORMAL',
        workspaceVatExigibility: 'ENCAISSEMENTS',
        lines: [
          {
            description: 'Mission de conseil',
            lineNature: 'services',
            quantity: '2',
            unitCode: 'DAY',
            unitPriceHtMinor: 80000,
            taxRuleCode: 'FR_TVA_20',
          },
        ],
      },
    });
    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.subtotalHtMinor).toBe(160000);
    expect(body.vatTotalMinor).toBe(32000);
    expect(body.totalTtcMinor).toBe(192000);

    await app.close();
  });
});
