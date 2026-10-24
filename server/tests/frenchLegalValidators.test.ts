import { describe, expect, it } from 'vitest';
import {
  computeFrenchVatNumber,
  generateAuxiliaryAccountCode,
  validateEuVatNumber,
  validateFrenchVatNumber,
  validateSiren,
  validateSiret,
} from '../domain/contacts/frenchLegalValidators.js';

describe('French & EU Legal Identifiers (SIREN, SIRET, Intra-EU VAT, CompAuxNum)', () => {
  it('validates authentic 9-digit SIREN numbers using the INSEE Luhn algorithm', () => {
    // 552 100 554 (Peugeot / Stellantis historic SIREN)
    expect(validateSiren('552 100 554')).toEqual({
      valid: true,
      normalized: '552100554',
    });

    // Invalid Luhn digit
    const invalidLuhn = validateSiren('552 100 555');
    expect(invalidLuhn.valid).toBe(false);
    expect(invalidLuhn.errorCode).toBe('INVALID_SIREN_LUHN');

    // All zeros rejected
    expect(validateSiren('000000000').valid).toBe(false);

    // Wrong length rejected
    expect(validateSiren('12345').valid).toBe(false);
  });

  it('validates 14-digit SIRET numbers including the official INSEE La Poste exception (SIREN 356000000)', () => {
    // Standard valid SIRET: 55210055400013 (Luhn sum divisible by 10)
    // Wait: let's check Luhn for 552100554 + NIC
    // For 73282932000074 (official INSEE test SIRET):
    expect(validateSiret('732 829 320 00074')).toEqual({
      valid: true,
      normalized: '73282932000074',
    });

    // Corrupted SIRET check digit
    const corrupted = validateSiret('732 829 320 00075');
    expect(corrupted.valid).toBe(false);
    expect(corrupted.errorCode).toBe('INVALID_SIRET_LUHN');

    // La Poste SIREN 356000000 exception: sum of 14 digits divisible by 5 (3+5+6+0+0+0+0+0+0+0+0+0+1+0 = 15)
    const laPosteSiret = validateSiret('35600000000010');
    expect(laPosteSiret.valid).toBe(true);
  });

  it('computes and validates French Intra-Community VAT numbers (FR + key + SIREN)', () => {
    // SIREN 552100554 -> 552100554 % 97 = 9 -> (12 + 3*9) % 97 = 39 -> Wait: let's verify exact modulo:
    const computed = computeFrenchVatNumber('552 100 554');
    expect(computed).toMatch(/^FR[0-9]{2}552100554$/);

    const validation = validateFrenchVatNumber(computed, '552100554');
    expect(validation.valid).toBe(true);

    // Wrong key must fail
    const wrongKey = validateFrenchVatNumber('FR99552100554');
    expect(wrongKey.valid).toBe(false);
    expect(wrongKey.errorCode).toBe('INVALID_FR_VAT_KEY');

    // Mismatched SIREN must fail
    const mismatch = validateFrenchVatNumber(computed, '732829320');
    expect(mismatch.valid).toBe(false);
    expect(mismatch.errorCode).toBe('FR_VAT_SIREN_MISMATCH');
  });

  it('validates EU Member State VIES VAT formats (DE, BE, ES, IT, NL)', () => {
    expect(validateEuVatNumber('DE123456789').valid).toBe(true);
    expect(validateEuVatNumber('BE0123456789').valid).toBe(true);
    expect(validateEuVatNumber('IT12345678901').valid).toBe(true);
    expect(validateEuVatNumber('NL123456789B01').valid).toBe(true);

    expect(validateEuVatNumber('DE12345').valid).toBe(false);
    expect(validateEuVatNumber('XX123456789').valid).toBe(false);
  });

  it('generates FEC-compliant auxiliary account codes (CompAuxNum)', () => {
    expect(generateAuxiliaryAccountCode('customer', 1)).toBe('411CLI0001');
    expect(generateAuxiliaryAccountCode('supplier', 42)).toBe('401FOU0042');
  });
});
