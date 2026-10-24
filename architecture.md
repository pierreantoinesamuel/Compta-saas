# System Architecture

## High-level topology (100% Custom Stack — EU Sovereign Hosting)

```text
Browser (React + TypeScript — RGAA 4.1 / EAA Accessible SPA)
        |
        | HTTPS (TLS 1.3) / JSON, authenticated session + MFA verification
        v
API / Application Layer (TypeScript Backend — Fastify / NestJS)
  - authentication, MFA & workspace RBAC authorization
  - request schema validation (Zod / OpenAPI)
  - use cases / atomic transaction orchestration & idempotency
        |
        +--> Domain Layer (Inspired by Dolibarr ERP/CRM Domain Modules)
        |      - third-parties (Tiers: SIREN/SIRET, VIES, Auxiliary Accounts)
        |      - sales lifecycle (Quotes, Deposits, Invoices, Credit Notes)
        |      - EN 16931 / DGFiP VAT calculation & exigibility (Debits vs Cash)
        |      - Factur-X (PDF/A-3 + CII XML) & e-invoicing lifecycle
        |      - Automated Accounting Binding Engine (Ventilation comptable)
        |      - PCG 2025 Ledger, Lettering (Lettrage), Period Close & FEC
        |      - Cryptographic Hash Chaining (BlockedLog / PAF)
        |
        +--> PostgreSQL (EU Region — e.g. Paris eu-west-3)
        |      - tenant-scoped records + Row-Level Security (RLS)
        |      - gapless sequence table locks (SELECT ... FOR UPDATE)
        |      - BEFORE UPDATE / DELETE immutability triggers
        |      - append-only hash-chained audit events
        |
        +--> Private EU Object Storage (S3-compatible, encrypted at rest)
        |      - 10-year archival of Factur-X PDFs, purchase vouchers, FEC exports
        |
        +--> Background Worker & Outbox Processor
        |      - Factur-X PDF/A-3 + XML generation & XSD validation
        |      - EU-hosted OCR / Factur-X XML extraction for purchase inbox
        |      - PDP / PPF e-invoicing transmission & webhook synchronization
        |
        +--> External Official French & EU Integrations
               - API Annuaire des Entreprises / INSEE Sirene (SIREN/SIRET lookup)
               - EU VIES API (Intra-community VAT validation)
               - PDP / Chorus Pro / PPF (2026-2027 French e-invoicing reform)
```

## Architectural rules
1. **100% Custom Implementation with Dolibarr Domain Fidelity**: We build a modern TypeScript/React/PostgreSQL codebase (no PHP Dolibarr server dependency), while faithfully adopting Dolibarr's battle-tested French business workflows (`Tiers`, `(PROV)` draft numbering, deposit & credit-note linkages, `Ventilation comptable`, `Lettrage`, `BlockedLog` immutability, and `FEC` export).
2. **UI contains zero accounting policy**: React components call typed API endpoints; all tax rounding (EN 16931), VAT exigibility, and ledger balancing happen on the server.
3. **Strict Layering**: HTTP controllers validate input shapes and delegate to application use cases, which coordinate domain services inside database transactions.
4. **Verified Tenant Context**: Every database query and background job requires a verified `workspace_id`. PostgreSQL Row-Level Security (RLS) acts as defence in depth alongside mandatory application checks.
5. **Dual Immutability Enforcement**: Issued sales documents, posted ledger entries, and audit logs are protected against mutation/deletion by both domain guards and PostgreSQL `BEFORE UPDATE OR DELETE` triggers, plus `SHA-256` hash chaining.
6. **Gapless Transactional Numbering**: Sequential document numbers (`FA-2026-00001`, `AV-2026-00001`, FEC `EcritureNum`) are allocated exclusively inside the database transaction via row-level locking (`SELECT ... FOR UPDATE` on `document_sequences`) so rolled-back transactions never create numbering gaps.
7. **Automated Accounting Binding (`Moteur de Ventilation`)**: Issuing an invoice/credit note, approving an expense, or recording/reconciling a payment automatically creates (or queues in `brouillard` per workspace setting) the balanced PCG 2025 journal entry (`VE`, `AC`, `BQ`, `OD`) within the same atomic unit of work.
8. **AI/OCR is an untrusted suggestion producer**: Incoming Factur-X purchase files are parsed deterministically from XML; non-Factur-X receipts processed by EU-hosted OCR require explicit human confirmation before creating an expense or `AC` entry.
9. **Authoritative Archival Rendering**: Factur-X PDF/A-3 documents, *Livres des recettes*, and FEC files are rendered strictly from persisted, committed database snapshots.

## Monolith repository structure

```text
src/
  app/                   # router, providers, accessible application shell (RGAA 4.1)
  components/            # shared accessible UI primitives, money/date formatters (fr-FR)
  features/
    dashboard/           # CA facturé vs encaissé, Micro thresholds, VAT summary
    contacts/            # Tiers (customers/suppliers, SIREN/VIES lookup, auxiliary codes)
    sales/               # Quotes, Deposit Invoices, Standard Invoices, Credit Notes, Factur-X
    purchases/           # Document inbox, Factur-X parser/OCR review, multi-rate expenses
    banking/             # Bank accounts (512xxx), CSV/DSP2 import, N-to-M reconciliation
    accounting/          # PCG 2025 chart, journals (AN/VE/AC/BQ/OD), ventilation, lettrage, periods
    tax/                 # VAT declaration preparation (CA3/CA12, debits vs cash receipts)
    reports/             # Livre des recettes (Micro), Grand Livre, Balance, FEC export & checker
    settings/            # Legal identity (SIREN/RCS/TVA), numbering series, team, security/MFA, GDPR
  api/                   # typed API client, idempotency-key injection, error mapping
server/
  routes/                # HTTP adapters & OpenAPI schemas
  application/           # transactional use cases & outbox orchestration
  domain/
    workspace/           # French legal identity & regime rules (MICRO vs REEL_PCG2025)
    contacts/            # SIREN/SIRET Luhn validation, VIES check, CompAuxNum generation
    invoicing/           # Quotes, Deposits, Invoices, Credit Notes, gapless sequence, hash chain
    einvoicing/          # Factur-X (PDF/A-3 + EN 16931 CII XML) generator & parser, PDP lifecycle
    tax/                 # EN 16931 rate-level VAT engine, debits vs cash exigibility, reverse charge
    purchases/           # Expense validation, deductibility ratios, PAF document hashing
    banking/             # Import fingerprinting, N-to-M matching, fee write-off rules
    accounting/          # PCG 2025 engine, automatic ventilation, lettering (lettrage), period close
    fec/                 # 18/22-column FEC generator & DGFiP Test Compta Demat validator
    audit/               # BlockedLog cryptographic hash-chained audit trail
  infrastructure/
    db/                  # PostgreSQL pool, transaction runner, RLS context setter
    storage/             # EU S3 private archival storage (10-year retention policy)
    integrations/        # INSEE/Annuaire Entreprises API, EU VIES SOAP/REST, PDP/PPF client, email
    jobs/                # transactional outbox & background worker
  security/              # session, MFA, RBAC permission matrix, GDPR redaction
  tests/                 # unit, DB integration, concurrency, Factur-X & FEC compliance suites
db/
  migrations/            # versioned SQL migrations, triggers, RLS policies
  seeds/
    pcg2025/             # official ANC 2022-06 / PCG 2025 chart of accounts & French tax rules
    demo/                # clearly marked fictional French company & micro-entreprise demo data
```

## Authentication, MFA, and tenant isolation
- Every API request derives `user_id` from a verified server session/token.
- Consequential operations (invoice issuance, bank IBAN change, period close, user role elevation, FEC export) support step-up MFA enforcement.
- Workspace membership and granular role (`owner`, `admin`, `finance`, `accountant`, `read_only`) are verified on every request before setting `SET LOCAL app.current_workspace_id = '...'` inside the PostgreSQL transaction.

## Transaction boundaries
1. **Issuing a Sales Document (`standard_invoice`, `deposit_invoice`, `credit_note`)**:
   - Inside one `READ COMMITTED` / row-locked transaction: verify mandatory French B2B/B2C fields $\rightarrow$ lock `document_sequences` row (`FOR UPDATE`) and allocate next number $\rightarrow$ snapshot `issuer_snapshot` and `customer_snapshot` $\rightarrow$ persist EN 16931 `invoice_tax_breakdowns` $\rightarrow$ compute `document_hash` chained to `previous_document_hash` $\rightarrow$ generate Factur-X XML $\rightarrow$ create corresponding `VE` journal entry (or `Livre des recettes` link) $\rightarrow$ append hash-chained `audit_event`.
2. **Recording Payment / Confirming Bank Reconciliation**:
   - Inside one transaction: insert `payment` and `payment_allocations` (verifying remaining balance) $\rightarrow$ update invoice payment status $\rightarrow$ create `BQ` journal entry $\rightarrow$ apply automatic `lettrage` (`EcritureLet`, `DateLet`) on account `411xxx`/`401xxx` when $\sum \text{Debit} = \sum \text{Credit}$ $\rightarrow$ if `vat_exigibility = 'ENCAISSEMENTS'`, post the proportional VAT transfer entry (`44574` $\rightarrow$ `44571`) $\rightarrow$ append `audit_event`.
3. **Posting a Journal Entry / Closing a Period**:
   - Inside one transaction: validate $\sum \text{Debit} = \sum \text{Credit}$, open period, and PCG 2025 account validity $\rightarrow$ lock journal sequence and assign `EcritureNum` and `ValidDate` $\rightarrow$ compute `entry_hash` $\rightarrow$ append `audit_event`.
