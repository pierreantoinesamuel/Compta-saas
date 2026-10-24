/**
 * Transactional email sender for Haxatax security alerts.
 *
 * Transport:
 *   - Mailjet REST API v3.1 (via native fetch) when MAILJET_API_KEY + MAILJET_API_SECRET are set.
 *   - Dry-run mode otherwise: logs the email and returns a preview (safe for dev/test).
 *
 * No additional npm packages required.
 */

import type { IbanAlert } from '../documents/documentTypes.js';
import type { ContactRecord, WorkspaceProfile } from '../../application/workspaceStore.js';

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SendEmailResult {
  sent: boolean;
  dryRun: boolean;
  to: string;
  subject: string;
  bodyText: string;
  messageId?: string;
}

function mailjetKey(): string { return process.env.MAILJET_API_KEY?.trim() ?? ''; }
function mailjetSecret(): string { return process.env.MAILJET_API_SECRET?.trim() ?? ''; }

function buildIbanAlertEmail(
  alert: IbanAlert,
  supplier: ContactRecord,
  workspace: WorkspaceProfile,
): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `[ALERTE SÉCURITÉ] Vérification IBAN requise — ${workspace.legalName}`;

  const bodyText = [
    `Madame, Monsieur,`,
    ``,
    `Nous avons reçu une facture présentant un IBAN de règlement différent de celui enregistré dans nos fichiers fournisseurs.`,
    ``,
    `• IBAN sur la facture reçue : ${alert.maskedDocumentIban}`,
    `• IBAN certifié dans nos dossiers : ${alert.maskedCertifiedIban}`,
    ``,
    `Dans le cadre de nos procédures de prévention de la fraude aux virements fournisseurs (fraude au RIB), nous vous demandons de bien vouloir confirmer vos coordonnées bancaires par retour de courrier électronique ou par téléphone, en utilisant les contacts habituels que vous avez pour ${workspace.legalName}.`,
    ``,
    `Nous vous rappelons que nous ne procédons à aucun changement de coordonnées bancaires sans vérification préalable par voie téléphonique sur un numéro connu.`,
    ``,
    `Dans l'attente de votre confirmation, le règlement de cette facture est suspendu.`,
    ``,
    `Cordialement,`,
    `${workspace.legalName}`,
    `Service comptabilité`,
  ].join('\n');

  const bodyHtml = `
<p>Madame, Monsieur,</p>
<p>Nous avons reçu une facture présentant un IBAN de règlement différent de celui enregistré dans nos fichiers fournisseurs.</p>
<ul>
  <li><strong>IBAN sur la facture reçue&nbsp;:</strong> ${alert.maskedDocumentIban}</li>
  <li><strong>IBAN certifié dans nos dossiers&nbsp;:</strong> ${alert.maskedCertifiedIban}</li>
</ul>
<p>Dans le cadre de nos procédures de prévention de la <strong>fraude aux virements fournisseurs</strong>, nous vous demandons de confirmer vos coordonnées bancaires par retour de courrier ou par téléphone, en utilisant vos contacts habituels chez <strong>${escHtml(workspace.legalName)}</strong>.</p>
<p>Nous ne procédons à aucun changement de coordonnées bancaires sans vérification téléphonique préalable sur un numéro connu.</p>
<p><em>Dans l'attente de votre confirmation, le règlement de cette facture est suspendu.</em></p>
<p>Cordialement,<br><strong>${escHtml(workspace.legalName)}</strong> — Service comptabilité</p>
`.trim();

  return { subject, bodyText, bodyHtml };
}

export async function sendIbanAlertEmail(input: {
  alert: IbanAlert;
  supplier: ContactRecord;
  workspace: WorkspaceProfile;
  fromEmail?: string;
}): Promise<SendEmailResult> {
  const { alert, supplier, workspace } = input;
  const to = supplier.email;
  const fromEmail = input.fromEmail ?? 'noreply@haxatax.fr';

  const { subject, bodyText, bodyHtml } = buildIbanAlertEmail(alert, supplier, workspace);

  const apiKey = mailjetKey();
  const apiSecret = mailjetSecret();

  if (!apiKey || !apiSecret) {
    console.warn(`[PhacetAgent] DRY RUN — IBAN alert email not sent (no MAILJET_API_KEY).`);
    console.warn(`[PhacetAgent] To: ${to} | Subject: ${subject}`);
    return { sent: false, dryRun: true, to, subject, bodyText };
  }

  const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const payload = {
    Messages: [
      {
        From: { Email: fromEmail, Name: workspace.legalName },
        To: [{ Email: to, Name: supplier.legalName }],
        Subject: subject,
        TextPart: bodyText,
        HTMLPart: bodyHtml,
      },
    ],
  };

  try {
    const response = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Mailjet API error ${response.status}: ${errorBody.slice(0, 200)}`);
    }

    const result = (await response.json()) as { Messages?: Array<{ To?: Array<{ MessageID?: string }> }> };
    const messageId = result.Messages?.[0]?.To?.[0]?.MessageID?.toString();

    return { sent: true, dryRun: false, to, subject, bodyText, messageId };
  } catch (err) {
    throw new Error(`Échec de l'envoi de l'e-mail d'alerte IBAN : ${err instanceof Error ? err.message : 'Erreur réseau'}`);
  }
}
