# Application Workflow System (Dolibarr-Inspired French & EU Workflows)

## Navigation map
- `/dashboard` — CA Facturé vs Encaissé, Micro-entreprise threshold gauges, overdue receivables, VAT alerts
- `/sales/quotes` — Devis / Propositions commerciales
- `/sales/invoices` — Factures standards & Factures d'acompte
- `/sales/invoices/new` — Éditeur de facture / acompte (avec prévisualisation Factur-X)
- `/sales/invoices/:id` — Détail facture, statut PDP/Factur-X, règlements, création d'avoir ou d'acompte
- `/sales/credit-notes` — Factures d'avoir
- `/contacts` — Tiers (Clients, Fournisseurs, Prospects — lookup SIREN/SIRET & validation VIES)
- `/purchases` — Factures fournisseurs & Dépenses multi-taux
- `/purchases/documents` — Boîte de réception justificatifs (parsing Factur-X XML & revue OCR + archivage PAF)
- `/banking` — Comptes bancaires (`512xxx`) & Imports relevés (CSV / CFONB / CAMT.053)
- `/banking/reconciliation` — Rapprochement bancaire $N \leftrightarrow M$ & Lettrage automatique
- `/accounting/journals` — Journaux auxiliaires (`AN`, `VE`, `AC`, `BQ`, `OD`, `CA`) & Ventilation comptable
- `/accounting/accounts` — Plan Comptable Général **PCG 2025** & Comptes auxiliaires (`411xxx` / `401xxx`)
- `/accounting/lettering` — Lettrage / Délettrage des comptes de tiers (`EcritureLet` / `DateLet`)
- `/accounting/periods` — Exercices comptables, pré-clôture, clôture définitive irréversible & À-Nouveaux
- `/tax/vat` — Cadrage de TVA (`CA3` / `CA12` — TVA sur les débits vs TVA sur les encaissements, Autoliquidation)
- `/reports` — Livre des recettes & Registre des achats (Micro), Grand Livre, Balance, Export & Contrôle **FEC**
- `/settings/company` — Identité légale française (SIREN/SIRET, RCS/RM, APE, Capital, Régime Micro vs Société, Régime TVA, Numérotation)
- `/settings/einvoicing` — Paramétrage Factur-X (EN 16931) & Connecteur PDP / PPF
- `/settings/team` — Utilisateurs, rôles RBAC & accès Expert-comptable
- `/settings/security` — Authentification MFA (2FA), intégrité de la chaîne cryptographique (`BlockedLog`) & RGPD
- `/help` — Documentation et guide de conformité

## Global interaction model (RGAA 4.1 / EAA Accessible)
- Each page has one clear primary action and progressive disclosure adapted to the workspace mode (`CASH_MICRO` hides complex double-entry screens behind an expert toggle while keeping underlying accounting data clean; `DOUBLE_ENTRY_PCG2025` exposes full journals, lettering, and FEC tools).
- Preserve filters and unsaved form state where safe.
- Require explicit confirmation (and step-up MFA where configured) for irreversible financial actions: issuing an invoice/credit note, validating (`posting`) journal entries, and permanently closing a fiscal period.
- Every page implements accessible loading, empty, validation-error, server-error, and success states.
- Never report success until the server transaction commits.

## Sales Document Lifecycle (Quotes, Deposit Invoices, Standard Invoices, Credit Notes)
Inspired by Dolibarr's `llx_facture` workflow and French 2026 E-Invoicing standards, every sales document tracks **three orthogonal status dimensions**:

### 1. Document Legal Status (`status`)
```text
[Quote / Devis]
Draft (PROV) -> Sent -> Accepted -> Converted to Deposit Invoice and/or Standard Invoice
                   +-> Refused / Expired

[Standard Invoice / Deposit Invoice]
Draft (PROV-xxxx) -> Ready for review -> Issued (FA-YYYY-NNNNN, immutable, Factur-X generated)
                                              |
                                              +-> Cancelled / Corrected by linked Credit Note (AV-YYYY-NNNNN)
```
- **Draft (`PROV-xxxx`)**: Editable; no official invoice number allocated yet.
- **Issued (`FA-...` / `AC-...` / `AV-...`)**: Strictly immutable. Allocates gapless number, freezes `issuer_snapshot` and `customer_snapshot`, computes EN 16931 rate-level VAT breakdown, chains `document_hash` (`SHA-256`), generates Factur-X PDF/A-3 + XML, and automatically triggers accounting ventilation (`VE` journal entry).
- **Credit Note (`Facture d'avoir`)**: Created from an issued invoice (`original_invoice_id`). Can credit the full invoice or specific lines/amounts, reversing the corresponding revenue and VAT.

### 2. Payment Status (`payment_status`)
```text
Unpaid -> Partially paid (or Deposit applied) -> Paid
                                             +-> Overpaid (requires explicit credit note or advance allocation)
```
- When a payment is recorded or matched from a bank transaction:
  - In `CASH_MICRO` mode: appends an immutable entry to the chronological *Livre des recettes*.
  - In `DOUBLE_ENTRY_PCG2025` mode: posts a `BQ` journal entry, automatically letters (`lettrage` `AA`, `AB`...) the customer's `411xxx` auxiliary account lines when $\sum \text{Debit} = \sum \text{Credit}$, and—if the workspace uses **VAT on cash receipts (`TVA sur les encaissements`)**—transfers the proportional VAT from pending account `44574` to collected account `44571`.

### 3. E-Invoicing Reform Lifecycle (`einvoice_status` — 2026/2027 PDP / PPF)
```text
Not applicable / Pending -> Deposited (Déposée) -> Accepted / In progress -> Cashed (Encaissée)
                                               +-> Rejected (Rejetée technique)
                                               +-> Refused (Refusée métier par le client -> nécessite un Avoir)
```

## Expense & Purchase Document Lifecycle (PAF Compliant)
```text
Uploaded (SHA-256 hashed) -> Factur-X XML Parsed OR EU OCR Processing -> Needs Human Review
                                    |                                           |
                                    +-> Failed                                  +-> Confirmed & Ventilated (6xx + Multi-rate VAT)
                                                                                +-> Rejected / Duplicate Flagged
```
- Native Factur-X supplier PDFs have their embedded XML parsed deterministically.
- Non-Factur-X receipts use EU-hosted OCR suggestions; human review is mandatory to confirm supplier (`401xxx`), `PieceRef`, `PieceDate`, multi-rate VAT breakdown, and deductibility ratio (e.g., 80% fuel, 0% non-deductible) before posting to the `AC` journal.

## Bank Import & $N \leftrightarrow M$ Reconciliation Lifecycle
```text
Statement Selected (CSV/CFONB/CAMT.053) -> Preview & Fingerprint Dedup -> Confirmed Import
                                                                              |
                                                                              v
                                           Unmatched Bank Line -> N-to-M Match Suggestion -> Confirmed Match
                                                                                                +-> Posts BQ Entry
                                                                                                +-> Letters 411/401 (EcritureLet)
                                                                                                +-> Realizes Cash-Basis VAT (44574 -> 44571)
```

## Journal Entry & Lettering Lifecycle (PCG 2025 & FEC)
```text
Brouillard (Draft / Validated) -> Posted (Validée définitivement: EcritureNum + ValidDate + SHA-256 Hash)
                                       |
                                       +-> Reversed via separate Contre-passation entry (never edited in place)
```
- **Auxiliary Lettering (`Lettrage`)**: On third-party accounts (`411`/`401`), debit and credit lines belonging to the same `CompAuxNum` whose sum balances to zero are grouped under a unique `EcritureLet` code and `DateLet`.

## Accounting Period Lifecycle (Strict French Irreversibility Rule)
```text
Open (Ouvert) -> Closing Review (Pré-clôture / Révision) -> Closed (Clôturé définitivement — IRRÉVERSIBLE)
```
- **`Open`**: Normal operations and postings allowed.
- **`Closing Review` (*Pré-clôture*)**: Temporary lock during accountant review; can return to `Open` if adjustments are needed before final closure.
- **`Closed` (*Clôturé définitivement*)**:
  - Verifies zero draft entries remain, all journals balance, and FEC validation passes with zero errors.
  - Permanently seals the fiscal year (`closing_seal_hash`) and generates the opening balance sheet entries in the `AN` (*À-Nouveaux*) journal of fiscal year $N+1$.
  - **Under French accounting law (PCG / DGFiP FEC), a `Closed` period can NEVER be reopened.** Any subsequent adjustment must be recorded in the next open fiscal period.

## Permissions matrix (Server-Enforced RBAC)
- **Owner / Admin**: Workspace legal settings, numbering series, team roles, all operational workflows.
- **Finance / Manager**: Contacts, quotes, invoices, credit notes, expenses, bank imports, reconciliation, reports; no role administration or permanent period closure by default.
- **Accountant / Reviewer (`Expert-comptable`)**: Full access to accounting journals (`AN`, `VE`, `AC`, `BQ`, `OD`), chart of accounts (`PCG 2025`), accounting ventilation, lettering (`lettrage`), VAT `CA3` review, permanent period closure, and statutory **FEC** export.
- **Read-only / Auditor**: View permitted records, PAF audit chain, and exports; zero mutation rights.
