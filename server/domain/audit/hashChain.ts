/**
 * Cryptographic SHA-256 Hash Chaining Engine (Dolibarr `BlockedLog` / French PAF & NF Z42-013 Pattern)
 *
 * Guarantees tamper-evident immutability across sequential records:
 * - Issued sales documents (`invoices`: standard, deposit, credit note)
 * - Definitively posted ledger entries (`journal_entries`)
 * - Append-only audit trail (`audit_events`)
 */

import { createHash } from 'node:crypto';

export const GENESIS_PREVIOUS_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Deterministically serializes any JSON-compatible value by sorting object keys recursively.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs: string[] = [];
  for (const key of sortedKeys) {
    const val = record[key];
    if (val !== undefined) {
      pairs.push(`${JSON.stringify(key)}:${canonicalJsonStringify(val)}`);
    }
  }
  return `{${pairs.join(',')}}`;
}

export interface ChainedRecordPayload {
  workspaceId: string;
  sequenceNumberOrRef: string | number;
  occurredAtIso: string;
  entityType: string;
  payload: Record<string, unknown>;
}

/**
 * Computes the SHA-256 hash linking `previousHash` and the canonical representation of `record`.
 */
export function computeChainedRecordHash(
  previousHash: string | null | undefined,
  record: ChainedRecordPayload
): { previousHash: string; recordHash: string } {
  const normalizedPrev =
    previousHash && previousHash.trim().length > 0 ? previousHash.trim() : GENESIS_PREVIOUS_HASH;

  const canonicalString = [
    normalizedPrev,
    record.workspaceId,
    String(record.sequenceNumberOrRef),
    record.occurredAtIso,
    record.entityType,
    canonicalJsonStringify(record.payload),
  ].join('|');

  const recordHash = createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  return { previousHash: normalizedPrev, recordHash };
}

export interface VerifiableChainItem extends ChainedRecordPayload {
  previousHash: string;
  recordHash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  checkedCount: number;
  brokenAtIndex?: number;
  reason?: string;
}

/**
 * Verifies an ordered list of hash-chained records from oldest to newest.
 */
export function verifyHashChain(items: readonly VerifiableChainItem[]): ChainVerificationResult {
  let expectedPreviousHash = GENESIS_PREVIOUS_HASH;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        checkedCount: i,
        brokenAtIndex: i,
        reason: `Broken previousHash link at index ${i} (expected ${expectedPreviousHash}, got ${item.previousHash})`,
      };
    }

    const recomputed = computeChainedRecordHash(item.previousHash, item);
    if (recomputed.recordHash !== item.recordHash) {
      return {
        valid: false,
        checkedCount: i,
        brokenAtIndex: i,
        reason: `Record hash mismatch at index ${i} (tampered payload or metadata)`,
      };
    }

    expectedPreviousHash = item.recordHash;
  }

  return {
    valid: true,
    checkedCount: items.length,
  };
}
