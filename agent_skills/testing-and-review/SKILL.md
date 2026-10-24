---
name: testing-and-review
description: Use before completing a task, fixing a bug, reviewing a PR, or verifying French/EU accounting, Factur-X, or FEC behaviour.
---

# Testing, Compliance Verification & Review Skill

1. Convert acceptance criteria and French/EU regulatory invariants into automated test cases before or alongside implementation.
2. Run the narrowest relevant unit tests first, then database integration, compliance validation, and broader regression suites.
3. **Mandatory Financial & Regulatory Test Cases**:
   - **EN 16931 Rate-Level VAT Rounding**: Test multi-line invoices where summing rounded line-level VAT would differ from rounding once on the sum of net bases per VAT rate (`invoice_tax_breakdowns`).
   - **Gapless Concurrency & Rollback**: Test parallel invoice issuances and journal postings combined with forced transaction rollbacks to verify zero gaps and zero duplicates in `invoices.number` and `journal_entries.entry_number` (`EcritureNum`).
   - **Immutability & Hash Chain**: Verify that both API calls (`PATCH`/`DELETE`) and direct SQL `UPDATE`/`DELETE` statements against issued invoices, credit notes, deposit invoices, posted ledger entries, closed periods, and `audit_events` are rejected by PostgreSQL triggers, and verify `SHA-256` hash-chain continuity.
   - **VAT Exigibility (`Débits` vs `Encaissements`)**: Test that `ENCAISSEMENTS` mode posts to pending VAT (`44574`) on invoice issuance and transfers exact proportional VAT to `44571` upon partial/full payment or credit note application.
   - **Lettering & Period Close**: Verify balanced third-party lettering (`EcritureLet`/`DateLet` on `411`/`401`), `AN` (*À-Nouveaux*) generation, and absolute irreversibility of `closed` accounting periods.
   - **Factur-X & FEC Validation**: Validate generated `factur-x.xml` against EN 16931 CII rules and validate generated `{SIREN}FEC{YYYYMMDD}.txt` against all 18/22-column DGFiP *Test Compta Demat* rules.
4. **Security & Accessibility Checks**:
   - Test authorised, unauthorised, RBAC role-restricted, and cross-tenant (RLS) access for every endpoint.
   - Verify WCAG 2.1 AA / RGAA 4.1 accessibility and `320 px` responsive layout on modified UI flows.
5. Never state tests passed unless they were actually executed and passed. Report changed files, exact test commands/results, known limitations, and the next safe milestone step.
