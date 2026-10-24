# Quality, Security, GDPR, Accessibility & Regulatory Release Checklist

## 1. Security & French/EU Data Protection Baseline (GDPR / CNIL)
- **Threat Model**: Cross-tenant data leakage, privilege escalation, unauthorized invoice issuance or IBAN modification, tampering with historical accounting records, insecure document URLs, SQL/command injection, CSRF, XSS, SSRF in document processing, unsafe file uploads, CSV formula injection, and replay/double-submit attacks.
- **Authentication, Step-Up MFA & RBAC**:
  - Server-side session verification on every route.
  - Step-up MFA (2FA) supported and recommended/enforced for high-risk actions: issuing invoices/credit notes, modifying company IBAN/BIC, elevating user roles, and closing an accounting period.
- **Cryptographic Immutability (PAF / NF Z42-013 / `BlockedLog`)**:
  - Issued sales documents (`invoices`), posted ledger entries (`journal_entries`), and `audit_events` are protected by both SHA-256 hash chaining (`previous_hash`, `record_hash`) and PostgreSQL `BEFORE UPDATE OR DELETE` triggers.
- **EU Data Sovereignty & GDPR (Regulation EU 2016/679 & CNIL)**:
  - All compute, PostgreSQL databases, read replicas, S3 object storage, backups, and OCR/AI processors must be hosted strictly within the **European Union**.
  - Signed Data Processing Agreements (DPA) and **Zero Data Retention (ZDR) / Zero Model Training** guarantees for any external OCR or AI extraction service.
  - **10-Year Statutory Retention vs Right to Erasure**: Enforce Art. L123-22 Code de commerce (10-year immutable retention of invoices, accounting vouchers, and ledger entries under GDPR Art. 17.3.b legal obligation exception) while supporting erasure/pseudonymisation of non-accounting personal data.
  - Maintain a Record of Processing Activities (*Registre des activités de traitement* — Art. 30 GDPR) and a 72-hour data breach notification runbook (Art. 33 GDPR / CNIL).
- **Document & Storage Security**:
  - Validate file extension, MIME type, magic bytes, and size; compute `SHA-256` hash on upload.
  - Private EU object storage by default; signed download URLs are short-lived ($\le 5$ minutes) and tenant-scoped.
  - Protect all CSV/Excel exports against formula injection (prefix cells starting with `=`, `+`, `-`, `@`, `\t`, `\r`).

## 2. Accessibility Baseline (EU European Accessibility Act — EAA / RGAA 4.1)
- Comply with Directive (EU) 2019/882 (EAA) and French **RGAA 4.1 / WCAG 2.1 Level AA**:
  - Full keyboard operability (`Tab`, `Shift+Tab`, `Enter`, `Escape`, arrow keys in menus/tables) with visible focus indicators.
  - Semantic HTML landmarks, explicit form `<label>` associations, `aria-invalid` and `aria-describedby` for validation errors, and `aria-live` announcements for async state changes.
  - Text and interactive element color contrast $\ge 4.5:1$.
  - Responsive layout from `320 px` mobile width to desktop without horizontal scrolling or loss of functionality.

## 3. Mandatory Automated Test Suites

### Domain & Regulatory Unit Tests
- **EN 16931 Rate-Level VAT Rounding**: Verify that VAT is calculated and rounded (`ROUND_HALF_UP`) per VAT rate on the sum of net taxable bases for that rate, and test edge cases where line-by-line VAT rounding would diverge from rate-level rounding.
- **French & EU Legal Identifiers**: Luhn check for 9-digit `SIREN` and 14-digit `SIRET`, French intra-EU VAT key calculation, and mandatory B2B invoice field validation (€40 recovery indemnity, late penalty rate, `operation_category`, exemption mentions).
- **Deposit Invoices & Credit Notes**: Deposit invoice issuance (`419100`), deposit deduction on final settlement invoice, and partial/full credit note reversal calculations.
- **VAT Exigibility (`Débits` vs `Encaissements`)**: Verify immediate `44571` posting in `DEBITS` mode vs `44574` pending VAT at issuance followed by exact pro-rata transfer `44574` $\rightarrow$ `44571` upon partial and full payments in `ENCAISSEMENTS` mode.
- **PCG 2025 & Double-Entry Balance**: Verify $\sum \text{Debit} = \sum \text{Credit} > 0$, auxiliary account requirement (`CompAuxNum`) on `411000`/`401000`, and balanced third-party lettering (`EcritureLet` / `DateLet`).

### Database, Concurrency & API Integration Tests
- **Tenant Isolation & RLS**: Verify that every endpoint and SQL query denies cross-tenant access and that missing `app.current_workspace_id` context returns zero rows.
- **Gapless Numbering under Concurrency & Rollback**: Run 20 concurrent invoice issuance and journal posting requests interleaved with forced transaction rollbacks; verify strictly continuous numbering (`1..N`) with zero gaps and zero duplicates.
- **PostgreSQL Immutability Triggers**: Verify that direct SQL `UPDATE` or `DELETE` statements against issued `invoices`, posted `journal_entries`/`journal_entry_lines`, closed `accounting_periods`, and `audit_events` raise a database exception.
- **Irreversible Period Closure**: Verify that closing a period seals the period, generates `AN` (*À-Nouveaux*) opening entries in period $N+1$, blocks any further posting in period $N$, and blocks reopening period $N$.
- **Factur-X & FEC Compliance Validators**:
  - Validate generated `factur-x.xml` against official **EN 16931 CII** schemas and business rules (`BR-CO-*`, `BR-S-*`).
  - Validate generated `{SIREN}FEC{YYYYMMDD}.txt` against all 18-column **DGFiP Test Compta Demat** rules.

### End-to-End (E2E) User Journey Tests
1. **Onboarding & Tiers**: Configure French company profile (`SIREN`/`SIRET`) $\rightarrow$ create B2B customer via SIREN auto-lookup.
2. **Sales & Factur-X Flow**: Create Quote $\rightarrow$ issue Deposit Invoice $\rightarrow$ issue Final Standard Invoice deducting deposit $\rightarrow$ download Factur-X PDF/A-3 $\rightarrow$ issue partial Credit Note.
3. **Purchase & Multi-Rate Expense Flow**: Upload supplier Factur-X PDF / receipt $\rightarrow$ review multi-rate VAT (10% + 20% + 80% fuel deductibility) $\rightarrow$ approve and post to `AC` journal.
4. **Bank Reconciliation & Cash VAT Flow**: Import bank CSV $\rightarrow$ match payment to invoice $\rightarrow$ verify automatic `BQ` entry, `411xxx` lettering (`EcritureLet`), and `44574` $\rightarrow$ `44571` VAT realization.
5. **Close & Statutory Export Flow**: Export Micro *Livre des recettes* OR run pre-close check $\rightarrow$ permanently close fiscal year $\rightarrow$ export and validate **FEC**.
