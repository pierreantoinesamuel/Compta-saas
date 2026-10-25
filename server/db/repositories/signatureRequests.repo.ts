import type pg from 'pg';
import { pool } from '../client.js';

export interface SignatureRequestRow {
  id: string;
  workspaceId: string;
  documentType: string;
  documentId: string;
  signerName: string;
  signerEmail: string;
  token: string;
  tokenExpiresAt: string;
  status: 'pending' | 'viewed' | 'signed' | 'expired' | 'cancelled';
  signedAt: string | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  documentHashBefore: string;
  documentHashAfter: string | null;
  auditTrail: Array<{ action: string; timestamp: string; ip?: string; userAgent?: string }>;
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): SignatureRequestRow {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    documentType: r.document_type as string,
    documentId: r.document_id as string,
    signerName: r.signer_name as string,
    signerEmail: r.signer_email as string,
    token: r.token as string,
    tokenExpiresAt: r.token_expires_at as string,
    status: r.status as SignatureRequestRow['status'],
    signedAt: r.signed_at as string | null,
    signerIp: r.signer_ip as string | null,
    signerUserAgent: r.signer_user_agent as string | null,
    documentHashBefore: r.document_hash_before as string,
    documentHashAfter: r.document_hash_after as string | null,
    auditTrail: (r.audit_trail as SignatureRequestRow['auditTrail']) ?? [],
    createdAt: r.created_at as string,
  };
}

export async function createSignatureRequest(
  client: pg.PoolClient,
  workspaceId: string,
  input: {
    documentType: string;
    documentId: string;
    signerName: string;
    signerEmail: string;
    token: string;
    tokenExpiresAt: string;
    documentHashBefore: string;
  },
): Promise<SignatureRequestRow> {
  const { rows } = await client.query(
    `INSERT INTO signature_requests (
       workspace_id, document_type, document_id, signer_name, signer_email,
       token, token_expires_at, document_hash_before
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::TIMESTAMPTZ,$8)
     RETURNING *`,
    [
      workspaceId, input.documentType, input.documentId, input.signerName, input.signerEmail,
      input.token, input.tokenExpiresAt, input.documentHashBefore,
    ],
  );
  return mapRow(rows[0] as Record<string, unknown>);
}

export async function getSignatureRequest(token: string): Promise<SignatureRequestRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM signature_requests WHERE token = $1`,
    [token],
  );
  return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
}

export async function getSignatureRequestsByDocument(
  workspaceId: string,
  documentId: string,
): Promise<SignatureRequestRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM signature_requests WHERE workspace_id = $1 AND document_id = $2 ORDER BY created_at DESC`,
    [workspaceId, documentId],
  );
  return rows.map((r) => mapRow(r as Record<string, unknown>));
}

export async function markSigned(
  client: pg.PoolClient,
  token: string,
  signerIp: string,
  signerUserAgent: string,
  documentHashAfter: string,
): Promise<void> {
  const now = new Date().toISOString();
  await client.query(
    `UPDATE signature_requests
     SET status = 'signed', signed_at = NOW(), signer_ip = $2, signer_user_agent = $3,
         document_hash_after = $4,
         audit_trail = audit_trail || $5::JSONB
     WHERE token = $1 AND status IN ('pending','viewed')`,
    [
      token, signerIp, signerUserAgent, documentHashAfter,
      JSON.stringify([{ action: 'signed', timestamp: now, ip: signerIp, userAgent: signerUserAgent }]),
    ],
  );
}

export async function markViewed(token: string, ip: string): Promise<void> {
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE signature_requests
     SET status = CASE WHEN status = 'pending' THEN 'viewed' ELSE status END,
         audit_trail = audit_trail || $2::JSONB
     WHERE token = $1 AND status = 'pending'`,
    [
      token,
      JSON.stringify([{ action: 'viewed', timestamp: now, ip }]),
    ],
  );
}
