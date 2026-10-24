# Logical Data Model — French (PCG 2025 / FEC / Factur-X) & EU Compliant

All tenant-owned tables include `workspace_id UUID NOT NULL` with foreign-key constraints and PostgreSQL Row-Level Security (RLS). UUIDv7 or UUIDv4 primary keys are used. All timestamps are `TIMESTAMPTZ` (UTC), dates are ISO `DATE`, and monetary amounts are stored as `BIGINT` minor units (euro cents) alongside explicit ISO 4217 currency codes.

---

## 1. Identity, Workspace & Gapless Numbering Sequences

### `users`
- `id UUID PK`
- `auth_subject TEXT UNIQUE NOT NULL`
- `email TEXT UNIQUE NOT NULL`
- `full_name TEXT`
- `mfa_enabled BOOLEAN NOT NULL DEFAULT false`
- `locale TEXT NOT NULL DEFAULT 'fr-FR'`
- `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`

### `workspaces` (French Company / Entrepreneur Legal Profile)
- `id UUID PK`
- `legal_name TEXT NOT NULL` — Raison sociale ou Nom/Prénom (EI / Micro-entrepreneur)
- `trade_name TEXT NULL` — Nom commercial
- `country_code CHAR(2) NOT NULL DEFAULT 'FR'`
- `base_currency CHAR(3) NOT NULL DEFAULT 'EUR'`
- `timezone TEXT NOT NULL DEFAULT 'Europe/Paris'`
- `siren CHAR(9) NOT NULL` — Validated via Luhn algorithm
- `siret CHAR(14) NOT NULL` — 14-digit establishment identifier (Luhn-checked)
- `naf_code TEXT NULL` — Code APE/NAF (e.g. `6201Z`)
- `legal_form TEXT NOT NULL` — `'MICRO_ENTREPRISE' | 'EI' | 'EURL' | 'SARL' | 'SASU' | 'SAS' | 'SA' | 'SCI' | 'ASSOCIATION'`
- `share_capital_minor BIGINT NULL` — Capital social in cents (mandatory on invoices for SARL/EURL/SAS/SASU/SA)
- `rcs_city TEXT NULL` — Ville du Greffe (e.g. `Paris`)
- `rcs_number TEXT NULL` — Numéro RCS or RM (Répertoire des Métiers)
- `vat_number TEXT NULL` — Numéro de TVA Intracommunautaire (e.g. `FRXX123456789`)
- `fiscal_regime TEXT NOT NULL` — `'MICRO' | 'REEL_SIMPLIFIE' | 'REEL_NORMAL'`
- `accounting_mode TEXT NOT NULL` — `'CASH_MICRO' | 'DOUBLE_ENTRY_PCG2025'`
- `micro_activity_type TEXT NULL` — `'BIC_VENTES' | 'BIC_SERVICES' | 'BNC_LIBERAL' | 'MIXTE'` (for Micro-entreprise thresholds)
- `vat_regime TEXT NOT NULL` — `'FRANCHISE_293B' | 'REEL_SIMPLIFIE' | 'REEL_NORMAL' | 'MINI_REEL'`
- `vat_exigibility TEXT NOT NULL DEFAULT 'ENCAISSEMENTS'` — `'DEBITS' | 'ENCAISSEMENTS'` (*Option pour le paiement de la TVA d'après les débits* vs *TVA sur les encaissements*)
- `registered_address JSONB NOT NULL` — `{ streetLine1, streetLine2, postalCode, city, countryCode }`
- `default_late_penalty_rate NUMERIC(6,3) NOT NULL DEFAULT 15.000` — Taux des pénalités de retard (min $3 \times$ taux d'intérêt légal)
- `default_recovery_indemnity_minor BIGINT NOT NULL DEFAULT 4000` — Indemnité forfaitaire B2B de 40,00 € (Art. D441-5 Code de commerce)
- `default_discount_terms TEXT NOT NULL DEFAULT 'Pas d''escompte pour paiement anticipé'`
- `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`

### `workspace_memberships`
- `workspace_id UUID FK NOT NULL`
- `user_id UUID FK NOT NULL`
- `role TEXT NOT NULL` — `'owner' | 'admin' | 'finance' | 'accountant' | 'read_only'`
- `status TEXT NOT NULL` — `'invited' | 'active' | 'revoked'`
- `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`
- PK `(workspace_id, user_id)`

### `document_sequences` (Transactional Gapless Numbering — Art. 242 nonies A CGI & FEC)
- `id UUID PK`
- `workspace_id UUID FK NOT NULL`
- `sequence_type TEXT NOT NULL` — `'QUOTE' | 'INVOICE' | 'DEPOSIT_INVOICE' | 'CREDIT_NOTE' | 'JOURNAL_VE' | 'JOURNAL_AC' | 'JOURNAL_BQ' | 'JOURNAL_OD' | 'JOURNAL_AN'`
- `fiscal_year INT NOT NULL` — e.g. `2026`
- `prefix TEXT NOT NULL` — e.g. `'DEV-2026-'`, `'FA-2026-'`, `'AC-2026-'`, `'AV-2026-'`, `'VE-2026-'`
- `padding_length INT NOT NULL DEFAULT 5`
- `current_value BIGINT NOT NULL DEFAULT 0`
- `last_record_hash TEXT NULL` — Latest SHA-256 hash in this sequence for cryptographic chaining
- `updated_at TIMESTAMPTZ NOT NULL`
- Unique `(workspace_id, sequence_type, fiscal_year)`
- *Note*: Always locked via `SELECT ... FOR UPDATE` inside the issuance/posting transaction; never use PostgreSQL `SERIAL` which creates gaps on rollback.

---

## 2. Third-Parties (`Tiers` — Contacts)

### `contacts`
- `id UUID PK`
- `workspace_id UUID FK NOT NULL`
- `kind TEXT NOT NULL` — `'customer' | 'supplier' | 'both'`
- `is_business BOOLEAN NOT NULL DEFAULT true` — `true` = B2B (Professionnel), `false` = B2C (Particulier)
- `tax_zone TEXT NOT NULL DEFAULT 'DOMESTIC_FR'` — `'DOMESTIC_FR' | 'DOM_TOM' | 'INTRA_EU' | 'EXPORT_NON_EU'`
- `legal_name TEXT NOT NULL`
- `trade_name TEXT NULL`
- `siren CHAR(9) NULL` — Mandatory before issuing a B2B invoice in `DOMESTIC_FR` (2026 e-invoicing reform)
- `siret CHAR(14) NULL`
- `vat_identifier TEXT NULL` — Intra-EU VAT number (mandatory for `INTRA_EU` B2B reverse charge)
- `vies_validated_at TIMESTAMPTZ NULL` — Timestamp of last valid EU VIES check
- `vies_consultation_ref TEXT NULL` — Official VIES consultation identifier for tax audit proof
- `email TEXT NULL`, `phone TEXT NULL`
- `billing_address JSONB NOT NULL` — `{ streetLine1, streetLine2, postalCode, city, countryCode }`
- `delivery_address JSONB NULL` — Optional default delivery address
- `customer_auxiliary_code TEXT NULL` — FEC `CompAuxNum` for customer ledger (e.g. `411CLI0001`)
- `supplier_auxiliary_code TEXT NULL` — FEC `CompAuxNum` for supplier ledger (e.g. `401FOU0001`)
- `default_payment_terms_days INT NOT NULL DEFAULT 30` — Checked against French legal caps (max 60 days net or 45 days end-of-month per Art. L441-10 Code de commerce)
- `default_payment_method TEXT NULL` — `'SEPA_TRANSFER' | 'CARD' | 'DIRECT_DEBIT' | 'CHECK' | 'CASH'`
- `iban_masked TEXT NULL`
- `archived_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`
- Unique `(workspace_id, customer_auxiliary_code)` where not null
- Unique `(workspace_id, supplier_auxiliary_code)` where not null

---

## 3. Sales Documents (Quotes, Deposit Invoices, Standard Invoices & Credit Notes)

### `invoices` (Unified Sales Document Header — Dolibarr `llx_facture` pattern)
- `id UUID PK`
- `workspace_id UUID FK NOT NULL`
- `contact_id UUID FK NOT NULL`
- `document_type TEXT NOT NULL DEFAULT 'standard_invoice'` — `'quote' | 'deposit_invoice' | 'standard_invoice' | 'credit_note'`
- `provisional_ref TEXT NOT NULL` — Dolibarr-style draft reference, e.g. `'PROV-00042'`
- `number TEXT NULL` — Allocated only at issuance (e.g. `'FA-2026-00001'`, `'AV-2026-00001'`), `NOT NULL` when `status = 'issued'`
- `status TEXT NOT NULL DEFAULT 'draft'` — `'draft' | 'ready_for_review' | 'issued' | 'cancelled_by_credit_note'` (for quotes: `'draft' | 'sent' | 'accepted' | 'refused' | 'invoiced'`)
- `payment_status TEXT NOT NULL DEFAULT 'unpaid'` — `'unpaid' | 'partially_paid' | 'paid' | 'overpaid'`
- `einvoice_status TEXT NOT NULL DEFAULT 'not_applicable'` — `'not_applicable' | 'pending_submission' | 'deposited' | 'rejected' | 'refused' | 'accepted' | 'cashed'` (2026 PDP/PPF lifecycle)
- `original_invoice_id UUID FK NULL` — Mandatory when `document_type = 'credit_note'` (links to the corrected invoice)
- `source_quote_id UUID FK NULL` — Optional link to the originating quote
- `operation_category TEXT NOT NULL DEFAULT 'services'` — `'goods' | 'services' | 'mixed'` (Mandatory 2026 French e-invoicing mention)
- `issue_date DATE NULL` — Set and locked at issuance
- `delivery_or_service_date DATE NULL` — Mandatory French mention (*Date de livraison ou de fin d'exécution de la prestation*)
- `due_date DATE NULL` — *Date d'échéance du règlement*
- `purchase_order_ref TEXT NULL` — Client buyer reference (*Numéro de bon de commande* / Chorus Pro `BT-13`)
- `service_code_ref TEXT NULL` — Chorus Pro / public sector service code (`BT-14`) if applicable
- `currency CHAR(3) NOT NULL DEFAULT 'EUR'`
- `exchange_rate NUMERIC(19,6) NOT NULL DEFAULT 1.000000`
- `subtotal_ht_minor BIGINT NOT NULL DEFAULT 0` — Sum of net taxable bases across all tax breakdowns
- `vat_total_minor BIGINT NOT NULL DEFAULT 0` — Sum of rate-level rounded VAT amounts (`invoice_tax_breakdowns`)
- `total_ttc_minor BIGINT NOT NULL DEFAULT 0` — `subtotal_ht_minor + vat_total_minor`
- `deposits_deducted_ttc_minor BIGINT NOT NULL DEFAULT 0` — Sum of applied deposit invoices deducted on a final invoice
- `net_to_pay_ttc_minor BIGINT NOT NULL DEFAULT 0` — `total_ttc_minor - deposits_deducted_ttc_minor`
- `amount_paid_minor BIGINT NOT NULL DEFAULT 0`
- `issuer_snapshot JSONB NULL` — `NOT NULL` when issued (freezes workspace legal name, SIREN/SIRET, RCS, capital, address, VAT number, VAT exigibility mention)
- `customer_snapshot JSONB NULL` — `NOT NULL` when issued (freezes customer legal name, SIREN/SIRET, VAT number, billing & delivery addresses)
- `late_penalty_rate NUMERIC(6,3) NOT NULL` — Frozen at issuance
- `recovery_indemnity_minor BIGINT NOT NULL DEFAULT 4000` — `4000` (€40) for B2B, `0` for B2C
- `discount_terms TEXT NOT NULL` — Frozen at issuance
- `vat_exemption_mention TEXT NULL` — Mandatory legal clause if any line is 0% VAT (e.g. *Art. 293 B CGI*, *Art. 283-2 CGI Autoliquidation*, *Art. 262 ter I CGI*)
- `vat_on_debits_mention BOOLEAN NOT NULL DEFAULT false` — True if workspace opted for *Paiement de la TVA d'après les débits*
- `facturx_profile TEXT NOT NULL DEFAULT 'EN16931'` — `'MINIMUM' | 'BASIC_WL' | 'BASIC' | 'EN16931'`
- `facturx_xml TEXT NULL` — Validated EN 16931 CII XML payload generated at issuance
- `pdf_storage_key TEXT NULL` — Storage key of the immutable Factur-X PDF/A-3 file
- `pdf_sha256 TEXT NULL`
- `previous_document_hash TEXT NULL` — SHA-256 hash of preceding document in sequence
- `document_hash TEXT NULL` — SHA-256 hash of this issued document (`NOT NULL` when `status = 'issued'`)
- `journal_entry_id UUID FK NULL` — Link to the generated `VE` accounting entry
- `issued_at TIMESTAMPTZ NULL`, `issued_by UUID FK NULL`
- `created_by UUID FK NOT NULL`, `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`
- Partial unique index `(workspace_id, number) WHERE number IS NOT NULL`
- Protected by PostgreSQL trigger blocking `UPDATE` of financial/legal columns and `DELETE` once `status = 'issued'`.

### `invoice_lines`
- `id UUID PK`
- `workspace_id UUID FK NOT NULL`
- `invoice_id UUID FK NOT NULL`
- `position INT NOT NULL`
- `line_nature TEXT NOT NULL DEFAULT 'services'` — `'goods' | 'services'`
- `product_code TEXT NULL`
- `description TEXT NOT NULL`
- `quantity NUMERIC(19,4) NOT NULL`
- `unit_code TEXT NOT NULL DEFAULT 'C62'` — UN/ECE Rec 20 code required by Factur-X (`C62` unit, `HUR` hour, `DAY` day, `MON` month)
- `unit_price_ht_minor BIGINT NOT NULL` — Unit price in cents (or high-precision `unit_price_ht NUMERIC(19,4)`)
- `discount_percent NUMERIC(6,3) NOT NULL DEFAULT 0`
- `discount_amount_ht_minor BIGINT NOT NULL DEFAULT 0`
- `vat_rule_id UUID FK NOT NULL`
- `vat_rate_snapshot NUMERIC(6,3) NOT NULL` — e.g. `20.000`, `10.000`, `5.500`, `2.100`, `0.000`
- `vat_category_code TEXT NOT NULL DEFAULT 'S'` — EN 16931 duty/tax category code (`S` Standard, `Z` Zero-rated, `E` Exempt, `AE` VAT Reverse Charge, `K` Intra-EU supply, `G` Export)
- `exemption_reason_code TEXT NULL` — EN 16931 VATEX code (e.g. `VATEX-EU-FR-FRANCHISE` for Art. 293 B CGI, `VATEX-EU-AE` for reverse charge)
- `accounting_account_id UUID FK NULL` — PCG 2025 revenue account (`706xxx`, `707xxx`, `708xxx`)
- `line_subtotal_ht_minor BIGINT NOT NULL` — Authoritative line net HT in cents
- `line_vat_preview_minor BIGINT NOT NULL` — Informational line-level VAT preview; authoritative VAT is in `invoice_tax_breakdowns`
- `line_total_ttc_preview_minor BIGINT NOT NULL`
- Unique `(invoice_id, position)`

### `invoice_tax_breakdowns` (Authoritative EN 16931 / DGFiP Rate-Level VAT Table)
- `id UUID PK`
- `workspace_id UUID FK NOT NULL`
- `invoice_id UUID FK NOT NULL`
- `vat_rule_id UUID FK NOT NULL`
- `vat_category_code TEXT NOT NULL` — `'S' | 'Z' | 'E' | 'AE' | 'K' | 'G'`
- `vat_rate NUMERIC(6,3) NOT NULL`
- `taxable_base_ht_minor BIGINT NOT NULL` — Exact sum of `line_subtotal_ht_minor` for this rate
- `vat_amount_minor BIGINT NOT NULL` — `ROUND_HALF_UP(taxable_base_ht_minor * vat_rate / 100)`
- `exemption_reason_code TEXT NULL`
- `exemption_reason_text TEXT NULL`
- Unique `(invoice_id, vat_rule_id)`

### `invoice_deposit_applications` (Linking Deposit Invoices to Final Invoices)
- `id UUID PK`
- `workspace_id UUID FK NOT NULL`
- `final_invoice_id UUID FK NOT NULL` — The `standard_invoice` deducting the deposit
- `deposit_invoice_id UUID FK NOT NULL` — The previously issued `deposit_invoice`
- `applied_ht_minor BIGINT NOT NULL`
- `applied_vat_minor BIGINT NOT NULL`
- `applied_ttc_minor BIGINT NOT NULL`
- Unique `(final_invoice_id, deposit_invoice_id)`

### `payments` & `payment_allocations`
- `payments`:
  - `id UUID PK`, `workspace_id UUID FK NOT NULL`, `contact_id UUID FK NOT NULL`
  - `direction TEXT NOT NULL` — `'inbound' | 'outbound'`
  - `payment_date DATE NOT NULL`
  - `amount_minor BIGINT NOT NULL`, `currency CHAR(3) NOT NULL DEFAULT 'EUR'`
  - `method TEXT NOT NULL` — `'SEPA_TRANSFER' | 'CARD' | 'DIRECT_DEBIT' | 'CHECK' | 'CASH' | 'LCR'`
  - `reference TEXT NULL`, `bank_transaction_id UUID FK NULL`, `journal_entry_id UUID FK NULL`
  - `created_by UUID FK NOT NULL`, `created_at TIMESTAMPTZ NOT NULL`
- `payment_allocations`:
  - `id UUID PK`, `workspace_id UUID FK NOT NULL`, `payment_id UUID FK NOT NULL`
  - `invoice_id UUID FK NULL`, `expense_id UUID FK NULL`
  - `allocated_amount_minor BIGINT NOT NULL`
  - `vat_realized_entry_id UUID FK NULL` — Link to the `OD`/`BQ` VAT transfer entry (`44574` $\rightarrow$ `44571`) when workspace uses `TVA sur les encaissements`
  - `lettering_code TEXT NULL` — The `EcritureLet` code applied in the ledger
  - `created_at TIMESTAMPTZ NOT NULL`

---

## 4. Purchase Documents & Multi-Rate Expenses

### `documents` (Immutable Purchase Inbox & PAF Archive)
- `id UUID PK`, `workspace_id UUID FK NOT NULL`
- `storage_key TEXT NOT NULL`, `original_filename TEXT NOT NULL`, `mime_type TEXT NOT NULL`, `size_bytes BIGINT NOT NULL`
- `sha256 TEXT NOT NULL` — Cryptographic fingerprint for duplicate detection and NF Z42-013 / PAF integrity
- `is_facturx BOOLEAN NOT NULL DEFAULT false`
- `extracted_facturx_xml TEXT NULL`
- `status TEXT NOT NULL` — `'uploaded' | 'processing' | 'needs_review' | 'reviewed' | 'linked' | 'failed' | 'rejected'`
- `retention_until DATE NOT NULL` — Default `issue_date + 10 years` (Art. L123-22 Code de commerce)
- `uploaded_by UUID FK NOT NULL`, `created_at TIMESTAMPTZ NOT NULL`

### `extraction_results`
- `id UUID PK`, `workspace_id UUID FK NOT NULL`, `document_id UUID FK NOT NULL`
- `provider TEXT NOT NULL` — `'facturx_native_parser' | 'eu_ocr_provider'`
- `model_version TEXT NOT NULL`, `candidate_fields JSONB NOT NULL`, `confidence JSONB NULL`
- `review_status TEXT NOT NULL` — `'unverified' | 'confirmed' | 'corrected' | 'rejected'`
- `reviewed_by UUID FK NULL`, `reviewed_at TIMESTAMPTZ NULL`

### `expenses` & `expense_lines` (Multi-Rate VAT & Deductibility Support)
- `expenses`:
  - `id UUID PK`, `workspace_id UUID FK NOT NULL`, `supplier_contact_id UUID FK NULL`, `document_id UUID FK NULL`
  - `supplier_invoice_ref TEXT NOT NULL` — Mandatory `PieceRef` for FEC
  - `expense_date DATE NOT NULL` (`PieceDate`), `due_date DATE NULL`
  - `currency CHAR(3) NOT NULL DEFAULT 'EUR'`
  - `subtotal_ht_minor BIGINT NOT NULL`, `vat_total_minor BIGINT NOT NULL`, `vat_deductible_minor BIGINT NOT NULL`, `total_ttc_minor BIGINT NOT NULL`
  - `amount_paid_minor BIGINT NOT NULL DEFAULT 0`
  - `status TEXT NOT NULL` — `'draft' | 'approved' | 'posted' | 'paid' | 'cancelled'`
  - `journal_entry_id UUID FK NULL`
  - `created_by UUID FK NOT NULL`, `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`
- `expense_lines`:
  - `id UUID PK`, `workspace_id UUID FK NOT NULL`, `expense_id UUID FK NOT NULL`, `position INT NOT NULL`
  - `description TEXT NOT NULL`
  - `accounting_account_id UUID FK NOT NULL` — PCG 2025 expense/asset account (`601`–`628`, `2xx`)
  - `vat_rule_id UUID FK NOT NULL`, `vat_rate NUMERIC(6,3) NOT NULL`
  - `deductibility_ratio NUMERIC(5,4) NOT NULL DEFAULT 1.0000` — e.g. `1.0000` (100%), `0.8000` (80% fuel), `0.0000` (0% non-deductible; non-deductible VAT is added to the `6xx` expense line)
  - `amount_ht_minor BIGINT NOT NULL`
  - `vat_total_minor BIGINT NOT NULL`
  - `vat_deductible_minor BIGINT NOT NULL` — Posted to `44566x` / `44562x`
  - `vat_non_deductible_minor BIGINT NOT NULL` — Added to the `6xx` expense account per PCG rules
  - `amount_ttc_minor BIGINT NOT NULL`

---

## 5. Banking & Reconciliation

### `bank_accounts`
- `id UUID PK`, `workspace_id UUID FK NOT NULL`
- `display_name TEXT NOT NULL`, `bank_name TEXT NULL`
- `iban_masked TEXT NOT NULL`, `bic TEXT NULL`, `currency CHAR(3) NOT NULL DEFAULT 'EUR'`
- `ledger_account_id UUID FK NOT NULL` — Linked PCG 2025 account (`512100`, `512200`...)
- `journal_id UUID FK NOT NULL` — Linked bank journal (`BQ1`, `BQ2`...)
- `provider TEXT NOT NULL DEFAULT 'manual_csv'` — `'manual_csv' | 'dsp2_open_banking'`
- `last_imported_at TIMESTAMPTZ NULL`, `created_at TIMESTAMPTZ NOT NULL`

### `bank_imports` & `bank_transactions`
- `bank_imports`:
  - `id UUID PK`, `workspace_id UUID FK NOT NULL`, `bank_account_id UUID FK NOT NULL`
  - `file_sha256 TEXT NOT NULL`, `format TEXT NOT NULL` (`'CSV' | 'CFONB' | 'CAMT053'`), `status TEXT NOT NULL`, `row_count INT NOT NULL`, `created_by UUID FK NOT NULL`, `created_at TIMESTAMPTZ NOT NULL`
- `bank_transactions`:
  - `id UUID PK`, `workspace_id UUID FK NOT NULL`, `bank_account_id UUID FK NOT NULL`, `bank_import_id UUID FK NULL`
  - `external_ref TEXT NULL`, `transaction_date DATE NOT NULL`, `booking_date DATE NULL`, `value_date DATE NULL`
  - `description TEXT NOT NULL`, `counterparty_name TEXT NULL`
  - `amount_minor BIGINT NOT NULL` (signed: positive for credit/inflow, negative for debit/outflow), `currency CHAR(3) NOT NULL DEFAULT 'EUR'`
  - `allocated_amount_minor BIGINT NOT NULL DEFAULT 0`
  - `fingerprint TEXT NOT NULL` — Deterministic deduplication hash
  - `status TEXT NOT NULL DEFAULT 'unmatched'` — `'unmatched' | 'partially_matched' | 'matched' | 'ignored'`
  - `created_at TIMESTAMPTZ NOT NULL`
  - Unique `(workspace_id, bank_account_id, fingerprint)`

### `reconciliation_matches`
- `id UUID PK`, `workspace_id UUID FK NOT NULL`, `bank_transaction_id UUID FK NOT NULL`
- `target_type TEXT NOT NULL` — `'invoice' | 'credit_note' | 'expense' | 'payment' | 'fee_adjustment' | 'manual_entry'`
- `target_id UUID NOT NULL`
- `matched_amount_minor BIGINT NOT NULL`
- `fee_or_discrepancy_minor BIGINT NOT NULL DEFAULT 0` — Optional bank fee (`627xxx`) or cent rounding discrepancy (`658`/`758`)
- `payment_id UUID FK NULL`, `journal_entry_id UUID FK NULL`
- `status TEXT NOT NULL DEFAULT 'confirmed'` — `'proposed' | 'confirmed' | 'unmatched'`
- `matched_by UUID FK NOT NULL`, `matched_at TIMESTAMPTZ NOT NULL`
- `unmatched_by UUID FK NULL`, `unmatched_at TIMESTAMPTZ NULL`, `unmatch_reason TEXT NULL`

---

## 6. PCG 2025 Ledger, Lettering & Statutory FEC

### `accounting_periods` (*Exercices Comptables*)
- `id UUID PK`, `workspace_id UUID FK NOT NULL`
- `name TEXT NOT NULL` — e.g. `'Exercice 2026'`
- `starts_on DATE NOT NULL`, `ends_on DATE NOT NULL`
- `status TEXT NOT NULL DEFAULT 'open'` — `'open' | 'closing_review' | 'closed'`
- `closed_at TIMESTAMPTZ NULL`, `closed_by UUID FK NULL`
- `closing_seal_hash TEXT NULL` — Cryptographic seal over all posted entries in the period
- `carry_forward_entry_id UUID FK NULL` — Link to the generated `AN` (*À-Nouveaux*) entry in period $N+1$
- *Constraint*: A period with `status = 'closed'` can **never** transition back to `'open'` or `'closing_review'`.

### `accounts` (*Plan Comptable Général — PCG 2025 / ANC 2022-06*)
- `id UUID PK`, `workspace_id UUID FK NOT NULL`
- `chart_version TEXT NOT NULL DEFAULT 'PCG_2025_ANC_2022_06'`
- `code TEXT NOT NULL` — e.g. `'411000'`, `'401000'`, `'512100'`, `'706000'`, `'445710'`, `'445740'` (`CompteNum` in FEC)
- `label TEXT NOT NULL` — (`CompteLib` in FEC)
- `account_class INT NOT NULL` — `1` to `7` (`CHECK (account_class BETWEEN 1 AND 7)`)
- `account_type TEXT NOT NULL` — `'equity_liability' | 'fixed_asset' | 'inventory' | 'third_party' | 'financial' | 'expense' | 'revenue'`
- `requires_auxiliary BOOLEAN NOT NULL DEFAULT false` — True for collective accounts `411000` and `401000`
- `is_letterable BOOLEAN NOT NULL DEFAULT false` — True for class `4` third-party accounts
- `is_system_account BOOLEAN NOT NULL DEFAULT false`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- Unique `(workspace_id, chart_version, code)`

### `journals` (*Journaux Auxiliaires*)
- `id UUID PK`, `workspace_id UUID FK NOT NULL`
- `code TEXT NOT NULL` — `'AN' | 'VE' | 'AC' | 'BQ' | 'OD' | 'CA'` (`JournalCode` in FEC)
- `label TEXT NOT NULL` — e.g. `'Journal des Ventes'` (`JournalLib` in FEC)
- `journal_type TEXT NOT NULL` — `'opening' | 'sales' | 'purchases' | 'bank' | 'miscellaneous' | 'cash'`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- Unique `(workspace_id, code)`

### `journal_entries` (*En-têtes d'Écritures Comptables*)
- `id UUID PK`, `workspace_id UUID FK NOT NULL`
- `journal_id UUID FK NOT NULL`, `period_id UUID FK NOT NULL`
- `entry_number TEXT NULL` — FEC `EcritureNum` (allocated gaplessly when `status = 'posted'`)
- `entry_date DATE NOT NULL` — FEC `EcritureDate`
- `piece_ref TEXT NOT NULL` — FEC `PieceRef` (e.g. `'FA-2026-00001'`, `'VIR-2026-10-18'`)
- `piece_date DATE NOT NULL` — FEC `PieceDate`
- `description TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'draft'` — `'draft' | 'validated' | 'posted' | 'reversed'` (`draft`/`validated` = *Brouillard*; `posted` = *Validée définitivement*, immutable)
- `source_type TEXT NOT NULL` — `'invoice' | 'deposit_invoice' | 'credit_note' | 'expense' | 'payment' | 'reconciliation' | 'vat_transfer' | 'opening_balance' | 'manual'`
- `source_id UUID NULL`, `document_id UUID FK NULL`
- `reversal_of_entry_id UUID FK NULL` — Set when this entry reverses a previously posted entry
- `validated_at DATE NULL` — FEC `ValidDate` (`NOT NULL` when `status = 'posted'`)
- `posted_at TIMESTAMPTZ NULL`, `posted_by UUID FK NULL`
- `previous_entry_hash TEXT NULL`, `entry_hash TEXT NULL` — Cryptographic immutability chain
- `created_by UUID FK NOT NULL`, `created_at TIMESTAMPTZ NOT NULL`
- Partial unique index `(workspace_id, journal_id, period_id, entry_number) WHERE entry_number IS NOT NULL`

### `journal_entry_lines` (*Lignes d'Écritures & Colonnes FEC*)
- `id UUID PK`, `workspace_id UUID FK NOT NULL`, `entry_id UUID FK NOT NULL`
- `position INT NOT NULL`
- `account_id UUID FK NOT NULL` — Maps to FEC `CompteNum` and `CompteLib`
- `contact_id UUID FK NULL`
- `auxiliary_account_code TEXT NULL` — FEC `CompAuxNum` (e.g. `'411CLI0001'`)
- `auxiliary_account_label TEXT NULL` — FEC `CompAuxLib` (e.g. `'ACME SAS'`)
- `description TEXT NOT NULL` — FEC `EcritureLib`
- `debit_minor BIGINT NOT NULL DEFAULT 0` — FEC `Debit` (in EUR cents)
- `credit_minor BIGINT NOT NULL DEFAULT 0` — FEC `Credit` (in EUR cents)
- `currency_code CHAR(3) NOT NULL DEFAULT 'EUR'` — FEC `Idevise`
- `amount_currency_minor BIGINT NULL` — FEC `Montantdevise` (populated when original transaction currency $\neq$ `EUR`)
- `lettering_code TEXT NULL` — FEC `EcritureLet` (e.g. `'AA'`, `'AB'`)
- `lettered_at DATE NULL` — FEC `DateLet` (`CHECK ((lettering_code IS NULL AND lettered_at IS NULL) OR (lettering_code IS NOT NULL AND lettered_at IS NOT NULL))`)
- `CHECK (debit_minor >= 0 AND credit_minor >= 0 AND ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)))`
- Unique `(entry_id, position)`

---

## 7. Tax Rules & Immutable Audit Log (`BlockedLog`)

### `tax_rules`
- `id UUID PK`, `workspace_id UUID FK NULL`
- `jurisdiction CHAR(2) NOT NULL DEFAULT 'FR'`
- `rule_code TEXT NOT NULL` — e.g. `'FR_TVA_20'`, `'FR_TVA_10'`, `'FR_TVA_5_5'`, `'FR_TVA_2_1'`, `'FR_FRANCHISE_293B'`, `'EU_B2B_REVERSE_CHARGE'`, `'EXPORT_EXEMPT'`
- `label TEXT NOT NULL`
- `rate NUMERIC(6,3) NOT NULL` — `20.000`, `10.000`, `5.500`, `2.100`, `0.000`
- `vat_category_code TEXT NOT NULL` — `'S' | 'Z' | 'E' | 'AE' | 'K' | 'G'`
- `exemption_reason_code TEXT NULL`, `legal_mention TEXT NULL`
- `collected_account_debits_code TEXT NOT NULL DEFAULT '445710'`
- `collected_account_pending_cash_code TEXT NOT NULL DEFAULT '445740'`
- `deductible_account_code TEXT NOT NULL DEFAULT '445660'`
- `valid_from DATE NOT NULL`, `valid_to DATE NULL`

### `audit_events` (Cryptographic Append-Only Log — Dolibarr `llx_blockedlog` pattern)
- `id UUID PK`, `workspace_id UUID FK NOT NULL`
- `sequence_number BIGINT NOT NULL` — Gapless per-workspace counter
- `actor_user_id UUID FK NULL`
- `action TEXT NOT NULL` — e.g. `'INVOICE_ISSUED'`, `'CREDIT_NOTE_ISSUED'`, `'ENTRY_POSTED'`, `'LETTERING_APPLIED'`, `'PERIOD_CLOSED'`, `'FEC_EXPORTED'`
- `entity_type TEXT NOT NULL`, `entity_id UUID NULL`
- `occurred_at TIMESTAMPTZ NOT NULL`
- `correlation_id UUID NOT NULL`
- `metadata JSONB NOT NULL` — Minimized canonical payload (no secrets, no raw passwords/tokens)
- `previous_hash TEXT NOT NULL` — SHA-256 of `sequence_number - 1` (or genesis seed for `sequence_number = 1`)
- `record_hash TEXT NOT NULL` — `SHA-256(previous_hash || sequence_number || occurred_at || action || entity_id || canonical_json(metadata))`
- Unique `(workspace_id, sequence_number)`
- Protected by PostgreSQL trigger rejecting `UPDATE`, `DELETE`, and `TRUNCATE`.
