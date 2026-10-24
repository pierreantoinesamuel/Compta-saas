/**
 * LLM-based invoice field extraction (M6 — AI OCR upgrade).
 *
 * Uses OpenAI gpt-4o-mini (vision) or Anthropic claude-haiku-4-5 as a primary
 * extraction layer for PDF/image documents, configured via env vars:
 *   OPENAI_API_KEY    → tried first
 *   ANTHROPIC_API_KEY → fallback
 *
 * Returns null when no key is set (Tesseract remains the fallback).
 * All amounts are returned as integer centimes (1 EUR = 100 centimes).
 *
 * French VAT rates handled: 20%, 10%, 5.5%, 2.1%, 0%.
 * PCG 2025 class 6 (charges) and class 7 (produits) account suggestions included.
 */

import type { ExtractedDocumentData, VatBreakdown } from './documentTypes.js';

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const OPENAI_MODEL = 'gpt-4o-mini';

// Read at call-time so test env mutations take effect
function openAiKey(): string { return process.env.OPENAI_API_KEY?.trim() ?? ''; }
function anthropicKey(): string { return process.env.ANTHROPIC_API_KEY?.trim() ?? ''; }

const SCHEMA_INSTRUCTIONS = `Return ONLY a valid JSON object — no markdown, no explanation.
Schema:
{
  "issuerName": string | null,
  "issuerSiren": "9-digit SIREN without spaces" | null,
  "documentDate": "YYYY-MM-DD" | null,
  "referenceNumber": "invoice or receipt number" | null,
  "description": "main service/product description in French" | null,
  "amountHtMinor": integer centimes HT (ex-VAT, 100 = 1 EUR) | null,
  "vatBreakdowns": [
    { "ratePercent": 20, "baseHtMinor": 10000, "vatAmountMinor": 2000 }
  ],
  "amountTtcMinor": integer centimes TTC (inc-VAT) | null,
  "suggestedPcgCode": "6-digit PCG 2025 code from class 6 or 7" | null,
  "suggestedPcgLabel": "French account label" | null,
  "issuerIban": "IBAN printed on the document for payment (no spaces)" | null
}
French VAT rates: 20%, 10%, 5.5%, 2.1%, 0%.
All amounts MUST be integers (centimes). Example: 1 200,00 EUR -> 120000.
Multiple VAT rates on one invoice (e.g. restaurant 10%+20%) -> multiple vatBreakdowns entries.
PCG class 6 examples: 601xxx purchases, 606xxx supplies, 612xxx rent, 615xxx maintenance,
616xxx insurance, 622600 professional fees, 623xxx advertising, 625100 travel,
625700 meals/reception, 626xxx telecom, 641xxx payroll. Class 7: 706xxx services sold.`;

function detectImageMimeType(base64: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const header = Buffer.from(base64.slice(0, 16), 'base64');
  if (header[0] === 0xff && header[1] === 0xd8) return 'image/jpeg';
  if (header[0] === 0x89 && header.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (header.toString('ascii', 0, 4) === 'RIFF') return 'image/webp';
  return 'image/jpeg';
}

function parseJsonFromLlmText(text: string): Record<string, unknown> | null {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) return null;
  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toMinorCents(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
}

function parseVatBreakdowns(raw: unknown): VatBreakdown[] {
  if (!Array.isArray(raw)) return [];
  const result: VatBreakdown[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const ratePercent = typeof r.ratePercent === 'number' ? r.ratePercent : undefined;
    const baseHtMinor = toMinorCents(r.baseHtMinor);
    const vatAmountMinor = toMinorCents(r.vatAmountMinor);
    if (ratePercent !== undefined && baseHtMinor !== undefined && vatAmountMinor !== undefined) {
      result.push({ ratePercent, baseHtMinor, vatAmountMinor });
    }
  }
  return result;
}

function parseLlmResponse(raw: Record<string, unknown>): ExtractedDocumentData | null {
  const breakdowns = parseVatBreakdowns(raw.vatBreakdowns);
  const amountHtMinor = toMinorCents(raw.amountHtMinor);
  const amountTtcMinor = toMinorCents(raw.amountTtcMinor);

  const primaryVat = breakdowns[0];
  const vatAmountMinor = breakdowns.length
    ? breakdowns.reduce((sum, b) => sum + b.vatAmountMinor, 0)
    : undefined;

  const result: ExtractedDocumentData = {};

  if (typeof raw.issuerName === 'string' && raw.issuerName.trim()) result.issuerName = raw.issuerName.trim();
  if (typeof raw.issuerSiren === 'string' && /^\d{9}$/.test(raw.issuerSiren.replace(/\s/g, ''))) {
    result.issuerSiren = raw.issuerSiren.replace(/\s/g, '');
  }
  if (typeof raw.documentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.documentDate)) {
    result.documentDate = raw.documentDate;
  }
  if (typeof raw.referenceNumber === 'string' && raw.referenceNumber.trim()) result.referenceNumber = raw.referenceNumber.trim();
  if (typeof raw.description === 'string' && raw.description.trim()) result.description = raw.description.trim();
  if (amountHtMinor) result.amountHtMinor = amountHtMinor;
  if (amountTtcMinor) result.amountTtcMinor = amountTtcMinor;
  if (vatAmountMinor) result.vatAmountMinor = vatAmountMinor;
  if (primaryVat) result.vatRatePercent = primaryVat.ratePercent;
  if (breakdowns.length) result.vatBreakdowns = breakdowns;
  if (typeof raw.suggestedPcgCode === 'string' && /^\d{6}$/.test(raw.suggestedPcgCode)) {
    result.suggestedAccountCode = raw.suggestedPcgCode;
  }
  if (typeof raw.suggestedPcgLabel === 'string' && raw.suggestedPcgLabel.trim()) {
    result.suggestedAccountLabel = raw.suggestedPcgLabel.trim();
  }
  if (typeof raw.issuerIban === 'string') {
    const ibanNorm = raw.issuerIban.replace(/\s/g, '').toUpperCase();
    if (/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,29}$/.test(ibanNorm)) result.issuerIban = ibanNorm;
  }

  if (!result.amountHtMinor && !result.amountTtcMinor && !result.vatBreakdowns?.length) {
    return null;
  }
  return Object.keys(result).length > 0 ? result : null;
}

async function callOpenAi(
  text: string | null,
  imageBase64: string | null,
  imageMimeType: string,
): Promise<ExtractedDocumentData | null> {
  const userContent: unknown[] = [];
  if (imageBase64) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: 'high' },
    });
  }
  userContent.push({
    type: 'text',
    text: text
      ? `Extract invoice fields from this document text:\n\n${text}\n\n${SCHEMA_INSTRUCTIONS}`
      : `Extract invoice fields from this document image.\n\n${SCHEMA_INSTRUCTIONS}`,
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey()}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: userContent }],
      response_format: { type: 'json_object' },
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    console.warn('[LLM] OpenAI API error %d — %s', response.status, await response.text().catch(() => ''));
    return null;
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) return null;
  const rawJson = parseJsonFromLlmText(content);
  return rawJson ? parseLlmResponse(rawJson) : null;
}

async function callAnthropic(
  text: string | null,
  imageBase64: string | null,
  imageMimeType: string,
): Promise<ExtractedDocumentData | null> {
  const contentParts: unknown[] = [];
  if (imageBase64) {
    contentParts.push({
      type: 'image',
      source: { type: 'base64', media_type: imageMimeType, data: imageBase64 },
    });
  }
  contentParts.push({
    type: 'text',
    text: text
      ? `Extract invoice fields from this document text:\n\n${text}\n\n${SCHEMA_INSTRUCTIONS}`
      : `Extract invoice fields from this document image.\n\n${SCHEMA_INSTRUCTIONS}`,
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: contentParts }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    console.warn('[LLM] Anthropic API error %d — %s', response.status, await response.text().catch(() => ''));
    return null;
  }
  const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const content = body.content?.find((b) => b.type === 'text')?.text;
  if (!content) return null;
  const rawJson = parseJsonFromLlmText(content);
  return rawJson ? parseLlmResponse(rawJson) : null;
}

export interface LlmExtractionInput {
  textContent?: string;
  imageBase64?: string;
}

/**
 * Attempts LLM-based field extraction. Returns null when no API key is available
 * or when the LLM response cannot be parsed into usable data.
 * The caller falls back to Tesseract on null.
 */
export async function extractWithLlm(input: LlmExtractionInput): Promise<ExtractedDocumentData | null> {
  const { textContent, imageBase64 } = input;
  const oaKey = openAiKey();
  const antKey = anthropicKey();
  if (!oaKey && !antKey) return null;

  const imageMimeType = imageBase64 ? detectImageMimeType(imageBase64) : 'image/jpeg';

  try {
    if (oaKey) {
      const result = await callOpenAi(textContent ?? null, imageBase64 ?? null, imageMimeType);
      if (result) return result;
    }
    if (antKey) {
      return await callAnthropic(textContent ?? null, imageBase64 ?? null, imageMimeType);
    }
  } catch (err) {
    console.warn('[LLM] call failed, falling back to Tesseract:', err);
  }
  return null;
}
