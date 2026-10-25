/**
 * api.entreprises.gouv.fr — SIREN lookup for franchise TVA detection.
 *
 * Used for the TVA table item: "Detect franchise en base 293B".
 * The official government API (no API key required, rate-limited to ~7 req/s).
 * Falls back gracefully when unavailable — never blocks accounting workflows.
 */

export interface EntrepriseInfoResult {
  siren: string;
  denominationLegale?: string;
  categorieJuridique?: string;
  codeNaf?: string;
  franchiseBaseTva?: boolean; // true when the API signals régime franchise base 293B
  rawRegimeTva?: string;
  error?: string;
}

const API_BASE = 'https://api.entreprises.gouv.fr/api/v3';
const TIMEOUT_MS = 8_000;

export async function lookupEntreprise(siren: string): Promise<EntrepriseInfoResult> {
  const normalized = siren.replace(/\s/g, '');
  if (!/^\d{9}$/.test(normalized)) {
    return { siren: normalized, error: 'INVALID_SIREN_FORMAT' };
  }

  try {
    const url = `${API_BASE}/entreprises/${normalized}?context=Haxatax&recipient=${normalized}&object=verification_tva_franchise`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) return { siren: normalized, error: 'SIREN_NOT_FOUND' };
    if (res.status === 403) return { siren: normalized, error: 'API_FORBIDDEN' };
    if (!res.ok) return { siren: normalized, error: `API_HTTP_${res.status}` };

    const body = await res.json() as Record<string, unknown>;
    const data = (body.data ?? body) as Record<string, unknown>;
    const unite = (data.unite_legale ?? data) as Record<string, unknown>;

    const denominationLegale =
      (unite.denomination_usuelle_1 as string | undefined) ||
      (unite.denomination as string | undefined);

    const categorieJuridique = unite.categorie_juridique_tva as string | undefined;
    const codeNaf = unite.activite_principale as string | undefined;
    const rawRegimeTva = unite.regime_tva as string | undefined;

    // Franchise en base 293B is signalled by the regime_tva field
    const franchiseBaseTva =
      typeof rawRegimeTva === 'string' &&
      /franchise|base.*293|293.*b/i.test(rawRegimeTva);

    return {
      siren: normalized,
      denominationLegale,
      categorieJuridique,
      codeNaf,
      franchiseBaseTva,
      rawRegimeTva,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'NETWORK_ERROR';
    if (msg.includes('timeout') || msg.includes('Abort')) {
      return { siren: normalized, error: 'API_TIMEOUT' };
    }
    return { siren: normalized, error: msg.slice(0, 100) };
  }
}

/**
 * Returns true only when the API explicitly confirms franchise 293B.
 * Returns null on any error so callers show "unable to verify" rather than a false negative.
 */
export async function isFranchiseTva(siren: string): Promise<boolean | null> {
  const result = await lookupEntreprise(siren);
  if (result.error) return null;
  return result.franchiseBaseTva ?? null;
}
