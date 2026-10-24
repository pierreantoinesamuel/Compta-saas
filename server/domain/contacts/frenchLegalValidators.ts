/**
 * French & European Legal Identifier Validators & Generators
 * - SIREN (9 digits, Luhn algorithm)
 * - SIRET (14 digits, Luhn algorithm + official INSEE La Poste exception for SIREN 356000000)
 * - French Intra-Community VAT Number (Numéro de TVA Intracommunautaire: FR + key + SIREN)
 * - EU VIES VAT Number format validator (27 EU Member States + XI)
 * - Auxiliary Account Code generator (FEC CompAuxNum: 411... / 401...)
 */

export interface IdentifierValidationResult {
  valid: boolean;
  normalized: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Standard Luhn checksum algorithm used by INSEE for SIREN and SIRET numbers.
 * Moving from right to left, double every second digit (even positions from right, 1-indexed).
 * If doubling results in > 9, subtract 9. Total sum must be a multiple of 10.
 */
export function computeLuhnSum(digits: string): number {
  let sum = 0;
  const len = digits.length;
  for (let i = 0; i < len; i++) {
    const charCode = digits.charCodeAt(len - 1 - i) - 48;
    let value = charCode;
    if (i % 2 === 1) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
  }
  return sum;
}

/**
 * Validates a 9-digit French SIREN number.
 */
export function validateSiren(rawSiren: string): IdentifierValidationResult {
  const normalized = rawSiren.replace(/[\s.-]/g, '');
  if (!/^[0-9]{9}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      errorCode: 'INVALID_SIREN_FORMAT',
      errorMessage: 'Le numéro SIREN doit comporter exactement 9 chiffres.',
    };
  }

  if (normalized === '000000000') {
    return {
      valid: false,
      normalized,
      errorCode: 'INVALID_SIREN_ZERO',
      errorMessage: 'Le numéro SIREN ne peut pas être composé uniquement de zéros.',
    };
  }

  const luhnSum = computeLuhnSum(normalized);
  if (luhnSum % 10 !== 0) {
    return {
      valid: false,
      normalized,
      errorCode: 'INVALID_SIREN_LUHN',
      errorMessage: 'Le numéro SIREN est invalide (échec de la clé de contrôle Luhn INSEE).',
    };
  }

  return { valid: true, normalized };
}

/**
 * Validates a 14-digit French SIRET number (9-digit SIREN + 5-digit NIC).
 * Handles both standard Luhn and the official INSEE exception for La Poste (SIREN 356000000),
 * where SIRET numbers exceeding 10,000 establishments validate if the simple sum of all 14 digits
 * is a multiple of 5.
 */
export function validateSiret(rawSiret: string): IdentifierValidationResult {
  const normalized = rawSiret.replace(/[\s.-]/g, '');
  if (!/^[0-9]{14}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      errorCode: 'INVALID_SIRET_FORMAT',
      errorMessage: 'Le numéro SIRET doit comporter exactement 14 chiffres.',
    };
  }

  const sirenPart = normalized.slice(0, 9);
  const sirenValidation = validateSiren(sirenPart);
  if (!sirenValidation.valid) {
    return {
      valid: false,
      normalized,
      errorCode: 'INVALID_SIRET_SIREN_PREFIX',
      errorMessage: 'Les 9 premiers chiffres du SIRET ne forment pas un SIREN valide.',
    };
  }

  const luhnSum = computeLuhnSum(normalized);
  if (luhnSum % 10 === 0) {
    return { valid: true, normalized };
  }

  // Official INSEE exception for La Poste (SIREN 356000000): sum of digits divisible by 5
  if (sirenPart === '356000000') {
    let simpleSum = 0;
    for (let i = 0; i < normalized.length; i++) {
      simpleSum += normalized.charCodeAt(i) - 48;
    }
    if (simpleSum % 5 === 0) {
      return { valid: true, normalized };
    }
  }

  return {
    valid: false,
    normalized,
    errorCode: 'INVALID_SIRET_LUHN',
    errorMessage: 'Le numéro SIRET est invalide (échec de la clé de contrôle Luhn INSEE).',
  };
}

/**
 * Computes the official French Intra-Community VAT number (Numéro de TVA intracommunautaire)
 * from a valid 9-digit SIREN:
 *   Key = (12 + 3 * (SIREN % 97)) % 97
 *   VAT = "FR" + twoDigitKey + SIREN
 */
export function computeFrenchVatNumber(rawSiren: string): string {
  const sirenResult = validateSiren(rawSiren);
  if (!sirenResult.valid) {
    throw new Error(sirenResult.errorMessage ?? 'Invalid SIREN');
  }
  const sirenNum = Number.parseInt(sirenResult.normalized, 10);
  const key = (12 + 3 * (sirenNum % 97)) % 97;
  const keyStr = key.toString().padStart(2, '0');
  return `FR${keyStr}${sirenResult.normalized}`;
}

/**
 * Validates a French Intra-Community VAT number (FR + 2 numeric/alphanumeric key chars + 9-digit SIREN).
 * For standard numeric keys, verifies the mathematical modulo-97 relationship with the SIREN.
 */
export function validateFrenchVatNumber(
  rawVat: string,
  expectedSiren?: string
): IdentifierValidationResult {
  const normalized = rawVat.replace(/[\s.-]/g, '').toUpperCase();
  if (!/^FR[0-9A-HJ-NP-Z]{2}[0-9]{9}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      errorCode: 'INVALID_FR_VAT_FORMAT',
      errorMessage:
        'Le numéro de TVA intracommunautaire français doit être au format FR + clé de 2 caractères + SIREN (9 chiffres).',
    };
  }

  const keyPart = normalized.slice(2, 4);
  const sirenPart = normalized.slice(4, 13);

  const sirenCheck = validateSiren(sirenPart);
  if (!sirenCheck.valid) {
    return {
      valid: false,
      normalized,
      errorCode: 'INVALID_FR_VAT_SIREN',
      errorMessage: 'Le SIREN contenu dans le numéro de TVA français est invalide.',
    };
  }

  if (expectedSiren) {
    const cleanExpected = expectedSiren.replace(/[\s.-]/g, '');
    if (sirenPart !== cleanExpected) {
      return {
        valid: false,
        normalized,
        errorCode: 'FR_VAT_SIREN_MISMATCH',
        errorMessage: 'Le numéro de TVA intracommunautaire ne correspond pas au SIREN du tiers.',
      };
    }
  }

  if (/^[0-9]{2}$/.test(keyPart)) {
    const expectedVat = computeFrenchVatNumber(sirenPart);
    if (normalized !== expectedVat) {
      return {
        valid: false,
        normalized,
        errorCode: 'INVALID_FR_VAT_KEY',
        errorMessage: `La clé de contrôle du numéro de TVA français est invalide (attendu : ${expectedVat.slice(0, 4)}).`,
      };
    }
  }

  return { valid: true, normalized };
}

const EU_VAT_PATTERNS: Record<string, RegExp> = {
  AT: /^ATU[0-9]{8}$/,
  BE: /^BE[01][0-9]{9}$/,
  BG: /^BG[0-9]{9,10}$/,
  CY: /^CY[0-9]{8}[A-Z]$/,
  CZ: /^CZ[0-9]{8,10}$/,
  DE: /^DE[0-9]{9}$/,
  DK: /^DK[0-9]{8}$/,
  EE: /^EE[0-9]{9}$/,
  EL: /^EL[0-9]{9}$/,
  ES: /^ES[A-Z0-9][0-9]{7}[A-Z0-9]$/,
  FI: /^FI[0-9]{8}$/,
  FR: /^FR[0-9A-HJ-NP-Z]{2}[0-9]{9}$/,
  HR: /^HR[0-9]{11}$/,
  HU: /^HU[0-9]{8}$/,
  IE: /^IE[0-9]{7}[A-Z]{1,2}$|^IE[0-9][A-Z+*][0-9]{5}[A-Z]$/,
  IT: /^IT[0-9]{11}$/,
  LT: /^LT([0-9]{9}|[0-9]{12})$/,
  LU: /^LU[0-9]{8}$/,
  LV: /^LV[0-9]{11}$/,
  MT: /^MT[0-9]{8}$/,
  NL: /^NL[0-9]{9}B[0-9]{2}$/,
  PL: /^PL[0-9]{10}$/,
  PT: /^PT[0-9]{9}$/,
  RO: /^RO[0-9]{2,10}$/,
  SE: /^SE[0-9]{12}$/,
  SI: /^SI[0-9]{8}$/,
  SK: /^SK[0-9]{10}$/,
  XI: /^XI([0-9]{9}|[0-9]{12}|GD[0-9]{3}|HA[0-9]{3})$/,
};

/**
 * Validates any EU Intra-Community VAT identifier (VIES syntax check, plus mathematical check for FR).
 */
export function validateEuVatNumber(rawVat: string): IdentifierValidationResult {
  const normalized = rawVat.replace(/[\s.-]/g, '').toUpperCase();
  if (normalized.length < 4) {
    return {
      valid: false,
      normalized,
      errorCode: 'INVALID_EU_VAT_LENGTH',
      errorMessage: 'Le numéro de TVA intracommunautaire est trop court.',
    };
  }

  const countryPrefix = normalized.slice(0, 2);
  if (countryPrefix === 'FR') {
    return validateFrenchVatNumber(normalized);
  }

  const pattern = EU_VAT_PATTERNS[countryPrefix];
  if (!pattern) {
    return {
      valid: false,
      normalized,
      errorCode: 'UNSUPPORTED_EU_VAT_COUNTRY',
      errorMessage: `Préfixe pays UE non reconnu pour la TVA intracommunautaire : ${countryPrefix}.`,
    };
  }

  if (!pattern.test(normalized)) {
    return {
      valid: false,
      normalized,
      errorCode: 'INVALID_EU_VAT_FORMAT',
      errorMessage: `Format de numéro de TVA intracommunautaire invalide pour le pays ${countryPrefix}.`,
    };
  }

  return { valid: true, normalized };
}

/**
 * Validates an IBAN using the ISO 13616 mod-97 algorithm.
 * French IBAN: FR + 2 check digits + 23-char BBAN = 27 chars total.
 */
export function validateIban(raw: string): IdentifierValidationResult {
  const normalized = raw.replace(/[\s-]/g, '').toUpperCase();
  if (normalized.length < 15 || normalized.length > 34) {
    return { valid: false, normalized, errorCode: 'INVALID_IBAN_LENGTH', errorMessage: "Longueur d'IBAN invalide." };
  }
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalized)) {
    return { valid: false, normalized, errorCode: 'INVALID_IBAN_FORMAT', errorMessage: "Format d'IBAN invalide." };
  }
  const rearranged = (normalized.slice(4) + normalized.slice(0, 4))
    .split('').map(ch => {
      const code = ch.charCodeAt(0);
      return code >= 65 && code <= 90 ? String(code - 55) : ch;
    }).join('');
  let remainder = '';
  for (const ch of rearranged) {
    remainder = String(Number(remainder + ch) % 97);
  }
  if (Number(remainder) !== 1) {
    return { valid: false, normalized, errorCode: 'INVALID_IBAN_CHECKSUM', errorMessage: 'Clé de contrôle IBAN incorrecte.' };
  }
  return { valid: true, normalized };
}

/** Returns the normalized IBAN (spaces/dashes removed, uppercase). */
export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Masks IBAN for display: "FR76...0199" (first 4 chars + ... + last 4 chars). */
export function maskIban(raw: string): string {
  const n = normalizeIban(raw);
  if (n.length < 8) return n;
  return `${n.slice(0, 4)}...${n.slice(-4)}`;
}

/**
 * Generates a Dolibarr / FEC-compliant auxiliary account code (CompAuxNum)
 * for collective accounts 411000 (Customer) or 401000 (Supplier).
 */
export function generateAuxiliaryAccountCode(
  kind: 'customer' | 'supplier',
  sequenceNumber: number
): string {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new Error('Sequence number must be a positive integer');
  }
  const prefix = kind === 'customer' ? '411CLI' : '401FOU';
  return `${prefix}${sequenceNumber.toString().padStart(4, '0')}`;
}
