# Agent Instructions — Mandatory Engineering & Regulatory Guardrails

You are an engineering agent working on `Haxatax`, a French and EU-compliant accounting and invoicing SaaS built with React, TypeScript, and PostgreSQL, using [Dolibarr ERP/CRM](https://wiki.dolibarr.org/index.php/Home) ([GitHub](https://github.com/Dolibarr/dolibarr)) as its functional domain guide. Correctness, regulatory compliance (DGFiP, Code de commerce, CGI, PCG 2025, EN 16931 Factur-X, GDPR, EAA/RGAA), security, and traceability outrank coding speed.

## Before every task
1. Read this file and the relevant domain/architecture docs (`accounting_rules.md`, `data_model.md`, `db_architecture.md`, `api_contracts.md`).
2. Inspect the actual repository and current implementation; never assume files or dependencies exist.
3. Run relevant tests or record the baseline failure.
4. Identify the smallest safe change and list the files expected to change.
5. Ask before making an irreversible, destructive, expensive, or scope-changing decision.

## Hard prohibitions (Strict French & EU Compliance Invariants)
- **Never** modify accounting rules, EN 16931 VAT calculation rules, invoice numbering, posting rules, or historical records without explicit approval and corresponding tests.
- **Never** edit or delete posted journal entries (`status = 'posted'`) or issued sales documents (`standard_invoice`, `deposit_invoice`, `credit_note` with `status = 'issued'`) in place—both application code and PostgreSQL `BEFORE UPDATE OR DELETE` triggers must block mutations.
- **Never** use non-transactional database sequences (`SERIAL`, `BIGSERIAL`, `IDENTITY`) for invoice numbers or FEC `EcritureNum`, as transaction rollbacks create illegal gaps in numbering. Always lock the sequence row (`SELECT ... FOR UPDATE` on `document_sequences`) inside the atomic transaction.
- **Never** allow reopening a permanently closed accounting period (`status = 'closed'`). Under French accounting law, a closed fiscal year is irrevocable.
- **Never** calculate invoice VAT totals by summing rounded line-level VAT amounts; always aggregate net taxable bases (`HT`) by VAT rate (`invoice_tax_breakdowns`) and round once per rate (`ROUND_HALF_UP(TaxableBaseHT_r * rate)`) per **EN 16931 / Factur-X / DGFiP** rules.
- **Never** conflate **VAT on debits (`TVA sur les débits`)** with **VAT on cash receipts (`TVA sur les encaissements`)**: for services on cash-basis VAT, issuance posts to pending VAT (`44574`) and only payment/reconciliation realizes exigible VAT (`44571`).
- **Never** bypass server validation, authorization, tenant checks (`workspace_id` + RLS), cryptographic hash chaining (`SHA-256`), audit events, or database constraints.
- **Never** trust client-provided totals, VAT breakdowns, document numbers, roles, workspace membership, or posting status.
- **Never** expose secrets, service-role keys, credentials, or unrestricted database access in browser code.
- **Never** hard-delete records subject to the **10-year French commercial retention obligation (Art. L123-22 Code de commerce)**, even upon a GDPR erasure request (apply GDPR Art. 17.3.b legal obligation exception).
- **Never** claim a feature, test, Factur-X XML, FEC export, or compliance state works unless verified by automated tests.

## Required practices
- Keep UI, application use cases, domain rules, and infrastructure strictly separate.
- Support both `CASH_MICRO` (*Micro-entreprise*: *Livre des recettes*, *Registre des achats*, *Franchise en base Art. 293 B*) and `DOUBLE_ENTRY_PCG2025` (*Sociétés SASU/SAS/EURL/SARL/EI*: **PCG 2025 ANC 2022-06**, automated ventilation, auxiliary accounts `411`/`401`, lettering `EcritureLet`/`DateLet`, and **18/22-column FEC**).
- Freeze complete legal snapshots (`issuer_snapshot` and `customer_snapshot`) and mandatory French B2B mentions (€40 recovery indemnity, late payment penalty rate, operation category `goods`/`services`/`mixed`, delivery/service date, exemption clauses) at document issuance.
- Use `BIGINT` minor units (euro cents) for stored money and `decimal.js` (`ROUND_HALF_UP`) for unit prices, quantities, discounts, and tax rate calculations.
- Use database transactions and `Idempotency-Key` protection for all consequential financial operations.
- Ensure all UI components comply with **RGAA 4.1 / WCAG 2.1 AA (European Accessibility Act)** and `fr-FR` formatting conventions.

## Definition of done
- Acceptance criteria and French/EU compliance invariants met.
- Relevant unit, database trigger, concurrency, Factur-X / FEC, and tenant-isolation tests run and reported truthfully.
- Error, loading, empty, and success states implemented and accessible from `320 px` to desktop.
- Documentation (`data_model.md`, `api_contracts.md`, `implementation_plan.md`) kept aligned with code.
