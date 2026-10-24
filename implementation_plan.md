# Step-by-Step Implementation Plan and Milestones

Implement one milestone at a time. Do not start the next milestone until its acceptance criteria, compliance checks, and regression tests pass. Functional workflows follow [Dolibarr ERP/CRM](https://wiki.dolibarr.org/index.php/Home) patterns adapted to our custom React + TypeScript + PostgreSQL stack.

## M0 — Repository Discovery, Baseline & Architecture Setup
Tasks:
- Inspect repository state; initialize monorepo/project structure (`src/` React+TS frontend, `server/` TypeScript backend, `db/` PostgreSQL migrations & seeds) if starting clean.
- Configure `decimal.js` (`ROUND_HALF_UP`), strict TypeScript, Vitest, Playwright, and local/CI disposable PostgreSQL database.
- Seed official French **PCG 2025 (Règlement ANC n° 2022-06)** chart of accounts and French/EU VAT rules (`20%`, `10%`, `5.5%`, `2.1%`, `0% Franchise Art. 293 B`, `0% Intra-EU Reverse Charge`, `0% Export`).
Acceptance:
- Architecture and test runner execute cleanly against a real PostgreSQL test database.
- PCG 2025 accounts (without abolished account `79`) and French tax rules are seeded and verified.

## M1 — Accessible Design System (RGAA 4.1 / EAA) & Application Shell
Tasks:
- Design tokens, French currency/date formatters (`fr-FR`, `EUR`, `DD/MM/YYYY`), accessible form primitives, status badges, tables, and responsive shell (`320 px` to desktop).
- Navigation routes for Dashboard, Sales (Quotes, Invoices, Credit Notes), Contacts (`Tiers`), Purchases, Banking, Accounting (Journals, Accounts, Lettering, Periods), VAT, Reports/FEC, and Settings.
Acceptance:
- All primary routes resolve with loading, empty, error, and success states.
- Keyboard navigation, focus management, ARIA labels, and contrast pass automated WCAG 2.1 AA / RGAA 4.1 checks (`axe-core`).
- Zero horizontal overflow at `320 px`.

## M2 — Authentication, MFA, Workspace Legal Profile & Gapless Sequences
Tasks:
- Session authentication, step-up MFA (2FA) support, RBAC roles (`owner`, `admin`, `finance`, `accountant`, `read_only`), and PostgreSQL RLS tenant context middleware.
- French Workspace Legal Profile: `siren` & `siret` (with Luhn validation), `legal_form` (`MICRO_ENTREPRISE`, `SASU`, `SAS`, `EURL`, `SARL`, `EI`...), `share_capital_minor`, `rcs_city`, `rcs_number`, `naf_code`, `vat_number`, `accounting_mode` (`CASH_MICRO` vs `DOUBLE_ENTRY_PCG2025`), `vat_regime`, and `vat_exigibility` (`DEBITS` vs `ENCAISSEMENTS`).
- Transactional gapless numbering engine (`document_sequences` with `SELECT ... FOR UPDATE`) and cryptographic `SHA-256` hash-chained `audit_events` (`BlockedLog` pattern) with PostgreSQL immutability triggers.
Acceptance:
- Unauthenticated and cross-tenant requests are rejected at both service and RLS layers.
- Invalid SIREN/SIRET numbers are rejected.
- `audit_events` table rejects `UPDATE` and `DELETE` via PostgreSQL trigger and verifies hash chain integrity.

## M3 — Third-Parties (`Tiers` — Contacts) with SIREN/INSEE & EU VIES Lookup
Tasks:
- Unified customer/supplier directory (`contacts`) with B2B/B2C flag, tax zone (`DOMESTIC_FR`, `DOM_TOM`, `INTRA_EU`, `EXPORT_NON_EU`), billing/delivery addresses, and automatic auxiliary account code generation (`411CLIxxxx` / `401FOUxxxx`).
- Integration with official French *API Recherche d'entreprises / INSEE Sirene* for 1-click SIREN/SIRET auto-completion and French VAT number computation.
- Integration with EU **VIES** validation (storing `vies_validated_at` and `vies_consultation_ref`).
Acceptance:
- CRUD, archive (`ON DELETE RESTRICT` protection), SIREN lookup, and VIES check tests pass.
- B2B French contacts require a valid SIREN/SIRET before being eligible for B2B invoice issuance.

## M4 — Quotes (`Devis`), Invoice Drafts (`PROV`) & EN 16931 Rate-Level VAT Engine
Tasks:
- Sales document editor supporting `quote`, `deposit_invoice`, `standard_invoice`, and `credit_note` drafts with temporary Dolibarr-style `(PROV-xxxx)` references.
- Authoritative server-side **EN 16931 / DGFiP VAT calculation**: line net HT calculation, grouping by VAT rate into `invoice_tax_breakdowns`, rounding VAT at the rate-breakdown level (`ROUND_HALF_UP(sum_base_ht * rate)`), and enforcing mandatory French B2B mentions (`operation_category`, `delivery_or_service_date`, `late_penalty_rate`, €40 `recovery_indemnity_minor`, `discount_terms`, and 0% VAT legal exemption clauses).
- Watermarked `BROUILLON` PDF preview.
Acceptance:
- Multi-line, multi-rate VAT test cases match EN 16931 rate-level rounding to the exact cent.
- Quote-to-Invoice and Quote-to-Deposit conversion workflows pass tests.

## M5 — Factur-X Issuance, Deposit Invoices, Credit Notes, Payments & Micro Books
Tasks:
- Atomic issuance transaction (`POST /invoices/{id}/issue`): gapless number allocation (`SELECT ... FOR UPDATE`), `issuer_snapshot` and `customer_snapshot` freeze, `SHA-256` `document_hash` chaining, and PostgreSQL trigger blocking any post-issuance mutation.
- Native **Factur-X (PDF/A-3b + embedded EN 16931 CII `factur-x.xml`)** generation and XML schema validation.
- **Deposit Invoices (`Factures d'acompte`)** and deduction of issued deposits on final settlement invoices (`invoice_deposit_applications`).
- **Credit Notes (`Factures d'avoir`)** referencing `original_invoice_id` to cancel or adjust issued invoices.
- Customer payment recording, partial allocations, and statutory **Micro-Entreprise exports** (*Livre des recettes encaissées* and *Registre des achats* + turnover threshold gauges).
Acceptance:
- 20 parallel issuance requests + simulated rollbacks produce a strictly continuous, gapless sequence (`FA-2026-00001`..`00020`).
- Issued documents reject `PATCH`/`DELETE` at both API and SQL trigger levels.
- Generated Factur-X XML validates against EN 16931 CII rules.
- Micro-entrepreneurs have a complete, legally compliant invoicing and *Livre des recettes* workflow at the end of M5!

## M6 — Purchase Inbox (Factur-X Parser + EU OCR), PAF Archival & Multi-Rate Expenses
Tasks:
- Private EU object storage upload with `SHA-256` fingerprinting and 10-year retention metadata (`Art. L123-22 Code de commerce`).
- Native deterministic parser for incoming supplier Factur-X PDFs + optional EU-hosted OCR suggestion pipeline for flat receipts/PDFs.
- Human review UI and multi-line expense creation (`expense_lines`) supporting multiple VAT rates on a single receipt (e.g., restaurant 10% + 20%), PCG `6xx` account mapping, and partial VAT deductibility ratios (e.g., 80% fuel).
Acceptance:
- Unreviewed OCR fields never auto-post.
- Multi-rate expenses and non-deductible VAT fractions allocate accurately between `6xx` expense accounts and `44566x` deductible VAT.

## M7 — Banking Import & $N \leftrightarrow M$ Reconciliation
Tasks:
- Bank account setup linked to PCG `512xxx` and journal `BQx`.
- CSV / CFONB / CAMT.053 import preview and deterministic fingerprint deduplication.
- $N \leftrightarrow M$ reconciliation matching (1 bank line $\leftrightarrow N$ invoices/expenses, partial installments, and bank fee/rounding write-offs to `627xxx` / `658` / `758`).
Acceptance:
- Retrying an identical bank file import creates zero duplicates.
- Allocations cannot exceed transaction or document balances; match and unmatch actions are audited.

## M8 — PCG 2025 Ledger, Automated Ventilation, Lettering (`Lettrage`) & Period Close
Tasks:
- Automated Accounting Binding Engine (*Moteur de ventilation comptable*): issuing invoices, deposit invoices (`419100`), credit notes, approving expenses, and recording/reconciling payments automatically generate balanced entries in `VE`, `AC`, `BQ`, and `OD`.
- **VAT Exigibility Engine (`TVA sur les débits` vs `TVA sur les encaissements`)**: automatic tracking of pending cash-basis VAT (`44574`) at invoice issuance and proportional transfer to exigible VAT (`44571`) upon payment/reconciliation.
- Draft (`brouillard`) vs definitively posted (`validée`) entries with gapless `EcritureNum`, `ValidDate`, and `SHA-256` `entry_hash` trigger protection.
- Auxiliary account **Lettering (`Lettrage` / `Délettrage`)** on `411xxx` and `401xxx` (`EcritureLet`, `DateLet`).
- **Irreversible Fiscal Period Closure (`Clôture définitive`)** and automatic generation of opening balances in the `AN` (*À-Nouveaux*) journal of period $N+1$.
Acceptance:
- Unbalanced entries or entries missing `CompAuxNum` on collective `411`/`401` accounts are rejected.
- VAT on cash receipts (`encaissements`) transfers exact proportional VAT upon partial and full payments.
- Closed periods reject all new postings and **cannot be reopened**.

## M9 — VAT Return Preparation (`CA3`/`CA12`), Financial Reports & Statutory FEC Export
Tasks:
- Interactive VAT report (`CA3`/`CA12` preparation) with full drill-down to source invoices, payments, and intra-EU reverse charge entries.
- General Ledger (*Grand Livre*), Trial Balance (*Balance générale et auxiliaire*), and Dashboard drill-downs.
- **18/22-Column Statutory FEC Generator (`{SIREN}FEC{YYYYMMDD}.txt`)** and built-in **DGFiP Test Compta Demat** validator.
Acceptance:
- Generated FEC passes all 18-column syntax, date (`YYYYMMDD`), comma-decimal, gapless `EcritureNum`, `PieceRef`, `ValidDate`, lettering equilibrium, and balance checks.

## M10 — Hardening, GDPR / EAA Audit & Release Readiness
Tasks:
- Full security & RBAC penetration test, PostgreSQL trigger & RLS verification, and cryptographic hash-chain integrity check (`/audit/verify-integrity`).
- GDPR compliance verification (EU residency check, Art. 20 data export, Art. 17 erasure vs Art. 17.3.b 10-year accounting retention enforcement).
- Backup & Point-in-Time Recovery (PITR) restore drill.
Acceptance:
- Zero critical/high security, accessibility (RGAA 4.1), or FEC/Factur-X validation issues remain open.
