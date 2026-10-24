-- =============================================================================
-- Official French & EU Tax Rules Seed (DGFiP / CGI / EN 16931 Factur-X)
-- Includes Mainland France rates (20%, 10%, 5.5%, 2.1%), Micro-entreprise
-- Franchise en base (Art. 293 B CGI), Intra-EU B2B Reverse Charge (Art. 283-2),
-- Intra-EU Supply (Art. 262 ter I), Export Outside EU (Art. 262 I), and DOM/Corsica.
-- =============================================================================

INSERT INTO tax_rules (
  workspace_id,
  jurisdiction,
  code,
  label,
  rate,
  vat_category_code,
  exemption_reason_code,
  legal_mention,
  collected_account_debits_code,
  collected_account_pending_cash_code,
  deductible_account_code,
  valid_from
) VALUES
  (
    NULL, 'FR', 'FR_TVA_20',
    'TVA normale 20 % (France métropolitaine)',
    20.000, 'S', NULL, NULL,
    '445710', '445740', '445660', '2025-01-01'
  ),
  (
    NULL, 'FR', 'FR_TVA_10',
    'TVA intermédiaire 10 %',
    10.000, 'S', NULL, NULL,
    '445712', '445742', '445660', '2025-01-01'
  ),
  (
    NULL, 'FR', 'FR_TVA_5_5',
    'TVA réduite 5,5 %',
    5.500, 'S', NULL, NULL,
    '445711', '445741', '445660', '2025-01-01'
  ),
  (
    NULL, 'FR', 'FR_TVA_2_1',
    'TVA super-réduite 2,1 %',
    2.100, 'S', NULL, NULL,
    '445713', '445743', '445660', '2025-01-01'
  ),
  (
    NULL, 'FR', 'FR_DOM_8_5',
    'TVA normale DOM 8,5 % (Guadeloupe, Martinique, La Réunion)',
    8.500, 'S', NULL, NULL,
    '445714', '445744', '445660', '2025-01-01'
  ),
  (
    NULL, 'FR', 'FR_FRANCHISE_293B',
    'Franchise en base de TVA (0 % — Micro-entreprise / Art. 293 B CGI)',
    0.000, 'E', 'VATEX-EU-FR-FRANCHISE',
    'TVA non applicable, art. 293 B du CGI',
    '445710', '445740', '445660', '2025-01-01'
  ),
  (
    NULL, 'EU', 'EU_B2B_SERVICES_REVERSE_CHARGE',
    'Autoliquidation B2B Services UE (0 % — Art. 283-2 du CGI / Dir. 2006/112/CE)',
    0.000, 'AE', 'VATEX-EU-AE',
    'Autoliquidation de la TVA par le preneur — Article 283-2 du CGI / Article 196 de la directive 2006/112/CE',
    '445710', '445740', '445662', '2025-01-01'
  ),
  (
    NULL, 'EU', 'EU_B2B_GOODS_EXEMPT',
    'Livraison intracommunautaire de biens exonérée (0 % — Art. 262 ter I du CGI)',
    0.000, 'K', 'VATEX-EU-IC',
    'Exonération de TVA — Livraison intracommunautaire, article 262 ter I du CGI',
    '445710', '445740', '445662', '2025-01-01'
  ),
  (
    NULL, 'FR', 'EXPORT_OUTSIDE_EU',
    'Exportation hors Union Européenne exonérée (0 % — Art. 262 I du CGI)',
    0.000, 'G', 'VATEX-EU-G',
    'Exonération de TVA — Exportation hors UE, article 262 I du CGI',
    '445710', '445740', '445660', '2025-01-01'
  )
ON CONFLICT (workspace_id, code) DO NOTHING;
