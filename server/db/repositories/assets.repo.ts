import type pg from 'pg';
import { pool } from '../client.js';

export interface AssetRow {
  id: string;
  workspaceId: string;
  label: string;
  assetCategory: string;
  acquisitionDate: string;
  acquisitionCostMinor: number;
  depreciationMethod: 'LINEAR' | 'DECLINING' | 'NONE';
  usefulLifeMonths: number;
  residualValueMinor: number;
  accountCode: string;
  amortAccountCode: string;
  dotationAccountCode: string;
  isDisposed: boolean;
  disposalDate: string | null;
  disposalPriceMinor: number | null;
  journalEntryId: string | null;
  createdAt: string;
}

export interface DepreciationLineRow {
  id: string;
  assetId: string;
  periodLabel: string;
  dotationMinor: number;
  cumulAmortMinor: number;
  netBookValueMinor: number;
  journalEntryId: string | null;
  createdAt: string;
}

function mapAsset(r: Record<string, unknown>): AssetRow {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    label: r.label as string,
    assetCategory: r.asset_category as string,
    acquisitionDate: r.acquisition_date as string,
    acquisitionCostMinor: r.acquisition_cost_minor as number,
    depreciationMethod: r.depreciation_method as 'LINEAR' | 'DECLINING' | 'NONE',
    usefulLifeMonths: (r.useful_life_months as number) ?? 0,
    residualValueMinor: (r.residual_value_minor as number) ?? 0,
    accountCode: r.account_code as string,
    amortAccountCode: r.amort_account_code as string,
    dotationAccountCode: r.dotation_account_code as string,
    isDisposed: r.is_disposed as boolean,
    disposalDate: r.disposal_date as string | null,
    disposalPriceMinor: r.disposal_price_minor as number | null,
    journalEntryId: r.journal_entry_id as string | null,
    createdAt: r.created_at as string,
  };
}

export async function createAsset(
  client: pg.PoolClient,
  workspaceId: string,
  input: {
    label: string;
    assetCategory: string;
    acquisitionDate: string;
    acquisitionCostMinor: number;
    depreciationMethod: 'LINEAR' | 'DECLINING' | 'NONE';
    usefulLifeMonths?: number;
    residualValueMinor?: number;
    accountCode?: string;
    amortAccountCode?: string;
    dotationAccountCode?: string;
  },
): Promise<AssetRow> {
  const { rows } = await client.query(
    `INSERT INTO fixed_assets (
       workspace_id, label, asset_category, acquisition_date, acquisition_cost_minor,
       depreciation_method, useful_life_months, residual_value_minor,
       account_code, amort_account_code, dotation_account_code
     ) VALUES ($1,$2,$3,$4::DATE,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      workspaceId, input.label, input.assetCategory, input.acquisitionDate, input.acquisitionCostMinor,
      input.depreciationMethod, input.usefulLifeMonths ?? null, input.residualValueMinor ?? 0,
      input.accountCode ?? '2154', input.amortAccountCode ?? '2815', input.dotationAccountCode ?? '6811',
    ],
  );
  return mapAsset(rows[0] as Record<string, unknown>);
}

export async function getAssets(workspaceId: string): Promise<AssetRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM fixed_assets WHERE workspace_id = $1 AND is_disposed = false ORDER BY acquisition_date DESC, created_at DESC`,
    [workspaceId],
  );
  return rows.map((r) => mapAsset(r as Record<string, unknown>));
}

export async function getAssetById(workspaceId: string, assetId: string): Promise<AssetRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM fixed_assets WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, assetId],
  );
  return rows[0] ? mapAsset(rows[0] as Record<string, unknown>) : null;
}

export async function getDepreciationLines(workspaceId: string, assetId: string): Promise<DepreciationLineRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM asset_depreciation_lines WHERE workspace_id = $1 AND asset_id = $2 ORDER BY period_label`,
    [workspaceId, assetId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    assetId: r.asset_id as string,
    periodLabel: r.period_label as string,
    dotationMinor: r.dotation_minor as number,
    cumulAmortMinor: r.cumul_amort_minor as number,
    netBookValueMinor: r.net_book_value_minor as number,
    journalEntryId: r.journal_entry_id as string | null,
    createdAt: r.created_at as string,
  }));
}

export async function insertDepreciationLine(
  client: pg.PoolClient,
  workspaceId: string,
  assetId: string,
  line: { periodLabel: string; dotationMinor: number; cumulAmortMinor: number; netBookValueMinor: number },
  journalEntryId?: string,
): Promise<DepreciationLineRow> {
  const { rows } = await client.query(
    `INSERT INTO asset_depreciation_lines (
       workspace_id, asset_id, period_label, dotation_minor, cumul_amort_minor, net_book_value_minor, journal_entry_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (asset_id, period_label) DO UPDATE
       SET dotation_minor = EXCLUDED.dotation_minor,
           cumul_amort_minor = EXCLUDED.cumul_amort_minor,
           net_book_value_minor = EXCLUDED.net_book_value_minor,
           journal_entry_id = EXCLUDED.journal_entry_id
     RETURNING *`,
    [workspaceId, assetId, line.periodLabel, line.dotationMinor, line.cumulAmortMinor, line.netBookValueMinor, journalEntryId ?? null],
  );
  const r = rows[0]!;
  return {
    id: r.id as string,
    assetId: r.asset_id as string,
    periodLabel: r.period_label as string,
    dotationMinor: r.dotation_minor as number,
    cumulAmortMinor: r.cumul_amort_minor as number,
    netBookValueMinor: r.net_book_value_minor as number,
    journalEntryId: r.journal_entry_id as string | null,
    createdAt: r.created_at as string,
  };
}

export async function disposeAsset(
  client: pg.PoolClient,
  workspaceId: string,
  assetId: string,
  disposalDate: string,
  disposalPriceMinor: number,
): Promise<void> {
  await client.query(
    `UPDATE fixed_assets
     SET is_disposed = true, disposal_date = $3::DATE, disposal_price_minor = $4
     WHERE workspace_id = $1 AND id = $2 AND is_disposed = false`,
    [workspaceId, assetId, disposalDate, disposalPriceMinor],
  );
}
