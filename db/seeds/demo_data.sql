-- =============================================================================
-- Demo Seed Data — Haxatax Demo Workspace (Exercice 2026)
-- Inserts realistic French accounting demo data so every UI section shows data.
--
-- Amounts are in minor units (centimes): 500000 = 5 000,00 €
-- Run AFTER 001_initial_schema.sql, tax_rules_fr_eu.sql and pcg2025_accounts.sql.
-- Idempotent via ON CONFLICT DO NOTHING / DO UPDATE.
-- =============================================================================

DO $$
DECLARE
  v_ws   UUID := '00000000-0000-4000-8000-000000000001';
  v_user UUID;
  v_per  UUID;

  -- Journals
  v_jve  UUID;  -- VE — Ventes
  v_jac  UUID;  -- AC — Achats
  v_jbq  UUID;  -- BQ — Banque

  -- Accounts
  v_a411   UUID;  -- 411000 Clients collectif
  v_a706   UUID;  -- 706000 Prestations de services
  v_a4571  UUID;  -- 445710 TVA collectée 20 %
  v_a6135  UUID;  -- 613500 Locations mobilières / SaaS
  v_a4456  UUID;  -- 445660 TVA déductible autres biens
  v_a401   UUID;  -- 401000 Fournisseurs collectif
  v_a512   UUID;  -- 512100 Banque

  -- Tax rule
  v_tva20 UUID;

  -- Contacts
  v_c_dupont UUID;
  v_c_martin UUID;
  v_c_fourni UUID;

  -- Invoices
  v_inv1 UUID;
  v_inv2 UUID;
  v_inv3 UUID;

  -- Expenses
  v_exp1 UUID;

  -- Bank account
  v_ba UUID;

  -- Journal entry temp IDs
  v_je1 UUID;
  v_je2 UUID;
  v_je3 UUID;
  v_je4 UUID;

BEGIN

  -- Early exit: skip re-seeding if issued invoices already exist in this workspace
  IF EXISTS (SELECT 1 FROM invoices WHERE workspace_id = '00000000-0000-4000-8000-000000000001' AND number IS NOT NULL LIMIT 1) THEN
    RAISE NOTICE '[demo_data] Demo data already present — skipping.';
    RETURN;
  END IF;

  -- ── Lookup fixed IDs ──────────────────────────────────────────────────────
  SELECT id INTO v_user FROM users WHERE email = 'admin@haxatax.fr';
  SELECT id INTO v_per  FROM accounting_periods
    WHERE workspace_id = v_ws ORDER BY period_start LIMIT 1;

  SELECT id INTO v_jve  FROM journals WHERE workspace_id = v_ws AND code = 'VE';
  SELECT id INTO v_jac  FROM journals WHERE workspace_id = v_ws AND code = 'AC';
  SELECT id INTO v_jbq  FROM journals WHERE workspace_id = v_ws AND code = 'BQ';

  SELECT id INTO v_a411   FROM accounts WHERE workspace_id = v_ws AND account_code = '411000';
  SELECT id INTO v_a706   FROM accounts WHERE workspace_id = v_ws AND account_code = '706000';
  SELECT id INTO v_a4571  FROM accounts WHERE workspace_id = v_ws AND account_code = '445710';
  SELECT id INTO v_a6135  FROM accounts WHERE workspace_id = v_ws AND account_code = '613500';
  SELECT id INTO v_a4456  FROM accounts WHERE workspace_id = v_ws AND account_code = '445660';
  SELECT id INTO v_a401   FROM accounts WHERE workspace_id = v_ws AND account_code = '401000';
  SELECT id INTO v_a512   FROM accounts WHERE workspace_id = v_ws AND account_code = '512100';

  SELECT id INTO v_tva20 FROM tax_rules WHERE workspace_id IS NULL AND code = 'FR_TVA_20';

  -- ── Contacts ─────────────────────────────────────────────────────────────

  INSERT INTO contacts (
    workspace_id, kind, is_business, tax_zone,
    legal_name, trade_name, siren, siret,
    email, phone, billing_address,
    customer_auxiliary_code,
    default_payment_terms_days, default_payment_method
  ) VALUES (
    v_ws, 'customer', true, 'DOMESTIC_FR',
    'DUPONT CONSULTING SASU', 'Dupont Consulting', '824350291', '82435029100018',
    'contact@dupont-consulting.fr', '+33 1 42 00 00 01',
    '{"streetLine1":"12 avenue des Champs-Élysées","postalCode":"75008","city":"Paris","countryCode":"FR"}'::jsonb,
    'C0001', 30, 'SEPA_TRANSFER'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_c_dupont;

  IF v_c_dupont IS NULL THEN
    SELECT id INTO v_c_dupont FROM contacts
      WHERE workspace_id = v_ws AND customer_auxiliary_code = 'C0001';
  END IF;

  INSERT INTO contacts (
    workspace_id, kind, is_business, tax_zone,
    legal_name, siren, siret, email, billing_address,
    customer_auxiliary_code, default_payment_terms_days
  ) VALUES (
    v_ws, 'customer', true, 'DOMESTIC_FR',
    'MARTIN TECH SAS', '839582174', '83958217400025',
    'compta@martin-tech.fr',
    '{"streetLine1":"5 rue de la Technologie","postalCode":"69003","city":"Lyon","countryCode":"FR"}'::jsonb,
    'C0002', 30
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_c_martin;

  IF v_c_martin IS NULL THEN
    SELECT id INTO v_c_martin FROM contacts
      WHERE workspace_id = v_ws AND customer_auxiliary_code = 'C0002';
  END IF;

  INSERT INTO contacts (
    workspace_id, kind, is_business, tax_zone,
    legal_name, siren, siret, email, billing_address,
    supplier_auxiliary_code, default_payment_terms_days
  ) VALUES (
    v_ws, 'supplier', true, 'DOMESTIC_FR',
    'FOURNISOFT SARL', '751843092', '75184309200047',
    'facturation@fournisoft.fr',
    '{"streetLine1":"8 rue des Logiciels","postalCode":"31000","city":"Toulouse","countryCode":"FR"}'::jsonb,
    'F0001', 30
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_c_fourni;

  IF v_c_fourni IS NULL THEN
    SELECT id INTO v_c_fourni FROM contacts
      WHERE workspace_id = v_ws AND supplier_auxiliary_code = 'F0001';
  END IF;

  -- ── Document sequences (bootstrap counters) ───────────────────────────────
  INSERT INTO document_sequences (workspace_id, sequence_type, fiscal_year, current_value)
  VALUES
    (v_ws, 'invoice',    2026, 2),
    (v_ws, 'journal_VE', 2026, 2),
    (v_ws, 'journal_AC', 2026, 1),
    (v_ws, 'journal_BQ', 2026, 1)
  ON CONFLICT (workspace_id, sequence_type, fiscal_year)
    DO UPDATE SET current_value = GREATEST(document_sequences.current_value, EXCLUDED.current_value);

  -- ── Invoices — Step 1: insert as draft (triggers block lines on issued) ───

  -- FA-2026-00001 — DUPONT CONSULTING — 5 000 € HT + TVA 20% = 6 000 € TTC
  INSERT INTO invoices (
    workspace_id, contact_id, document_type, provisional_ref,
    status, payment_status, operation_category,
    issue_date, delivery_or_service_date, due_date,
    currency, exchange_rate,
    subtotal_ht_minor, vat_total_minor, total_ttc_minor,
    deposits_deducted_ttc_minor, net_to_pay_ttc_minor, amount_paid_minor,
    late_penalty_rate, recovery_indemnity_minor, discount_terms,
    vat_on_debits_mention, facturx_profile,
    created_by
  ) VALUES (
    v_ws, v_c_dupont, 'standard_invoice', 'PROV-2026-0001',
    'draft', 'unpaid', 'services',
    '2026-01-15', '2026-01-15', '2026-02-14',
    'EUR', 1.000000,
    500000, 100000, 600000, 0, 600000, 0,
    15.000, 4000, 'Pas d''escompte pour paiement anticipé',
    true, 'EN16931', v_user
  ) RETURNING id INTO v_inv1;

  INSERT INTO invoice_lines (
    workspace_id, invoice_id, position, line_nature,
    description, quantity, unit_code,
    unit_price_ht_minor, discount_percent, discount_amount_ht_minor,
    vat_rule_id, vat_rate_snapshot, vat_category_code,
    accounting_account_id,
    line_subtotal_ht_minor, line_vat_preview_minor, line_total_ttc_preview_minor
  ) VALUES (
    v_ws, v_inv1, 1, 'services',
    'Accompagnement stratégique — transformation digitale (5 j)',
    5, 'C62', 100000, 0, 0,
    v_tva20, 20.000, 'S', v_a706,
    500000, 100000, 600000
  );

  INSERT INTO invoice_tax_breakdowns (
    workspace_id, invoice_id, vat_rule_id,
    vat_category_code, vat_rate, taxable_base_ht_minor, vat_amount_minor
  ) VALUES (
    v_ws, v_inv1, v_tva20, 'S', 20.000, 500000, 100000
  );

  -- FA-2026-00002 — MARTIN TECH — 1 500 € HT + TVA 20% = 1 800 € TTC
  INSERT INTO invoices (
    workspace_id, contact_id, document_type, provisional_ref,
    status, payment_status, operation_category,
    issue_date, delivery_or_service_date, due_date,
    currency, exchange_rate,
    subtotal_ht_minor, vat_total_minor, total_ttc_minor,
    deposits_deducted_ttc_minor, net_to_pay_ttc_minor, amount_paid_minor,
    late_penalty_rate, recovery_indemnity_minor, discount_terms,
    vat_on_debits_mention, facturx_profile,
    created_by
  ) VALUES (
    v_ws, v_c_martin, 'standard_invoice', 'PROV-2026-0002',
    'draft', 'unpaid', 'services',
    '2026-02-10', '2026-02-10', '2026-03-12',
    'EUR', 1.000000,
    150000, 30000, 180000, 0, 180000, 0,
    15.000, 4000, 'Pas d''escompte pour paiement anticipé',
    true, 'EN16931', v_user
  ) RETURNING id INTO v_inv2;

  INSERT INTO invoice_lines (
    workspace_id, invoice_id, position, line_nature,
    description, quantity, unit_code,
    unit_price_ht_minor, discount_percent, discount_amount_ht_minor,
    vat_rule_id, vat_rate_snapshot, vat_category_code,
    accounting_account_id,
    line_subtotal_ht_minor, line_vat_preview_minor, line_total_ttc_preview_minor
  ) VALUES (
    v_ws, v_inv2, 1, 'services',
    'Abonnement mensuel Haxatax SaaS — Février 2026',
    1, 'C62', 150000, 0, 0,
    v_tva20, 20.000, 'S', v_a706,
    150000, 30000, 180000
  );

  INSERT INTO invoice_tax_breakdowns (
    workspace_id, invoice_id, vat_rule_id,
    vat_category_code, vat_rate, taxable_base_ht_minor, vat_amount_minor
  ) VALUES (
    v_ws, v_inv2, v_tva20, 'S', 20.000, 150000, 30000
  );

  -- FA-2026-00003 — DUPONT CONSULTING — 2 000 € HT — BROUILLON (pas encore émise)
  INSERT INTO invoices (
    workspace_id, contact_id, document_type, provisional_ref,
    status, payment_status, operation_category,
    issue_date, delivery_or_service_date, due_date,
    currency, exchange_rate,
    subtotal_ht_minor, vat_total_minor, total_ttc_minor,
    deposits_deducted_ttc_minor, net_to_pay_ttc_minor, amount_paid_minor,
    late_penalty_rate, recovery_indemnity_minor, discount_terms,
    vat_on_debits_mention, facturx_profile,
    created_by
  ) VALUES (
    v_ws, v_c_dupont, 'standard_invoice', 'PROV-2026-0003',
    'draft', 'unpaid', 'services',
    '2026-03-05', '2026-03-05', '2026-04-04',
    'EUR', 1.000000,
    200000, 40000, 240000, 0, 240000, 0,
    15.000, 4000, 'Pas d''escompte pour paiement anticipé',
    true, 'EN16931', v_user
  ) RETURNING id INTO v_inv3;

  INSERT INTO invoice_lines (
    workspace_id, invoice_id, position, line_nature,
    description, quantity, unit_code,
    unit_price_ht_minor, discount_percent, discount_amount_ht_minor,
    vat_rule_id, vat_rate_snapshot, vat_category_code,
    accounting_account_id,
    line_subtotal_ht_minor, line_vat_preview_minor, line_total_ttc_preview_minor
  ) VALUES (
    v_ws, v_inv3, 1, 'services',
    'Formation PCG 2025 — 2 journées en présentiel',
    2, 'C62', 100000, 0, 0,
    v_tva20, 20.000, 'S', v_a706,
    200000, 40000, 240000
  );

  -- ── Step 2: promote INV1 and INV2 to issued ───────────────────────────────
  -- (triggers only block UPDATE when OLD.status is already 'issued')

  UPDATE invoices SET
    status            = 'issued',
    payment_status    = 'paid',
    number            = 'FA-2026-00001',
    amount_paid_minor = 600000,
    issuer_snapshot   = '{"legalName":"Haxatax Conseil","siren":"732829320","siret":"73282932000012","vatNumber":null}'::jsonb,
    customer_snapshot = '{"legalName":"DUPONT CONSULTING SASU","siren":"824350291","siret":"82435029100018"}'::jsonb,
    document_hash     = encode(digest('FA-2026-00001|500000|600000|demo-seed', 'sha256'), 'hex'),
    issued_at         = '2026-01-15T09:00:00Z'::timestamptz,
    issued_by         = v_user
  WHERE id = v_inv1;

  UPDATE invoices SET
    status            = 'issued',
    payment_status    = 'unpaid',
    number            = 'FA-2026-00002',
    issuer_snapshot   = '{"legalName":"Haxatax Conseil","siren":"732829320","siret":"73282932000012","vatNumber":null}'::jsonb,
    customer_snapshot = '{"legalName":"MARTIN TECH SAS","siren":"839582174","siret":"83958217400025"}'::jsonb,
    document_hash     = encode(digest('FA-2026-00002|150000|180000|demo-seed', 'sha256'), 'hex'),
    issued_at         = '2026-02-10T10:00:00Z'::timestamptz,
    issued_by         = v_user
  WHERE id = v_inv2;

  -- ── Expenses ──────────────────────────────────────────────────────────────

  -- Achat SaaS — 450 € HT + TVA 20% = 540 € TTC
  INSERT INTO expenses (
    workspace_id, supplier_contact_id,
    supplier_invoice_ref, expense_date, due_date, currency,
    subtotal_ht_minor, vat_total_minor, vat_deductible_minor,
    total_ttc_minor, amount_paid_minor,
    status, created_by
  ) VALUES (
    v_ws, v_c_fourni,
    'FOUR-2026-0123', '2026-01-20', '2026-02-19', 'EUR',
    45000, 9000, 9000, 54000, 0,
    'draft', v_user
  ) RETURNING id INTO v_exp1;

  INSERT INTO expense_lines (
    workspace_id, expense_id, position, description,
    accounting_account_id, vat_rule_id, vat_rate,
    deductibility_ratio,
    amount_ht_minor, vat_total_minor, vat_deductible_minor,
    vat_non_deductible_minor, amount_ttc_minor
  ) VALUES (
    v_ws, v_exp1, 1,
    'Abonnement logiciel comptabilité — Janvier 2026',
    v_a6135, v_tva20, 20.000,
    1.0000, 45000, 9000, 9000, 0, 54000
  );

  -- Fournitures bureau — 200 € HT + TVA 20% = 240 € TTC
  INSERT INTO expenses (
    workspace_id, supplier_contact_id,
    supplier_invoice_ref, expense_date, due_date, currency,
    subtotal_ht_minor, vat_total_minor, vat_deductible_minor,
    total_ttc_minor, amount_paid_minor,
    status, created_by
  ) VALUES (
    v_ws, v_c_fourni,
    'FOUR-2026-0189', '2026-02-15', '2026-03-17', 'EUR',
    20000, 4000, 4000, 24000, 0,
    'draft', v_user
  );

  -- ── Bank account ──────────────────────────────────────────────────────────
  SELECT id INTO v_ba FROM bank_accounts
    WHERE workspace_id = v_ws AND iban_masked = 'FR76 3000 4000 0100 0000 0000 191'
    LIMIT 1;

  IF v_ba IS NULL THEN
    INSERT INTO bank_accounts (
      workspace_id, display_name, bank_name, iban_masked, bic,
      currency, ledger_account_id, journal_id, provider
    ) VALUES (
      v_ws,
      'BNP Paribas — Compte courant',
      'BNP Paribas',
      'FR76 3000 4000 0100 0000 0000 191',
      'BNPAFRPP',
      'EUR', v_a512, v_jbq, 'manual_csv'
    ) RETURNING id INTO v_ba;
  END IF;

  -- ── Bank transactions ─────────────────────────────────────────────────────
  INSERT INTO bank_transactions (
    workspace_id, bank_account_id,
    transaction_date, booking_date,
    description, counterparty_name,
    amount_minor, currency, fingerprint, status
  ) VALUES
    (v_ws, v_ba, '2026-01-20', '2026-01-20',
     'VIR RECU DUPONT CONSULTING FA-2026-00001', 'DUPONT CONSULTING SASU',
     600000, 'EUR',
     encode(digest('20260120|600000|DUPONT CONSULTING SASU', 'sha256'), 'hex'),
     'matched'),
    (v_ws, v_ba, '2026-01-25', '2026-01-25',
     'PRLV FOURNISOFT FOUR-2026-0123', 'FOURNISOFT SARL',
     -54000, 'EUR',
     encode(digest('20260125|-54000|FOURNISOFT SARL', 'sha256'), 'hex'),
     'matched'),
    (v_ws, v_ba, '2026-01-31', '2026-01-31',
     'FRAIS TENUE COMPTE JANVIER 2026', 'BNP PARIBAS',
     -2500, 'EUR',
     encode(digest('20260131|-2500|BNP PARIBAS', 'sha256'), 'hex'),
     'unmatched'),
    (v_ws, v_ba, '2026-02-28', '2026-02-28',
     'VIR RECU MARTIN TECH SAS — ACOMPTE', 'MARTIN TECH SAS',
     90000, 'EUR',
     encode(digest('20260228|90000|MARTIN TECH SAS', 'sha256'), 'hex'),
     'unmatched')
  ON CONFLICT (workspace_id, bank_account_id, fingerprint) DO NOTHING;

  -- ── Journal entries — Grand Livre (status = posted) ──────────────────────
  --
  -- VE-2026-00001 : Facture FA-2026-00001 DUPONT
  --   411000 D 6 000,00 / 706000 C 5 000,00 / 445710 C 1 000,00
  --
  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jve, v_per,
    'VE-2026-00001', '2026-01-15', 'FA-2026-00001', '2026-01-15',
    'Facture FA-2026-00001 — DUPONT CONSULTING SASU',
    'posted', 'invoice', v_inv1,
    '2026-01-15', '2026-01-15T09:00:00Z', v_user,
    NULL,
    encode(digest('VE-2026-00001|invoice|600000|demo', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je1;

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je1, 1, v_a411, v_c_dupont, 'C0001', 'DUPONT CONSULTING SASU',
     'Facture FA-2026-00001', 600000, 0, 'EUR'),
    (v_ws, v_je1, 2, v_a706, NULL, NULL, NULL,
     'Prestations de services', 0, 500000, 'EUR'),
    (v_ws, v_je1, 3, v_a4571, NULL, NULL, NULL,
     'TVA collectée 20 %', 0, 100000, 'EUR');

  -- BQ-2026-00001 : Règlement FA-2026-00001
  --   512100 D 6 000,00 / 411000 C 6 000,00
  --
  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jbq, v_per,
    'BQ-2026-00001', '2026-01-20', 'VIR-20260120', '2026-01-20',
    'Règlement FA-2026-00001 — DUPONT CONSULTING SASU',
    'posted', 'payment', v_inv1,
    '2026-01-20', '2026-01-20T14:00:00Z', v_user,
    encode(digest('VE-2026-00001|invoice|600000|demo', 'sha256'), 'hex'),
    encode(digest('BQ-2026-00001|payment|600000|demo', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je2;

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je2, 1, v_a512, NULL, NULL, NULL,
     'Virement reçu DUPONT CONSULTING', 600000, 0, 'EUR'),
    (v_ws, v_je2, 2, v_a411, v_c_dupont, 'C0001', 'DUPONT CONSULTING SASU',
     'Règlement facture FA-2026-00001', 0, 600000, 'EUR');

  -- VE-2026-00002 : Facture FA-2026-00002 MARTIN TECH
  --   411000 D 1 800,00 / 706000 C 1 500,00 / 445710 C 300,00
  --
  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jve, v_per,
    'VE-2026-00002', '2026-02-10', 'FA-2026-00002', '2026-02-10',
    'Facture FA-2026-00002 — MARTIN TECH SAS',
    'posted', 'invoice', v_inv2,
    '2026-02-10', '2026-02-10T10:00:00Z', v_user,
    encode(digest('BQ-2026-00001|payment|600000|demo', 'sha256'), 'hex'),
    encode(digest('VE-2026-00002|invoice|180000|demo', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je3;

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je3, 1, v_a411, v_c_martin, 'C0002', 'MARTIN TECH SAS',
     'Facture FA-2026-00002', 180000, 0, 'EUR'),
    (v_ws, v_je3, 2, v_a706, NULL, NULL, NULL,
     'Abonnement SaaS Haxatax — Février 2026', 0, 150000, 'EUR'),
    (v_ws, v_je3, 3, v_a4571, NULL, NULL, NULL,
     'TVA collectée 20 %', 0, 30000, 'EUR');

  -- AC-2026-00001 : Achat FOURNISOFT
  --   613500 D 450,00 + 445660 D 90,00 / 401000 C 540,00
  --
  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jac, v_per,
    'AC-2026-00001', '2026-01-20', 'FOUR-2026-0123', '2026-01-20',
    'Achat FOURNISOFT SARL — FOUR-2026-0123',
    'posted', 'expense', v_exp1,
    '2026-01-20', '2026-01-20T11:00:00Z', v_user,
    NULL,
    encode(digest('AC-2026-00001|expense|54000|demo', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je4;

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je4, 1, v_a6135, NULL, NULL, NULL,
     'Abonnement logiciel — Janvier 2026', 45000, 0, 'EUR'),
    (v_ws, v_je4, 2, v_a4456, NULL, NULL, NULL,
     'TVA déductible 20 %', 9000, 0, 'EUR'),
    (v_ws, v_je4, 3, v_a401, v_c_fourni, 'F0001', 'FOURNISOFT SARL',
     'Fournisseur FOURNISOFT FOUR-2026-0123', 0, 54000, 'EUR');

  RAISE NOTICE '[demo] Seed complete: 3 contacts, 3 invoices (2 issued), 2 expenses, 4 bank transactions, 4 journal entries.';

END;
$$;
