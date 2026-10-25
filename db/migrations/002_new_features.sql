-- Migration 002: Fixed assets, expense claims, e-signature, cabinet mode, SEPA batches

-- =====================================================================
-- FIXED ASSETS (Immobilisations)
-- =====================================================================
CREATE TABLE IF NOT EXISTS fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  asset_category TEXT NOT NULL,
  acquisition_date DATE NOT NULL,
  acquisition_cost_minor BIGINT NOT NULL CHECK (acquisition_cost_minor > 0),
  depreciation_method TEXT NOT NULL CHECK (depreciation_method IN ('LINEAR', 'DECLINING', 'NONE')),
  useful_life_months INT CHECK (useful_life_months > 0),
  residual_value_minor BIGINT NOT NULL DEFAULT 0,
  account_code TEXT NOT NULL DEFAULT '2154',
  amort_account_code TEXT NOT NULL DEFAULT '2815',
  dotation_account_code TEXT NOT NULL DEFAULT '6811',
  disposal_date DATE,
  disposal_price_minor BIGINT,
  is_disposed BOOLEAN NOT NULL DEFAULT false,
  journal_entry_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_depreciation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period_label TEXT NOT NULL,
  dotation_minor BIGINT NOT NULL,
  cumul_amort_minor BIGINT NOT NULL,
  net_book_value_minor BIGINT NOT NULL,
  journal_entry_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(asset_id, period_label)
);

-- =====================================================================
-- EXPENSE CLAIMS (Notes de frais)
-- =====================================================================
CREATE TABLE IF NOT EXISTS expense_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES users(id),
  claim_date DATE NOT NULL,
  description TEXT NOT NULL,
  total_ttc_minor BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','paid')),
  journal_entry_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_claim_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('MEAL','TRANSPORT','KM','ACCOMMODATION','OTHER')),
  amount_ttc_minor BIGINT NOT NULL CHECK (amount_ttc_minor > 0),
  vat_rate_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  vat_amount_minor BIGINT NOT NULL DEFAULT 0,
  amount_ht_minor BIGINT NOT NULL,
  account_code TEXT NOT NULL DEFAULT '625100',
  deductibility_ratio NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  km_distance NUMERIC(8,2),
  km_rate NUMERIC(8,4),
  receipt_document_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- E-SIGNATURE (Native signature requests)
-- =====================================================================
CREATE TABLE IF NOT EXISTS signature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_id UUID NOT NULL,
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','viewed','signed','expired','cancelled')),
  signed_at TIMESTAMPTZ,
  signer_ip TEXT,
  signer_user_agent TEXT,
  document_hash_before TEXT NOT NULL,
  document_hash_after TEXT,
  audit_trail JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent modifying signed signature requests
CREATE OR REPLACE FUNCTION prevent_signed_request_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'Cannot modify a signed signature request (id=%).',OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_signature_requests_immutable ON signature_requests;
CREATE TRIGGER trg_signature_requests_immutable
  BEFORE UPDATE OR DELETE ON signature_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_signed_request_mutation();

-- =====================================================================
-- CABINET MODE (Accounting firm managing multiple workspaces)
-- =====================================================================
CREATE TABLE IF NOT EXISTS accounting_firms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  siren CHAR(9),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS firm_workspace_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES accounting_firms(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(firm_id, workspace_id)
);

-- =====================================================================
-- SEPA PAYMENT BATCHES
-- =====================================================================
CREATE TABLE IF NOT EXISTS sepa_payment_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_ref TEXT NOT NULL UNIQUE,
  execution_date DATE NOT NULL,
  debtor_iban TEXT NOT NULL,
  debtor_name TEXT NOT NULL,
  total_amount_minor BIGINT NOT NULL,
  tx_count INT NOT NULL,
  xml_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','submitted','executed','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent disposal of already-disposed assets
CREATE OR REPLACE FUNCTION prevent_disposed_asset_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_disposed = true AND TG_OP = 'UPDATE' THEN
    IF NEW.is_disposed = false THEN
      RAISE EXCEPTION 'Cannot reopen disposed asset (id=%).',OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fixed_assets_immutable ON fixed_assets;
CREATE TRIGGER trg_fixed_assets_immutable
  BEFORE UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION prevent_disposed_asset_mutation();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fixed_assets_workspace ON fixed_assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_asset_depr_lines_asset ON asset_depreciation_lines(asset_id);
CREATE INDEX IF NOT EXISTS idx_expense_claims_workspace ON expense_claims(workspace_id);
CREATE INDEX IF NOT EXISTS idx_expense_claim_lines_claim ON expense_claim_lines(claim_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_token ON signature_requests(token);
CREATE INDEX IF NOT EXISTS idx_signature_requests_document ON signature_requests(document_id);
CREATE INDEX IF NOT EXISTS idx_sepa_batches_workspace ON sepa_payment_batches(workspace_id);
CREATE INDEX IF NOT EXISTS idx_firm_assignments_firm ON firm_workspace_assignments(firm_id);
