# Haxatax (LedgerFlow) — French & EU Compliant Accounting SaaS

**Status:** Product and engineering blueprint aligned with French (DGFiP, Code de commerce, CGI, ANC PCG 2025) and European Union (EN 16931 / Factur-X, GDPR, VIES, EAA / RGAA 4.1) regulatory requirements.  
**Working name:** Haxatax / LedgerFlow.  
**Target market:** French freelancers (*Micro-entrepreneurs*), small businesses (*TPE/PME*: SASU, SAS, EURL, SARL, EI), company directors, and their accountants (*Experts-comptables*).  
**Language/currency defaults:** French (`fr-FR`), `EUR` (with multi-currency support on lines for FEC `Montantdevise`/`Idevise`).  
**Product direction:** 100% custom modern web application (React + TypeScript frontend, modular TypeScript backend, PostgreSQL database), combining a calm, responsive UX with the proven French accounting and ERP domain workflows of [Dolibarr ERP/CRM](https://wiki.dolibarr.org/index.php/Home) ([GitHub](https://github.com/Dolibarr/dolibarr)).

## Start here
1. Read `project_brief.md` and `PRD.md`.
2. Read `accounting_rules.md` before implementing any invoicing, VAT, or accounting logic.
3. Review `architecture.md`, `tech_stack.md`, `data_model.md`, and `db_architecture.md`.
4. Implement only the next approved milestone in `implementation_plan.md`.
5. Follow `agent_instructions.md` and the skills under `agent_skills/`.
6. Use `app_workflow_system.md` to keep user flows, state machines, and regulatory lifecycles consistent.
7. Keep `api_contracts.md` aligned with the actual backend implementation.

## Architectural & Domain Reference Decision
This application is a **100% custom greenfield SaaS** built with **React, TypeScript, and PostgreSQL** (we do not deploy or wrap a PHP Dolibarr backend).  
However, we use **Dolibarr ERP/CRM** (`https://wiki.dolibarr.org/index.php/Home` and `https://github.com/Dolibarr/dolibarr`) as our **functional and domain reference guide** for French business management:
- **Third-parties (`Tiers`)**: Unified customer/prospect/supplier directory with SIREN/SIRET, APE/NAF, RCS/RM, intra-EU VAT (`TVA intracommunautaire`), and auxiliary accounting codes (`411xxx` / `401xxx`).
- **Sales Invoicing (`Facturation`)**: Standard invoices (`facture standard`), deposit invoices (`facture d'acompte`), credit notes (`facture d'avoir`), gapless chronological numbering, and native **Factur-X (PDF/A-3 + EN 16931 XML)** generation.
- **Progressive Regime Support (Step-by-Step)**:
  1. **Step 1 — Micro-Entreprise**: Cash-basis ledger (*Livre des recettes* & *Registre des achats*), VAT exemption (*Franchise en base de TVA — Art. 293 B du CGI*) or VAT threshold tracking, simplified URSSAF turnover declarations.
  2. **Step 2 — Sociétés & Entreprises au Réel (SASU, SAS, EURL, SARL, EI)**: Full double-entry accounting compliant with **PCG 2025 (Règlement ANC n° 2022-06)**, accounting binding/ventilation (`liaison comptable`), auxiliary accounts, third-party lettering (`lettrage`), VAT on debits (`débits`) vs cash (`encaissements`), immutable cryptographic hash-chaining (`blockedlog` pattern), and statutory **18/22-column FEC export (Art. L47 A-I LPF)**.

## Regulatory & Compliance Pillars (France & EU)
1. **French E-Invoicing Reform (2026–2027) & EU EN 16931**: Native Factur-X (PDF/A-3 + CII XML) generation, mandatory B2B fields (client SIREN, operation category: goods/services/mixed, delivery address, debit VAT option), e-invoicing lifecycle statuses (`deposited`, `rejected`, `refused`, `accepted`, `cashed`), and PDP/PPF integration readiness.
2. **French Mandatory Invoice Disclosures (Art. 242 nonies A CGI & Art. L441-9 Code de commerce)**: Full issuer/customer legal snapshots, late payment interest rate, mandatory €40 B2B recovery indemnity (`indemnité forfaitaire pour frais de recouvrement de 40 €`), discount conditions, and tax exemption legal mentions.
3. **PCG 2025 & Statutory FEC (Art. L47 A-I LPF)**: Updated 2025 French Chart of Accounts (abolition of account 79 charge transfers, strict exceptional result definition), strict separation between draft (`brouillard`) and validated (`validée`) entries, irrevocable period closure with carry-forward entries (`Journal des À-Nouveaux - AN`), and gapless FEC numbering.
4. **French & EU VAT Rules**: Tax calculation and rounding per rate on total net base per rate (EN 16931), distinction between VAT exigibility on debits (`TVA sur les débits`) and on cash receipts (`TVA sur les encaissements`), EU VIES VAT validation, and intra-EU reverse charge (`Autoliquidation`).
5. **Reliable Audit Trail (`Piste d'Audit Fiable - PAF`), NF Z42-013 & Cryptographic Immutability**: SHA-256 hash chaining across issued invoices, posted ledger entries, and audit events, plus 10-year commercial retention (Art. L123-22 Code de commerce).
6. **EU GDPR & European Accessibility Act (EAA / RGAA 4.1)**: EU-only data residency, strict separation between erasable personal data and mandatory 10-year accounting records (Art. 17.3.b GDPR), zero-training guarantees on OCR/AI providers, and WCAG 2.1 AA / RGAA 4.1 accessibility compliance.

## Documents
- `PRD.md` — functional, regulatory, and non-functional requirements
- `project_brief.md` — product vision, progressive regime roadmap, and scope
- `tech_stack.md` — TypeScript/React/PostgreSQL stack and compliance tooling
- `architecture.md` — system boundaries, posting engine, and deployment architecture
- `app_workflow_system.md` — page map, user flows, and French/EU state machines
- `accounting_rules.md` — domain invariants, PCG 2025, VAT, Factur-X, and FEC rules
- `data_model.md` — logical entities, mandatory French/EU columns, and relationships
- `db_architecture.md` — PostgreSQL constraints, immutability triggers, and gapless sequences
- `api_contracts.md` — REST API contract including SIREN/VIES lookup, credit notes, deposits, lettering, and FEC
- `implementation_plan.md` — step-by-step milestones from foundation to Micro-entreprise and Full PCG 2025
- `agent_instructions.md` — global instructions and legal guardrails for coding agents
- `.cursorrules` — concise Cursor/IDE guardrails
- `agent_skills/` — focused, reusable agent skill checklists
- `quality_and_security.md` — testing, threat model, GDPR/CNIL, and operational controls
