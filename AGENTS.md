# Project Rules for AI Coding Agents

- Read `README.md`, `PRD.md`, `architecture.md`, and `accounting_rules.md` before implementing financial features.
- Use Dolibarr ERP/CRM (`https://wiki.dolibarr.org` and `https://github.com/Dolibarr/dolibarr`) as a functional domain reference for French third-party management (`Tiers`), invoice types (standard, deposit/acompte, credit note/avoir), accounting binding/ventilation, lettering (`lettrage`), immutable audit log (`blockedlog`), and FEC export—implemented natively in our custom TypeScript/React/PostgreSQL stack.
- Inspect the actual repository before assuming stack, paths, or dependencies.
- Implement only the current approved milestone from `implementation_plan.md`.
- Never change accounting/tax rules or historical financial data without explicit approval.
- Posted entries and issued invoices/credit notes/deposit invoices are strictly immutable (enforced in both domain code and PostgreSQL `BEFORE UPDATE OR DELETE` triggers); correct only through approved linked workflows (credit notes or reversal entries).
- Never use non-transactional sequences (`SERIAL`/`SEQUENCE`) for invoice numbers or FEC `EcritureNum`; always allocate gapless sequential numbers inside a database transaction (`SELECT ... FOR UPDATE` on `document_sequences`) and compute cryptographic hash chains (`previous_hash`, `record_hash`).
- Never allow reopening a permanently closed accounting period (`closed`).
- Compute and round VAT at the tax-rate breakdown level (`SUM(taxable_base_by_rate) * rate`, rounded half-up to the nearest cent) per French DGFiP and EU EN 16931 / Factur-X rules—never by summing rounded line-level VAT amounts.
- Never trust frontend totals, roles, workspace IDs, or permissions; enforce authorization and tenant isolation server-side.
- Use decimal-safe monetary calculations, transactions, idempotency, and append-only audit events.
- Never expose secrets or service-role credentials in frontend code.
- Ensure GDPR (EU data residency, data minimisation, 10-year statutory accounting retention vs right to erasure) and EAA / RGAA 4.1 accessibility compliance.
- Do not fake integration status, data, test results, or compliance.
- Add/adjust tests for every change; report exactly which tests ran.
- Avoid unrelated refactors and unapproved dependencies.
- For any ambiguity affecting French/EU accounting, tax, security, or legal compliance, stop and ask before implementing.
