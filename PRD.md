# Product Requirements Document (PRD)

## 1. Summary
Create a French-first, EU-compliant, responsive accounting and invoicing SaaS (`Haxatax`) built with React, TypeScript, and PostgreSQL, inspired functionally by [Dolibarr ERP/CRM](https://wiki.dolibarr.org/index.php/Home). The platform supports both **Micro-entrepreneurs** (cash-basis *Livre des recettes/achats*, *franchise en base de TVA*) and **Commercial Companies / Real-Regime Businesses** (`SASU`, `SAS`, `EURL`, `SARL`, `EI` under **PCG 2025** double-entry accounting, **Factur-X** e-invoicing, and **FEC** statutory exports) in a step-by-step modular architecture.

## 2. Personas
### P1 — Micro-entrepreneur / Independent freelancer
Needs to create compliant quotes, deposit invoices, standard invoices, and credit notes quickly, track cash receipts, monitor VAT and micro-enterprise turnover thresholds, and export a compliant *Livre des recettes*.
### P2 — Small-business director (SASU, SAS, EURL, SARL)
Needs Factur-X compliant B2B invoicing, multi-rate expense collection, cash-flow and VAT visibility (debits vs cash receipts), bank reconciliation, and automated accounting ventilation without manual double entry.
### P3 — Bookkeeper / Chartered Accountant (`Expert-comptable`)
Needs *Piste d'Audit Fiable* (PAF) traceability, Dolibarr-style accounting binding (`ventilation comptable`), auxiliary account lettering (`lettrage`), period closure controls, and a compliant 18/22-column **FEC** export.

## 3. Core journeys
1. **Onboarding & Legal Setup**: Register $\rightarrow$ create workspace $\rightarrow$ lookup SIREN/SIRET via INSEE/Annuaire API $\rightarrow$ select legal form (`MICRO`, `SASU`, `SARL`, etc.), accounting mode (`CASH_MICRO` vs `DOUBLE_ENTRY_PCG2025`), VAT regime (`FRANCHISE_293B`, `REEL_SIMPLIFIE`, `REEL_NORMAL`), and VAT exigibility (`DEBITS` vs `ENCAISSEMENTS`).
2. **Third-Party (`Tiers`) Creation**: Create customer or supplier $\rightarrow$ specify B2B/B2C and zone (France, EU Intra-community, Non-EU) $\rightarrow$ validate SIREN/SIRET and EU VAT number (VIES) $\rightarrow$ auto-assign auxiliary account code (`411xxx` / `401xxx`).
3. **Sales Cycle (Quote $\rightarrow$ Deposit $\rightarrow$ Final Invoice $\rightarrow$ Credit Note)**:
   - Optional Quote (`Devis`) $\rightarrow$ convert to Deposit Invoice (`Facture d'acompte`) upon down-payment $\rightarrow$ issue Final Settlement Invoice (`Facture de solde` deducting the deposit) $\rightarrow$ generate **Factur-X (PDF/A-3 + EN 16931 XML)** $\rightarrow$ automatic accounting ventilation into sales journal (`VE`).
   - If correction needed on an issued invoice $\rightarrow$ create linked Credit Note (`Facture d'avoir`) $\rightarrow$ issue with gapless sequence and reverse/adjust ledger & VAT.
4. **Payment & VAT Exigibility**: Record payment or match bank transaction $\rightarrow$ update outstanding balance $\rightarrow$ generate bank journal entry (`BQ`) $\rightarrow$ automatically letter (`lettrer`) the `411xxx` auxiliary account $\rightarrow$ if VAT is on cash receipts (`TVA sur les encaissements`), transfer VAT from pending account (`44574`) to collected VAT (`44571`).
5. **Purchases & Multi-Rate Expenses**: Upload supplier invoice/receipt (Factur-X XML auto-parsed if present, or OCR suggestion) $\rightarrow$ human review of supplier, lines, multi-rate VAT, and deductibility ratio $\rightarrow$ approve expense $\rightarrow$ generate purchase journal entry (`AC`).
6. **Banking & Reconciliation**: Import bank CSV (or DSP2 Open Banking feed) $\rightarrow$ deduplicate via fingerprint $\rightarrow$ match $1 \leftrightarrow 1$ or $N \leftrightarrow M$ against invoices/expenses/payments $\rightarrow$ audit and letter.
7. **Period Close & Regulatory Exports**: Pre-close check (no draft entries in period, balanced journals, gapless numbering) $\rightarrow$ permanent period lock (`Clôture définitive`) + carry-forward (`À-Nouveaux`) $\rightarrow$ export **FEC** (or *Livre des recettes* for Micro).

## 4. Functional requirements

### Authentication, Workspace & Legal Identity
- **FR-001**: Users authenticate via verified sessions; MFA (2FA) is supported and enforceable for issuing documents, changing bank IBANs, and closing accounting periods.
- **FR-002**: Every workspace stores mandatory French legal identity fields: `siren` (9 digits, Luhn-checked), `siret` (14 digits), `legal_form`, `share_capital_minor`, `rcs_city`, `rcs_number` (or `rm_number`), `naf_code`, `vat_number` (intra-EU format), `fiscal_regime` (`MICRO` vs `REEL`), `vat_regime`, and `vat_exigibility` (`DEBITS` vs `ENCAISSEMENTS`).
- **FR-003**: API access is denied unless user membership and granular role permissions are verified server-side.
- **FR-004**: Cross-tenant isolation is strictly enforced at both service and PostgreSQL RLS levels.

### Contacts (`Tiers` — Customers & Suppliers)
- **FR-010**: Create, read, update, and archive contacts with roles (`customer`, `supplier`, `both`).
- **FR-011**: Distinguish B2B (`is_business = true`) vs B2C (`is_business = false`) and tax territory (`DOMESTIC_FR`, `DOM_TOM`, `INTRA_EU`, `EXPORT_NON_EU`).
- **FR-012**: For B2B French customers, `siren`/`siret` and billing address are mandatory before invoice issuance (2026 e-invoicing requirement). For Intra-EU B2B customers, `vat_identifier` is required and validated against VIES for reverse-charge (`autoliquidation`) eligibility.
- **FR-013**: Each contact in `REEL` mode is linked to a unique auxiliary account (`CompAuxNum`, e.g., `411CLI001` or `401FOU001`).

### Invoicing, Deposits & Credit Notes (Factur-X & Code de commerce)
- **FR-020**: Support four sales document types inspired by Dolibarr: Quote (`quote`), Standard Invoice (`standard_invoice`), Deposit Invoice (`deposit_invoice`), and Credit Note (`credit_note`).
- **FR-021**: Line items support description, quantity, UN/ECE unit code (`C62` unit, `HUR` hour, `DAY` day, etc.), unit price (HT), line discount, nature (`goods` or `services`), VAT rule/rate, and PCG product account (`706xxx`, `707xxx`, etc.).
- **FR-022**: **EN 16931 / DGFiP VAT Calculation**: Server computes line net totals (`HT`), aggregates net bases by VAT rate (`invoice_tax_breakdowns`), and calculates VAT per rate as `ROUND_HALF_UP(sum_base_ht_for_rate * vat_rate)`. Total TTC equals `sum_base_ht + sum_vat_by_rate`.
- **FR-023**: Mandatory French disclosures are enforced and snapshotted at issuance (`issuer_snapshot` and `customer_snapshot`):
  - Operation category (`BIENS`, `SERVICES`, `MIXTE`).
  - Execution/delivery date (`date de livraison ou de fin d'exécution de la prestation`).
  - Payment due date, early payment discount terms (`conditions d'escompte` or *"Néant"*), late payment interest rate (`taux des pénalités de retard`, minimum $3 \times$ legal interest rate), and mandatory **€40 recovery indemnity** (`Indemnité forfaitaire pour frais de recouvrement : 40 €` for B2B).
  - Legal VAT exemption mention when VAT rate is 0% (e.g., *"TVA non applicable, art. 293 B du CGI"*, *"Autoliquidation — Art. 283-2 du CGI"*, or *"Exonération de TVA — Art. 262 ter I du CGI"*).
- **FR-024**: Issuance allocates a **gapless chronological document number** within a database transaction (`SELECT ... FOR UPDATE`), computes a cryptographic SHA-256 hash chained to the previous issued document (`previous_document_hash`, `document_hash`), and locks the record against any mutation.
- **FR-025**: Credit notes (`Factures d'avoir`) must explicitly reference the original issued invoice (`original_invoice_id` and original invoice number/date) and use their own gapless numbering series (or unified series per workspace policy).
- **FR-026**: Deposit invoices (`Factures d'acompte`) trigger VAT exigibility upon cash receipt (Art. 289-I-1-c CGI) and are linked and deducted transparently on the final settlement invoice (`Facture de solde`).
- **FR-027**: Every issued invoice, deposit invoice, and credit note generates an archival **Factur-X PDF/A-3** file embedding the validated **EN 16931 CII XML** (`factur-x.xml`) and tracks its e-invoicing lifecycle status (`not_sent`, `deposited`, `rejected`, `refused`, `accepted`, `cashed`).

### Expenses, Purchase Documents & Piste d'Audit Fiable (PAF)
- **FR-030**: Users upload purchase invoices/receipts (`PDF`, `JPEG`, `PNG`, `Factur-X PDF`). If the file is a Factur-X PDF, the server parses the embedded XML deterministically; otherwise, optional EU-hosted OCR extracts candidate fields marked `unverified`.
- **FR-031**: Expenses support **multi-rate VAT lines** (`expense_lines`), PCG expense account assignment (`601`–`628`), and partial VAT deductibility ratios (e.g., 80% on vehicle fuel, 0% on passenger transport).
- **FR-032**: Uploaded source documents are hashed (`SHA-256`), timestamped, and stored immutably for **10 years** (Art. L123-22 Code de commerce / NF Z42-013 PAF principles).

### Banking & Reconciliation
- **FR-040**: Import bank statements (CSV, CFONB/CAMT.053 ready) with preview and deterministic transaction fingerprinting.
- **FR-041**: Support $N \leftrightarrow M$ reconciliation matching: one bank line can settle multiple invoices (grouped payment), multiple bank lines can settle one invoice (installments/deposits), and minor payment differences/bank fees can be balanced to account `627xxx` or `658`/`758` during reconciliation.
- **FR-042**: Confirming a reconciliation match can automatically trigger payment recording, `BQ` journal entry creation, auxiliary account lettering (`lettrage`), and VAT-on-cash-receipts (`TVA sur les encaissements`) realization.

### Accounting (PCG 2025, Ventilation, Lettrage & FEC)
- **FR-050**: Provide a pre-configured, versioned **PCG 2025 (Règlement ANC n° 2022-06)** chart of accounts (updating expense transfer rules and exceptional accounts `67`/`77`), customizable per workspace.
- **FR-051**: Standard French journals (`AN` À-Nouveaux, `VE` Ventes, `AC` Achats, `BQ` Banque, `OD` Opérations Diverses, `CA` Caisse).
- **FR-052**: Automated Accounting Binding Engine (*Ventilation comptable*): sales documents, approved expenses, and payments automatically generate balanced journal entries referencing the exact source document (`PieceRef`, `PieceDate`).
- **FR-053**: Distinguish **Draft (`brouillard`)** entries (editable before period close) from **Validated (`posted` / `validée`)** entries (assigned a final gapless `EcritureNum`, `ValidDate`, and SHA-256 hash chain; strictly immutable).
- **FR-054**: Support **Auxiliary Account Lettering (`Lettrage`)**: link debit and credit lines on third-party accounts (`411`/`401`) with a balanced lettering code (`AA`, `AB`, ...) and date (`DateLet`), required for FEC compliance.
- **FR-055**: **Irreversible Period Closure**: Closing a fiscal year verifies all entries are validated (`posted`), journals are balanced, and sequences are gapless; locks the period permanently (**never reopenable** under French law); and generates carry-forward entries in the `AN` journal of period $N+1$.
- **FR-056**: **Statutory Exports**:
  - For `REEL` companies: Generate the official **18/22-column FEC (`Fichier des Écritures Comptables`, Art. L47 A-I LPF)** named `{SIREN}FEC{YYYYMMDD}` with built-in structural validation (encoding, columns, date format `YYYYMMDD`, comma decimal separator, zero balance check).
  - For `MICRO` businesses: Generate the statutory *Livre des recettes* (chronological, immutable cash receipts register) and *Registre des achats*.

### Dashboard, VAT Reporting & Operations
- **FR-060**: Dashboard metrics clearly separate **Invoiced Turnover (`CA Facturé HT`)** from **Collected Cash (`Encaissements TTC/HT`)** and show real-time Micro-entreprise threshold gauges or company cash-flow projections.
- **FR-061**: VAT Declaration Preparation (`CA3` / `CA12` report) calculates deductible and collected VAT for a period by properly applying `DEBITS` vs `ENCAISSEMENTS` rules and intra-EU reverse charge lines, with full drill-down to source documents.
- **FR-070**: Every consequential action writes an append-only, hash-chained `audit_event`.

## 5. Non-functional requirements (France & EU Standards)
- **NFR-001 (Accessibility — EAA / RGAA 4.1)**: Comply with the European Accessibility Act (Directive EU 2019/882) and French RGAA 4.1 / WCAG 2.1 AA (keyboard navigation, ARIA roles, focus states, contrast $\ge 4.5:1$, responsive down to 320 px).
- **NFR-002 (GDPR & EU Data Sovereignty)**: Host all databases, object storage, backups, and OCR/AI processing exclusively within the European Union (`eu-west-3` Paris or `eu-central-1` Frankfurt).
- **NFR-003 (10-Year Statutory Retention vs GDPR Erasure)**: Enforce a dual data-lifecycle policy—10-year immutable retention for invoices, vouchers, and ledger records (Art. L123-22 Code de commerce, overriding GDPR Art. 17 right to erasure under Art. 17.3.b), while allowing erasure/anonymisation of non-financial personal data.
- **NFR-004 (Database-Enforced Immutability)**: Enforce immutability of issued documents, posted entries, and audit logs via both domain services and PostgreSQL `BEFORE UPDATE OR DELETE` triggers.
- **NFR-005 (Decimal Precision)**: Use `BIGINT` minor units (cents) for monetary totals and exact decimal arithmetic (`NUMERIC` / `decimal.js`) for quantities, unit prices, discounts, and EN 16931 VAT rate breakdowns.

## 6. Acceptance criteria examples
- **EN 16931 VAT Rounding**: Given an invoice with multiple lines sharing the 20% VAT rate, the invoice VAT total for 20% equals `ROUND_HALF_UP(SUM(line_ht_20) * 0.20)` and matches the embedded Factur-X XML and generated `VE` journal entry to the exact cent.
- **Gapless Concurrency**: Given 20 concurrent `POST /invoices/{id}/issue` requests and 2 simulated transaction rollbacks, the allocated invoice numbers form a strictly continuous sequence with zero gaps and zero duplicates.
- **Immutability & Credit Note**: Given an issued invoice, any `PATCH` or `DELETE` at API or SQL level is rejected; issuing a linked credit note creates a new sequential document and posts the exact reversing `VE` entry.
- **VAT on Cash Receipts (`Encaissements`)**: Given a workspace configured with `vat_exigibility = 'ENCAISSEMENTS'`, issuing a service invoice credits pending VAT (`44574`); only when a payment/bank match is recorded does the system transfer the corresponding VAT proportion from `44574` to collected VAT (`44571`).
- **FEC Validation**: Given a closed or open fiscal year with posted sales, purchases, and lettered bank payments, the exported `{SIREN}FEC{YYYYMMDD}.txt` passes all 18/22-column structural, date, numbering, and debit/credit equilibrium checks.
