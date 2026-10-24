import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from './client.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

function computeFrenchVatNumber(siren: string): string {
  const key = (12 + 3 * (parseInt(siren, 10) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${siren}`;
}

export async function runSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Workspace
    await client.query(
      `INSERT INTO workspaces (
         id, legal_name, trade_name, siren, siret, naf_code, legal_form,
         share_capital_minor, rcs_city, rcs_number, vat_number,
         fiscal_regime, accounting_mode, vat_regime, vat_exigibility,
         registered_address, default_late_penalty_rate,
         default_recovery_indemnity_minor, default_discount_terms,
         subscription_plan, billing_email, data_residency_region, created_at
       ) VALUES (
         $1,'Haxatax Conseil & Technologies SAS','Haxatax',
         '732829320','73282932000074','6201Z','SAS',1000000,
         'Paris','Paris B 732 829 320',$2,
         'REEL_NORMAL','DOUBLE_ENTRY_PCG2025','REEL_NORMAL','ENCAISSEMENTS',
         '{"streetLine1":"14 Rue de la Paix","postalCode":"75002","city":"Paris","countryCode":"FR"}',
         '15.000',4000,'Pas d''escompte pour paiement anticipé',
         'pro','contact@haxatax.fr','eu-west-3',NOW()
       ) ON CONFLICT (id) DO NOTHING`,
      [WORKSPACE_ID, computeFrenchVatNumber('732829320')],
    );

    // 2. Users
    const ownerHash = await bcrypt.hash('owner-test-password', 12);
    const acctHash = await bcrypt.hash('accountant-test-password', 12);

    const ownerResult = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, is_active)
       VALUES ('owner@haxatax.test', $1, 'Owner Haxatax', true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [ownerHash],
    );
    const ownerId: string = ownerResult.rows[0]!.id;

    const acctResult = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, is_active)
       VALUES ('accountant@haxatax.test', $1, 'Camille Laurent', true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [acctHash],
    );
    const accountantId: string = acctResult.rows[0]!.id;

    // 3. Memberships
    await client.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role)
       VALUES ($1,$2,'owner'),($3,$2,'accountant')
       ON CONFLICT (user_id, workspace_id) DO NOTHING`,
      [ownerId, WORKSPACE_ID, accountantId],
    );

    // 4. Journals
    const journals = [
      { code: 'OD', label: 'Opérations Diverses', type: 'general' },
      { code: 'VE', label: 'Journal des Ventes', type: 'sales' },
      { code: 'AC', label: 'Journal des Achats', type: 'purchases' },
      { code: 'BQ', label: 'Journal de Banque', type: 'bank' },
      { code: 'CA', label: 'Journal de Caisse', type: 'cash' },
      { code: 'AN', label: 'À-Nouveaux', type: 'general' },
    ];
    for (const j of journals) {
      await client.query(
        `INSERT INTO journals (workspace_id, code, label, journal_type, is_active)
         VALUES ($1,$2,$3,$4,true) ON CONFLICT (workspace_id, code) DO NOTHING`,
        [WORKSPACE_ID, j.code, j.label, j.type],
      );
    }

    // 5. Accounting period 2026
    await client.query(
      `INSERT INTO accounting_periods (workspace_id, fiscal_year, period_start, period_end, status)
       VALUES ($1, 2026, '2026-01-01', '2026-12-31', 'open')
       ON CONFLICT (workspace_id, fiscal_year) DO NOTHING`,
      [WORKSPACE_ID],
    );

    // 6. PCG 2025 accounts — essential accounts for invoices, expenses, banking, VAT
    const accounts: Array<[string, string, number]> = [
      ['101000', 'Capital social', 1],
      ['401000', 'Fournisseurs', 4],
      ['401100', 'Fournisseurs — comptes généraux', 4],
      ['411000', 'Clients', 4],
      ['411100', 'Clients — comptes généraux', 4],
      ['44566', 'TVA déductible sur biens et services', 4],
      ['44571', 'TVA collectée', 4],
      ['44574', 'TVA collectée en attente (encaissements)', 4],
      ['445810', 'TVA à régulariser', 4],
      ['512000', 'Banques', 5],
      ['512100', 'BNP Paribas', 5],
      ['512200', 'Qonto', 5],
      ['512300', 'Crédit Agricole', 5],
      ['530000', 'Caisse', 5],
      ['601000', 'Achats stockés de matières premières', 6],
      ['606000', 'Achats non stockés de matières et fournitures', 6],
      ['606100', 'Carburant', 6],
      ['612000', 'Redevances de crédit-bail mobilier', 6],
      ['613500', 'Locations de matériel et mobilier', 6],
      ['615000', 'Entretien et réparations', 6],
      ['616000', 'Assurances', 6],
      ['621000', 'Personnel extérieur', 6],
      ['622600', 'Honoraires', 6],
      ['623000', 'Publicité, publications, relations publiques', 6],
      ['625100', 'Voyages et déplacements', 6],
      ['625700', 'Réceptions', 6],
      ['626000', 'Frais postaux et de télécommunications', 6],
      ['641000', 'Rémunérations du personnel', 6],
      ['706000', 'Prestations de services', 7],
      ['707000', 'Ventes de marchandises', 7],
      ['708000', 'Produits des activités annexes', 7],
      ['758000', 'Produits divers de gestion courante', 7],
    ];
    for (const [code, label, cls] of accounts) {
      await client.query(
        `INSERT INTO accounts (workspace_id, account_code, account_label, account_class, is_active)
         VALUES ($1,$2,$3,$4,true) ON CONFLICT (workspace_id, account_code) DO NOTHING`,
        [WORKSPACE_ID, code, label, cls],
      );
    }

    // 7. Tax rules
    const taxRules: Array<[string, string, number, string, boolean]> = [
      ['FR_TVA_20', 'TVA France 20% (taux normal)', 20, 'FR', true],
      ['FR_TVA_10', 'TVA France 10% (taux intermédiaire)', 10, 'FR', false],
      ['FR_TVA_5_5', 'TVA France 5,5% (taux réduit)', 5.5, 'FR', false],
      ['FR_TVA_2_1', 'TVA France 2,1% (taux super-réduit)', 2.1, 'FR', false],
      ['FR_TVA_0', 'Exonéré de TVA (Art. 261 CGI)', 0, 'FR', false],
      ['EU_B2B_SERVICES_REVERSE_CHARGE', 'Auto-liquidation TVA B2B UE (Art. 283-2)', 0, 'EU', false],
      ['EXPORT_0', 'Exonéré TVA export (Art. 262 CGI)', 0, 'EXPORT', false],
    ];
    for (const [code, label, rate, zone, isDefault] of taxRules) {
      await client.query(
        `INSERT INTO tax_rules (workspace_id, code, label, rate_percent, tax_zone, is_active, is_default)
         VALUES ($1,$2,$3,$4,$5,true,$6)
         ON CONFLICT (workspace_id, code) DO NOTHING`,
        [WORKSPACE_ID, code, label, rate, zone, isDefault],
      );
    }

    // 8. Bank account
    const { rows: journalRows } = await client.query<{ id: string }>(
      `SELECT id FROM journals WHERE workspace_id = $1 AND code = 'BQ'`,
      [WORKSPACE_ID],
    );
    const { rows: accountRows } = await client.query<{ id: string }>(
      `SELECT id FROM accounts WHERE workspace_id = $1 AND account_code = '512000'`,
      [WORKSPACE_ID],
    );
    if (journalRows[0] && accountRows[0]) {
      await client.query(
        `INSERT INTO bank_accounts (workspace_id, display_name, bank_name, iban_masked, bic, currency, ledger_account_id, journal_id, provider)
         VALUES ($1,'Compte Principal','BNP Paribas','FR76 XXXX XXXX XXXX XXXX XXXX XXX','BNPAFRPP','EUR',$2,$3,'manual_csv')
         ON CONFLICT DO NOTHING`,
        [WORKSPACE_ID, accountRows[0].id, journalRows[0].id],
      );
    }

    // 9. Demo contacts
    const demoContacts: Array<{
      kind: string; taxZone: string; legalName: string;
      siren: string | null; siret: string | null; email: string;
      city: string; postalCode: string; street: string; countryCode: string;
      customerAux?: string; supplierAux?: string;
    }> = [
      {
        kind: 'customer', taxZone: 'DOMESTIC_FR',
        legalName: 'Automobiles Peugeot SA', siren: '552100554', siret: '55210055400013',
        email: 'comptabilite@peugeot-demo.fr', city: 'Rueil-Malmaison', postalCode: '92500',
        street: '7 Rue Henri Sainte-Claire Deville', countryCode: 'FR', customerAux: '41100001',
      },
      {
        kind: 'customer', taxZone: 'DOMESTIC_FR',
        legalName: 'Doctolib SAS', siren: '803461022', siret: '80346102200041',
        email: 'compta@doctolib-demo.fr', city: 'Levallois-Perret', postalCode: '92300',
        street: '54 Quai de Dion Bouton', countryCode: 'FR', customerAux: '41100002',
      },
      {
        kind: 'customer', taxZone: 'INTRA_EU',
        legalName: 'Google Cloud EMEA Ltd', siren: null, siret: null,
        email: 'billing-eu@google-demo.com', city: 'Dublin', postalCode: 'D02',
        street: 'Gordon House, Barrow St', countryCode: 'IE', customerAux: '41100003',
      },
      {
        kind: 'supplier', taxZone: 'DOMESTIC_FR',
        legalName: 'Scaleway SAS', siren: '433115820', siret: '43311582000048',
        email: 'billing@scaleway-demo.fr', city: 'Paris', postalCode: '75010',
        street: "8 Rue de la Ville l'Evêque", countryCode: 'FR', supplierAux: '40100001',
      },
      {
        kind: 'supplier', taxZone: 'DOMESTIC_FR',
        legalName: 'SNCF Voyageurs SA', siren: '519037584', siret: '51903758400010',
        email: 'factures@sncf-demo.fr', city: 'Paris', postalCode: '75009',
        street: '2 Place aux Étoiles', countryCode: 'FR', supplierAux: '40100002',
      },
    ];

    for (const c of demoContacts) {
      await client.query(
        `INSERT INTO contacts (workspace_id, created_by, kind, is_business, tax_zone, legal_name, siren, siret,
           email, billing_address, customer_auxiliary_account, supplier_auxiliary_account, default_payment_terms_days)
         VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,30)
         ON CONFLICT DO NOTHING`,
        [
          WORKSPACE_ID, ownerId, c.kind, c.taxZone, c.legalName,
          c.siren ?? null, c.siret ?? null, c.email,
          JSON.stringify({ streetLine1: c.street, postalCode: c.postalCode, city: c.city, countryCode: c.countryCode }),
          c.customerAux ?? null, c.supplierAux ?? null,
        ],
      );
    }

    await client.query('COMMIT');
    console.log('[DB] Seed complete for workspace', WORKSPACE_ID);
    console.log('[DB] Owner login: owner@haxatax.test / owner-test-password');
    console.log('[DB] Accountant login: accountant@haxatax.test / accountant-test-password');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[DB] Seed failed:', err);
      process.exit(1);
    });
}
