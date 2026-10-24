# Technical Stack & Compliance Tooling

## Decision status
Approved baseline for a **100% custom React + TypeScript + PostgreSQL web application**, functionally guided by [Dolibarr ERP/CRM](https://wiki.dolibarr.org/index.php/Home) ([GitHub](https://github.com/Dolibarr/dolibarr)) and engineered for French (DGFiP, PCG 2025, Factur-X 2026) and EU (EN 16931, GDPR, VIES, EAA/RGAA 4.1) compliance.

## Frontend (Accessible French/EU SPA)
- **Framework**: React 18/19 + TypeScript + Vite (or existing repo setup if already initialized).
- **Routing & State**: TanStack Router / React Router + TanStack Query for server state and optimistic-free authoritative mutations.
- **Forms & Validation**: React Hook Form + Zod (sharing validation schemas and Luhn SIREN/SIRET validators with the backend).
- **Accessibility (EAA / RGAA 4.1 / WCAG 2.1 AA)**: Radix UI / React Aria accessible primitives, strict keyboard navigation, visible focus rings, ARIA live regions for status updates, and $\ge 4.5:1$ contrast tokens.
- **Localization & Formatting**:
  - `fr-FR` locale default, `Europe/Paris` timezone handling, ISO `YYYY-MM-DD` wire dates rendered as `DD/MM/YYYY`.
  - Currency formatted via `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })` from integer minor units.

## Backend (Modular TypeScript Monolith)
- **Runtime & Framework**: Node.js LTS + TypeScript (`strict: true`) with Fastify or NestJS, structured into explicit `routes`, `application` (use cases), `domain`, and `infrastructure` layers.
- **API Documentation**: OpenAPI 3.1 auto-generated from Zod/TypeBox route schemas.
- **Decimal & Financial Arithmetic**:
  - `decimal.js` configured explicitly with precision $\ge 28$ and `ROUND_HALF_UP` for unit price, quantity, discount, pro-rata VAT exigibility, and EN 16931 tax-rate breakdown calculations.
  - Authoritative monetary amounts persisted and transmitted as integer minor units (`BIGINT` cents in PostgreSQL, integer cents or exact string decimals in JSON).
  - **Hard ban** on native JavaScript `number` floating-point arithmetic (`+`, `-`, `*`, `/`) for money or tax rates.
- **Factur-X (PDF/A-3 + EN 16931 XML) Engine**:
  - Deterministic CII (Cross Industry Invoice) XML builder & parser compliant with **EN 16931** (`urn:cen.eu:en16931:2017`) and **Factur-X 1.0.07** (Minimum, Basic WL, Basic, and EN 16931 / Comfort profiles).
  - PDF/A-3b generator embedding `factur-x.xml` in the PDF `/AF` (Associated Files) array with mandatory PDF/A XMP extension schema metadata.
- **FEC (Art. L47 A-I LPF) Generator & Validator**:
  - Streaming generator producing `{SIREN}FEC{YYYYMMDD}.txt` (UTF-8 or ISO-8859-15, pipe `|` or tab `\t` delimiter, `YYYYMMDD` dates, comma `,` decimal separator, 18 or 22 columns).
  - Built-in pre-export validator checking all DGFiP *Test Compta Demat* rules (gapless `EcritureNum`, mandatory `PieceRef`/`PieceDate`/`ValidDate`, balanced `EcritureLet`, zero journal anomaly).

## Database, Storage & EU Sovereignty (GDPR)
- **Primary Database**: PostgreSQL 16+ hosted exclusively in the European Union (e.g., AWS `eu-west-3` Paris, Scaleway Paris, or Clever Cloud France).
- **Migrations**: Version-controlled SQL migrations enforcing foreign keys, partial unique indexes, `CHECK` constraints, Row-Level Security (RLS), and `BEFORE UPDATE OR DELETE` immutability triggers.
- **Object Storage**: Private S3-compatible bucket in the EU with Object Lock (WORM — *Write Once Read Many* capability for 10-year legal archiving under Art. L123-22 Code de commerce), server-side encryption (AES-256), and short-lived scoped signed URLs.
- **Background Jobs**: PostgreSQL-backed transactional outbox (`pg-boss` or custom outbox worker) so job enqueueing is atomic with financial state changes without requiring an external Redis cluster in MVP.

## External French & EU Regulatory Integrations
- **Company Lookup (France)**: Official *API Recherche d'entreprises* (`https://recherche-entreprises.api.gouv.fr`) / INSEE Sirene API to auto-complete SIREN, SIRET, NAF/APE, legal form, and registered address, and compute the French intra-EU VAT number (`FR` + 2-char key + `SIREN`).
- **Intra-EU VAT Validation**: European Commission **VIES** API to verify customer/supplier EU VAT numbers and log the consultation proof ID for intra-community VAT exemption / reverse charge (`autoliquidation`).
- **E-Invoicing (2026–2027 Reform)**: Pluggable adapter interface (`EinvoicingGateway`) supporting **PPF (Portail Public de Facturation / Chorus Pro)** and certified **PDP (Plateformes de Dématérialisation Partenaires)** for Factur-X submission, lifecycle status webhooks (`DÉPOSÉE`, `REJETÉE`, `REFUSÉE`, `ENCAISSÉE`), and e-reporting.
- **OCR / Document Extraction**: EU-hosted OCR/extraction service under a signed GDPR Data Processing Agreement (DPA) with Zero Data Retention (ZDR) — plus native deterministic extraction whenever an uploaded supplier PDF already contains an embedded Factur-X XML stream.

## Domain boundaries
- `identity`: users, MFA factors, sessions, workspace memberships, RBAC roles.
- `workspace`: French legal identity (SIREN/SIRET, RCS/RM, capital, NAF), fiscal regime (`MICRO` vs `REEL_PCG2025`), VAT regime & exigibility (`DEBITS` vs `ENCAISSEMENTS`), gapless numbering sequences.
- `contacts`: unified third-parties (`Tiers`: customers, suppliers, B2B/B2C, SIREN, VIES VAT, `CompAuxNum`).
- `sales`: quotes (`devis`), deposit invoices (`factures d'acompte`), standard invoices (`factures`), credit notes (`avoirs`), EN 16931 tax breakdowns, payments, Factur-X lifecycle.
- `purchases`: purchase documents, PAF SHA-256 archival, Factur-X/OCR review, multi-rate expenses (`expense_lines`).
- `banking`: bank accounts (linked to `512xxx`), statement imports, transaction fingerprints, $N \leftrightarrow M$ reconciliation matches.
- `accounting`: PCG 2025 chart of accounts, journals (`AN`, `VE`, `AC`, `BQ`, `OD`), automated ventilation engine, draft vs posted entries, auxiliary lettering (`lettrage`), irreversible period closure.
- `tax_and_reports`: VAT preparation (`CA3`/`CA12`), Micro *Livre des recettes* & *Registre des achats*, general ledger, trial balance, 18/22-column FEC export.
- `audit`: cryptographic hash-chained `audit_events` (`BlockedLog` pattern).

## Testing & Verification Suite
- **Unit & Property Tests (Vitest + fast-check)**: EN 16931 VAT rounding invariants, pro-rata VAT on cash receipts (`encaissements`), Luhn SIREN/SIRET validation, double-entry balance, and hash-chain verification.
- **Database Integration Tests**: Real PostgreSQL test instance verifying RLS tenant isolation, `SELECT ... FOR UPDATE` gapless numbering under parallel load and rollbacks, and `BEFORE UPDATE OR DELETE` immutability triggers.
- **Compliance Validation Tests**: Factur-X CII XML schema validation (EN 16931 XSD / Schematron) and 18-column FEC structural & accounting equilibrium validation.
- **End-to-End & Accessibility Tests (Playwright + axe-core)**: Complete user journeys across mobile (320 px) and desktop, enforcing zero WCAG 2.1 AA / RGAA violations.
