import type pg from 'pg';

/**
 * Gapless sequential number allocation using SELECT ... FOR UPDATE.
 * AGENTS.md requirement: "never use non-transactional sequences for invoice numbers".
 * Must be called inside an active transaction.
 */
export async function allocateNextSequence(
  client: pg.PoolClient,
  workspaceId: string,
  sequenceType: string,
  fiscalYear: number,
): Promise<{ seqNum: number; previousHash: string | null }> {
  // Ensure row exists
  await client.query(
    `INSERT INTO document_sequences (workspace_id, sequence_type, fiscal_year, current_value)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (workspace_id, sequence_type, fiscal_year) DO NOTHING`,
    [workspaceId, sequenceType, fiscalYear],
  );

  // Lock row and atomically increment (SELECT FOR UPDATE pattern per AGENTS.md)
  const { rows } = await client.query<{ current_value: number; previous_hash: string | null }>(
    `SELECT current_value, previous_hash
     FROM document_sequences
     WHERE workspace_id = $1 AND sequence_type = $2 AND fiscal_year = $3
     FOR UPDATE`,
    [workspaceId, sequenceType, fiscalYear],
  );
  const locked = rows[0]!;
  const nextVal = locked.current_value + 1;
  await client.query(
    `UPDATE document_sequences SET current_value = $4
     WHERE workspace_id = $1 AND sequence_type = $2 AND fiscal_year = $3`,
    [workspaceId, sequenceType, fiscalYear, nextVal],
  );
  return { seqNum: nextVal, previousHash: locked.previous_hash };
}

export async function updateSequenceHash(
  client: pg.PoolClient,
  workspaceId: string,
  sequenceType: string,
  fiscalYear: number,
  recordHash: string,
): Promise<void> {
  await client.query(
    `UPDATE document_sequences SET previous_hash = $4
     WHERE workspace_id = $1 AND sequence_type = $2 AND fiscal_year = $3`,
    [workspaceId, sequenceType, fiscalYear, recordHash],
  );
}
