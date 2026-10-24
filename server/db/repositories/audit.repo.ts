import { randomUUID } from 'node:crypto';
import { pool } from '../client.js';
import type { VerifiableChainItem } from '../../domain/audit/hashChain.js';

export async function appendAuditEvent(
  workspaceId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
  previousHash: string,
  recordHash: string,
): Promise<void> {
  const { rows } = await pool.query<{ next_seq: number }>(
    `SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq FROM audit_events WHERE workspace_id = $1`,
    [workspaceId],
  );
  const seqNum = rows[0]!.next_seq;
  await pool.query(
    `INSERT INTO audit_events (
       workspace_id, sequence_number, actor_user_id, action, entity_type, entity_id,
       occurred_at, correlation_id, metadata, previous_hash, record_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9,$10)`,
    [
      workspaceId, seqNum, userId, action, entityType, entityId,
      randomUUID(), JSON.stringify(metadata), previousHash, recordHash,
    ],
  );
}

export async function getAuditEvents(workspaceId: string): Promise<VerifiableChainItem[]> {
  const { rows } = await pool.query<{
    sequence_number: number; actor_user_id: string | null;
    action: string; entity_type: string; entity_id: string | null;
    occurred_at: string; metadata: Record<string, unknown>;
    previous_hash: string; record_hash: string;
  }>(
    `SELECT sequence_number, actor_user_id, action, entity_type, entity_id,
            occurred_at::TEXT, metadata, previous_hash, record_hash
     FROM audit_events WHERE workspace_id = $1
     ORDER BY sequence_number`,
    [workspaceId],
  );
  return rows.map((r) => ({
    workspaceId,
    sequenceNumberOrRef: r.sequence_number,
    occurredAtIso: r.occurred_at,
    entityType: `${r.entity_type}:${r.action}`,
    payload: { ...r.metadata, actorUserId: r.actor_user_id, entityId: r.entity_id },
    previousHash: r.previous_hash,
    recordHash: r.record_hash,
  }));
}
