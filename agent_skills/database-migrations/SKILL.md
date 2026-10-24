---
name: database-migrations
description: Use when creating or modifying PostgreSQL tables, constraints, indexes, RLS policies, immutability triggers, gapless sequences, seeds, or migrations.
---

# Database Migration Skill (PostgreSQL — French PAF / FEC Compliance)

1. Read `data_model.md` and `db_architecture.md` before writing any SQL migration.
2. Never edit an already-applied migration in a shared environment; create a new versioned forward migration.
3. Include `workspace_id UUID NOT NULL` with foreign keys (`ON DELETE RESTRICT` for all financial and third-party references) and enable PostgreSQL **Row-Level Security (RLS)** on every tenant-owned table.
4. **Prohibition on `SERIAL`/`SEQUENCE` for Legal Numbers**: Never use PostgreSQL `SERIAL`, `BIGSERIAL`, or `IDENTITY` for invoice numbers or FEC `EcritureNum` (rolled-back transactions create illegal numbering gaps). Use the `document_sequences` table locked with `SELECT ... FOR UPDATE` inside the transaction.
5. **Mandatory Immutability Triggers (`BEFORE UPDATE OR DELETE`)**:
   - Block `DELETE` and financial/legal column `UPDATE` on `invoices` once `status = 'issued'` (and on child `invoice_lines` / `invoice_tax_breakdowns`).
   - Block `DELETE` and `UPDATE` on `journal_entries` and `journal_entry_lines` once `status = 'posted'` (allowing only reversal link metadata or `lettering_code`/`lettered_at` while the period is `'open'`).
   - Block reopening or posting into `accounting_periods` once `status = 'closed'`.
   - Block all `UPDATE`, `DELETE`, and `TRUNCATE` on `audit_events`.
6. **Deferred Double-Entry & Auxiliary Checks**: Enforce via `DEFERRABLE INITIALLY DEFERRED` constraint triggers or atomic posting procedures that every `posted` journal entry has $\sum \text{debit\_minor} = \sum \text{credit\_minor} > 0$ and that collective accounts (`411000`, `401000`) always include `auxiliary_account_code` (`CompAuxNum`).
7. Seed official **PCG 2025 (Règlement ANC n° 2022-06)** accounts and French/EU tax rules cleanly; keep demo company seeds strictly separate and clearly marked as fictional.
8. Test every migration, trigger, and RLS policy against a disposable PostgreSQL instance in CI.
