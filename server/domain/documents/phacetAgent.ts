/**
 * Agent Phacet — IBAN Fraud Detection (Fraude au Virement Fournisseur / BEC).
 *
 * Compares the IBAN extracted from a supplier invoice against the certified IBAN
 * stored in the supplier contact record. Any mismatch triggers a critical security
 * alert that must be reviewed before payment is authorised.
 *
 * Reference: DGFiP circular on "fraude au virement fournisseur" / Business Email Compromise (BEC).
 */

import type { IbanAlert } from './documentTypes.js';
import type { ContactRecord } from '../../application/workspaceStore.js';
import { maskIban, normalizeIban } from '../contacts/frenchLegalValidators.js';

export interface PhacetCheckInput {
  extractedIban: string;
  supplier: ContactRecord;
}

/**
 * Returns a critical IbanAlert when the IBAN on the document doesn't match the
 * certified IBAN on file, or null when everything looks normal.
 */
export function checkIbanAnomaly(input: PhacetCheckInput): IbanAlert | null {
  const { extractedIban, supplier } = input;
  if (!supplier.certifiedIban) return null;

  const docIban = normalizeIban(extractedIban);
  const certifiedIban = normalizeIban(supplier.certifiedIban);

  if (docIban === certifiedIban) return null;

  const maskedDocumentIban = maskIban(docIban);
  const maskedCertifiedIban = maskIban(certifiedIban);

  const alertMessage =
    `ALERTE SÉCURITÉ RIB : L'IBAN figurant sur la facture (${maskedDocumentIban}) ne correspond pas ` +
    `à l'IBAN certifié au dossier (${maskedCertifiedIban}). ` +
    `Suspicion de fraude au virement fournisseur.`;

  return {
    type: 'IBAN_MISMATCH',
    severity: 'critical',
    maskedDocumentIban,
    maskedCertifiedIban,
    supplierContactId: supplier.id,
    detectedAt: new Date().toISOString(),
    alertMessage,
    emailSent: false,
    emailSentAt: null,
  };
}
