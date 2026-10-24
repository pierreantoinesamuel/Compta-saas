import { pool } from '../client.js';
import type { WorkspaceProfile } from '../../application/workspaceStore.js';

export async function getWorkspace(workspaceId: string): Promise<WorkspaceProfile | null> {
  const { rows } = await pool.query<{
    id: string; legal_name: string; trade_name: string; siren: string; siret: string;
    naf_code: string; legal_form: string; share_capital_minor: number | null;
    rcs_city: string; rcs_number: string; vat_number: string; fiscal_regime: string;
    accounting_mode: string; vat_regime: string; vat_exigibility: string;
    registered_address: { streetLine1: string; postalCode: string; city: string; countryCode: string };
    default_late_penalty_rate: string; default_recovery_indemnity_minor: number;
    default_discount_terms: string;
  }>(
    `SELECT id, legal_name, trade_name, siren, siret, naf_code, legal_form,
            share_capital_minor, rcs_city, rcs_number, vat_number, fiscal_regime,
            accounting_mode, vat_regime, vat_exigibility, registered_address,
            default_late_penalty_rate, default_recovery_indemnity_minor, default_discount_terms
     FROM workspaces WHERE id = $1`,
    [workspaceId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id, legalName: r.legal_name, tradeName: r.trade_name, siren: r.siren, siret: r.siret,
    nafCode: r.naf_code, legalForm: r.legal_form as WorkspaceProfile['legalForm'],
    shareCapitalMinor: r.share_capital_minor, rcsCity: r.rcs_city, rcsNumber: r.rcs_number,
    vatNumber: r.vat_number, fiscalRegime: r.fiscal_regime as WorkspaceProfile['fiscalRegime'],
    accountingMode: r.accounting_mode as WorkspaceProfile['accountingMode'],
    vatRegime: r.vat_regime as WorkspaceProfile['vatRegime'],
    vatExigibility: r.vat_exigibility as WorkspaceProfile['vatExigibility'],
    registeredAddress: r.registered_address,
    defaultLatePenaltyRate: r.default_late_penalty_rate,
    defaultRecoveryIndemnityMinor: r.default_recovery_indemnity_minor,
    defaultDiscountTerms: r.default_discount_terms,
  };
}

export async function updateWorkspace(
  workspaceId: string,
  patch: Partial<Omit<WorkspaceProfile, 'id'>>,
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;
  const add = (col: string, v: unknown) => { sets.push(`${col} = $${idx++}`); vals.push(v); };
  if (patch.legalName !== undefined) add('legal_name', patch.legalName);
  if (patch.tradeName !== undefined) add('trade_name', patch.tradeName);
  if (patch.siren !== undefined) add('siren', patch.siren);
  if (patch.siret !== undefined) add('siret', patch.siret);
  if (patch.nafCode !== undefined) add('naf_code', patch.nafCode);
  if (patch.legalForm !== undefined) add('legal_form', patch.legalForm);
  if (patch.shareCapitalMinor !== undefined) add('share_capital_minor', patch.shareCapitalMinor);
  if (patch.rcsCity !== undefined) add('rcs_city', patch.rcsCity);
  if (patch.rcsNumber !== undefined) add('rcs_number', patch.rcsNumber);
  if (patch.vatNumber !== undefined) add('vat_number', patch.vatNumber);
  if (patch.fiscalRegime !== undefined) add('fiscal_regime', patch.fiscalRegime);
  if (patch.accountingMode !== undefined) add('accounting_mode', patch.accountingMode);
  if (patch.vatRegime !== undefined) add('vat_regime', patch.vatRegime);
  if (patch.vatExigibility !== undefined) add('vat_exigibility', patch.vatExigibility);
  if (patch.registeredAddress !== undefined) add('registered_address', JSON.stringify(patch.registeredAddress));
  if (patch.defaultLatePenaltyRate !== undefined) add('default_late_penalty_rate', patch.defaultLatePenaltyRate);
  if (patch.defaultRecoveryIndemnityMinor !== undefined) add('default_recovery_indemnity_minor', patch.defaultRecoveryIndemnityMinor);
  if (patch.defaultDiscountTerms !== undefined) add('default_discount_terms', patch.defaultDiscountTerms);
  if (sets.length === 0) return;
  vals.push(workspaceId);
  await pool.query(`UPDATE workspaces SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, vals);
}

export async function getJournalId(workspaceId: string, journalCode: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM journals WHERE workspace_id = $1 AND code = $2`,
    [workspaceId, journalCode],
  );
  return rows[0]?.id ?? null;
}

export async function getCurrentPeriodId(workspaceId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM accounting_periods WHERE workspace_id = $1 AND status = 'open'
     ORDER BY period_start DESC LIMIT 1`,
    [workspaceId],
  );
  return rows[0]?.id ?? null;
}

export async function ensureAccountExists(
  workspaceId: string,
  accountCode: string,
  accountLabel: string,
  accountClass: number,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO accounts (workspace_id, account_code, account_label, account_class, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (workspace_id, account_code) DO UPDATE SET account_label = EXCLUDED.account_label
     RETURNING id`,
    [workspaceId, accountCode, accountLabel, accountClass],
  );
  return rows[0]!.id;
}

export async function getAccountId(workspaceId: string, accountCode: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM accounts WHERE workspace_id = $1 AND account_code = $2`,
    [workspaceId, accountCode],
  );
  return rows[0]?.id ?? null;
}

export async function getTaxRuleId(workspaceId: string, taxRuleCode: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM tax_rules WHERE workspace_id = $1 AND code = $2`,
    [workspaceId, taxRuleCode],
  );
  return rows[0]?.id ?? null;
}

export async function getWorkspacePeriodStatus(
  workspaceId: string,
): Promise<'open' | 'closing_review' | 'closed'> {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM accounting_periods WHERE workspace_id = $1
     ORDER BY period_start DESC LIMIT 1`,
    [workspaceId],
  );
  return (rows[0]?.status as 'open' | 'closing_review' | 'closed') ?? 'open';
}
