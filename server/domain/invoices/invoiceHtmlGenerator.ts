import type { SalesDocumentRecord, WorkspaceProfile } from '../../application/workspaceStore.js';

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMinor(minor: number): string {
  return (minor / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function documentTypeLabel(type: SalesDocumentRecord['documentType']): string {
  switch (type) {
    case 'quote': return 'DEVIS';
    case 'deposit_invoice': return "FACTURE D'ACOMPTE";
    case 'standard_invoice': return 'FACTURE';
    case 'credit_note': return 'AVOIR';
    default: return 'DOCUMENT';
  }
}

export function generateInvoiceHtml(doc: SalesDocumentRecord, workspace: WorkspaceProfile): string {
  const label = documentTypeLabel(doc.documentType);
  const ref = escHtml(doc.number ?? doc.provisionalRef);
  const isDraft = doc.status === 'draft';

  const addressHtml = `${escHtml(workspace.registeredAddress.streetLine1)}<br>${escHtml(workspace.registeredAddress.postalCode)} ${escHtml(workspace.registeredAddress.city)}`;

  const linesHtml = doc.lines.map((line) => `
    <tr>
      <td>${line.position}</td>
      <td class="desc">${escHtml(line.description)}</td>
      <td class="r">${escHtml(line.quantity)} ${escHtml(line.unitCode)}</td>
      <td class="r">${fmtMinor(line.unitPriceHtMinor)}</td>
      <td class="r">${line.discountPercent !== '0' ? escHtml(line.discountPercent) + ' %' : '&mdash;'}</td>
      <td class="r">${escHtml(line.vatRatePercent)} %</td>
      <td class="r">${fmtMinor(line.lineSubtotalHtMinor)}</td>
    </tr>`).join('');

  const vatRowsHtml = doc.taxBreakdowns.map((bd) => `
    <tr>
      <td>TVA ${escHtml(bd.vatRatePercent)} %</td>
      <td class="r">${fmtMinor(bd.taxableBaseHtMinor)}</td>
      <td class="r">${fmtMinor(bd.vatAmountMinor)}</td>
      ${bd.exemptionReasonText ? `<td class="note">${escHtml(bd.exemptionReasonText)}</td>` : '<td></td>'}
    </tr>`).join('');

  const depositRow = doc.depositsDeductedTtcMinor > 0
    ? `<tr><td colspan="2">Acompte(s) d&eacute;duit(s)</td><td class="r">&minus;${fmtMinor(doc.depositsDeductedTtcMinor)}</td></tr>`
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${label} ${ref}</title>
<style>
  :root {
    --ink: #111;
    --muted: #555;
    --border: #ccc;
    --accent: #1d4ed8;
    --bg: #fff;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ink: #e5e7eb; --muted: #9ca3af; --border: #374151; --accent: #60a5fa; --bg: #111827;
    }
  }
  :root[data-theme="dark"] {
    --ink: #e5e7eb; --muted: #9ca3af; --border: #374151; --accent: #60a5fa; --bg: #111827;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; color: var(--ink); background: var(--bg); padding: 20px 16px; }
  .page { max-width: 210mm; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 32px; }
  .issuer h1 { font-size: 16pt; font-weight: 700; color: var(--accent); margin-bottom: 4px; }
  .issuer p { color: var(--muted); font-size: 9pt; line-height: 1.5; }
  .doc-title { text-align: right; }
  .doc-title h2 { font-size: 18pt; font-weight: 700; letter-spacing: 1px; }
  .doc-title .ref { font-size: 10pt; color: var(--muted); margin-top: 4px; }
  .doc-title .dates { font-size: 9pt; color: var(--muted); margin-top: 8px; line-height: 1.6; }
  .parties { margin-bottom: 24px; }
  .customer { border: 1px solid var(--border); border-radius: 4px; padding: 12px 16px; display: inline-block; min-width: 240px; }
  .customer h3 { font-size: 9pt; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .customer .name { font-size: 11pt; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 9.5pt; }
  th { background: var(--accent); color: #fff; padding: 6px 8px; text-align: left; }
  th.r { text-align: right; }
  td { padding: 5px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  td.r { text-align: right; }
  td.desc { max-width: 200px; }
  td.note { font-size: 8.5pt; color: var(--muted); }
  tr:last-child td { border-bottom: none; }
  .totals { margin-left: auto; width: 280px; margin-bottom: 24px; }
  .totals table { margin: 0; }
  .totals td { font-size: 10pt; }
  .totals .total-row td { font-weight: 700; font-size: 11pt; border-top: 2px solid var(--ink); }
  .totals .net-pay td { font-weight: 700; font-size: 12pt; color: var(--accent); border-top: 2px solid var(--accent); }
  .mentions { font-size: 8pt; color: var(--muted); line-height: 1.6; border-top: 1px solid var(--border); padding-top: 12px; }
  .mentions p { margin-bottom: 4px; }
  ${isDraft ? `.watermark {
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 80pt; font-weight: 900; color: rgba(200,0,0,0.12);
    pointer-events: none; white-space: nowrap; z-index: 9999; letter-spacing: 6px;
  }` : ''}
  @media print {
    body { padding: 0; }
    .page { max-width: 100%; }
    @page { size: A4; margin: 18mm 15mm; }
  }
</style>
</head>
<body>
${isDraft ? '<div class="watermark">BROUILLON</div>' : ''}
<div class="page">

  <header>
    <div class="issuer">
      <h1>${escHtml(workspace.legalName)}</h1>
      <p>${addressHtml}</p>
      <p>SIREN : ${escHtml(workspace.siren)}</p>
      <p>N&deg; TVA : ${escHtml(workspace.vatNumber)}</p>
      <p>RCS ${escHtml(workspace.rcsCity)} ${escHtml(workspace.rcsNumber)}</p>
    </div>
    <div class="doc-title">
      <h2>${label}</h2>
      <div class="ref">${ref}</div>
      <div class="dates">
        <div>Date : ${fmtDate(doc.issueDate)}</div>
        <div>Prestation : ${fmtDate(doc.deliveryOrServiceDate)}</div>
        <div>&Eacute;ch&eacute;ance : ${fmtDate(doc.dueDate)}</div>
        ${doc.purchaseOrderRef ? `<div>Bon de commande : ${escHtml(doc.purchaseOrderRef)}</div>` : ''}
      </div>
    </div>
  </header>

  <div class="parties">
    <div class="customer">
      <h3>Client</h3>
      <div class="name">${escHtml(doc.contactLegalName)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>D&eacute;signation</th>
        <th class="r">Qt&eacute; / U.</th>
        <th class="r">P.U. HT</th>
        <th class="r">Remise</th>
        <th class="r">TVA</th>
        <th class="r">Total HT</th>
      </tr>
    </thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <table>
    <thead>
      <tr>
        <th>Taux TVA</th>
        <th class="r">Base HT</th>
        <th class="r">Montant TVA</th>
        <th>Mention</th>
      </tr>
    </thead>
    <tbody>${vatRowsHtml}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Sous-total HT</td><td class="r">${fmtMinor(doc.subtotalHtMinor)}</td></tr>
      <tr><td>Total TVA</td><td class="r">${fmtMinor(doc.vatTotalMinor)}</td></tr>
      ${depositRow}
      <tr class="total-row"><td>Total TTC</td><td class="r">${fmtMinor(doc.totalTtcMinor)}</td></tr>
      <tr class="net-pay"><td>Net &agrave; payer</td><td class="r">${fmtMinor(doc.netToPayTtcMinor)}</td></tr>
    </table>
  </div>

  <div class="mentions">
    <p><strong>P&eacute;nalit&eacute;s de retard :</strong> En cas de retard de paiement, des p&eacute;nalit&eacute;s de retard au taux de ${escHtml(doc.latePenaltyRatePercent)} % l'an seront appliqu&eacute;es, ainsi qu'une indemnit&eacute; forfaitaire pour frais de recouvrement de ${fmtMinor(doc.recoveryIndemnityMinor)} (art. L441-10 C.com).</p>
    ${doc.discountTerms ? `<p><strong>Escompte :</strong> ${escHtml(doc.discountTerms)}</p>` : ''}
    ${doc.vatExemptionMention ? `<p>${escHtml(doc.vatExemptionMention)}</p>` : ''}
    ${doc.vatOnDebitsMention ? '<p>TVA sur les d&eacute;bits.</p>' : ''}
    <p>${escHtml(workspace.legalForm)} au capital de ${fmtMinor(workspace.shareCapitalMinor ?? 0)} &mdash; RCS ${escHtml(workspace.rcsCity)} ${escHtml(workspace.rcsNumber)} &mdash; APE ${escHtml(workspace.nafCode)}</p>
  </div>

</div>
</body>
</html>`;
}
