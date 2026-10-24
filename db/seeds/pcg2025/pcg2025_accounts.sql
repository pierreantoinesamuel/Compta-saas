-- =============================================================================
-- Official PCG 2025 (Règlement ANC n° 2022-06) Account Seed Helper Function
-- Seeds the full PCG 2025 chart of accounts and standard French journals
-- (AN, VE, AC, BQ, OD, CA) for a newly created workspace.
-- Note: Account 79 ("Transferts de charges") is abolished in PCG 2025.
-- =============================================================================

CREATE OR REPLACE FUNCTION seed_workspace_pcg2025(p_workspace_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  -- 1. Standard French Journals
  INSERT INTO journals (workspace_id, code, label, journal_type, is_active)
  VALUES
    (p_workspace_id, 'AN', 'Journal des À-Nouveaux', 'opening', true),
    (p_workspace_id, 'VE', 'Journal des Ventes', 'sales', true),
    (p_workspace_id, 'AC', 'Journal des Achats', 'purchases', true),
    (p_workspace_id, 'BQ', 'Journal de Banque', 'bank', true),
    (p_workspace_id, 'OD', 'Journal des Opérations Diverses', 'miscellaneous', true),
    (p_workspace_id, 'CA', 'Journal de Caisse', 'cash', true)
  ON CONFLICT (workspace_id, code) DO NOTHING;

  -- 2. PCG 2025 Accounts (Règlement ANC n° 2022-06)
  INSERT INTO accounts (
    workspace_id, chart_version, account_code, account_label, account_class,
    account_type, requires_auxiliary, is_letterable, is_system_account, is_active
  )
  VALUES
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '101000', 'Capital social', 1, 'equity_liability', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '108000', 'Compte de l''exploitant (EI / Micro)', 1, 'equity_liability', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '110000', 'Report à nouveau (solde créditeur)', 1, 'equity_liability', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '119000', 'Report à nouveau (solde débiteur)', 1, 'equity_liability', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '120000', 'Résultat de l''exercice (bénéfice)', 1, 'equity_liability', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '129000', 'Résultat de l''exercice (perte)', 1, 'equity_liability', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '205000', 'Concessions et droits similaires, brevets, licences, logiciels', 2, 'fixed_asset', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '218300', 'Matériel de bureau et matériel informatique', 2, 'fixed_asset', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '401000', 'Fournisseurs — Achats de biens et prestations de services (Collectif)', 4, 'third_party', true, true, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '409100', 'Fournisseurs — Avances et acomptes versés sur commandes', 4, 'third_party', false, true, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '411000', 'Clients — Ventes de biens ou de prestations de services (Collectif)', 4, 'third_party', true, true, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '419100', 'Clients — Avances et acomptes reçus sur commandes (Factures d''acompte)', 4, 'third_party', false, true, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445200', 'TVA due intracommunautaire (Autoliquidation)', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445510', 'TVA à décaisser', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445620', 'TVA déductible sur immobilisations', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445640', 'TVA déductible sur encaissements (en attente de règlement fournisseur)', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445660', 'TVA déductible sur autres biens et services', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445662', 'TVA déductible intracommunautaire', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445670', 'Crédit de TVA à reporter', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445710', 'TVA collectée 20 % (exigible)', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445711', 'TVA collectée 5,5 % (exigible)', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445712', 'TVA collectée 10 % (exigible)', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445713', 'TVA collectée 2,1 % (exigible)', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445714', 'TVA collectée 8,5 % DOM (exigible)', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445740', 'TVA collectée sur encaissements 20 % — En attente d''encaissement', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445741', 'TVA collectée sur encaissements 5,5 % — En attente d''encaissement', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445742', 'TVA collectée sur encaissements 10 % — En attente d''encaissement', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445743', 'TVA collectée sur encaissements 2,1 % — En attente d''encaissement', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '445744', 'TVA collectée sur encaissements 8,5 % DOM — En attente d''encaissement', 4, 'third_party', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '455000', 'Associés — Comptes courants', 4, 'third_party', false, true, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '512100', 'Banque — Compte courant principal', 5, 'financial', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '530000', 'Caisse', 5, 'financial', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '601000', 'Achats stockés — Matières premières et fournitures', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '604000', 'Achats d''études et prestations de services', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '606100', 'Fournitures non stockables (eau, énergie, carburant)', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '606300', 'Fournitures d''entretien et de petit équipement', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '606400', 'Fournitures administratives', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '607000', 'Achats de marchandises', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '613200', 'Locations immobilières', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '613500', 'Locations mobilières et abonnements logiciels SaaS', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '616000', 'Primes d''assurances', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '622600', 'Honoraires (Expert-comptable, avocat, conseil)', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '625100', 'Voyages et déplacements', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '625600', 'Missions et réceptions (restaurants, hébergement)', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '626000', 'Frais postaux et de télécommunications', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '627000', 'Services bancaires et assimilés (frais et commissions)', 6, 'expense', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '649000', 'Remboursements de charges de personnel (PCG 2025)', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '656000', 'Pertes de change sur créances et dettes commerciales (PCG 2025)', 6, 'expense', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '657000', 'Valeurs comptables des immobilisations cédées (PCG 2025)', 6, 'expense', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '658000', 'Charges diverses de gestion courante (écarts de règlement)', 6, 'expense', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '706000', 'Prestations de services', 7, 'revenue', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '707000', 'Ventes de marchandises', 7, 'revenue', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '708000', 'Produits des activités annexes et refacturations de frais', 7, 'revenue', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '709000', 'Rabais, remises et ristournes accordés par l''entreprise', 7, 'revenue', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '756000', 'Gains de change sur créances et dettes commerciales (PCG 2025)', 7, 'revenue', false, false, true, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '757000', 'Produits des cessions d''immobilisations (PCG 2025)', 7, 'revenue', false, false, false, true),
    (p_workspace_id, 'PCG_2025_ANC_2022_06', '758000', 'Indemnités d''assurance et produits divers de gestion courante (PCG 2025)', 7, 'revenue', false, false, true, true)
  ON CONFLICT (workspace_id, account_code) DO NOTHING;
END;
$$;
