---
name: accounting-domain
description: Use when implementing French/EU quotes, standard/deposit invoices, credit notes, Factur-X, payments, VAT (debits vs cash receipts), PCG 2025 journal entries, accounting ventilation, lettering (lettrage), periods, or FEC exports.
---

# Accounting Domain Skill (France DGFiP / PCG 2025 & EU EN 16931)

1. Read `accounting_rules.md`, `data_model.md`, and relevant `PRD.md` acceptance criteria. Use Dolibarr ERP/CRM (`Compta`, `Facturation`, `BlockedLog`) as a functional reference for French accounting workflows.
2. Enforce all rules in backend domain services and PostgreSQL constraints/triggers—never in UI components.
3. **EN 16931 / DGFiP VAT Calculation**: Calculate line net HT amounts (`ROUND_HALF_UP`), group by VAT rate in `invoice_tax_breakdowns`, and round VAT **once per tax rate** (`ROUND_HALF_UP(sum_base_ht_by_rate * rate)`). Never compute invoice VAT by summing rounded line-level VAT amounts.
4. **Sales Document Completeness**: Support Quotes (`quote`), Deposit Invoices (`deposit_invoice`, posted to `419100` with VAT exigible on deposit receipt per Art. 289-I-1-c CGI), Standard Invoices (`standard_invoice` deducting applied deposits), and Credit Notes (`credit_note` referencing `original_invoice_id`).
5. **Mandatory French B2B Mentions & Factur-X**: At issuance, verify and snapshot `issuer_snapshot` and `customer_snapshot` (SIREN/SIRET, RCS/RM, legal form, capital, intra-EU VAT), `operation_category` (`goods`/`services`/`mixed`), `delivery_or_service_date`, `late_penalty_rate`, €40 B2B `recovery_indemnity_minor` (`4000` cents), `discount_terms`, and 0% VAT legal exemption clauses (*Art. 293 B CGI*, *Autoliquidation Art. 283-2 CGI*). Generate and validate the **Factur-X (PDF/A-3 + EN 16931 CII XML)** payload.
6. **Gapless Chronological Numbering & Hash Chain**: Allocate numbers (`FA-2026-00001`, `AV-2026-00001`, FEC `EcritureNum`) exclusively inside a database transaction by locking `document_sequences` (`SELECT ... FOR UPDATE`), and compute the chained `SHA-256` hash (`previous_hash`, `record_hash`).
7. **VAT Exigibility (`Débits` vs `Encaissements`)**:
   - In `DEBITS` mode (or for goods), post collected VAT directly to `44571x` at invoice issuance.
   - In `ENCAISSEMENTS` mode (default for services), post pending VAT to `44574x` at invoice issuance, and transfer the proportional VAT from `44574x` to `44571x` upon payment recording or bank reconciliation.
8. **PCG 2025, Automated Ventilation, Lettering & FEC**:
   - Enforce **PCG 2025 (ANC 2022-06)** (no abolished account `79`; strict exceptional accounts `67`/`77`).
   - Automatically ventilate issued sales documents (`VE`), approved multi-rate expenses (`AC`), and payments (`BQ`) with mandatory `PieceRef`, `PieceDate`, and auxiliary accounts (`CompAuxNum`/`CompAuxLib` on `411000`/`401000`).
   - Support balanced third-party lettering (`EcritureLet`, `DateLet`) where $\sum \text{Debit} = \sum \text{Credit}$.
   - Enforce strict irreversibility of closed periods (`status = 'closed'` can never be reopened) and generate `AN` (*À-Nouveaux*) opening entries in period $N+1$.
   - Ensure every posted entry satisfies all 18/22 statutory **FEC (Art. L47 A-I LPF)** columns.
