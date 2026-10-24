---
name: frontend-ux
description: Use when building or changing React pages, navigation, forms, tables, dashboards, French financial formatting, or RGAA 4.1 / EAA accessible UX.
---

# Frontend UX & RGAA 4.1 Accessibility Skill

1. Inspect existing design tokens, components, routes, and form patterns before coding; reuse the established stack.
2. **Zero Accounting Policy in UI**: Never treat frontend VAT or invoice total calculations as authoritative; always display server-validated `taxBreakdowns` and totals before and after save/issuance.
3. **Progressive Regime UX (`CASH_MICRO` vs `DOUBLE_ENTRY_PCG2025`)**: Adapt terminology and visible controls to the workspace mode (e.g., highlight *Livre des recettes*, *Franchise de TVA Art. 293 B*, and URSSAF thresholds for Micro-entrepreneurs; expose full PCG 2025 account selectors, `VE`/`AC`/`BQ`/`OD` journals, `lettrage`, and FEC tools for commercial companies and accountants).
4. **French Financial & Legal Conventions (`fr-FR`)**:
   - Format monetary amounts from integer minor units using `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })` (comma decimal separator, non-breaking space before `€`).
   - Display dates as `DD/MM/YYYY` in the UI while sending ISO `YYYY-MM-DD` over the API.
   - Surface mandatory French B2B invoice fields clearly: SIREN/SIRET lookup button, operation category (`Biens`, `Services`, `Mixte`), delivery/execution date, payment due date, late penalty rate, €40 B2B recovery indemnity notice, and 0% VAT legal exemption selector.
   - Clearly distinguish Draft (`BROUILLON / PROV-xxxx`) from Issued (`ÉMISE / FA-2026-xxxxx`), Deposit Invoice (`Facture d'acompte`), and Credit Note (`Facture d'avoir`), as well as 2026 e-invoicing statuses (`Déposée`, `Rejetée`, `Refusée`, `Encaissée`).
5. **EU European Accessibility Act (EAA) & RGAA 4.1 / WCAG 2.1 AA Compliance**:
   - Ensure full keyboard navigation (`Tab`, `Shift+Tab`, `Escape`, arrow keys), visible focus rings, explicit `<label>` elements, `aria-invalid`/`aria-describedby` error messages, and `aria-live` status announcements.
   - Maintain $\ge 4.5:1$ contrast ratios and test responsive layouts at `320 px`, mobile, tablet, and desktop widths without horizontal overflow.
6. Build loading, empty, validation-error, server-error, and success states on every view, and prevent double-submission on consequential actions (with explicit confirmation modals for invoice issuance, credit note creation, and irreversible period closure).
