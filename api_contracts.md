# API Contracts — REST v1 (French & EU Compliant)

Base path: `/api/v1`. JSON requests and responses. All protected endpoints require an authenticated session, verified workspace membership, and role authorization. Exact contracts must be reflected in OpenAPI 3.1 schemas and integration tests.

## Common conventions
- **Identifiers**: UUID.
- **Dates**: ISO `YYYY-MM-DD`; **Timestamps**: ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- **Currency**: ISO 4217 code (`EUR` default).
- **Monetary values**: Integer minor units (`BIGINT` cents, e.g. `12500` = `125,00 €`).
- **Idempotency**: State-changing financial requests (`issue`, `post`, `reverse`, `payments`, `lettering`, `close`, `bank-imports/confirm`) require an `Idempotency-Key` header.
- **Errors**: `{ "error": { "code": "STABLE_MACHINE_CODE", "message": "Safe localized message", "requestId": "uuid", "details": [] } }`.
- **Untrusted Client Rule**: Never accept client-calculated invoice totals, VAT amounts, document numbers, `workspace_id` authority, or `entry_hash` values.

---

## 1. Workspace & Legal Configuration
- `GET /workspaces/current` — returns workspace profile including French legal identity (`siren`, `siret`, `rcsCity`, `rcsNumber`, `legalForm`, `shareCapitalMinor`, `vatNumber`, `fiscalRegime`, `accountingMode`, `vatRegime`, `vatExigibility`).
- `PATCH /workspaces/current` — update permitted company settings (validates SIREN/SIRET via Luhn check and enforces mandatory legal mentions).
- `GET /workspaces/current/sequences` — inspect current numbering prefixes (`FA-{YYYY}-`, `AV-{YYYY}-`, `AC-{YYYY}-`, `DEV-{YYYY}-`).
- `PATCH /workspaces/current/sequences` — configure numbering prefix/padding for future unallocated sequences only.

---

## 2. Contacts (`Tiers` — Customers & Suppliers) & Official Lookups
- `GET /contacts/lookup-siren?q={sirenOrSiretOrName}` — queries official French *API Recherche d'entreprises / INSEE Sirene* and returns legal name, SIRET, NAF code, legal form, registered address, and computed French intra-EU VAT number (`FR` + key + SIREN).
- `POST /contacts/validate-vies` — validates an EU VAT number against the European Commission **VIES** API and returns validation status + consultation reference ID.
- `GET /contacts?kind=customer&taxZone=DOMESTIC_FR&query=...&cursor=...`
- `POST /contacts` — creates contact and auto-generates `customerAuxiliaryCode` (`411...`) / `supplierAuxiliaryCode` (`401...`).
- `GET /contacts/{contactId}`
- `PATCH /contacts/{contactId}`
- `POST /contacts/{contactId}/archive` — soft-archives contact; blocked from hard deletion if referenced by any document or ledger line.

---

## 3. Sales: Quotes, Deposit Invoices, Standard Invoices & Credit Notes (Factur-X)
- `GET /invoices?documentType=standard_invoice&status=issued&from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /invoices` — create a draft sales document (`quote`, `deposit_invoice`, `standard_invoice`, or `credit_note`); server computes line net HT, EN 16931 rate-level `taxBreakdowns`, deposit deductions, and totals.
- `GET /invoices/{invoiceId}` — returns full document including `lines`, `taxBreakdowns`, `depositApplications`, `issuerSnapshot`, `customerSnapshot`, and `einvoiceStatus`.
- `PATCH /invoices/{invoiceId}` — allowed **only** when `status = 'draft'` or `'ready_for_review'`. Returns `409 INVOICE_IMMUTABLE` if already issued.
- `POST /invoices/{invoiceId}/preview` — renders a watermarked `BROUILLON / PROVISOIRE` PDF preview from persisted draft data.
- `POST /invoices/{invoiceId}/issue` — **Atomic, idempotent issuance**:
  - Verifies mandatory French legal fields (issuer & customer SIREN/SIRET for B2B, `operationCategory`, `deliveryOrServiceDate`, late penalty rate, €40 B2B recovery indemnity, VAT exemption mention if 0% VAT).
  - Locks `document_sequences` (`FOR UPDATE`), allocates gapless number (`FA-2026-00001`), snapshots issuer & customer, computes `documentHash`, generates **Factur-X (PDF/A-3 + EN 16931 CII XML)**, and automatically posts/prepares the `VE` journal entry.
- `POST /invoices/{invoiceId}/credit-notes` — creates a linked Credit Note (`facture d'avoir`, `documentType = 'credit_note'`, `originalInvoiceId = invoiceId`) for full or partial cancellation/discount of an issued invoice.
- `POST /invoices/{invoiceId}/deposit-invoices` — creates a Deposit Invoice (`facture d'acompte`) from an accepted quote or order.
- `POST /invoices/{invoiceId}/payments` — records an inbound customer payment, allocates it to the invoice, creates the `BQ` journal entry, applies automatic `lettrage` on `411xxx`, and if `vatExigibility = 'ENCAISSEMENTS'`, transfers proportional VAT from `44574` to `44571`.
- `GET /invoices/{invoiceId}/pdf` — downloads the authoritative **Factur-X PDF/A-3** file (with embedded `factur-x.xml`).
- `GET /invoices/{invoiceId}/facturx-xml` — downloads the standalone validated **EN 16931 CII XML**.
- `POST /invoices/{invoiceId}/einvoice-submit` — submits the Factur-X document to the configured PDP / PPF gateway and tracks lifecycle webhooks.

### Example `POST /invoices` payload (French B2B Factur-X Compliant)
```json
{
  "documentType": "standard_invoice",
  "contactId": "c7b3d8e0-5e0b-4b0f-8b3a-3b9f4b3d3b3d",
  "operationCategory": "services",
  "issueDate": "2026-10-18",
  "deliveryOrServiceDate": "2026-10-18",
  "dueDate": "2026-11-17",
  "purchaseOrderRef": "BC-2026-991",
  "currency": "EUR",
  "applyDepositInvoiceIds": [],
  "lines": [
    {
      "lineNature": "services",
      "description": "Audit d'architecture et conformité Factur-X",
      "quantity": "2.50",
      "unitCode": "DAY",
      "unitPriceHtMinor": 80000,
      "discountPercent": "0.000",
      "taxRuleCode": "FR_TVA_20",
      "accountingAccountCode": "706000"
    }
  ]
}
```
*Server authoritative response includes `taxBreakdowns`: `[{ "vatRate": "20.000", "vatCategoryCode": "S", "taxableBaseHtMinor": 200000, "vatAmountMinor": 40000 }]`, `subtotalHtMinor`: `200000`, `vatTotalMinor`: `40000`, `totalTtcMinor`: `240000`, `recoveryIndemnityMinor`: `4000`.*

---

## 4. Purchases, Factur-X Inbox & Multi-Rate Expenses
- `POST /documents/upload-intent` — issues a short-lived signed upload URL after MIME/size validation.
- `POST /documents/{documentId}/process` — computes `SHA-256` PAF fingerprint, extracts embedded Factur-X XML if present, or triggers EU-hosted OCR suggestion pipeline.
- `GET /documents?status=needs_review`
- `GET /documents/{documentId}`
- `POST /documents/{documentId}/review` — human confirmation/correction of extracted supplier, invoice ref (`PieceRef`), date (`PieceDate`), and multi-rate VAT lines.
- `POST /expenses` — creates a multi-line expense (`expenseLines` with PCG `6xx` account, VAT rate, and `deductibilityRatio`), and generates the `AC` journal entry.

---

## 5. Banking & $N \leftrightarrow M$ Reconciliation
- `GET /bank-accounts` & `POST /bank-accounts` — links bank account to PCG account `512xxx` and journal `BQx`.
- `POST /bank-imports` $\rightarrow$ `POST /bank-imports/{importId}/preview` $\rightarrow$ `POST /bank-imports/{importId}/confirm` (idempotent via file SHA-256 and line fingerprints).
- `GET /bank-transactions?status=unmatched`
- `POST /bank-transactions/{transactionId}/matches` — supports matching 1 bank transaction to $N$ invoices/expenses (or partial installment matching) with optional `feeOrDiscrepancyMinor` posted to `627xxx` / `658` / `758`, triggering `BQ` posting, `lettrage`, and cash-basis VAT realization.
- `DELETE /reconciliation-matches/{matchId}` — audited unmatch (reverses `BQ` match and unletters `411`/`401` if period is still open).

---

## 6. Accounting (PCG 2025, Ventilation, Lettrage & Period Close)
- `GET /accounting/accounts?chartVersion=PCG_2025_ANC_2022_06`
- `POST /accounting/accounts` — add custom sub-account or auxiliary account.
- `GET /accounting/journals` — returns `AN`, `VE`, `AC`, `BQ`, `OD`, `CA`.
- `GET /accounting/entries?journalCode=VE&status=posted&periodId=...`
- `POST /accounting/entries` — create draft (`brouillard`) entry with `pieceRef` and `pieceDate`.
- `POST /accounting/entries/{entryId}/post` — **Definitive validation (`Validation définitive`)**: verifies $\sum \text{Debit} = \sum \text{Credit}$, auxiliary accounts on `411`/`401`, and open period; allocates gapless `entryNumber` (`EcritureNum`), sets `validatedAt` (`ValidDate`), and chains `entryHash`.
- `POST /accounting/entries/{entryId}/reverse` — creates a linked `contre-passation` entry (`reversalOfEntryId`); never mutates original entry.
- `POST /accounting/lettering` — applies a balanced lettering code (`EcritureLet`, `DateLet`) across selected `journal_entry_lines` sharing the same `auxiliaryAccountCode` (`CompAuxNum`) where $\sum \text{Debit} = \sum \text{Credit}$.
- `DELETE /accounting/lettering/{letteringCode}` — removes lettering if period is open (audited).
- `GET /accounting/periods`
- `POST /accounting/periods/{periodId}/pre-close` — transitions period to `closing_review` and runs pre-close anomaly checks.
- `POST /accounting/periods/{periodId}/close` — **Permanent, irreversible fiscal year closure (`Clôture définitive`)**: seals period hash and automatically generates opening carry-forward entries in the `AN` journal of period $N+1$.

---

## 7. VAT Preparation (`CA3`/`CA12`), Micro Books & Statutory FEC Exports
- `GET /tax/vat-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` — computes collected VAT (separating `DEBITS` vs realized `ENCAISSEMENTS` and intra-EU reverse charge) and deductible VAT (goods/services vs fixed assets), with drill-down to source invoices/payments.
- `GET /reports/dashboard?period=...`
- `GET /reports/micro/livre-recettes?year=2026` — statutory chronological cash-receipts book for Micro-entrepreneurs.
- `GET /reports/micro/registre-achats?year=2026` — statutory purchases register for Micro-entrepreneurs.
- `POST /exports/fec/validate` — runs full 18/22-column DGFiP *Test Compta Demat* validation on a fiscal period and returns any structural or accounting anomalies.
- `POST /exports/fec` — generates the official `{SIREN}FEC{YYYYMMDD}.txt` export job and records an `audit_event`.
- `GET /exports/{exportId}/download` — short-lived authenticated download URL.

---

## 8. GDPR & Security Endpoints
- `GET /privacy/my-data-export` — GDPR Art. 20 portability export for the authenticated user.
- `POST /privacy/erasure-request` — GDPR Art. 17 erasure request (deletes non-accounting PII while preserving mandatory 10-year statutory accounting snapshots under Art. 17.3.b).
- `GET /audit/verify-integrity` — verifies the cryptographic `SHA-256` hash chains across `invoices`, `journal_entries`, and `audit_events`.
