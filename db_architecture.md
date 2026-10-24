# Database Architecture — PostgreSQL (French & EU Compliance)

## Goals
- Strict multi-tenant isolation (`workspace_id` + PostgreSQL RLS).
- Database-enforced financial invariants and **cryptographic immutability** (French *Piste d'Audit Fiable*, NF Z42-013, and DGFiP FEC requirements).
- **Gapless sequential numbering** under high concurrency and transaction rollbacks.
- Full traceability across commercial documents, payments, and PCG 2025 ledger entries.
- **EU Data Sovereignty (GDPR)**: 100% EU-hosted compute, storage, replicas, and encrypted backups.

## Schema strategy
Use a single PostgreSQL database in the MVP to guarantee ACID transactions across sales, banking, accounting ventilation, and audit logging without distributed two-phase commit complexity. Group tables logically by bounded context (`identity`, `core`, `sales`, `purchases`, `banking`, `accounting`, `audit`) or clear prefixed table names.

## Critical French Regulatory Database Mechanisms

### 1. Gapless Chronological Numbering (`document_sequences` + `SELECT ... FOR UPDATE`)
Under **Art. 242 nonies A of the CGI** (invoices/credit notes) and **Art. L47 A-I of the LPF** (FEC `EcritureNum`), numbering must be strictly chronological, continuous, and **gapless**.
- **Prohibition**: Never use PostgreSQL `SERIAL`, `BIGSERIAL`, or `GENERATED ... AS IDENTITY` for invoice numbers or `EcritureNum`, because a rolled-back transaction advances the sequence and permanently leaves a missing number!
- **Required Pattern**:
  ```sql
  -- Executed inside the issuance / posting transaction:
  SELECT current_value, prefix, padding_length, last_record_hash
  FROM document_sequences
  WHERE workspace_id = $1 AND sequence_type = $2 AND fiscal_year = $3
  FOR UPDATE;

  -- Increment current_value by 1, format number (e.g. 'FA-2026-00001'),
  -- compute SHA-256 record_hash chained with last_record_hash,
  -- and UPDATE document_sequences within the same transaction.
  ```
  If the transaction rolls back for any reason, the row lock releases and `current_value` remains unchanged—guaranteeing zero gaps.

### 2. Database-Enforced Immutability Triggers (`BEFORE UPDATE OR DELETE`)
Application-layer checks are not sufficient for French tax compliance. PostgreSQL triggers must enforce immutability at the storage engine level:
- **`invoices` Trigger**: Once `OLD.status = 'issued'`, reject any `DELETE` and reject any `UPDATE` that modifies `number`, `issue_date`, `contact_id`, `subtotal_ht_minor`, `vat_total_minor`, `total_ttc_minor`, `issuer_snapshot`, `customer_snapshot`, `facturx_xml`, or `document_hash`. Only allow updating status fields (`payment_status`, `amount_paid_minor`, `einvoice_status`, or transition to `cancelled_by_credit_note`).
- **`invoice_lines` & `invoice_tax_breakdowns` Trigger**: Block any `INSERT`, `UPDATE`, or `DELETE` if the parent invoice has `status = 'issued'`.
- **`journal_entries` & `journal_entry_lines` Trigger**: Once `OLD.status = 'posted'`, block any `DELETE` and block any `UPDATE` except setting `reversal_of_entry_id` status metadata or applying/removing `lettering_code` / `lettered_at` while the parent `accounting_period` is still `'open'`.
- **`accounting_periods` Trigger**: Once `OLD.status = 'closed'`, block any `UPDATE` (a closed French fiscal year can **never** be reopened) and block inserting/posting any `journal_entries` into that `period_id`.
- **`audit_events` Trigger**: Reject all `UPDATE`, `DELETE`, and `TRUNCATE` operations unconditionally (`BlockedLog` invariant).

### 3. Double-Entry & Lettering Equilibrium Enforcement
- A single-row `CHECK` constraint ensures `debit_minor >= 0 AND credit_minor >= 0` and that a line is either a debit or a credit.
- A **DEFERRABLE INITIALLY DEFERRED constraint trigger** (or stored posting procedure) verifies before `COMMIT` that for any `journal_entries` row with `status = 'posted'`:
  1. It has at least 2 lines (at least one debit and one credit).
  2. $\sum \text{debit\_minor} = \sum \text{credit\_minor} > 0$.
  3. Every line on a collective third-party account (`requires_auxiliary = true`, e.g., `411000` or `401000`) has a non-null `auxiliary_account_code` (`CompAuxNum`).
- For **Lettering (`Lettrage`)**, verify inside the transaction that for a given `(workspace_id, auxiliary_account_code, lettering_code)`, $\sum \text{debit\_minor} = \sum \text{credit\_minor}$.

## Key constraints and indexes
- Foreign keys on all relationships, using `ON DELETE RESTRICT` for all financial, contact, and accounting references so master data referenced by historical records can never be hard-deleted.
- Partial unique index on `invoices(workspace_id, number) WHERE number IS NOT NULL`.
- Partial unique index on `journal_entries(workspace_id, journal_id, period_id, entry_number) WHERE entry_number IS NOT NULL`.
- Composite indexes for fast FEC generation: `journal_entries(workspace_id, period_id, validated_at, entry_number)` and `journal_entry_lines(workspace_id, entry_id, position)`.
- Auxiliary lettering index: `journal_entry_lines(workspace_id, auxiliary_account_code, lettering_code)`.
- Deduplication indexes: `documents(workspace_id, sha256)` and `bank_transactions(workspace_id, bank_account_id, fingerprint)`.

## Tenant isolation & Row-Level Security (RLS)
- Every tenant-owned table includes `workspace_id UUID NOT NULL`.
- After verifying session authentication and workspace membership in the API middleware, each database transaction sets `SET LOCAL app.current_workspace_id = '<verified_uuid>'`.
- PostgreSQL RLS policies enforce `workspace_id = current_setting('app.current_workspace_id', true)::uuid`, denying access automatically if the session variable is unset.

## Money representation
- **Stored Monetary Totals**: `BIGINT` minor units (euro cents) + `CHAR(3)` ISO 4217 currency code.
- **Quantities, Unit Prices, Discounts & VAT Rates**: `NUMERIC(19,4)` / `NUMERIC(6,3)` with documented `ROUND_HALF_UP` rounding at the EN 16931 tax-breakdown level.
- **Never** use `REAL`, `DOUBLE PRECISION`, or `MONEY` PostgreSQL types.

## Data Lifecycle: 10-Year Accounting Retention vs GDPR Right to Erasure
French accounting law and EU GDPR have specific interaction rules that the database architecture must enforce:
1. **10-Year Mandatory Archival (Art. L123-22 Code de commerce & Art. L102 B LPF)**:
   - Under **GDPR Article 17(3)(b)** (*compliance with a legal obligation*), the right to erasure ("right to be forgotten") **does NOT apply** to issued invoices, credit notes, deposit invoices, purchase vouchers (`documents`), bank transactions, posted `journal_entries`/`journal_entry_lines`, or financial `audit_events`.
   - These records and their embedded `issuer_snapshot` / `customer_snapshot` must be retained unaltered for **10 years** after the close of the fiscal year.
2. **GDPR Erasure & Anonymisation for Non-Accounting Data**:
   - Unissued draft records, prospect contacts with zero financial history, and user profile PII (`users.email`, `users.full_name`) for departed team members can be deleted or pseudonymised upon valid GDPR request without altering historical accounting snapshots.

## Backups, EU Residency & Recovery
- Primary database, read replicas, and S3 backup buckets must reside strictly within the **European Union**.
- Continuous WAL archiving (Point-in-Time Recovery — PITR) + daily encrypted snapshots.
- Mandatory automated restore drill before production launch and before any major schema migration.
