import type pg from 'pg';
import { pool } from '../client.js';

export interface FirmRow {
  id: string;
  ownerUserId: string;
  name: string;
  siren: string | null;
  createdAt: string;
  workspaces?: WorkspaceSummary[];
}

export interface WorkspaceSummary {
  id: string;
  legalName: string;
  siren: string | null;
  assignedAt: string;
}

export async function createFirm(
  client: pg.PoolClient,
  userId: string,
  name: string,
  siren?: string,
): Promise<FirmRow> {
  const { rows } = await client.query(
    `INSERT INTO accounting_firms (owner_user_id, name, siren)
     VALUES ($1,$2,$3) RETURNING *`,
    [userId, name, siren ?? null],
  );
  const r = rows[0]!;
  return {
    id: r.id as string,
    ownerUserId: r.owner_user_id as string,
    name: r.name as string,
    siren: r.siren as string | null,
    createdAt: r.created_at as string,
  };
}

export async function assignWorkspaceToFirm(
  client: pg.PoolClient,
  firmId: string,
  workspaceId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO firm_workspace_assignments (firm_id, workspace_id)
     VALUES ($1,$2) ON CONFLICT (firm_id, workspace_id) DO NOTHING`,
    [firmId, workspaceId],
  );
}

export async function getFirmByOwner(userId: string): Promise<FirmRow | null> {
  const { rows } = await pool.query(
    `SELECT af.*,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', w.id,
                  'legalName', w.legal_name,
                  'siren', w.siren,
                  'assignedAt', fwa.assigned_at
                ) ORDER BY w.legal_name
              ) FILTER (WHERE w.id IS NOT NULL), '[]'
            ) AS workspaces
     FROM accounting_firms af
     LEFT JOIN firm_workspace_assignments fwa ON fwa.firm_id = af.id
     LEFT JOIN workspaces w ON w.id = fwa.workspace_id
     WHERE af.owner_user_id = $1
     GROUP BY af.id
     LIMIT 1`,
    [userId],
  );
  if (!rows[0]) return null;
  const r = rows[0]!;
  return {
    id: r.id as string,
    ownerUserId: r.owner_user_id as string,
    name: r.name as string,
    siren: r.siren as string | null,
    createdAt: r.created_at as string,
    workspaces: (r.workspaces as WorkspaceSummary[]) ?? [],
  };
}

export async function getFirmWorkspaces(firmId: string): Promise<WorkspaceSummary[]> {
  const { rows } = await pool.query(
    `SELECT w.id, w.legal_name AS "legalName", w.siren, fwa.assigned_at AS "assignedAt"
     FROM firm_workspace_assignments fwa
     JOIN workspaces w ON w.id = fwa.workspace_id
     WHERE fwa.firm_id = $1
     ORDER BY w.legal_name`,
    [firmId],
  );
  return rows as WorkspaceSummary[];
}

export async function removeWorkspaceFromFirm(
  client: pg.PoolClient,
  firmId: string,
  workspaceId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM firm_workspace_assignments WHERE firm_id = $1 AND workspace_id = $2`,
    [firmId, workspaceId],
  );
}

export async function getFirmById(firmId: string): Promise<FirmRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM accounting_firms WHERE id = $1`,
    [firmId],
  );
  if (!rows[0]) return null;
  const r = rows[0]!;
  return {
    id: r.id as string,
    ownerUserId: r.owner_user_id as string,
    name: r.name as string,
    siren: r.siren as string | null,
    createdAt: r.created_at as string,
  };
}
