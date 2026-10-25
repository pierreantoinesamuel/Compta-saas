import { pool } from '../../db/client.js';

export interface FinancialLineItem {
  label: string;
  accountCodes: string; // description of PCG accounts
  balanceMinor: number;
}

export interface BalanceSheet {
  periodStart: string;
  periodEnd: string;
  actif: {
    immobilisationsIncorporelles: FinancialLineItem;
    immobilisationsCorporelles: FinancialLineItem;
    amortissements: FinancialLineItem;
    provisions: FinancialLineItem;
    stocks: FinancialLineItem;
    clientsEtComptes: FinancialLineItem;
    autresCreances: FinancialLineItem;
    tvaDeductible: FinancialLineItem;
    disponibilites: FinancialLineItem;
    chargesConstatees: FinancialLineItem;
    totalActif: number;
  };
  passif: {
    capital: FinancialLineItem;
    reserves: FinancialLineItem;
    reportANouveau: FinancialLineItem;
    resultatExercice: FinancialLineItem;
    provisionsRisques: FinancialLineItem;
    emprunts: FinancialLineItem;
    fournisseurs: FinancialLineItem;
    tvaCollectee: FinancialLineItem;
    dettesFiscales: FinancialLineItem;
    produitsConstates: FinancialLineItem;
    totalPassif: number;
  };
}

export interface IncomeStatement {
  periodStart: string;
  periodEnd: string;
  produits: {
    produitsExploitation: FinancialLineItem;
    produitsFinanciers: FinancialLineItem;
    produitsExceptionnels: FinancialLineItem;
    totalProduits: number;
  };
  charges: {
    chargesExploitation: FinancialLineItem;
    chargesFinancieres: FinancialLineItem;
    chargesExceptionnelles: FinancialLineItem;
    is: FinancialLineItem;
    totalCharges: number;
  };
  resultatNet: number;
}

// Returns debit-credit net balance for all posted journal lines matching prefix patterns within a period
async function sumAccountBalances(
  workspaceId: string,
  prefixes: string[],
  periodStart: string,
  periodEnd: string,
  mode: 'debit_minus_credit' | 'credit_minus_debit',
): Promise<number> {
  if (prefixes.length === 0) return 0;
  const conditions = prefixes.map((p, i) => `a.account_code LIKE $${i + 4}`).join(' OR ');
  const { rows } = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(
       CASE WHEN $3 = 'debit_minus_credit'
            THEN jl.debit_minor - jl.credit_minor
            ELSE jl.credit_minor - jl.debit_minor END
     ), 0)::BIGINT AS total
     FROM journal_entry_lines jl
     JOIN accounts a ON a.id = jl.account_id
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.workspace_id = $1
       AND je.status = 'posted'
       AND je.entry_date BETWEEN $2::DATE AND $5::DATE
       AND (${conditions})`,
    [workspaceId, periodStart, mode, ...prefixes.map((p) => `${p}%`), periodEnd],
  );
  return rows[0]?.total ?? 0;
}

export async function computeBalanceSheet(
  workspaceId: string,
  periodStart: string,
  periodEnd: string,
): Promise<BalanceSheet> {
  const [
    immInc, immCorp, amort, prov, stocks,
    clients, autresCreances, tvaDed, dispo, chargesConst,
    capital, reserves, report, risques, emprunts,
    fourn, tvaCol, dettesFisc, produitsConst,
  ] = await Promise.all([
    sumAccountBalances(workspaceId, ['20'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['21', '22', '23'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['28'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['29'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['3'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['411'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['40', '42', '43', '44', '45', '46', '47', '48'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['4456'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['512', '53'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['486'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['101'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['106', '107'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['110', '119'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['15'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['16'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['401'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['4457'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['43', '444'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['487'], periodStart, periodEnd, 'credit_minus_debit'),
  ]);

  // Compute resultat from P&L
  const [prodExp, prodFin, prodExc, chExp, chFin, chExc, isCharge] = await Promise.all([
    sumAccountBalances(workspaceId, ['70', '71', '72', '73', '74', '75'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['76'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['77'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['60', '61', '62', '63', '64', '65'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['66'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['67'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['695'], periodStart, periodEnd, 'debit_minus_credit'),
  ]);
  const resultat = (prodExp + prodFin + prodExc) - (chExp + chFin + chExc + isCharge);

  const totalActif = immInc + immCorp - amort - prov + stocks + clients + autresCreances + tvaDed + dispo + chargesConst;
  const totalPassif = capital + reserves + report + resultat + risques + emprunts + fourn + tvaCol + dettesFisc + produitsConst;

  return {
    periodStart,
    periodEnd,
    actif: {
      immobilisationsIncorporelles: { label: 'Immobilisations incorporelles', accountCodes: '20xxx', balanceMinor: immInc },
      immobilisationsCorporelles: { label: 'Immobilisations corporelles', accountCodes: '21-23xxx', balanceMinor: immCorp },
      amortissements: { label: 'Amortissements et dépréciations (–)', accountCodes: '28xxx', balanceMinor: -amort },
      provisions: { label: 'Provisions pour dépréciation (–)', accountCodes: '29xxx', balanceMinor: -prov },
      stocks: { label: 'Stocks', accountCodes: '3xxx', balanceMinor: stocks },
      clientsEtComptes: { label: 'Clients et comptes rattachés', accountCodes: '411xxx', balanceMinor: clients },
      autresCreances: { label: 'Autres créances', accountCodes: '4xxx (hors 40/41/44/45)', balanceMinor: autresCreances },
      tvaDeductible: { label: 'TVA déductible', accountCodes: '4456xxx', balanceMinor: tvaDed },
      disponibilites: { label: 'Disponibilités', accountCodes: '512xxx, 53xxx', balanceMinor: dispo },
      chargesConstatees: { label: 'Charges constatées d\'avance', accountCodes: '486xxx', balanceMinor: chargesConst },
      totalActif,
    },
    passif: {
      capital: { label: 'Capital', accountCodes: '101xxx', balanceMinor: capital },
      reserves: { label: 'Réserves', accountCodes: '106-107xxx', balanceMinor: reserves },
      reportANouveau: { label: 'Report à nouveau', accountCodes: '110-119xxx', balanceMinor: report },
      resultatExercice: { label: 'Résultat de l\'exercice', accountCodes: 'Calculé', balanceMinor: resultat },
      provisionsRisques: { label: 'Provisions pour risques', accountCodes: '15xxx', balanceMinor: risques },
      emprunts: { label: 'Emprunts et dettes assimilées', accountCodes: '16xxx', balanceMinor: emprunts },
      fournisseurs: { label: 'Fournisseurs et comptes rattachés', accountCodes: '401xxx', balanceMinor: fourn },
      tvaCollectee: { label: 'TVA collectée', accountCodes: '4457xxx', balanceMinor: tvaCol },
      dettesFiscales: { label: 'Dettes fiscales et sociales', accountCodes: '43xxx, 444xxx', balanceMinor: dettesFisc },
      produitsConstates: { label: 'Produits constatés d\'avance', accountCodes: '487xxx', balanceMinor: produitsConst },
      totalPassif,
    },
  };
}

export async function computeIncomeStatement(
  workspaceId: string,
  periodStart: string,
  periodEnd: string,
): Promise<IncomeStatement> {
  const [prodExp, prodFin, prodExc, chExp, chFin, chExc, isCharge] = await Promise.all([
    sumAccountBalances(workspaceId, ['70', '71', '72', '73', '74', '75'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['76'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['77'], periodStart, periodEnd, 'credit_minus_debit'),
    sumAccountBalances(workspaceId, ['60', '61', '62', '63', '64', '65'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['66'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['67'], periodStart, periodEnd, 'debit_minus_credit'),
    sumAccountBalances(workspaceId, ['695'], periodStart, periodEnd, 'debit_minus_credit'),
  ]);

  const totalProduits = prodExp + prodFin + prodExc;
  const totalCharges = chExp + chFin + chExc + isCharge;

  return {
    periodStart,
    periodEnd,
    produits: {
      produitsExploitation: { label: 'Produits d\'exploitation', accountCodes: '70-75xxx', balanceMinor: prodExp },
      produitsFinanciers: { label: 'Produits financiers', accountCodes: '76xxx', balanceMinor: prodFin },
      produitsExceptionnels: { label: 'Produits exceptionnels', accountCodes: '77xxx', balanceMinor: prodExc },
      totalProduits,
    },
    charges: {
      chargesExploitation: { label: 'Charges d\'exploitation', accountCodes: '60-65xxx', balanceMinor: chExp },
      chargesFinancieres: { label: 'Charges financières', accountCodes: '66xxx', balanceMinor: chFin },
      chargesExceptionnelles: { label: 'Charges exceptionnelles', accountCodes: '67xxx', balanceMinor: chExc },
      is: { label: 'Impôt sur les sociétés', accountCodes: '695xxx', balanceMinor: isCharge },
      totalCharges,
    },
    resultatNet: totalProduits - totalCharges,
  };
}
