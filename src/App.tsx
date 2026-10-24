import React, { useEffect, useMemo, useState } from 'react';
import './styles.css';
import { minorInputValue, parseMinorInput } from './moneyInput.js';
import { SkipNav } from './components/SkipNav.js';
import { FocusTrap } from './components/FocusTrap.js';
import { LoadingSkeleton } from './components/LoadingSkeleton.js';
import { EmptyState } from './components/EmptyState.js';
import { LandingPage } from './LandingPage.js';
import { LoginPage } from './LoginPage.js';

const euroFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

function formatMinor(cents: number): string {
  return euroFormatter.format((cents ?? 0) / 100);
}

function formatDateFr(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const parts = isoDate.slice(0, 10).split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getAvatarColor(name: string): string {
  const colors = ['#059669', '#2563eb', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length]!;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

type RelanceLevel = 'polite' | 'standard' | 'urgent';

function buildRelanceEmail(level: RelanceLevel, inv: { number?: string | null; provisionalRef?: string; contactLegalName?: string; totalTtcMinor: number; dueDate?: string | null }, senderName: string): { subject: string; body: string } {
  const ref = inv.number ?? inv.provisionalRef ?? '—';
  const client = inv.contactLegalName ?? 'Madame, Monsieur';
  const amount = (inv.totalTtcMinor / 100).toFixed(2).replace('.', ',') + ' €';
  const due = inv.dueDate ? formatDateFr(inv.dueDate) : '—';
  if (level === 'polite') {
    return {
      subject: `Rappel amiable — Facture ${ref}`,
      body: `Madame, Monsieur,\n\nNous espérons que vous vous portez bien.\n\nNous vous contactons au sujet de la facture n° ${ref} d'un montant de ${amount} TTC, dont l'échéance était fixée au ${due}.\n\nSauf erreur de notre part, nous n'avons pas encore reçu le règlement de cette facture. Pourriez-vous nous indiquer à quelle date nous pouvons l'attendre ?\n\nNous restons à votre disposition pour toute question.\n\nCordialement,\n${senderName}`,
    };
  }
  if (level === 'standard') {
    return {
      subject: `Relance — Facture ${ref} échue`,
      body: `Madame, Monsieur,\n\nSauf erreur de notre part, la facture n° ${ref} d'un montant de ${amount} TTC, échue le ${due}, demeure impayée à ce jour.\n\nNous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais, ou de nous informer si vous rencontrez une difficulté particulière.\n\nÀ défaut de règlement ou de retour de votre part dans les 8 jours, nous nous verrons dans l'obligation d'envisager des mesures de recouvrement.\n\nCordialement,\n${senderName}`,
    };
  }
  return {
    subject: `MISE EN DEMEURE — Facture ${ref} — Règlement immédiat exigé`,
    body: `Madame, Monsieur,\n\nMalgré nos relances précédentes, la facture n° ${ref} d'un montant de ${amount} TTC reste impayée.\n\nPar la présente, nous vous mettons formellement en demeure de régler la somme de ${amount} TTC dans un délai de 48 heures à compter de la réception de ce courrier.\n\nÀ défaut, nous procéderons sans délai au recouvrement par voie judiciaire, et les intérêts de retard légaux (taux BCE + 10 points, art. L.441-10 C.com.) seront appliqués.\n\nCordialement,\n${senderName}`,
  };
}

type FraudRisk = 'ok' | 'review' | 'suspect';

function computeFraudRisk(doc: any): { level: FraudRisk; reasons: string[] } {
  const reasons: string[] = [];
  const d = doc.extractedData ?? {};
  const kind: string = doc.detectedKind ?? '';

  if (!['supplier_invoice', 'expense_receipt'].includes(kind)) {
    return { level: 'ok', reasons: [] };
  }
  if (doc.confidenceScore != null && doc.confidenceScore < 0.25) {
    reasons.push('Confiance OCR très faible');
  }
  if (!d.issuerSiren) {
    reasons.push('SIREN émetteur absent');
  }
  if (!d.documentDate) {
    reasons.push('Date manquante');
  }
  if (d.amountTtcMinor && d.amountTtcMinor % 10000 === 0) {
    reasons.push('Montant TTC très rond');
  }
  if (!d.referenceNumber) {
    reasons.push('Numéro de facture absent');
  }
  if (doc.isDuplicate) {
    reasons.push('Doublon détecté');
  }

  if (reasons.filter(r => ['Confiance OCR très faible', 'Doublon détecté'].includes(r)).length > 0) {
    return { level: 'suspect', reasons };
  }
  if (reasons.length >= 2) return { level: 'review', reasons };
  if (reasons.length === 1) return { level: 'review', reasons };
  return { level: 'ok', reasons: [] };
}

type NavSection =
  | 'pilotage'
  | 'sales'
  | 'purchases'
  | 'banking'
  | 'accounting'
  | 'contacts'
  | 'documents'
  | 'vat'
  | 'reports'
  | 'settings'
  | 'cycle'
  | 'inventaire'
  | 'integrations'
  | 'team'
  | 'showcase';

const CYCLE_TASKS: {
  quotidien: Array<{ id: string; label: string; desc: string; navTarget: NavSection; navLabel: string; unpaidFilter?: true; inventaireTab?: 'paie' | 'amortissements' | 'provisions' | 'ccafnp' }>;
  mensuel:   Array<{ id: string; label: string; desc: string; navTarget: NavSection; navLabel: string; unpaidFilter?: true; inventaireTab?: 'paie' | 'amortissements' | 'provisions' | 'ccafnp' }>;
  annuel:    Array<{ id: string; label: string; desc: string; navTarget: NavSection; navLabel: string; unpaidFilter?: true; inventaireTab?: 'paie' | 'amortissements' | 'provisions' | 'ccafnp' }>;
} = {
  quotidien: [
    { id: 'q1', label: 'Collecte des pièces justificatives', desc: "Récupérer les factures d'achats, de ventes et notes de frais via GED", navTarget: 'documents',   navLabel: 'Documents' },
    { id: 'q2', label: 'Saisie comptable',                   desc: 'Enregistrer les flux dans les journaux Achats, Ventes, Banque, Caisse',                           navTarget: 'accounting', navLabel: 'Grand Livre' },
    { id: 'q3', label: 'Rapprochement bancaire',             desc: 'Vérifier que le solde bancaire correspond au compte 512 en comptabilité',                         navTarget: 'banking',    navLabel: 'Banque' },
  ],
  mensuel: [
    { id: 'm1', label: 'Lettrage des comptes',               desc: 'Lier les factures à leurs règlements (401 fournisseurs / 411 clients)',                           navTarget: 'accounting', navLabel: 'Grand Livre' },
    { id: 'm2', label: 'Déclaration de TVA (CA3)',           desc: 'Calcul et télétransmission sur impots.gouv.fr entre le 15 et le 24',                              navTarget: 'vat',        navLabel: 'TVA' },
    { id: 'm3', label: 'Centralisation des écritures de paie', desc: 'Salaires bruts, charges patronales/salariales, vérification DSN',                               navTarget: 'inventaire', navLabel: 'Paie',           inventaireTab: 'paie' },
    { id: 'm4', label: 'Relances clients',                   desc: 'Analyser la balance âgée et relancer les retards de paiement',                                    navTarget: 'sales',      navLabel: 'Facturation', unpaidFilter: true },
  ],
  annuel: [
    { id: 'a1', label: 'Amortissements',    desc: 'Calculer et enregistrer la dépréciation des immobilisations (classe 2)',    navTarget: 'inventaire', navLabel: 'Amortissements', inventaireTab: 'amortissements' },
    { id: 'a2', label: 'Provisions',        desc: 'Anticiper les risques ou charges futures (litiges, clients douteux)',       navTarget: 'inventaire', navLabel: 'Provisions',     inventaireTab: 'provisions' },
    { id: 'a3', label: 'CCA & FNP',         desc: "Ajuster les Charges Constatées d'Avance et Factures Non Parvenues",        navTarget: 'inventaire', navLabel: 'CCA & FNP',      inventaireTab: 'ccafnp' },
    { id: 'a4', label: 'Révision comptable',desc: 'Vérification méthodique de chaque compte avant validation finale',         navTarget: 'reports',    navLabel: 'Rapports' },
    { id: 'a5', label: 'États financiers',  desc: "Générer le Bilan, le Compte de Résultat et l'Annexe",                     navTarget: 'reports',    navLabel: 'Rapports' },
    { id: 'a6', label: 'Liasse fiscale',    desc: "Télétransmission des déclarations fiscales à l'administration de l'État",  navTarget: 'reports',    navLabel: 'Rapports' },
  ],
};

type CycleKey = 'quotidien' | 'mensuel' | 'annuel';

type PipelineFilter = 'all' | 'review' | 'draft' | 'unpaid' | 'paid' | 'reconciled';

// ── French PCG 2025 / ANC 2022-06 journal-entry validation rules ─────────────
function checkJournalEntry(
  journal: string,
  debit: string,
  credit: string,
): Array<{ blocking: boolean; message: string }> {
  const violations: Array<{ blocking: boolean; message: string }> = [];
  // Strip label suffix if user picked from datalist ("606000 — Achats…")
  const d = debit.trim().split(/\s/)[0] ?? '';
  const c = credit.trim().split(/\s/)[0] ?? '';
  if (!d || !c) return violations;

  // ── AC (Achats / Fournisseurs) ───────────────────────────────────────────────
  if (journal === 'AC') {
    if (!c.startsWith('401') && !c.startsWith('408') && !c.startsWith('4091') && !c.startsWith('4096')) {
      violations.push({ blocking: true, message: 'Journal AC : le Crédit doit être un compte fournisseur 401xxx (ou 408 factures non parvenues). Utilisez OD pour les régularisations.' });
    }
    if (d.startsWith('411') || d.startsWith('416')) {
      violations.push({ blocking: true, message: 'Journal AC interdit pour les comptes clients 411xxx. Utilisez le journal VE pour les créances clients.' });
    }
    if (d.startsWith('7')) {
      violations.push({ blocking: true, message: 'Journal AC : le Débit ne peut pas être un produit 7xxx. Les produits (chiffre d\'affaires) appartiennent au journal VE.' });
    }
    if (c.startsWith('44571') || c.startsWith('44581')) {
      violations.push({ blocking: true, message: 'TVA collectée (44571x) au Crédit est incompatible avec le journal AC — elle ne se constate que dans le journal VE.' });
    }
    if (d.startsWith('512') || d.startsWith('514') || d.startsWith('530')) {
      violations.push({ blocking: false, message: '⚠ Vous débitez un compte de trésorerie (512/514/530) dans le journal AC. Pour un règlement fournisseur, utilisez le journal BQ après avoir comptabilisé la facture.' });
    }
  }

  // ── VE (Ventes / Clients) ────────────────────────────────────────────────────
  if (journal === 'VE') {
    if (!d.startsWith('411') && !d.startsWith('416') && !d.startsWith('4181') && !d.startsWith('419') && !d.startsWith('4096')) {
      violations.push({ blocking: true, message: 'Journal VE : le Débit doit être un compte client 411xxx (créances clients). Utilisez OD pour les régularisations.' });
    }
    if (c.startsWith('401') || c.startsWith('408')) {
      violations.push({ blocking: true, message: 'Journal VE interdit pour les comptes fournisseurs 401xxx. Utilisez le journal AC pour les dettes fournisseurs.' });
    }
    if (d.startsWith('6')) {
      violations.push({ blocking: true, message: 'Journal VE : le Débit ne peut pas être une charge 6xxx. Les charges (dépenses) appartiennent au journal AC.' });
    }
    if (c.startsWith('44566') || c.startsWith('44586')) {
      violations.push({ blocking: true, message: 'TVA déductible (44566x) au Crédit est incompatible avec le journal VE — elle ne se constate que dans le journal AC.' });
    }
    if (d.startsWith('512') || d.startsWith('514') || d.startsWith('530')) {
      violations.push({ blocking: false, message: '⚠ Vous débitez un compte de trésorerie (512/514/530) dans le journal VE. Pour un encaissement client, utilisez le journal BQ après la facture.' });
    }
  }

  // ── BQ (Banque) ──────────────────────────────────────────────────────────────
  if (journal === 'BQ') {
    const hasBank = d.startsWith('512') || d.startsWith('514') || d.startsWith('515') ||
                    c.startsWith('512') || c.startsWith('514') || c.startsWith('515');
    if (!hasBank) {
      violations.push({ blocking: true, message: 'Journal BQ : l\'une des lignes doit être un compte de banque 512xxx (ou 514 CCP / 515 caisse d\'épargne). Pour les espèces, utilisez le journal CA (530xxx).' });
    }
    if (d.startsWith('401') || d.startsWith('411') || c.startsWith('401') || c.startsWith('411')) {
      violations.push({ blocking: false, message: '⚠ Règlement de tiers en BQ : pour un suivi rigoureux (lettrage), enregistrez d\'abord la facture en AC ou VE, puis le règlement en BQ.' });
    }
    if (d.startsWith('6') || d.startsWith('7') || c.startsWith('6') || c.startsWith('7')) {
      violations.push({ blocking: false, message: '⚠ Vous imputez une charge/produit directement en BQ. Préférez passer par AC/VE pour la facture puis BQ pour le règlement (respect de l\'indépendance des exercices).' });
    }
  }

  // ── CA (Caisse) ──────────────────────────────────────────────────────────────
  if (journal === 'CA') {
    const hasCash = d.startsWith('530') || c.startsWith('530');
    if (!hasCash) {
      violations.push({ blocking: true, message: 'Journal CA : l\'une des lignes doit être un compte de caisse 530xxx. Pour les mouvements bancaires, utilisez le journal BQ (512xxx).' });
    }
  }

  // ── AN (À-Nouveaux) ──────────────────────────────────────────────────────────
  if (journal === 'AN') {
    const dIsResult = d.startsWith('6') || d.startsWith('7');
    const cIsResult = c.startsWith('6') || c.startsWith('7');
    if (dIsResult || cIsResult) {
      violations.push({ blocking: true, message: 'Journal AN (À-Nouveaux) : réservé à la reprise des soldes de bilan (classes 1–5). Les comptes de résultat 6xx/7xx ne se reportent pas — ils sont soldés par le compte 120/129 (résultat de l\'exercice).' });
    }
  }

  // ── OD — avertissements ──────────────────────────────────────────────────────
  if (journal === 'OD') {
    const looksLikeInvoice = (d.startsWith('411') && c.startsWith('7')) || (c.startsWith('401') && d.startsWith('6'));
    if (looksLikeInvoice) {
      violations.push({ blocking: false, message: '⚠ Cette écriture ressemble à une facture (411/7xx ou 6xx/401). Préférez les journaux VE ou AC pour les factures clients/fournisseurs.' });
    }
  }

  // ── Règles universelles PCG 2025 ─────────────────────────────────────────────
  if (d.startsWith('79') || c.startsWith('79')) {
    violations.push({ blocking: true, message: 'Compte 79xxx (Transferts de charges) interdit en saisie directe — généré automatiquement lors de refacturations entre services.' });
  }
  if (d.startsWith('89') || c.startsWith('89')) {
    violations.push({ blocking: true, message: 'Compte 89xxx (Bilan de clôture) interdit en saisie directe — écriture de clôture automatique uniquement.' });
  }
  if (d === c) {
    violations.push({ blocking: true, message: 'Débit et Crédit sont identiques — une écriture en partie double requiert deux comptes distincts (principe de dualité PCG).' });
  }
  if ((d.startsWith('8') && !d.startsWith('86') && !d.startsWith('87')) || (c.startsWith('8') && !c.startsWith('86') && !c.startsWith('87'))) {
    violations.push({ blocking: false, message: '⚠ Comptes de classe 8 (engagements hors bilan) : à utiliser uniquement pour les engagements donnés/reçus, cautions et crédits-bails non encore levés.' });
  }
  return violations;
}

// Auto-detect journal from account code prefixes
function detectJournalCode(debit: string, credit: string): 'OD' | 'VE' | 'AC' | 'BQ' | 'CA' | 'AN' {
  const d = debit.trim().split(/\s/)[0] ?? '';
  const c = credit.trim().split(/\s/)[0] ?? '';
  if (d.startsWith('411') || (d.startsWith('416') && c.startsWith('7'))) return 'VE';
  if (c.startsWith('401') || c.startsWith('408')) return 'AC';
  if (d.startsWith('512') || d.startsWith('514') || c.startsWith('512') || c.startsWith('514')) return 'BQ';
  if (d.startsWith('530') || c.startsWith('530')) return 'CA';
  return 'OD';
}

// PCG 2025 accounts grouped by activity sector — used in manual entry datalist
const PCG_SECTORS: Array<{ id: string; label: string; accounts: Array<{ code: string; label: string }> }> = [
  { id: 'services', label: 'Services & Conseil (NAF 69–74)', accounts: [
    { code: '706100', label: 'Prestations de services' },
    { code: '622600', label: 'Honoraires (experts, avocats…)' },
    { code: '606000', label: 'Achats non stockés (fournitures)' },
    { code: '626000', label: 'Frais de télécommunications' },
    { code: '625100', label: 'Déplacements et missions' },
    { code: '625700', label: 'Réceptions & repas d\'affaires' },
    { code: '641000', label: 'Salaires bruts' },
    { code: '645000', label: 'Charges de sécurité sociale' },
    { code: '411000', label: 'Clients' },
    { code: '401000', label: 'Fournisseurs' },
    { code: '445711', label: 'TVA collectée 20%' },
    { code: '445660', label: 'TVA déductible sur services' },
    { code: '512100', label: 'Banque compte courant' },
  ]},
  { id: 'commerce', label: 'Commerce & Distribution (NAF 45–47)', accounts: [
    { code: '607000', label: 'Achats de marchandises' },
    { code: '601000', label: 'Achats matières premières' },
    { code: '701000', label: 'Ventes de marchandises' },
    { code: '623000', label: 'Publicité & marketing' },
    { code: '613200', label: 'Loyers & charges locatives' },
    { code: '445660', label: 'TVA déductible sur biens' },
    { code: '411000', label: 'Clients' },
    { code: '401000', label: 'Fournisseurs' },
    { code: '380000', label: 'Stock de marchandises' },
    { code: '512100', label: 'Banque' },
  ]},
  { id: 'btp', label: 'BTP & Construction (NAF 41–43)', accounts: [
    { code: '604500', label: 'Sous-traitance générale' },
    { code: '604000', label: 'Achats matières premières BTP' },
    { code: '613200', label: 'Locations matériel & échafaudages' },
    { code: '615000', label: 'Entretien & réparations chantiers' },
    { code: '621000', label: 'Personnel extérieur intérim' },
    { code: '706000', label: 'Prestations travaux (marchés)' },
    { code: '445620', label: 'TVA déductible auto-liquidation' },
    { code: '445710', label: 'TVA collectée auto-liquidation' },
    { code: '411000', label: 'Clients travaux' },
    { code: '401000', label: 'Fournisseurs BTP' },
    { code: '512100', label: 'Banque' },
  ]},
  { id: 'industrie', label: 'Industrie & Production (NAF 10–33)', accounts: [
    { code: '601000', label: 'Achats matières premières' },
    { code: '604000', label: 'Achats d\'études et prestations' },
    { code: '613200', label: 'Crédit-bail machines' },
    { code: '615000', label: 'Maintenance & réparations' },
    { code: '681100', label: 'Dotations aux amortissements' },
    { code: '215000', label: 'Installations techniques (immos)' },
    { code: '701000', label: 'Ventes produits finis' },
    { code: '445660', label: 'TVA déductible sur biens' },
    { code: '401000', label: 'Fournisseurs' },
    { code: '411000', label: 'Clients' },
  ]},
  { id: 'restauration', label: 'Restauration & Hôtellerie (NAF 55–56)', accounts: [
    { code: '607100', label: 'Achats denrées alimentaires' },
    { code: '607200', label: 'Achats boissons' },
    { code: '613200', label: 'Loyers locaux commerciaux' },
    { code: '621000', label: 'Personnel saisonnier intérim' },
    { code: '641000', label: 'Salaires service & cuisine' },
    { code: '706100', label: 'Recettes restauration' },
    { code: '706300', label: 'Recettes hébergement' },
    { code: '445712', label: 'TVA collectée 10% (restauration)' },
    { code: '445661', label: 'TVA déductible 10%' },
    { code: '512100', label: 'Banque' },
  ]},
  { id: 'sante', label: 'Professions de santé (NAF 86)', accounts: [
    { code: '706100', label: 'Honoraires médicaux (exonérés TVA)' },
    { code: '622600', label: 'Honoraires remplaçants' },
    { code: '606000', label: 'Fournitures médicales' },
    { code: '615000', label: 'Entretien matériel médical' },
    { code: '681100', label: 'Amortissements équipements médicaux' },
    { code: '612000', label: 'Redevances cabinets médicaux' },
    { code: '625100', label: 'Congrès & formations DPC' },
    { code: '641000', label: 'Salaires secrétariat' },
    { code: '512100', label: 'Banque (virements CPAM)' },
  ]},
  { id: 'liberal', label: 'Professions libérales (BNC)', accounts: [
    { code: '706100', label: 'Honoraires & rémunérations' },
    { code: '622600', label: 'Honoraires sous-traitance' },
    { code: '623000', label: 'Publicité & communication' },
    { code: '626000', label: 'Frais télécom & internet' },
    { code: '625100', label: 'Déplacements & missions' },
    { code: '606000', label: 'Fournitures bureau' },
    { code: '613500', label: 'Charges locatives & copropriété' },
    { code: '681100', label: 'Amortissements matériel' },
    { code: '641000', label: 'Salaires & traitements' },
    { code: '445711', label: 'TVA collectée 20%' },
    { code: '445660', label: 'TVA déductible' },
  ]},
  { id: 'immobilier', label: 'Immobilier & Location (NAF 68)', accounts: [
    { code: '752000', label: 'Revenus des immeubles' },
    { code: '614000', label: 'Charges locatives propriétaire' },
    { code: '615000', label: 'Entretien & réparations bâtiment' },
    { code: '616000', label: 'Primes d\'assurance' },
    { code: '661100', label: 'Intérêts d\'emprunts' },
    { code: '681100', label: 'Amortissements immobilisations' },
    { code: '164000', label: 'Emprunts établissements de crédit' },
    { code: '512100', label: 'Banque (loyers)' },
  ]},
];

export function App() {
  const [section, setSection] = useState<NavSection>('pilotage');
  const [pilotageTab, setPilotageTab] = useState<'tresorerie' | 'dashboard' | 'tva'>('tresorerie');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('all');
  const [amountDisplayMode, setAmountDisplayMode] = useState<'TTC' | 'HT'>('TTC');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [documents, setDocuments] = useState<any[]>([]);
  const [docUploadDragging, setDocUploadDragging] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [docSelectedId, setDocSelectedId] = useState<string | null>(null);
  const [docKindFilter, setDocKindFilter] = useState<'all' | 'supplier' | 'client' | 'banque'>('all');

  // Relancer le client modal
  const [showRelanceModal, setShowRelanceModal] = useState(false);
  const [relanceInvoice, setRelanceInvoice] = useState<any | null>(null);
  const [relanceTemplate, setRelanceTemplate] = useState<'polite' | 'standard' | 'urgent'>('polite');
  const [relanceSubject, setRelanceSubject] = useState('');
  const [relanceBody, setRelanceBody] = useState('');

  // Demande de justificatif modal
  const [showJustifRequestModal, setShowJustifRequestModal] = useState(false);
  const [justifRequestContactId, setJustifRequestContactId] = useState('');
  const [justifRequestBody, setJustifRequestBody] = useState('');
  const [docReviewDraft, setDocReviewDraft] = useState<Record<string, any>>({});
  const [docReviewMoneyInput, setDocReviewMoneyInput] = useState<Record<string, Record<string, string>>>({});
  const [docReviewKind, setDocReviewKind] = useState<Record<string, string>>({});
  const [docAmountAcknowledged, setDocAmountAcknowledged] = useState<Record<string, boolean>>({});

  const [workspace, setWorkspace] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactDirectoryFilter, setContactDirectoryFilter] = useState<'all' | 'customers' | 'suppliers'>('all');
  const [contactDirectorySearch, setContactDirectorySearch] = useState('');
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [tierDetailTab, setTierDetailTab] = useState<'fiche' | 'factures' | 'achats' | 'documents' | 'comptabilite'>('fiche');

  // Équipe & Rôles section state
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; name: string; email: string; role: string; joinedAt: string }>>([
    { id: 'owner-1', name: workspace?.tradeName ?? 'Propriétaire', email: 'owner@workspace.fr', role: 'owner', joinedAt: new Date().toISOString().slice(0, 10) },
  ]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'finance' | 'accountant' | 'read_only'>('finance');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [bankTransactions, setBankTransactions] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [vatSummary, setVatSummary] = useState<any>(null);
  const [fecData, setFecData] = useState<any>(null);
  const [auditData, setAuditData] = useState<any>(null);

  // Split-Screen Document Inspector Drawer state (Screenshot 5)
  const [inspectedInvoice, setInspectedInvoice] = useState<any | null>(null);
  const [inspectorRightTab, setInspectorRightTab] = useState<'justificatif' | 'analytique' | 'paiement' | 'xml'>('justificatif');

  // IMAGE 1 STATE: Transactions Master-Detail Split View & Grouped Reconciliation
  const [selectedBankTxId, setSelectedBankTxId] = useState<string | null>(null);
  const [bankDetailTab, setBankDetailTab] = useState<
    'traitement' | 'ecritures' | 'reconciliation' | 'commentaires' | 'regles' | 'activite'
  >('reconciliation');
  const [bankSearch, setBankSearch] = useState<string>('');
  const [bankStatusFilter, setBankStatusFilter] = useState<string>('all');
  const [showGroupMatchModal, setShowGroupMatchModal] = useState<boolean>(false);
  const [selectedGroupDocIds, setSelectedGroupDocIds] = useState<Record<string, boolean>>({});
  const [newBankComment, setNewBankComment] = useState<string>('');

  // IMAGE 2 STATE: Grand Livre Subtabs, Auto-Lettering, Manual Entry & 13-Column Customizer
  const [ledgerSubTab, setLedgerSubTab] = useState<
    'all' | 'clients' | 'fournisseurs' | 'charges_produits' | 'tresorerie'
  >('charges_produits');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');
  const [ledgerJournalFilter, setLedgerJournalFilter] = useState<string>('ALL');
  const [showColumnCustomizer, setShowColumnCustomizer] = useState<boolean>(false);
  const defaultLedgerColumns = {
    lineLabel: true,
    vatRate: true,
    pieceLabel: false,
    pieceRef: true,
    invoiceNumber: true,
    dueDate: true,
    lettering: true,
    debit: true,
    credit: true,
    debitForeign: true,
    creditForeign: true,
    runningBalance: true,
    categories: true,
  };
  const [visibleColumns, setVisibleColumns] = useState(defaultLedgerColumns);
  const [showManualEntryModal, setShowManualEntryModal] = useState<boolean>(false);
  const [manualJournal, setManualJournal] = useState<'OD' | 'VE' | 'AC' | 'BQ' | 'CA' | 'AN'>('OD');
  const [manualPieceRef, setManualPieceRef] = useState<string>('OD-2026-042');
  const [manualDesc, setManualDesc] = useState<string>("Régularisation charges constatées d'avance (PCG 2025)");
  const [manualDueDate, setManualDueDate] = useState<string>('2026-10-31');
  const [manualDebitAccount, setManualDebitAccount] = useState<string>('613500');
  const [manualCreditAccount, setManualCreditAccount] = useState<string>('512100');
  const [manualAmountEuros, setManualAmountEuros] = useState<string>('650');
  const [manualActivitySector, setManualActivitySector] = useState<string>('services');
  const [manualTvaRate, setManualTvaRate] = useState<string>('20');
  const [manualTvaCoeff, setManualTvaCoeff] = useState<number>(100);

  // IMAGE 3 STATE: Achats 3-Pane Split View (Boîte de réception + AI Transaction Suggestions)
  const [achatsSubTab, setAchatsSubTab] = useState<'inbox' | 'to_pay' | 'paid' | 'all'>('inbox');
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [expensePdfPage, setExpensePdfPage] = useState<number>(1);

  // Modals for quick creation
  const [showNewInvoiceModal, setShowNewInvoiceModal] = useState(false);
  const [showNewExpenseModal, setShowNewExpenseModal] = useState(false);
  const [showNewContactModal, setShowNewContactModal] = useState(false);
  const [contactCreateContext, setContactCreateContext] = useState<'directory' | 'invoice' | 'expense' | 'document'>('directory');
  const [contactSaving, setContactSaving] = useState(false);
  const [contactCreatedData, setContactCreatedData] = useState<{ id: string; legalName: string; kind: string } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form states
  const [newDocType, setNewDocType] = useState<'standard_invoice' | 'deposit_invoice' | 'quote'>('standard_invoice');
  const [newContactId, setNewContactId] = useState<string>('');
  const [expenseSupplierContactId, setExpenseSupplierContactId] = useState<string>('');
  const [newDesc, setNewDesc] = useState<string>('Audit & Intégration Factur-X (Norme EN 16931)');
  const [newQty, setNewQty] = useState<string>('3');
  const [newUnitPriceEuros, setNewUnitPriceEuros] = useState<string>('850');
  const [newTaxRule, setNewTaxRule] = useState<string>('FR_TVA_20');

  const [expRef, setExpRef] = useState<string>('FOURN-2026-710');
  const [expDesc, setExpDesc] = useState<string>('Licences Cloud & Sécurité Souveraine UE');
  const [expAccount, setExpAccount] = useState<string>('613500');
  const [expRatio, setExpRatio] = useState<string>('1.00');
  const [expHtEuros, setExpHtEuros] = useState<string>('420');
  const [expFile, setExpFile] = useState<File | null>(null);
  const [expFileDragging, setExpFileDragging] = useState(false);
  const [expEntryMode, setExpEntryMode] = useState<'import' | 'manual'>('import');
  const [expExtracting, setExpExtracting] = useState(false);
  const [expExtractedDocId, setExpExtractedDocId] = useState<string | null>(null);
  const [invFile, setInvFile] = useState<File | null>(null);
  const [invFileDragging, setInvFileDragging] = useState(false);
  const [invEntryMode, setInvEntryMode] = useState<'import' | 'manual'>('import');
  const [invExtracting, setInvExtracting] = useState(false);
  const [invExtractedDocId, setInvExtractedDocId] = useState<string | null>(null);
  const [expDate, setExpDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const [contactName, setContactName] = useState<string>('');
  const [contactKind, setContactKind] = useState<'customer' | 'supplier' | 'both'>('customer');
  const [contactIsBusiness, setContactIsBusiness] = useState(true);
  const [contactSiren, setContactSiren] = useState<string>('');
  const [contactEmail, setContactEmail] = useState<string>('');
  const [contactStreet, setContactStreet] = useState<string>('');
  const [contactPostalCode, setContactPostalCode] = useState<string>('');
  const [contactCity, setContactCity] = useState<string>('');

  // ── Authentication ────────────────────────────────────────────────────────
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try { return localStorage.getItem('hx_token'); } catch { return null; }
  });
  // showLanding = true for first-time / logged-out visitors; false once they click a CTA
  const [showLanding, setShowLanding] = useState<boolean>(() => {
    try { return !localStorage.getItem('hx_token'); } catch { return true; }
  });

  function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers as Record<string, string> ?? {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });
  }


  function handleLogout() {
    try { localStorage.removeItem('hx_token'); } catch {}
    setAuthToken(null);
    setShowLanding(true);
    setWorkspace(null);
    setContacts([]);
    setInvoices([]);
    setExpenses([]);
    setBankTransactions([]);
    setEntries([]);
    setVatSummary(null);
    setFecData(null);
    setAuditData(null);
    setDocuments([]);
  }

  function notify(type: 'success' | 'error', message: string) {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 5500);
  }

  async function refreshDocuments(wsId: string) {
    const res = await apiFetch(`/api/v1/workspaces/${wsId}/documents`);
    if (res.ok) setDocuments(await res.json());
  }

  async function uploadDocumentFile(file: File) {
    if (!workspace?.id) return;
    setDocUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const b64 = btoa(binary);
      const res = await apiFetch(`/api/v1/workspaces/${workspace.id}/documents/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', contentBase64: b64, source: 'manual_upload' }),
      });
      if (!res.ok) throw new Error(await res.text());
      const doc = await res.json();
      setDocuments(prev => [doc, ...prev]);
      setDocSelectedId(doc.id);
      notify('success', `Document importé : ${file.name}`);
    } catch (err) {
      notify('error', `Erreur import : ${String(err)}`);
    } finally {
      setDocUploading(false);
    }
  }

  async function extractAndPrefillExpense(file: File) {
    if (!workspace?.id) return;
    setExpFile(file);
    setExpExtracting(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const b64 = btoa(binary);
      const res = await apiFetch(`/api/v1/workspaces/${workspace.id}/documents/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', contentBase64: b64, source: 'manual_upload' }),
      });
      if (!res.ok) return;
      const doc = await res.json() as {
        id: string;
        extractedData?: {
          referenceNumber?: string;
          description?: string;
          amountHtMinor?: number;
          issuerSiren?: string;
          documentDate?: string;
        };
      };
      setExpExtractedDocId(doc.id);
      setDocuments(prev => [doc, ...prev]);
      const d = doc.extractedData;
      if (d) {
        if (d.referenceNumber) setExpRef(d.referenceNumber);
        if (d.description) setExpDesc(d.description);
        if (d.amountHtMinor !== undefined) setExpHtEuros((d.amountHtMinor / 100).toFixed(2));
        if (d.documentDate) setExpDate(d.documentDate);
        if (d.issuerSiren) {
          const matched = contacts.find(c => (c.kind === 'supplier' || c.kind === 'both') && (c as any).siren === d.issuerSiren);
          if (matched) setExpenseSupplierContactId(matched.id);
        }
      }
    } catch {
      // extraction failed silently — user can still fill the form manually
    } finally {
      setExpExtracting(false);
    }
  }

  async function extractAndPrefillInvoice(file: File) {
    if (!workspace?.id) return;
    setInvFile(file);
    setInvExtracting(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const b64 = btoa(binary);
      const res = await apiFetch(`/api/v1/workspaces/${workspace.id}/documents/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', contentBase64: b64, source: 'manual_upload' }),
      });
      if (!res.ok) return;
      const doc = await res.json() as {
        id: string;
        extractedData?: {
          description?: string;
          amountHtMinor?: number;
          vatRatePercent?: number;
          issuerSiren?: string;
        };
      };
      setInvExtractedDocId(doc.id);
      setDocuments(prev => [doc, ...prev]);
      const d = doc.extractedData;
      if (d) {
        if (d.description) setNewDesc(d.description);
        if (d.amountHtMinor !== undefined) {
          setNewQty('1');
          setNewUnitPriceEuros((d.amountHtMinor / 100).toFixed(2));
        }
        if (d.vatRatePercent !== undefined) {
          if (d.vatRatePercent === 20) setNewTaxRule('FR_TVA_20');
          else if (d.vatRatePercent === 10) setNewTaxRule('FR_TVA_10');
          else if (d.vatRatePercent === 5.5) setNewTaxRule('FR_TVA_5_5');
          else if (d.vatRatePercent === 0) setNewTaxRule('FR_FRANCHISE_293B');
        }
        if (d.issuerSiren) {
          const matched = contacts.find(c => (c.kind === 'customer' || c.kind === 'both') && (c as any).siren === d.issuerSiren);
          if (matched) setNewContactId(matched.id);
        }
      }
    } catch {
      // extraction failed silently — user can still fill the form manually
    } finally {
      setInvExtracting(false);
    }
  }

  async function rejectDocument(docId: string) {
    if (!workspace?.id) return;
    await apiFetch(`/api/v1/workspaces/${workspace.id}/documents/${docId}/reject`, { method: 'PATCH' });
    await refreshDocuments(workspace.id);
  }

  async function confirmDocumentForPosting(doc: any) {
    if (!workspace?.id) return;
    const confirmedData = { ...(docReviewDraft[doc.id] ?? doc.confirmedData ?? doc.extractedData ?? {}) };
    const rawAmounts = docReviewMoneyInput[doc.id] ?? {};
    for (const [field, rawValue] of Object.entries(rawAmounts)) {
      if (rawValue.trim() === '') {
        delete confirmedData[field];
        continue;
      }
      const parsedValue = parseMinorInput(rawValue);
      if (parsedValue === undefined) {
        notify('error', 'Saisissez un montant valide avec au plus deux décimales.');
        return;
      }
      confirmedData[field] = parsedValue;
    }
    const confirmedKind = docReviewKind[doc.id] ?? doc.confirmedKind ?? doc.detectedKind;
    const res = await apiFetch(`/api/v1/workspaces/${workspace.id}/documents/${doc.id}/confirm`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmedKind, confirmedData }),
    });
    if (!res.ok) {
      notify('error', 'Impossible de confirmer les champs extraits. Vérifiez le document et réessayez.');
      return;
    }
    const confirmed = await res.json();
    setDocuments((prev) => prev.map((item: any) => item.id === confirmed.id ? confirmed : item));
    setDocReviewMoneyInput((prev) => { const next = { ...prev }; delete next[doc.id]; return next; });
    notify('success', confirmedKind === 'sales_report'
      ? "Montants du rapport vérifiés et enregistrés. Aucune écriture comptable n'a été créée."
      : 'Champs confirmés. Vous pouvez maintenant comptabiliser la pièce.');
  }

  async function deleteDocumentById(docId: string) {
    if (!workspace?.id) return;
    await apiFetch(`/api/v1/workspaces/${workspace.id}/documents/${docId}`, { method: 'DELETE' });
    setDocuments(prev => prev.filter(d => d.id !== docId));
    if (docSelectedId === docId) setDocSelectedId(null);
  }

  const [docPostingId, setDocPostingId] = useState<string | null>(null);
  const [docPostError, setDocPostError] = useState<string | null>(null);
  const [docPostSupplierContactId, setDocPostSupplierContactId] = useState<string>('');
  const [docPosting, setDocPosting] = useState(false);
  const [docPostAccountCode, setDocPostAccountCode] = useState<string>('613500');
  const [docPostDeductibilityRatio, setDocPostDeductibilityRatio] = useState<string>('1.00');

  async function postDocumentAsExpense(docId: string) {
    if (!workspace?.id || !docPostSupplierContactId) return;
    setDocPosting(true);
    setDocPostError(null);
    try {
      const res = await apiFetch(`/api/v1/workspaces/${workspace.id}/documents/${docId}/post-as-expense`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierContactId: docPostSupplierContactId,
          accountCode: docPostAccountCode,
          deductibilityRatio: docPostDeductibilityRatio,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setDocPostError(err.error ?? 'Erreur lors de la comptabilisation');
      } else {
        const result = await res.json() as { expense?: { id: string } };
        setDocPostingId(null);
        await refreshDocuments(workspace.id);
        const freshExpenses = await apiFetch('/api/v1/expenses').then(r => r.json());
        if (Array.isArray(freshExpenses)) setExpenses(freshExpenses);
        if (result.expense?.id) {
          setSelectedExpenseId(result.expense.id);
          setSection('purchases');
          notify('success', 'Dépense créée — redirigé vers Tous les achats.');
        }
      }
    } finally {
      setDocPosting(false);
    }
  }

  async function postDocumentAsBankImport(docId: string) {
    if (!workspace?.id) return;
    setDocPosting(true);
    setDocPostError(null);
    try {
      const res = await apiFetch(`/api/v1/workspaces/${workspace.id}/documents/${docId}/post-as-bank-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        setDocPostError(err.error ?? 'Erreur lors de l\'import bancaire');
      } else {
        setDocPostingId(null);
        await refreshDocuments(workspace.id);
        await apiFetch('/api/v1/banking/transactions').then(r => r.json()).then(setBankTransactions);
      }
    } finally {
      setDocPosting(false);
    }
  }

  async function refreshAll(preserveInspectedId?: string) {
    const [wsRes, cRes, iRes, eRes, bRes, jRes, vRes, fRes, aRes] = await Promise.all([
      apiFetch('/api/v1/workspaces/current'),
      apiFetch('/api/v1/contacts'),
      apiFetch('/api/v1/invoices'),
      apiFetch('/api/v1/expenses'),
      apiFetch('/api/v1/banking/transactions'),
      apiFetch('/api/v1/accounting/entries'),
      apiFetch('/api/v1/tax/vat-summary'),
      apiFetch('/api/v1/exports/fec'),
      apiFetch('/api/v1/audit/verify-integrity'),
    ]);
    // Auto-logout on expired / invalid token
    if ([wsRes, cRes, iRes, eRes, bRes, jRes, vRes, fRes, aRes].some((r) => r.status === 401)) {
      handleLogout();
      return;
    }
    const ws = await wsRes.json();
    const cs: any[] = await cRes.json();
    const invs: any[] = await iRes.json();
    const exps: any[] = await eRes.json();
    const btxs: any[] = await bRes.json();
    setWorkspace(ws);
    refreshDocuments(ws.id).catch(() => {});
    if (Array.isArray(cs)) {
      setContacts(cs);
      if (!newContactId && cs.length > 0) {
        setNewContactId(cs.find((contact: any) => contact.kind === 'customer' || contact.kind === 'both')?.id ?? '');
      }
      if (!expenseSupplierContactId) {
        setExpenseSupplierContactId(cs.find((contact: any) => contact.kind === 'supplier' || contact.kind === 'both')?.id ?? '');
      }
    }
    if (Array.isArray(invs)) setInvoices(invs);
    if (Array.isArray(exps)) setExpenses(exps);
    if (Array.isArray(btxs)) {
      setBankTransactions(btxs);
      if (!selectedBankTxId && btxs.length > 0) setSelectedBankTxId(btxs[0].id);
    }
    if (!selectedExpenseId && Array.isArray(exps) && exps.length > 0) {
      setSelectedExpenseId(exps[0].id);
    }
    setEntries(await jRes.json());
    setVatSummary(await vRes.json());
    setFecData(await fRes.json());
    setAuditData(await aRes.json());

    if (preserveInspectedId) {
      const updated = invs.find((x: any) => x.id === preserveInspectedId);
      if (updated) setInspectedInvoice(updated);
    }
  }

  useEffect(() => {
    if (!authToken) return;
    refreshAll().catch((err) => notify('error', `Erreur API : ${String(err)}`));
  }, [authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggleRegime() {
    if (!workspace) return;
    const nextMode =
      workspace.accountingMode === 'CASH_MICRO' ? 'DOUBLE_ENTRY_PCG2025' : 'CASH_MICRO';
    const res = await apiFetch('/api/v1/workspaces/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountingMode: nextMode,
        vatRegime: nextMode === 'CASH_MICRO' ? 'FRANCHISE_293B' : 'REEL_NORMAL',
        vatExigibility: 'ENCAISSEMENTS',
      }),
    });
    if (res.ok) {
      notify(
        'success',
        nextMode === 'CASH_MICRO'
          ? 'Mode basculé : Micro-Entreprise (Franchise de TVA Art. 293 B CGI & Livre des recettes)'
          : 'Mode basculé : Société Commerciale (Partie Double PCG 2025, TVA sur encaissements & FEC)'
      );
      await refreshAll(inspectedInvoice?.id);
    }
  }

  async function handleCreateDraft(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch('/api/v1/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentType: newDocType,
        contactId: newContactId,
        issueDate: '2026-10-18',
        deliveryOrServiceDate: '2026-10-18',
        dueDate: '2026-11-17',
        lines: [
          {
            description: newDesc,
            lineNature: 'services',
            quantity: newQty,
            unitCode: 'DAY',
            unitPriceHtMinor: Math.round(Number.parseFloat(newUnitPriceEuros) * 100),
            taxRuleCode:
              workspace?.vatRegime === 'FRANCHISE_293B' ? 'FR_FRANCHISE_293B' : newTaxRule,
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify('error', data.error?.message ?? 'Erreur lors de la création');
      return;
    }
    setShowNewInvoiceModal(false);
    notify('success', `Brouillon ${data.provisionalRef} créé avec calcul TVA EN 16931.`);
    await refreshAll();
    setInspectedInvoice(data);
  }

  async function handleIssueDocument(id: string) {
    const res = await apiFetch(`/api/v1/invoices/${id}/issue`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      notify('error', data.error?.message ?? "Échec de l'émission");
      return;
    }
    notify(
      'success',
      `Facture émise sous le n° ${data.number} ! XML Factur-X (EN 16931), empreinte SHA-256 et écriture VE générés.`
    );
    await refreshAll(id);
  }

  async function handleCreateCreditNote(invoiceId: string) {
    const res = await apiFetch(`/api/v1/invoices/${invoiceId}/credit-notes`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      notify('error', data.error?.message ?? "Échec de l'avoir");
      return;
    }
    notify('success', `Facture d'avoir ${data.number} émise et contre-passée au journal VE !`);
    await refreshAll();
    setInspectedInvoice(data);
  }

  async function handleRecordPayment(invoiceId: string, amountMinor: number, bankTxId?: string) {
    const res = await apiFetch(`/api/v1/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentDate: '2026-10-18',
        amountMinor,
        bankTransactionId: bankTxId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify('error', data.error?.message ?? 'Erreur règlement');
      return;
    }
    notify(
      'success',
      `Encaissement validé, compte client 411000 lettré (${data.letteringCode ?? 'AA'}) et TVA sur encaissements transférée (44574 → 44571) !`
    );
    await refreshAll(invoiceId);
  }

  async function handleReconcileBankGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBankTxId) return;
    const tx = bankTransactions.find((t) => t.id === selectedBankTxId);
    if (!tx) return;

    const chosenIds = Object.keys(selectedGroupDocIds).filter((k) => selectedGroupDocIds[k]);
    if (chosenIds.length === 0) {
      notify('error', 'Veuillez cocher au moins une facture client ou fournisseur à rapprocher.');
      return;
    }

    const allocations = chosenIds.map((id) => {
      const inv = invoices.find((i) => i.id === id);
      if (inv) {
        return {
          documentId: inv.id,
          documentKind: 'invoice' as const,
          amountMinor: inv.netToPayTtcMinor - inv.amountPaidMinor,
        };
      }
      const exp = expenses.find((x) => x.id === id);
      return {
        documentId: exp.id,
        documentKind: 'expense' as const,
        amountMinor: exp.amountTtcMinor,
      };
    });

    const res = await apiFetch(`/api/v1/banking/transactions/${selectedBankTxId}/reconcile-group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allocations }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify('error', data.error?.message ?? 'Erreur lors du rapprochement groupé');
      return;
    }
    setShowGroupMatchModal(false);
    setSelectedGroupDocIds({});
    notify(
      'success',
      `Rapprochement groupé validé (${allocations.length} pièce(s) rapprochée(s) et lettrée(s) sur la transaction bancaire) !`
    );
    await refreshAll();
  }

  async function handleUpdateBankTxStatus(
    txId: string,
    workflowStatus: 'a_traiter' | 'demande_comptable' | 'a_confirmer' | 'rapprochee' | 'supprime',
    commentText?: string
  ) {
    const res = await apiFetch(`/api/v1/banking/transactions/${txId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowStatus, commentText }),
    });
    if (res.ok) {
      setNewBankComment('');
      notify('success', `Statut de la transaction mis à jour (${workflowStatus}).`);
      await refreshAll();
    }
  }

  async function handleAutoLetterAll() {
    const res = await apiFetch('/api/v1/accounting/auto-letter', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      notify('error', data.error?.message ?? 'Erreur de lettrage automatique');
      return;
    }
    notify(
      'success',
      data.groupsLettered > 0
        ? `⚡ Lettrage automatique terminé : ${data.groupsLettered} groupe(s) (${data.linesLettered} écritures 411/401) lettrés avec les codes ${data.assignedCodes.join(', ')} !`
        : '⚡ Lettrage automatique vérifié : tous les soldes auxiliaires équilibrés (411000 / 401000) sont déjà lettrés.'
    );
    await refreshAll();
  }

  async function handleCreateManualEntry(e: React.FormEvent) {
    e.preventDefault();
    const violations = checkJournalEntry(manualJournal, manualDebitAccount, manualCreditAccount);
    const blocking = violations.filter((v) => v.blocking);
    if (blocking.length > 0) {
      notify('error', blocking[0]!.message);
      return;
    }
    const amountMinor = Math.round(Number.parseFloat(manualAmountEuros) * 100);
    const res = await apiFetch('/api/v1/accounting/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        journalCode: manualJournal,
        entryDate: '2026-10-18',
        pieceRef: manualPieceRef,
        description: manualDesc,
        dueDate: manualDueDate,
        invoiceNumber: manualPieceRef,
        lines: [
          {
            accountCode: manualDebitAccount,
            accountLabel: 'Compte débité (PCG 2025)',
            auxiliaryAccountCode: manualDebitAccount === '411000' ? '411CLI0001' : manualDebitAccount === '401000' ? '401FOU0001' : null,
            auxiliaryAccountLabel: manualDebitAccount === '411000' || manualDebitAccount === '401000' ? 'Tiers Auxiliaire' : null,
            description: manualDesc,
            debitMinor: amountMinor,
            creditMinor: 0,
            vatRateLabel: '20% (FR)',
            categoryLabel: 'Saisie Manuelle OD',
          },
          {
            accountCode: manualCreditAccount,
            accountLabel: 'Compte crédité (PCG 2025)',
            auxiliaryAccountCode: manualCreditAccount === '411000' ? '411CLI0001' : manualCreditAccount === '401000' ? '401FOU0001' : null,
            auxiliaryAccountLabel: manualCreditAccount === '411000' || manualCreditAccount === '401000' ? 'Tiers Auxiliaire' : null,
            description: manualDesc,
            debitMinor: 0,
            creditMinor: amountMinor,
            vatRateLabel: 'N/A',
            categoryLabel: 'Saisie Manuelle OD',
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify('error', data.error?.message ?? 'Écriture rejetée (vérifiez PCG 2025 / Compte 79 interdit)');
      return;
    }
    setShowManualEntryModal(false);
    notify(
      'success',
      `Écriture ${data.entryNumber} comptabilisée et scellée SHA-256 au journal ${data.journalCode} !`
    );
    await refreshAll();
  }

  async function handleExpensePaymentState(expenseId: string, paymentState: 'to_pay' | 'paid') {
    const res = await apiFetch(`/api/v1/expenses/${expenseId}/payment-state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentState }),
    });
    if (res.ok) {
      notify(
        'success',
        paymentState === 'paid'
          ? 'Facture fournisseur classée comme "Payée ✓" et validée.'
          : 'Facture fournisseur classée dans "À payer 💳".'
      );
      await refreshAll();
    }
  }

  async function handleExpenseSuggestion(
    expenseId: string,
    transactionId: string,
    action: 'confirm' | 'reject'
  ) {
    const res = await apiFetch(`/api/v1/expenses/${expenseId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, action }),
    });
    if (res.ok) {
      notify(
        'success',
        action === 'confirm'
          ? "✨ Suggestion confirmée ! Facture d'achat rapprochée avec la transaction bancaire et lettrée (401000)."
          : 'Suggestion de transaction écartée.'
      );
      await refreshAll();
    }
  }

  async function handleCreateExpense(e: React.FormEvent) {
    e.preventDefault();
    const supplier = contacts.find((contact) => contact.id === expenseSupplierContactId
      && (contact.kind === 'supplier' || contact.kind === 'both'));
    if (!supplier) {
      notify('error', "Ajoutez ou sélectionnez un fournisseur avant de créer la facture d'achat.");
      return;
    }

    const res = await apiFetch('/api/v1/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierContactId: supplier.id,
        supplierInvoiceRef: expRef,
        expenseDate: expDate,
        description: expDesc,
        accountingAccountCode: expAccount,
        taxRuleCode: 'FR_TVA_20',
        deductibilityRatio: expRatio,
        amountHtMinor: Math.round(Number.parseFloat(expHtEuros) * 100),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify('error', data.error?.message ?? 'Erreur dépense');
      return;
    }
    setShowNewExpenseModal(false);
    if (expFile && !expExtractedDocId) {
      await uploadDocumentFile(expFile);
    }
    setExpFile(null);
    setExpExtractedDocId(null);
    notify(
      'success',
      `Facture d'achat ${data.supplierInvoiceRef} ventilée au journal AC (TVA déductible : ${formatMinor(data.vatDeductibleMinor)}).`
    );
    await refreshAll();
    setSelectedExpenseId(data.id);
  }

  async function handleCreateContact(e: React.FormEvent) {
    e.preventDefault();
    if (!contactName.trim()) {
      notify('error', 'La raison sociale ou le nom du tiers est obligatoire.');
      return;
    }
    if (contactIsBusiness && !contactSiren.trim()) {
      notify('error', 'Le SIREN est requis pour créer un tiers professionnel français.');
      return;
    }
    if (contactIsBusiness && contactSiren.trim().length !== 9) {
      notify('error', 'Le SIREN doit contenir exactement 9 chiffres.');
      return;
    }
    setContactSaving(true);
    try {
      const res = await apiFetch('/api/v1/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: contactKind,
          isBusiness: contactIsBusiness,
          taxZone: 'DOMESTIC_FR',
          legalName: contactName,
          siren: contactSiren.trim() || null,
          email: contactEmail.trim(),
          billingAddress: {
            streetLine1: contactStreet.trim(),
            postalCode: contactPostalCode.trim(),
            city: contactCity.trim(),
            countryCode: 'FR',
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error?.message ?? data.message ?? 'Erreur création tiers');
        return;
      }
      setContactName('');
      setContactSiren('');
      setContactEmail('');
      setContactStreet('');
      setContactPostalCode('');
      setContactCity('');
      if (data.kind === 'customer' || data.kind === 'both') setNewContactId(data.id);
      if (data.kind === 'supplier' || data.kind === 'both') {
        setExpenseSupplierContactId(data.id);
        setDocPostSupplierContactId(data.id);
      }
      await refreshAll();
      setContactCreatedData({ id: data.id, legalName: data.legalName, kind: data.kind });
    } catch {
      notify('error', 'Le serveur ne répond pas. Vérifiez que le serveur Haxatax est démarré, puis réessayez.');
    } finally {
      setContactSaving(false);
    }
  }

  function openContactCreate(kind: 'customer' | 'supplier' | 'both', context: 'directory' | 'invoice' | 'expense' | 'document' = 'directory') {
    setContactKind(kind);
    setContactCreateContext(context);
    setContactCreatedData(null);
    setShowNewContactModal(true);
  }

  function downloadFile(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadFecAsHtmlPdf(content: string, filename: string) {
    const lines = content.split('\n').filter((l) => l.trim());
    if (!lines.length) return;
    const headers = (lines[0] ?? '').split('\t');
    const rows = lines.slice(1).map((l) => l.split('\t'));
    const pdfName = filename.replace(/\.txt$/i, '.pdf');
    const today = new Date().toLocaleDateString('fr-FR');
    const thCells = headers.map((h) => `<th>${h}</th>`).join('');
    const bodyRows = rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>FEC — ${pdfName}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:8px;margin:8mm;color:#111}
  h1{font-size:13px;color:#00382b;margin-bottom:4px}
  p{font-size:8px;color:#555;margin-bottom:10px}
  table{border-collapse:collapse;width:100%}
  th{background:#00382b;color:white;padding:3px 4px;text-align:left;font-size:7px;white-space:nowrap}
  td{border-bottom:1px solid #e2e8f0;padding:2px 4px;font-size:7px}
  tr:nth-child(even) td{background:#f8fafc}
  @media print{@page{size:A4 landscape;margin:8mm}}
</style>
</head>
<body>
<h1>FEC — Fichier d'Écritures Comptables</h1>
<p>Fichier : ${pdfName} · Exporté le ${today}</p>
<table><thead><tr>${thCells}</tr></thead><tbody>${bodyRows}</tbody></table>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.addEventListener('load', () => { win.print(); URL.revokeObjectURL(url); });
    } else {
      URL.revokeObjectURL(url);
    }
  }

  // Computed metrics for Sales Pipeline Cards (Screenshot 3 style)
  const salesStats = useMemo(() => {
    const pickAmt = (inv: any) =>
      amountDisplayMode === 'TTC' ? inv.totalTtcMinor : inv.subtotalHtMinor;
    const drafts = invoices.filter((i) => i.status === 'draft');
    const unpaid = invoices.filter(
      (i) => i.status === 'issued' && i.paymentStatus !== 'paid' && i.documentType !== 'credit_note'
    );
    const paid = invoices.filter((i) => i.status === 'issued' && i.paymentStatus === 'paid');
    const creditNotes = invoices.filter((i) => i.documentType === 'credit_note');

    return {
      draftCount: drafts.length,
      draftAmount: drafts.reduce((s, i) => s + pickAmt(i), 0),
      unpaidCount: unpaid.length,
      unpaidAmount: unpaid.reduce((s, i) => s + (i.netToPayTtcMinor - i.amountPaidMinor), 0),
      paidCount: paid.length,
      paidAmount: paid.reduce((s, i) => s + pickAmt(i), 0),
      creditCount: creditNotes.length,
      creditAmount: creditNotes.reduce((s, i) => s + pickAmt(i), 0),
    };
  }, [invoices, amountDisplayMode]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (pipelineFilter === 'draft' && inv.status !== 'draft') return false;
      if (
        pipelineFilter === 'unpaid' &&
        !(inv.status === 'issued' && inv.paymentStatus !== 'paid' && inv.documentType !== 'credit_note')
      ) {
        return false;
      }
      if (pipelineFilter === 'paid' && !(inv.status === 'issued' && inv.paymentStatus === 'paid')) {
        return false;
      }
      if (
        pipelineFilter === 'reconciled' &&
        !(inv.status === 'issued' && inv.paymentStatus === 'paid')
      ) {
        return false;
      }
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const num = (inv.number ?? inv.provisionalRef ?? '').toLowerCase();
        const cli = (inv.contactLegalName ?? '').toLowerCase();
        if (!num.includes(q) && !cli.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, pipelineFilter, searchQuery]);

  // ── Report / Settings state ────────────────────────────────────────────────
  const [reportTab, setReportTab] = useState<'pl' | 'balance' | 'fec'>('pl');
  const [selectedGLEntryId, setSelectedGLEntryId] = useState<string | null>(null);
  const [drilldownAccountCode, setDrilldownAccountCode] = useState<string | null>(null);
  const [drilldownAccountLabel, setDrilldownAccountLabel] = useState<string>('');

  const [cycleChecked, setCycleChecked] = useState<Record<CycleKey, Record<string, boolean>>>(() => {
    try {
      const saved = localStorage.getItem('hx_cycle_checked');
      return saved ? JSON.parse(saved) : { quotidien: {}, mensuel: {}, annuel: {} };
    } catch {
      return { quotidien: {}, mensuel: {}, annuel: {} };
    }
  });

  useEffect(() => {
    try { localStorage.setItem('hx_cycle_checked', JSON.stringify(cycleChecked)); } catch { /* ignore */ }
  }, [cycleChecked]);

  function toggleCycleTask(cycle: CycleKey, taskId: string) {
    setCycleChecked((prev) => ({
      ...prev,
      [cycle]: { ...prev[cycle], [taskId]: !prev[cycle][taskId] },
    }));
  }

  function resetCycle(cycle: CycleKey) {
    setCycleChecked((prev) => ({ ...prev, [cycle]: {} }));
  }

  // ── Écritures d'inventaire state ──────────────────────────────────────────
  const [inventaireTab, setInventaireTab] = useState<'paie' | 'amortissements' | 'provisions' | 'ccafnp'>('paie');

  const today = new Date().toISOString().slice(0, 10);

  // Paie
  const [paieDate, setPaieDate] = useState(today);
  const [paieSalaire, setPaieSalaire] = useState('');
  const [paieCharges, setPaieCharges] = useState('');
  const [paieDesc, setPaieDesc] = useState('Centralisation paie');
  const [paieSaving, setPaieSaving] = useState(false);

  // Amortissements
  const [amortDate, setAmortDate] = useState(today);
  const [amortDebit, setAmortDebit] = useState('681120');
  const [amortCredit, setAmortCredit] = useState('281500');
  const [amortAmount, setAmortAmount] = useState('');
  const [amortDesc, setAmortDesc] = useState('Dotation aux amortissements');
  const [amortSaving, setAmortSaving] = useState(false);

  // Provisions
  const [provDate, setProvDate] = useState(today);
  const [provType, setProvType] = useState<'risques' | 'creances'>('risques');
  const [provAmount, setProvAmount] = useState('');
  const [provDesc, setProvDesc] = useState('');
  const [provSaving, setProvSaving] = useState(false);

  // CCA / FNP
  const [ccaDate, setCcaDate] = useState(today);
  const [ccaType, setCcaType] = useState<'cca' | 'fnp'>('cca');
  const [ccaSourceAccount, setCcaSourceAccount] = useState('613500');
  const [ccaAmount, setCcaAmount] = useState('');
  const [ccaDesc, setCcaDesc] = useState('');
  const [ccaSaving, setCcaSaving] = useState(false);

  const [settingsForm, setSettingsForm] = useState<{
    legalName: string; tradeName: string; siren: string; vatNumber: string;
    legalForm: string; vatRegime: string; vatExigibility: string; accountingMode: string;
    streetLine1: string; postalCode: string; city: string;
  } | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Init settingsForm when user opens settings
  useEffect(() => {
    if (section === 'settings' && workspace && settingsForm === null) {
      setSettingsForm({
        legalName: workspace.legalName ?? '',
        tradeName: workspace.tradeName ?? '',
        siren: workspace.siren ?? '',
        vatNumber: workspace.vatNumber ?? '',
        legalForm: workspace.legalForm ?? 'SAS',
        vatRegime: workspace.vatRegime ?? 'REEL_NORMAL',
        vatExigibility: workspace.vatExigibility ?? 'DEBITS',
        accountingMode: workspace.accountingMode ?? 'DOUBLE_ENTRY_PCG2025',
        streetLine1: workspace.registeredAddress?.streetLine1 ?? '',
        postalCode: workspace.registeredAddress?.postalCode ?? '',
        city: workspace.registeredAddress?.city ?? '',
      });
    }
  }, [section, workspace]);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settingsForm) return;
    setSettingsSaving(true);
    try {
      const res = await apiFetch('/api/v1/workspaces/current', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: settingsForm.legalName,
          siren: settingsForm.siren,
          vatNumber: settingsForm.vatNumber,
          legalForm: settingsForm.legalForm,
          vatRegime: settingsForm.vatRegime,
          vatExigibility: settingsForm.vatExigibility,
          accountingMode: settingsForm.accountingMode,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: { message?: string } };
        notify('error', err.error?.message ?? 'Erreur lors de la mise à jour');
        return;
      }
      const updated = await res.json();
      setWorkspace(updated);
      notify('success', 'Paramètres enregistrés avec succès');
    } finally {
      setSettingsSaving(false);
    }
  }

  // ── Écritures d'inventaire handlers ─────────────────────────────────────

  async function handlePostPayroll(e: React.FormEvent) {
    e.preventDefault();
    const salMinor = Math.round(parseFloat(paieSalaire) * 100);
    const chgMinor = Math.round(parseFloat(paieCharges) * 100);
    if (!salMinor || !chgMinor) { notify('error', 'Saisir les montants salaires et charges'); return; }
    setPaieSaving(true);
    try {
      const res = await apiFetch('/api/v1/accounting/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          journalCode: 'OD',
          entryDate: paieDate,
          pieceRef: `PAIE-${paieDate.slice(0, 7)}`,
          description: paieDesc,
          lines: [
            { accountCode: '641100', accountLabel: 'Rémunérations du personnel', description: paieDesc, debitMinor: salMinor, creditMinor: 0, categoryLabel: 'Paie' },
            { accountCode: '645100', accountLabel: 'Cotisations sociales patronales', description: paieDesc, debitMinor: chgMinor, creditMinor: 0, categoryLabel: 'Paie' },
            { accountCode: '421000', accountLabel: 'Personnel — rémunérations dues', description: paieDesc, debitMinor: 0, creditMinor: salMinor, categoryLabel: 'Paie' },
            { accountCode: '431000', accountLabel: 'Sécurité sociale', description: paieDesc, debitMinor: 0, creditMinor: chgMinor, categoryLabel: 'Paie' },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) { notify('error', data.error?.message ?? 'Erreur'); return; }
      notify('success', `Écriture de paie ${data.entryNumber} comptabilisée !`);
      setPaieSalaire(''); setPaieCharges('');
      await refreshAll();
    } finally { setPaieSaving(false); }
  }

  async function handlePostAmort(e: React.FormEvent) {
    e.preventDefault();
    const minor = Math.round(parseFloat(amortAmount) * 100);
    if (!minor) { notify('error', 'Saisir un montant'); return; }
    setAmortSaving(true);
    try {
      const res = await apiFetch('/api/v1/accounting/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          journalCode: 'OD',
          entryDate: amortDate,
          pieceRef: `AMORT-${amortDate.slice(0, 7)}`,
          description: amortDesc,
          lines: [
            { accountCode: amortDebit, accountLabel: 'Dotations aux amortissements', description: amortDesc, debitMinor: minor, creditMinor: 0, categoryLabel: 'Amortissement' },
            { accountCode: amortCredit, accountLabel: 'Amortissements des immobilisations', description: amortDesc, debitMinor: 0, creditMinor: minor, categoryLabel: 'Amortissement' },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) { notify('error', data.error?.message ?? 'Erreur'); return; }
      notify('success', `Dotation d'amortissement ${data.entryNumber} comptabilisée !`);
      setAmortAmount('');
      await refreshAll();
    } finally { setAmortSaving(false); }
  }

  async function handlePostProvision(e: React.FormEvent) {
    e.preventDefault();
    const minor = Math.round(parseFloat(provAmount) * 100);
    if (!minor || !provDesc) { notify('error', 'Saisir montant et libellé'); return; }
    setProvSaving(true);
    const debitAcc = provType === 'risques' ? '681600' : '681740';
    const creditAcc = provType === 'risques' ? '151000' : '491000';
    const debitLabel = provType === 'risques' ? 'Dotations aux provisions pour risques' : 'Dotations aux provisions pour dépréciation créances';
    const creditLabel = provType === 'risques' ? 'Provisions pour risques' : 'Provisions pour dépréciation des créances clients';
    try {
      const res = await apiFetch('/api/v1/accounting/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          journalCode: 'OD',
          entryDate: provDate,
          pieceRef: `PROV-${provDate.slice(0, 7)}`,
          description: provDesc,
          lines: [
            { accountCode: debitAcc, accountLabel: debitLabel, description: provDesc, debitMinor: minor, creditMinor: 0, categoryLabel: 'Provision' },
            { accountCode: creditAcc, accountLabel: creditLabel, description: provDesc, debitMinor: 0, creditMinor: minor, categoryLabel: 'Provision' },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) { notify('error', data.error?.message ?? 'Erreur'); return; }
      notify('success', `Provision ${data.entryNumber} comptabilisée !`);
      setProvAmount(''); setProvDesc('');
      await refreshAll();
    } finally { setProvSaving(false); }
  }

  async function handlePostCcaFnp(e: React.FormEvent) {
    e.preventDefault();
    const minor = Math.round(parseFloat(ccaAmount) * 100);
    if (!minor || !ccaDesc) { notify('error', 'Saisir montant et libellé'); return; }
    setCcaSaving(true);
    const debitAcc = ccaType === 'cca' ? '486000' : ccaSourceAccount;
    const creditAcc = ccaType === 'cca' ? ccaSourceAccount : '408000';
    const debitLabel = ccaType === 'cca' ? "Charges constatées d'avance" : `Charge (${ccaSourceAccount})`;
    const creditLabel = ccaType === 'cca' ? `Charge reportée (${ccaSourceAccount})` : 'Fournisseurs — factures non parvenues';
    try {
      const res = await apiFetch('/api/v1/accounting/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          journalCode: 'OD',
          entryDate: ccaDate,
          pieceRef: `${ccaType.toUpperCase()}-${ccaDate.slice(0, 7)}`,
          description: ccaDesc,
          lines: [
            { accountCode: debitAcc, accountLabel: debitLabel, description: ccaDesc, debitMinor: minor, creditMinor: 0, categoryLabel: ccaType.toUpperCase() },
            { accountCode: creditAcc, accountLabel: creditLabel, description: ccaDesc, debitMinor: 0, creditMinor: minor, categoryLabel: ccaType.toUpperCase() },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) { notify('error', data.error?.message ?? 'Erreur'); return; }
      notify('success', `Écriture ${ccaType.toUpperCase()} ${data.entryNumber} comptabilisée !`);
      setCcaAmount(''); setCcaDesc('');
      await refreshAll();
    } finally { setCcaSaving(false); }
  }

  // TVA rate breakdown from issued invoices
  const vatBreakdown = useMemo(() => {
    const map: Record<string, { rate: string; taxBaseMinor: number; vatAmountMinor: number }> = {};
    for (const inv of invoices) {
      const sign = inv.documentType === 'credit_note' ? -1 : 1;
      for (const tb of (inv.taxBreakdowns ?? [])) {
        const rate = String(tb.vatRatePercent ?? '20');
        if (!map[rate]) map[rate] = { rate, taxBaseMinor: 0, vatAmountMinor: 0 };
        map[rate]!.taxBaseMinor += (tb.taxableBaseMinor ?? 0) * sign;
        map[rate]!.vatAmountMinor += (tb.vatAmountMinor ?? 0) * sign;
      }
    }
    return Object.values(map).sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));
  }, [invoices]);

  // P&L report (comptes 6xx = charges, 7xx = produits)
  const plReport = useMemo(() => {
    const charges: Record<string, { code: string; label: string; soldeMinor: number }> = {};
    const produits: Record<string, { code: string; label: string; soldeMinor: number }> = {};
    for (const entry of entries) {
      for (const line of (entry.lines ?? [])) {
        const code: string = line.accountCode ?? '';
        if (code.startsWith('6')) {
          if (!charges[code]) charges[code] = { code, label: line.accountLabel ?? code, soldeMinor: 0 };
          charges[code]!.soldeMinor += (line.debitMinor ?? 0) - (line.creditMinor ?? 0);
        } else if (code.startsWith('7')) {
          if (!produits[code]) produits[code] = { code, label: line.accountLabel ?? code, soldeMinor: 0 };
          produits[code]!.soldeMinor += (line.creditMinor ?? 0) - (line.debitMinor ?? 0);
        }
      }
    }
    const chargesRows = Object.values(charges).sort((a, b) => a.code.localeCompare(b.code));
    const produitsRows = Object.values(produits).sort((a, b) => a.code.localeCompare(b.code));
    const totalCharges = chargesRows.reduce((s, r) => s + r.soldeMinor, 0);
    const totalProduits = produitsRows.reduce((s, r) => s + r.soldeMinor, 0);
    return { chargesRows, produitsRows, totalCharges, totalProduits, resultNet: totalProduits - totalCharges };
  }, [entries]);

  // Balance générale (all accounts)
  const balanceReport = useMemo(() => {
    const map: Record<string, { code: string; label: string; debitMinor: number; creditMinor: number }> = {};
    for (const entry of entries) {
      for (const line of (entry.lines ?? [])) {
        const code: string = line.accountCode ?? '';
        if (!map[code]) map[code] = { code, label: line.accountLabel ?? code, debitMinor: 0, creditMinor: 0 };
        map[code]!.debitMinor += line.debitMinor ?? 0;
        map[code]!.creditMinor += line.creditMinor ?? 0;
      }
    }
    return Object.values(map).sort((a, b) => a.code.localeCompare(b.code));
  }, [entries]);

  const unmatchedBankCount = bankTransactions.filter((t) => t.status === 'unmatched').length;

  // ── Landing page (unauthenticated visitors) ────────────────────────────────
  if (!authToken && showLanding) {
    return <LandingPage onLoginClick={() => setShowLanding(false)} />;
  }

  // ── Login screen ───────────────────────────────────────────────────────────
  if (!authToken) {
    return (
      <LoginPage
        onSuccess={(token) => setAuthToken(token)}
        onBackToLanding={() => setShowLanding(true)}
      />
    );
  }

  return (
    <div>
      <SkipNav />
      {/* ====================================================================
          TOP DARK EMERALD COMMAND HEADER (Screenshot 4)
         ==================================================================== */}
      <header className="pl-topbar">
        <div className="pl-topbar-left">
          <div className="pl-logo" onClick={() => setSection('pilotage')}>
            <span className="pl-logo-mark">H</span>
            <span>haxatax</span>
          </div>

          <div className="pl-company-selector">
            <span className="pl-company-avatar">H</span>
            <span>{workspace?.legalName ?? 'Haxatax Conseil SAS'}</span>
            <span style={{ opacity: 0.65, fontSize: '0.74rem' }}>
              ({workspace?.accountingMode === 'CASH_MICRO' ? 'Micro 293 B' : 'PCG 2025'})
            </span>
          </div>

          <button
            type="button"
            className="pl-mode-btn"
            onClick={handleToggleRegime}
            title="Basculer entre Micro-entreprise et Société PCG 2025"
          >
            ⇄ Basculer {workspace?.accountingMode === 'CASH_MICRO' ? '→ Société PCG 2025' : '→ Micro-Entreprise'}
          </button>
        </div>

        <div className="pl-topbar-right">
          <span className="pl-sync-pill">
            <span>●</span> 3 comptes bancaires synchronisés · Factur-X PDP Actif
          </span>

          <button
            type="button"
            className={`pl-mode-btn ${section === 'showcase' ? 'active' : ''}`}
            onClick={() => setSection(section === 'showcase' ? 'pilotage' : 'showcase')}
          >
            ✨ {section === 'showcase' ? "Retour à l'Application" : 'Présentation Bento & Factur-X'}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            title="Se déconnecter"
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.25)', color: 'rgba(255,255,255,0.75)', borderRadius: 7, padding: '5px 12px', fontSize: '0.8rem', cursor: 'pointer' }}
          >
            Déconnexion
          </button>
        </div>
      </header>

      {/* ====================================================================
          MAIN APPLICATION SHELL (Sidebar + Dynamic Canvas)
         ==================================================================== */}
      <div className="pl-shell">
        <aside className="pl-sidebar" aria-label="Menu principal">
          <div>
            <div className="pl-nav-group-label">Gestion & Pilotage</div>
            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'pilotage' ? 'page' : undefined}
              onClick={() => setSection('pilotage')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18" />
                  <path d="m19 9-5 5-4-4-3 3" />
                </svg>
                <span>Pilotage & Trésorerie</span>
              </span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'sales' ? 'page' : undefined}
              onClick={() => {
                setSection('sales');
                setPipelineFilter('all');
              }}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                <span>Facturation Client</span>
              </span>
              <span className="pl-nav-count">{invoices.length}</span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'purchases' ? 'page' : undefined}
              onClick={() => setSection('purchases')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
                <span>Tous les achats</span>
              </span>
              <span className="pl-nav-count">{expenses.length}</span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'banking' ? 'page' : undefined}
              onClick={() => setSection('banking')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="22" x2="21" y2="22" />
                  <line x1="6" y1="18" x2="6" y2="11" />
                  <line x1="10" y1="18" x2="10" y2="11" />
                  <line x1="14" y1="18" x2="14" y2="11" />
                  <line x1="18" y1="18" x2="18" y2="11" />
                  <polygon points="12 2 20 7 4 7" />
                </svg>
                <span>Transactions & Banque</span>
              </span>
              {unmatchedBankCount > 0 && (
                <span className="pl-nav-count" style={{ background: '#fee2e2', color: '#dc2626' }}>
                  {unmatchedBankCount}
                </span>
              )}
            </button>

            <div className="pl-nav-group-label" style={{ marginTop: '0.85rem' }}>
              Comptabilité & Normes
            </div>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'accounting' ? 'page' : undefined}
              onClick={() => setSection('accounting')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                <span>Grand Livre, TVA & FEC</span>
              </span>
              <span className="pl-nav-count">{entries.length}</span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'contacts' ? 'page' : undefined}
              onClick={() => setSection('contacts')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>Tiers (SIREN / VIES)</span>
              </span>
              <span className="pl-nav-count">{contacts.length}</span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'documents' ? 'page' : undefined}
              onClick={() => setSection('documents')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span>Documents & Import</span>
              </span>
              <span className="pl-nav-count">{documents.filter((d: any) => d.status === 'analyzed' || d.status === 'pending').length || ''}</span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'showcase' ? 'page' : undefined}
              onClick={() => setSection('showcase')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span>Vue Produit (Bento)</span>
              </span>
            </button>
            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'vat' ? 'page' : undefined}
              onClick={() => setSection('vat')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 14L15 8M9 8h6v6" />
                  <rect x="2" y="3" width="20" height="18" rx="2" />
                </svg>
                <span>TVA</span>
              </span>
            </button>
            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'reports' ? 'page' : undefined}
              onClick={() => setSection('reports')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18" />
                  <path d="M7 16l4-4 4 4 4-6" />
                </svg>
                <span>Rapports</span>
              </span>
            </button>
            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'settings' ? 'page' : undefined}
              onClick={() => setSection('settings')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Paramètres</span>
              </span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'cycle' ? 'page' : undefined}
              onClick={() => setSection('cycle')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                <span>Cycles comptables</span>
              </span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'inventaire' ? 'page' : undefined}
              onClick={() => setSection('inventaire')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span>Écritures d'inventaire</span>
              </span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'integrations' ? 'page' : undefined}
              onClick={() => setSection('integrations')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                  <line x1="12" y1="12" x2="12" y2="16" />
                  <line x1="10" y1="14" x2="14" y2="14" />
                </svg>
                <span>Intégrations</span>
              </span>
            </button>

            <button
              type="button"
              className="pl-nav-item"
              aria-current={section === 'team' ? 'page' : undefined}
              onClick={() => setSection('team')}
            >
              <span className="pl-nav-item-left">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>Équipe & Rôles</span>
              </span>
              <span className="pl-nav-count">{teamMembers.length}</span>
            </button>
          </div>

          <div
            style={{
              background: 'var(--brand-sage-bg)',
              border: '1px solid var(--brand-sage-border)',
              borderRadius: '10px',
              padding: '0.75rem',
              fontSize: '0.75rem',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--brand-forest)', marginBottom: '0.2rem' }}>
              ✓ Conformité France & UE
            </div>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              PCG 2025 · Factur-X EN 16931 · FEC 18 col · Piste d'audit SHA-256 ({auditData?.verification?.checkedCount ?? 0} blocs)
            </div>
          </div>
        </aside>

        <main id="main-content" className="pl-workspace">
          {toast && (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem 1.1rem',
                marginBottom: '1.15rem',
                borderRadius: '10px',
                fontWeight: 600,
                fontSize: '0.85rem',
                background: toast.type === 'success' ? '#ecfdf5' : '#fef2f2',
                color: toast.type === 'success' ? '#065f46' : '#991b1b',
                border: `1px solid ${toast.type === 'success' ? '#6ee7b7' : '#fca5a5'}`,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800, color: 'inherit' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* ================================================================
              SECTION 1: PILOTAGE & PLAN DE TRÉSORERIE (Screenshot 4!)
             ================================================================ */}
          {section === 'pilotage' && (
            <div>
              <div className="pl-page-header">
                <div className="pl-page-title-row">
                  <h1 className="pl-page-title">Pilotage</h1>
                  <span className="pl-page-meta">
                    ● Mis à jour en temps réel · SIREN {workspace?.siren} · TVA {workspace?.vatNumber}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center' }}>
                  <span className="pl-chip">Tous les comptes bancaires (512100) ▾</span>
                  <span className="pl-chip">Flux HT / TTC ▾</span>
                  {fecData && (
                    <button
                      type="button"
                      className="pl-btn pl-btn-outline"
                      onClick={() => downloadFecAsHtmlPdf(fecData.content, fecData.filename)}
                    >
                      ↓ Exporter le FEC ({fecData.filename.replace(/\.txt$/i, '.pdf')})
                    </button>
                  )}
                  <button
                    type="button"
                    className="pl-btn pl-btn-forest"
                    onClick={() => {
                      setSection('sales');
                      setShowNewInvoiceModal(true);
                    }}
                  >
                    + Nouvelle facture Factur-X
                  </button>
                </div>
              </div>

              <div className="pl-subtabs">
                <button
                  type="button"
                  className={`pl-subtab ${pilotageTab === 'tresorerie' ? 'active' : ''}`}
                  onClick={() => setPilotageTab('tresorerie')}
                >
                  Plan de trésorerie
                </button>
                <button
                  type="button"
                  className={`pl-subtab ${pilotageTab === 'dashboard' ? 'active' : ''}`}
                  onClick={() => setPilotageTab('dashboard')}
                >
                  Tableau de bord d'activité
                </button>
                <button
                  type="button"
                  className={`pl-subtab ${pilotageTab === 'tva' ? 'active' : ''}`}
                  onClick={() => setPilotageTab('tva')}
                >
                  Cadrage de TVA (CA3 — {workspace?.vatExigibility})
                </button>
              </div>

              {pilotageTab === 'tresorerie' && (
                <>
              {/* Screenshot 4 Layout: Left KPI Stack + Right Interactive Combo Chart */}
              <div className="pl-pilotage-grid">
                <div className="pl-kpi-stack">
                  <div className="pl-kpi-box">
                    <div className="pl-kpi-box-header">
                      <span style={{ color: '#059669' }}>↗</span> SOLDE DE TRÉSORERIE
                    </div>
                    <div className="pl-kpi-box-value-row">
                      <span className="pl-kpi-box-value">235 035,17 €</span>
                      <span className="pl-trend-pill up">+20,4%</span>
                    </div>
                  </div>

                  <div className="pl-kpi-box">
                    <div className="pl-kpi-box-header">
                      <span style={{ color: '#3b82f6' }}>▣</span> ENCAISSEMENTS (TTC)
                    </div>
                    <div className="pl-kpi-box-value-row">
                      <span className="pl-kpi-box-value">214 541,50 €</span>
                      <span className="pl-trend-pill up">+6,55%</span>
                    </div>
                  </div>

                  <div className="pl-kpi-box">
                    <div className="pl-kpi-box-header">
                      <span style={{ color: '#f97316' }}>▣</span> DÉCAISSEMENTS (TTC)
                    </div>
                    <div className="pl-kpi-box-value-row">
                      <span className="pl-kpi-box-value">189 467,34 €</span>
                      <span className="pl-trend-pill up">+15,75%</span>
                    </div>
                  </div>

                  <div className="pl-kpi-box">
                    <div className="pl-kpi-box-header">
                      <span>🔥</span> CASHBURN MENSUEL MOYEN
                    </div>
                    <div className="pl-kpi-box-value-row">
                      <span className="pl-kpi-box-value">18 420,00 € /mois</span>
                      <span className="pl-trend-pill warn">+1,50%</span>
                    </div>
                  </div>

                  <div className="pl-kpi-box">
                    <div className="pl-kpi-box-header">
                      <span>⏳</span> RUNWAY PRÉVISIONNEL
                    </div>
                    <div className="pl-kpi-box-value-row">
                      <span className="pl-kpi-box-value">14 mois</span>
                      <span className="pl-trend-pill up">Confortable</span>
                    </div>
                  </div>

                  <div className="pl-kpi-box">
                    <div className="pl-kpi-box-header">
                      <span>🏛</span> TVA NETTE À DÉCAISSER (CA3)
                    </div>
                    <div className="pl-kpi-box-value-row">
                      <span className="pl-kpi-box-value">
                        {formatMinor(vatSummary?.netVatPayableMinor ?? 0)}
                      </span>
                      <span className="pl-trend-pill warn">
                        Attente 44574 : {formatMinor(vatSummary?.collectedPendingCashMinor ?? 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Interactive SVG Cashflow Combo Chart (Screenshot 4) */}
                <div className="pl-chart-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1rem' }}>
                        Évolution de la Trésorerie, Encaissements & Décaissements (Exercice 2026)
                      </h3>
                      <p style={{ margin: '0.15rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        Synchronisé avec le journal de banque (BQ 512100) et les factures Factur-X émises
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.76rem', fontWeight: 600 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: '#6366f1' }} /> Encaissements
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: '#f48c72' }} /> Décaissements
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ width: 14, height: 3, background: '#047857' }} /> Solde de trésorerie
                      </span>
                    </div>
                  </div>

                  <svg
                    viewBox="0 0 820 300"
                    style={{ width: '100%', height: 'auto', overflow: 'visible' }}
                    role="img"
                    aria-label="Graphique du plan de trésorerie mensuel"
                  >
                    {/* Horizontal grid lines */}
                    {[40, 90, 140, 190, 240].map((y, idx) => (
                      <g key={y}>
                        <line x1="20" y1={y} x2="765" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                        <text x="775" y={y + 4} fill="#94a3b8" fontSize="10" fontFamily="Inter">
                          {300 - idx * 60} k€
                        </text>
                      </g>
                    ))}

                    {/* Highlighted Active Month Band (Octobre — like Screenshot 4!) */}
                    <rect x="468" y="15" width="95" height="235" fill="#d1fae5" opacity="0.45" rx="6" />

                    {/* Monthly Bars (Inflows #6366f1 & Outflows #f48c72) */}
                    {[
                      { label: 'Mars', x: 55, inH: 92, outH: 60 },
                      { label: 'Avril', x: 145, inH: 95, outH: 62 },
                      { label: 'Mai', x: 235, inH: 98, outH: 65 },
                      { label: 'Juin', x: 325, inH: 102, outH: 58 },
                      { label: 'Juil.', x: 415, inH: 108, outH: 68 },
                      { label: 'Oct. (Actuel)', x: 505, inH: 128, outH: 72, active: true },
                      { label: 'Nov. (Prév.)', x: 595, inH: 112, outH: 64, dashed: true },
                      { label: 'Déc. (Prév.)', x: 685, inH: 90, outH: 115, dashed: true },
                    ].map((m) => (
                      <g key={m.label}>
                        <rect
                          x={m.x - 14}
                          y={250 - m.inH}
                          width="12"
                          height={m.inH}
                          rx="3"
                          fill={m.dashed ? '#e0e7ff' : '#6366f1'}
                          stroke={m.dashed ? '#6366f1' : 'none'}
                          strokeDasharray={m.dashed ? '3 2' : undefined}
                        />
                        <rect
                          x={m.x + 2}
                          y={250 - m.outH}
                          width="12"
                          height={m.outH}
                          rx="3"
                          fill={m.dashed ? '#ffedd5' : '#f48c72'}
                          stroke={m.dashed ? '#f48c72' : 'none'}
                          strokeDasharray={m.dashed ? '3 2' : undefined}
                        />
                        <text
                          x={m.x}
                          y="272"
                          textAnchor="middle"
                          fill={m.active ? '#00382b' : '#64748b'}
                          fontWeight={m.active ? '700' : '500'}
                          fontSize="11"
                        >
                          {m.label}
                        </text>
                        <text x={m.x} y="286" textAnchor="middle" fill="#94a3b8" fontSize="9.5">
                          2026
                        </text>
                      </g>
                    ))}

                    {/* Smooth Treasury Spline Curve (Solid Historical + Dashed Forecast) */}
                    <path
                      d="M 55 182 C 100 180, 115 175, 145 168 C 185 158, 205 135, 235 122 C 275 105, 295 85, 325 76 C 365 66, 385 64, 415 58 C 455 50, 480 44, 505 42"
                      fill="none"
                      stroke="#047857"
                      strokeWidth="2.5"
                    />
                    <path
                      d="M 505 42 C 540 42, 565 68, 595 86 C 630 108, 655 132, 685 148"
                      fill="none"
                      stroke="#047857"
                      strokeWidth="2.2"
                      strokeDasharray="4 4"
                    />

                    {/* Spline Data Nodes */}
                    {[
                      { x: 55, y: 182 },
                      { x: 145, y: 168 },
                      { x: 235, y: 122 },
                      { x: 325, y: 76 },
                      { x: 415, y: 58 },
                      { x: 505, y: 42 },
                      { x: 595, y: 86 },
                      { x: 685, y: 148 },
                    ].map((pt, i) => (
                      <circle
                        key={i}
                        cx={pt.x}
                        cy={pt.y}
                        r={i === 5 ? 5.5 : 4}
                        fill={i === 5 ? '#00e676' : '#047857'}
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                    ))}
                  </svg>
                </div>
              </div>

              {/* Bottom Monthly Treasury & Objectives Matrix Table (Screenshot 4) */}
              <div className="pl-table-card">
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th style={{ width: '210px' }}>INDICATEURS & OBJECTIFS</th>
                      <th>MARS 2026</th>
                      <th>AVRIL 2026</th>
                      <th>MAI 2026</th>
                      <th>JUIN 2026</th>
                      <th>JUILLET 2026</th>
                      <th style={{ background: '#ecfdf5', color: '#00382b' }}>OCTOBRE 2026 (ACTUEL)</th>
                      <th>NOVEMBRE (PRÉV.)</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    <tr>
                      <td>
                        <strong>Trésorerie en début de mois</strong>
                      </td>
                      <td>142 500,00 €</td>
                      <td>158 200,00 €</td>
                      <td>179 400,00 €</td>
                      <td>198 120,00 €</td>
                      <td>218 900,00 €</td>
                      <td style={{ background: '#f0fdf4', fontWeight: 800, color: '#00382b' }}>
                        235 035,17 €
                      </td>
                      <td style={{ color: '#64748b' }}>248 900,00 €</td>
                    </tr>
                    <tr>
                      <td>
                        <span style={{ color: '#047857', fontWeight: 700 }}>↗ Objectif Chiffre d'Affaires HT</span>
                      </td>
                      <td>
                        <div>18 400,00 €</div>
                        <span className="pl-trend-pill up">92%</span>
                      </td>
                      <td>
                        <div>21 200,00 €</div>
                        <span className="pl-trend-pill up">106%</span>
                      </td>
                      <td>
                        <div>22 021,23 €</div>
                        <span className="pl-trend-pill up">111%</span>
                      </td>
                      <td>
                        <div>19 800,00 €</div>
                        <span className="pl-trend-pill warn">89%</span>
                      </td>
                      <td>
                        <div>24 500,00 €</div>
                        <span className="pl-trend-pill up">117%</span>
                      </td>
                      <td style={{ background: '#f0fdf4' }}>
                        <div style={{ fontWeight: 800 }}>{formatMinor( salesStats.paidAmount + salesStats.unpaidAmount )}</div>
                        <span className="pl-trend-pill up">En cours · Factur-X</span>
                      </td>
                      <td style={{ color: '#64748b' }}>25 000,00 €</td>
                    </tr>
                    <tr>
                      <td>
                        <span style={{ color: '#2563eb', fontWeight: 700 }}>🏛 TVA Collectée Exigible (445710)</span>
                      </td>
                      <td>3 680,00 €</td>
                      <td>4 240,00 €</td>
                      <td>4 404,25 €</td>
                      <td>3 960,00 €</td>
                      <td>4 900,00 €</td>
                      <td style={{ background: '#f0fdf4', fontWeight: 700 }}>
                        {formatMinor(vatSummary?.collectedExigibleMinor ?? 0)}
                      </td>
                      <td style={{ color: '#64748b' }}>5 000,00 €</td>
                    </tr>
                  </tbody>
                </table>
              </div>
                </>
              )}

              {pilotageTab === 'dashboard' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div className="pl-kpi-box">
                      <div className="pl-kpi-box-header"><span style={{ color: '#059669' }}>✓</span> CA ENCAISSÉ</div>
                      <div className="pl-kpi-box-value-row">
                        <span className="pl-kpi-box-value">{formatMinor(salesStats.paidAmount)}</span>
                        <span className="pl-trend-pill up">{salesStats.paidCount} facture{salesStats.paidCount !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div className="pl-kpi-box">
                      <div className="pl-kpi-box-header"><span style={{ color: '#f97316' }}>⏳</span> EN ATTENTE PAIEMENT</div>
                      <div className="pl-kpi-box-value-row">
                        <span className="pl-kpi-box-value">{formatMinor(salesStats.unpaidAmount)}</span>
                        <span className="pl-trend-pill warn">{salesStats.unpaidCount} facture{salesStats.unpaidCount !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div className="pl-kpi-box">
                      <div className="pl-kpi-box-header"><span style={{ color: '#6366f1' }}>✎</span> BROUILLONS EN COURS</div>
                      <div className="pl-kpi-box-value-row">
                        <span className="pl-kpi-box-value">{formatMinor(salesStats.draftAmount)}</span>
                        <span className="pl-trend-pill" style={{ background: '#f1f5f9', color: '#475569' }}>{salesStats.draftCount} brouillon{salesStats.draftCount !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div className="pl-kpi-box">
                      <div className="pl-kpi-box-header"><span style={{ color: '#e11d48' }}>↩</span> AVOIRS ÉMIS</div>
                      <div className="pl-kpi-box-value-row">
                        <span className="pl-kpi-box-value">{formatMinor(salesStats.creditAmount)}</span>
                        <span className="pl-trend-pill" style={{ background: '#fff1f2', color: '#be123c' }}>{salesStats.creditCount} avoir{salesStats.creditCount !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>
                  <div className="pl-table-card">
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-light)' }}>
                      <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Activité Factur-X — Exercice {new Date().getFullYear()}</h2>
                    </div>
                    <table className="pl-table">
                      <thead>
                        <tr>
                          <th>Indicateur</th>
                          <th>Nombre</th>
                          <th>Montant ({amountDisplayMode})</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td><span style={{ color: '#059669', fontWeight: 600 }}>Factures encaissées</span></td>
                          <td>{salesStats.paidCount}</td>
                          <td style={{ fontWeight: 700 }}>{formatMinor(salesStats.paidAmount)}</td>
                        </tr>
                        <tr>
                          <td><span style={{ color: '#f97316', fontWeight: 600 }}>Factures impayées</span></td>
                          <td>{salesStats.unpaidCount}</td>
                          <td style={{ fontWeight: 700 }}>{formatMinor(salesStats.unpaidAmount)}</td>
                        </tr>
                        <tr>
                          <td><span style={{ color: '#6366f1', fontWeight: 600 }}>Brouillons</span></td>
                          <td>{salesStats.draftCount}</td>
                          <td>{formatMinor(salesStats.draftAmount)}</td>
                        </tr>
                        <tr>
                          <td><span style={{ color: '#e11d48', fontWeight: 600 }}>Avoirs</span></td>
                          <td>{salesStats.creditCount}</td>
                          <td>{formatMinor(salesStats.creditAmount)}</td>
                        </tr>
                        <tr style={{ fontWeight: 700, background: '#f8fafc' }}>
                          <td>CA Total (émis)</td>
                          <td>{salesStats.paidCount + salesStats.unpaidCount}</td>
                          <td>{formatMinor(salesStats.paidAmount + salesStats.unpaidAmount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {pilotageTab === 'tva' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
                    <div className="pl-kpi-box">
                      <div className="pl-kpi-box-header">TVA COLLECTÉE EXIGIBLE</div>
                      <div className="pl-kpi-box-value-row">
                        <span className="pl-kpi-box-value">{formatMinor(vatSummary?.collectedExigibleMinor ?? 0)}</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>Cpte 445710</div>
                    </div>
                    {(vatSummary?.collectedPendingCashMinor ?? 0) > 0 && (
                      <div className="pl-kpi-box">
                        <div className="pl-kpi-box-header">TVA EN ATTENTE ENCAISSEMENT</div>
                        <div className="pl-kpi-box-value-row">
                          <span className="pl-kpi-box-value">{formatMinor(vatSummary?.collectedPendingCashMinor ?? 0)}</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>Cpte 445740</div>
                      </div>
                    )}
                    <div className="pl-kpi-box">
                      <div className="pl-kpi-box-header">TVA DÉDUCTIBLE ACHATS</div>
                      <div className="pl-kpi-box-value-row">
                        <span className="pl-kpi-box-value">{formatMinor(vatSummary?.deductiblePurchasesMinor ?? 0)}</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>Cpte 445660</div>
                    </div>
                    <div className="pl-kpi-box" style={{ border: (vatSummary?.netVatPayableMinor ?? 0) > 0 ? '1px solid #fca5a5' : '1px solid #cce8df' }}>
                      <div className="pl-kpi-box-header">
                        {(vatSummary?.vatCreditMinor ?? 0) > 0 ? 'CRÉDIT DE TVA' : 'TVA NETTE À PAYER'}
                      </div>
                      <div className="pl-kpi-box-value-row">
                        <span className="pl-kpi-box-value" style={{ color: (vatSummary?.vatCreditMinor ?? 0) > 0 ? '#059669' : '#dc2626' }}>
                          {formatMinor((vatSummary?.vatCreditMinor ?? 0) > 0 ? vatSummary.vatCreditMinor : (vatSummary?.netVatPayableMinor ?? 0))}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>Cpte 44551</div>
                    </div>
                  </div>
                  <div className="pl-table-card" style={{ marginBottom: '1.5rem' }}>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Ventilation par taux</h2>
                    </div>
                    <table className="pl-table">
                      <thead>
                        <tr>
                          <th>Taux TVA</th>
                          <th>Base HT</th>
                          <th>TVA collectée</th>
                          <th>Régime</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vatBreakdown.length === 0 ? (
                          <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>Aucune facture avec TVA</td></tr>
                        ) : vatBreakdown.map((row) => (
                          <tr key={row.rate}>
                            <td><strong>{row.rate} %</strong></td>
                            <td>{formatMinor(row.taxBaseMinor)}</td>
                            <td style={{ fontWeight: 600 }}>{formatMinor(row.vatAmountMinor)}</td>
                            <td><span style={{ background: '#f0fdf4', color: '#065f46', fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 5 }}>FR TVA {row.rate} %</span></td>
                          </tr>
                        ))}
                        {vatBreakdown.length > 0 && (
                          <tr style={{ fontWeight: 700, background: '#f8fafc' }}>
                            <td>Total</td>
                            <td>{formatMinor(vatBreakdown.reduce((s, r) => s + r.taxBaseMinor, 0))}</td>
                            <td>{formatMinor(vatBreakdown.reduce((s, r) => s + r.vatAmountMinor, 0))}</td>
                            <td />
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '1rem 1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <svg width="18" height="18" fill="none" stroke="#d97706" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#92400e', marginBottom: 3 }}>Télétransmission DGFiP — bientôt disponible</div>
                      <div style={{ fontSize: '0.8rem', color: '#78350f' }}>La génération du formulaire CA3 et la télétransmission via EDI-TDFC seront disponibles dans une prochaine version. En attendant, utilisez les données ci-dessus pour remplir votre déclaration manuellement sur impots.gouv.fr.</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              SECTION 2: TOUTES LES FACTURES CLIENTS (Screenshots 3 & 5!)
             ================================================================ */}
          {section === 'sales' && (
            <div>
              <div className="pl-page-header">
                <div className="pl-page-title-row">
                  <h1 className="pl-page-title">Toutes les factures clients</h1>
                  <span className="pl-page-meta">
                    ⟳ Synchronisé PDP / Factur-X EN 16931 · Cliquez sur une ligne pour ouvrir l'inspecteur PDF/XML
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <button
                    type="button"
                    className="pl-btn pl-btn-forest"
                    onClick={() => setShowNewInvoiceModal(true)}
                  >
                    + Créer une facture / devis / acompte
                  </button>
                </div>
              </div>

              <div className="pl-subtabs">
                <button type="button" className="pl-subtab active">
                  Toutes les factures & avoirs ({invoices.length})
                </button>
                <button
                  type="button"
                  className="pl-subtab"
                  onClick={() => setSection('accounting')}
                >
                  Journal des Ventes (VE) & FEC
                </button>
              </div>

              {/* 5 Interactive Pipeline Status Filter Cards (Screenshot 3!) */}
              <div className="pl-pipeline-grid">
                <button
                  type="button"
                  className={`pl-pipeline-card ${pipelineFilter === 'all' ? 'active-emerald' : ''}`}
                  onClick={() => setPipelineFilter('all')}
                >
                  <div className="pl-pipeline-top">
                    <span className="pl-pipeline-label">📋 TOUS LES DOCUMENTS</span>
                    <span className="pl-pipeline-badge" style={{ background: '#e2e8f0', color: '#334155' }}>
                      {invoices.length}
                    </span>
                  </div>
                  <div>
                    <span className="pl-pipeline-amount">
                      {formatMinor(
                        invoices.reduce(
                          (s, i) =>
                            s + (amountDisplayMode === 'TTC' ? i.totalTtcMinor : i.subtotalHtMinor),
                          0
                        )
                      )}
                    </span>
                    <span className="pl-pipeline-unit">{amountDisplayMode}</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`pl-pipeline-card ${pipelineFilter === 'draft' ? 'active-amber' : ''}`}
                  onClick={() => setPipelineFilter('draft')}
                >
                  <div className="pl-pipeline-top">
                    <span className="pl-pipeline-label">👁 À VALIDER / BROUILLON</span>
                    <span className="pl-pipeline-badge" style={{ background: '#fef3c7', color: '#b45309' }}>
                      {salesStats.draftCount}
                    </span>
                  </div>
                  <div>
                    <span className="pl-pipeline-amount">{formatMinor(salesStats.draftAmount)}</span>
                    <span className="pl-pipeline-unit">{amountDisplayMode}</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`pl-pipeline-card ${pipelineFilter === 'unpaid' ? 'active-coral' : ''}`}
                  onClick={() => setPipelineFilter('unpaid')}
                >
                  <div className="pl-pipeline-top">
                    <span className="pl-pipeline-label">💳 À ENCAISSER</span>
                    <span className="pl-pipeline-badge" style={{ background: '#fee2e2', color: '#dc2626' }}>
                      {salesStats.unpaidCount}
                    </span>
                  </div>
                  <div>
                    <span className="pl-pipeline-amount">{formatMinor(salesStats.unpaidAmount)}</span>
                    <span className="pl-pipeline-unit">TTC</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`pl-pipeline-card ${pipelineFilter === 'paid' ? 'active-blue' : ''}`}
                  onClick={() => setPipelineFilter('paid')}
                >
                  <div className="pl-pipeline-top">
                    <span className="pl-pipeline-label">✓ ENCAISSÉ</span>
                    <span className="pl-pipeline-badge" style={{ background: '#dbeafe', color: '#2563eb' }}>
                      {salesStats.paidCount}
                    </span>
                  </div>
                  <div>
                    <span className="pl-pipeline-amount">{formatMinor(salesStats.paidAmount)}</span>
                    <span className="pl-pipeline-unit">{amountDisplayMode}</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`pl-pipeline-card ${pipelineFilter === 'reconciled' ? 'active-emerald' : ''}`}
                  onClick={() => setPipelineFilter('reconciled')}
                >
                  <div className="pl-pipeline-top">
                    <span className="pl-pipeline-label">⇄ RAPPROCHÉ & LETTRÉ</span>
                    <span className="pl-pipeline-badge" style={{ background: '#d1fae5', color: '#059669' }}>
                      {salesStats.paidCount}
                    </span>
                  </div>
                  <div>
                    <span className="pl-pipeline-amount">{formatMinor(salesStats.paidAmount)}</span>
                    <span className="pl-pipeline-unit">{amountDisplayMode}</span>
                  </div>
                </button>
              </div>

              {/* Filter Chips & HT/TTC Segmented Toggle Bar (Screenshot 3!) */}
              <div className="pl-filter-bar">
                <div className="pl-filter-chips">
                  <div className="pl-search-box">
                    <span>🔍</span>
                    <input
                      type="text"
                      placeholder="Entrez un n° de facture, client..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      aria-label="Rechercher une facture"
                    />
                  </div>
                  <span className="pl-chip">🏷 Statut</span>
                  <span className="pl-chip">📅 Émission</span>
                  <span className="pl-chip">📅 Échéance</span>
                  <span className="pl-chip">🏢 Clients (Tiers)</span>
                  <span className="pl-chip">⚡ Format Factur-X</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <div className="pl-segmented-toggle" role="group" aria-label="Affichage HT ou TTC">
                    <button
                      type="button"
                      className={`pl-segmented-btn ${amountDisplayMode === 'HT' ? 'active' : ''}`}
                      onClick={() => setAmountDisplayMode('HT')}
                    >
                      HT
                    </button>
                    <button
                      type="button"
                      className={`pl-segmented-btn ${amountDisplayMode === 'TTC' ? 'active' : ''}`}
                      onClick={() => setAmountDisplayMode('TTC')}
                    >
                      TTC
                    </button>
                  </div>

                  {fecData && (
                    <button
                      type="button"
                      className="pl-chip"
                      onClick={() => downloadFile(fecData.filename, fecData.content)}
                    >
                      Exporter FEC
                    </button>
                  )}
                </div>
              </div>

              {/* Financial Table (Screenshot 3!) */}
              <div className="pl-table-card">
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input type="checkbox" aria-label="Tout sélectionner" />
                      </th>
                      <th>STATUT</th>
                      <th>ÉMISSION</th>
                      <th>ÉCHÉANCE</th>
                      <th>CLIENT (TIERS)</th>
                      <th>N° DOCUMENT</th>
                      <th style={{ textAlign: 'right' }}>MONTANT {amountDisplayMode}</th>
                      <th style={{ textAlign: 'right' }}>RESTANT DÛ TTC</th>
                      <th>FORMAT / PDP</th>
                      <th style={{ textAlign: 'right' }}>ACTIONS RAPIDES</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {filteredInvoices.map((inv) => {
                      const remaining = inv.netToPayTtcMinor - inv.amountPaidMinor;
                      const isSelected = inspectedInvoice?.id === inv.id;
                      const displayAmount =
                        amountDisplayMode === 'TTC' ? inv.totalTtcMinor : inv.subtotalHtMinor;

                      return (
                        <tr
                          key={inv.id}
                          className={isSelected ? 'selected-row' : ''}
                          onClick={() => {
                            setInspectedInvoice(inv);
                            setInspectorRightTab('justificatif');
                          }}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" aria-label={`Sélectionner ${inv.number ?? inv.provisionalRef}`} />
                          </td>
                          <td>
                            <div className="pl-status-cell">
                              {inv.status === 'draft' ? (
                                <span className="pl-status-pill review">À valider (PROV)</span>
                              ) : inv.paymentStatus === 'paid' ? (
                                <>
                                  <span className="pl-status-pill reconciled">Rapproché</span>
                                  <span className="pl-match-icon-badge" title="Lettré en comptabilité (411000)">
                                    ⇄
                                  </span>
                                </>
                              ) : inv.documentType === 'credit_note' ? (
                                <span className="pl-status-pill paid">Avoir émis</span>
                              ) : (
                                <>
                                  <span className="pl-status-pill pending">À encaisser</span>
                                  <span className="pl-match-icon-badge" title="Scellé SHA-256 & Ventilé VE">
                                    ✓
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                          <td>{formatDateFr(inv.issueDate)}</td>
                          <td>{formatDateFr(inv.dueDate)}</td>
                          <td>
                            <div className="pl-tier-cell">
                              <span
                                className="pl-tier-logo"
                                style={{ background: getAvatarColor(inv.contactLegalName) }}
                              >
                                {getInitials(inv.contactLegalName)}
                              </span>
                              <span>{inv.contactLegalName}</span>
                            </div>
                          </td>
                          <td>
                            <strong className="font-mono" style={{ fontSize: '0.8rem' }}>
                              {inv.number ?? inv.provisionalRef}
                            </strong>
                            {inv.documentType === 'deposit_invoice' && (
                              <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#0369a1', fontWeight: 700 }}>
                                [Acompte]
                              </span>
                            )}
                            {inv.documentType === 'credit_note' && (
                              <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#dc2626', fontWeight: 700 }}>
                                [Avoir]
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>
                            {formatMinor(displayAmount)}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              fontWeight: 600,
                              color: remaining > 0 ? '#dc2626' : '#64748b',
                            }}
                          >
                            {inv.status === 'issued' && inv.documentType !== 'credit_note'
                              ? formatMinor(remaining)
                              : '0,00 €'}
                          </td>
                          <td>
                            <span className="pl-source-pill">
                              {inv.status === 'issued' ? 'Factur-X EN16931' : 'Brouillon'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                              {inv.status === 'draft' && (
                                <button
                                  type="button"
                                  className="pl-btn pl-btn-mint"
                                  onClick={() => handleIssueDocument(inv.id)}
                                >
                                  Émettre Factur-X
                                </button>
                              )}
                              {inv.status === 'issued' &&
                                inv.documentType !== 'credit_note' &&
                                remaining > 0 && (
                                  <>
                                    <button
                                      type="button"
                                      className="pl-btn pl-btn-outline"
                                      onClick={() => handleRecordPayment(inv.id, remaining)}
                                    >
                                      Encaisser
                                    </button>
                                    <button
                                      type="button"
                                      className="pl-btn"
                                      style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', fontSize: '0.78rem' }}
                                      onClick={() => {
                                        setRelanceInvoice(inv);
                                        const tmpl = buildRelanceEmail('polite', inv, workspace?.legalName ?? 'Votre comptable');
                                        setRelanceTemplate('polite');
                                        setRelanceSubject(tmpl.subject);
                                        setRelanceBody(tmpl.body);
                                        setShowRelanceModal(true);
                                      }}
                                    >
                                      ✉ Relancer
                                    </button>
                                  </>
                                )}
                              <button
                                type="button"
                                className="pl-btn pl-btn-outline"
                                onClick={() => setInspectedInvoice(inv)}
                              >
                                Aperçu PDF/XML ❯
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================================================================
              SECTION 3: ACHATS — 3-PANE SPLIT VIEW & BOÎTE DE RÉCEPTION (Image 3!)
             ================================================================ */}
          {section === 'purchases' && (() => {
            const inboxCount = expenses.filter((e) => e.inboxState === 'inbox').length;
            const toPayCount = expenses.filter((e) => e.paymentState === 'to_pay').length;
            const paidCount = expenses.filter((e) => e.paymentState === 'paid').length;

            const filteredExpenses = expenses.filter((e) => {
              if (achatsSubTab === 'inbox') return e.inboxState === 'inbox';
              if (achatsSubTab === 'to_pay') return e.paymentState === 'to_pay';
              if (achatsSubTab === 'paid') return e.paymentState === 'paid';
              return true;
            });

            const activeExpense =
              expenses.find((e) => e.id === selectedExpenseId) ??
              filteredExpenses[0] ??
              expenses[0] ??
              null;

            // Compute up to 3 smart bank transaction suggestions for the active expense (Image 3!)
            const candidateBankSuggestions = activeExpense
              ? bankTransactions
                  .filter(
                    (tx) =>
                      tx.amountMinor < 0 &&
                      !(activeExpense.rejectedTransactionIds ?? []).includes(tx.id)
                  )
                  .sort((a, b) => {
                    const aExact = Math.abs(a.amountMinor) === activeExpense.amountTtcMinor ? 0 : 1;
                    const bExact = Math.abs(b.amountMinor) === activeExpense.amountTtcMinor ? 0 : 1;
                    return aExact - bExact;
                  })
                  .slice(0, 3)
              : [];

            return (
              <div>
                <div className="pl-page-header">
                  <div className="pl-page-title-row">
                    <h1 className="pl-page-title">Factures fournisseurs</h1>
                    <span className="pl-page-meta">
                      🕒 Archivage à valeur probante 10 ans (PAF / NF Z42-013) · OCR IA & Rapprochement SEPA 1-clic
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="pl-btn pl-btn-outline"
                      onClick={() => setShowNewExpenseModal(true)}
                    >
                      + Importer des factures
                    </button>
                  </div>
                </div>

                {/* Sub-tabs matching Image 3: Boîte de réception (3) | À payer (4) | Payé (1) | Tout (5) */}
                <div className="pl-subtabs">
                  <button
                    type="button"
                    className={`pl-subtab ${achatsSubTab === 'inbox' ? 'active' : ''}`}
                    onClick={() => setAchatsSubTab('inbox')}
                  >
                    Boîte de réception{' '}
                    <span
                      style={{
                        marginLeft: 6,
                        background: '#e2e8f0',
                        padding: '1px 6px',
                        borderRadius: 999,
                        fontSize: '0.72rem',
                      }}
                    >
                      {inboxCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${achatsSubTab === 'to_pay' ? 'active' : ''}`}
                    onClick={() => setAchatsSubTab('to_pay')}
                  >
                    À payer{' '}
                    <span
                      style={{
                        marginLeft: 6,
                        background: '#e2e8f0',
                        padding: '1px 6px',
                        borderRadius: 999,
                        fontSize: '0.72rem',
                      }}
                    >
                      {toPayCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${achatsSubTab === 'paid' ? 'active' : ''}`}
                    onClick={() => setAchatsSubTab('paid')}
                  >
                    Payé{' '}
                    <span
                      style={{
                        marginLeft: 6,
                        background: '#e2e8f0',
                        padding: '1px 6px',
                        borderRadius: 999,
                        fontSize: '0.72rem',
                      }}
                    >
                      {paidCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${achatsSubTab === 'all' ? 'active' : ''}`}
                    onClick={() => setAchatsSubTab('all')}
                  >
                    Tout (Vue tableau {expenses.length})
                  </button>
                </div>

                {achatsSubTab !== 'all' && activeExpense ? (
                  /* 3-PANE SPLIT VIEW FROM IMAGE 3! */
                  <div className="pl-achats-3pane">
                    {/* PANE 1 (LEFT): COMPACT SUPPLIER INVOICE LIST */}
                    <div className="pl-achats-list-pane">
                      <div
                        style={{
                          padding: '0.65rem 0.85rem',
                          borderBottom: '1px solid var(--border-light)',
                          display: 'flex',
                          gap: '0.35rem',
                          flexWrap: 'wrap',
                          background: '#f8fafc',
                        }}
                      >
                        <span className="pl-filter-chip">Fournisseur ▾</span>
                        <span className="pl-filter-chip">Date ▾</span>
                        <span className="pl-filter-chip">Statut de paiement ▾</span>
                      </div>

                      {filteredExpenses.map((ex) => {
                        const isSelected = ex.id === activeExpense.id;
                        return (
                          <div
                            key={ex.id}
                            className={`pl-achats-item ${isSelected ? 'active' : ''}`}
                            onClick={() => {
                              setSelectedExpenseId(ex.id);
                              setExpensePdfPage(1);
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              <div className="pl-tier-cell">
                                <span
                                  className="pl-tier-logo"
                                  style={{ background: getAvatarColor(ex.supplierName) }}
                                >
                                  {getInitials(ex.supplierName)}
                                </span>
                                <span style={{ fontSize: '0.84rem', fontWeight: 700 }}>
                                  {ex.supplierName}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {ex.currency === 'USD' && (
                                  <span
                                    style={{
                                      fontSize: '0.7rem',
                                      background: '#f1f5f9',
                                      padding: '1px 5px',
                                      borderRadius: 4,
                                      fontWeight: 700,
                                    }}
                                  >
                                    $
                                  </span>
                                )}
                                <strong className="tabular-nums" style={{ fontSize: '0.88rem' }}>
                                  {ex.currency === 'USD' && ex.foreignAmountTtcMinor
                                    ? `${(ex.foreignAmountTtcMinor / 100).toFixed(2)} $`
                                    : formatMinor(ex.amountTtcMinor)}
                                </strong>
                              </div>
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                fontSize: '0.74rem',
                                color: '#64748b',
                              }}
                            >
                              <span>
                                Émise le {formatDateFr(ex.expenseDate)} ·{' '}
                                <span style={{ color: ex.paymentState === 'to_pay' ? '#dc2626' : '#059669', fontWeight: 600 }}>
                                  Éch. {formatDateFr(ex.dueDate)}
                                </span>
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span className="pl-match-icon-badge" style={{ width: 18, height: 18, fontSize: '0.62rem' }}>
                                  ⇄
                                </span>
                                <span
                                  className={`pl-status-pill ${
                                    ex.paymentState === 'paid' ? 'reconciled' : 'review'
                                  }`}
                                  style={{ padding: '0.12rem 0.45rem', fontSize: '0.68rem' }}
                                >
                                  {ex.paymentState === 'paid' ? 'Payée' : 'Boîte de réception'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* PANE 2 (CENTER): MULTI-PAGE PDF VIEWER WITH GREEN OCR BOXES (Image 3!) */}
                    <div className="pl-achats-pdf-pane">
                      <div className="pl-pdf-toolbar">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span>☰</span>
                          <span>
                            {expensePdfPage} / {activeExpense.pagesCount ?? 2}
                          </span>
                          <button
                            type="button"
                            onClick={() => setExpensePdfPage(1)}
                            style={{
                              background: 'transparent',
                              border: '1px solid #475569',
                              color: '#fff',
                              borderRadius: 4,
                              padding: '1px 6px',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                            }}
                          >
                            ◀
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpensePdfPage(Math.min(activeExpense.pagesCount ?? 2, 2))}
                            style={{
                              background: 'transparent',
                              border: '1px solid #475569',
                              color: '#fff',
                              borderRadius: 4,
                              padding: '1px 6px',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                            }}
                          >
                            ▶
                          </button>
                        </div>
                        <span>- &nbsp; 100% &nbsp; +</span>
                        <div style={{ display: 'flex', gap: '0.65rem' }}>
                          <span style={{ cursor: 'pointer' }} onClick={() => window.print()}>
                            🖨 Imprimer
                          </span>
                        </div>
                      </div>

                      <div className="pl-pdf-canvas-area">
                        {/* Left page thumbnails (1 & 2) */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {[1, 2].slice(0, activeExpense.pagesCount ?? 2).map((p) => (
                            <div
                              key={p}
                              onClick={() => setExpensePdfPage(p)}
                              style={{ cursor: 'pointer' }}
                            >
                              <div
                                className="pl-pdf-thumb"
                                style={{
                                  borderColor: expensePdfPage === p ? '#00e676' : '#64748b',
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 800,
                                    color: '#dc2626',
                                    marginBottom: 4,
                                    fontSize: '6px',
                                  }}
                                >
                                  {getInitials(activeExpense.supplierName)}
                                </div>
                                <div style={{ height: 3, background: '#cbd5e1', marginBottom: 3 }} />
                                <div style={{ height: 14, background: '#ecfdf5', border: '1px solid #10b981', marginBottom: 4 }} />
                                <div style={{ height: 18, background: '#f1f5f9' }} />
                              </div>
                              <div
                                style={{
                                  textAlign: 'center',
                                  color: '#cbd5e1',
                                  fontSize: '0.7rem',
                                  marginTop: 3,
                                }}
                              >
                                {p}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Supplier Invoice A4 Sheet with Green OCR Extraction Highlights */}
                        <div className="pl-a4-sheet">
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              marginBottom: '1.25rem',
                              paddingBottom: '0.85rem',
                              borderBottom: '2px solid #e2e8f0',
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: getAvatarColor(activeExpense.supplierName),
                                  color: '#fff',
                                  fontWeight: 900,
                                  fontSize: '1.05rem',
                                  padding: '0.35rem 0.65rem',
                                  borderRadius: 6,
                                  marginBottom: 6,
                                }}
                              >
                                {getInitials(activeExpense.supplierName)}
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#334155' }}>
                                <span className="pl-ocr-highlight">
                                  <strong>{activeExpense.supplierName}</strong>
                                </span>
                                <br />
                                Service Facturation B2B — France / UE
                              </div>
                            </div>

                            <div style={{ textAlign: 'right', fontSize: '0.73rem' }}>
                              <div style={{ fontWeight: 800, fontSize: '0.88rem', marginBottom: 4 }}>
                                FACTURE FOURNISSEUR (Page {expensePdfPage}/{activeExpense.pagesCount ?? 2})
                              </div>
                              <div>
                                N° de facture :{' '}
                                <span className="pl-ocr-highlight">
                                  <strong>{activeExpense.supplierInvoiceRef}</strong>
                                </span>
                              </div>
                              <div style={{ marginTop: 3 }}>
                                Date d'émission :{' '}
                                <span className="pl-ocr-highlight">
                                  <strong>{formatDateFr(activeExpense.expenseDate)}</strong>
                                </span>
                              </div>
                              <div style={{ marginTop: 3 }}>
                                Date d'échéance :{' '}
                                <span className="pl-ocr-highlight">
                                  <strong>{formatDateFr(activeExpense.dueDate)}</strong>
                                </span>
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              background: '#f8fafc',
                              padding: '0.6rem 0.8rem',
                              borderRadius: 6,
                              marginBottom: '1rem',
                              fontSize: '0.72rem',
                            }}
                          >
                            <strong>Client facturé :</strong> {workspace?.legalName} — SIREN {workspace?.siren}
                          </div>

                          <table
                            style={{
                              width: '100%',
                              borderCollapse: 'collapse',
                              fontSize: '0.73rem',
                              marginBottom: '1.2rem',
                            }}
                          >
                            <thead>
                              <tr style={{ borderBottom: '1.5px solid #0f172a', textAlign: 'left' }}>
                                <th style={{ padding: '5px 0' }}>Description de la prestation / abonnement</th>
                                <th style={{ padding: '5px', textAlign: 'right' }}>Montant HT</th>
                                <th style={{ padding: '5px', textAlign: 'right' }}>TVA</th>
                                <th style={{ padding: '5px 0', textAlign: 'right' }}>Montant TTC</th>
                              </tr>
                            </thead>
                            <tbody className="tabular-nums">
                              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                <td style={{ padding: '8px 0' }}>{activeExpense.description}</td>
                                <td style={{ padding: '8px 5px', textAlign: 'right' }}>
                                  <span className="pl-ocr-highlight">
                                    {formatMinor(activeExpense.amountHtMinor)}
                                  </span>
                                </td>
                                <td style={{ padding: '8px 5px', textAlign: 'right' }}>
                                  <span className="pl-ocr-highlight">
                                    {formatMinor(activeExpense.vatTotalMinor)}
                                  </span>
                                </td>
                                <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 700 }}>
                                  <span className="pl-ocr-highlight">
                                    {formatMinor(activeExpense.amountTtcMinor)}
                                  </span>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <div
                            style={{
                              marginLeft: 'auto',
                              width: 240,
                              background: '#ecfdf5',
                              border: '1.5px solid #10b981',
                              borderRadius: 6,
                              padding: '0.65rem 0.85rem',
                            }}
                            className="tabular-nums"
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                              <span>Total HT :</span>
                              <strong>{formatMinor(activeExpense.amountHtMinor)}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: 3 }}>
                              <span>TVA (20%) :</span>
                              <strong>{formatMinor(activeExpense.vatTotalMinor)}</strong>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '0.84rem',
                                fontWeight: 800,
                                borderTop: '1px solid #10b981',
                                marginTop: 5,
                                paddingTop: 5,
                                color: '#065f46',
                              }}
                            >
                              <span>Total TTC prélevé :</span>
                              <span>{formatMinor(activeExpense.amountTtcMinor)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* PANE 3 (RIGHT): EXTRACTED METADATA + RADIO STATE + 3 AI SUGGESTIONS (Image 3!) */}
                    <div className="pl-achats-inspector-pane">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800 }}>
                          Facture {activeExpense.supplierName}
                        </h3>
                        <span className="pl-status-pill reconciled">⇄ OCR 99%</span>
                      </div>

                      <div
                        style={{
                          padding: '0.75rem 0.9rem',
                          background: '#f8fafc',
                          border: '1px solid var(--border-light)',
                          borderRadius: 8,
                        }}
                        className="tabular-nums"
                      >
                        <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
                          {formatMinor(activeExpense.amountTtcMinor)}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#059669', fontWeight: 600 }}>
                          dont {formatMinor(activeExpense.vatTotalMinor)} de TVA (
                          {activeExpense.taxRuleCode === 'FR_TVA_20' ? '20%' : '0%'} · déductible :{' '}
                          {formatMinor(activeExpense.vatDeductibleMinor)})
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', fontSize: '0.78rem' }}>
                        <div>
                          <div style={{ color: '#64748b', fontSize: '0.7rem' }}>Fournisseur (401)</div>
                          <div style={{ fontWeight: 700, marginTop: 2 }}>{activeExpense.supplierName}</div>
                        </div>
                        <div>
                          <div style={{ color: '#64748b', fontSize: '0.7rem' }}>Numéro de facture</div>
                          <div className="font-mono" style={{ fontWeight: 700, marginTop: 2 }}>
                            {activeExpense.supplierInvoiceRef}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#64748b', fontSize: '0.7rem' }}>Date d'émission</div>
                          <div style={{ fontWeight: 600, marginTop: 2 }}>
                            {formatDateFr(activeExpense.expenseDate)}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#64748b', fontSize: '0.7rem' }}>Date d'échéance</div>
                          <div style={{ fontWeight: 600, marginTop: 2 }}>
                            {formatDateFr(activeExpense.dueDate)}
                          </div>
                        </div>
                      </div>

                      {/* Blue auto-completed banner from Image 3 */}
                      <div className="pl-info-banner-blue">
                        <span>ℹ</span>
                        <span>
                          Facture complétée automatiquement (PCG {activeExpense.accountingAccountCode}). Payer/classer validera les informations.
                        </span>
                      </div>

                      {/* Source document link — shown when this expense was created from a document */}
                      {(() => {
                        const srcDoc = documents.find((d: any) => d.postedEntityId === activeExpense.id);
                        if (!srcDoc) return null;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
                            <span style={{ color: '#64748b' }}>📄 Importé depuis :</span>
                            <button
                              type="button"
                              className="pl-btn pl-btn-outline"
                              style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem' }}
                              onClick={() => { setDocSelectedId(srcDoc.id); setSection('documents'); }}
                            >
                              {srcDoc.filename}
                            </button>
                          </div>
                        );
                      })()}

                      {/* "Cette facture est..." radio cards from Image 3 */}
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                          Cette facture est...
                        </div>
                        <div className="pl-radio-state-grid">
                          <div
                            className={`pl-radio-state-card ${
                              activeExpense.paymentState === 'to_pay' ? 'selected' : ''
                            }`}
                            onClick={() => handleExpensePaymentState(activeExpense.id, 'to_pay')}
                          >
                            <span>
                              {activeExpense.paymentState === 'to_pay' ? '◉' : '○'} À payer
                            </span>
                            <span>💳</span>
                          </div>
                          <div
                            className={`pl-radio-state-card ${
                              activeExpense.paymentState === 'paid' ? 'selected' : ''
                            }`}
                            onClick={() => handleExpensePaymentState(activeExpense.id, 'paid')}
                          >
                            <span>
                              {activeExpense.paymentState === 'paid' ? '◉' : '○'} Payée
                            </span>
                            <span>✓</span>
                          </div>
                        </div>
                      </div>

                      {/* "Paiement — ✨ 3 suggestions de transaction" from Image 3 */}
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '0.55rem',
                          }}
                        >
                          <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>Paiement</span>
                          <span
                            style={{
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              color: '#047857',
                              background: '#d1fae5',
                              padding: '0.15rem 0.5rem',
                              borderRadius: 999,
                            }}
                          >
                            ✨ {candidateBankSuggestions.length} suggestions de transaction
                          </span>
                        </div>

                        {candidateBankSuggestions.map((tx) => {
                          const isExactMatch =
                            Math.abs(tx.amountMinor) === activeExpense.amountTtcMinor;
                          return (
                            <div
                              key={tx.id}
                              className="pl-suggestion-card"
                              style={{
                                borderColor: isExactMatch ? '#10b981' : undefined,
                                background: isExactMatch ? '#f0fdf4' : '#ffffff',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  marginBottom: 4,
                                }}
                              >
                                <strong className="tabular-nums" style={{ fontSize: '0.88rem' }}>
                                  {formatMinor(tx.amountMinor)}
                                </strong>
                                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                  {formatDateFr(tx.transactionDate)} · {tx.bankName}
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.73rem',
                                  color: '#475569',
                                  marginBottom: '0.6rem',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                                title={tx.description}
                              >
                                {tx.description}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.45rem' }}>
                                <button
                                  type="button"
                                  className="pl-btn pl-btn-outline"
                                  style={{ padding: '0.28rem 0.65rem', fontSize: '0.74rem' }}
                                  onClick={() =>
                                    handleExpenseSuggestion(activeExpense.id, tx.id, 'reject')
                                  }
                                >
                                  Rejeter
                                </button>
                                <button
                                  type="button"
                                  className="pl-btn pl-btn-forest"
                                  style={{ padding: '0.28rem 0.75rem', fontSize: '0.74rem' }}
                                  onClick={() =>
                                    handleExpenseSuggestion(activeExpense.id, tx.id, 'confirm')
                                  }
                                >
                                  ✓ Confirmer
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          className="pl-btn pl-btn-outline"
                          style={{ width: '100%', marginTop: '0.25rem', fontSize: '0.78rem' }}
                          onClick={() => {
                            setSection('banking');
                          }}
                        >
                          🔍 Chercher parmi plus de transactions
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* TABLE VIEW FOR "TOUT" SUBTAB */
                  <div className="pl-table-card">
                    <table className="pl-table">
                      <thead>
                        <tr>
                          <th>STATUT</th>
                          <th>ÉMISSION</th>
                          <th>ÉCHÉANCE</th>
                          <th>FOURNISSEUR</th>
                          <th>N° FACTURE</th>
                          <th style={{ textAlign: 'right' }}>MONTANT TTC</th>
                          <th style={{ textAlign: 'right' }}>TVA DÉDUCTIBLE</th>
                          <th>COMPTE PCG 2025</th>
                          <th style={{ textAlign: 'right' }}>ACTION</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {expenses.map((ex) => (
                          <tr
                            key={ex.id}
                            onClick={() => {
                              setSelectedExpenseId(ex.id);
                              setAchatsSubTab('inbox');
                            }}
                          >
                            <td>
                              <span
                                className={`pl-status-pill ${
                                  ex.paymentState === 'paid' ? 'reconciled' : 'review'
                                }`}
                              >
                                {ex.paymentState === 'paid' ? 'Payée & Rapprochée' : 'Boîte de réception'}
                              </span>
                            </td>
                            <td>{formatDateFr(ex.expenseDate)}</td>
                            <td>{formatDateFr(ex.dueDate)}</td>
                            <td>
                              <strong>{ex.supplierName}</strong>
                            </td>
                            <td className="font-mono">{ex.supplierInvoiceRef}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>
                              {formatMinor(ex.amountTtcMinor)}
                            </td>
                            <td style={{ textAlign: 'right', color: '#059669', fontWeight: 600 }}>
                              {formatMinor(ex.vatDeductibleMinor)}
                            </td>
                            <td>
                              <code>{ex.accountingAccountCode}</code> — {ex.categoryLabel}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button type="button" className="pl-btn pl-btn-outline">
                                Inspecter 3-Volets ❯
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ================================================================
              SECTION 4: TRANSACTIONS — MASTER-DETAIL SPLIT VIEW & GROUPED SEPA RECONCILIATION (Image 1!)
             ================================================================ */}
          {section === 'banking' && (() => {
            const filteredBankTxs = bankTransactions.filter((tx) => {
              if (bankStatusFilter !== 'all' && tx.workflowStatus !== bankStatusFilter) {
                return false;
              }
              if (bankSearch.trim().length > 0) {
                const q = bankSearch.toLowerCase();
                if (
                  !tx.description.toLowerCase().includes(q) &&
                  !tx.counterpartyName.toLowerCase().includes(q)
                ) {
                  return false;
                }
              }
              return true;
            });

            const selectedTx =
              bankTransactions.find((t) => t.id === selectedBankTxId) ??
              filteredBankTxs[0] ??
              bankTransactions[0] ??
              null;

            const allocatedSumMinor = selectedTx
              ? (selectedTx.reconciledAllocations ?? []).reduce(
                  (s: number, a: any) => s + a.allocatedAmountMinor,
                  0
                )
              : 0;
            const remainingToReconcileMinor = selectedTx
              ? Math.max(0, Math.abs(selectedTx.amountMinor) - allocatedSumMinor)
              : 0;

            const statusBadgeForTx = (wf: string) => {
              if (wf === 'rapprochee') {
                return <span className="pl-status-pill reconciled">Rapproché</span>;
              }
              if (wf === 'demande_comptable') {
                return <span className="pl-status-pill draft">Demande comptable</span>;
              }
              if (wf === 'a_confirmer') {
                return <span className="pl-status-pill paid">À confirmer</span>;
              }
              if (wf === 'supprime') {
                return <span className="pl-status-pill pending">Supprimé</span>;
              }
              return <span className="pl-status-pill review">À traiter</span>;
            };

            return (
              <div>
                {/* Top Header Bar with < Exercice 2026 > (Image 1) */}
                <div className="pl-page-header" style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <h1 className="pl-page-title">Transactions</h1>
                    <span className="pl-stat-chip">◀ Exercice 2026 ▶</span>
                    <span className="pl-page-meta">
                      Traitement des virements et prélèvements groupés SEPA · Compte 512100
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="pl-btn pl-btn-outline"
                      onClick={() =>
                        notify(
                          'success',
                          'Relance envoyée au client pour les justificatifs bancaires en attente.'
                        )
                      }
                    >
                      ✉ Relancer le client
                    </button>
                    <button
                      type="button"
                      className="pl-btn pl-btn-mint"
                      onClick={() => setShowGroupMatchModal(true)}
                    >
                      ⇄ Rapprocher un lot de factures
                    </button>
                  </div>
                </div>

                {/* Rich Filter Chips Bar from Image 1 */}
                <div className="pl-filter-bar" style={{ marginBottom: '0.85rem' }}>
                  <div className="pl-filter-bar-left">
                    <input
                      type="search"
                      className="pl-search-input"
                      placeholder="Rechercher un libellé SEPA, tiers..."
                      value={bankSearch}
                      onChange={(e) => setBankSearch(e.target.value)}
                    />
                    <button
                      type="button"
                      className={`pl-filter-chip ${bankStatusFilter === 'all' ? 'active' : ''}`}
                      onClick={() =>
                        setBankStatusFilter(bankStatusFilter === 'all' ? 'a_traiter' : 'all')
                      }
                    >
                      ▼ À traiter, Demande comptable, À confirmer {bankStatusFilter !== 'all' ? '✕' : ''}
                    </button>
                    <button
                      type="button"
                      className={`pl-filter-chip ${bankStatusFilter === 'a_traiter' ? 'active' : ''}`}
                      onClick={() =>
                        setBankStatusFilter(bankStatusFilter === 'a_traiter' ? 'all' : 'a_traiter')
                      }
                    >
                      À traiter
                    </button>
                    <button
                      type="button"
                      className={`pl-filter-chip ${bankStatusFilter === 'demande_comptable' ? 'active' : ''}`}
                      onClick={() =>
                        setBankStatusFilter(
                          bankStatusFilter === 'demande_comptable' ? 'all' : 'demande_comptable'
                        )
                      }
                    >
                      Demande comptable
                    </button>
                    <button
                      type="button"
                      className={`pl-filter-chip ${bankStatusFilter === 'rapprochee' ? 'active' : ''}`}
                      onClick={() =>
                        setBankStatusFilter(bankStatusFilter === 'rapprochee' ? 'all' : 'rapprochee')
                      }
                    >
                      Rapprochée
                    </button>
                    <span className="pl-filter-chip">Doublons (0)</span>
                    <span className="pl-filter-chip">Réconciliations ▾</span>
                  </div>
                </div>

                {/* MASTER-DETAIL SPLIT VIEW FROM IMAGE 1 */}
                <div className="pl-tx-split-layout">
                  {/* LEFT MASTER PANE: TRANSACTIONS TABLE */}
                  <div className="pl-tx-master">
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                      <table className="pl-table">
                        <thead>
                          <tr>
                            <th style={{ width: 28 }}>
                              <input type="checkbox" aria-label="Sélectionner tout" />
                            </th>
                            <th>STATUT</th>
                            <th>DATE ▾</th>
                            <th>LIBELLÉ BANCAIRE SEPA</th>
                            <th style={{ textAlign: 'right' }}>MONTANT</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums">
                          {filteredBankTxs.map((tx) => {
                            const isSelected = selectedTx?.id === tx.id;
                            return (
                              <tr
                                key={tx.id}
                                className={isSelected ? 'selected-row' : ''}
                                onClick={() => setSelectedBankTxId(tx.id)}
                              >
                                <td onClick={(e) => e.stopPropagation()}>
                                  <input type="checkbox" aria-label={tx.description} />
                                </td>
                                <td>
                                  <div className="pl-status-cell">
                                    {statusBadgeForTx(tx.workflowStatus)}
                                    {(tx.reconciledAllocations?.length ?? 0) > 0 && (
                                      <span className="pl-match-icon-badge" title="Réconcilié">
                                        ⇄
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td style={{ whiteSpace: 'nowrap', color: '#475569' }}>
                                  {formatDateFr(tx.transactionDate)}
                                </td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span
                                      className="pl-tier-logo"
                                      style={{
                                        width: 22,
                                        height: 22,
                                        fontSize: '0.62rem',
                                        background:
                                          tx.bankName === 'Crédit Agricole'
                                            ? '#006a4e'
                                            : tx.bankName === 'Qonto'
                                            ? '#6d28d9'
                                            : '#059669',
                                      }}
                                      title={tx.bankName}
                                    >
                                      {tx.bankName === 'Crédit Agricole'
                                        ? 'CA'
                                        : tx.bankName === 'Qonto'
                                        ? 'Q'
                                        : 'BNP'}
                                    </span>
                                    <div style={{ minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontWeight: 600,
                                          fontSize: '0.81rem',
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          maxWidth: 340,
                                        }}
                                      >
                                        {tx.description}
                                      </div>
                                      <div style={{ fontSize: '0.71rem', color: '#64748b' }}>
                                        {tx.counterpartyName} · {tx.bankName} ({tx.bankAccountCode})
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td
                                  style={{
                                    textAlign: 'right',
                                    fontWeight: 800,
                                    color: tx.amountMinor >= 0 ? '#059669' : '#dc2626',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {tx.amountMinor >= 0
                                    ? `+${formatMinor(tx.amountMinor)}`
                                    : formatMinor(tx.amountMinor)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Bottom Pagination Bar from Image 1 */}
                    <div className="pl-pagination-bar">
                      <div>
                        <strong>50</strong> | 100 | 200 éléments par page
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span
                          style={{ cursor: 'pointer', fontWeight: 600, color: '#0f172a' }}
                          onClick={() => refreshAll()}
                        >
                          ⟳ Rafraîchir la page
                        </span>
                        <span>◀ 1 / 1 ▶</span>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT DETAIL PANE: DÉTAILS DE LA TRANSACTION (Image 1!) */}
                  {selectedTx && (
                    <div className="pl-tx-detail">
                      <div className="pl-tx-detail-header">
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '0.5rem',
                          }}
                        >
                          <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 600 }}>
                            Détails · {formatDateFr(selectedTx.transactionDate)}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <select
                              value={selectedTx.workflowStatus}
                              onChange={(e) =>
                                handleUpdateBankTxStatus(selectedTx.id, e.target.value as any)
                              }
                              style={{
                                padding: '0.22rem 0.5rem',
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                background: '#fef3c7',
                                color: '#92400e',
                              }}
                            >
                              <option value="a_traiter">À traiter</option>
                              <option value="demande_comptable">Demande comptable</option>
                              <option value="a_confirmer">À confirmer</option>
                              <option value="rapprochee">Rapproché</option>
                              <option value="supprime">Supprimé</option>
                            </select>
                            <span className="pl-source-pill">
                              {selectedTx.bankName} ({selectedTx.bankAccountCode})
                            </span>
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            gap: '0.75rem',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.35 }}>
                            {selectedTx.description}
                          </div>
                          <div
                            className="tabular-nums"
                            style={{
                              fontSize: '1.25rem',
                              fontWeight: 800,
                              color: selectedTx.amountMinor >= 0 ? '#059669' : '#0f172a',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {selectedTx.amountMinor >= 0
                              ? `+${formatMinor(selectedTx.amountMinor)}`
                              : formatMinor(selectedTx.amountMinor)}
                          </div>
                        </div>
                      </div>

                      {/* 6 Tabs from Image 1: Traitement | Écritures (1) | Réconciliation | Commentaires | Règles | Activité */}
                      <div className="pl-tx-detail-tabs">
                        <button
                          type="button"
                          className={`pl-tx-detail-tab ${bankDetailTab === 'traitement' ? 'active' : ''}`}
                          onClick={() => setBankDetailTab('traitement')}
                        >
                          Traitement
                        </button>
                        <button
                          type="button"
                          className={`pl-tx-detail-tab ${bankDetailTab === 'ecritures' ? 'active' : ''}`}
                          onClick={() => setBankDetailTab('ecritures')}
                        >
                          Écritures ({Math.max(1, selectedTx.reconciledAllocations?.length ?? 1)})
                        </button>
                        <button
                          type="button"
                          className={`pl-tx-detail-tab ${bankDetailTab === 'reconciliation' ? 'active' : ''}`}
                          onClick={() => setBankDetailTab('reconciliation')}
                        >
                          Réconciliation
                        </button>
                        <button
                          type="button"
                          className={`pl-tx-detail-tab ${bankDetailTab === 'commentaires' ? 'active' : ''}`}
                          onClick={() => setBankDetailTab('commentaires')}
                        >
                          Commentaires ({selectedTx.comments?.length ?? 0})
                        </button>
                        <button
                          type="button"
                          className={`pl-tx-detail-tab ${bankDetailTab === 'regles' ? 'active' : ''}`}
                          onClick={() => setBankDetailTab('regles')}
                        >
                          Règles
                        </button>
                        <button
                          type="button"
                          className={`pl-tx-detail-tab ${bankDetailTab === 'activite' ? 'active' : ''}`}
                          onClick={() => setBankDetailTab('activite')}
                        >
                          Activité
                        </button>
                      </div>

                      <div style={{ padding: '1.15rem 1.35rem', flex: 1 }}>
                        {/* TAB 3 (DEFAULT IN IMAGE 1): RÉCONCILIATION GROUPÉE */}
                        {bankDetailTab === 'reconciliation' && (
                          <div>
                            <div className="pl-tx-reconcile-banner">
                              <span style={{ color: '#475569', fontWeight: 600 }}>
                                {selectedTx.amountMinor < 0
                                  ? 'Décaissements restants à rapprocher :'
                                  : 'Encaissements restants à rapprocher :'}
                              </span>
                              <strong
                                className="tabular-nums"
                                style={{
                                  fontSize: '0.95rem',
                                  color: remainingToReconcileMinor === 0 ? '#059669' : '#0f172a',
                                }}
                              >
                                {formatMinor(remainingToReconcileMinor)}
                              </strong>
                            </div>

                            {(selectedTx.reconciledAllocations?.length ?? 0) > 0 ? (
                              <div style={{ marginBottom: '1rem' }}>
                                <div
                                  style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    color: '#475569',
                                    marginBottom: '0.5rem',
                                  }}
                                >
                                  FACTURES RAPPROCHÉES ({selectedTx.reconciledAllocations.length})
                                </div>
                                {selectedTx.reconciledAllocations.map((alloc: any) => (
                                  <div
                                    key={alloc.id}
                                    style={{
                                      border: '1px solid #a7f3d0',
                                      background: '#ecfdf5',
                                      borderRadius: 8,
                                      padding: '0.65rem 0.85rem',
                                      marginBottom: '0.5rem',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      fontSize: '0.8rem',
                                    }}
                                  >
                                    <div>
                                      <strong>{alloc.documentNumber}</strong> — {alloc.thirdPartyName}
                                      <div style={{ fontSize: '0.71rem', color: '#047857' }}>
                                        Rapproché le {formatDateFr(alloc.reconciledAt)} · Lettrage{' '}
                                        <strong>{alloc.letteringCode ?? 'AA'}</strong>
                                      </div>
                                    </div>
                                    <strong className="tabular-nums">
                                      {formatMinor(alloc.allocatedAmountMinor)}
                                    </strong>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div
                                style={{
                                  border: '1px dashed #cbd5e1',
                                  borderRadius: 8,
                                  padding: '1.25rem',
                                  textAlign: 'center',
                                  color: '#64748b',
                                  fontSize: '0.8rem',
                                  marginBottom: '1rem',
                                }}
                              >
                                Aucune facture rattachée pour le moment. Vous pouvez rapprocher une ou plusieurs factures (virement groupé SEPA).
                              </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                              <button
                                type="button"
                                className="pl-btn pl-btn-outline"
                                style={{ width: '100%', justifyContent: 'center' }}
                                onClick={() => setShowGroupMatchModal(true)}
                              >
                                🔍 Chercher parmi plus de factures (Virement groupé)
                              </button>
                              <button
                                type="button"
                                className="pl-btn pl-btn-outline"
                                style={{ width: '100%', justifyContent: 'center' }}
                                onClick={() =>
                                  selectedTx.amountMinor < 0
                                    ? setShowNewExpenseModal(true)
                                    : setShowNewInvoiceModal(true)
                                }
                              >
                                + Saisir une facture
                              </button>
                            </div>
                          </div>
                        )}

                        {bankDetailTab === 'traitement' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                            <div>
                              <label style={{ fontSize: '0.76rem', fontWeight: 700, color: '#475569' }}>
                                Contrepartie (Tiers 401 / 411)
                              </label>
                              <div
                                style={{
                                  marginTop: 4,
                                  padding: '0.55rem 0.75rem',
                                  background: '#f8fafc',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: 6,
                                  fontWeight: 600,
                                  fontSize: '0.82rem',
                                }}
                              >
                                {selectedTx.counterpartyName}
                              </div>
                            </div>
                            <div>
                              <label style={{ fontSize: '0.76rem', fontWeight: 700, color: '#475569' }}>
                                Compte de trésorerie PCG 2025
                              </label>
                              <div
                                style={{
                                  marginTop: 4,
                                  padding: '0.55rem 0.75rem',
                                  background: '#f8fafc',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: 6,
                                  fontSize: '0.82rem',
                                }}
                              >
                                <code>{selectedTx.bankAccountCode}</code> — {selectedTx.bankName}
                              </div>
                            </div>
                          </div>
                        )}

                        {bankDetailTab === 'ecritures' && (
                          <div style={{ fontSize: '0.8rem' }}>
                            <div
                              style={{
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: 8,
                                padding: '0.85rem',
                              }}
                            >
                              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                                Journal de Banque (BQ) — Compte {selectedTx.bankAccountCode}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #e2e8f0' }}>
                                <span>512100 — {selectedTx.bankName}</span>
                                <strong className="tabular-nums">
                                  {formatMinor(Math.abs(selectedTx.amountMinor))}
                                </strong>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', marginTop: 4 }}>
                                <span>
                                  {selectedTx.amountMinor >= 0 ? '411000 — Clients' : '401000 — Fournisseurs'}
                                </span>
                                <strong className="tabular-nums">
                                  {formatMinor(Math.abs(selectedTx.amountMinor))}
                                </strong>
                              </div>
                            </div>
                          </div>
                        )}

                        {bankDetailTab === 'commentaires' && (
                          <div>
                            {(selectedTx.comments ?? []).map((c: any) => (
                              <div
                                key={c.id}
                                style={{
                                  background: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: 8,
                                  padding: '0.65rem 0.8rem',
                                  marginBottom: '0.6rem',
                                  fontSize: '0.78rem',
                                }}
                              >
                                <div style={{ fontWeight: 700, color: '#00382b' }}>
                                  {c.author} · <span style={{ color: '#64748b', fontWeight: 400 }}>{c.createdAt}</span>
                                </div>
                                <div style={{ marginTop: 4 }}>{c.text}</div>
                              </div>
                            ))}
                            <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.75rem' }}>
                              <input
                                type="text"
                                placeholder="Ajouter une note pour le cabinet comptable..."
                                value={newBankComment}
                                onChange={(e) => setNewBankComment(e.target.value)}
                                style={{
                                  flex: 1,
                                  padding: '0.45rem 0.65rem',
                                  borderRadius: 6,
                                  border: '1px solid #cbd5e1',
                                  fontSize: '0.78rem',
                                }}
                              />
                              <button
                                type="button"
                                className="pl-btn pl-btn-forest"
                                onClick={() =>
                                  handleUpdateBankTxStatus(
                                    selectedTx.id,
                                    selectedTx.workflowStatus,
                                    newBankComment
                                  )
                                }
                              >
                                Envoyer
                              </button>
                            </div>
                          </div>
                        )}

                        {bankDetailTab === 'regles' && (
                          <div style={{ fontSize: '0.8rem', color: '#334155' }}>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>
                              Règle d'imputation automatique active :
                            </div>
                            <div className="pl-source-pill">
                              {selectedTx.ruleName ?? 'Détection SEPA & Lettrage automatique 411/401'}
                            </div>
                          </div>
                        )}

                        {bankDetailTab === 'activite' && (
                          <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                            <div>● Flux DSP2 importé le {formatDateFr(selectedTx.transactionDate)}</div>
                            <div style={{ marginTop: 6 }}>
                              ● Empreinte d'audit SHA-256 vérifiée ({selectedTx.sourceLabel})
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ================================================================
              SECTION 5: GRAND LIVRE PCG 2025 — AUTO-LETTERING & 13-COLUMN CUSTOMIZER (Image 2!)
             ================================================================ */}
          {section === 'accounting' && (() => {
            // Flatten all journal lines with running balance & filtering
            let runningBalanceMinor = 0;
            const allFlatLines = entries.flatMap((entry) =>
              entry.lines.map((line: any, idx: number) => {
                runningBalanceMinor += line.debitMinor - line.creditMinor;
                return {
                  key: `${entry.id}-${idx}`,
                  entry,
                  line,
                  runningBalanceMinor,
                };
              })
            );

            const filteredFlatLines = allFlatLines.filter(({ entry, line }) => {
              if (ledgerJournalFilter !== 'ALL' && entry.journalCode !== ledgerJournalFilter) {
                return false;
              }
              if (ledgerSubTab === 'clients' && !line.accountCode.startsWith('411')) {
                return false;
              }
              if (ledgerSubTab === 'fournisseurs' && !line.accountCode.startsWith('401')) {
                return false;
              }
              if (
                ledgerSubTab === 'charges_produits' &&
                !line.accountCode.startsWith('6') &&
                !line.accountCode.startsWith('7')
              ) {
                return false;
              }
              if (ledgerSubTab === 'tresorerie' && !line.accountCode.startsWith('5')) {
                return false;
              }
              if (ledgerSearch.trim().length > 0) {
                const q = ledgerSearch.toLowerCase();
                if (
                  !line.accountCode.toLowerCase().includes(q) &&
                  !line.description.toLowerCase().includes(q) &&
                  !entry.pieceRef.toLowerCase().includes(q)
                ) {
                  return false;
                }
              }
              return true;
            });

            // Compute live Profit/Loss (Classes 7 - Classes 6) for "Résultat : ... €" chip
            const totalClass7 = allFlatLines
              .filter((x) => x.line.accountCode.startsWith('7'))
              .reduce((s, x) => s + (x.line.creditMinor - x.line.debitMinor), 0);
            const totalClass6 = allFlatLines
              .filter((x) => x.line.accountCode.startsWith('6'))
              .reduce((s, x) => s + (x.line.debitMinor - x.line.creditMinor), 0);
            const netResultMinor = totalClass7 - totalClass6;

            const columnLabels: Array<{ key: keyof typeof visibleColumns; label: string }> = [
              { key: 'lineLabel', label: 'Libellé de ligne' },
              { key: 'vatRate', label: "Taux d'attribution TVA" },
              { key: 'pieceLabel', label: 'Libellé de pièce' },
              { key: 'pieceRef', label: 'Numéro de pièce' },
              { key: 'invoiceNumber', label: 'Numéro de facture' },
              { key: 'dueDate', label: 'Échéance' },
              { key: 'lettering', label: 'Lettrage' },
              { key: 'debit', label: 'Débit' },
              { key: 'credit', label: 'Crédit' },
              { key: 'debitForeign', label: 'Débit - hors €' },
              { key: 'creditForeign', label: 'Crédit - hors €' },
              { key: 'runningBalance', label: 'Solde' },
              { key: 'categories', label: 'Catégories' },
            ];

            return (
              <div>
                {/* Top Accounting Header Bar from Image 2 */}
                <div className="pl-page-header" style={{ marginBottom: '0.75rem' }}>
                  <div className="pl-ledger-top-stats">
                    <h1 className="pl-page-title" style={{ marginRight: '0.35rem' }}>
                      Grand Livre
                    </h1>
                    <span className="pl-stat-chip">◀ Exercice 2026 ▶</span>
                    <span className="pl-stat-chip">
                      Résultat :{' '}
                      <strong style={{ color: netResultMinor >= 0 ? '#059669' : '#dc2626' }}>
                        {formatMinor(netResultMinor)}
                      </strong>{' '}
                      ⟳
                    </span>
                    <span className="pl-stat-chip" style={{ color: '#047857' }}>
                      ✓ 31/12/2026
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="pl-btn pl-btn-outline"
                      onClick={handleAutoLetterAll}
                      title="Lettrer automatiquement tous les comptes tiers 411/401 équilibrés"
                    >
                      ⚡ Lettrer auto. ▾
                    </button>
                    <button
                      type="button"
                      className="pl-btn pl-btn-forest"
                      onClick={() => setShowManualEntryModal(true)}
                    >
                      + Nouvelle écriture
                    </button>
                  </div>
                </div>

                {/* Subtabs from Image 2: Tous les comptes | Clients | Fournisseurs | Charges et produits - 6 & 7 | Trésorerie */}
                <div className="pl-subtabs">
                  <button
                    type="button"
                    className={`pl-subtab ${ledgerSubTab === 'all' ? 'active' : ''}`}
                    onClick={() => setLedgerSubTab('all')}
                  >
                    Tous les comptes ({allFlatLines.length})
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${ledgerSubTab === 'clients' ? 'active' : ''}`}
                    onClick={() => setLedgerSubTab('clients')}
                  >
                    Clients - 411
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${ledgerSubTab === 'fournisseurs' ? 'active' : ''}`}
                    onClick={() => setLedgerSubTab('fournisseurs')}
                  >
                    Fournisseurs - 401
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${ledgerSubTab === 'charges_produits' ? 'active' : ''}`}
                    onClick={() => setLedgerSubTab('charges_produits')}
                  >
                    Charges et produits - 6 & 7
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${ledgerSubTab === 'tresorerie' ? 'active' : ''}`}
                    onClick={() => setLedgerSubTab('tresorerie')}
                  >
                    Trésorerie - 5
                  </button>
                </div>

                {/* Filter & Column Customizer Bar from Image 2 */}
                <div className="pl-filter-bar">
                  <div className="pl-filter-bar-left">
                    <input
                      type="search"
                      className="pl-search-input"
                      placeholder="Comptes, libellés, n° de facture..."
                      value={ledgerSearch}
                      onChange={(e) => setLedgerSearch(e.target.value)}
                    />
                    <select
                      className="pl-filter-chip"
                      value={ledgerJournalFilter}
                      onChange={(e) => setLedgerJournalFilter(e.target.value)}
                    >
                      <option value="ALL">Journaux : Tous</option>
                      <option value="VE">Journal VE (Ventes)</option>
                      <option value="AC">Journal AC (Achats)</option>
                      <option value="BQ">Journal BQ (Banque)</option>
                      <option value="OD">Journal OD (Opérations diverses)</option>
                    </select>
                    <span className="pl-filter-chip">Date ▾</span>
                    <span className="pl-filter-chip">Lettrage ▾</span>
                    <span className="pl-filter-chip">Taux TVA ▾</span>
                    <span className="pl-filter-chip">Catégories ▾</span>
                  </div>

                  <div className="pl-filter-bar-right">
                    {fecData && (
                      <button
                        type="button"
                        className="pl-filter-chip"
                        onClick={() => downloadFile(fecData.filename, fecData.content)}
                      >
                        ↓ Exporter FEC ({fecData.filename})
                      </button>
                    )}

                    <button
                      type="button"
                      className="pl-filter-chip"
                      onClick={() => {
                        const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        const rows = filteredFlatLines.map(({ entry, line, runningBalanceMinor: rb }) => ({
                          date:       formatDateFr(entry.entryDate),
                          journal:    entry.journalCode ?? '',
                          account:    `${line.accountCode ?? ''} — ${line.accountLabel ?? ''}`,
                          lineDesc:   line.description ?? entry.description ?? '',
                          vatRate:    line.vatRateLabel ?? '',
                          pieceRef:   entry.pieceRef ?? '',
                          invoiceNum: entry.invoiceNumber ?? '',
                          dueDate:    formatDateFr(entry.dueDate),
                          lettering:  line.letteringCode ?? '—',
                          debit:      line.debitMinor  ? formatMinor(line.debitMinor)  : '',
                          credit:     line.creditMinor ? formatMinor(line.creditMinor) : '',
                          balance:    formatMinor(Math.abs(rb)) + (rb < 0 ? ' Cr' : ' Dr'),
                          category:   line.categoryLabel ?? '',
                        }));
                        const totalDebit  = filteredFlatLines.reduce((s, { line }) => s + (line.debitMinor  ?? 0), 0);
                        const totalCredit = filteredFlatLines.reduce((s, { line }) => s + (line.creditMinor ?? 0), 0);
                        const exportDate  = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
                        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Grand Livre — ${esc(workspace?.legalName ?? 'Haxatax')}</title>
<script>window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 350); });<\/script>
<style>
  @page { margin: 1.2cm; size: A4 landscape; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #1e293b; margin: 0; }
  header { margin-bottom: 10px; }
  h1 { font-size: 12pt; margin: 0 0 3px; color: #00382b; }
  .meta { color: #64748b; font-size: 7.5pt; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #f1f5f9; font-size: 6.5pt; text-transform: uppercase; letter-spacing: 0.05em;
       padding: 4px 4px; border: 1px solid #e2e8f0; text-align: left; white-space: nowrap; }
  td { padding: 3px 4px; border: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .num { text-align: right; }
  .mono { font-family: 'Courier New', monospace; font-size: 7pt; }
  .desc { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tfoot td { background: #e0f2fe; font-weight: 700; border-top: 2px solid #0284c7; }
  .footer { margin-top: 8px; font-size: 6.5pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 5px; }
</style>
</head>
<body>
<header>
  <h1>Grand Livre — ${esc(workspace?.legalName ?? '')} · SIREN ${esc(workspace?.siren ?? '')}</h1>
  <div class="meta">Exporté le ${exportDate} · PCG 2025 · ${rows.length} ligne(s)</div>
</header>
<table>
<thead><tr>
  <th>Date</th><th>Journal</th><th>Compte PCG 2025</th><th>Libellé de ligne</th>
  <th>TVA</th><th>Réf. pièce</th><th>N° Facture</th><th>Échéance</th>
  <th>Lettrage</th><th class="num">Débit</th><th class="num">Crédit</th><th class="num">Solde</th><th>Catégories</th>
</tr></thead>
<tbody>
${rows.map((r) => `<tr>
  <td class="mono">${esc(r.date)}</td>
  <td class="mono">${esc(r.journal)}</td>
  <td class="mono">${esc(r.account)}</td>
  <td class="desc">${esc(r.lineDesc)}</td>
  <td>${esc(r.vatRate)}</td>
  <td class="mono">${esc(r.pieceRef)}</td>
  <td class="mono">${esc(r.invoiceNum)}</td>
  <td class="mono">${esc(r.dueDate)}</td>
  <td class="mono">${esc(r.lettering)}</td>
  <td class="num mono">${esc(r.debit)}</td>
  <td class="num mono">${esc(r.credit)}</td>
  <td class="num mono">${esc(r.balance)}</td>
  <td>${esc(r.category)}</td>
</tr>`).join('\n')}
</tbody>
<tfoot><tr>
  <td colspan="9" class="num">TOTAUX</td>
  <td class="num mono">${esc(formatMinor(totalDebit))}</td>
  <td class="num mono">${esc(formatMinor(totalCredit))}</td>
  <td colspan="2"></td>
</tr></tfoot>
</table>
<div class="footer">Haxatax · PCG 2025 · Piste d'audit SHA-256 · ${esc(exportDate)}</div>
</body>
</html>`;
                        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                        const url  = URL.createObjectURL(blob);
                        const win  = window.open(url, '_blank');
                        if (!win) { URL.revokeObjectURL(url); notify('error', 'Popup bloquée — autorisez les pop-ups pour ce site'); return; }
                        setTimeout(() => URL.revokeObjectURL(url), 60_000);
                      }}
                    >
                      ↓ Exporter PDF
                    </button>

                    {/* PERSONNALISER L'AFFICHAGE POPOVER ANCHOR (Image 2!) */}
                    <div className="pl-customizer-anchor">
                      <button
                        type="button"
                        className={`pl-filter-chip ${showColumnCustomizer ? 'active' : ''}`}
                        onClick={() => setShowColumnCustomizer(!showColumnCustomizer)}
                      >
                        ⚙ Personnaliser
                      </button>

                      {showColumnCustomizer && (
                        <div className="pl-column-customizer-popover">
                          <div
                            style={{
                              fontWeight: 800,
                              fontSize: '0.88rem',
                              marginBottom: '0.65rem',
                              color: '#0f172a',
                            }}
                          >
                            Personnaliser l'affichage
                          </div>

                          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                            {columnLabels.map((col) => {
                              const isOn = visibleColumns[col.key];
                              return (
                                <div
                                  key={col.key}
                                  className="pl-customizer-row"
                                  onClick={() =>
                                    setVisibleColumns((prev) => ({
                                      ...prev,
                                      [col.key]: !prev[col.key],
                                    }))
                                  }
                                >
                                  <span>{col.label}</span>
                                  <button
                                    type="button"
                                    className={`pl-toggle-switch ${isOn ? 'on' : ''}`}
                                    aria-label={col.label}
                                  />
                                </div>
                              );
                            })}
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginTop: '0.85rem',
                              paddingTop: '0.65rem',
                              borderTop: '1px solid #e2e8f0',
                            }}
                          >
                            <button
                              type="button"
                              className="pl-btn pl-btn-outline"
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                              onClick={() => setVisibleColumns(defaultLedgerColumns)}
                            >
                              Réinit.
                            </button>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button
                                type="button"
                                className="pl-btn pl-btn-outline"
                                style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                                onClick={() => setShowColumnCustomizer(false)}
                              >
                                Annuler
                              </button>
                              <button
                                type="button"
                                className="pl-btn pl-btn-forest"
                                style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}
                                onClick={() => setShowColumnCustomizer(false)}
                              >
                                Appliquer
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* GRAND LIVRE TABLE WITH DYNAMIC CUSTOMIZABLE COLUMNS (Image 2!) */}
                <div className="pl-table-card" style={{ overflowX: 'auto' }}>
                  <table className="pl-table">
                    <thead>
                      <tr>
                        <th>DATE</th>
                        <th>JOURNAL</th>
                        <th>COMPTE PCG 2025</th>
                        {visibleColumns.lineLabel && <th>LIBELLÉ DE LIGNE</th>}
                        {visibleColumns.vatRate && <th>TAUX TVA</th>}
                        {visibleColumns.pieceLabel && <th>LIBELLÉ DE PIÈCE</th>}
                        {visibleColumns.pieceRef && <th>N° DE PIÈCE</th>}
                        {visibleColumns.invoiceNumber && <th>N° DE FACTURE</th>}
                        {visibleColumns.dueDate && <th>ÉCHÉANCE</th>}
                        {visibleColumns.lettering && <th>LETTRAGE</th>}
                        {visibleColumns.debit && <th style={{ textAlign: 'right' }}>DÉBIT</th>}
                        {visibleColumns.credit && <th style={{ textAlign: 'right' }}>CRÉDIT</th>}
                        {visibleColumns.debitForeign && (
                          <th style={{ textAlign: 'right' }}>DÉBIT - HORS €</th>
                        )}
                        {visibleColumns.creditForeign && (
                          <th style={{ textAlign: 'right' }}>CRÉDIT - HORS €</th>
                        )}
                        {visibleColumns.runningBalance && (
                          <th style={{ textAlign: 'right' }}>SOLDE</th>
                        )}
                        {visibleColumns.categories && <th>CATÉGORIES</th>}
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {filteredFlatLines.map(({ key, entry, line, runningBalanceMinor: bal }) => {
                        const hasForeign =
                          line.currencyCode &&
                          line.currencyCode !== 'EUR' &&
                          line.amountCurrencyMinor != null;
                        return (
                          <tr key={key} style={{ cursor: 'pointer' }} onClick={() => setSelectedGLEntryId(entry.id)}>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatDateFr(entry.entryDate)}</td>
                            <td>
                              <span className="pl-source-pill">{entry.journalCode}</span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                onClick={(e) => { e.stopPropagation(); setDrilldownAccountCode(line.accountCode); setDrilldownAccountLabel(line.accountLabel ?? line.accountCode); }}
                              >
                                <strong style={{ color: '#2563eb', textDecoration: 'underline', textUnderlineOffset: 2 }}>{line.accountCode}</strong>
                              </button>
                              {line.auxiliaryAccountCode && (
                                <span style={{ color: '#0369a1', marginLeft: 6, fontSize: '0.75rem' }}>
                                  ({line.auxiliaryAccountCode})
                                </span>
                              )}
                              <div style={{ fontSize: '0.71rem', color: '#64748b' }}>
                                {line.accountLabel}
                              </div>
                            </td>
                            {visibleColumns.lineLabel && <td>{line.description}</td>}
                            {visibleColumns.vatRate && (
                              <td>
                                <span className="pl-source-pill">
                                  {line.vatRateLabel ?? '20% (FR)'}
                                </span>
                              </td>
                            )}
                            {visibleColumns.pieceLabel && <td>{entry.journalLabel}</td>}
                            {visibleColumns.pieceRef && (
                              <td className="font-mono" style={{ fontWeight: 600 }}>
                                <span style={{ color: '#2563eb', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '2px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }} title="Voir le détail de l'écriture">
                                  {entry.pieceRef}
                                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }}><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><polyline points="8 1 11 1 11 4"/><line x1="6" y1="6" x2="11" y2="1"/></svg>
                                </span>
                              </td>
                            )}
                            {visibleColumns.invoiceNumber && (
                              <td className="font-mono" style={{ color: '#0f172a', fontWeight: 700 }}>
                                <span style={{ color: '#2563eb', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '2px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }} title="Voir le détail de l'écriture">
                                  {line.invoiceNumber ?? entry.pieceRef}
                                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }}><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><polyline points="8 1 11 1 11 4"/><line x1="6" y1="6" x2="11" y2="1"/></svg>
                                </span>
                              </td>
                            )}
                            {visibleColumns.dueDate && (
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {formatDateFr(line.dueDate ?? entry.entryDate)}
                              </td>
                            )}
                            {visibleColumns.lettering && (
                              <td>
                                {line.letteringCode ? (
                                  <span className="pl-status-pill reconciled">
                                    {line.letteringCode}
                                  </span>
                                ) : (
                                  <span style={{ color: '#cbd5e1' }}>—</span>
                                )}
                              </td>
                            )}
                            {visibleColumns.debit && (
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                {line.debitMinor > 0 ? formatMinor(line.debitMinor) : '—'}
                              </td>
                            )}
                            {visibleColumns.credit && (
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                {line.creditMinor > 0 ? formatMinor(line.creditMinor) : '—'}
                              </td>
                            )}
                            {visibleColumns.debitForeign && (
                              <td style={{ textAlign: 'right', color: '#0369a1', fontWeight: 600 }}>
                                {hasForeign && line.debitMinor > 0
                                  ? `${(line.amountCurrencyMinor / 100).toFixed(2)} ${line.currencyCode}`
                                  : '—'}
                              </td>
                            )}
                            {visibleColumns.creditForeign && (
                              <td style={{ textAlign: 'right', color: '#0369a1', fontWeight: 600 }}>
                                {hasForeign && line.creditMinor > 0
                                  ? `${(line.amountCurrencyMinor / 100).toFixed(2)} ${line.currencyCode}`
                                  : '—'}
                              </td>
                            )}
                            {visibleColumns.runningBalance && (
                              <td
                                style={{
                                  textAlign: 'right',
                                  fontWeight: 700,
                                  color: bal >= 0 ? '#0f172a' : '#dc2626',
                                }}
                              >
                                {formatMinor(bal)}
                              </td>
                            )}
                            {visibleColumns.categories && (
                              <td>
                                <span className="pl-source-pill">
                                  {line.categoryLabel ?? 'Comptabilité générale'}
                                </span>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

              {/* ── GL IMPACT MODAL ──────────────────────────────────────────── */}
              {selectedGLEntryId && (() => {
                const glEntry = entries.find((e: any) => e.id === selectedGLEntryId);
                if (!glEntry) return null;
                const totalDebit = (glEntry.lines ?? []).reduce((s: number, l: any) => s + (l.debitMinor ?? 0), 0);
                const totalCredit = (glEntry.lines ?? []).reduce((s: number, l: any) => s + (l.creditMinor ?? 0), 0);
                const isBalanced = totalDebit === totalCredit;
                const linkedInvoice = invoices.find((inv: any) => inv.number === glEntry.invoiceNumber || inv.number === glEntry.pieceRef);
                const linkedExpense = !linkedInvoice ? expenses.find((exp: any) => exp.supplierRef === glEntry.pieceRef) : null;
                return (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Impact GL : ${glEntry.pieceRef}`}
                    style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
                    onClick={(e) => { if (e.target === e.currentTarget) setSelectedGLEntryId(null); }}
                  >
                    <div style={{ width: 'min(640px, 100vw)', height: '100vh', background: '#fff', display: 'flex', flexDirection: 'column', overflowY: 'auto', boxShadow: '-4px 0 32px rgba(0,0,0,0.12)' }}>
                      <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem', background: '#f8fafc', flexShrink: 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span className="pl-source-pill">{glEntry.journalCode}</span>
                            <span style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>{glEntry.pieceRef}</span>
                            {isBalanced
                              ? <span style={{ fontSize: '0.72rem', background: '#d1fae5', color: '#065f46', padding: '0.2rem 0.55rem', borderRadius: 99, fontWeight: 700 }}>✓ Équilibrée</span>
                              : <span style={{ fontSize: '0.72rem', background: '#fef2f2', color: '#dc2626', padding: '0.2rem 0.55rem', borderRadius: 99, fontWeight: 700 }}>⚠ Déséquilibrée</span>
                            }
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 3 }}>
                            {formatDateFr(glEntry.entryDate)} · {glEntry.description ?? glEntry.journalLabel}
                            {glEntry.entryNumber && <span className="font-mono" style={{ marginLeft: 8, color: '#94a3b8' }}>#{glEntry.entryNumber}</span>}
                          </div>
                        </div>
                        <button type="button" aria-label="Fermer" onClick={() => setSelectedGLEntryId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: '#64748b', padding: '0.25rem', lineHeight: 1 }}>✕</button>
                      </div>
                      <div style={{ padding: '1.25rem 1.5rem', flex: 1 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Impact comptable — partie double</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                          <div className="pl-table-card">
                            <div style={{ padding: '0.6rem 0.9rem', borderBottom: '1px solid #e2e8f0', background: '#fef2f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#dc2626' }}>DÉBIT</span>
                              <strong style={{ color: '#dc2626' }}>{formatMinor(totalDebit)}</strong>
                            </div>
                            {(glEntry.lines ?? []).filter((l: any) => (l.debitMinor ?? 0) > 0).map((l: any, i: number) => (
                              <div key={i} style={{ padding: '0.6rem 0.9rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: '0.83rem', fontFamily: 'monospace', color: '#0f172a' }}>{l.accountCode}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{l.accountLabel}</div>
                                  <div style={{ fontSize: '0.71rem', color: '#94a3b8' }}>{l.description}</div>
                                </div>
                                <strong style={{ color: '#dc2626', whiteSpace: 'nowrap', fontSize: '0.88rem' }}>{formatMinor(l.debitMinor)}</strong>
                              </div>
                            ))}
                          </div>
                          <div className="pl-table-card">
                            <div style={{ padding: '0.6rem 0.9rem', borderBottom: '1px solid #e2e8f0', background: '#f0fdf4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#059669' }}>CRÉDIT</span>
                              <strong style={{ color: '#059669' }}>{formatMinor(totalCredit)}</strong>
                            </div>
                            {(glEntry.lines ?? []).filter((l: any) => (l.creditMinor ?? 0) > 0).map((l: any, i: number) => (
                              <div key={i} style={{ padding: '0.6rem 0.9rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: '0.83rem', fontFamily: 'monospace', color: '#0f172a' }}>{l.accountCode}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{l.accountLabel}</div>
                                  <div style={{ fontSize: '0.71rem', color: '#94a3b8' }}>{l.description}</div>
                                </div>
                                <strong style={{ color: '#059669', whiteSpace: 'nowrap', fontSize: '0.88rem' }}>{formatMinor(l.creditMinor)}</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ background: isBalanced ? '#f0fdf4' : '#fef2f2', border: `1px solid ${isBalanced ? '#cce8df' : '#fecaca'}`, borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Total Débit = Total Crédit</span>
                          <span style={{ fontWeight: 800, color: isBalanced ? '#059669' : '#dc2626' }}>
                            {isBalanced ? `✓ ${formatMinor(totalDebit)}` : `✗ Δ ${formatMinor(Math.abs(totalDebit - totalCredit))}`}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Pièce justificative</div>
                        {linkedInvoice ? (
                          <button type="button" className="pl-btn pl-btn-forest" style={{ fontSize: '0.82rem', width: '100%' }}
                            onClick={() => { setInspectedInvoice(linkedInvoice); setSelectedGLEntryId(null); setSection('sales'); }}>
                            📄 Voir la facture {linkedInvoice.number} — {linkedInvoice.clientName ?? '—'}
                          </button>
                        ) : linkedExpense ? (
                          <button type="button" className="pl-btn pl-btn-forest" style={{ fontSize: '0.82rem', width: '100%' }}
                            onClick={() => { setSelectedExpenseId(linkedExpense.id); setSelectedGLEntryId(null); setSection('purchases'); }}>
                            🧾 Voir la dépense {linkedExpense.supplierRef ?? linkedExpense.id.slice(0, 8)}
                          </button>
                        ) : (
                          <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.82rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span>📎 Pièce : <code style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{glEntry.pieceRef}</code> —{' '}
                              <button type="button" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#2563eb', textDecoration: 'underline', fontSize: '0.82rem' }}
                                onClick={() => { setSelectedGLEntryId(null); setSection('documents'); }}>
                                Rechercher dans les documents
                              </button>
                            </span>
                          </div>
                        )}
                        {glEntry.recordHash && (
                          <div style={{ marginTop: '1rem', padding: '0.65rem 0.9rem', background: '#f8fafc', borderRadius: 8, fontSize: '0.71rem', color: '#64748b', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            <span style={{ fontWeight: 700, color: '#475569' }}>SHA-256 : </span>{glEntry.recordHash}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── ACCOUNT DRILLDOWN OVERLAY ────────────────────────────────── */}
              {drilldownAccountCode && (() => {
                const acctLines: Array<{ entry: any; line: any }> = entries.flatMap((entry: any) =>
                  (entry.lines ?? [])
                    .filter((l: any) => l.accountCode === drilldownAccountCode)
                    .map((l: any) => ({ entry, line: l }))
                );
                const monthGroups: Record<string, { month: string; rows: Array<{ entry: any; line: any }>; debitTotal: number; creditTotal: number }> = {};
                for (const { entry, line } of acctLines) {
                  const mk = (entry.entryDate ?? '').slice(0, 7);
                  if (!monthGroups[mk]) monthGroups[mk] = { month: mk, rows: [], debitTotal: 0, creditTotal: 0 };
                  monthGroups[mk]!.rows.push({ entry, line });
                  monthGroups[mk]!.debitTotal += line.debitMinor ?? 0;
                  monthGroups[mk]!.creditTotal += line.creditMinor ?? 0;
                }
                const sortedMonths = Object.values(monthGroups).sort((a, b) => a.month.localeCompare(b.month));
                const totalDebitAll = acctLines.reduce((s, { line }) => s + (line.debitMinor ?? 0), 0);
                const totalCreditAll = acctLines.reduce((s, { line }) => s + (line.creditMinor ?? 0), 0);
                const soldeNet = totalDebitAll - totalCreditAll;
                const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
                const monthLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${MOIS[(Number(m) - 1) % 12]} ${y}`; };
                return (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Compte ${drilldownAccountCode} — ${drilldownAccountLabel}`}
                    style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
                    onClick={(e) => { if (e.target === e.currentTarget) setDrilldownAccountCode(null); }}
                  >
                    <div style={{ width: 'min(780px, 100vw)', height: '100vh', background: '#fff', display: 'flex', flexDirection: 'column', overflowY: 'auto', boxShadow: '-4px 0 32px rgba(0,0,0,0.12)' }}>
                      <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem', background: '#f8fafc', flexShrink: 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <code style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0f172a', fontFamily: 'monospace' }}>{drilldownAccountCode}</code>
                            <span style={{ color: '#64748b' }}>—</span>
                            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#0f172a' }}>{drilldownAccountLabel}</span>
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 3 }}>Mouvements par mois · Exercice 2026</div>
                        </div>
                        <button type="button" aria-label="Fermer" onClick={() => setDrilldownAccountCode(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: '#64748b', padding: '0.25rem', lineHeight: 1 }}>✕</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                        {[
                          { label: 'Total Débit', value: formatMinor(totalDebitAll), color: '#dc2626' },
                          { label: 'Total Crédit', value: formatMinor(totalCreditAll), color: '#059669' },
                          { label: 'Solde net', value: (soldeNet >= 0 ? '' : '−') + formatMinor(Math.abs(soldeNet)), color: soldeNet >= 0 ? '#0f172a' : '#dc2626' },
                        ].map((kpi) => (
                          <div key={kpi.label} style={{ padding: '0.75rem 1.25rem', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 2 }}>{kpi.label}</div>
                            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: kpi.color }}>{kpi.value}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ padding: '1.25rem 1.5rem', flex: 1 }}>
                        {acctLines.length === 0 ? (
                          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '3rem 0' }}>Aucune écriture pour ce compte</div>
                        ) : (
                          <>
                            {sortedMonths.map((group) => {
                              let runBal = 0;
                              return (
                                <div key={group.month} style={{ marginBottom: '1.5rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>{monthLabel(group.month)}</div>
                                    <div style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', gap: '1rem' }}>
                                      <span style={{ color: '#dc2626' }}>D {formatMinor(group.debitTotal)}</span>
                                      <span style={{ color: '#059669' }}>C {formatMinor(group.creditTotal)}</span>
                                    </div>
                                  </div>
                                  <div className="pl-table-card">
                                    <table className="pl-table" style={{ fontSize: '0.8rem' }}>
                                      <thead>
                                        <tr>
                                          <th>Date</th>
                                          <th>Journal</th>
                                          <th title="Cliquez sur une ligne pour voir le détail complet de l'écriture">
                                            Pièce{' '}
                                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#94a3b8" strokeWidth="1.8" aria-hidden="true" style={{ verticalAlign: 'middle', marginLeft: 2 }}><circle cx="6" cy="6" r="5"/><line x1="6" y1="5.5" x2="6" y2="8.5"/><circle cx="6" cy="3.5" r="0.5" fill="#94a3b8" stroke="none"/></svg>
                                          </th>
                                          <th>Libellé</th>
                                          <th style={{ textAlign: 'right' }}>Débit</th>
                                          <th style={{ textAlign: 'right' }}>Crédit</th>
                                          <th style={{ textAlign: 'right' }}>Solde</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.rows.map(({ entry, line }, i) => {
                                          runBal += (line.debitMinor ?? 0) - (line.creditMinor ?? 0);
                                          return (
                                            <tr key={i} style={{ cursor: 'pointer' }} onClick={() => { setDrilldownAccountCode(null); setSelectedGLEntryId(entry.id); }}>
                                              <td style={{ whiteSpace: 'nowrap' }}>{formatDateFr(entry.entryDate)}</td>
                                              <td><span className="pl-source-pill">{entry.journalCode}</span></td>
                                              <td>
                                                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#2563eb', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '2px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }} title="Voir le détail de l'écriture">
                                                  {entry.pieceRef}
                                                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }}><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><polyline points="8 1 11 1 11 4"/><line x1="6" y1="6" x2="11" y2="1"/></svg>
                                                </span>
                                              </td>
                                              <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.description || entry.description}</td>
                                              <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{(line.debitMinor ?? 0) > 0 ? formatMinor(line.debitMinor) : '—'}</td>
                                              <td style={{ textAlign: 'right', color: '#059669', fontWeight: 600 }}>{(line.creditMinor ?? 0) > 0 ? formatMinor(line.creditMinor) : '—'}</td>
                                              <td style={{ textAlign: 'right', fontWeight: 700, color: runBal >= 0 ? '#0f172a' : '#dc2626' }}>{formatMinor(runBal)}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                      <tfoot>
                                        <tr style={{ background: '#f8fafc' }}>
                                          <td colSpan={4} style={{ fontWeight: 700, padding: '0.5rem 0.75rem', fontSize: '0.78rem', color: '#475569' }}>Sous-total {monthLabel(group.month)}</td>
                                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{formatMinor(group.debitTotal)}</td>
                                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>{formatMinor(group.creditTotal)}</td>
                                          <td></td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                </div>
                              );
                            })}
                            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginTop: '0.5rem' }}>
                              <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                                Rapport de compte — {drilldownAccountCode} {drilldownAccountLabel}
                              </div>
                              <table className="pl-table" style={{ fontSize: '0.82rem' }}>
                                <tbody>
                                  <tr>
                                    <td style={{ fontWeight: 600 }}>Solde d'ouverture (début exercice)</td>
                                    <td style={{ textAlign: 'right', color: '#94a3b8' }}>0,00 €</td>
                                  </tr>
                                  <tr>
                                    <td style={{ fontWeight: 600 }}>Mouvements Débit</td>
                                    <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 700 }}>+ {formatMinor(totalDebitAll)}</td>
                                  </tr>
                                  <tr>
                                    <td style={{ fontWeight: 600 }}>Mouvements Crédit</td>
                                    <td style={{ textAlign: 'right', color: '#059669', fontWeight: 700 }}>− {formatMinor(totalCreditAll)}</td>
                                  </tr>
                                  <tr style={{ background: soldeNet >= 0 ? '#f0fdf4' : '#fef2f2' }}>
                                    <td style={{ fontWeight: 800 }}>Solde de clôture</td>
                                    <td style={{ textAlign: 'right', fontWeight: 800, fontSize: '1.05rem', color: soldeNet >= 0 ? '#059669' : '#dc2626' }}>
                                      {soldeNet >= 0 ? '' : '−'}{formatMinor(Math.abs(soldeNet))}{soldeNet !== 0 ? ` (${soldeNet > 0 ? 'débiteur' : 'créditeur'})` : ''}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                            <button type="button" className="pl-btn pl-btn-outline" style={{ marginTop: '1rem', width: '100%', fontSize: '0.82rem' }}
                              onClick={() => notify('success', `Export PDF du compte ${drilldownAccountCode} — simulation`)}>
                              ⬇ Exporter relevé de compte PDF (simulation)
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              </div>
            );
          })()}

          {/* ================================================================
              SECTION 6: ANNUAIRE TIERS (SIREN / VIES / COMPAUXNUM)
             ================================================================ */}
          {section === 'contacts' && (
            <div>
              <div className="pl-page-header">
                <div className="pl-page-title-row">
                  <h1 className="pl-page-title">Répertoire des Tiers (Clients & Fournisseurs)</h1>
                  <span className="pl-page-meta">
                    Validation Luhn SIREN/SIRET INSEE · Calcul automatique TVA intracommunautaire & Compte auxiliaire FEC
                  </span>
                </div>
                <button
                  type="button"
                  className="pl-btn pl-btn-forest"
                  onClick={() => openContactCreate('customer', 'directory')}
                >
                  + Nouveau tiers (SIREN / VIES)
                </button>
              </div>

              {/* ── Processus de saisie comptable ── */}
              <div style={{ margin: '1rem 0 0.75rem', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '0.55rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 700, color: '#475569', letterSpacing: '0.03em' }}>
                  PROCESSUS DE SAISIE — Comment démarrer ?
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
                  {([
                    { num: '1', icon: '👤', label: 'Créer un tiers', desc: 'Client ou fournisseur avec SIREN / N° TVA', bg: '#f0fdf4', accent: '#059669', action: () => openContactCreate('customer', 'directory') },
                    { num: '2', icon: '📄', label: 'Saisir un document', desc: 'Facture client ou fournisseur, frais', bg: '#eff6ff', accent: '#2563eb', action: () => setShowNewInvoiceModal(true) },
                    { num: '3', icon: '⚙', label: 'Écritures auto', desc: 'PCG 2025 — journaux VE / HA / OD générés', bg: '#fefce8', accent: '#ca8a04', action: () => setSection('accounting') },
                    { num: '4', icon: '✓', label: 'Rapprochement', desc: 'Banque, TVA, lettrage 411/401', bg: '#f0fdf4', accent: '#059669', action: () => setSection('banking') },
                  ] as const).map((step, i, arr) => (
                    <button
                      key={step.num}
                      type="button"
                      onClick={step.action}
                      style={{
                        textAlign: 'left', cursor: 'pointer', background: step.bg,
                        border: 'none', borderLeft: i > 0 ? '1px solid #e2e8f0' : 'none',
                        padding: '0.8rem 0.85rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.2rem' }}>
                        <span style={{ background: step.accent, color: '#fff', borderRadius: '50%', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>{step.num}</span>
                        <span style={{ fontSize: '0.95rem' }}>{step.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#1e293b' }}>{step.label}</span>
                        {i < arr.length - 1 && <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: '0.8rem' }}>›</span>}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', paddingLeft: 22 }}>{step.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', margin: '0.75rem 0' }}>
                {([
                  ['all', 'Tous les tiers'],
                  ['customers', 'Clients'],
                  ['suppliers', 'Fournisseurs'],
                ] as const).map(([filter, label]) => (
                  <button key={filter} type="button" className={`pl-btn ${contactDirectoryFilter === filter ? 'pl-btn-forest' : 'pl-btn-outline'}`} onClick={() => setContactDirectoryFilter(filter)}>
                    {label} ({contacts.filter((c) => filter === 'all' || (filter === 'customers' ? c.kind === 'customer' || c.kind === 'both' : c.kind === 'supplier' || c.kind === 'both')).length})
                  </button>
                ))}
                <input aria-label="Rechercher un client ou fournisseur" type="search" value={contactDirectorySearch} onChange={(e) => setContactDirectorySearch(e.target.value)} placeholder="Rechercher par nom, SIREN ou TVA…" style={{ marginLeft: 'auto', minWidth: 240, padding: '0.55rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: 6 }} />
              </div>

              <div className="pl-table-card">
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th>RAISON SOCIALE</th>
                      <th>RÔLE</th>
                      <th>ZONE FISCALE</th>
                      <th>SIREN (9 CHIFFRES)</th>
                      <th>N° TVA INTRACOMMUNAUTAIRE (VIES)</th>
                      <th>COMPTE AUXILIAIRE FEC (COMPAUXNUM)</th>
                      <th>DÉLAI LÉGAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.filter((c) => {
                      const hasRole = contactDirectoryFilter === 'all'
                        || (contactDirectoryFilter === 'customers' && (c.kind === 'customer' || c.kind === 'both'))
                        || (contactDirectoryFilter === 'suppliers' && (c.kind === 'supplier' || c.kind === 'both'));
                      const query = contactDirectorySearch.trim().toLocaleLowerCase('fr-FR');
                      return hasRole && (!query || [c.legalName, c.siren, c.vatIdentifier, c.email].some((value) => String(value ?? '').toLocaleLowerCase('fr-FR').includes(query)));
                    }).map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button
                            type="button"
                            onClick={() => { setSelectedTierId(c.id); setTierDetailTab('fiche'); }}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}
                          >
                            <div className="pl-tier-cell">
                              <span
                                className="pl-tier-logo"
                                style={{ background: getAvatarColor(c.legalName) }}
                              >
                                {getInitials(c.legalName)}
                              </span>
                              <span style={{ color: '#2563eb', textDecoration: 'underline', textUnderlineOffset: 2 }}>{c.legalName}</span>
                            </div>
                          </button>
                        </td>
                        <td>
                          <span className="pl-status-pill paid">
                            {c.kind === 'customer' ? 'Client' : c.kind === 'supplier' ? 'Fournisseur' : 'Client & fournisseur'}
                          </span>
                        </td>
                        <td>{c.taxZone}</td>
                        <td className="font-mono">{c.siren ?? '—'}</td>
                        <td className="font-mono" style={{ color: '#047857', fontWeight: 600 }}>
                          {c.vatIdentifier ?? '—'}
                        </td>
                        <td>
                          <code style={{ background: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: 5 }}>
                            {c.customerAuxiliaryCode ?? c.supplierAuxiliaryCode}
                          </code>
                        </td>
                        <td>{c.defaultPaymentTermsDays} jours</td>
                      </tr>
                    ))}
                    {contacts.filter((c) => {
                      const hasRole = contactDirectoryFilter === 'all'
                        || (contactDirectoryFilter === 'customers' && (c.kind === 'customer' || c.kind === 'both'))
                        || (contactDirectoryFilter === 'suppliers' && (c.kind === 'supplier' || c.kind === 'both'));
                      const query = contactDirectorySearch.trim().toLocaleLowerCase('fr-FR');
                      return hasRole && (!query || [c.legalName, c.siren, c.vatIdentifier, c.email].some((value) => String(value ?? '').toLocaleLowerCase('fr-FR').includes(query)));
                    }).length === 0 && (
                      <tr>
                        <td colSpan={7}>
                          {contacts.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
                              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👤</div>
                              <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '0.25rem' }}>Aucun tiers enregistré</div>
                              <div style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                Commencez par créer un client ou fournisseur pour démarrer la saisie comptable
                              </div>
                              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                <button type="button" className="pl-btn pl-btn-forest" onClick={() => openContactCreate('customer', 'directory')}>
                                  + Nouveau client
                                </button>
                                <button type="button" className="pl-btn pl-btn-mint" onClick={() => openContactCreate('supplier', 'directory')}>
                                  + Nouveau fournisseur
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Aucun tiers ne correspond à cette recherche.</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* ── Tiers Detail Panel (modal overlay) ── */}
              {selectedTierId && (() => {
                const tier = contacts.find((c: any) => c.id === selectedTierId);
                if (!tier) return null;
                const tierInvoices = invoices.filter((inv: any) => inv.contactId === selectedTierId);
                const tierExpenses = expenses.filter((exp: any) => exp.supplierContactId === selectedTierId);
                const tierDocuments = documents.filter((doc: any) =>
                  doc.confirmedData?.issuerSiren && tier.siren && doc.confirmedData.issuerSiren === tier.siren
                  || tierExpenses.some((e: any) => documents.find((d: any) => d.postedEntityId === e.id)?.id === doc.id)
                );
                const tierEntries = entries.filter((e: any) =>
                  e.auxiliaryAccountCode === tier.customerAuxiliaryCode || e.auxiliaryAccountCode === tier.supplierAuxiliaryCode
                );
                const totalInvoiced = tierInvoices.reduce((s: number, inv: any) => s + (inv.totalTtcMinor ?? 0), 0);
                const totalPaid = tierInvoices.reduce((s: number, inv: any) => s + (inv.amountPaidMinor ?? 0), 0);
                const totalExpenses = tierExpenses.reduce((s: number, exp: any) => s + (exp.amountTtcMinor ?? 0), 0);

                return (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Fiche tiers : ${tier.legalName}`}
                    style={{
                      position: 'fixed', inset: 0, zIndex: 1200,
                      background: 'rgba(15,23,42,0.45)',
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
                    }}
                    onClick={(e) => { if (e.target === e.currentTarget) setSelectedTierId(null); }}
                  >
                    <div style={{
                      width: 'min(720px, 100vw)', height: '100vh', background: '#fff',
                      display: 'flex', flexDirection: 'column', overflowY: 'auto',
                      boxShadow: '-4px 0 32px rgba(0,0,0,0.12)',
                    }}>
                      {/* Header */}
                      <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem', background: '#f8fafc', flexShrink: 0 }}>
                        <span style={{ width: 48, height: 48, borderRadius: '50%', background: getAvatarColor(tier.legalName), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.1rem', flexShrink: 0 }}>
                          {getInitials(tier.legalName)}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#0f172a', lineHeight: 1.2 }}>{tier.legalName}</div>
                          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2, display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <span className="pl-status-pill paid" style={{ fontSize: '0.72rem' }}>
                              {tier.kind === 'customer' ? 'Client' : tier.kind === 'supplier' ? 'Fournisseur' : 'Client & Fournisseur'}
                            </span>
                            <span>{tier.taxZone}</span>
                            {tier.siren && <span className="font-mono">SIREN {tier.siren}</span>}
                            {tier.vatIdentifier && <span className="font-mono" style={{ color: '#047857' }}>{tier.vatIdentifier}</span>}
                          </div>
                        </div>
                        <button type="button" aria-label="Fermer" onClick={() => setSelectedTierId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: '#64748b', padding: '0.25rem', lineHeight: 1 }}>✕</button>
                      </div>

                      {/* KPI strip */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0, borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                        {[
                          { label: 'Facturé TTC', value: formatMinor(totalInvoiced), sub: `${tierInvoices.length} facture(s)`, color: '#059669' },
                          { label: 'Encaissé', value: formatMinor(totalPaid), sub: `Solde : ${formatMinor(totalInvoiced - totalPaid)}`, color: '#2563eb' },
                          { label: 'Achats TTC', value: formatMinor(totalExpenses), sub: `${tierExpenses.length} achat(s)`, color: '#d97706' },
                        ].map((kpi) => (
                          <div key={kpi.label} style={{ padding: '0.85rem 1.25rem', textAlign: 'center', borderRight: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{kpi.label}</div>
                            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: kpi.color, margin: '0.2rem 0' }}>{kpi.value}</div>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{kpi.sub}</div>
                          </div>
                        ))}
                      </div>

                      {/* Tabs */}
                      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', flexShrink: 0, padding: '0 1rem', background: '#fff' }}>
                        {([
                          ['fiche', '📋 Fiche'],
                          ['factures', `📄 Factures (${tierInvoices.length})`],
                          ['achats', `🛒 Achats (${tierExpenses.length})`],
                          ['documents', `📁 Documents (${tierDocuments.length})`],
                          ['comptabilite', `📒 Comptabilité (${tierEntries.length})`],
                        ] as const).map(([tab, label]) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setTierDetailTab(tab)}
                            style={{
                              padding: '0.75rem 0.85rem', border: 'none', background: 'none', cursor: 'pointer',
                              fontSize: '0.8rem', fontWeight: tierDetailTab === tab ? 700 : 500,
                              color: tierDetailTab === tab ? '#2563eb' : '#64748b',
                              borderBottom: tierDetailTab === tab ? '2px solid #2563eb' : '2px solid transparent',
                              transition: 'color 0.15s',
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Tab content */}
                      <div style={{ flex: 1, padding: '1.25rem 1.5rem', overflowY: 'auto' }}>

                        {/* FICHE */}
                        {tierDetailTab === 'fiche' && (
                          <div style={{ display: 'grid', gap: '1rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                              {[
                                { label: 'Raison sociale', value: tier.legalName },
                                { label: 'Type', value: tier.isBusiness ? 'Personne morale' : 'Particulier' },
                                { label: 'Rôle', value: tier.kind === 'customer' ? 'Client' : tier.kind === 'supplier' ? 'Fournisseur' : 'Client & Fournisseur' },
                                { label: 'Zone fiscale', value: tier.taxZone },
                                { label: 'SIREN', value: tier.siren ?? '—', mono: true },
                                { label: 'SIRET', value: tier.siret ?? '—', mono: true },
                                { label: 'N° TVA intracom.', value: tier.vatIdentifier ?? '—', mono: true, color: '#047857' },
                                { label: 'E-mail', value: tier.email ?? '—' },
                                { label: 'Délai de paiement', value: `${tier.defaultPaymentTermsDays} jours` },
                                { label: 'IBAN certifié', value: tier.certifiedIban ?? '—', mono: true },
                              ].map(({ label, value, mono, color }) => (
                                <div key={label} style={{ padding: '0.6rem 0.8rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
                                  <div className={mono ? 'font-mono' : ''} style={{ fontWeight: 600, color: color ?? '#0f172a', fontSize: '0.88rem' }}>{value}</div>
                                </div>
                              ))}
                            </div>

                            {/* Address */}
                            <div style={{ padding: '0.6rem 0.8rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Adresse de facturation</div>
                              <div style={{ fontWeight: 500, color: '#0f172a', fontSize: '0.88rem', lineHeight: 1.5 }}>
                                {tier.billingAddress?.streetLine1 || '—'}<br />
                                {tier.billingAddress?.postalCode} {tier.billingAddress?.city}<br />
                                {tier.billingAddress?.countryCode}
                              </div>
                            </div>

                            {/* Auxiliary codes */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                              {tier.customerAuxiliaryCode && (
                                <div style={{ padding: '0.6rem 0.8rem', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                                  <div style={{ fontSize: '0.7rem', color: '#059669', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Compte auxiliaire client FEC</div>
                                  <code style={{ fontWeight: 700, color: '#047857', fontSize: '0.9rem' }}>{tier.customerAuxiliaryCode}</code>
                                </div>
                              )}
                              {tier.supplierAuxiliaryCode && (
                                <div style={{ padding: '0.6rem 0.8rem', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
                                  <div style={{ fontSize: '0.7rem', color: '#2563eb', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Compte auxiliaire fournisseur FEC</div>
                                  <code style={{ fontWeight: 700, color: '#1d4ed8', fontSize: '0.9rem' }}>{tier.supplierAuxiliaryCode}</code>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* FACTURES */}
                        {tierDetailTab === 'factures' && (
                          <div>
                            {tierInvoices.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📄</div>
                                <div>Aucune facture pour ce tiers.</div>
                              </div>
                            ) : (
                              <table className="pl-table">
                                <thead><tr><th>N°</th><th>Date</th><th>Échéance</th><th>Statut</th><th>Montant TTC</th><th>Encaissé</th></tr></thead>
                                <tbody>
                                  {tierInvoices.map((inv: any) => (
                                    <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => { setInspectedInvoice(inv); setSelectedTierId(null); setSection('sales'); }}>
                                      <td className="font-mono">{inv.number ?? inv.provisionalRef}</td>
                                      <td>{formatDateFr(inv.issueDate)}</td>
                                      <td>{formatDateFr(inv.dueDate)}</td>
                                      <td>
                                        <span className={`pl-status-pill ${inv.paymentStatus === 'paid' ? 'paid' : inv.paymentStatus === 'partially_paid' ? 'partial' : 'pending'}`}>
                                          {inv.paymentStatus === 'paid' ? 'Payée' : inv.paymentStatus === 'partially_paid' ? 'Partiel' : 'Impayée'}
                                        </span>
                                      </td>
                                      <td style={{ fontWeight: 600 }}>{formatMinor(inv.totalTtcMinor)}</td>
                                      <td style={{ color: '#059669' }}>{formatMinor(inv.amountPaidMinor ?? 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}

                        {/* ACHATS */}
                        {tierDetailTab === 'achats' && (
                          <div>
                            {tierExpenses.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🛒</div>
                                <div>Aucun achat enregistré pour ce fournisseur.</div>
                              </div>
                            ) : (
                              <table className="pl-table">
                                <thead><tr><th>Référence</th><th>Description</th><th>Date</th><th>Statut</th><th>Montant TTC</th><th>TVA</th></tr></thead>
                                <tbody>
                                  {tierExpenses.map((exp: any) => (
                                    <tr key={exp.id} style={{ cursor: 'pointer' }} onClick={() => { setSelectedExpenseId(exp.id); setSelectedTierId(null); setSection('purchases'); }}>
                                      <td className="font-mono">{exp.supplierInvoiceRef ?? '—'}</td>
                                      <td>{exp.description}</td>
                                      <td>{formatDateFr(exp.expenseDate)}</td>
                                      <td>
                                        <span className={`pl-status-pill ${exp.paymentState === 'paid' ? 'paid' : 'pending'}`}>
                                          {exp.paymentState === 'paid' ? 'Payée' : 'À payer'}
                                        </span>
                                      </td>
                                      <td style={{ fontWeight: 600 }}>{formatMinor(exp.amountTtcMinor)}</td>
                                      <td style={{ color: '#64748b' }}>{formatMinor(exp.vatTotalMinor ?? 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}

                        {/* DOCUMENTS */}
                        {tierDetailTab === 'documents' && (
                          <div>
                            {tierDocuments.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📁</div>
                                <div>Aucun document lié à ce tiers.</div>
                              </div>
                            ) : (
                              <table className="pl-table">
                                <thead><tr><th>Fichier</th><th>Type</th><th>Statut</th><th>Date import</th><th>Montant TTC</th></tr></thead>
                                <tbody>
                                  {tierDocuments.map((doc: any) => (
                                    <tr key={doc.id} style={{ cursor: 'pointer' }} onClick={() => { setDocSelectedId(doc.id); setSelectedTierId(null); setSection('documents'); }}>
                                      <td style={{ fontSize: '0.82rem' }}>{doc.filename}</td>
                                      <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{doc.confirmedKind ?? doc.detectedKind ?? '—'}</td>
                                      <td>
                                        <span className={`pl-status-pill ${doc.status === 'posted' ? 'paid' : doc.status === 'confirmed' ? 'partial' : 'pending'}`} style={{ fontSize: '0.7rem' }}>
                                          {doc.status === 'posted' ? 'Comptabilisé' : doc.status === 'confirmed' ? 'Confirmé' : doc.status === 'analyzed' ? 'Analysé' : 'En attente'}
                                        </span>
                                      </td>
                                      <td style={{ fontSize: '0.82rem' }}>{formatDateFr(doc.uploadedAt?.slice(0, 10))}</td>
                                      <td style={{ fontWeight: 600 }}>{doc.confirmedData?.amountTtcMinor ? formatMinor(doc.confirmedData.amountTtcMinor) : doc.extractedData?.amountTtcMinor ? formatMinor(doc.extractedData.amountTtcMinor) : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}

                        {/* COMPTABILITE */}
                        {tierDetailTab === 'comptabilite' && (
                          <div>
                            {tierEntries.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📒</div>
                                <div>Aucune écriture comptable pour ce tiers.</div>
                              </div>
                            ) : (
                              <table className="pl-table">
                                <thead><tr><th>Date</th><th>Journal</th><th>Pièce</th><th>Libellé</th><th>Débit</th><th>Crédit</th><th>Lettrage</th></tr></thead>
                                <tbody>
                                  {tierEntries.map((e: any, i: number) => (
                                    <tr key={i}>
                                      <td style={{ fontSize: '0.8rem' }}>{formatDateFr(e.entryDate)}</td>
                                      <td style={{ fontSize: '0.8rem', fontWeight: 600 }}>{e.journalCode}</td>
                                      <td className="font-mono" style={{ fontSize: '0.78rem' }}>{e.pieceRef ?? '—'}</td>
                                      <td style={{ fontSize: '0.8rem' }}>{e.label}</td>
                                      <td style={{ color: '#dc2626', fontWeight: 600, fontSize: '0.82rem' }}>{e.debitMinor ? formatMinor(e.debitMinor) : ''}</td>
                                      <td style={{ color: '#059669', fontWeight: 600, fontSize: '0.82rem' }}>{e.creditMinor ? formatMinor(e.creditMinor) : ''}</td>
                                      <td className="font-mono" style={{ fontSize: '0.78rem', color: '#7c3aed' }}>{e.letteringCode ?? ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}

                      </div>

                      {/* Footer actions */}
                      <div style={{ padding: '0.85rem 1.5rem', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '0.6rem', flexShrink: 0, background: '#f8fafc' }}>
                        {(tier.kind === 'customer' || tier.kind === 'both') && (
                          <button type="button" className="pl-btn pl-btn-forest" style={{ fontSize: '0.8rem' }}
                            onClick={() => { setNewContactId(tier.id); setSelectedTierId(null); setShowNewInvoiceModal(true); }}>
                            + Nouvelle facture
                          </button>
                        )}
                        {(tier.kind === 'supplier' || tier.kind === 'both') && (
                          <button type="button" className="pl-btn pl-btn-mint" style={{ fontSize: '0.8rem' }}
                            onClick={() => { setExpenseSupplierContactId(tier.id); setSelectedTierId(null); setShowNewExpenseModal(true); }}>
                            + Nouvel achat
                          </button>
                        )}
                        <button type="button" className="pl-btn pl-btn-outline" style={{ fontSize: '0.8rem' }}
                          onClick={() => { setSelectedTierId(null); setSection('documents'); }}>
                          Importer un document
                        </button>
                        <button type="button" onClick={() => setSelectedTierId(null)} className="pl-btn pl-btn-outline" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>
                          Fermer
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ================================================================
              SECTION 7: DOCUMENTS & IMPORT
             ================================================================ */}
          {section === 'documents' && (
            <div style={{ padding: '1.5rem' }}>
              <h2 style={{ margin: '0 0 1rem', fontSize: '1.2rem', fontWeight: 700 }}>Documents & Import</h2>

              {/* Upload Zone */}
              <div
                className={`pl-upload-zone${docUploadDragging ? ' dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDocUploadDragging(true); }}
                onDragLeave={() => setDocUploadDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDocUploadDragging(false);
                  const files = Array.from(e.dataTransfer.files);
                  files.forEach(uploadDocumentFile);
                }}
                onClick={() => { const inp = document.getElementById('doc-file-input') as HTMLInputElement; inp?.click(); }}
              >
                <input
                  id="doc-file-input"
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  accept=".pdf,.png,.jpg,.jpeg,.heic,.tif,.tiff,.xml,.ofx,.qfx,.csv,.xlsx,.xls,.json,.txt,.zip,.rar,.7z"
                  onChange={(e) => Array.from(e.target.files ?? []).forEach(uploadDocumentFile)}
                />
                {docUploading ? (
                  <span style={{ color: 'var(--brand-mint)' }}>Importation en cours…</span>
                ) : (
                  <>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Glissez vos fichiers ici ou <strong>cliquez pour sélectionner</strong></span>
                    <span style={{ fontSize: '0.78rem', opacity: 0.6 }}>PDF · PNG/JPG/HEIC/TIFF · Factur-X XML · OFX/QFX · CSV · Excel · JSON · TXT · ZIP</span>
                  </>
                )}
              </div>

              {/* Document Queue */}
              {/* Filter bar + request justificatif button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
                {(['all', 'supplier', 'client', 'banque'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setDocKindFilter(f)}
                    style={{
                      padding: '0.3rem 0.75rem',
                      borderRadius: 20,
                      border: '1px solid',
                      fontSize: '0.78rem',
                      fontWeight: docKindFilter === f ? 700 : 400,
                      cursor: 'pointer',
                      background: docKindFilter === f ? 'var(--brand-forest)' : '#fff',
                      color: docKindFilter === f ? '#fff' : '#334155',
                      borderColor: docKindFilter === f ? 'var(--brand-forest)' : '#e2e8f0',
                    }}
                  >
                    {f === 'all' ? 'Tous' : f === 'supplier' ? '🏢 Fournisseurs' : f === 'client' ? '👤 Clients' : '🏦 Banque'}
                  </button>
                ))}
                <div style={{ marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className="pl-btn pl-btn-outline"
                    style={{ fontSize: '0.78rem' }}
                    onClick={() => {
                      setJustifRequestContactId('');
                      setJustifRequestBody('Madame, Monsieur,\n\nAfin de compléter notre dossier comptable, nous vous remercions de bien vouloir nous faire parvenir les justificatifs originaux (factures, notes de frais, relevés) correspondant aux périodes et montants indiqués ci-dessous.\n\nPièces demandées :\n— [À préciser]\n\nMerci de nous transmettre ces documents dans les meilleurs délais.\n\nCordialement,\n' + (workspace?.legalName ?? ''));
                      setShowJustifRequestModal(true);
                    }}
                  >
                    📋 Demander un justificatif
                  </button>
                </div>
              </div>

              {documents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.5 }}>Aucun document importé</div>
              ) : (() => {
                const filteredDocs = documents.filter((doc: any) => {
                  if (docKindFilter === 'all') return true;
                  const kind: string = doc.detectedKind ?? '';
                  if (docKindFilter === 'supplier') return ['supplier_invoice', 'expense_receipt'].includes(kind);
                  if (docKindFilter === 'client') return ['sales_report', 'customer_invoice'].includes(kind);
                  if (docKindFilter === 'banque') return kind === 'bank_statement';
                  return true;
                });
                return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  {/* Left: Queue */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem', opacity: 0.7 }}>
                      File d'attente ({filteredDocs.length}{docKindFilter !== 'all' ? ` / ${documents.length}` : ''})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {filteredDocs.map((doc: any) => {
                        const fraud = computeFraudRisk(doc);
                        return (
                        <div
                          key={doc.id}
                          className={`pl-doc-queue-item${docSelectedId === doc.id ? ' selected' : ''}`}
                          onClick={() => setDocSelectedId(doc.id === docSelectedId ? null : doc.id)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem', wordBreak: 'break-all' }}>{doc.filename}</span>
                            <span className={`pl-doc-status pl-doc-status--${doc.status}`}>{doc.status}</span>
                          </div>
                          <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.2rem' }}>
                            {doc.detectedKind} · {doc.detectedFormat} · {doc.detectedKind === 'sales_report'
                              ? `${Math.round((doc.classificationConfidenceScore ?? doc.confidenceScore) * 100)}% détection${doc.extractionConfidenceScore != null ? ` · ${Math.round(doc.extractionConfidenceScore * 100)}% OCR` : ''}`
                              : `${Math.round(doc.confidenceScore * 100)}% confiance`}
                          </div>
                          {doc.isDuplicate && (
                            <div style={{ fontSize: '0.73rem', color: '#f59e0b', marginTop: '0.2rem' }}>⚠ Doublon détecté</div>
                          )}
                          {fraud.level !== 'ok' && (
                            <div
                              title={fraud.reasons.join(' · ')}
                              style={{
                                fontSize: '0.71rem',
                                marginTop: '0.25rem',
                                color: fraud.level === 'suspect' ? '#dc2626' : '#b45309',
                                fontWeight: 600,
                                cursor: 'help',
                              }}
                            >
                              {fraud.level === 'suspect' ? '🚨 Suspect' : '⚠ À vérifier'} — {fraud.reasons[0]}
                              {fraud.reasons.length > 1 ? ` +${fraud.reasons.length - 1}` : ''}
                            </div>
                          )}
                        </div>
                        );
                      })}
                      {filteredDocs.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '2rem', opacity: 0.5, fontSize: '0.85rem' }}>Aucun document dans cette catégorie</div>
                      )}
                    </div>
                  </div>

                  {/* Right: Detail Panel */}
                  <div>
                    {(() => {
                      const doc = documents.find((d: any) => d.id === docSelectedId);
                      if (!doc) return <div style={{ opacity: 0.4, paddingTop: '2rem', textAlign: 'center' }}>Sélectionnez un document</div>;
                       const d = docReviewDraft[doc.id] ?? doc.confirmedData ?? doc.extractedData ?? {};
                       const reviewKind = docReviewKind[doc.id] ?? doc.confirmedKind ?? doc.detectedKind;
                       const moneyInput = docReviewMoneyInput[doc.id] ?? {};
                       const reviewMoneyValue = (field: string) => Object.hasOwn(moneyInput, field) ? parseMinorInput(moneyInput[field]!) : d[field];
                       const detailFraud = computeFraudRisk(doc);
                       const _htAmt = reviewMoneyValue('amountHtMinor');
                       const _ttcAmt = reviewMoneyValue('amountTtcMinor');
                       const hasHtAmount = Number.isSafeInteger(_htAmt) && _htAmt > 0;
                       const hasTtcAmount = Number.isSafeInteger(_ttcAmt) && _ttcAmt > 0;
                       const userTouchedAmount = Object.hasOwn(moneyInput, 'amountHtMinor') || Object.hasOwn(moneyInput, 'amountTtcMinor');
                       const amountAck = detailFraud.level === 'ok' || userTouchedAmount || !!docAmountAcknowledged[doc.id];
                       const reviewCanConfirm = reviewKind === 'sales_report'
                         ? Number.isSafeInteger(reviewMoneyValue('salesReportAmountMinor')) && reviewMoneyValue('salesReportAmountMinor') > 0
                         : reviewKind === 'bank_statement'
                         ? Boolean(d.bankTransactions?.length)
                         : ['supplier_invoice', 'expense_receipt'].includes(reviewKind)
                           && Boolean(d.documentDate)
                           && (hasHtAmount || hasTtcAmount)
                           && amountAck;
                       const updateReviewField = (field: string, value: unknown) => setDocReviewDraft((prev) => ({
                         ...prev,
                         [doc.id]: { ...(prev[doc.id] ?? doc.extractedData ?? {}), [field]: value },
                       }));
                       const updateReviewMoney = (field: string, value: string) => setDocReviewMoneyInput((prev) => ({
                         ...prev,
                         [doc.id]: { ...(prev[doc.id] ?? {}), [field]: value },
                       }));
                      return (
                        <div className="pl-doc-detail">
                          <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>{doc.filename}</div>

                          {doc.detectedKind === 'sales_report' && (
                            <div style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '0.65rem' }}>
                              Détection du type : {Math.round((doc.classificationConfidenceScore ?? doc.confidenceScore) * 100)} %
                              {doc.extractionConfidenceScore != null && <> · Qualité OCR : {Math.round(doc.extractionConfidenceScore * 100)} %</>}
                            </div>
                          )}

                          {doc.validationMessages?.length > 0 && (
                            <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '0.5rem 0.75rem', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                              {doc.validationMessages.map((m: string, i: number) => <div key={i}>⚠ {m}</div>)}
                            </div>
                          )}

                          {['analyzed', 'pending', 'confirmed'].includes(doc.status) && !doc.isDuplicate && (
                            <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 6, padding: '0.6rem 0.75rem', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                              {doc.detectedKind === 'sales_report' ? (
                                <>
                                  <div>L'OCR propose le montant réel de la ligne « Valeur des ventes ». Vérifiez ou corrigez-le sur le rapport avant de confirmer. Cette confirmation n'enregistre aucune dépense ni écriture comptable.</div>
                                  <label style={{ display: 'grid', gap: '0.2rem', maxWidth: 240, marginTop: '0.6rem' }}>Montant détecté (€) — à vérifier
                                    <input aria-label="Montant détecté par OCR en euros, à vérifier" type="text" inputMode="decimal" value={Object.hasOwn(moneyInput, 'salesReportAmountMinor') ? moneyInput.salesReportAmountMinor : minorInputValue(d.salesReportAmountMinor)} onChange={e => updateReviewMoney('salesReportAmountMinor', e.target.value)} />
                                  </label>
                                  {reviewMoneyValue('salesReportAmountMinor') === undefined && <div style={{ marginTop: '0.35rem' }}>Aucun montant n'a été reconnu ; saisissez-le après vérification du rapport.</div>}
                                </>
                              ) : <>
                              {doc.extractionMethod === 'ocr_local' ? "L'OCR propose des champs ; vérifiez-les sur la pièce originale. " : ''}
                              {doc.extractedData ? 'Corrigez ou complétez les valeurs à partir de la pièce originale.' : "Aucun champ n'a été détecté ; vous pouvez saisir les informations principales."}
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', marginTop: '0.65rem' }}>
                                <label style={{ display: 'grid', gap: '0.2rem' }}>Type de pièce
                                  <select aria-label="Type de pièce à confirmer" value={reviewKind} onChange={e => setDocReviewKind(prev => ({ ...prev, [doc.id]: e.target.value }))}>
                                    <option value="supplier_invoice">Facture fournisseur</option>
                                    <option value="expense_receipt">Note de frais / reçu</option>
                                    <option value="bank_statement">Relevé bancaire</option>
                                    <option value="unknown">Autre document</option>
                                  </select>
                                </label>
                                <label style={{ display: 'grid', gap: '0.2rem' }}>Fournisseur
                                  <input aria-label="Nom du fournisseur" value={d.issuerName ?? ''} onChange={e => updateReviewField('issuerName', e.target.value || undefined)} />
                                </label>
                                <label style={{ display: 'grid', gap: '0.2rem' }}>Date de pièce
                                  <input aria-label="Date de pièce" type="date" value={d.documentDate ?? ''} onChange={e => updateReviewField('documentDate', e.target.value || undefined)} />
                                </label>
                                <label style={{ display: 'grid', gap: '0.2rem' }}>Référence
                                  <input aria-label="Référence de la pièce" value={d.referenceNumber ?? ''} onChange={e => updateReviewField('referenceNumber', e.target.value || undefined)} />
                                </label>
                                <label style={{ display: 'grid', gap: '0.2rem' }}>SIREN fournisseur
                                  <input aria-label="SIREN fournisseur" inputMode="numeric" value={d.issuerSiren ?? ''} onChange={e => updateReviewField('issuerSiren', e.target.value.replace(/\D/g, '').slice(0, 9) || undefined)} />
                                </label>
                                <label style={{ display: 'grid', gap: '0.2rem' }}>Montant HT (€)
                                  <input aria-label="Montant HT en euros" type="text" inputMode="decimal"
                                    style={detailFraud.level !== 'ok' && !Object.hasOwn(moneyInput, 'amountHtMinor') && !docAmountAcknowledged[doc.id] ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}}
                                    value={Object.hasOwn(moneyInput, 'amountHtMinor') ? moneyInput.amountHtMinor : minorInputValue(d.amountHtMinor)} onChange={e => updateReviewMoney('amountHtMinor', e.target.value)} />
                                </label>
                                <label style={{ display: 'grid', gap: '0.2rem' }}>TVA (€)
                                  <input aria-label="Montant de TVA en euros" type="text" inputMode="decimal" value={Object.hasOwn(moneyInput, 'vatAmountMinor') ? moneyInput.vatAmountMinor : minorInputValue(d.vatAmountMinor)} onChange={e => updateReviewMoney('vatAmountMinor', e.target.value)} />
                                </label>
                                <label style={{ display: 'grid', gap: '0.2rem' }}>Montant TTC (€)
                                  <input aria-label="Montant TTC en euros" type="text" inputMode="decimal"
                                    style={detailFraud.level !== 'ok' && !Object.hasOwn(moneyInput, 'amountTtcMinor') && !docAmountAcknowledged[doc.id] ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}}
                                    value={Object.hasOwn(moneyInput, 'amountTtcMinor') ? moneyInput.amountTtcMinor : minorInputValue(d.amountTtcMinor)} onChange={e => updateReviewMoney('amountTtcMinor', e.target.value)} />
                                </label>
                                {detailFraud.level !== 'ok' && !userTouchedAmount && !docAmountAcknowledged[doc.id] && (
                                  <div style={{ gridColumn: '1/-1' }}>
                                    <button type="button" className="pl-btn"
                                      style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b', fontSize: '0.76rem', padding: '0.25rem 0.6rem' }}
                                      onClick={() => setDocAmountAcknowledged(prev => ({ ...prev, [doc.id]: true }))}>
                                      ✓ J'ai vérifié les montants sur la pièce originale
                                    </button>
                                    <span style={{ fontSize: '0.72rem', color: '#92400e', marginLeft: '0.5rem' }}>ou modifiez les champs ci-dessus</span>
                                  </div>
                                )}
                              </div>
                              <button type="button" className="pl-btn pl-btn-mint" style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.78rem' }} disabled={!reviewCanConfirm} onClick={() => confirmDocumentForPosting(doc)}>
                                {doc.status === 'confirmed' ? 'Enregistrer les données vérifiées' : "J'ai vérifié les données — confirmer"}
                              </button>
                              </>}
                              {doc.detectedKind === 'sales_report' && <button type="button" className="pl-btn pl-btn-mint" style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.78rem' }} disabled={!reviewCanConfirm} onClick={() => confirmDocumentForPosting(doc)}>
                                {doc.status === 'confirmed' ? 'Enregistrer les montants vérifiés' : "J'ai vérifié les montants — confirmer"}
                              </button>}
                            </div>
                          )}

                          <div className="pl-doc-fields">
                            {d.documentDate && <div><span>Date</span><span>{formatDateFr(d.documentDate)}</span></div>}
                            {d.referenceNumber && <div><span>Référence</span><span>{d.referenceNumber}</span></div>}
                            {d.issuerName && <div><span>Émetteur</span><span>{d.issuerName}</span></div>}
                            {d.issuerSiren && <div><span>SIREN</span><span>{d.issuerSiren}</span></div>}
                            {d.amountHtMinor !== undefined && <div><span>Montant HT</span><span>{formatMinor(d.amountHtMinor)}</span></div>}
                            {d.vatAmountMinor !== undefined && <div><span>TVA</span><span>{formatMinor(d.vatAmountMinor)}</span></div>}
                            {d.amountTtcMinor !== undefined && <div><span>TTC</span><span style={{ fontWeight: 700 }}>{formatMinor(d.amountTtcMinor)}</span></div>}
                            {d.salesReportAmountMinor !== undefined && <div><span>Montant détecté · {doc.status !== 'confirmed' ? 'à vérifier' : 'vérifié'}</span><span style={{ fontWeight: 700 }}>{formatMinor(d.salesReportAmountMinor)}</span></div>}
                            {d.suggestedAccountCode && <div><span>Compte PCG</span><span>{d.suggestedAccountCode} — {d.suggestedAccountLabel}</span></div>}
                            {d.suggestedJournalCode && <div><span>Journal</span><span>{d.suggestedJournalCode}</span></div>}
                            {d.bankTransactions?.length > 0 && <div><span>Transactions</span><span>{d.bankTransactions.length} opération(s)</span></div>}
                            {d.bankIban && <div><span>IBAN</span><span>{d.bankIban}</span></div>}
                            {d.bankStatementPeriod && <div><span>Période</span><span>{formatDateFr(d.bankStatementPeriod.from)} → {formatDateFr(d.bankStatementPeriod.to)}</span></div>}
                          </div>

                          {/* Comptabiliser panel */}
                          {doc.status === 'confirmed' && docPostingId === doc.id && (() => {
                            const postKind = doc.confirmedKind ?? doc.detectedKind;
                            const isBankImport = postKind === 'bank_statement';
                            return (
                            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '0.85rem', marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#166534' }}>
                                {isBankImport
                                  ? `Importer ${d.bankTransactions?.length ?? 0} transaction(s) dans Banque`
                                  : 'Créer une dépense dans Achats'}
                              </div>

                              {/* Summary of confirmed fields (read-only) */}
                              {!isBankImport && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.35rem', background: '#fff', borderRadius: 6, padding: '0.5rem 0.6rem', border: '1px solid #d1fae5', fontSize: '0.75rem', color: '#475569' }}>
                                  <div><div style={{ fontWeight: 600, color: '#166534' }}>Référence</div>{d.referenceNumber ?? <span style={{ opacity: 0.5 }}>—</span>}</div>
                                  <div><div style={{ fontWeight: 600, color: '#166534' }}>Date</div>{d.documentDate ? formatDateFr(d.documentDate) : <span style={{ opacity: 0.5 }}>—</span>}</div>
                                  <div><div style={{ fontWeight: 600, color: '#166534' }}>Montant HT</div>{d.amountHtMinor != null ? formatMinor(d.amountHtMinor) : <span style={{ opacity: 0.5 }}>—</span>}</div>
                                </div>
                              )}

                              {/* Fournisseur */}
                              {!isBankImport && (
                                <div>
                                  <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>Fournisseur *</label>
                                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    <select
                                      value={docPostSupplierContactId}
                                      onChange={e => setDocPostSupplierContactId(e.target.value)}
                                      style={{ flex: 1, minWidth: 0, padding: '0.35rem', borderRadius: 5, border: '1px solid #d1d5db', fontSize: '0.82rem' }}
                                    >
                                      <option value="">— Sélectionner un fournisseur —</option>
                                      {contacts.filter((c: any) => c.kind === 'supplier' || c.kind === 'both').map((c: any) => (
                                        <option key={c.id} value={c.id}>{c.legalName}</option>
                                      ))}
                                    </select>
                                    <button type="button" className="pl-btn pl-btn-outline" onClick={() => openContactCreate('supplier', 'document')}>+ Ajouter</button>
                                  </div>
                                </div>
                              )}

                              {/* Compte PCG + Quotité TVA */}
                              {!isBankImport && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                  <div>
                                    <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>Compte PCG 2025</label>
                                    <select value={docPostAccountCode} onChange={e => setDocPostAccountCode(e.target.value)} style={{ width: '100%', padding: '0.35rem', borderRadius: 5, border: '1px solid #d1d5db', fontSize: '0.78rem' }}>
                                      <option value="613500">613500 — Logiciels SaaS & Cloud</option>
                                      <option value="606100">606100 — Carburant & Énergie</option>
                                      <option value="622600">622600 — Honoraires</option>
                                      <option value="625100">625100 — Voyages & Déplacements</option>
                                      <option value="607000">607000 — Achats de marchandises</option>
                                      <option value="601000">601000 — Achats de matières premières</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>Quotité TVA déductible</label>
                                    <select value={docPostDeductibilityRatio} onChange={e => setDocPostDeductibilityRatio(e.target.value)} style={{ width: '100%', padding: '0.35rem', borderRadius: 5, border: '1px solid #d1d5db', fontSize: '0.78rem' }}>
                                      <option value="1.00">100 % Déductible</option>
                                      <option value="0.80">80 % Déductible (Carburant)</option>
                                      <option value="0.00">0 % Non déductible</option>
                                    </select>
                                  </div>
                                </div>
                              )}

                              {docPostError && <div style={{ color: '#dc2626', fontSize: '0.78rem' }}>{docPostError}</div>}
                              <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <button
                                  type="button"
                                  className="pl-btn pl-btn-mint"
                                  style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}
                                  disabled={docPosting || (!isBankImport && !docPostSupplierContactId)}
                                  onClick={() => {
                                    if (isBankImport) postDocumentAsBankImport(doc.id);
                                    else postDocumentAsExpense(doc.id);
                                  }}
                                >
                                  {docPosting ? '…' : 'Confirmer'}
                                </button>
                                <button type="button" className="pl-btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={() => { setDocPostingId(null); setDocPostError(null); }}>Annuler</button>
                              </div>
                            </div>
                            );
                          })()}

                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                            {doc.status === 'confirmed' && docPostingId !== doc.id && (['supplier_invoice', 'expense_receipt', 'bank_statement'].includes(doc.confirmedKind ?? doc.detectedKind)) && (
                              <button
                                type="button"
                                className="pl-btn pl-btn-mint"
                                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', fontWeight: 600 }}
                                onClick={() => { setDocPostingId(doc.id); setDocPostError(null); setDocPostSupplierContactId(''); setDocPostAccountCode('613500'); setDocPostDeductibilityRatio('1.00'); }}
                              >
                                ✓ Comptabiliser
                              </button>
                            )}
                            {doc.status === 'posted' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', padding: '0.25rem 0' }}>
                                <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600 }}>
                                  ✓ Comptabilisé {doc.postedAt ? `le ${formatDateFr(doc.postedAt.slice(0,10))}` : ''}
                                </span>
                                {doc.postedEntityType === 'expense' && doc.postedEntityId && (
                                  <button
                                    type="button"
                                    className="pl-btn pl-btn-outline"
                                    style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem' }}
                                    onClick={() => { setSelectedExpenseId(doc.postedEntityId!); setSection('purchases'); }}
                                  >
                                    → Voir dans Tous les achats
                                  </button>
                                )}
                                {doc.postedEntityType === 'bank_import' && (
                                  <button
                                    type="button"
                                    className="pl-btn pl-btn-outline"
                                    style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem' }}
                                    onClick={() => setSection('banking')}
                                  >
                                    → Voir dans Transactions & Banque
                                  </button>
                                )}
                              </div>
                            )}
                            {doc.status !== 'rejected' && doc.status !== 'posted' && (
                              <button
                                type="button"
                                className="pl-btn pl-btn--danger"
                                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                                onClick={() => rejectDocument(doc.id)}
                              >
                                Rejeter
                              </button>
                            )}
                            <button
                              type="button"
                              className="pl-btn"
                              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', background: '#ef4444', color: '#fff' }}
                              onClick={() => deleteDocumentById(doc.id)}
                            >
                              Supprimer
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ); })()}
            </div>
          )}

          {/* ================================================================
              SECTION 7: PRÉSENTATION PRODUIT BENTO (Screenshots 1 & 2!)
             ================================================================ */}
          {section === 'showcase' && (
            <div>
              {/* Hero inspired by Screenshot 1 */}
              <div className="pl-bento-hero">
                <div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      background: '#d1fae5',
                      color: '#065f46',
                      padding: '0.3rem 0.75rem',
                      borderRadius: 999,
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      marginBottom: '1rem',
                    }}
                  >
                    ★ Conforme Réforme Facturation Électronique 2026 & PCG 2025
                  </span>
                  <h1 style={{ fontSize: '2.35rem', lineHeight: 1.15, margin: '0 0 1rem', color: '#00382b' }}>
                    L'outil qui réunit vos finances, votre comptabilité PCG 2025 et votre Facturation Factur-X
                  </h1>
                  <p style={{ fontSize: '1rem', color: '#475569', marginBottom: '1.5rem' }}>
                    La solution complète pour gérer votre entreprise (de la Micro-entreprise à la SAS/SARL) et produire un FEC 18 colonnes irréprochable.
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button
                      type="button"
                      className="pl-btn pl-btn-mint"
                      style={{ padding: '0.7rem 1.35rem', fontSize: '0.92rem' }}
                      onClick={() => setSection('sales')}
                    >
                      Explorer la Facturation Factur-X ❯
                    </button>
                    <button
                      type="button"
                      className="pl-btn pl-btn-forest"
                      style={{ padding: '0.7rem 1.35rem', fontSize: '0.92rem' }}
                      onClick={() => setSection('pilotage')}
                    >
                      Ouvrir le Plan de Trésorerie
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    background: '#00382b',
                    borderRadius: '16px',
                    padding: '1.5rem',
                    color: '#ffffff',
                    boxShadow: 'var(--shadow-xl)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.8rem', color: '#a7f3d0' }}>
                    <span>● Tableau de bord Trésorerie & TVA Temps Réel</span>
                    <span>SIREN {workspace?.siren}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ background: 'rgba(255,255,255,0.08)', padding: '0.85rem', borderRadius: 10 }}>
                      <div style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>SOLDE TRÉSORERIE</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#00e676' }}>235 035,17 €</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.08)', padding: '0.85rem', borderRadius: 10 }}>
                      <div style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>FACTUR-X EN 16931</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>100 % Validé</div>
                    </div>
                  </div>
                  <div style={{ background: 'rgba(0,230,118,0.12)', border: '1px solid rgba(0,230,118,0.3)', padding: '0.75rem', borderRadius: 8, fontSize: '0.78rem' }}>
                    ✓ Chaînage cryptographique SHA-256 actif · Triggers PostgreSQL d'immuabilité vérifiés
                  </div>
                </div>
              </div>

              {/* E-invoicing Reform Banner (Screenshot 1) */}
              <div className="pl-einvoice-banner">
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#00e676', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                  haxatax | Facturation Électronique 2026–2027
                </div>
                <h2 style={{ fontSize: '1.75rem', margin: '0 0 1.25rem' }}>
                  Passez à la facture électronique Factur-X (EN 16931) sans friction
                </h2>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.85rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                  <span className="pl-sync-pill" style={{ padding: '0.45rem 0.95rem', fontSize: '0.82rem' }}>
                    ✓ Format Hybride PDF/A-3 + XML CII EN 16931
                  </span>
                  <span className="pl-sync-pill" style={{ padding: '0.45rem 0.95rem', fontSize: '0.82rem' }}>
                    ✓ Arrondi TVA par Taux & Mentions Légales B2B (40 €)
                  </span>
                  <span className="pl-sync-pill" style={{ padding: '0.45rem 0.95rem', fontSize: '0.82rem' }}>
                    ✓ Inclus pour Micro-Entreprises & Sociétés PCG 2025
                  </span>
                </div>
                <button
                  type="button"
                  className="pl-btn pl-btn-mint"
                  onClick={() => setSection('sales')}
                >
                  Tester l'émission Factur-X maintenant ❯
                </button>
              </div>

              {/* 6-Card Bento Grid (Screenshot 1) */}
              <h2 style={{ fontSize: '1.5rem', color: '#00382b', marginBottom: '1rem' }}>
                Tous vos outils comptables et financiers réunis au même endroit
              </h2>
              <div className="pl-bento-grid">
                <div className="pl-bento-card" onClick={() => setSection('sales')}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Facturation électronique Factur-X</h3>
                      <span>↗</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      Devis, factures d'acompte (386), factures standards (380) et avoirs (381) avec numérotation séquentielle sans trou.
                    </p>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '0.85rem', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                    <span className="pl-status-pill reconciled">✓ Factur-X EN 16931</span>
                    <div style={{ marginTop: 8, fontWeight: 700 }}>FA-2026-00001 · 10 137,96 € TTC</div>
                  </div>
                </div>

                <div className="pl-bento-card" onClick={() => setSection('purchases')}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Gestion des achats & PAF</h3>
                      <span>↗</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      Extraction Factur-X / OCR souverain UE, gestion de la TVA partiellement récupérable (carburant 80%) et archivage 10 ans.
                    </p>
                  </div>
                  <div style={{ background: '#ecfdf5', padding: '0.85rem', borderRadius: 10, color: '#065f46' }}>
                    <div style={{ fontSize: '0.75rem' }}>TVA déductible 445660 calculée</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>
                      {formatMinor(vatSummary?.deductiblePurchasesMinor ?? 0)}
                    </div>
                  </div>
                </div>

                <div className="pl-bento-card" onClick={() => setSection('pilotage')}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Pilotage de trésorerie</h3>
                      <span>↗</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      Suivi en temps réel des encaissements, décaissements, prévisions et cadrage de TVA sur encaissements vs débits.
                    </p>
                  </div>
                  <div style={{ background: '#00382b', color: '#fff', padding: '0.85rem', borderRadius: 10 }}>
                    <div style={{ fontSize: '0.74rem', color: '#a7f3d0' }}>Solde consolidé 512100</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#00e676' }}>235 035,17 €</div>
                  </div>
                </div>

                <div className="pl-bento-card" onClick={() => setSection('banking')}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Rapprochement & Lettrage Auto</h3>
                      <span>↗</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      Rapprochement SEPA 1-clic, lettrage automatique des comptes 411/401 (code AA) et transfert TVA 44574 → 44571.
                    </p>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '0.85rem', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                    <span className="pl-status-pill reconciled">⇄ Lettrage AA équilibré</span>
                  </div>
                </div>

                <div className="pl-bento-card" onClick={() => setSection('accounting')}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Comptabilité PCG 2025 & FEC</h3>
                      <span>↗</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      Plan Comptable Général 2025 (ANC 2022-06, suppression compte 79) et export FEC 18 colonnes conforme DGFiP.
                    </p>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '0.85rem', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                    <code style={{ fontWeight: 700, color: '#00382b' }}>{fecData?.filename}</code>
                  </div>
                </div>

                <div className="pl-bento-card" onClick={() => setSection('contacts')}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Tiers SIREN, VIES & BlockedLog</h3>
                      <span>↗</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      Validation Luhn INSEE SIREN/SIRET, calcul de clé TVA intracommunautaire et chaîne cryptographique SHA-256.
                    </p>
                  </div>
                  <div style={{ background: '#f3e8ff', color: '#6b21a8', padding: '0.85rem', borderRadius: 10, fontWeight: 700 }}>
                    94,7 % d'imputations automatisées
                  </div>
                </div>
              </div>

              {/* Trust Cards (Screenshot 2) */}
              <div className="pl-trust-grid">
                <div className="pl-trust-card">
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#00e676', marginBottom: '0.4rem' }}>
                    RGPD & UE
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                    Hébergement souverain UE & Rétention légale 10 ans (Art. L123-22 Code de commerce)
                  </div>
                </div>
                <div className="pl-trust-card">
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#00e676', marginBottom: '0.4rem' }}>
                    SHA-256 PAF
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                    Inaltérabilité garantie par chaînage cryptographique & triggers PostgreSQL
                  </div>
                </div>
                <div className="pl-trust-card">
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#00e676', marginBottom: '0.4rem' }}>
                    Made in France
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                    Conçu pour les Micro-entrepreneurs, PME/TPE et Experts-Comptables français
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VAT SECTION */}
          {section === 'vat' && (
            <div>
              <div className="pl-page-header">
                <div className="pl-page-title-row">
                  <h1 className="pl-page-title">TVA</h1>
                  <span className="pl-page-meta">Exercice en cours · Comptes 4457xx / 44566x</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ background: '#f0fdf4', border: '1px solid #cce8df', color: '#065f46', fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', borderRadius: 6 }}>
                    {workspace?.vatRegime === 'REEL_NORMAL' ? 'Régime réel normal' : workspace?.vatRegime === 'REEL_SIMPLIFIE' ? 'Régime réel simplifié' : 'Franchise TVA (293B)'}
                  </span>
                  <span style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', borderRadius: 6 }}>
                    Exigibilité : {workspace?.vatExigibility === 'DEBITS' ? 'Débits (445710)' : 'Encaissements (445740)'}
                  </span>
                  <button type="button" className="pl-btn pl-btn-forest" style={{ fontSize: '0.8rem', padding: '6px 14px' }}>
                    Préparer déclaration CA3
                  </button>
                </div>
              </div>

              {/* KPI cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
                <div className="pl-kpi-box">
                  <div className="pl-kpi-box-header">TVA COLLECTÉE EXIGIBLE</div>
                  <div className="pl-kpi-box-value-row">
                    <span className="pl-kpi-box-value">{formatMinor(vatSummary?.collectedExigibleMinor ?? 0)}</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>Cpte 445710</div>
                </div>
                {(vatSummary?.collectedPendingCashMinor ?? 0) > 0 && (
                  <div className="pl-kpi-box">
                    <div className="pl-kpi-box-header">TVA EN ATTENTE ENCAISSEMENT</div>
                    <div className="pl-kpi-box-value-row">
                      <span className="pl-kpi-box-value">{formatMinor(vatSummary?.collectedPendingCashMinor ?? 0)}</span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>Cpte 445740</div>
                  </div>
                )}
                <div className="pl-kpi-box">
                  <div className="pl-kpi-box-header">TVA DÉDUCTIBLE ACHATS</div>
                  <div className="pl-kpi-box-value-row">
                    <span className="pl-kpi-box-value">{formatMinor(vatSummary?.deductiblePurchasesMinor ?? 0)}</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>Cpte 445660</div>
                </div>
                <div className="pl-kpi-box" style={{ border: (vatSummary?.netVatPayableMinor ?? 0) > 0 ? '1px solid #fca5a5' : '1px solid #cce8df' }}>
                  <div className="pl-kpi-box-header">
                    {(vatSummary?.vatCreditMinor ?? 0) > 0 ? 'CRÉDIT DE TVA' : 'TVA NETTE À PAYER'}
                  </div>
                  <div className="pl-kpi-box-value-row">
                    <span className="pl-kpi-box-value" style={{ color: (vatSummary?.vatCreditMinor ?? 0) > 0 ? '#059669' : '#dc2626' }}>
                      {formatMinor((vatSummary?.vatCreditMinor ?? 0) > 0 ? vatSummary.vatCreditMinor : (vatSummary?.netVatPayableMinor ?? 0))}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>Cpte 44551</div>
                </div>
              </div>

              {/* Rate breakdown table */}
              <div className="pl-table-card" style={{ marginBottom: '1.5rem' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Ventilation par taux</h2>
                </div>
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th>Taux TVA</th>
                      <th>Base HT</th>
                      <th>TVA collectée</th>
                      <th>Régime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vatBreakdown.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>Aucune facture avec TVA</td></tr>
                    ) : vatBreakdown.map((row) => (
                      <tr key={row.rate}>
                        <td><strong>{row.rate} %</strong></td>
                        <td>{formatMinor(row.taxBaseMinor)}</td>
                        <td style={{ fontWeight: 600 }}>{formatMinor(row.vatAmountMinor)}</td>
                        <td><span style={{ background: '#f0fdf4', color: '#065f46', fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 5 }}>FR TVA {row.rate} %</span></td>
                      </tr>
                    ))}
                    {vatBreakdown.length > 0 && (
                      <tr style={{ fontWeight: 700, background: '#f8fafc' }}>
                        <td>Total</td>
                        <td>{formatMinor(vatBreakdown.reduce((s, r) => s + r.taxBaseMinor, 0))}</td>
                        <td>{formatMinor(vatBreakdown.reduce((s, r) => s + r.vatAmountMinor, 0))}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* CA3 info banner */}
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '1rem 1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <svg width="18" height="18" fill="none" stroke="#d97706" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#92400e', marginBottom: 3 }}>Télétransmission DGFiP — bientôt disponible</div>
                  <div style={{ fontSize: '0.8rem', color: '#78350f' }}>La génération du formulaire CA3 et la télétransmission via EDI-TDFC seront disponibles dans une prochaine version. En attendant, utilisez les données ci-dessus pour remplir votre déclaration manuellement sur impots.gouv.fr.</div>
                </div>
              </div>
            </div>
          )}

          {/* REPORTS SECTION */}
          {section === 'reports' && (
            <div>
              <div className="pl-page-header">
                <h1 className="pl-page-title">Rapports</h1>
              </div>

              <div className="pl-subtabs" style={{ marginBottom: '1.5rem' }}>
                <button type="button" className={`pl-subtab ${reportTab === 'pl' ? 'active' : ''}`} onClick={() => setReportTab('pl')}>
                  Compte de résultat
                </button>
                <button type="button" className={`pl-subtab ${reportTab === 'balance' ? 'active' : ''}`} onClick={() => setReportTab('balance')}>
                  Balance générale
                </button>
                <button type="button" className={`pl-subtab ${reportTab === 'fec' ? 'active' : ''}`} onClick={() => setReportTab('fec')}>
                  Export FEC
                </button>
              </div>

              {/* Compte de résultat */}
              {reportTab === 'pl' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.25rem' }}>
                    {/* Produits */}
                    <div className="pl-table-card">
                      <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between' }}>
                        <h2 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>Produits (comptes 7xx)</h2>
                        <strong style={{ color: '#059669' }}>{formatMinor(plReport.totalProduits)}</strong>
                      </div>
                      <table className="pl-table">
                        <thead><tr><th>Compte</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Solde</th></tr></thead>
                        <tbody>
                          {plReport.produitsRows.length === 0 ? (
                            <tr><td colSpan={3} style={{ textAlign: 'center', color: '#94a3b8', padding: '1.5rem' }}>Aucun produit enregistré</td></tr>
                          ) : plReport.produitsRows.map((r) => (
                            <tr key={r.code}>
                              <td><code style={{ fontSize: '0.78rem' }}>{r.code}</code></td>
                              <td style={{ fontSize: '0.82rem' }}>{r.label}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: '#059669' }}>{formatMinor(r.soldeMinor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Charges */}
                    <div className="pl-table-card">
                      <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between' }}>
                        <h2 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>Charges (comptes 6xx)</h2>
                        <strong style={{ color: '#dc2626' }}>{formatMinor(plReport.totalCharges)}</strong>
                      </div>
                      <table className="pl-table">
                        <thead><tr><th>Compte</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Solde</th></tr></thead>
                        <tbody>
                          {plReport.chargesRows.length === 0 ? (
                            <tr><td colSpan={3} style={{ textAlign: 'center', color: '#94a3b8', padding: '1.5rem' }}>Aucune charge enregistrée</td></tr>
                          ) : plReport.chargesRows.map((r) => (
                            <tr key={r.code}>
                              <td><code style={{ fontSize: '0.78rem' }}>{r.code}</code></td>
                              <td style={{ fontSize: '0.82rem' }}>{r.label}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>{formatMinor(r.soldeMinor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {/* Résultat net */}
                  <div style={{ background: plReport.resultNet >= 0 ? '#f0fdf4' : '#fef2f2', border: `1px solid ${plReport.resultNet >= 0 ? '#cce8df' : '#fecaca'}`, borderRadius: 10, padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem' }}>{plReport.resultNet >= 0 ? 'Bénéfice net avant impôt' : 'Perte nette avant impôt'}</div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>Produits − Charges · Compte 12xxxx</div>
                    </div>
                    <span style={{ fontSize: '1.6rem', fontWeight: 800, color: plReport.resultNet >= 0 ? '#059669' : '#dc2626' }}>
                      {formatMinor(Math.abs(plReport.resultNet))}
                    </span>
                  </div>
                </div>
              )}

              {/* Balance générale */}
              {reportTab === 'balance' && (
                <div className="pl-table-card">
                  <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid var(--border-light)' }}>
                    <h2 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>Balance générale — PCG 2025</h2>
                  </div>
                  <table className="pl-table">
                    <thead>
                      <tr>
                        <th>Compte</th>
                        <th>Libellé</th>
                        <th style={{ textAlign: 'right' }}>Débit cumulé</th>
                        <th style={{ textAlign: 'right' }}>Crédit cumulé</th>
                        <th style={{ textAlign: 'right' }}>Solde débiteur</th>
                        <th style={{ textAlign: 'right' }}>Solde créditeur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balanceReport.length === 0 ? (
                        <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>Aucune écriture comptable</td></tr>
                      ) : balanceReport.map((r) => {
                        const solde = r.debitMinor - r.creditMinor;
                        return (
                          <tr key={r.code}>
                            <td><code style={{ fontSize: '0.78rem', fontWeight: 700 }}>{r.code}</code></td>
                            <td style={{ fontSize: '0.82rem', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</td>
                            <td style={{ textAlign: 'right' }}>{formatMinor(r.debitMinor)}</td>
                            <td style={{ textAlign: 'right' }}>{formatMinor(r.creditMinor)}</td>
                            <td style={{ textAlign: 'right', color: solde > 0 ? '#0f172a' : '#94a3b8', fontWeight: solde > 0 ? 600 : 400 }}>{solde > 0 ? formatMinor(solde) : '—'}</td>
                            <td style={{ textAlign: 'right', color: solde < 0 ? '#0f172a' : '#94a3b8', fontWeight: solde < 0 ? 600 : 400 }}>{solde < 0 ? formatMinor(-solde) : '—'}</td>
                          </tr>
                        );
                      })}
                      {balanceReport.length > 0 && (
                        <tr style={{ fontWeight: 700, background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                          <td colSpan={2}>Totaux</td>
                          <td style={{ textAlign: 'right' }}>{formatMinor(balanceReport.reduce((s, r) => s + r.debitMinor, 0))}</td>
                          <td style={{ textAlign: 'right' }}>{formatMinor(balanceReport.reduce((s, r) => s + r.creditMinor, 0))}</td>
                          <td style={{ textAlign: 'right' }}>{formatMinor(balanceReport.reduce((s, r) => s + Math.max(0, r.debitMinor - r.creditMinor), 0))}</td>
                          <td style={{ textAlign: 'right' }}>{formatMinor(balanceReport.reduce((s, r) => s + Math.max(0, r.creditMinor - r.debitMinor), 0))}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* FEC Export */}
              {reportTab === 'fec' && (
                <div>
                  <div className="pl-table-card" style={{ marginBottom: '1rem' }}>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h2 style={{ margin: '0 0 3px', fontSize: '0.95rem', fontWeight: 700 }}>Fichier des Écritures Comptables (FEC)</h2>
                        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Format DGFiP · Séparateur | · UTF-8 · Art. L47 A I LPF</div>
                      </div>
                      <button
                        type="button"
                        className="pl-btn pl-btn-forest"
                        onClick={() => {
                          if (!fecData?.content) return;
                          const blob = new Blob([fecData.content], { type: 'text/plain;charset=utf-8' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `FEC_${workspace?.siren ?? 'SIREN'}_${new Date().toISOString().slice(0, 10)}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        disabled={!fecData?.content}
                      >
                        ↓ Télécharger FEC
                      </button>
                    </div>
                    {fecData?.content ? (
                      <pre style={{ margin: 0, padding: '1rem', fontFamily: 'monospace', fontSize: '0.72rem', overflowX: 'auto', maxHeight: 360, background: '#f8fafc', color: '#374151', lineHeight: 1.6 }}>
                        {fecData.content.slice(0, 3000)}{fecData.content.length > 3000 ? '\n…(tronqué — téléchargez le fichier complet)' : ''}
                      </pre>
                    ) : (
                      <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Aucune donnée FEC disponible</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SETTINGS SECTION */}
          {section === 'settings' && (
            <div>
              <div className="pl-page-header">
                <h1 className="pl-page-title">Paramètres</h1>
              </div>

              {settingsForm === null ? (
                <LoadingSkeleton rows={6} />
              ) : (
                <form onSubmit={handleSaveSettings} noValidate>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', maxWidth: 900 }}>

                    {/* Informations société */}
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700 }}>Informations société</h2>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Raison sociale</span>
                          <input
                            className="pl-input"
                            value={settingsForm.legalName}
                            onChange={(e) => setSettingsForm({ ...settingsForm, legalName: e.target.value })}
                            required
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>SIREN</span>
                          <input
                            className="pl-input"
                            value={settingsForm.siren}
                            onChange={(e) => setSettingsForm({ ...settingsForm, siren: e.target.value })}
                            maxLength={9}
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>N° TVA intracommunautaire</span>
                          <input
                            className="pl-input"
                            value={settingsForm.vatNumber}
                            onChange={(e) => setSettingsForm({ ...settingsForm, vatNumber: e.target.value })}
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Forme juridique</span>
                          <select
                            className="pl-input"
                            value={settingsForm.legalForm}
                            onChange={(e) => setSettingsForm({ ...settingsForm, legalForm: e.target.value })}
                          >
                            {(['MICRO_ENTREPRISE', 'EI', 'EURL', 'SASU', 'SAS', 'SARL'] as const).map((f) => (
                              <option key={f} value={f}>{f.replace('_', ' ')}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>

                    {/* Régimes fiscaux */}
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700 }}>Régimes fiscaux</h2>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Régime TVA</span>
                          <select
                            className="pl-input"
                            value={settingsForm.vatRegime}
                            onChange={(e) => setSettingsForm({ ...settingsForm, vatRegime: e.target.value })}
                          >
                            <option value="FRANCHISE_293B">Franchise en base (art. 293B)</option>
                            <option value="REEL_SIMPLIFIE">Réel simplifié (CA12)</option>
                            <option value="REEL_NORMAL">Réel normal (CA3)</option>
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Exigibilité TVA</span>
                          <select
                            className="pl-input"
                            value={settingsForm.vatExigibility}
                            onChange={(e) => setSettingsForm({ ...settingsForm, vatExigibility: e.target.value })}
                          >
                            <option value="DEBITS">Débits (fact. émises — cpte 445710)</option>
                            <option value="ENCAISSEMENTS">Encaissements (paiements — cpte 445740)</option>
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mode comptable</span>
                          <select
                            className="pl-input"
                            value={settingsForm.accountingMode}
                            onChange={(e) => setSettingsForm({ ...settingsForm, accountingMode: e.target.value })}
                          >
                            <option value="CASH_MICRO">Recettes-dépenses (micro)</option>
                            <option value="DOUBLE_ENTRY_PCG2025">Partie double PCG 2025</option>
                          </select>
                        </label>
                        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.65rem 0.85rem' }}>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 2 }}>ID dossier (lecture seule)</div>
                          <code style={{ fontSize: '0.75rem', color: '#374151' }}>{workspace?.id}</code>
                        </div>
                      </div>
                    </div>

                    {/* Adresse */}
                    <div className="pl-table-card" style={{ padding: '1.25rem', gridColumn: '1 / -1' }}>
                      <h2 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700 }}>Adresse du siège social</h2>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.85rem' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Adresse</span>
                          <input
                            className="pl-input"
                            value={settingsForm.streetLine1}
                            onChange={(e) => setSettingsForm({ ...settingsForm, streetLine1: e.target.value })}
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Code postal</span>
                          <input
                            className="pl-input"
                            value={settingsForm.postalCode}
                            onChange={(e) => setSettingsForm({ ...settingsForm, postalCode: e.target.value })}
                            style={{ width: 100 }}
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ville</span>
                          <input
                            className="pl-input"
                            value={settingsForm.city}
                            onChange={(e) => setSettingsForm({ ...settingsForm, city: e.target.value })}
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Save bar */}
                  <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button type="submit" className="pl-btn pl-btn-forest" disabled={settingsSaving}>
                      {settingsSaving ? 'Enregistrement…' : 'Enregistrer les paramètres'}
                    </button>
                    <button
                      type="button"
                      className="pl-btn pl-btn-outline"
                      onClick={() => setSettingsForm(null)}
                      disabled={settingsSaving}
                    >
                      Réinitialiser
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {section === 'cycle' && (() => {
            const now = new Date();
            const todayStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            const monthStr = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
            const yearStr = String(now.getFullYear());

            const cycleConfig: Array<{
              key: CycleKey;
              label: string;
              subtitle: string;
              accent: string;
              bg: string;
              border: string;
            }> = [
              { key: 'quotidien', label: 'Cycle Quotidien', subtitle: todayStr, accent: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
              { key: 'mensuel', label: 'Cycle Mensuel', subtitle: monthStr.charAt(0).toUpperCase() + monthStr.slice(1), accent: '#d97706', bg: '#fffbeb', border: '#fde68a' },
              { key: 'annuel', label: 'Cycle Annuel', subtitle: `Exercice ${yearStr}`, accent: '#00382b', bg: '#f0fdf4', border: '#bbf7d0' },
            ];

            return (
              <div>
                <div className="pl-page-header">
                  <h1 className="pl-page-title">Cycles Comptables</h1>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                    Suivi des tâches récurrentes — quotidien, mensuel et annuel
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem', maxWidth: 1100 }}>
                  {cycleConfig.map(({ key, label, subtitle, accent, bg, border }) => {
                    const tasks = CYCLE_TASKS[key];
                    const checked = cycleChecked[key];
                    const doneCount = tasks.filter((t) => checked[t.id]).length;
                    const pct = Math.round((doneCount / tasks.length) * 100);

                    return (
                      <div
                        key={key}
                        className="pl-table-card"
                        style={{ padding: 0, overflow: 'hidden' }}
                      >
                        {/* Card header */}
                        <div style={{ background: bg, borderBottom: `1px solid ${border}`, padding: '1rem 1.25rem 0.9rem' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                            <div>
                              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>
                                {label}
                              </div>
                              <div style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 500 }}>{subtitle}</div>
                            </div>
                            <span style={{ fontSize: '1.1rem', fontWeight: 800, color: accent }}>{pct}%</span>
                          </div>

                          {/* Progress bar */}
                          <div style={{ height: 6, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${pct}%`,
                                background: accent,
                                borderRadius: 999,
                                transition: 'width 0.3s ease',
                              }}
                            />
                          </div>
                          <div style={{ marginTop: 5, fontSize: '0.72rem', color: '#64748b' }}>
                            {doneCount} / {tasks.length} tâches complétées
                          </div>
                        </div>

                        {/* Task list */}
                        <ul role="list" style={{ margin: 0, padding: '0.5rem 0', listStyle: 'none' }}>
                          {tasks.map((task) => {
                            const done = !!checked[task.id];
                            return (
                              <li key={task.id}>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '0.65rem',
                                    padding: '0.6rem 1.25rem',
                                    transition: 'background 0.15s',
                                  }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={done}
                                    onChange={() => toggleCycleTask(key, task.id)}
                                    style={{ marginTop: 3, accentColor: accent, flexShrink: 0, width: 15, height: 15, cursor: 'pointer' }}
                                    aria-label={task.label}
                                  />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                                      <span style={{
                                        fontSize: '0.83rem',
                                        fontWeight: 600,
                                        color: done ? '#94a3b8' : '#1e293b',
                                        textDecoration: done ? 'line-through' : 'none',
                                        lineHeight: 1.3,
                                      }}>
                                        {task.label}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (task.unpaidFilter) setPipelineFilter('unpaid');
                                          if (task.inventaireTab) setInventaireTab(task.inventaireTab);
                                          setSection(task.navTarget);
                                        }}
                                        style={{
                                          flexShrink: 0,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 3,
                                          fontSize: '0.68rem',
                                          fontWeight: 600,
                                          color: accent,
                                          background: 'transparent',
                                          border: `1px solid ${border}`,
                                          borderRadius: 99,
                                          padding: '0.1rem 0.5rem',
                                          cursor: 'pointer',
                                          whiteSpace: 'nowrap',
                                          lineHeight: 1.6,
                                        }}
                                        aria-label={`Ouvrir ${task.navLabel}`}
                                      >
                                        {task.navLabel}
                                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                          <path d="M5 12h14M12 5l7 7-7 7" />
                                        </svg>
                                      </button>
                                    </div>
                                    <div style={{ fontSize: '0.74rem', color: done ? '#cbd5e1' : '#64748b', marginTop: 2, lineHeight: 1.35 }}>
                                      {task.desc}
                                    </div>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>

                        {/* Footer */}
                        <div style={{ padding: '0.6rem 1.25rem 0.85rem', borderTop: '1px solid #f1f5f9' }}>
                          <button
                            type="button"
                            className="pl-btn pl-btn-outline"
                            style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
                            onClick={() => resetCycle(key)}
                          >
                            Réinitialiser le cycle
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Info banner */}
                <div style={{
                  marginTop: '1.5rem',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 10,
                  padding: '0.85rem 1.1rem',
                  maxWidth: 1100,
                  fontSize: '0.8rem',
                  color: '#166534',
                  lineHeight: 1.5,
                }}>
                  <strong>Rappel DGFiP :</strong> La déclaration CA3 doit être télétransmise entre le 15 et le 24 du mois suivant la période (régime réel normal).
                  La DSN est due le 5 ou le 15 du mois suivant selon l'effectif. La liasse fiscale est à déposer avant le 2e jour ouvré suivant le 1er mai.
                </div>
              </div>
            );
          })()}

          {/* ================================================================
              SECTION: ÉCRITURES D'INVENTAIRE
             ================================================================ */}
          {section === 'inventaire' && (() => {
            // Filtered entries per type
            const paieEntries   = entries.filter((e) => e.lines?.some((l: any) => l.accountCode?.startsWith('641') || l.accountCode?.startsWith('645')));
            const amortEntries  = entries.filter((e) => e.lines?.some((l: any) => l.accountCode?.startsWith('681')));
            const provEntries   = entries.filter((e) => e.lines?.some((l: any) => ['151000','491000','681600','681740'].includes(l.accountCode)));
            const ccaEntries    = entries.filter((e) => e.lines?.some((l: any) => l.accountCode === '486000' || l.accountCode === '408000'));

            const TABS: Array<{ key: typeof inventaireTab; label: string; count: number }> = [
              { key: 'paie',           label: 'Paie',           count: paieEntries.length  },
              { key: 'amortissements', label: 'Amortissements', count: amortEntries.length },
              { key: 'provisions',     label: 'Provisions',     count: provEntries.length  },
              { key: 'ccafnp',         label: 'CCA & FNP',      count: ccaEntries.length   },
            ];

            const renderEntryTable = (list: any[]) => {
              if (!list.length) return <p style={{ color: '#94a3b8', fontSize: '0.82rem', padding: '1rem 0' }}>Aucune écriture enregistrée.</p>;
              return (
                <table className="pl-table" style={{ marginTop: '0.75rem' }}>
                  <thead><tr><th>Date</th><th>Réf.</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
                  <tbody>
                    {list.slice(0, 8).map((e) => {
                      const totalDebit = (e.lines ?? []).reduce((s: number, l: any) => s + (l.debitMinor ?? 0), 0);
                      return (
                        <tr key={e.id}>
                          <td>{formatDateFr(e.entryDate)}</td>
                          <td><code style={{ fontSize: '0.75rem' }}>{e.pieceRef ?? e.entryNumber}</code></td>
                          <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMinor(totalDebit / 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            };

            const inputStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
            const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' };
            const accountBadge = (code: string, label: string) => (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '0.2rem 0.55rem', fontSize: '0.73rem', fontWeight: 600, color: '#166534', fontFamily: 'monospace' }}>
                {code} <span style={{ fontFamily: 'inherit', fontWeight: 400, color: '#374151' }}>— {label}</span>
              </span>
            );

            return (
              <div>
                <div className="pl-page-header">
                  <h1 className="pl-page-title">Écritures d'inventaire</h1>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                    Paie · Amortissements · Provisions · CCA & FNP — journal OD (PCG 2025)
                  </p>
                </div>

                {/* Tab bar */}
                <div className="pl-subtabs" role="tablist" style={{ marginBottom: '1.5rem' }}>
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={inventaireTab === t.key}
                      className={`pl-subtab${inventaireTab === t.key ? ' active' : ''}`}
                      onClick={() => setInventaireTab(t.key)}
                    >
                      {t.label}
                      {t.count > 0 && <span className="pl-nav-count" style={{ marginLeft: 6 }}>{t.count}</span>}
                    </button>
                  ))}
                </div>

                {/* ── PAIE ── */}
                {inventaireTab === 'paie' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', alignItems: 'start' }}>
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 700 }}>Centralisation des écritures de paie</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '1rem' }}>
                        {accountBadge('641100', 'Rémunérations')}
                        {accountBadge('645100', 'Charges patronales')}
                        {accountBadge('421000', 'Salaires à payer')}
                        {accountBadge('431000', 'Sécurité sociale')}
                      </div>
                      <form onSubmit={handlePostPayroll} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Date de paie</span>
                          <input className="pl-input" type="date" value={paieDate} onChange={(e) => setPaieDate(e.target.value)} required />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Libellé</span>
                          <input className="pl-input" value={paieDesc} onChange={(e) => setPaieDesc(e.target.value)} placeholder="Centralisation paie octobre 2026" required />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Salaires bruts (€)</span>
                          <input className="pl-input" type="number" min="0" step="0.01" value={paieSalaire} onChange={(e) => setPaieSalaire(e.target.value)} placeholder="0.00" required />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Charges patronales (€)</span>
                          <input className="pl-input" type="number" min="0" step="0.01" value={paieCharges} onChange={(e) => setPaieCharges(e.target.value)} placeholder="0.00" required />
                        </label>
                        <div style={{ paddingTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <button type="submit" className="pl-btn pl-btn-forest" disabled={paieSaving}>
                            {paieSaving ? 'Comptabilisation…' : 'Comptabiliser l\'écriture'}
                          </button>
                          {paieSalaire && paieCharges && (
                            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                              Total : {formatMinor(Math.round((parseFloat(paieSalaire) + parseFloat(paieCharges)) * 100))}
                            </span>
                          )}
                        </div>
                      </form>
                    </div>
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem', fontWeight: 700 }}>Historique des écritures de paie</h2>
                      {renderEntryTable(paieEntries)}
                    </div>
                  </div>
                )}

                {/* ── AMORTISSEMENTS ── */}
                {inventaireTab === 'amortissements' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', alignItems: 'start' }}>
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 700 }}>Dotation aux amortissements</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '1rem' }}>
                        {accountBadge('681120', 'Dotations amort. corpo.')}
                        {accountBadge('281500', 'Amort. installations')}
                      </div>
                      <form onSubmit={handlePostAmort} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Date</span>
                          <input className="pl-input" type="date" value={amortDate} onChange={(e) => setAmortDate(e.target.value)} required />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Libellé</span>
                          <input className="pl-input" value={amortDesc} onChange={(e) => setAmortDesc(e.target.value)} placeholder="Dotation aux amortissements" required />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Compte de dotation (débit 68xxx)</span>
                          <select className="pl-input" value={amortDebit} onChange={(e) => setAmortDebit(e.target.value)}>
                            <option value="681120">681120 — Amort. immo. corporelles</option>
                            <option value="681110">681110 — Amort. immo. incorporelles</option>
                            <option value="681500">681500 — Dotations provisions actif</option>
                          </select>
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Compte d'amortissement (crédit 28xxx)</span>
                          <select className="pl-input" value={amortCredit} onChange={(e) => setAmortCredit(e.target.value)}>
                            <option value="281500">281500 — Amort. installations générales</option>
                            <option value="281800">281800 — Amort. autres immo. corporelles</option>
                            <option value="280500">280500 — Amort. concessions, brevets</option>
                            <option value="280600">280600 — Amort. droit au bail</option>
                          </select>
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Montant de la dotation (€)</span>
                          <input className="pl-input" type="number" min="0" step="0.01" value={amortAmount} onChange={(e) => setAmortAmount(e.target.value)} placeholder="0.00" required />
                        </label>
                        <button type="submit" className="pl-btn pl-btn-forest" disabled={amortSaving}>
                          {amortSaving ? 'Comptabilisation…' : 'Comptabiliser la dotation'}
                        </button>
                      </form>
                    </div>
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem', fontWeight: 700 }}>Historique des amortissements</h2>
                      {renderEntryTable(amortEntries)}
                    </div>
                  </div>
                )}

                {/* ── PROVISIONS ── */}
                {inventaireTab === 'provisions' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', alignItems: 'start' }}>
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 700 }}>Dotation aux provisions</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '1rem' }}>
                        {provType === 'risques'
                          ? <>{accountBadge('681600', 'Dot. provisions risques')}{accountBadge('151000', 'Provisions pour risques')}</>
                          : <>{accountBadge('681740', 'Dot. dépréc. créances')}{accountBadge('491000', 'Prov. dépréc. clients')}</>
                        }
                      </div>
                      <form onSubmit={handlePostProvision} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Type de provision</span>
                          <select className="pl-input" value={provType} onChange={(e) => setProvType(e.target.value as 'risques' | 'creances')}>
                            <option value="risques">Risques & charges (681600 / 151000)</option>
                            <option value="creances">Créances douteuses (681740 / 491000)</option>
                          </select>
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Date</span>
                          <input className="pl-input" type="date" value={provDate} onChange={(e) => setProvDate(e.target.value)} required />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Libellé</span>
                          <input className="pl-input" value={provDesc} onChange={(e) => setProvDesc(e.target.value)} placeholder="Ex: Provision litige client Dupont" required />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Montant (€)</span>
                          <input className="pl-input" type="number" min="0" step="0.01" value={provAmount} onChange={(e) => setProvAmount(e.target.value)} placeholder="0.00" required />
                        </label>
                        <button type="submit" className="pl-btn pl-btn-forest" disabled={provSaving}>
                          {provSaving ? 'Comptabilisation…' : 'Comptabiliser la provision'}
                        </button>
                      </form>
                    </div>
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem', fontWeight: 700 }}>Historique des provisions</h2>
                      {renderEntryTable(provEntries)}
                    </div>
                  </div>
                )}

                {/* ── CCA & FNP ── */}
                {inventaireTab === 'ccafnp' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', alignItems: 'start' }}>
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 700 }}>
                        {ccaType === 'cca' ? "CCA — Charges Constatées d'Avance" : 'FNP — Factures Non Parvenues'}
                      </h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.5rem' }}>
                        {ccaType === 'cca'
                          ? <>{accountBadge('486000', 'CCA')}{accountBadge(ccaSourceAccount || '6xxxxx', 'Charge source')}</>
                          : <>{accountBadge(ccaSourceAccount || '6xxxxx', 'Charge')}{accountBadge('408000', 'FNP')}</>
                        }
                      </div>
                      <p style={{ margin: '0 0 0.85rem', fontSize: '0.76rem', color: '#64748b', lineHeight: 1.4 }}>
                        {ccaType === 'cca'
                          ? 'Débit 486 / Crédit 6xx : la charge a été payée mais concerne la période suivante.'
                          : 'Débit 6xx / Crédit 408 : la charge est due mais la facture n\'est pas encore arrivée.'}
                      </p>
                      <form onSubmit={handlePostCcaFnp} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Type d'ajustement</span>
                          <select className="pl-input" value={ccaType} onChange={(e) => setCcaType(e.target.value as 'cca' | 'fnp')}>
                            <option value="cca">CCA — Charge Constatée d'Avance (486 / 6xx)</option>
                            <option value="fnp">FNP — Facture Non Parvenue (6xx / 408)</option>
                          </select>
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Date</span>
                          <input className="pl-input" type="date" value={ccaDate} onChange={(e) => setCcaDate(e.target.value)} required />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Compte de charge (6xxxx)</span>
                          <input className="pl-input" value={ccaSourceAccount} onChange={(e) => setCcaSourceAccount(e.target.value)} placeholder="613500" maxLength={8} />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Libellé</span>
                          <input className="pl-input" value={ccaDesc} onChange={(e) => setCcaDesc(e.target.value)} placeholder="Ex: Loyer payé d'avance Q1 2027" required />
                        </label>
                        <label style={inputStyle}>
                          <span style={labelStyle}>Montant (€)</span>
                          <input className="pl-input" type="number" min="0" step="0.01" value={ccaAmount} onChange={(e) => setCcaAmount(e.target.value)} placeholder="0.00" required />
                        </label>
                        <button type="submit" className="pl-btn pl-btn-forest" disabled={ccaSaving}>
                          {ccaSaving ? 'Comptabilisation…' : `Comptabiliser ${ccaType.toUpperCase()}`}
                        </button>
                      </form>
                    </div>
                    <div className="pl-table-card" style={{ padding: '1.25rem' }}>
                      <h2 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem', fontWeight: 700 }}>Historique CCA & FNP</h2>
                      {renderEntryTable(ccaEntries)}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* INTÉGRATIONS SECTION */}
          {section === 'integrations' && (() => {
            const INTEGRATIONS: Array<{
              category: string;
              items: Array<{ name: string; desc: string; status: 'connected' | 'available' | 'soon'; icon: string }>;
            }> = [
              {
                category: 'Banque',
                items: [
                  { name: 'Import CSV / OFX', desc: 'Importer vos relevés bancaires CSV ou OFX dans le journal BQ.', status: 'connected', icon: '🏦' },
                  { name: 'CAMT.053 XML', desc: "Relevés CAMT.053 normalisés SEPA — format ISO 20022.", status: 'connected', icon: '📄' },
                  { name: 'EBICS T/TS', desc: "Connexion bancaire directe EBICS (Crédit Agricole, BNP, SG…)", status: 'soon', icon: '🔌' },
                  { name: 'Open Banking DSP2', desc: "Agrégation automatique via API DSP2 certifiée ACPR.", status: 'soon', icon: '🔗' },
                ],
              },
              {
                category: 'Paiement',
                items: [
                  { name: 'Virement SEPA', desc: "Génération de fichiers SEPA pain.001 pour votre banque.", status: 'available', icon: '💳' },
                  { name: 'Stripe', desc: "Encaissement en ligne et réconciliation automatique.", status: 'soon', icon: '⚡' },
                  { name: 'GoCardless', desc: "Prélèvement SEPA automatique pour vos clients récurrents.", status: 'soon', icon: '🔄' },
                ],
              },
              {
                category: 'Facturation & FEC',
                items: [
                  { name: 'Factur-X EN 16931', desc: "Émission et réception de factures Factur-X PDF/A-3b.", status: 'connected', icon: '📑' },
                  { name: 'Export FEC DGFiP', desc: "Fichier des Écritures Comptables 18 colonnes Art. L47 A-I LPF.", status: 'connected', icon: '🏛️' },
                  { name: 'Chorus Pro', desc: "Dépôt automatique des factures B2G sur Chorus Pro (secteur public).", status: 'soon', icon: '🏢' },
                  { name: 'Peppol / PDP', desc: "Réseau Peppol BIS 3.0 via Plateforme de Dématérialisation Partenaire.", status: 'soon', icon: '🌐' },
                ],
              },
              {
                category: 'Outils & API',
                items: [
                  { name: 'API REST Haxatax', desc: "Accès programmatique à toutes les ressources (clé API).", status: 'available', icon: '⚙️' },
                  { name: 'Webhooks', desc: "Notifications temps réel sur vos systèmes externes.", status: 'available', icon: '📡' },
                  { name: 'Zapier / Make', desc: "Connexion à +5 000 applications sans code.", status: 'soon', icon: '🤖' },
                  { name: 'SMTP personnalisé', desc: "Envoi des factures depuis votre propre adresse e-mail.", status: 'available', icon: '✉️' },
                ],
              },
            ];

            const statusLabel: Record<string, string> = { connected: 'Connecté', available: 'Disponible', soon: 'Bientôt' };
            const statusColor: Record<string, { bg: string; color: string }> = {
              connected: { bg: '#d1fae5', color: '#065f46' },
              available: { bg: '#dbeafe', color: '#1e40af' },
              soon: { bg: '#f1f5f9', color: '#64748b' },
            };

            return (
              <div>
                <div className="pl-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h1 className="pl-page-title">Intégrations</h1>
                  <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                    {INTEGRATIONS.flatMap((g) => g.items).filter((i) => i.status === 'connected').length} connectées
                  </span>
                </div>

                {INTEGRATIONS.map((group) => (
                  <div key={group.category} style={{ marginBottom: '1.75rem' }}>
                    <h2 style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.75rem' }}>
                      {group.category}
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.85rem' }}>
                      {group.items.map((item) => {
                        const sc = statusColor[item.status]!;
                        return (
                          <div
                            key={item.name}
                            className="pl-table-card"
                            style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.9rem' }}>
                                <span style={{ fontSize: '1.15rem' }}>{item.icon}</span>
                                {item.name}
                              </div>
                              <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: sc.bg, color: sc.color }}>
                                {statusLabel[item.status]}
                              </span>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 }}>{item.desc}</p>
                            <div style={{ marginTop: 'auto', paddingTop: '0.5rem' }}>
                              {item.status === 'connected' ? (
                                <button
                                  type="button"
                                  className="pl-btn pl-btn-outline"
                                  style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                                  onClick={() => notify('success', `${item.name} — Configuration ouverte (simulation)`)}
                                >
                                  Configurer
                                </button>
                              ) : item.status === 'available' ? (
                                <button
                                  type="button"
                                  className="pl-btn pl-btn-forest"
                                  style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                                  onClick={() => notify('success', `${item.name} — Connexion initiée (simulation)`)}
                                >
                                  Connecter
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="pl-btn pl-btn-outline"
                                  style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem', opacity: 0.5, cursor: 'not-allowed' }}
                                  disabled
                                >
                                  Bientôt disponible
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ÉQUIPE & RÔLES SECTION */}
          {section === 'team' && (() => {
            const ROLE_META: Record<string, { label: string; bg: string; color: string; desc: string }> = {
              owner:      { label: 'Propriétaire', bg: '#fef9c3', color: '#713f12', desc: 'Accès total, facturation et suppression du compte' },
              admin:      { label: 'Administrateur', bg: '#dbeafe', color: '#1e40af', desc: 'Accès total sauf facturation et suppression du compte' },
              finance:    { label: 'Finance', bg: '#d1fae5', color: '#065f46', desc: 'Factures, achats, TVA, rapports' },
              accountant: { label: 'Expert-comptable', bg: '#ede9fe', color: '#5b21b6', desc: 'Lecture + exports FEC / Grand Livre' },
              read_only:  { label: 'Lecture seule', bg: '#f1f5f9', color: '#475569', desc: "Consultation uniquement, aucune modification" },
            };

            const handleInvite = () => {
              if (!inviteEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
                notify('error', 'Adresse e-mail invalide.');
                return;
              }
              const alreadyExists = teamMembers.some((m) => m.email.toLowerCase() === inviteEmail.trim().toLowerCase());
              if (alreadyExists) {
                notify('error', 'Cette adresse est déjà membre de l\'équipe.');
                return;
              }
              const newMember = {
                id: `member-${Date.now()}`,
                name: inviteEmail.trim().split('@')[0]!,
                email: inviteEmail.trim(),
                role: inviteRole,
                joinedAt: new Date().toISOString().slice(0, 10),
              };
              setTeamMembers((prev) => [...prev, newMember]);
              notify('success', `Invitation envoyée à ${inviteEmail.trim()} (simulation).`);
              setInviteEmail('');
              setInviteRole('finance');
              setShowInviteForm(false);
            };

            return (
              <div>
                <div className="pl-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h1 className="pl-page-title">Équipe & Rôles</h1>
                  {!showInviteForm && (
                    <button type="button" className="pl-btn pl-btn-forest" onClick={() => setShowInviteForm(true)}>
                      + Inviter un membre
                    </button>
                  )}
                </div>

                {/* Invite form */}
                {showInviteForm && (
                  <div className="pl-table-card" style={{ padding: '1.25rem', marginBottom: '1.5rem', maxWidth: 540 }}>
                    <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700 }}>Inviter un nouveau membre</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Adresse e-mail</span>
                        <input
                          className="pl-input"
                          type="email"
                          placeholder="collaborateur@cabinet.fr"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleInvite(); } }}
                          autoFocus
                        />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rôle</span>
                        <select
                          className="pl-input"
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
                        >
                          {(['admin', 'finance', 'accountant', 'read_only'] as const).map((r) => (
                            <option key={r} value={r}>{ROLE_META[r]!.label} — {ROLE_META[r]!.desc}</option>
                          ))}
                        </select>
                      </label>
                      <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button type="button" className="pl-btn pl-btn-forest" onClick={handleInvite}>
                          Envoyer l'invitation
                        </button>
                        <button type="button" className="pl-btn pl-btn-outline" onClick={() => { setShowInviteForm(false); setInviteEmail(''); }}>
                          Annuler
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Role legend */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  {Object.entries(ROLE_META).map(([key, meta]) => (
                    <span key={key} style={{ fontSize: '0.72rem', fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                  ))}
                </div>

                {/* Members table */}
                <div className="pl-table-card" style={{ overflow: 'hidden' }}>
                  <table className="pl-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Membre</th>
                        <th>Rôle</th>
                        <th>Ajouté le</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamMembers.map((member) => {
                        const meta = ROLE_META[member.role] ?? ROLE_META['read_only']!;
                        const initials = member.name.slice(0, 2).toUpperCase();
                        return (
                          <tr key={member.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                <span
                                  style={{
                                    width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700,
                                    background: 'var(--brand-forest)', color: '#fff', flexShrink: 0,
                                  }}
                                >
                                  {initials}
                                </span>
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{member.name}</div>
                                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{member.email}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: meta.bg, color: meta.color }}>
                                {meta.label}
                              </span>
                            </td>
                            <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                              {member.joinedAt}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {member.role !== 'owner' ? (
                                <button
                                  type="button"
                                  className="pl-btn pl-btn-outline"
                                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.65rem', color: '#dc2626', borderColor: '#fca5a5' }}
                                  onClick={() => {
                                    setTeamMembers((prev) => prev.filter((m) => m.id !== member.id));
                                    notify('success', `Accès révoqué pour ${member.email} (simulation).`);
                                  }}
                                >
                                  Révoquer
                                </button>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Roles explanation */}
                <div className="pl-table-card" style={{ padding: '1.25rem', marginTop: '1.5rem' }}>
                  <h2 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 1rem' }}>Détail des permissions par rôle</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
                    {Object.entries(ROLE_META).map(([key, meta]) => (
                      <div key={key} style={{ padding: '0.75rem', borderRadius: 8, background: meta.bg, border: `1px solid ${meta.bg}` }}>
                        <div style={{ fontWeight: 700, color: meta.color, marginBottom: '0.3rem' }}>{meta.label}</div>
                        <div style={{ fontSize: '0.78rem', color: '#475569' }}>{meta.desc}</div>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: '1rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                    La gestion complète des rôles et permissions sera disponible à partir de M2 (Authentification & RBAC). Les invitations ci-dessus sont simulées.
                  </p>
                </div>
              </div>
            );
          })()}

        </main>
      </div>

      {/* ====================================================================
          SPLIT-SCREEN INVOICE & FACTUR-X INSPECTOR DRAWER (Screenshot 5!)
         ==================================================================== */}
      {inspectedInvoice && (
        <div
          className="pl-drawer-backdrop"
          onClick={() => setInspectedInvoice(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Inspecteur de facture"
        >
          <div className="pl-split-inspector" onClick={(e) => e.stopPropagation()}>
            {/* Top Action Bar (Screenshot 5) */}
            <div className="pl-inspector-topbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>
                  {inspectedInvoice.documentType === 'credit_note'
                    ? "Facture d'avoir"
                    : inspectedInvoice.documentType === 'deposit_invoice'
                    ? "Facture d'acompte"
                    : 'Facture de vente'}{' '}
                  {inspectedInvoice.number ?? inspectedInvoice.provisionalRef}
                </h2>
                <span
                  className={`pl-status-pill ${
                    inspectedInvoice.status === 'issued'
                      ? inspectedInvoice.paymentStatus === 'paid'
                        ? 'reconciled'
                        : 'paid'
                      : 'review'
                  }`}
                >
                  {inspectedInvoice.status === 'issued'
                    ? inspectedInvoice.paymentStatus === 'paid'
                      ? '✓ Encaissé & Lettré'
                      : '● Émise (Factur-X)'
                    : 'Brouillon provisoire'}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {inspectedInvoice.status === 'draft' && (
                  <button
                    type="button"
                    className="pl-btn pl-btn-mint"
                    onClick={() => handleIssueDocument(inspectedInvoice.id)}
                  >
                    ✓ Valider & Émettre (Factur-X)
                  </button>
                )}
                {inspectedInvoice.status === 'issued' &&
                  inspectedInvoice.documentType === 'standard_invoice' && (
                    <button
                      type="button"
                      className="pl-btn pl-btn-danger-outline"
                      onClick={() => handleCreateCreditNote(inspectedInvoice.id)}
                    >
                      ⊗ Annuler par Avoir
                    </button>
                  )}
                {inspectedInvoice.facturxXml && (
                  <button
                    type="button"
                    className="pl-btn pl-btn-outline"
                    onClick={() =>
                      downloadFile(
                        `${inspectedInvoice.number}-factur-x.xml`,
                        inspectedInvoice.facturxXml
                      )
                    }
                  >
                    ↓ XML Factur-X
                  </button>
                )}
                <button
                  type="button"
                  className="pl-btn pl-btn-outline"
                  onClick={() => setInspectedInvoice(null)}
                >
                  ✕ Fermer
                </button>
              </div>
            </div>

            <div className="pl-inspector-body">
              {/* LEFT PANE: Dark PDF Viewer + Realistic A4 French Invoice Sheet (Screenshot 5!) */}
              <div className="pl-pdf-pane">
                <div className="pl-pdf-toolbar">
                  <span>☰ {inspectedInvoice.number ?? inspectedInvoice.provisionalRef}.pdf (Factur-X PDF/A-3)</span>
                  <span>1 / 1 &nbsp;|&nbsp; - &nbsp; 100% &nbsp; +</span>
                  <span>Norme UE EN 16931</span>
                </div>

                <div className="pl-pdf-canvas-area">
                  {/* Left mini page thumbnail */}
                  <div>
                    <div className="pl-pdf-thumb">
                      <div style={{ fontWeight: 800, color: '#00382b', marginBottom: 4 }}>haxatax</div>
                      <div style={{ height: 3, background: '#cbd5e1', marginBottom: 3 }} />
                      <div style={{ height: 3, background: '#e2e8f0', width: '70%', marginBottom: 8 }} />
                      <div style={{ height: 18, background: '#f1f5f9', marginBottom: 6 }} />
                      <div style={{ height: 8, background: '#d1fae5', width: '50%' }} />
                    </div>
                    <div style={{ textAlign: 'center', color: '#cbd5e1', fontSize: '0.7rem', marginTop: 4 }}>
                      1
                    </div>
                  </div>

                  {/* Main A4 Invoice Sheet */}
                  <div className="pl-a4-sheet">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '1.15rem', fontWeight: 800, color: '#00382b' }}>
                          <span className="pl-logo-mark" style={{ width: 22, height: 22, fontSize: '0.75rem' }}>
                            H
                          </span>
                          <span>{workspace?.tradeName ?? 'Haxatax'}</span>
                        </div>
                        <div style={{ marginTop: 6, color: '#475569', fontSize: '0.7rem' }}>
                          <strong>{workspace?.legalName}</strong>
                          <br />
                          {workspace?.registeredAddress?.streetLine1}, {workspace?.registeredAddress?.postalCode}{' '}
                          {workspace?.registeredAddress?.city}
                          <br />
                          SIREN : {workspace?.siren} · SIRET : {workspace?.siret}
                          <br />
                          TVA Intracom. : {workspace?.vatNumber} · Capital : 10 000,00 €
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>
                          {inspectedInvoice.documentType === 'credit_note'
                            ? "FACTURE D'AVOIR"
                            : inspectedInvoice.documentType === 'deposit_invoice'
                            ? "FACTURE D'ACOMPTE"
                            : 'FACTURE'}{' '}
                          {inspectedInvoice.number ?? inspectedInvoice.provisionalRef}
                        </div>
                        <div style={{ color: '#475569', fontSize: '0.7rem', marginTop: 4 }}>
                          Date d'émission : <strong>{formatDateFr(inspectedInvoice.issueDate)}</strong>
                          <br />
                          Date de prestation : <strong>{formatDateFr(inspectedInvoice.deliveryOrServiceDate)}</strong>
                          <br />
                          Échéance de règlement : <strong>{formatDateFr(inspectedInvoice.dueDate)}</strong>
                          <br />
                          Catégorie d'opération : <strong>{inspectedInvoice.operationCategory?.toUpperCase()}</strong>
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        padding: '0.65rem 0.85rem',
                        marginBottom: '1.25rem',
                      }}
                    >
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
                        DESTINATAIRE (CLIENT B2B)
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem', marginTop: 2 }}>
                        {inspectedInvoice.contactLegalName}
                      </div>
                      {inspectedInvoice.purchaseOrderRef && (
                        <div style={{ fontSize: '0.7rem', color: '#334155' }}>
                          Réf. Bon de Commande (BT-13) : <strong>{inspectedInvoice.purchaseOrderRef}</strong>
                        </div>
                      )}
                    </div>

                    {/* Line items table */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem', fontSize: '0.72rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1.5px solid #0f172a', color: '#475569' }}>
                          <th style={{ padding: '4px 0', textAlign: 'left' }}>Désignation</th>
                          <th style={{ padding: '4px', textAlign: 'right' }}>Qté</th>
                          <th style={{ padding: '4px', textAlign: 'right' }}>PU HT</th>
                          <th style={{ padding: '4px', textAlign: 'right' }}>TVA</th>
                          <th style={{ padding: '4px 0', textAlign: 'right' }}>Total HT</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {inspectedInvoice.lines?.map((l: any) => (
                          <tr key={l.position} style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <td style={{ padding: '6px 0' }}>{l.description}</td>
                            <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                              {Number(l.quantity)} {l.unitCode}
                            </td>
                            <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                              {formatMinor(l.unitPriceHtMinor)}
                            </td>
                            <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                              {Number(l.vatRatePercent).toFixed(1)}%
                            </td>
                            <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700 }}>
                              {formatMinor(l.lineSubtotalHtMinor)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* EN 16931 Rate Breakdown & Totals */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1rem', marginTop: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                          DÉTAIL TVA PAR TAUX (NORME UE EN 16931)
                        </div>
                        {inspectedInvoice.taxBreakdowns?.map((tb: any) => (
                          <div key={tb.taxRuleCode} style={{ fontSize: '0.68rem', color: '#334155' }}>
                            Base HT ({Number(tb.vatRatePercent).toFixed(1)}%) : {formatMinor(tb.taxableBaseHtMinor)} → TVA :{' '}
                            <strong>{formatMinor(tb.vatAmountMinor)}</strong>
                          </div>
                        ))}
                        {inspectedInvoice.vatExemptionMention && (
                          <div style={{ marginTop: 6, fontSize: '0.66rem', color: '#047857', fontWeight: 600 }}>
                            {inspectedInvoice.vatExemptionMention}
                          </div>
                        )}
                      </div>

                      <div className="tabular-nums" style={{ borderTop: '1px solid #cbd5e1', paddingTop: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span>Total HT :</span>
                          <strong>{formatMinor(inspectedInvoice.subtotalHtMinor)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span>Total TVA :</span>
                          <strong>{formatMinor(inspectedInvoice.vatTotalMinor)}</strong>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            background: '#00382b',
                            color: '#ffffff',
                            padding: '5px 8px',
                            borderRadius: 4,
                            fontWeight: 800,
                            marginTop: 4,
                          }}
                        >
                          <span>Net à payer TTC :</span>
                          <span>{formatMinor(inspectedInvoice.netToPayTtcMinor)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Green SEPA Payment Box (Screenshot 5!) */}
                    <div
                      style={{
                        marginTop: '1.25rem',
                        background: '#d1fae5',
                        border: '1px solid #6ee7b7',
                        borderRadius: 6,
                        padding: '0.6rem 0.75rem',
                        fontSize: '0.66rem',
                        color: '#065f46',
                      }}
                    >
                      <strong>Informations de règlement SEPA :</strong> IBAN FR76 3000 4000 0100 0123 4567 894 · BIC BNPAFRPPXXX
                    </div>

                    {/* Mandatory French Legal Footer (Art. L441-9 Code de commerce & Art. 242 nonies A CGI) */}
                    <div style={{ marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: 6, fontSize: '0.6rem', color: '#64748b' }}>
                      Mentions légales obligatoires (Art. L441-9 Code de commerce) : {inspectedInvoice.discountTerms}. En cas de retard de paiement, application de pénalités au taux annuel de {inspectedInvoice.latePenaltyRatePercent} % et d'une indemnité forfaitaire pour frais de recouvrement de{' '}
                      {formatMinor(inspectedInvoice.recoveryIndemnityMinor)} (Art. D441-5 Code de commerce). Empreinte PAF SHA-256 :{' '}
                      <code>{(inspectedInvoice.documentHash ?? 'BROUILLON_NON_SCELLE').slice(0, 24)}…</code>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT PANE: Structured Accounting & Payment Inspector (Screenshot 5!) */}
              <div className="pl-meta-pane">
                <div className="pl-subtabs" style={{ marginBottom: '0.5rem' }}>
                  <button
                    type="button"
                    className={`pl-subtab ${inspectorRightTab === 'justificatif' ? 'active' : ''}`}
                    onClick={() => setInspectorRightTab('justificatif')}
                  >
                    Justificatif
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${inspectorRightTab === 'analytique' ? 'active' : ''}`}
                    onClick={() => setInspectorRightTab('analytique')}
                  >
                    Comptabilité PCG 2025
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${inspectorRightTab === 'paiement' ? 'active' : ''}`}
                    onClick={() => setInspectorRightTab('paiement')}
                  >
                    Paiement & Lettrage
                  </button>
                  <button
                    type="button"
                    className={`pl-subtab ${inspectorRightTab === 'xml' ? 'active' : ''}`}
                    onClick={() => setInspectorRightTab('xml')}
                  >
                    XML Factur-X
                  </button>
                </div>

                {inspectorRightTab === 'justificatif' && (
                  <>
                    <div className="pl-meta-card">
                      <span
                        className={`pl-status-pill ${
                          inspectedInvoice.paymentStatus === 'paid'
                            ? 'reconciled'
                            : inspectedInvoice.status === 'issued'
                            ? 'paid'
                            : 'review'
                        }`}
                      >
                        {inspectedInvoice.paymentStatus === 'paid'
                          ? '✓ Encaissé'
                          : inspectedInvoice.status === 'issued'
                          ? '● Émise — En attente de règlement'
                          : 'Brouillon'}
                      </span>

                      <div
                        className="tabular-nums"
                        style={{ fontSize: '1.85rem', fontWeight: 800, margin: '0.6rem 0 0.9rem' }}
                      >
                        {formatMinor(inspectedInvoice.totalTtcMinor)}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.85rem' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Reste à encaisser</div>
                          <div style={{ fontSize: '0.98rem', fontWeight: 700, marginTop: 2 }}>
                            {formatMinor(
                              inspectedInvoice.netToPayTtcMinor - inspectedInvoice.amountPaidMinor
                            )}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>TVA collectée (EN 16931)</div>
                          <div style={{ fontSize: '0.98rem', fontWeight: 700, marginTop: 2 }}>
                            {formatMinor(inspectedInvoice.vatTotalMinor)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pl-meta-card">
                      <div style={{ marginBottom: '0.85rem' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Numéro séquentiel sans trou</div>
                        <div className="font-mono" style={{ fontSize: '0.95rem', fontWeight: 700, marginTop: 2 }}>
                          {inspectedInvoice.number ?? inspectedInvoice.provisionalRef}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Émission</div>
                          <div style={{ fontWeight: 600, marginTop: 2 }}>
                            {formatDateFr(inspectedInvoice.issueDate)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Échéance</div>
                          <div style={{ fontWeight: 600, marginTop: 2 }}>
                            {formatDateFr(inspectedInvoice.dueDate)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pl-meta-card">
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 4 }}>Client (Tiers)</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div className="pl-tier-cell">
                          <span
                            className="pl-tier-logo"
                            style={{ background: getAvatarColor(inspectedInvoice.contactLegalName) }}
                          >
                            {getInitials(inspectedInvoice.contactLegalName)}
                          </span>
                          <span style={{ textDecoration: 'underline' }}>
                            {inspectedInvoice.contactLegalName}
                          </span>
                        </div>
                        <span className="pl-source-pill">Compte 411000</span>
                      </div>

                      {inspectedInvoice.status === 'issued' &&
                        inspectedInvoice.documentType !== 'credit_note' &&
                        inspectedInvoice.netToPayTtcMinor - inspectedInvoice.amountPaidMinor > 0 && (
                          <button
                            type="button"
                            className="pl-btn pl-btn-mint"
                            style={{ width: '100%', marginTop: '1rem', padding: '0.6rem' }}
                            onClick={() =>
                              handleRecordPayment(
                                inspectedInvoice.id,
                                inspectedInvoice.netToPayTtcMinor - inspectedInvoice.amountPaidMinor
                              )
                            }
                          >
                            ✓ Enregistrer l'encaissement & Lettrer le compte 411
                          </button>
                        )}
                    </div>
                  </>
                )}

                {inspectorRightTab === 'analytique' && (
                  <div className="pl-meta-card">
                    <h4 style={{ marginTop: 0 }}>Imputation Comptable Automatique (Journal VE — PCG 2025)</h4>
                    <p style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Ventilation générée automatiquement lors de l'émission conformément au Plan Comptable Général 2025 :
                    </p>
                    <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem', background: '#f8fafc', borderRadius: 6 }}>
                        <span><strong>411000</strong> Client ({inspectedInvoice.contactLegalName})</span>
                        <strong>Débit {formatMinor(inspectedInvoice.totalTtcMinor)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem', background: '#f8fafc', borderRadius: 6 }}>
                        <span><strong>706000</strong> Prestations de services</span>
                        <strong>Crédit {formatMinor(inspectedInvoice.subtotalHtMinor)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem', background: '#f8fafc', borderRadius: 6 }}>
                        <span>
                          <strong>{workspace?.vatExigibility === 'ENCAISSEMENTS' ? '445740' : '445710'}</strong> TVA collectée
                        </span>
                        <strong>Crédit {formatMinor(inspectedInvoice.vatTotalMinor)}</strong>
                      </div>
                    </div>
                  </div>
                )}

                {inspectorRightTab === 'paiement' && (
                  <div className="pl-meta-card">
                    <h4 style={{ marginTop: 0 }}>Statut de Rapprochement & Lettrage FEC</h4>
                    <p style={{ fontSize: '0.82rem' }}>
                      Montant réglé : <strong>{formatMinor(inspectedInvoice.amountPaidMinor)}</strong> /{' '}
                      {formatMinor(inspectedInvoice.netToPayTtcMinor)}
                    </p>
                    <p style={{ fontSize: '0.78rem', color: '#475569' }}>
                      Empreinte cryptographique SHA-256 (PAF) :
                      <br />
                      <code style={{ wordBreak: 'break-all', fontSize: '0.72rem', color: '#047857' }}>
                        {inspectedInvoice.documentHash ?? "En attente d'émission"}
                      </code>
                    </p>
                  </div>
                )}

                {inspectorRightTab === 'xml' && (
                  <div className="pl-meta-card">
                    <h4 style={{ marginTop: 0 }}>Flux XML Factur-X 1.0.07 (EN 16931 CII)</h4>
                    {inspectedInvoice.facturxXml ? (
                      <pre
                        style={{
                          background: '#0f172a',
                          color: '#a7f3d0',
                          padding: '0.75rem',
                          borderRadius: 8,
                          fontSize: '0.7rem',
                          overflowX: 'auto',
                          maxHeight: 380,
                        }}
                      >
                        {inspectedInvoice.facturxXml}
                      </pre>
                    ) : (
                      <p style={{ color: '#64748b' }}>
                        Émettez le brouillon pour générer et sceller le fichier XML Factur-X EN 16931.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: CREATE NEW INVOICE / DEPOSIT / QUOTE
         ==================================================================== */}
      {showNewInvoiceModal && (
        <div className="pl-drawer-backdrop" onClick={() => { setShowNewInvoiceModal(false); setInvFile(null); setInvExtractedDocId(null); setInvExtracting(false); setInvEntryMode('import'); }}>
          <FocusTrap active={showNewInvoiceModal}>
          <div
            className="pl-meta-card"
            style={{ width: 'min(560px, 94vw)', margin: 'auto', padding: '1.5rem' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-modal-title"
          >
            <h3 id="invoice-modal-title" style={{ marginTop: 0, marginBottom: '1rem' }}>Créer un document de vente (Factur-X EN 16931)</h3>

            {/* ── Mode toggle ── */}
            <div style={{ display: 'flex', borderRadius: 8, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: '1.1rem' }}>
              <button
                type="button"
                onClick={() => setInvEntryMode('import')}
                style={{ flex: 1, padding: '0.55rem 0.5rem', background: invEntryMode === 'import' ? '#f0fdf4' : '#fff', border: 'none', borderRight: '1px solid #e2e8f0', color: invEntryMode === 'import' ? '#065f46' : '#64748b', cursor: 'pointer', fontWeight: invEntryMode === 'import' ? 700 : 400, fontSize: '0.82rem' }}
              >📄 Importer un document</button>
              <button
                type="button"
                onClick={() => setInvEntryMode('manual')}
                style={{ flex: 1, padding: '0.55rem 0.5rem', background: invEntryMode === 'manual' ? '#f0fdf4' : '#fff', border: 'none', color: invEntryMode === 'manual' ? '#065f46' : '#64748b', cursor: 'pointer', fontWeight: invEntryMode === 'manual' ? 700 : 400, fontSize: '0.82rem' }}
              >✏️ Saisie manuelle</button>
            </div>

            <form onSubmit={handleCreateDraft} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

              {/* ── Import mode: file drop zone ── */}
              {invEntryMode === 'import' && !invFile && (
                <label
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.55rem',
                    padding: '2rem 1rem', border: `2px dashed ${invFileDragging ? '#059669' : '#cbd5e1'}`,
                    borderRadius: 8, cursor: 'pointer',
                    background: invFileDragging ? '#f0fdf4' : '#f8fafc',
                    color: '#64748b', fontSize: '0.85rem', transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onDragOver={(e) => { e.preventDefault(); setInvFileDragging(true); }}
                  onDragLeave={() => setInvFileDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setInvFileDragging(false); const f = e.dataTransfer.files[0]; if (f) extractAndPrefillInvoice(f); }}
                >
                  <span style={{ fontSize: '2.2rem' }}>📄</span>
                  <span style={{ fontWeight: 600, textAlign: 'center' }}>Glissez votre document ici ou <strong style={{ color: '#059669' }}>cliquez pour parcourir</strong></span>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>Factur-X XML, PDF, JPG, PNG — les champs seront pré-remplis automatiquement</span>
                  <input type="file" accept=".pdf,.xml,.jpg,.jpeg,.png,.tiff,.tif" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) extractAndPrefillInvoice(f); }} />
                </label>
              )}

              {/* ── Import mode: extracting spinner ── */}
              {invEntryMode === 'import' && invFile && invExtracting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1.1rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '1.4rem', animation: 'spin 1s linear infinite' }}>⏳</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>Analyse OCR en cours…</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>{invFile.name}</div>
                  </div>
                </div>
              )}

              {/* ── Import mode: file confirmed banner ── */}
              {invEntryMode === 'import' && invFile && !invExtracting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 0.75rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6 }}>
                  <span style={{ fontSize: '1.1rem' }}>✅</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', color: '#166534', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{invFile.name}</div>
                    {invExtractedDocId
                      ? <div style={{ fontSize: '0.72rem', color: '#15803d', marginTop: 1 }}>Champs extraits — vérifiez et complétez si besoin</div>
                      : <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 1 }}>Fichier joint · remplissez les champs manuellement</div>}
                  </div>
                  <button type="button" onClick={() => { setInvFile(null); setInvExtractedDocId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '1rem', lineHeight: 1, padding: '0 0.2rem' }} aria-label="Supprimer le fichier">✕</button>
                </div>
              )}

              {/* ── Form fields — manual mode OR after import done ── */}
              {(invEntryMode === 'manual' || (invEntryMode === 'import' && invFile && !invExtracting)) && (
                <>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                  Type de document
                </label>
                <select
                  value={newDocType}
                  onChange={(e) => setNewDocType(e.target.value as any)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                >
                  <option value="standard_invoice">Facture de vente standard (Code 380)</option>
                  <option value="deposit_invoice">Facture d'acompte (Code 386 — Art. 289 CGI)</option>
                  <option value="quote">Devis / Proposition commerciale</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                  Client (Tiers B2B)
                </label>
                <select
                  value={newContactId}
                  onChange={(e) => setNewContactId(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                >
                  <option value="">— Sélectionner ou créer un client —</option>
                  {contacts
                    .filter((c) => c.kind === 'customer' || c.kind === 'both')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legalName} ({c.siren ? `SIREN ${c.siren}` : c.vatIdentifier})
                      </option>
                    ))}
                </select>
                <button type="button" className="pl-btn pl-btn-outline" style={{ marginTop: '0.4rem' }} onClick={() => openContactCreate('customer', 'invoice')}>
                  + Créer un client
                </button>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                  Désignation de la prestation
                </label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.65rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                    Quantité (Jours)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    required
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                    Prix unitaire HT (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newUnitPriceEuros}
                    onChange={(e) => setNewUnitPriceEuros(e.target.value)}
                    required
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                    Taux de TVA
                  </label>
                  <select
                    value={newTaxRule}
                    onChange={(e) => setNewTaxRule(e.target.value)}
                    disabled={workspace?.vatRegime === 'FRANCHISE_293B'}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  >
                    <option value="FR_TVA_20">20 % Normal</option>
                    <option value="FR_TVA_10">10 % Intermédiaire</option>
                    <option value="FR_TVA_5_5">5,5 % Réduit</option>
                    <option value="FR_FRANCHISE_293B">0 % Franchise 293 B</option>
                    <option value="EU_B2B_SERVICES_REVERSE_CHARGE">0 % Autoliquidation UE</option>
                  </select>
                </div>
              </div>
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="pl-btn pl-btn-outline"
                  onClick={() => { setShowNewInvoiceModal(false); setInvFile(null); setInvExtractedDocId(null); setInvExtracting(false); setInvEntryMode('import'); }}
                >
                  Annuler
                </button>
                {(invEntryMode === 'manual' || (invEntryMode === 'import' && invFile && !invExtracting)) && (
                  <button type="submit" className="pl-btn pl-btn-mint">
                    Créer & Ouvrir l'aperçu Factur-X
                  </button>
                )}
              </div>
            </form>
          </div>
          </FocusTrap>
        </div>
      )}

      {/* ====================================================================
          MODAL: CREATE NEW EXPENSE
         ==================================================================== */}
      {showNewExpenseModal && (
        <div className="pl-drawer-backdrop" onClick={() => { setShowNewExpenseModal(false); setExpFile(null); setExpExtractedDocId(null); setExpExtracting(false); setExpEntryMode('import'); }}>
          <FocusTrap active={showNewExpenseModal}>
          <div
            className="pl-meta-card"
            style={{ width: 'min(540px, 94vw)', margin: 'auto', padding: '1.5rem' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-modal-title"
          >
            <h3 id="expense-modal-title" style={{ marginTop: 0, marginBottom: '1rem' }}>Saisir une facture d'achat fournisseur</h3>

            {/* ── Mode toggle ── */}
            <div style={{ display: 'flex', borderRadius: 8, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: '1.1rem' }}>
              <button
                type="button"
                onClick={() => setExpEntryMode('import')}
                style={{ flex: 1, padding: '0.55rem 0.5rem', background: expEntryMode === 'import' ? '#f0fdf4' : '#fff', border: 'none', borderRight: '1px solid #e2e8f0', color: expEntryMode === 'import' ? '#065f46' : '#64748b', cursor: 'pointer', fontWeight: expEntryMode === 'import' ? 700 : 400, fontSize: '0.82rem' }}
              >📄 Importer un document</button>
              <button
                type="button"
                onClick={() => setExpEntryMode('manual')}
                style={{ flex: 1, padding: '0.55rem 0.5rem', background: expEntryMode === 'manual' ? '#f0fdf4' : '#fff', border: 'none', color: expEntryMode === 'manual' ? '#065f46' : '#64748b', cursor: 'pointer', fontWeight: expEntryMode === 'manual' ? 700 : 400, fontSize: '0.82rem' }}
              >✏️ Saisie manuelle</button>
            </div>

            <form onSubmit={handleCreateExpense} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

              {/* ── Import mode: file zone (before file selected) ── */}
              {expEntryMode === 'import' && !expFile && (
                <label
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.55rem',
                    padding: '2rem 1rem', border: `2px dashed ${expFileDragging ? '#059669' : '#cbd5e1'}`,
                    borderRadius: 8, cursor: 'pointer',
                    background: expFileDragging ? '#f0fdf4' : '#f8fafc',
                    color: '#64748b', fontSize: '0.85rem', transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onDragOver={(e) => { e.preventDefault(); setExpFileDragging(true); }}
                  onDragLeave={() => setExpFileDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setExpFileDragging(false);
                    const f = e.dataTransfer.files[0];
                    if (f) extractAndPrefillExpense(f);
                  }}
                >
                  <span style={{ fontSize: '2.2rem' }}>📄</span>
                  <span style={{ fontWeight: 600, textAlign: 'center' }}>Glissez votre facture ici ou <strong style={{ color: '#059669' }}>cliquez pour parcourir</strong></span>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>PDF, JPG, PNG, TIFF — les champs seront extraits automatiquement</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) extractAndPrefillExpense(f); }}
                  />
                </label>
              )}

              {/* ── Import mode: extracting spinner ── */}
              {expEntryMode === 'import' && expFile && expExtracting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1.1rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '1.4rem', animation: 'spin 1s linear infinite' }}>⏳</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>Analyse OCR en cours…</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>{expFile.name}</div>
                  </div>
                </div>
              )}

              {/* ── Import mode: file confirmed banner ── */}
              {expEntryMode === 'import' && expFile && !expExtracting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 0.75rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6 }}>
                  <span style={{ fontSize: '1.1rem' }}>✅</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', color: '#166534', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{expFile.name}</div>
                    {expExtractedDocId
                      ? <div style={{ fontSize: '0.72rem', color: '#15803d', marginTop: 1 }}>Champs extraits — vérifiez et complétez si besoin</div>
                      : <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 1 }}>Fichier joint · remplissez les champs manuellement</div>}
                  </div>
                  <button type="button" onClick={() => { setExpFile(null); setExpExtractedDocId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '1rem', lineHeight: 1, padding: '0 0.2rem' }} aria-label="Supprimer le fichier">✕</button>
                </div>
              )}

              {/* ── Form fields — shown in manual mode OR after file done in import mode ── */}
              {(expEntryMode === 'manual' || (expEntryMode === 'import' && expFile && !expExtracting)) && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Fournisseur</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <select value={expenseSupplierContactId} onChange={e => setExpenseSupplierContactId(e.target.value)} required style={{ flex: 1, minWidth: 0, padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                        <option value="">— Sélectionner un fournisseur —</option>
                        {contacts.filter(contact => contact.kind === 'supplier' || contact.kind === 'both').map(contact => <option key={contact.id} value={contact.id}>{contact.legalName}</option>)}
                      </select>
                      <button type="button" className="pl-btn pl-btn-outline" onClick={() => openContactCreate('supplier', 'expense')}>+ Ajouter</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Référence facture (PieceRef FEC)</label>
                      <input type="text" value={expRef} onChange={(e) => setExpRef(e.target.value)} required style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Date de la facture</label>
                      <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} required style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Description</label>
                    <input type="text" value={expDesc} onChange={(e) => setExpDesc(e.target.value)} required style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Compte PCG 2025</label>
                      <select value={expAccount} onChange={(e) => setExpAccount(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                        <option value="613500">613500 — Logiciels SaaS & Cloud</option>
                        <option value="606100">606100 — Carburant & Énergie</option>
                        <option value="622600">622600 — Honoraires</option>
                        <option value="625100">625100 — Voyages & Déplacements</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Quotité TVA déductible</label>
                      <select value={expRatio} onChange={(e) => setExpRatio(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                        <option value="1.00">100 % Déductible</option>
                        <option value="0.80">80 % Déductible (Carburant)</option>
                        <option value="0.00">0 % Non déductible</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Montant HT (€)</label>
                    <input type="number" step="0.01" value={expHtEuros} onChange={(e) => setExpHtEuros(e.target.value)} required style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className="pl-btn pl-btn-outline"
                  onClick={() => { setShowNewExpenseModal(false); setExpFile(null); setExpExtractedDocId(null); setExpExtracting(false); setExpEntryMode('import'); }}
                >
                  Annuler
                </button>
                {(expEntryMode === 'manual' || (expEntryMode === 'import' && expFile && !expExtracting)) && (
                  <button type="submit" className="pl-btn pl-btn-mint">
                    Ventiler au Journal des Achats (AC)
                  </button>
                )}
              </div>
            </form>
          </div>
          </FocusTrap>
        </div>
      )}

      {/* ====================================================================
          MODAL: CREATE NEW CONTACT (TIERS SIREN / VIES)
         ==================================================================== */}
      {showNewContactModal && (
        <div className="pl-drawer-backdrop" onClick={() => { setShowNewContactModal(false); setContactCreatedData(null); }}>
          <FocusTrap active={showNewContactModal}>
          <div
            className="pl-meta-card"
            style={{ width: 'min(500px, 94vw)', margin: 'auto', padding: '1.5rem' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-modal-title"
          >
            {contactCreatedData ? (
              /* ── Step 2: Next-step panel shown after successful creation ── */
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>✅</span>
                  <h3 id="contact-modal-title" style={{ margin: 0, color: '#059669', fontSize: '1.05rem' }}>
                    {contactCreatedData.kind === 'supplier' ? 'Fournisseur créé !' : contactCreatedData.kind === 'customer' ? 'Client créé !' : 'Tiers créé !'}
                  </h3>
                </div>
                <p style={{ color: '#475569', fontSize: '0.88rem', margin: '0 0 1.1rem' }}>
                  <strong>{contactCreatedData.legalName}</strong> est dans votre répertoire.
                  {' '}Son compte auxiliaire FEC et son code TVA ont été générés automatiquement.
                </p>

                {/* Process flow indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: '1.1rem', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', fontSize: '0.72rem' }}>
                  <div style={{ padding: '0.4rem 0.7rem', background: '#059669', color: '#fff', fontWeight: 700 }}>1 · Tiers ✓</div>
                  <div style={{ padding: '0.4rem 0.7rem', background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 }}>2 · Document</div>
                  <div style={{ padding: '0.4rem 0.7rem', background: '#f1f5f9', color: '#94a3b8' }}>3 · Comptabilité</div>
                  <div style={{ padding: '0.4rem 0.7rem', background: '#f1f5f9', color: '#94a3b8' }}>4 · Rapprochement</div>
                </div>

                <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', margin: '0 0 0.65rem' }}>Quelle est la prochaine étape ?</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {(contactCreatedData.kind === 'customer' || contactCreatedData.kind === 'both') && (
                    <button
                      type="button"
                      className="pl-btn pl-btn-forest"
                      style={{ textAlign: 'left', padding: '0.85rem 1rem', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 2 }}
                      onClick={() => {
                        setShowNewContactModal(false);
                        setContactCreatedData(null);
                        setSection('sales');
                        setShowNewInvoiceModal(true);
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>📄 Créer une facture client</span>
                      <span style={{ fontSize: '0.77rem', fontWeight: 400, opacity: 0.9 }}>Émettez une facture pour {contactCreatedData.legalName} — écritures VE générées automatiquement</span>
                    </button>
                  )}
                  {(contactCreatedData.kind === 'supplier' || contactCreatedData.kind === 'both') && (
                    <button
                      type="button"
                      className="pl-btn pl-btn-mint"
                      style={{ textAlign: 'left', padding: '0.85rem 1rem', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 2 }}
                      onClick={() => {
                        setShowNewContactModal(false);
                        setContactCreatedData(null);
                        setSection('purchases');
                        setShowNewExpenseModal(true);
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>🧾 Enregistrer une facture fournisseur</span>
                      <span style={{ fontSize: '0.77rem', fontWeight: 400, opacity: 0.9 }}>Importez une facture reçue de {contactCreatedData.legalName} — compte 401 mis à jour</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="pl-btn pl-btn-outline"
                    style={{ padding: '0.7rem 1rem' }}
                    onClick={() => { setShowNewContactModal(false); setContactCreatedData(null); setSection('contacts'); }}
                  >
                    Voir le répertoire des tiers →
                  </button>
                </div>
              </>
            ) : (
              /* ── Step 1: Create contact form ── */
              <>
                <h3 id="contact-modal-title" style={{ marginTop: 0 }}>
                  {contactCreateContext === 'invoice' ? 'Créer un client' : contactCreateContext === 'expense' || contactCreateContext === 'document' ? 'Ajouter un fournisseur' : 'Nouveau tiers'}
                </h3>
                <form onSubmit={handleCreateContact} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                      Type de tiers
                    </label>
                    <select
                      value={contactKind}
                      onChange={(e) => setContactKind(e.target.value as 'customer' | 'supplier' | 'both')}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                    >
                      <option value="customer">Client (411CLIxxxx)</option>
                      <option value="supplier">Fournisseur (401FOUxxxx)</option>
                      <option value="both">Client et fournisseur</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Nature du tiers</label>
                    <select value={contactIsBusiness ? 'business' : 'individual'} onChange={e => setContactIsBusiness(e.target.value === 'business')} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                      <option value="business">Entreprise (B2B)</option>
                      <option value="individual">Particulier (B2C)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                      Raison sociale
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Mistral AI SAS"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      required
                      style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                      SIREN (9 chiffres — requis pour une entreprise française)
                    </label>
                    <input
                      type="text"
                      value={contactSiren}
                      inputMode="numeric"
                      placeholder={contactIsBusiness ? '9 chiffres' : 'Facultatif pour un particulier'}
                      onChange={(e) => setContactSiren(e.target.value.replace(/\D/g, '').slice(0, 9))}
                      required={contactIsBusiness}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Adresse de facturation</label>
                    <input type="text" value={contactStreet} onChange={e => setContactStreet(e.target.value)} placeholder="N° et rue" required style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 0.7fr) 1.3fr', gap: '0.5rem' }}>
                    <input aria-label="Code postal" type="text" value={contactPostalCode} onChange={e => setContactPostalCode(e.target.value)} placeholder="Code postal" required style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                    <input aria-label="Ville du tiers" type="text" value={contactCity} onChange={e => setContactCity(e.target.value)} placeholder="Ville" required style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>E-mail (facultatif)</label>
                    <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="contact@exemple.fr" style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="pl-btn pl-btn-outline"
                      onClick={() => setShowNewContactModal(false)}
                    >
                      Annuler
                    </button>
                    <button type="submit" className="pl-btn pl-btn-mint" disabled={contactSaving}>
                      {contactSaving ? 'Création…' : 'Créer le tiers →'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
          </FocusTrap>
        </div>
      )}

      {/* ====================================================================
          MODAL: GROUPED BANK RECONCILIATION ("Chercher parmi plus de factures" — Image 1)
         ==================================================================== */}
      {showGroupMatchModal && (
        <div className="pl-modal-backdrop" onClick={() => setShowGroupMatchModal(false)}>
          <FocusTrap active={showGroupMatchModal}>
          <div className="pl-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="group-match-modal-title">
            <h3 id="group-match-modal-title" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
              Traitement des virements et prélèvements groupés SEPA
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 0, marginBottom: '1rem' }}>
              Sélectionnez une ou plusieurs factures clients (411) ou fournisseurs (401) à rapprocher et lettrer sur la transaction bancaire sélectionnée.
            </p>
            <form onSubmit={handleReconcileBankGroup}>
              <div
                style={{
                  maxHeight: 320,
                  overflowY: 'auto',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  marginBottom: '1rem',
                }}
              >
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }} />
                      <th>TYPE</th>
                      <th>N° FACTURE / RÉF.</th>
                      <th>TIERS</th>
                      <th>ÉCHÉANCE</th>
                      <th style={{ textAlign: 'right' }}>RESTE À RAPPROCHER</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {invoices
                      .filter((i) => i.status === 'issued' && i.paymentStatus !== 'paid')
                      .map((inv) => (
                        <tr
                          key={inv.id}
                          onClick={() =>
                            setSelectedGroupDocIds((prev) => ({
                              ...prev,
                              [inv.id]: !prev[inv.id],
                            }))
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedGroupDocIds[inv.id])}
                              onChange={() => {}}
                            />
                          </td>
                          <td>
                            <span className="pl-status-pill paid">Vente (411)</span>
                          </td>
                          <td className="font-mono">
                            <strong>{inv.number}</strong>
                          </td>
                          <td>{inv.contactLegalName}</td>
                          <td>{formatDateFr(inv.dueDate)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                            +{formatMinor(inv.netToPayTtcMinor - inv.amountPaidMinor)}
                          </td>
                        </tr>
                      ))}
                    {expenses
                      .filter((ex) => ex.paymentState === 'to_pay')
                      .map((ex) => (
                        <tr
                          key={ex.id}
                          onClick={() =>
                            setSelectedGroupDocIds((prev) => ({
                              ...prev,
                              [ex.id]: !prev[ex.id],
                            }))
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedGroupDocIds[ex.id])}
                              onChange={() => {}}
                            />
                          </td>
                          <td>
                            <span className="pl-status-pill review">Achat (401)</span>
                          </td>
                          <td className="font-mono">
                            <strong>{ex.supplierInvoiceRef}</strong>
                          </td>
                          <td>{ex.supplierName}</td>
                          <td>{formatDateFr(ex.dueDate)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                            -{formatMinor(ex.amountTtcMinor)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="pl-btn pl-btn-outline"
                  onClick={() => setShowGroupMatchModal(false)}
                >
                  Annuler
                </button>
                <button type="submit" className="pl-btn pl-btn-mint">
                  ⇄ Rapprocher & Lettrer la sélection
                </button>
              </div>
            </form>
          </div>
          </FocusTrap>
        </div>
      )}

      {/* ====================================================================
          MODAL: MANUAL JOURNAL ENTRY ("+ Nouvelle écriture" — Image 2)
         ==================================================================== */}
      {showManualEntryModal && (
        <div className="pl-modal-backdrop" onClick={() => setShowManualEntryModal(false)}>
          <FocusTrap active={showManualEntryModal}>
          <div className="pl-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="manual-entry-modal-title">
            <h3 id="manual-entry-modal-title" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
              + Nouvelle écriture comptable en partie double (PCG 2025)
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 0, marginBottom: '1rem' }}>
              Règlement ANC n° 2022-06 : équilibre Débit = Crédit obligatoire, référence de pièce FEC requise, compte 79 interdit.
            </p>
            <form
              onSubmit={handleCreateManualEntry}
              style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.65rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>
                    Code Journal
                  </label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select
                      value={manualJournal}
                      onChange={(e) => setManualJournal(e.target.value as 'OD' | 'VE' | 'AC' | 'BQ' | 'CA' | 'AN')}
                      style={{ flex: 1, padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                    >
                      <option value="OD">OD — Opérations Diverses</option>
                      <option value="VE">VE — Journal des Ventes</option>
                      <option value="AC">AC — Journal des Achats</option>
                      <option value="BQ">BQ — Journal de Banque</option>
                      <option value="CA">CA — Journal de Caisse</option>
                      <option value="AN">AN — À-Nouveaux</option>
                    </select>
                    <button
                      type="button"
                      title="Auto-détecter le journal à partir des comptes"
                      onClick={() => setManualJournal(detectJournalCode(manualDebitAccount, manualCreditAccount))}
                      style={{ padding: '0.5rem 0.6rem', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f1f5f9', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    >
                      🔍 Auto
                    </button>
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>
                    Numéro de pièce / facture
                  </label>
                  <input
                    type="text"
                    value={manualPieceRef}
                    onChange={(e) => setManualPieceRef(e.target.value)}
                    required
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>
                    Date d'échéance
                  </label>
                  <input
                    type="date"
                    value={manualDueDate}
                    onChange={(e) => setManualDueDate(e.target.value)}
                    required
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>
                  Libellé de ligne d'écriture
                </label>
                <input
                  type="text"
                  value={manualDesc}
                  onChange={(e) => setManualDesc(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                />
              </div>

              {/* Sector selector — changes PCG account suggestions */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>
                  Secteur d'activité (filtre comptes PCG 2025)
                </label>
                <select
                  value={manualActivitySector}
                  onChange={(e) => setManualActivitySector(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                >
                  {PCG_SECTORS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              {/* datalist for the selected sector */}
              <datalist id="pcg-accounts-list">
                {(PCG_SECTORS.find((s) => s.id === manualActivitySector)?.accounts ?? []).map((a) => (
                  <option key={a.code} value={a.code}>{a.code} — {a.label}</option>
                ))}
              </datalist>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.65rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>
                    Compte PCG 2025 au Débit
                  </label>
                  <input
                    type="text"
                    list="pcg-accounts-list"
                    value={manualDebitAccount}
                    onChange={(e) => setManualDebitAccount(e.target.value.split(' ')[0]!.trim())}
                    required
                    placeholder="ex. 613500"
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  />
                  {manualDebitAccount && (
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                      {PCG_SECTORS.find((s) => s.id === manualActivitySector)?.accounts.find((a) => a.code === manualDebitAccount)?.label ?? ''}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>
                    Compte PCG 2025 au Crédit
                  </label>
                  <input
                    type="text"
                    list="pcg-accounts-list"
                    value={manualCreditAccount}
                    onChange={(e) => setManualCreditAccount(e.target.value.split(' ')[0]!.trim())}
                    required
                    placeholder="ex. 512100"
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  />
                  {manualCreditAccount && (
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                      {PCG_SECTORS.find((s) => s.id === manualActivitySector)?.accounts.find((a) => a.code === manualCreditAccount)?.label ?? ''}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>
                    Montant HT équilibré (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={manualAmountEuros}
                    onChange={(e) => setManualAmountEuros(e.target.value)}
                    required
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  />
                </div>
              </div>

              {/* TVA déductible — taux + coefficient de déduction slider */}
              {(() => {
                const htMinor = Math.round((Number.parseFloat(manualAmountEuros) || 0) * 100);
                const rate = Number.parseFloat(manualTvaRate) || 0;
                const tvaBruteMinor = Math.round(htMinor * rate / 100);
                const tvaDedMinor = Math.round(tvaBruteMinor * manualTvaCoeff / 100);
                const coeff = manualTvaCoeff;
                const coeffColor = coeff === 0 ? '#dc2626' : coeff < 50 ? '#d97706' : coeff < 100 ? '#ca8a04' : '#059669';
                return (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.9rem 1rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                      TVA — Taux & Coefficient de déduction
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem', alignItems: 'start' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Taux de TVA applicable</label>
                        <select
                          value={manualTvaRate}
                          onChange={(e) => setManualTvaRate(e.target.value)}
                          style={{ width: '100%', padding: '0.45rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                        >
                          <option value="20">20% — Taux normal</option>
                          <option value="10">10% — Taux intermédiaire (restauration, travaux)</option>
                          <option value="5.5">5,5% — Taux réduit (alimentaire, livres)</option>
                          <option value="2.1">2,1% — Taux particulier (presse, médicaments)</option>
                          <option value="0">0% — Exonéré / autoliquidation / franchise</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>Coefficient de déduction (art. 205–242 CGI)</label>
                          <span style={{ fontWeight: 800, fontSize: '0.9rem', color: coeffColor, minWidth: 44, textAlign: 'right' }}>{coeff}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={manualTvaCoeff}
                          onChange={(e) => setManualTvaCoeff(Number(e.target.value))}
                          style={{ width: '100%', accentColor: 'var(--brand-forest)' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#94a3b8', marginTop: 2 }}>
                          <span>0% — Exonéré (médecin, banque)</span>
                          <span>50% — Pro-rata</span>
                          <span>100% — Pleine déduction</span>
                        </div>
                      </div>
                    </div>
                    {/* Live computation */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginTop: '0.75rem' }}>
                      {[
                        { label: 'Montant HT', value: formatMinor(htMinor), color: '#0f172a' },
                        { label: `TVA brute (${manualTvaRate}%)`, value: formatMinor(tvaBruteMinor), color: '#64748b' },
                        { label: `TVA déductible (×${coeff}%)`, value: formatMinor(tvaDedMinor), color: coeffColor },
                      ].map((kpi) => (
                        <div key={kpi.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.5rem 0.65rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: 2 }}>{kpi.label}</div>
                          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: kpi.color }}>{kpi.value}</div>
                        </div>
                      ))}
                    </div>
                    {coeff < 100 && rate > 0 && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '0.4rem 0.65rem' }}>
                        ⚠ Activité mixte ou exonérée : {formatMinor(tvaBruteMinor - tvaDedMinor)} de TVA non-récupérable à comptabiliser en charge (compte 635xxx ou intégré au coût du bien).
                      </div>
                    )}
                  </div>
                );
              })()}

              {(() => {
                const jViolations = (manualDebitAccount && manualCreditAccount)
                  ? checkJournalEntry(manualJournal, manualDebitAccount, manualCreditAccount)
                  : [];
                const hasBlocking = jViolations.some((v) => v.blocking);
                return (
                  <>
                    {jViolations.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {jViolations.map((v, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: '0.78rem',
                              padding: '0.45rem 0.7rem',
                              borderRadius: 6,
                              background: v.blocking ? '#fef2f2' : '#fffbeb',
                              border: `1px solid ${v.blocking ? '#fca5a5' : '#fcd34d'}`,
                              color: v.blocking ? '#991b1b' : '#92400e',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                            }}
                          >
                            {v.blocking ? '🚫' : '⚠'} {v.message}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="pl-btn pl-btn-outline"
                        onClick={() => setShowManualEntryModal(false)}
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        className="pl-btn pl-btn-forest"
                        disabled={hasBlocking}
                        style={{ opacity: hasBlocking ? 0.5 : 1 }}
                      >
                        ✓ Comptabiliser & Sceller SHA-256
                      </button>
                    </div>
                  </>
                );
              })()}
            </form>
          </div>
          </FocusTrap>
        </div>
      )}

      {/* ==================================================================
          MODAL: RELANCER LE CLIENT
         ================================================================== */}
      {showRelanceModal && relanceInvoice && (
        <div className="pl-drawer-backdrop" onClick={() => setShowRelanceModal(false)}>
          <FocusTrap active={showRelanceModal}>
          <div
            className="pl-meta-card"
            style={{ width: 'min(580px, 95vw)', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', fontWeight: 800 }}>
              ✉ Relancer {relanceInvoice.contactLegalName} — Facture {relanceInvoice.number ?? relanceInvoice.provisionalRef}
            </h3>

            {/* Template selector */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {(['polite', 'standard', 'urgent'] as RelanceLevel[]).map((lvl) => {
                const labels = { polite: '😊 Rappel amiable', standard: '📋 Relance standard', urgent: '⚠ Mise en demeure' };
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => {
                      setRelanceTemplate(lvl);
                      const tmpl = buildRelanceEmail(lvl, relanceInvoice, workspace?.legalName ?? 'Votre comptable');
                      setRelanceSubject(tmpl.subject);
                      setRelanceBody(tmpl.body);
                    }}
                    style={{
                      padding: '0.35rem 0.8rem', borderRadius: 20, border: '1px solid',
                      fontSize: '0.78rem', fontWeight: relanceTemplate === lvl ? 700 : 400, cursor: 'pointer',
                      background: relanceTemplate === lvl ? (lvl === 'urgent' ? '#dc2626' : lvl === 'standard' ? '#0369a1' : 'var(--brand-forest)') : '#fff',
                      color: relanceTemplate === lvl ? '#fff' : '#334155',
                      borderColor: relanceTemplate === lvl ? 'transparent' : '#e2e8f0',
                    }}
                  >
                    {labels[lvl]}
                  </button>
                );
              })}
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>Objet</label>
              <input
                type="text"
                value={relanceSubject}
                onChange={(e) => setRelanceSubject(e.target.value)}
                style={{ width: '100%', padding: '0.5rem 0.65rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.85rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>Corps du message</label>
              <textarea
                value={relanceBody}
                onChange={(e) => setRelanceBody(e.target.value)}
                rows={12}
                style={{ width: '100%', padding: '0.5rem 0.65rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.82rem', fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button type="button" className="pl-btn pl-btn-outline" onClick={() => setShowRelanceModal(false)}>Annuler</button>
              <button
                type="button"
                className="pl-btn pl-btn-forest"
                onClick={() => {
                  notify('success', `Relance envoyée à ${relanceInvoice.contactLegalName} (simulation)`);
                  setShowRelanceModal(false);
                }}
              >
                ✉ Envoyer la relance
              </button>
            </div>
          </div>
          </FocusTrap>
        </div>
      )}

      {/* ==================================================================
          MODAL: DEMANDE DE JUSTIFICATIF
         ================================================================== */}
      {showJustifRequestModal && (
        <div className="pl-drawer-backdrop" onClick={() => setShowJustifRequestModal(false)}>
          <FocusTrap active={showJustifRequestModal}>
          <div
            className="pl-meta-card"
            style={{ width: 'min(560px, 95vw)', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', fontWeight: 800 }}>
              📋 Demander un justificatif
            </h3>

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>Destinataire (client ou fournisseur)</label>
              <select
                value={justifRequestContactId}
                onChange={(e) => setJustifRequestContactId(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.85rem' }}
              >
                <option value="">— Sélectionner un tiers —</option>
                {contacts.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName} ({c.kind === 'customer' ? 'Client' : c.kind === 'supplier' ? 'Fournisseur' : 'Client & Fourn.'})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>Message</label>
              <textarea
                value={justifRequestBody}
                onChange={(e) => setJustifRequestBody(e.target.value)}
                rows={10}
                style={{ width: '100%', padding: '0.5rem 0.65rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.82rem', fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button type="button" className="pl-btn pl-btn-outline" onClick={() => setShowJustifRequestModal(false)}>Annuler</button>
              <button
                type="button"
                className="pl-btn pl-btn-forest"
                onClick={() => {
                  const ct = contacts.find((c: any) => c.id === justifRequestContactId);
                  notify('success', `Demande envoyée${ct ? ` à ${ct.legalName}` : ''} (simulation)`);
                  setShowJustifRequestModal(false);
                }}
              >
                📤 Envoyer la demande
              </button>
            </div>
          </div>
          </FocusTrap>
        </div>
      )}
    </div>
  );
}

