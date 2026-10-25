import type pg from 'pg';

export interface Ca3Declaration {
  periodStart: string;
  periodEnd: string;
  // Opérations imposables (bases HT)
  A1_taxableBase20: number;
  A2_taxableBase10: number;
  A3_taxableBase55: number;
  A4_taxableBase21: number;
  // TVA brute collectée
  B1_vatCollected20: number;
  B2_vatCollected10: number;
  B3_vatCollected55: number;
  B4_vatCollected21: number;
  // Opérations hors TVA
  E1_exportSales: number;
  E2_intraCommunautaire: number;
  E3_franchise: number;
  // Acquisitions intra-EU
  F7_intraCommunityAcquisitions: number;
  F8_vatOnAcquisitions: number;
  // Autoliquidation
  G1_reverseChargeBase: number;
  G2_reverseChargeVat: number;
  // TVA déductible
  H1_vatDeductibleImmo: number;
  H2_vatDeductibleOther: number;
  H3_vatCreditCarried: number;
  // Résultat
  I1_totalVatDue: number;
  I2_totalVatDeductible: number;
  J_netVatPayable: number;
  K_vatCreditForRefund: number;
}

// Helper: sum debit or credit on accounts matching prefix, in a date range
async function sumByPrefix(
  pool: pg.Pool,
  workspaceId: string,
  prefixes: string[],
  periodStart: string,
  periodEnd: string,
  col: 'debit_minor' | 'credit_minor',
): Promise<number> {
  if (prefixes.length === 0) return 0;
  const conditions = prefixes.map((_, i) => `a.account_code LIKE $${i + 5}`).join(' OR ');
  const { rows } = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(jl.${col}), 0)::BIGINT AS total
     FROM journal_entry_lines jl
     JOIN accounts a ON a.id = jl.account_id
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.workspace_id = $1
       AND je.status = 'posted'
       AND je.entry_date BETWEEN $2::DATE AND $3::DATE
       AND (${conditions})`,
    [workspaceId, periodStart, periodEnd, ...prefixes.map((p) => `${p}%`)],
  );
  return rows[0]?.total ?? 0;
}

export async function computeCa3(
  workspaceId: string,
  periodStart: string,
  periodEnd: string,
  pool: pg.Pool,
): Promise<Ca3Declaration> {
  // TVA collectée: credits on 44571x/44574x accounts (débit = collectée, but conventionally credit for TVA compte)
  // Taxable bases come from 7xxx accounts filtered by vat rate metadata.
  // Since we don't store vat rate per journal line directly, we use the account prefixes
  // that conventionally correspond to each rate in French accounting:
  //   44571100 = TVA 20%, 44571110 = TVA 10%, 44571120 = TVA 5.5%, 44571130 = TVA 2.1%

  const [
    vatColl20, vatColl10, vatColl55, vatColl21,
    vatDedImmo, vatDedOther,
    exportSales, intraCom,
    acqIntraCom, vatOnAcq,
    reverseBase, reverseVat,
  ] = await Promise.all([
    sumByPrefix(pool, workspaceId, ['447571', '4457110'], periodStart, periodEnd, 'credit_minor'),
    sumByPrefix(pool, workspaceId, ['4457111', '44571110'], periodStart, periodEnd, 'credit_minor'),
    sumByPrefix(pool, workspaceId, ['4457112', '44571120'], periodStart, periodEnd, 'credit_minor'),
    sumByPrefix(pool, workspaceId, ['4457113', '44571130'], periodStart, periodEnd, 'credit_minor'),
    sumByPrefix(pool, workspaceId, ['44562'], periodStart, periodEnd, 'debit_minor'),
    sumByPrefix(pool, workspaceId, ['44566', '44568'], periodStart, periodEnd, 'debit_minor'),
    sumByPrefix(pool, workspaceId, ['707', '7087'], periodStart, periodEnd, 'credit_minor'),
    sumByPrefix(pool, workspaceId, ['7091', '4452'], periodStart, periodEnd, 'credit_minor'),
    sumByPrefix(pool, workspaceId, ['4452'], periodStart, periodEnd, 'debit_minor'),
    sumByPrefix(pool, workspaceId, ['44521', '44522'], periodStart, periodEnd, 'credit_minor'),
    sumByPrefix(pool, workspaceId, ['44581'], periodStart, periodEnd, 'debit_minor'),
    sumByPrefix(pool, workspaceId, ['44582'], periodStart, periodEnd, 'credit_minor'),
  ]);

  // Approximate taxable bases from collected TVA (TVA = base * rate)
  const A1 = vatColl20 > 0 ? Math.round(vatColl20 / 0.20) : 0;
  const A2 = vatColl10 > 0 ? Math.round(vatColl10 / 0.10) : 0;
  const A3 = vatColl55 > 0 ? Math.round(vatColl55 / 0.055) : 0;
  const A4 = vatColl21 > 0 ? Math.round(vatColl21 / 0.021) : 0;

  const I1 = vatColl20 + vatColl10 + vatColl55 + vatColl21 + reverseVat + vatOnAcq;
  const I2 = vatDedImmo + vatDedOther;
  const net = I1 - I2;

  return {
    periodStart,
    periodEnd,
    A1_taxableBase20: A1,
    A2_taxableBase10: A2,
    A3_taxableBase55: A3,
    A4_taxableBase21: A4,
    B1_vatCollected20: vatColl20,
    B2_vatCollected10: vatColl10,
    B3_vatCollected55: vatColl55,
    B4_vatCollected21: vatColl21,
    E1_exportSales: exportSales,
    E2_intraCommunautaire: intraCom,
    E3_franchise: 0,
    F7_intraCommunityAcquisitions: acqIntraCom,
    F8_vatOnAcquisitions: vatOnAcq,
    G1_reverseChargeBase: reverseBase,
    G2_reverseChargeVat: reverseVat,
    H1_vatDeductibleImmo: vatDedImmo,
    H2_vatDeductibleOther: vatDedOther,
    H3_vatCreditCarried: 0,
    I1_totalVatDue: I1,
    I2_totalVatDeductible: I2,
    J_netVatPayable: net > 0 ? net : 0,
    K_vatCreditForRefund: net < 0 ? -net : 0,
  };
}
