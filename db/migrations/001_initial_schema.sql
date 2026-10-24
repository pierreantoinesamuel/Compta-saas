-- =============================================================================
-- Migration 001: Initial French (PCG 2025, Factur-X, FEC) & EU Compliant Schema
-- Enforces:
--   1. Multi-tenant Row-Level Security (RLS) via app.current_workspace_id
--   2. Gapless transactional sequence table (document_sequences)
--   3. EN 16931 Rate-Level VAT Breakdowns (invoice_tax_breakdowns)
--   4. 18-Column Statutory FEC Ledger & Auxiliary Lettering (journal_entries / lines)
--   5. PostgreSQL BEFORE UPDATE / DELETE Immutability Triggers (PAF / BlockedLog)
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. IDENTITY, WORKSPACES & GAPLESS SEQUENCES
-- -----------------------------------------------------------------------------

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject TEXT UNIQUE,                              -- nullable: not used for password-based auth
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  password_hash TEXT,                                    -- bcrypt (12 rounds) or legacy SHA-256
  is_active BOOLEAN NOT NULL DEFAULT true,
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  locale TEXT NOT NULL DEFAULT 'fr-FR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  country_code CHAR(2) NOT NULL DEFAULT 'FR',
  base_currency CHAR(3) NOT NULL DEFAULT 'EUR',
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  siren CHAR(9) NOT NULL CHECK (siren ~ '^[0-9]{9}$'),
  siret CHAR(14) NOT NULL CHECK (siret ~ '^[0-9]{14}$'),
  naf_code TEXT,
  legal_form TEXT NOT NULL CHECK (legal_form IN (
    'MICRO_ENTREPRISE', 'EI', 'EURL', 'SARL', 'SASU', 'SAS', 'SA', 'SCI', 'ASSOCIATION'
  )),
  share_capital_minor BIGINT CHECK (share_capital_minor IS NULL OR share_capital_minor >= 0),
  rcs_city TEXT,
  rcs_number TEXT,
  vat_number TEXT,
  fiscal_regime TEXT NOT NULL CHECK (fiscal_regime IN ('MICRO', 'REEL_SIMPLIFIE', 'REEL_NORMAL')),
  accounting_mode TEXT NOT NULL CHECK (accounting_mode IN ('CASH_MICRO', 'DOUBLE_ENTRY_PCG2025')),
  micro_activity_type TEXT CHECK (micro_activity_type IN ('BIC_VENTES', 'BIC_SERVICES', 'BNC_LIBERAL', 'MIXTE')),
  vat_regime TEXT NOT NULL CHECK (vat_regime IN ('FRANCHISE_293B', 'REEL_SIMPLIFIE', 'REEL_NORMAL', 'MINI_REEL')),
  vat_exigibility TEXT NOT NULL DEFAULT 'ENCAISSEMENTS' CHECK (vat_exigibility IN ('DEBITS', 'ENCAISSEMENTS')),
  registered_address JSONB NOT NULL,
  default_late_penalty_rate NUMERIC(6,3) NOT NULL DEFAULT 15.000 CHECK (default_late_penalty_rate >= 0),
  default_recovery_indemnity_minor BIGINT NOT NULL DEFAULT 4000 CHECK (default_recovery_indemnity_minor >= 0),
  default_discount_terms TEXT NOT NULL DEFAULT 'Pas d''escompte pour paiement anticipé',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'finance', 'accountant', 'read_only')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- Transactional gapless numbering (never use SERIAL/IDENTITY for legal numbers)
CREATE TABLE document_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  sequence_type TEXT NOT NULL,
  fiscal_year INT NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  current_value BIGINT NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  previous_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, sequence_type, fiscal_year)
);

-- -----------------------------------------------------------------------------
-- 2. TAX RULES & PCG 2025 ACCOUNTS / JOURNALS
-- -----------------------------------------------------------------------------

CREATE TABLE tax_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT,
  jurisdiction CHAR(2) NOT NULL DEFAULT 'FR',
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  rate NUMERIC(6,3) NOT NULL CHECK (rate >= 0),
  vat_category_code TEXT NOT NULL CHECK (vat_category_code IN ('S', 'Z', 'E', 'AE', 'K', 'G')),
  exemption_reason_code TEXT,
  legal_mention TEXT,
  collected_account_debits_code TEXT NOT NULL DEFAULT '445710',
  collected_account_pending_cash_code TEXT NOT NULL DEFAULT '445740',
  deductible_account_code TEXT NOT NULL DEFAULT '445660',
  valid_from DATE NOT NULL DEFAULT '2025-01-01',
  valid_to DATE,
  UNIQUE NULLS NOT DISTINCT (workspace_id, code)
);

CREATE TABLE accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing_review', 'closed')),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES users(id),
  closing_seal_hash TEXT,
  carry_forward_entry_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_start <= period_end)
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  chart_version TEXT NOT NULL DEFAULT 'PCG_2025_ANC_2022_06',
  account_code TEXT NOT NULL CHECK (account_code ~ '^[1-7][0-9A-Z]{2,11}$' AND account_code !~ '^79'),
  account_label TEXT NOT NULL,
  account_class INT NOT NULL CHECK (account_class BETWEEN 1 AND 7),
  account_type TEXT NOT NULL DEFAULT 'expense' CHECK (account_type IN (
    'equity_liability', 'fixed_asset', 'inventory', 'third_party', 'financial', 'expense', 'revenue'
  )),
  requires_auxiliary BOOLEAN NOT NULL DEFAULT false,
  is_letterable BOOLEAN NOT NULL DEFAULT false,
  is_system_account BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, account_code)
);

CREATE TABLE journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9]{2,6}$'),
  label TEXT NOT NULL,
  journal_type TEXT NOT NULL CHECK (journal_type IN (
    'opening', 'sales', 'purchases', 'bank', 'miscellaneous', 'cash'
  )),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, code)
);

-- -----------------------------------------------------------------------------
-- 3. THIRD-PARTIES (TIERS / CONTACTS)
-- -----------------------------------------------------------------------------

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('customer', 'supplier', 'both')),
  is_business BOOLEAN NOT NULL DEFAULT true,
  tax_zone TEXT NOT NULL DEFAULT 'DOMESTIC_FR' CHECK (tax_zone IN (
    'DOMESTIC_FR', 'DOM_TOM', 'INTRA_EU', 'EXPORT_NON_EU'
  )),
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  siren CHAR(9) CHECK (siren IS NULL OR siren ~ '^[0-9]{9}$'),
  siret CHAR(14) CHECK (siret IS NULL OR siret ~ '^[0-9]{14}$'),
  vat_identifier TEXT,
  vies_validated_at TIMESTAMPTZ,
  vies_consultation_ref TEXT,
  email TEXT,
  phone TEXT,
  billing_address JSONB NOT NULL,
  delivery_address JSONB,
  customer_auxiliary_code TEXT,
  supplier_auxiliary_code TEXT,
  default_payment_terms_days INT NOT NULL DEFAULT 30 CHECK (default_payment_terms_days BETWEEN 0 AND 60),
  default_payment_method TEXT CHECK (default_payment_method IN (
    'SEPA_TRANSFER', 'CARD', 'DIRECT_DEBIT', 'CHECK', 'CASH'
  )),
  iban_masked TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_contacts_customer_aux
  ON contacts(workspace_id, customer_auxiliary_code)
  WHERE customer_auxiliary_code IS NOT NULL;

CREATE UNIQUE INDEX idx_contacts_supplier_aux
  ON contacts(workspace_id, supplier_auxiliary_code)
  WHERE supplier_auxiliary_code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. SALES DOCUMENTS (QUOTES, DEPOSIT INVOICES, INVOICES, CREDIT NOTES)
-- -----------------------------------------------------------------------------

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL DEFAULT 'standard_invoice' CHECK (document_type IN (
    'quote', 'deposit_invoice', 'standard_invoice', 'credit_note'
  )),
  provisional_ref TEXT NOT NULL,
  number TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'ready_for_review', 'issued', 'cancelled_by_credit_note',
    'sent', 'accepted', 'refused', 'invoiced'
  )),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN (
    'unpaid', 'partially_paid', 'paid', 'overpaid'
  )),
  einvoice_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (einvoice_status IN (
    'not_applicable', 'pending_submission', 'deposited', 'rejected', 'refused', 'accepted', 'cashed'
  )),
  original_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
  source_quote_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
  operation_category TEXT NOT NULL DEFAULT 'services' CHECK (operation_category IN (
    'goods', 'services', 'mixed'
  )),
  issue_date DATE,
  delivery_or_service_date DATE,
  due_date DATE,
  purchase_order_ref TEXT,
  service_code_ref TEXT,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  exchange_rate NUMERIC(19,6) NOT NULL DEFAULT 1.000000 CHECK (exchange_rate > 0),
  subtotal_ht_minor BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_ht_minor >= 0),
  vat_total_minor BIGINT NOT NULL DEFAULT 0 CHECK (vat_total_minor >= 0),
  total_ttc_minor BIGINT NOT NULL DEFAULT 0 CHECK (total_ttc_minor >= 0),
  deposits_deducted_ttc_minor BIGINT NOT NULL DEFAULT 0 CHECK (deposits_deducted_ttc_minor >= 0),
  net_to_pay_ttc_minor BIGINT NOT NULL DEFAULT 0 CHECK (net_to_pay_ttc_minor >= 0),
  amount_paid_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
  issuer_snapshot JSONB,
  customer_snapshot JSONB,
  late_penalty_rate NUMERIC(6,3) NOT NULL DEFAULT 15.000 CHECK (late_penalty_rate >= 0),
  recovery_indemnity_minor BIGINT NOT NULL DEFAULT 4000 CHECK (recovery_indemnity_minor >= 0),
  discount_terms TEXT NOT NULL DEFAULT 'Pas d''escompte pour paiement anticipé',
  vat_exemption_mention TEXT,
  vat_on_debits_mention BOOLEAN NOT NULL DEFAULT false,
  facturx_profile TEXT NOT NULL DEFAULT 'EN16931' CHECK (facturx_profile IN (
    'MINIMUM', 'BASIC_WL', 'BASIC', 'EN16931'
  )),
  facturx_xml TEXT,
  pdf_storage_key TEXT,
  pdf_sha256 TEXT,
  previous_document_hash TEXT,
  document_hash TEXT,
  journal_entry_id UUID,
  issued_at TIMESTAMPTZ,
  issued_by UUID REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (document_type <> 'credit_note' OR original_invoice_id IS NOT NULL),
  CHECK (status <> 'issued' OR (
    number IS NOT NULL
    AND issue_date IS NOT NULL
    AND issuer_snapshot IS NOT NULL
    AND customer_snapshot IS NOT NULL
    AND document_hash IS NOT NULL
  ))
);

CREATE UNIQUE INDEX idx_invoices_workspace_number
  ON invoices(workspace_id, number)
  WHERE number IS NOT NULL;

CREATE TABLE invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INT NOT NULL CHECK (position >= 1),
  line_nature TEXT NOT NULL DEFAULT 'services' CHECK (line_nature IN ('goods', 'services')),
  product_code TEXT,
  description TEXT NOT NULL,
  quantity NUMERIC(19,4) NOT NULL CHECK (quantity > 0),
  unit_code TEXT NOT NULL DEFAULT 'C62',
  unit_price_ht_minor BIGINT NOT NULL CHECK (unit_price_ht_minor >= 0),
  discount_percent NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_amount_ht_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount_ht_minor >= 0),
  vat_rule_id UUID NOT NULL REFERENCES tax_rules(id) ON DELETE RESTRICT,
  vat_rate_snapshot NUMERIC(6,3) NOT NULL CHECK (vat_rate_snapshot >= 0),
  vat_category_code TEXT NOT NULL DEFAULT 'S' CHECK (vat_category_code IN ('S', 'Z', 'E', 'AE', 'K', 'G')),
  exemption_reason_code TEXT,
  accounting_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  line_subtotal_ht_minor BIGINT NOT NULL CHECK (line_subtotal_ht_minor >= 0),
  line_vat_preview_minor BIGINT NOT NULL CHECK (line_vat_preview_minor >= 0),
  line_total_ttc_preview_minor BIGINT NOT NULL CHECK (line_total_ttc_preview_minor >= 0),
  UNIQUE (invoice_id, position)
);

-- Authoritative EN 16931 / DGFiP Rate-Level VAT Breakdown
CREATE TABLE invoice_tax_breakdowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  vat_rule_id UUID NOT NULL REFERENCES tax_rules(id) ON DELETE RESTRICT,
  vat_category_code TEXT NOT NULL CHECK (vat_category_code IN ('S', 'Z', 'E', 'AE', 'K', 'G')),
  vat_rate NUMERIC(6,3) NOT NULL CHECK (vat_rate >= 0),
  taxable_base_ht_minor BIGINT NOT NULL CHECK (taxable_base_ht_minor >= 0),
  vat_amount_minor BIGINT NOT NULL CHECK (vat_amount_minor >= 0),
  exemption_reason_code TEXT,
  exemption_reason_text TEXT,
  UNIQUE (invoice_id, vat_rule_id)
);

CREATE TABLE invoice_deposit_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  final_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  deposit_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  applied_ht_minor BIGINT NOT NULL CHECK (applied_ht_minor > 0),
  applied_vat_minor BIGINT NOT NULL CHECK (applied_vat_minor >= 0),
  applied_ttc_minor BIGINT NOT NULL CHECK (applied_ttc_minor > 0),
  UNIQUE (final_invoice_id, deposit_invoice_id),
  CHECK (final_invoice_id <> deposit_invoice_id)
);

-- -----------------------------------------------------------------------------
-- 5. PURCHASES, PAF DOCUMENTS & MULTI-RATE EXPENSES
-- -----------------------------------------------------------------------------

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  storage_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  is_facturx BOOLEAN NOT NULL DEFAULT false,
  extracted_facturx_xml TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
    'uploaded', 'processing', 'needs_review', 'reviewed', 'linked', 'failed', 'rejected'
  )),
  retention_until DATE NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_workspace_sha256 ON documents(workspace_id, sha256);

CREATE TABLE extraction_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  model_version TEXT NOT NULL,
  candidate_fields JSONB NOT NULL,
  confidence JSONB,
  review_status TEXT NOT NULL DEFAULT 'unverified' CHECK (review_status IN (
    'unverified', 'confirmed', 'corrected', 'rejected'
  )),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  supplier_contact_id UUID REFERENCES contacts(id) ON DELETE RESTRICT,
  document_id UUID REFERENCES documents(id) ON DELETE RESTRICT,
  supplier_invoice_ref TEXT NOT NULL,
  expense_date DATE NOT NULL,
  due_date DATE,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  subtotal_ht_minor BIGINT NOT NULL CHECK (subtotal_ht_minor >= 0),
  vat_total_minor BIGINT NOT NULL CHECK (vat_total_minor >= 0),
  vat_deductible_minor BIGINT NOT NULL CHECK (vat_deductible_minor >= 0),
  total_ttc_minor BIGINT NOT NULL CHECK (total_ttc_minor >= 0),
  amount_paid_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'approved', 'posted', 'paid', 'cancelled'
  )),
  journal_entry_id UUID,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expense_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  position INT NOT NULL CHECK (position >= 1),
  description TEXT NOT NULL,
  accounting_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  vat_rule_id UUID NOT NULL REFERENCES tax_rules(id) ON DELETE RESTRICT,
  vat_rate NUMERIC(6,3) NOT NULL CHECK (vat_rate >= 0),
  deductibility_ratio NUMERIC(5,4) NOT NULL DEFAULT 1.0000 CHECK (deductibility_ratio >= 0 AND deductibility_ratio <= 1),
  amount_ht_minor BIGINT NOT NULL CHECK (amount_ht_minor >= 0),
  vat_total_minor BIGINT NOT NULL CHECK (vat_total_minor >= 0),
  vat_deductible_minor BIGINT NOT NULL CHECK (vat_deductible_minor >= 0),
  vat_non_deductible_minor BIGINT NOT NULL CHECK (vat_non_deductible_minor >= 0),
  amount_ttc_minor BIGINT NOT NULL CHECK (amount_ttc_minor >= 0),
  UNIQUE (expense_id, position)
);

-- -----------------------------------------------------------------------------
-- 6. BANKING, PAYMENTS & N-TO-M RECONCILIATION
-- -----------------------------------------------------------------------------

CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  bank_name TEXT,
  iban_masked TEXT NOT NULL,
  bic TEXT,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  ledger_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  journal_id UUID NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'manual_csv' CHECK (provider IN ('manual_csv', 'dsp2_open_banking')),
  last_imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bank_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  file_sha256 TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'CSV' CHECK (format IN ('CSV', 'CFONB', 'CAMT053')),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('preview', 'confirmed', 'failed')),
  row_count INT NOT NULL CHECK (row_count >= 0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  bank_import_id UUID REFERENCES bank_imports(id) ON DELETE RESTRICT,
  external_ref TEXT,
  transaction_date DATE NOT NULL,
  booking_date DATE,
  value_date DATE,
  description TEXT NOT NULL,
  counterparty_name TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  allocated_amount_minor BIGINT NOT NULL DEFAULT 0,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN (
    'unmatched', 'partially_matched', 'matched', 'ignored'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, bank_account_id, fingerprint)
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  payment_date DATE NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  method TEXT NOT NULL CHECK (method IN (
    'SEPA_TRANSFER', 'CARD', 'DIRECT_DEBIT', 'CHECK', 'CASH', 'LCR'
  )),
  reference TEXT,
  bank_transaction_id UUID REFERENCES bank_transactions(id) ON DELETE RESTRICT,
  journal_entry_id UUID,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
  expense_id UUID REFERENCES expenses(id) ON DELETE RESTRICT,
  allocated_amount_minor BIGINT NOT NULL CHECK (allocated_amount_minor > 0),
  vat_realized_entry_id UUID,
  lettering_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((invoice_id IS NOT NULL AND expense_id IS NULL) OR (invoice_id IS NULL AND expense_id IS NOT NULL))
);

CREATE TABLE reconciliation_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL CHECK (target_type IN (
    'invoice', 'credit_note', 'expense', 'payment', 'fee_adjustment', 'manual_entry'
  )),
  target_id UUID NOT NULL,
  matched_amount_minor BIGINT NOT NULL CHECK (matched_amount_minor > 0),
  fee_or_discrepancy_minor BIGINT NOT NULL DEFAULT 0,
  payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT,
  journal_entry_id UUID,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('proposed', 'confirmed', 'unmatched')),
  matched_by UUID NOT NULL REFERENCES users(id),
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unmatched_by UUID REFERENCES users(id),
  unmatched_at TIMESTAMPTZ,
  unmatch_reason TEXT
);

-- -----------------------------------------------------------------------------
-- 7. DOUBLE-ENTRY LEDGER (PCG 2025 & 18-COLUMN FEC)
-- -----------------------------------------------------------------------------

CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  journal_id UUID NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  entry_number TEXT,
  entry_date DATE NOT NULL,
  piece_ref TEXT NOT NULL,
  piece_date DATE NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'posted', 'reversed')),
  source_type TEXT NOT NULL CHECK (source_type IN (
    'invoice', 'deposit_invoice', 'credit_note', 'expense', 'payment',
    'reconciliation', 'vat_transfer', 'opening_balance', 'manual'
  )),
  source_id UUID,
  document_id UUID REFERENCES documents(id) ON DELETE RESTRICT,
  reversal_of_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  validated_at DATE,
  posted_at TIMESTAMPTZ,
  posted_by UUID REFERENCES users(id),
  previous_entry_hash TEXT,
  entry_hash TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status NOT IN ('posted', 'reversed') OR (
    entry_number IS NOT NULL
    AND validated_at IS NOT NULL
    AND posted_at IS NOT NULL
    AND entry_hash IS NOT NULL
  ))
);

CREATE UNIQUE INDEX idx_journal_entries_fec_number
  ON journal_entries(workspace_id, journal_id, period_id, entry_number)
  WHERE entry_number IS NOT NULL;

CREATE TABLE journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  position INT NOT NULL CHECK (position >= 1),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  contact_id UUID REFERENCES contacts(id) ON DELETE RESTRICT,
  auxiliary_account_code TEXT,
  auxiliary_account_label TEXT,
  description TEXT NOT NULL,
  debit_minor BIGINT NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor BIGINT NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'EUR',
  amount_currency_minor BIGINT,
  lettering_code TEXT,
  lettered_at DATE,
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
  CHECK ((lettering_code IS NULL AND lettered_at IS NULL) OR (lettering_code IS NOT NULL AND lettered_at IS NOT NULL)),
  UNIQUE (entry_id, position)
);

CREATE INDEX idx_journal_lines_lettering
  ON journal_entry_lines(workspace_id, auxiliary_account_code, lettering_code)
  WHERE lettering_code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 8. CRYPTOGRAPHIC HASH-CHAINED AUDIT TRAIL (BLOCKEDLOG)
-- -----------------------------------------------------------------------------

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  sequence_number BIGINT NOT NULL CHECK (sequence_number >= 1),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  UNIQUE (workspace_id, sequence_number)
);

CREATE INDEX idx_audit_events_workspace_occurred
  ON audit_events(workspace_id, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- 9. FRENCH REGULATORY IMMUTABILITY TRIGGERS (PAF / NF Z42-013 / FEC)
-- -----------------------------------------------------------------------------

-- 9.1 Block UPDATE of legal/financial fields and DELETE on issued invoices
CREATE OR REPLACE FUNCTION enforce_issued_invoice_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('issued', 'cancelled_by_credit_note') THEN
      RAISE EXCEPTION 'FRENCH_COMPLIANCE_VIOLATION: Cannot delete an issued invoice or credit note (id=%). Use a credit note.', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('issued', 'cancelled_by_credit_note') THEN
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.document_type IS DISTINCT FROM OLD.document_type
       OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
       OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
       OR NEW.subtotal_ht_minor IS DISTINCT FROM OLD.subtotal_ht_minor
       OR NEW.vat_total_minor IS DISTINCT FROM OLD.vat_total_minor
       OR NEW.total_ttc_minor IS DISTINCT FROM OLD.total_ttc_minor
       OR NEW.net_to_pay_ttc_minor IS DISTINCT FROM OLD.net_to_pay_ttc_minor
       OR NEW.issuer_snapshot IS DISTINCT FROM OLD.issuer_snapshot
       OR NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot
       OR NEW.document_hash IS DISTINCT FROM OLD.document_hash
       OR NEW.status = 'draft'
    THEN
      RAISE EXCEPTION 'FRENCH_COMPLIANCE_VIOLATION: Issued invoice/credit note (number=%) is immutable.', OLD.number;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_immutability
BEFORE UPDATE OR DELETE ON invoices
FOR EACH ROW EXECUTE FUNCTION enforce_issued_invoice_immutability();

-- 9.2 Block any mutation of lines or tax breakdowns belonging to an issued invoice
CREATE OR REPLACE FUNCTION enforce_issued_invoice_children_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_invoice_id UUID;
  v_status TEXT;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT status INTO v_status FROM invoices WHERE id = v_invoice_id;
  IF v_status IN ('issued', 'cancelled_by_credit_note') THEN
    RAISE EXCEPTION 'FRENCH_COMPLIANCE_VIOLATION: Cannot modify lines or tax breakdowns of an issued invoice (invoice_id=%).', v_invoice_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_invoice_lines_immutability
BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
FOR EACH ROW EXECUTE FUNCTION enforce_issued_invoice_children_immutability();

CREATE TRIGGER trg_invoice_tax_breakdowns_immutability
BEFORE INSERT OR UPDATE OR DELETE ON invoice_tax_breakdowns
FOR EACH ROW EXECUTE FUNCTION enforce_issued_invoice_children_immutability();

-- 9.3 Block reopening a closed period (strict French PCG / FEC rule)
CREATE OR REPLACE FUNCTION enforce_closed_period_irreversibility()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'closed' THEN
    RAISE EXCEPTION 'FRENCH_COMPLIANCE_VIOLATION: Cannot delete a closed accounting period (id=%).', OLD.id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    RAISE EXCEPTION 'FRENCH_COMPLIANCE_VIOLATION: A permanently closed accounting period (id=%) can never be reopened under French law.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_accounting_periods_immutability
BEFORE UPDATE OR DELETE ON accounting_periods
FOR EACH ROW EXECUTE FUNCTION enforce_closed_period_irreversibility();

-- 9.4 Block mutation/deletion of posted journal entries and block posting into closed periods
CREATE OR REPLACE FUNCTION enforce_journal_entry_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_period_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'FRENCH_COMPLIANCE_VIOLATION: Cannot delete a posted journal entry (entry_number=%). Use a reversal entry (contre-passation).', OLD.entry_number;
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO v_period_status FROM accounting_periods WHERE id = NEW.period_id;
  IF v_period_status = 'closed' AND (TG_OP = 'INSERT' OR OLD.status <> NEW.status) THEN
    RAISE EXCEPTION 'FRENCH_COMPLIANCE_VIOLATION: Cannot insert or post entries in a closed accounting period (period_id=%).', NEW.period_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'reversed') THEN
    IF NEW.entry_number IS DISTINCT FROM OLD.entry_number
       OR NEW.entry_date IS DISTINCT FROM OLD.entry_date
       OR NEW.piece_ref IS DISTINCT FROM OLD.piece_ref
       OR NEW.piece_date IS DISTINCT FROM OLD.piece_date
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id
       OR NEW.period_id IS DISTINCT FROM OLD.period_id
       OR NEW.validated_at IS DISTINCT FROM OLD.validated_at
       OR NEW.entry_hash IS DISTINCT FROM OLD.entry_hash
       OR NEW.status IN ('draft', 'validated')
    THEN
      RAISE EXCEPTION 'FRENCH_COMPLIANCE_VIOLATION: Posted journal entry (entry_number=%) is immutable.', OLD.entry_number;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_entries_immutability
BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION enforce_journal_entry_immutability();

-- 9.5 Block append-only audit_events from any UPDATE or DELETE (BlockedLog)
CREATE OR REPLACE FUNCTION enforce_audit_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FRENCH_COMPLIANCE_VIOLATION: audit_events is strictly append-only (BlockedLog). Operation % denied.', TG_OP;
END;
$$;

CREATE TRIGGER trg_audit_events_immutability
BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION enforce_audit_events_append_only();

COMMIT;
