---
name: api-security
description: Use when implementing routes, authentication, step-up MFA, RBAC authorization, workspace isolation, SIREN/VIES validation, uploads, exports, or GDPR endpoints.
---

# API Security & GDPR Compliance Skill

1. Derive `user_id` from a verified server session/token, never from a request body or header.
2. Verify workspace membership, granular RBAC role (`owner`, `admin`, `finance`, `accountant`, `read_only`), and PostgreSQL RLS context (`SET LOCAL app.current_workspace_id`) on every protected request.
3. Require `Idempotency-Key` headers on all state-changing financial endpoints (`issue`, `credit-notes`, `payments`, `post`, `reverse`, `lettering`, `close`, `bank-imports/confirm`).
4. Support step-up MFA verification for high-risk actions (issuing documents, changing bank IBANs, elevating roles, closing accounting periods).
5. Validate French & EU legal identifiers server-side: 9-digit `SIREN` and 14-digit `SIRET` (Luhn algorithm), intra-EU VAT numbers (VIES format & consultation log), and UN/ECE unit codes.
6. Never trust client-supplied totals, VAT breakdowns, document numbers, or hash values; recalculate all financial figures server-side.
7. Protect uploads and exports with private EU-hosted object storage, `SHA-256` PAF integrity verification, magic-byte MIME checks, and short-lived scoped signed URLs ($\le 5$ minutes).
8. Sanitize CSV/Excel exports against formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`).
9. **GDPR & 10-Year Retention Compliance**: Redact PII/secrets from logs, ensure all external OCR/AI calls stay in the EU with Zero Data Retention (ZDR), and enforce the 10-year commercial archival lock (Art. L123-22 Code de commerce / GDPR Art. 17.3.b) when handling erasure requests.
10. Append cryptographic hash-chained `audit_events` (`BlockedLog`) for all permission changes and consequential financial transitions, and write cross-tenant + privilege-escalation tests for every route.
