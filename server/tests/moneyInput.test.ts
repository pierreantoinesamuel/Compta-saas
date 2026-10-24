import { describe, expect, it } from 'vitest';
import { minorInputValue, parseMinorInput } from '../../src/moneyInput.js';

describe('editable monetary inputs', () => {
  it('parses multi-digit amounts and French decimal input into euro cents', () => {
    expect(parseMinorInput('1234567')).toBe(123456700);
    expect(parseMinorInput('1234,56')).toBe(123456);
    expect(parseMinorInput('1 234,56')).toBe(123456);
    expect(parseMinorInput(',50')).toBe(50);
  });

  it('keeps incomplete or invalid values uncommitted and formats stored cents', () => {
    expect(parseMinorInput('')).toBeUndefined();
    expect(parseMinorInput('12,345')).toBeUndefined();
    expect(minorInputValue(123456)).toBe('1234.56');
  });
});
