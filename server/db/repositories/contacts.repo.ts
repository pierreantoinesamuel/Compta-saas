import { pool } from '../client.js';
import type { ContactRecord } from '../../application/workspaceStore.js';

interface DbContactRow {
  id: string;
  kind: string;
  is_business: boolean;
  tax_zone: string;
  legal_name: string;
  siren: string | null;
  siret: string | null;
  vat_identifier: string | null;
  email: string;
  billing_address: { streetLine1: string; postalCode: string; city: string; countryCode: string };
  customer_auxiliary_code: string | null;
  supplier_auxiliary_code: string | null;
  iban_masked: string | null;
  default_payment_terms_days: number;
  archived_at: string | null;
}

function toContactRecord(r: DbContactRow): ContactRecord {
  return {
    id: r.id,
    kind: r.kind as ContactRecord['kind'],
    isBusiness: r.is_business,
    taxZone: r.tax_zone as ContactRecord['taxZone'],
    legalName: r.legal_name,
    siren: r.siren,
    siret: r.siret,
    vatIdentifier: r.vat_identifier,
    email: r.email,
    billingAddress: r.billing_address,
    customerAuxiliaryCode: r.customer_auxiliary_code,
    supplierAuxiliaryCode: r.supplier_auxiliary_code,
    certifiedIban: r.iban_masked,
    defaultPaymentTermsDays: r.default_payment_terms_days,
    archivedAt: r.archived_at,
  };
}

const CONTACT_COLS = `id, kind, is_business, tax_zone, legal_name, siren, siret, vat_identifier,
  email, billing_address, customer_auxiliary_code, supplier_auxiliary_code,
  iban_masked, default_payment_terms_days, archived_at::TEXT as archived_at`;

export async function getContacts(workspaceId: string): Promise<ContactRecord[]> {
  const { rows } = await pool.query<DbContactRow>(
    `SELECT ${CONTACT_COLS} FROM contacts WHERE workspace_id = $1 ORDER BY legal_name`,
    [workspaceId],
  );
  return rows.map(toContactRecord);
}

export async function getContactById(workspaceId: string, contactId: string): Promise<ContactRecord | null> {
  const { rows } = await pool.query<DbContactRow>(
    `SELECT ${CONTACT_COLS} FROM contacts WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, contactId],
  );
  return rows[0] ? toContactRecord(rows[0]) : null;
}

export async function createContact(
  workspaceId: string,
  userId: string,
  data: Omit<ContactRecord, 'id' | 'archivedAt'>,
): Promise<ContactRecord> {
  const { rows } = await pool.query<DbContactRow>(
    `INSERT INTO contacts (
       workspace_id, created_by, kind, is_business, tax_zone, legal_name, siren, siret,
       vat_identifier, email, billing_address, customer_auxiliary_code,
       supplier_auxiliary_code, iban_masked, default_payment_terms_days
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING ${CONTACT_COLS}`,
    [
      workspaceId, userId, data.kind, data.isBusiness, data.taxZone, data.legalName,
      data.siren ?? null, data.siret ?? null, data.vatIdentifier ?? null, data.email,
      JSON.stringify(data.billingAddress), data.customerAuxiliaryCode ?? null,
      data.supplierAuxiliaryCode ?? null, data.certifiedIban ?? null,
      data.defaultPaymentTermsDays ?? 30,
    ],
  );
  return toContactRecord(rows[0]!);
}

export async function updateContactAuxCodes(
  workspaceId: string,
  contactId: string,
  customerCode: string | null,
  supplierCode: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE contacts SET customer_auxiliary_code = $3, supplier_auxiliary_code = $4, updated_at = NOW()
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, contactId, customerCode, supplierCode],
  );
}

export async function archiveContact(workspaceId: string, contactId: string): Promise<void> {
  await pool.query(
    `UPDATE contacts SET archived_at = NOW(), updated_at = NOW() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, contactId],
  );
}
