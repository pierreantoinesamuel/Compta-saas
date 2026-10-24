export function parseMinorInput(value: string): number | undefined {
  const normalized = value.trim().replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!normalized) return undefined;
  const match = normalized.match(/^(?:(\d+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/);
  if (!match) return undefined;
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? match[3] ?? '';
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  const result = Number(minor);
  return Number.isSafeInteger(result) ? result : undefined;
}

export function minorInputValue(value: number | undefined): string {
  return value === undefined ? '' : (value / 100).toFixed(2);
}
