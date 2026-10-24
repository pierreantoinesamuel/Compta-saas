-- =============================================================================
-- Extended demo data — Haxatax Conseil / Exercice 2026
--
-- Revenue scenario: ~34 200 HT CA sur Jan-Avr 2026
-- Charges:          ~  5 570 HT sur Jan-Avr 2026
-- TVA collectee:    ~  6 840      TVA deductible: ~1 114
-- =============================================================================

DO $$
DECLARE
  v_ws   UUID := '00000000-0000-4000-8000-000000000001';
  v_user UUID;
  v_per  UUID;

  v_jve UUID; v_jbq UUID; v_jac UUID; v_jod UUID;

  v_a706  UUID;
  v_a411  UUID;
  v_a401  UUID;
  v_a4571 UUID;
  v_a4456 UUID;
  v_a512  UUID;
  v_a613  UUID;
  v_a622  UUID;
  v_a626  UUID;
  v_a6800 UUID;
  v_a2183 UUID;

  v_tva20 UUID;

  v_c_dupont  UUID;
  v_c_martin  UUID;
  v_c_fourni  UUID;
  v_c_leblanc UUID;
  v_c_nexalia UUID;
  v_c_techno  UUID;
  v_c_infra   UUID;
  v_c_berger  UUID;

  v_ba UUID;

  v_inv3 UUID;
  v_inv4 UUID;
  v_inv5 UUID;
  v_inv6 UUID;
  v_inv7 UUID;

  v_exp3 UUID;
  v_exp4 UUID;
  v_exp5 UUID;
  v_exp6 UUID;

  v_je5  UUID; v_je6  UUID; v_je7  UUID; v_je8  UUID;
  v_je9  UUID; v_je10 UUID; v_je11 UUID; v_je12 UUID;
  v_je13 UUID; v_je14 UUID; v_je15 UUID; v_je16 UUID;
  v_je17 UUID; v_je18 UUID;

  v_h_ve  TEXT := encode(digest('VE-2026-00002|invoice|180000|demo',  'sha256'), 'hex');
  v_h_bq  TEXT := encode(digest('BQ-2026-00001|payment|600000|demo', 'sha256'), 'hex');
  v_h_ac  TEXT := encode(digest('AC-2026-00001|expense|54000|demo',  'sha256'), 'hex');

BEGIN

  -- Idempotency guard
  IF EXISTS (
    SELECT 1 FROM invoices
    WHERE workspace_id = v_ws AND number = 'FA-2026-00003' LIMIT 1
  ) THEN
    RAISE NOTICE '[demo_ext] Already present — skipping.';
    RETURN;
  END IF;

  -- Shared references
  SELECT id INTO v_user FROM users WHERE email = 'admin@haxatax.fr';
  SELECT id INTO v_per  FROM accounting_periods
    WHERE workspace_id = v_ws ORDER BY period_start LIMIT 1;

  SELECT id INTO v_jve FROM journals WHERE workspace_id = v_ws AND code = 'VE';
  SELECT id INTO v_jbq FROM journals WHERE workspace_id = v_ws AND code = 'BQ';
  SELECT id INTO v_jac FROM journals WHERE workspace_id = v_ws AND code = 'AC';
  SELECT id INTO v_jod FROM journals WHERE workspace_id = v_ws AND code = 'OD';
  SELECT id INTO v_ba  FROM bank_accounts WHERE workspace_id = v_ws LIMIT 1;

  SELECT id INTO v_a706  FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '706%' LIMIT 1;
  SELECT id INTO v_a411  FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '411%' LIMIT 1;
  SELECT id INTO v_a401  FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '401%' LIMIT 1;
  SELECT id INTO v_a4571 FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '44571%' LIMIT 1;
  SELECT id INTO v_a4456 FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '445660%' LIMIT 1;
  SELECT id INTO v_a512  FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '512%' LIMIT 1;

  SELECT id INTO v_a613  FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '6131%' LIMIT 1;
  IF v_a613 IS NULL THEN
    SELECT id INTO v_a613 FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '613%' LIMIT 1;
  END IF;

  SELECT id INTO v_a622  FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '622%' LIMIT 1;
  IF v_a622 IS NULL THEN v_a622 := v_a613; END IF;

  SELECT id INTO v_a626  FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '626%' LIMIT 1;
  IF v_a626 IS NULL THEN v_a626 := v_a613; END IF;

  SELECT id INTO v_a6800 FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '681%' LIMIT 1;
  IF v_a6800 IS NULL THEN v_a6800 := v_a613; END IF;

  SELECT id INTO v_a2183 FROM accounts WHERE workspace_id = v_ws AND account_code LIKE '218%' LIMIT 1;
  IF v_a2183 IS NULL THEN v_a2183 := v_a512; END IF;

  SELECT id INTO v_tva20 FROM tax_rules WHERE code = 'TVA_FR_20' LIMIT 1;
  IF v_tva20 IS NULL THEN
    SELECT id INTO v_tva20 FROM tax_rules WHERE rate = 20.000 AND jurisdiction = 'FR' LIMIT 1;
  END IF;

  SELECT id INTO v_c_dupont FROM contacts
    WHERE workspace_id = v_ws AND legal_name = 'DUPONT CONSULTING SASU';
  SELECT id INTO v_c_martin FROM contacts
    WHERE workspace_id = v_ws AND legal_name = 'MARTIN TECH SAS';
  SELECT id INTO v_c_fourni FROM contacts
    WHERE workspace_id = v_ws AND legal_name = 'FOURNISOFT SARL';

  -- ── New contacts ────────────────────────────────────────────────────────────

  INSERT INTO contacts (
    workspace_id, kind, is_business, tax_zone,
    legal_name, siren, siret, email, billing_address,
    customer_auxiliary_code, default_payment_terms_days
  ) VALUES (
    v_ws, 'customer', true, 'DOMESTIC_FR',
    'LEBLANC ARCHITECTES SAS', '518273401', '51827340100021',
    'contact@leblanc-architectes.fr',
    '{"streetLine1":"14 rue des Architectes","postalCode":"69006","city":"Lyon","countryCode":"FR"}'::jsonb,
    'C0003', 30
  ) RETURNING id INTO v_c_leblanc;

  INSERT INTO contacts (
    workspace_id, kind, is_business, tax_zone,
    legal_name, siren, siret, email, billing_address,
    customer_auxiliary_code, default_payment_terms_days
  ) VALUES (
    v_ws, 'customer', true, 'DOMESTIC_FR',
    'NEXALIA GROUP SA', '421832906', '42183290600015',
    'compta@nexalia.fr',
    '{"streetLine1":"8 avenue de la Defense","postalCode":"92800","city":"Puteaux","countryCode":"FR"}'::jsonb,
    'C0004', 45
  ) RETURNING id INTO v_c_nexalia;

  INSERT INTO contacts (
    workspace_id, kind, is_business, tax_zone,
    legal_name, siren, siret, email, billing_address,
    customer_auxiliary_code, default_payment_terms_days
  ) VALUES (
    v_ws, 'customer', true, 'DOMESTIC_FR',
    'TECHNO PARTNERS SAS', '820134752', '82013475200019',
    'facturation@techno-partners.fr',
    '{"streetLine1":"22 boulevard de l''Innovation","postalCode":"31000","city":"Toulouse","countryCode":"FR"}'::jsonb,
    'C0005', 30
  ) RETURNING id INTO v_c_techno;

  INSERT INTO contacts (
    workspace_id, kind, is_business, tax_zone,
    legal_name, siren, siret, email, billing_address,
    supplier_auxiliary_code, default_payment_terms_days
  ) VALUES (
    v_ws, 'supplier', true, 'DOMESTIC_FR',
    'INFRA-SOLUTIONS SARL', '723841059', '72384105900014',
    'facturation@infra-solutions.fr',
    '{"streetLine1":"5 rue de l''Industrie","postalCode":"75010","city":"Paris","countryCode":"FR"}'::jsonb,
    'F0002', 30
  ) RETURNING id INTO v_c_infra;

  INSERT INTO contacts (
    workspace_id, kind, is_business, tax_zone,
    legal_name, siren, siret, email, billing_address,
    supplier_auxiliary_code, default_payment_terms_days
  ) VALUES (
    v_ws, 'supplier', true, 'DOMESTIC_FR',
    'CABINET BERGER EXPERTISE', '612459803', '61245980300011',
    'compta@berger-expertise.fr',
    '{"streetLine1":"35 boulevard des Experts","postalCode":"75008","city":"Paris","countryCode":"FR"}'::jsonb,
    'F0003', 30
  ) RETURNING id INTO v_c_berger;

  -- ── Invoices ────────────────────────────────────────────────────────────────
  -- FA-2026-00003 LEBLANC 8000 HT PAID

  INSERT INTO invoices (
    workspace_id, created_by, contact_id, document_type, provisional_ref,
    original_invoice_id, status, payment_status, einvoice_status,
    issue_date, delivery_or_service_date, due_date, currency, operation_category,
    subtotal_ht_minor, vat_total_minor, total_ttc_minor,
    deposits_deducted_ttc_minor, net_to_pay_ttc_minor, amount_paid_minor,
    late_penalty_rate, recovery_indemnity_minor, discount_terms,
    vat_exemption_mention, vat_on_debits_mention, issuer_snapshot, customer_snapshot
  ) VALUES (
    v_ws, v_user, v_c_leblanc, 'standard_invoice', 'DEV-2026-0003',
    NULL, 'draft', 'unpaid', 'not_applicable',
    '2026-03-01', '2026-03-01', '2026-03-31', 'EUR', 'services',
    800000, 160000, 960000, 0, 960000, 0,
    15.000, 4000, 'Pas d''escompte pour paiement anticipe',
    NULL, false,
    '{"legalName":"Haxatax Conseil","siren":"732829320","siret":"73282932000012"}'::jsonb,
    '{"legalName":"LEBLANC ARCHITECTES SAS","siren":"518273401","siret":"51827340100021"}'::jsonb
  ) RETURNING id INTO v_inv3;

  INSERT INTO invoice_lines (
    workspace_id, invoice_id, position, description,
    quantity, unit_code, unit_price_ht_minor, discount_percent, discount_amount_ht_minor,
    vat_rule_id, vat_rate_snapshot, vat_category_code,
    line_subtotal_ht_minor, line_vat_preview_minor, line_total_ttc_preview_minor
  ) VALUES (
    v_ws, v_inv3, 1, 'Mission conseil transformation digitale — Mars 2026',
    1, 'C62', 800000, 0, 0, v_tva20, 20.000, 'S', 800000, 160000, 960000
  );

  INSERT INTO invoice_tax_breakdowns (
    workspace_id, invoice_id, vat_rule_id, vat_category_code, vat_rate,
    taxable_base_ht_minor, vat_amount_minor
  ) VALUES (v_ws, v_inv3, v_tva20, 'S', 20.000, 800000, 160000);

  UPDATE invoices SET
    status = 'issued', payment_status = 'paid', number = 'FA-2026-00003',
    amount_paid_minor = 960000,
    document_hash = encode(digest('FA-2026-00003|800000|960000|demo-ext', 'sha256'), 'hex'),
    issued_at = '2026-03-01T09:00:00Z'::timestamptz, issued_by = v_user
  WHERE id = v_inv3;

  -- FA-2026-00004 NEXALIA 12000 HT UNPAID overdue

  INSERT INTO invoices (
    workspace_id, created_by, contact_id, document_type, provisional_ref,
    original_invoice_id, status, payment_status, einvoice_status,
    issue_date, delivery_or_service_date, due_date, currency, operation_category,
    subtotal_ht_minor, vat_total_minor, total_ttc_minor,
    deposits_deducted_ttc_minor, net_to_pay_ttc_minor, amount_paid_minor,
    late_penalty_rate, recovery_indemnity_minor, discount_terms,
    vat_exemption_mention, vat_on_debits_mention, issuer_snapshot, customer_snapshot
  ) VALUES (
    v_ws, v_user, v_c_nexalia, 'standard_invoice', 'DEV-2026-0004',
    NULL, 'draft', 'unpaid', 'not_applicable',
    '2026-03-15', '2026-03-15', '2026-04-14', 'EUR', 'services',
    1200000, 240000, 1440000, 0, 1440000, 0,
    15.000, 4000, 'Pas d''escompte pour paiement anticipe',
    NULL, false,
    '{"legalName":"Haxatax Conseil","siren":"732829320","siret":"73282932000012"}'::jsonb,
    '{"legalName":"NEXALIA GROUP SA","siren":"421832906","siret":"42183290600015"}'::jsonb
  ) RETURNING id INTO v_inv4;

  INSERT INTO invoice_lines (
    workspace_id, invoice_id, position, description,
    quantity, unit_code, unit_price_ht_minor, discount_percent, discount_amount_ht_minor,
    vat_rule_id, vat_rate_snapshot, vat_category_code,
    line_subtotal_ht_minor, line_vat_preview_minor, line_total_ttc_preview_minor
  ) VALUES (
    v_ws, v_inv4, 1, 'Audit et restructuration systeme d''information — Q1 2026',
    1, 'C62', 1200000, 0, 0, v_tva20, 20.000, 'S', 1200000, 240000, 1440000
  );

  INSERT INTO invoice_tax_breakdowns (
    workspace_id, invoice_id, vat_rule_id, vat_category_code, vat_rate,
    taxable_base_ht_minor, vat_amount_minor
  ) VALUES (v_ws, v_inv4, v_tva20, 'S', 20.000, 1200000, 240000);

  UPDATE invoices SET
    status = 'issued', payment_status = 'unpaid', number = 'FA-2026-00004',
    document_hash = encode(digest('FA-2026-00004|1200000|1440000|demo-ext', 'sha256'), 'hex'),
    issued_at = '2026-03-15T10:00:00Z'::timestamptz, issued_by = v_user
  WHERE id = v_inv4;

  -- FA-2026-00005 DUPONT 4500 HT PAID

  INSERT INTO invoices (
    workspace_id, created_by, contact_id, document_type, provisional_ref,
    original_invoice_id, status, payment_status, einvoice_status,
    issue_date, delivery_or_service_date, due_date, currency, operation_category,
    subtotal_ht_minor, vat_total_minor, total_ttc_minor,
    deposits_deducted_ttc_minor, net_to_pay_ttc_minor, amount_paid_minor,
    late_penalty_rate, recovery_indemnity_minor, discount_terms,
    vat_exemption_mention, vat_on_debits_mention, issuer_snapshot, customer_snapshot
  ) VALUES (
    v_ws, v_user, v_c_dupont, 'standard_invoice', 'DEV-2026-0005',
    NULL, 'draft', 'unpaid', 'not_applicable',
    '2026-04-10', '2026-04-10', '2026-05-10', 'EUR', 'services',
    450000, 90000, 540000, 0, 540000, 0,
    15.000, 4000, 'Pas d''escompte pour paiement anticipe',
    NULL, false,
    '{"legalName":"Haxatax Conseil","siren":"732829320","siret":"73282932000012"}'::jsonb,
    '{"legalName":"DUPONT CONSULTING SASU","siren":"824350291","siret":"82435029100018"}'::jsonb
  ) RETURNING id INTO v_inv5;

  INSERT INTO invoice_lines (
    workspace_id, invoice_id, position, description,
    quantity, unit_code, unit_price_ht_minor, discount_percent, discount_amount_ht_minor,
    vat_rule_id, vat_rate_snapshot, vat_category_code,
    line_subtotal_ht_minor, line_vat_preview_minor, line_total_ttc_preview_minor
  ) VALUES (
    v_ws, v_inv5, 1, 'Accompagnement comptable et reporting — Avril 2026',
    1, 'C62', 450000, 0, 0, v_tva20, 20.000, 'S', 450000, 90000, 540000
  );

  INSERT INTO invoice_tax_breakdowns (
    workspace_id, invoice_id, vat_rule_id, vat_category_code, vat_rate,
    taxable_base_ht_minor, vat_amount_minor
  ) VALUES (v_ws, v_inv5, v_tva20, 'S', 20.000, 450000, 90000);

  UPDATE invoices SET
    status = 'issued', payment_status = 'paid', number = 'FA-2026-00005',
    amount_paid_minor = 540000,
    document_hash = encode(digest('FA-2026-00005|450000|540000|demo-ext', 'sha256'), 'hex'),
    issued_at = '2026-04-10T09:00:00Z'::timestamptz, issued_by = v_user
  WHERE id = v_inv5;

  -- FA-2026-00006 TECHNO PARTNERS 3200 HT UNPAID

  INSERT INTO invoices (
    workspace_id, created_by, contact_id, document_type, provisional_ref,
    original_invoice_id, status, payment_status, einvoice_status,
    issue_date, delivery_or_service_date, due_date, currency, operation_category,
    subtotal_ht_minor, vat_total_minor, total_ttc_minor,
    deposits_deducted_ttc_minor, net_to_pay_ttc_minor, amount_paid_minor,
    late_penalty_rate, recovery_indemnity_minor, discount_terms,
    vat_exemption_mention, vat_on_debits_mention, issuer_snapshot, customer_snapshot
  ) VALUES (
    v_ws, v_user, v_c_techno, 'standard_invoice', 'DEV-2026-0006',
    NULL, 'draft', 'unpaid', 'not_applicable',
    '2026-04-25', '2026-04-25', '2026-05-25', 'EUR', 'services',
    320000, 64000, 384000, 0, 384000, 0,
    15.000, 4000, 'Pas d''escompte pour paiement anticipe',
    NULL, false,
    '{"legalName":"Haxatax Conseil","siren":"732829320","siret":"73282932000012"}'::jsonb,
    '{"legalName":"TECHNO PARTNERS SAS","siren":"820134752","siret":"82013475200019"}'::jsonb
  ) RETURNING id INTO v_inv6;

  INSERT INTO invoice_lines (
    workspace_id, invoice_id, position, description,
    quantity, unit_code, unit_price_ht_minor, discount_percent, discount_amount_ht_minor,
    vat_rule_id, vat_rate_snapshot, vat_category_code,
    line_subtotal_ht_minor, line_vat_preview_minor, line_total_ttc_preview_minor
  ) VALUES (
    v_ws, v_inv6, 1, 'Formation ERP et integration donnees — Avril 2026',
    1, 'C62', 320000, 0, 0, v_tva20, 20.000, 'S', 320000, 64000, 384000
  );

  INSERT INTO invoice_tax_breakdowns (
    workspace_id, invoice_id, vat_rule_id, vat_category_code, vat_rate,
    taxable_base_ht_minor, vat_amount_minor
  ) VALUES (v_ws, v_inv6, v_tva20, 'S', 20.000, 320000, 64000);

  UPDATE invoices SET
    status = 'issued', payment_status = 'unpaid', number = 'FA-2026-00006',
    document_hash = encode(digest('FA-2026-00006|320000|384000|demo-ext', 'sha256'), 'hex'),
    issued_at = '2026-04-25T11:00:00Z'::timestamptz, issued_by = v_user
  WHERE id = v_inv6;

  -- Draft MARTIN 6000 HT

  INSERT INTO invoices (
    workspace_id, created_by, contact_id, document_type, provisional_ref,
    status, payment_status, einvoice_status,
    issue_date, delivery_or_service_date, due_date, currency, operation_category,
    subtotal_ht_minor, vat_total_minor, total_ttc_minor,
    deposits_deducted_ttc_minor, net_to_pay_ttc_minor, amount_paid_minor,
    late_penalty_rate, recovery_indemnity_minor, discount_terms,
    vat_exemption_mention, vat_on_debits_mention
  ) VALUES (
    v_ws, v_user, v_c_martin, 'standard_invoice', 'DEV-2026-0007',
    'draft', 'unpaid', 'not_applicable',
    '2026-05-01', '2026-04-30', '2026-05-31', 'EUR', 'services',
    600000, 120000, 720000, 0, 720000, 0,
    15.000, 4000, 'Pas d''escompte pour paiement anticipe',
    NULL, false
  ) RETURNING id INTO v_inv7;

  INSERT INTO invoice_lines (
    workspace_id, invoice_id, position, description,
    quantity, unit_code, unit_price_ht_minor, discount_percent, discount_amount_ht_minor,
    vat_rule_id, vat_rate_snapshot, vat_category_code,
    line_subtotal_ht_minor, line_vat_preview_minor, line_total_ttc_preview_minor
  ) VALUES (
    v_ws, v_inv7, 1, 'Developpement module reporting BI — Mai 2026',
    1, 'C62', 600000, 0, 0, v_tva20, 20.000, 'S', 600000, 120000, 720000
  );

  -- ── Expenses ─────────────────────────────────────────────────────────────────
  -- EXP Loyer Janvier INFRA 1500 HT posted

  INSERT INTO expenses (
    workspace_id, created_by, supplier_contact_id, status,
    expense_date, due_date, currency,
    subtotal_ht_minor, vat_total_minor, vat_deductible_minor,
    total_ttc_minor, amount_paid_minor, supplier_invoice_ref
  ) VALUES (
    v_ws, v_user, v_c_infra, 'posted',
    '2026-01-31', '2026-02-03', 'EUR',
    150000, 30000, 30000, 180000, 180000, 'INF-2026-0101'
  ) RETURNING id INTO v_exp3;

  INSERT INTO expense_lines (
    workspace_id, expense_id, position, description,
    accounting_account_id, vat_rule_id, vat_rate, deductibility_ratio,
    amount_ht_minor, vat_total_minor, vat_deductible_minor,
    vat_non_deductible_minor, amount_ttc_minor
  ) VALUES (
    v_ws, v_exp3, 1, 'Loyer bureau — Janvier 2026',
    v_a613, v_tva20, 20.000, 1.0000,
    150000, 30000, 30000, 0, 180000
  );

  -- EXP Loyer Fevrier INFRA 1500 HT posted

  INSERT INTO expenses (
    workspace_id, created_by, supplier_contact_id, status,
    expense_date, due_date, currency,
    subtotal_ht_minor, vat_total_minor, vat_deductible_minor,
    total_ttc_minor, amount_paid_minor, supplier_invoice_ref
  ) VALUES (
    v_ws, v_user, v_c_infra, 'posted',
    '2026-02-28', '2026-03-03', 'EUR',
    150000, 30000, 30000, 180000, 180000, 'INF-2026-0201'
  ) RETURNING id INTO v_exp4;

  INSERT INTO expense_lines (
    workspace_id, expense_id, position, description,
    accounting_account_id, vat_rule_id, vat_rate, deductibility_ratio,
    amount_ht_minor, vat_total_minor, vat_deductible_minor,
    vat_non_deductible_minor, amount_ttc_minor
  ) VALUES (
    v_ws, v_exp4, 1, 'Loyer bureau — Fevrier 2026',
    v_a613, v_tva20, 20.000, 1.0000,
    150000, 30000, 30000, 0, 180000
  );

  -- EXP Honoraires BERGER 2200 HT posted

  INSERT INTO expenses (
    workspace_id, created_by, supplier_contact_id, status,
    expense_date, due_date, currency,
    subtotal_ht_minor, vat_total_minor, vat_deductible_minor,
    total_ttc_minor, amount_paid_minor, supplier_invoice_ref
  ) VALUES (
    v_ws, v_user, v_c_berger, 'posted',
    '2026-03-31', '2026-04-05', 'EUR',
    220000, 44000, 44000, 264000, 264000, 'BRG-2026-Q1'
  ) RETURNING id INTO v_exp5;

  INSERT INTO expense_lines (
    workspace_id, expense_id, position, description,
    accounting_account_id, vat_rule_id, vat_rate, deductibility_ratio,
    amount_ht_minor, vat_total_minor, vat_deductible_minor,
    vat_non_deductible_minor, amount_ttc_minor
  ) VALUES (
    v_ws, v_exp5, 1, 'Honoraires de revision comptable — Q1 2026',
    v_a622, v_tva20, 20.000, 1.0000,
    220000, 44000, 44000, 0, 264000
  );

  -- EXP Telephonie FOURNISOFT 120 HT posted

  INSERT INTO expenses (
    workspace_id, created_by, supplier_contact_id, status,
    expense_date, due_date, currency,
    subtotal_ht_minor, vat_total_minor, vat_deductible_minor,
    total_ttc_minor, amount_paid_minor, supplier_invoice_ref
  ) VALUES (
    v_ws, v_user, v_c_fourni, 'posted',
    '2026-03-10', '2026-04-09', 'EUR',
    12000, 2400, 2400, 14400, 14400, 'FOUR-2026-0310'
  ) RETURNING id INTO v_exp6;

  INSERT INTO expense_lines (
    workspace_id, expense_id, position, description,
    accounting_account_id, vat_rule_id, vat_rate, deductibility_ratio,
    amount_ht_minor, vat_total_minor, vat_deductible_minor,
    vat_non_deductible_minor, amount_ttc_minor
  ) VALUES (
    v_ws, v_exp6, 1, 'Abonnement telephonie et internet — Mars 2026',
    v_a626, v_tva20, 20.000, 1.0000,
    12000, 2400, 2400, 0, 14400
  );

  -- ── Bank transactions ────────────────────────────────────────────────────────

  INSERT INTO bank_transactions (
    workspace_id, bank_account_id,
    transaction_date, booking_date, description, counterparty_name,
    amount_minor, currency, fingerprint, status
  ) VALUES
    (v_ws, v_ba, '2026-03-05', '2026-03-05',
     'VIR RECU LEBLANC ARCHITECTES FA-2026-00003', 'LEBLANC ARCHITECTES SAS',
     960000, 'EUR',
     encode(digest('20260305|960000|LEBLANC ARCHITECTES SAS', 'sha256'), 'hex'),
     'matched'),
    (v_ws, v_ba, '2026-04-14', '2026-04-14',
     'VIR RECU DUPONT CONSULTING FA-2026-00005', 'DUPONT CONSULTING SASU',
     540000, 'EUR',
     encode(digest('20260414|540000|DUPONT CONSULTING SASU', 'sha256'), 'hex'),
     'matched'),
    (v_ws, v_ba, '2026-02-03', '2026-02-03',
     'VIR EMIS INFRA-SOLUTIONS INF-2026-0101', 'INFRA-SOLUTIONS SARL',
     -180000, 'EUR',
     encode(digest('20260203|-180000|INFRA-SOLUTIONS SARL-LOC01', 'sha256'), 'hex'),
     'matched'),
    (v_ws, v_ba, '2026-03-03', '2026-03-03',
     'VIR EMIS INFRA-SOLUTIONS INF-2026-0201', 'INFRA-SOLUTIONS SARL',
     -180000, 'EUR',
     encode(digest('20260303|-180000|INFRA-SOLUTIONS SARL-LOC02', 'sha256'), 'hex'),
     'matched'),
    (v_ws, v_ba, '2026-04-05', '2026-04-05',
     'VIR EMIS CABINET BERGER BRG-2026-Q1', 'CABINET BERGER EXPERTISE',
     -264000, 'EUR',
     encode(digest('20260405|-264000|CABINET BERGER EXPERTISE', 'sha256'), 'hex'),
     'matched'),
    (v_ws, v_ba, '2026-03-10', '2026-03-10',
     'PRLV FOURNISOFT FOUR-2026-0310', 'FOURNISOFT SARL',
     -14400, 'EUR',
     encode(digest('20260310|-14400|FOURNISOFT SARL-TEL', 'sha256'), 'hex'),
     'matched'),
    (v_ws, v_ba, '2026-02-28', '2026-02-28',
     'FRAIS TENUE COMPTE FEVRIER 2026', 'BNP PARIBAS',
     -2500, 'EUR',
     encode(digest('20260228|-2500|BNP PARIBAS-FEV', 'sha256'), 'hex'),
     'unmatched'),
    (v_ws, v_ba, '2026-03-31', '2026-03-31',
     'FRAIS TENUE COMPTE MARS 2026', 'BNP PARIBAS',
     -2500, 'EUR',
     encode(digest('20260331|-2500|BNP PARIBAS-MAR', 'sha256'), 'hex'),
     'unmatched')
  ON CONFLICT (workspace_id, bank_account_id, fingerprint) DO NOTHING;

  -- ── Journal entries ───────────────────────────────────────────────────────────
  -- VE-2026-00003 FA-2026-00003 LEBLANC

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jve, v_per,
    'VE-2026-00003', '2026-03-01', 'FA-2026-00003', '2026-03-01',
    'Facture FA-2026-00003 — LEBLANC ARCHITECTES SAS',
    'posted', 'invoice', v_inv3,
    '2026-03-01', '2026-03-01T09:00:00Z', v_user,
    v_h_ve,
    encode(digest('VE-2026-00003|invoice|960000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je5;

  v_h_ve := encode(digest('VE-2026-00003|invoice|960000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je5, 1, v_a411, v_c_leblanc, 'C0003', 'LEBLANC ARCHITECTES SAS',
     'Facture FA-2026-00003', 960000, 0, 'EUR'),
    (v_ws, v_je5, 2, v_a706, NULL, NULL, NULL,
     'Mission conseil transformation digitale', 0, 800000, 'EUR'),
    (v_ws, v_je5, 3, v_a4571, NULL, NULL, NULL,
     'TVA collectee 20 %', 0, 160000, 'EUR');

  -- VE-2026-00004 FA-2026-00004 NEXALIA

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jve, v_per,
    'VE-2026-00004', '2026-03-15', 'FA-2026-00004', '2026-03-15',
    'Facture FA-2026-00004 — NEXALIA GROUP SA',
    'posted', 'invoice', v_inv4,
    '2026-03-15', '2026-03-15T10:00:00Z', v_user,
    v_h_ve,
    encode(digest('VE-2026-00004|invoice|1440000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je6;

  v_h_ve := encode(digest('VE-2026-00004|invoice|1440000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je6, 1, v_a411, v_c_nexalia, 'C0004', 'NEXALIA GROUP SA',
     'Facture FA-2026-00004', 1440000, 0, 'EUR'),
    (v_ws, v_je6, 2, v_a706, NULL, NULL, NULL,
     'Audit et restructuration SI', 0, 1200000, 'EUR'),
    (v_ws, v_je6, 3, v_a4571, NULL, NULL, NULL,
     'TVA collectee 20 %', 0, 240000, 'EUR');

  -- VE-2026-00005 FA-2026-00005 DUPONT

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jve, v_per,
    'VE-2026-00005', '2026-04-10', 'FA-2026-00005', '2026-04-10',
    'Facture FA-2026-00005 — DUPONT CONSULTING SASU',
    'posted', 'invoice', v_inv5,
    '2026-04-10', '2026-04-10T09:00:00Z', v_user,
    v_h_ve,
    encode(digest('VE-2026-00005|invoice|540000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je7;

  v_h_ve := encode(digest('VE-2026-00005|invoice|540000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je7, 1, v_a411, v_c_dupont, 'C0001', 'DUPONT CONSULTING SASU',
     'Facture FA-2026-00005', 540000, 0, 'EUR'),
    (v_ws, v_je7, 2, v_a706, NULL, NULL, NULL,
     'Accompagnement comptable et reporting', 0, 450000, 'EUR'),
    (v_ws, v_je7, 3, v_a4571, NULL, NULL, NULL,
     'TVA collectee 20 %', 0, 90000, 'EUR');

  -- VE-2026-00006 FA-2026-00006 TECHNO PARTNERS

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jve, v_per,
    'VE-2026-00006', '2026-04-25', 'FA-2026-00006', '2026-04-25',
    'Facture FA-2026-00006 — TECHNO PARTNERS SAS',
    'posted', 'invoice', v_inv6,
    '2026-04-25', '2026-04-25T11:00:00Z', v_user,
    v_h_ve,
    encode(digest('VE-2026-00006|invoice|384000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je8;

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je8, 1, v_a411, v_c_techno, 'C0005', 'TECHNO PARTNERS SAS',
     'Facture FA-2026-00006', 384000, 0, 'EUR'),
    (v_ws, v_je8, 2, v_a706, NULL, NULL, NULL,
     'Formation ERP et integration donnees', 0, 320000, 'EUR'),
    (v_ws, v_je8, 3, v_a4571, NULL, NULL, NULL,
     'TVA collectee 20 %', 0, 64000, 'EUR');

  -- BQ-2026-00002 encaissement LEBLANC

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jbq, v_per,
    'BQ-2026-00002', '2026-03-05', 'VIR-20260305-LEBLANC', '2026-03-05',
    'Reglement FA-2026-00003 — LEBLANC ARCHITECTES SAS',
    'posted', 'payment', v_inv3,
    '2026-03-05', '2026-03-05T14:00:00Z', v_user,
    v_h_bq,
    encode(digest('BQ-2026-00002|payment|960000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je9;

  v_h_bq := encode(digest('BQ-2026-00002|payment|960000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je9, 1, v_a512, NULL, NULL, NULL,
     'Virement recu LEBLANC ARCHITECTES', 960000, 0, 'EUR'),
    (v_ws, v_je9, 2, v_a411, v_c_leblanc, 'C0003', 'LEBLANC ARCHITECTES SAS',
     'Reglement facture FA-2026-00003', 0, 960000, 'EUR');

  -- BQ-2026-00003 encaissement DUPONT

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jbq, v_per,
    'BQ-2026-00003', '2026-04-14', 'VIR-20260414-DUPONT', '2026-04-14',
    'Reglement FA-2026-00005 — DUPONT CONSULTING SASU',
    'posted', 'payment', v_inv5,
    '2026-04-14', '2026-04-14T10:00:00Z', v_user,
    v_h_bq,
    encode(digest('BQ-2026-00003|payment|540000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je10;

  v_h_bq := encode(digest('BQ-2026-00003|payment|540000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je10, 1, v_a512, NULL, NULL, NULL,
     'Virement recu DUPONT CONSULTING', 540000, 0, 'EUR'),
    (v_ws, v_je10, 2, v_a411, v_c_dupont, 'C0001', 'DUPONT CONSULTING SASU',
     'Reglement facture FA-2026-00005', 0, 540000, 'EUR');

  -- BQ-2026-00004 paiement loyer Janvier INFRA

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jbq, v_per,
    'BQ-2026-00004', '2026-02-03', 'VIR-20260203-INFRA', '2026-02-03',
    'Paiement loyer Janvier — INFRA-SOLUTIONS SARL',
    'posted', 'payment', v_exp3,
    '2026-02-03', '2026-02-03T11:00:00Z', v_user,
    v_h_bq,
    encode(digest('BQ-2026-00004|payment|180000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je11;

  v_h_bq := encode(digest('BQ-2026-00004|payment|180000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je11, 1, v_a401, v_c_infra, 'F0002', 'INFRA-SOLUTIONS SARL',
     'Reglement loyer Janvier 2026', 180000, 0, 'EUR'),
    (v_ws, v_je11, 2, v_a512, NULL, NULL, NULL,
     'Virement emis INFRA-SOLUTIONS', 0, 180000, 'EUR');

  -- BQ-2026-00005 paiement loyer Fevrier INFRA

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jbq, v_per,
    'BQ-2026-00005', '2026-03-03', 'VIR-20260303-INFRA', '2026-03-03',
    'Paiement loyer Fevrier — INFRA-SOLUTIONS SARL',
    'posted', 'payment', v_exp4,
    '2026-03-03', '2026-03-03T11:00:00Z', v_user,
    v_h_bq,
    encode(digest('BQ-2026-00005|payment|180000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je12;

  v_h_bq := encode(digest('BQ-2026-00005|payment|180000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je12, 1, v_a401, v_c_infra, 'F0002', 'INFRA-SOLUTIONS SARL',
     'Reglement loyer Fevrier 2026', 180000, 0, 'EUR'),
    (v_ws, v_je12, 2, v_a512, NULL, NULL, NULL,
     'Virement emis INFRA-SOLUTIONS', 0, 180000, 'EUR');

  -- BQ-2026-00006 paiement honoraires BERGER

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jbq, v_per,
    'BQ-2026-00006', '2026-04-05', 'VIR-20260405-BERGER', '2026-04-05',
    'Paiement honoraires Q1 — CABINET BERGER EXPERTISE',
    'posted', 'payment', v_exp5,
    '2026-04-05', '2026-04-05T09:00:00Z', v_user,
    v_h_bq,
    encode(digest('BQ-2026-00006|payment|264000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je13;

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je13, 1, v_a401, v_c_berger, 'F0003', 'CABINET BERGER EXPERTISE',
     'Reglement honoraires Q1 2026', 264000, 0, 'EUR'),
    (v_ws, v_je13, 2, v_a512, NULL, NULL, NULL,
     'Virement emis CABINET BERGER EXPERTISE', 0, 264000, 'EUR');

  -- AC-2026-00002 loyer Janvier

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jac, v_per,
    'AC-2026-00002', '2026-01-31', 'INF-2026-0101', '2026-01-31',
    'Loyer bureau Janvier 2026 — INFRA-SOLUTIONS SARL',
    'posted', 'expense', v_exp3,
    '2026-01-31', '2026-01-31T11:00:00Z', v_user,
    v_h_ac,
    encode(digest('AC-2026-00002|expense|180000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je14;

  v_h_ac := encode(digest('AC-2026-00002|expense|180000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je14, 1, v_a613, NULL, NULL, NULL,
     'Loyer bureau — Janvier 2026', 150000, 0, 'EUR'),
    (v_ws, v_je14, 2, v_a4456, NULL, NULL, NULL,
     'TVA deductible 20 %', 30000, 0, 'EUR'),
    (v_ws, v_je14, 3, v_a401, v_c_infra, 'F0002', 'INFRA-SOLUTIONS SARL',
     'Fournisseur INFRA-SOLUTIONS INF-2026-0101', 0, 180000, 'EUR');

  -- AC-2026-00003 loyer Fevrier

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jac, v_per,
    'AC-2026-00003', '2026-02-28', 'INF-2026-0201', '2026-02-28',
    'Loyer bureau Fevrier 2026 — INFRA-SOLUTIONS SARL',
    'posted', 'expense', v_exp4,
    '2026-02-28', '2026-02-28T11:00:00Z', v_user,
    v_h_ac,
    encode(digest('AC-2026-00003|expense|180000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je15;

  v_h_ac := encode(digest('AC-2026-00003|expense|180000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je15, 1, v_a613, NULL, NULL, NULL,
     'Loyer bureau — Fevrier 2026', 150000, 0, 'EUR'),
    (v_ws, v_je15, 2, v_a4456, NULL, NULL, NULL,
     'TVA deductible 20 %', 30000, 0, 'EUR'),
    (v_ws, v_je15, 3, v_a401, v_c_infra, 'F0002', 'INFRA-SOLUTIONS SARL',
     'Fournisseur INFRA-SOLUTIONS INF-2026-0201', 0, 180000, 'EUR');

  -- AC-2026-00004 honoraires BERGER

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jac, v_per,
    'AC-2026-00004', '2026-03-31', 'BRG-2026-Q1', '2026-03-31',
    'Honoraires de revision Q1 2026 — CABINET BERGER EXPERTISE',
    'posted', 'expense', v_exp5,
    '2026-03-31', '2026-03-31T16:00:00Z', v_user,
    v_h_ac,
    encode(digest('AC-2026-00004|expense|264000|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je16;

  v_h_ac := encode(digest('AC-2026-00004|expense|264000|demo-ext', 'sha256'), 'hex');

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je16, 1, v_a622, NULL, NULL, NULL,
     'Honoraires expertise comptable Q1 2026', 220000, 0, 'EUR'),
    (v_ws, v_je16, 2, v_a4456, NULL, NULL, NULL,
     'TVA deductible 20 %', 44000, 0, 'EUR'),
    (v_ws, v_je16, 3, v_a401, v_c_berger, 'F0003', 'CABINET BERGER EXPERTISE',
     'Fournisseur BERGER BRG-2026-Q1', 0, 264000, 'EUR');

  -- AC-2026-00005 telephonie FOURNISOFT

  INSERT INTO journal_entries (
    workspace_id, journal_id, period_id,
    entry_number, entry_date, piece_ref, piece_date, description,
    status, source_type, source_id,
    validated_at, posted_at, posted_by,
    previous_entry_hash, entry_hash, created_by
  ) VALUES (
    v_ws, v_jac, v_per,
    'AC-2026-00005', '2026-03-10', 'FOUR-2026-0310', '2026-03-10',
    'Abonnement telephonie Mars 2026 — FOURNISOFT SARL',
    'posted', 'expense', v_exp6,
    '2026-03-10', '2026-03-10T09:00:00Z', v_user,
    v_h_ac,
    encode(digest('AC-2026-00005|expense|14400|demo-ext', 'sha256'), 'hex'),
    v_user
  ) RETURNING id INTO v_je17;

  INSERT INTO journal_entry_lines (
    workspace_id, entry_id, position,
    account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
    description, debit_minor, credit_minor, currency_code
  ) VALUES
    (v_ws, v_je17, 1, v_a626, NULL, NULL, NULL,
     'Abonnement telephonie et internet — Mars 2026', 12000, 0, 'EUR'),
    (v_ws, v_je17, 2, v_a4456, NULL, NULL, NULL,
     'TVA deductible 20 %', 2400, 0, 'EUR'),
    (v_ws, v_je17, 3, v_a401, v_c_fourni, 'F0001', 'FOURNISOFT SARL',
     'Fournisseur FOURNISOFT FOUR-2026-0310', 0, 14400, 'EUR');

  -- OD-2026-00001 dotation amortissement materiel informatique Q1

  IF v_jod IS NOT NULL AND v_a6800 IS NOT NULL AND v_a2183 IS NOT NULL THEN
    INSERT INTO journal_entries (
      workspace_id, journal_id, period_id,
      entry_number, entry_date, piece_ref, piece_date, description,
      status, source_type,
      validated_at, posted_at, posted_by,
      previous_entry_hash, entry_hash, created_by
    ) VALUES (
      v_ws, v_jod, v_per,
      'OD-2026-00001', '2026-03-31', 'DAM-Q1-2026', '2026-03-31',
      'Dotation amortissement materiel informatique Q1 2026',
      'posted', 'manual',
      '2026-03-31', '2026-03-31T17:00:00Z', v_user,
      NULL,
      encode(digest('OD-2026-00001|manual|75000|demo-ext', 'sha256'), 'hex'),
      v_user
    ) RETURNING id INTO v_je18;

    INSERT INTO journal_entry_lines (
      workspace_id, entry_id, position,
      account_id, contact_id, auxiliary_account_code, auxiliary_account_label,
      description, debit_minor, credit_minor, currency_code
    ) VALUES
      (v_ws, v_je18, 1, v_a6800, NULL, NULL, NULL,
       'Dotation amortissement materiel informatique Q1 2026', 75000, 0, 'EUR'),
      (v_ws, v_je18, 2, v_a2183, NULL, NULL, NULL,
       'Amortissement cumule MacBook Pro', 0, 75000, 'EUR');
  END IF;

  RAISE NOTICE '[demo_ext] Done: +5 contacts, +5 invoices (4 issued + 1 draft), +4 expenses (posted), +8 bank txs, +14 journal entries.';

END;
$$;
