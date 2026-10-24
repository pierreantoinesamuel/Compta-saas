# Accounting & Invoicing Domain Rules — French (DGFiP / PCG 2025) & EU Standards

**This document defines the authoritative French and European accounting, invoicing, and tax invariants enforced by the server domain layer and PostgreSQL database.** Its functional patterns draw on [Dolibarr ERP/CRM](https://wiki.dolibarr.org/index.php/Home) (`Compta/Facturation/BlockedLog`) adapted to French commercial law (*Code de commerce*), tax law (*CGI* & *LPF*), **PCG 2025 (Règlement ANC n° 2022-06)**, and **EU Standard EN 16931 (Factur-X)**.

---

## 1. General principles & Piste d'Audit Fiable (PAF — Art. L102 B LPF)
- **Server & Database Authority**: The backend domain layer and PostgreSQL constraints/triggers are authoritative. Frontend calculations are strictly previews.
- **End-to-End Traceability (PAF)**: Every financial record must maintain an unbroken, bidirectional link between the **original source document** (quote, purchase order, supplier receipt, issued Factur-X invoice), the **commercial transaction** (invoice, expense, payment, bank line), and the **accounting journal entry** (`PieceRef`, `PieceDate`, `source_type`, `source_id`).
- **10-Year Statutory Retention**: Issued invoices, supplier vouchers, bank transactions, and posted accounting entries must be preserved unaltered for **10 years** from the close of the fiscal year (Art. L123-22 Code de commerce).
- **Cryptographic Hash Chaining (`BlockedLog` pattern)**: Every issued sales document (`invoices`), validated journal entry (`journal_entries` with `status = 'posted'`), and consequential `audit_event` computes an immutable `SHA-256` hash incorporating its canonical payload and the `previous_hash` of the preceding record in the workspace sequence.
- **Two Supported Fiscal Modes**:
  1. `MICRO` (*Micro-entreprise*): Cash-basis tracking (*Livre des recettes encaissées* & *Registre des achats*), VAT franchise (`Art. 293 B CGI`) or standard VAT, no mandatory double-entry balance sheet required (though double-entry can be generated transparently in the background so upgrading to a company is seamless).
  2. `REEL_PCG2025` (*SASU, SAS, EURL, SARL, EI au réel*): Full double-entry accounting compliant with PCG 2025 and statutory 18/22-column FEC export.

---

## 2. Money, precision, and EN 16931 / DGFiP VAT rounding
- **No Binary Floating-Point**: Never use IEEE 754 `float`/`double` or JS `number` floats for authoritative monetary calculations. Use `BIGINT` minor units (euro cents) for stored monetary amounts and `NUMERIC(19,6)` / `decimal.js` for unit prices, quantities, discounts, and tax rates.
- **Rounding Mode**: Commercial half-up rounding (`ROUND_HALF_UP`: `0.005 €` rounds to `0.01 €`, per Art. 1724 CGI and EN 16931).
- **Mandatory Rate-Level VAT Calculation (EN 16931 / Chorus Pro / Factur-X Rule)**:
  1. For each invoice line $i$:
     $$\text{LineNetHT}_i = \text{ROUND\_HALF\_UP}\left(\text{Quantity}_i \times \text{UnitPriceHT}_i \times \left(1 - \frac{\text{DiscountPercent}_i}{100}\right) - \text{DiscountAmount}_i\right)$$
  2. Group all lines by their applied VAT rule / rate $r$ (e.g., `20.00%`, `10.00%`, `5.50%`, `2.10%`, `0.00%`).
  3. For each distinct VAT rate $r$, compute the **Taxable Base (`Base HT par taux`)**:
     $$\text{TaxableBaseHT}_r = \sum_{i \in r} \text{LineNetHT}_i$$
  4. Compute the **Authoritative VAT Amount for rate $r$** by rounding **once at the rate breakdown level** (and never by summing rounded line-level VAT amounts, which causes EN 16931 / Factur-X validation rejections):
     $$\text{VATAmount}_r = \text{ROUND\_HALF\_UP}(\text{TaxableBaseHT}_r \times r)$$
  5. Compute invoice totals:
     $$\text{InvoiceSubtotalHT} = \sum_r \text{TaxableBaseHT}_r, \quad \text{InvoiceTotalVAT} = \sum_r \text{VATAmount}_r, \quad \text{InvoiceTotalTTC} = \text{InvoiceSubtotalHT} + \text{InvoiceTotalVAT}$$
- **Multi-currency**: Canonical ledger currency is `EUR`. If a document or line is in a foreign currency, store the ECB (`Banque Centrale Européenne`) exchange rate on the transaction date, convert `debit_minor` and `credit_minor` to `EUR`, and store the original foreign amount in `amount_currency_minor` (`Montantdevise`) and currency code (`Idevise`) for FEC compliance. Difference on payment is posted to account `656` (*Pertes de change sur créances et dettes commerciales* — PCG 2025) or `756` (*Gains de change*).

---

## 3. Double-entry ledger, PCG 2025 & FEC invariants (Art. L47 A-I LPF)
- **PCG 2025 Compliance (Règlement ANC n° 2022-06)**:
  - Enforce the modernized chart of accounts effective January 1, 2025.
  - **No Account 79 (*Transferts de charges*)**: Account `79` is abolished in PCG 2025; reimbursements and reclassifications use the dedicated `649`, `708`, or `758` accounts.
  - **Strict Exceptional Result (`67`/`77`)**: Only major and unusual events use `67`/`77`; fixed asset disposals now use current accounts (`657` / `757`).
- **Standard Journals**:
  - `AN` (*À-Nouveaux* / Opening balances)
  - `VE` (*Ventes* / Sales & Credit notes)
  - `AC` (*Achats* / Purchases & Supplier expenses)
  - `BQ` (*Banque* / Bank settlements, per bank account `BQ1`, `BQ2`...)
  - `OD` (*Opérations Diverses* / VAT declarations, wages, depreciation, adjustments)
  - `CA` (*Caisse* / Cash register if applicable)
- **Draft (`Brouillard`) vs Posted (`Validée`) Entries**:
  - In French accounting, an entry in `draft` or `validated` (pre-post) status is part of the *Brouillard* and can be reviewed or adjusted before definitive validation or period closure.
  - Once **Posted (`posted` / `validée définitivement`)**, the entry receives an immutable, gapless `entry_number` (`EcritureNum`), a definitive `validated_at` date (`ValidDate`), and a `SHA-256` hash (`entry_hash`).
  - **Posted entries can NEVER be edited or deleted** (enforced by PostgreSQL trigger). Any correction requires a linked reversal entry (`contre-passation` referencing `reversal_of_entry_id`) and a new replacement entry.
- **Auxiliary Accounts & Lettering (`Lettrage`)**:
  - Customer lines post to collective account `411000` with mandatory `auxiliary_account_code` (`CompAuxNum`, e.g. `411CLI0001`) and `auxiliary_account_label` (`CompAuxLib`).
  - Supplier lines post to collective account `401000` with mandatory `CompAuxNum` (e.g. `401FOU0001`) and `CompAuxLib`.
  - When a customer invoice (`411` debit in `VE`) is settled by a bank payment (`411` credit in `BQ`), the lines are linked by a **Lettering Code (`EcritureLet`, e.g. `AA`, `AB`)** and **Lettering Date (`DateLet`)**. A lettering group is valid only when $\sum \text{Debits} = \sum \text{Credits}$ for that `CompAuxNum`.
- **Irreversible Period Closure (`Clôture d'exercice`)**:
  - Pre-closing (`closing_review`) temporarily blocks non-accountant users from adding entries during review.
  - Permanent closure (`closed`) validates all remaining entries, checks that Total Debits = Total Credits across all journals, seals the period hash, and generates the opening balance sheet entries in the `AN` journal of period $N+1$.
  - **A `closed` period can NEVER be reopened.**

---

## 4. Sales Documents: Quotes, Invoices, Deposit Invoices & Credit Notes (Factur-X)
- **Document Types (Dolibarr Pattern)**:
  1. `quote` (*Devis / Proposition commerciale*): Non-accounting commercial proposal. Can be accepted and converted into a deposit invoice or standard invoice.
  2. `deposit_invoice` (*Facture d'acompte*): Mandatory under Art. 289-I-1-c CGI whenever an advance payment is received. Generates an invoice number, Factur-X XML/PDF, and records the advance on account `419100` (*Clients - Avances et acomptes reçus sur commandes*) + VAT exigible on the deposit.
  3. `standard_invoice` (*Facture de vente / de solde*): Can deduct one or more issued `deposit_invoice` records (clearing account `419100`).
  4. `credit_note` (*Facture d'avoir*): Mandatory workflow to cancel or reduce an issued invoice. Must explicitly store `original_invoice_id` and display *"Avoir sur la facture n° [NUMBER] du [DATE]"*.
- **Gapless Chronological Numbering (Art. 242 nonies A CGI)**:
  - Draft invoices have `number = NULL` (or a temporary `PROV-xxxx` reference, exactly like Dolibarr's `(PROVxxxx)` pattern, which is replaced at issuance).
  - At issuance, the system locks the workspace sequence row (`SELECT ... FOR UPDATE` on `document_sequences`) and assigns the next sequential number (e.g., `FA-2026-00001` for invoices, `AV-2026-00001` for credit notes).
  - **Never use non-transactional `SERIAL` sequences** that leave gaps on rollback.
- **Mandatory French Legal Mentions on Issued Invoices & Factur-X**:
  - Complete snapshots of **Issuer (`issuer_snapshot`)** and **Customer (`customer_snapshot`)** legal identities at the exact timestamp of issuance (SIREN/SIRET, RCS/RM, legal form, share capital, registered address, intra-EU VAT number).
  - Customer SIREN/SIRET (mandatory for French B2B).
  - Operation category (`BIENS`, `SERVICES`, or `MIXTE`) — mandatory for 2026 e-invoicing.
  - Date of delivery or completion of service (`delivery_or_service_date`).
  - Payment due date (`due_date`), late payment penalty rate (`late_penalty_rate`, e.g., $3 \times$ French legal interest rate or ECB rate + 10 percentage points), and mandatory **€40 recovery indemnity** (`recovery_indemnity_minor = 4000` cents) for all B2B invoices.
  - Early payment discount terms (`discount_terms`, e.g., *"Pas d'escompte pour paiement anticipé"*).
  - Statutory exemption clause if VAT is 0% (e.g., *"TVA non applicable, art. 293 B du CGI"* for Micro-entreprise / franchise en base; *"Autoliquidation de la TVA — Art. 283-2 du CGI"* for B2B EU services).
- **Factur-X (PDF/A-3 + EN 16931 CII XML)**:
  - Every issued invoice, deposit invoice, and credit note generates a PDF/A-3b file containing an embedded `factur-x.xml` conforming to EU standard **EN 16931** (Cross Industry Invoice).

---

## 5. French & EU VAT Rules (`TVA sur les débits` vs `TVA sur les encaissements`)
- **French VAT Rates (Mainland France & Corsica / DOM configurable)**:
  - Standard rate (*Taux normal*): `20.0%`
  - Intermediate rate (*Taux intermédiaire*): `10.0%`
  - Reduced rate (*Taux réduit*): `5.5%`
  - Super-reduced rate (*Taux particulier*): `2.1%`
  - Exempt / Franchise / Intra-EU Reverse Charge / Export: `0.0%` (requires explicit `exemption_code` and legal mention).
- **VAT Exigibility Mode (Crucial French Distinction)**:
  1. **VAT on Debits (`TVA sur les débits` — Default for Goods `707`, optional for Services *"Option pour le paiement de la TVA d'après les débits"*)**:
     - VAT becomes exigible immediately upon **invoice issuance date (`issue_date`)**.
     - Issuance posts directly to `44571x` (*TVA collectée*).
  2. **VAT on Cash Receipts (`TVA sur les encaissements` — Default for Services `706` and Deposit Invoices)**:
     - At invoice issuance, VAT is **not yet exigible**; it is posted to a pending VAT account `44574x` (*TVA collectée sur encaissements — en attente*).
     - When a payment is recorded or reconciled in `BQ` (or when a credit note is applied), the proportional VAT amount $\left(\text{PaymentTTC} \times \frac{\text{InvoiceVAT}_r}{\text{InvoiceTTC}}\right)$ is automatically transferred from `44574x` (Debit) to `44571x` (*TVA collectée exigible*, Credit).
  3. **Deductible Purchase VAT (`TVA déductible sur achats`)**:
     - Symmetrically tracks supplier VAT exigibility: `44566x` (*TVA déductible sur autres biens et services*), `44562x` (*TVA déductible sur immobilisations*), and `44564x` (*TVA déductible sur encaissements en attente de décaissement*).
- **Intra-EU VAT & Reverse Charge (`Autoliquidation`)**:
  - For B2B Intra-EU sales/purchases, verify the partner's VAT number via **VIES** (and store the VIES consultation timestamp/reference).
  - For Intra-EU acquisitions or reverse-charged services, automatically generate both the deductible (`445662`) and collected (`445200` — *TVA due intracommunautaire*) ledger lines (`autoliquidation`).

---

## 6. Statutory FEC Specification (Art. L47 A-I LPF)
Every workspace in `REEL_PCG2025` mode must store all data required to export the 18 mandatory FEC columns (22 for BA/BNC cash modes):

| # | FEC Column Name | Source in Haxatax Data Model | Format / Constraint |
|---|---|---|---|
| 1 | `JournalCode` | `journals.code` | Alphanumeric (e.g. `VE`, `AC`, `BQ`, `OD`, `AN`), no pipes/tabs |
| 2 | `JournalLib` | `journals.label` | Text (e.g. `Journal des Ventes`) |
| 3 | `EcritureNum` | `journal_entries.entry_number` | Gapless chronological sequence per journal/year |
| 4 | `EcritureDate` | `journal_entries.entry_date` | `YYYYMMDD` |
| 5 | `CompteNum` | `accounts.code` | PCG 2025 account number (min 6 digits, e.g. `411000`, `706000`) |
| 6 | `CompteLib` | `accounts.label` | PCG 2025 account label |
| 7 | `CompAuxNum` | `journal_entry_lines.auxiliary_account_code` | Blank if not auxiliary, or third-party code (`411CLI001`) |
| 8 | `CompAuxLib` | `journal_entry_lines.auxiliary_account_label` | Blank if not auxiliary, or third-party legal name |
| 9 | `PieceRef` | `journal_entries.piece_ref` | Mandatory voucher reference (e.g. `FA-2026-00001`) |
| 10 | `PieceDate` | `journal_entries.piece_date` | `YYYYMMDD` |
| 11 | `EcritureLib` | `journal_entry_lines.description` | Line description |
| 12 | `Debit` | `journal_entry_lines.debit_minor` | Decimal with comma separator (`1200,00`), `>= 0` |
| 13 | `Credit` | `journal_entry_lines.credit_minor` | Decimal with comma separator (`1200,00`), `>= 0` |
| 14 | `EcritureLet` | `journal_entry_lines.lettering_code` | Lettering code (`AA`, `AB`...) or blank |
| 15 | `DateLet` | `journal_entry_lines.lettered_at` | `YYYYMMDD` or blank (mandatory if `EcritureLet` is set) |
| 16 | `ValidDate` | `journal_entries.validated_at` | `YYYYMMDD` (definitive posting date) |
| 17 | `Montantdevise` | `journal_entry_lines.amount_currency_minor` | Blank if EUR, or foreign amount with comma separator |
| 18 | `Idevise` | `journal_entry_lines.currency_code` | Blank if EUR, or ISO 4217 code (`USD`, `GBP`...) |

---

## 7. Minimum invariants to test in CI
1. **EN 16931 VAT Rounding**: Rate-level VAT calculation matches official Factur-X test cases and never diverges from `ROUND_HALF_UP(TaxableBaseHT_r * rate)`.
2. **Gapless Numbering under Contention & Rollback**: Concurrent issuance and forced transaction rollbacks produce zero gaps in `invoices.number` and `journal_entries.entry_number`.
3. **Database-Enforced Immutability**: Attempting `UPDATE` or `DELETE` on an issued invoice/credit note or a `posted` journal entry fails at both service and PostgreSQL trigger levels.
4. **Hash Chain Integrity**: Modifying any historical column in a test bypass is immediately detected by the `SHA-256` chain verifier.
5. **Double-Entry & Period Balance**: Every posted entry has $\sum \text{Debit} = \sum \text{Credit} > 0$.
6. **Lettering Equilibrium**: A lettering code `EcritureLet` cannot be committed unless $\sum \text{Debit} = \sum \text{Credit}$ on the same auxiliary account `CompAuxNum`.
7. **VAT Exigibility (`Encaissements` vs `Débits`)**: Service invoices in `ENCAISSEMENTS` mode only move VAT from `44574` to `44571` proportionally upon payment/reconciliation.
8. **Irreversible Period Close**: Once `accounting_periods.status = 'closed'`, posting into that period or reopening it is rejected.
9. **FEC Compliance Check**: Generated FEC file passes all 18-column formatting, sorting, and equilibrium checks.
10. **Cross-Tenant Isolation**: Every query and mutation is strictly scoped by verified `workspace_id`.
