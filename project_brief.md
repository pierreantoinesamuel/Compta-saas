# Project Brief

## Vision
Build a modern, approachable, and legally rigorous accounting and business-finance SaaS for French and European small businesses (`Haxatax`). The application combines the clean, high-clarity UX of modern fintech software with the proven functional depth of [Dolibarr ERP/CRM](https://wiki.dolibarr.org/index.php/Home) ([GitHub](https://github.com/Dolibarr/dolibarr)), implemented as a 100% custom React, TypeScript, and PostgreSQL web platform.

## Problem
French freelancers and small businesses face two extremes:
1. Overly simplistic invoicing tools that fail French tax audits (missing mandatory mentions, broken VAT rounding, no deposit invoices or credit notes, no Factur-X, no accounting ventilation or valid FEC export).
2. Legacy accounting packages with steep learning curves and dated interfaces.

Haxatax bridges this gap by offering a progressive, step-by-step accounting engine that adapts to the company's legal form (`Micro-entreprise` vs `Société commerciale / EI au réel`) while enforcing strict French (DGFiP, Code de commerce, CGI, PCG 2025) and EU (EN 16931 / Factur-X, GDPR, VIES, EAA/RGAA) standards under the hood.

## Target users (Step-by-Step Rollout)
- **Tier 1 — Freelancers & Micro-entrepreneurs (`Micro-entreprise` / `Auto-entrepreneur`)**: Need compliant quotes, standard/deposit invoices, credit notes, franchise de TVA (`Art. 293 B CGI`) or VAT management, automatic *Livre des recettes* and *Registre des achats*, and URSSAF turnover tracking.
- **Tier 2 — Commercial Companies & Real-Regime Businesses (`SASU`, `SAS`, `EURL`, `SARL`, `EI`)**: Need cash visibility, automated purchase collection with multi-rate VAT, bank reconciliation, and a full **PCG 2025** double-entry ledger (`VE`, `AC`, `BQ`, `OD`, `AN`) with auxiliary accounts (`411`/`401`), lettering (`lettrage`), VAT on debits vs cash receipts, and statutory **FEC** export.
- **Tier 3 — Bookkeepers & Chartered Accountants (`Experts-comptables`)**: Need source document traceability (*Piste d'Audit Fiable*), accounting ventilation review queues, period lock/close workflows, and validated FEC / Factur-X exports.

## Product principles
1. **Clarity before feature density**: Progressive disclosure based on the workspace's fiscal regime (`MICRO` vs `REEL_PCG`).
2. **User confirmation for consequential financial actions**: Issuing an invoice, issuing a credit note, posting to the ledger, and closing a period require explicit confirmation.
3. **Authoritative server & database invariants**: Accounting rules, EN 16931 tax rounding, gapless numbering, and immutability belong in the backend domain layer and PostgreSQL triggers—never in UI components.
4. **Dolibarr-grade domain completeness**: Inspire workflows from Dolibarr's proven modules (`Tiers`, `Factures & Avoirs`, `Acomptes`, `Règlements`, `Banque`, `Comptabilité en partie double`, `Lettrage`, `BlockedLog`).
5. **Cryptographic immutability**: Never silently alter or delete issued invoices, posted entries, or audit logs; chain records with SHA-256 hashes and correct exclusively via credit notes (`avoirs`) or reversal entries (`contre-passation`).
6. **AI suggests; deterministic rules and humans decide**: OCR/AI extraction is always marked unverified until human review and Hosted in the EU under GDPR Zero-Data-Retention rules.
7. **Accessible & responsive by design**: Compliant with EU European Accessibility Act (EAA / RGAA 4.1 / WCAG 2.1 AA) and responsive from 320 px to desktop.

## Step-by-Step MVP Scope
### Phase A — Core Platform, Third-Parties & Factur-X Invoicing (Micro & Société)
- Authentication (with MFA support for sensitive operations) and company workspace with full French legal identity (SIREN/SIRET, RCS/RM, APE/NAF, legal form, share capital, VAT regime & exigibility).
- Unified third-party (`Tiers`) directory (customers, suppliers, prospects) with B2B/B2C distinction, SIREN/SIRET lookup (API Annuaire des Entreprises / INSEE), and EU VIES VAT validation.
- Quotes (`Devis`), Draft and Issued Standard Invoices (`Factures`), Deposit Invoices (`Factures d'acompte`), and Credit Notes (`Factures d'avoir`).
- Native **Factur-X (PDF/A-3 + EN 16931 CII XML)** generation and download, with mandatory French B2B mentions (€40 recovery indemnity, late payment penalties, operation category: goods/services/mixed).
- Customer payment recording, partial payments, and deposit deduction on final settlement invoices.
- Micro-entreprise statutory books (*Livre des recettes encaissées* and *Registre des achats*).

### Phase B — Purchases, Bank Reconciliation & Automated PCG 2025 Ledger
- Expense/supplier document upload (PDF/A preservation, SHA-256 hash), multi-rate VAT breakdown (20%, 10%, 5.5%, 2.1%, 0%, reverse charge), and non-deductible VAT ratio handling.
- CSV bank statement import, deduplication, and $N \leftrightarrow M$ reconciliation matching (partial payments, grouped invoices, bank fee write-offs).
- **PCG 2025 (ANC 2022-06)** double-entry ledger (`AN`, `VE`, `AC`, `BQ`, `OD`) with auxiliary accounts (`411xxx`, `401xxx`).
- Automated Accounting Binding Engine (*Ventilation comptable*): issuing invoices/credit notes, approving expenses, and reconciling payments automatically generate draft/validated journal entries.
- Third-party account lettering (`Lettrage` / `Délettrage` with `EcritureLet` and `DateLet`).
- VAT return preparation helper (`CA3` / `CA12` mapping) handling both **VAT on debits (`TVA sur les débits`)** and **VAT on cash receipts (`TVA sur les encaissements`)**.
- Irreversible fiscal period closure (`Clôture d'exercice`), carry-forward generation (`À-Nouveaux`), and **18/22-column statutory FEC export (Art. L47 A-I LPF)** with structural self-check.

## Explicitly out of scope for initial MVP
- Direct automated teletransmission to DGFiP (`EDI-TVA` / `EDI-TDFC`) — the app prepares auditable figures and exports, while filing remains via `impots.gouv.fr` or the chartered accountant.
- Unreviewed AI-generated journal posting.
- Payroll (`Paie` / `DSN`), physical warehouse stock valuation, and multi-company holding consolidation.
- Direct PDP accreditation (the app generates standard Factur-X and implements PDP/PPF webhook/API connectors).

## Success measures
- Every issued invoice, deposit invoice, and credit note embeds a valid Factur-X EN 16931 XML payload and includes all mandatory CGI / Code de commerce mentions.
- VAT totals match EN 16931 rate-level rounding rules across UI, API, XML, PDF, and ledger entries.
- Concurrent invoice issuances or rolled-back transactions never create a gap or duplicate in sequential numbering.
- Micro-entrepreneurs can export an auditable *Livre des recettes* immediately; commercial companies can export a syntactically and mathematically valid 18/22-column **FEC**.
- Tenant isolation, RBAC permissions, PostgreSQL immutability triggers, and hash-chain verification tests pass at 100%.
