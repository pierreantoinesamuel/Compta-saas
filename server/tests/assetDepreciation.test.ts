import { describe, expect, it } from 'vitest';
import { computeDepreciationSchedule, computePeriodDotation } from '../domain/assets/assetDepreciation.js';
import type { AssetInput } from '../domain/assets/assetDepreciation.js';

describe('computeDepreciationSchedule — immobilisations', () => {
  it('returns empty schedule for NONE method', () => {
    const asset: AssetInput = {
      id: 'a1',
      acquisitionCostMinor: 1_000_00,
      acquisitionDate: '2026-01-01',
      depreciationMethod: 'NONE',
      usefulLifeMonths: 36,
      residualValueMinor: 0,
    };
    expect(computeDepreciationSchedule(asset)).toHaveLength(0);
  });

  it('LINEAR: total amortised equals depreciable base', () => {
    const asset: AssetInput = {
      id: 'a2',
      acquisitionCostMinor: 12_000_00,
      acquisitionDate: '2026-01-01',
      depreciationMethod: 'LINEAR',
      usefulLifeMonths: 36,
      residualValueMinor: 0,
    };
    const schedule = computeDepreciationSchedule(asset);
    expect(schedule.length).toBe(36);
    const totalDotation = schedule.reduce((s, l) => s + l.dotationMinor, 0);
    expect(totalDotation).toBe(asset.acquisitionCostMinor);
    expect(schedule.at(-1)!.netBookValueMinor).toBe(0);
  });

  it('LINEAR: first period is pro-rata when acquisition is mid-month', () => {
    const asset: AssetInput = {
      id: 'a3',
      acquisitionCostMinor: 12_000_00,
      acquisitionDate: '2026-07-15',
      depreciationMethod: 'LINEAR',
      usefulLifeMonths: 12,
      residualValueMinor: 0,
    };
    const schedule = computeDepreciationSchedule(asset);
    const fullMonthly = Math.round(12_000_00 / 12);
    expect(schedule[0]!.dotationMinor).toBeLessThan(fullMonthly);
  });

  it('LINEAR: residual value reduces depreciable base', () => {
    const asset: AssetInput = {
      id: 'a4',
      acquisitionCostMinor: 10_000_00,
      acquisitionDate: '2026-01-01',
      depreciationMethod: 'LINEAR',
      usefulLifeMonths: 24,
      residualValueMinor: 1_000_00,
    };
    const schedule = computeDepreciationSchedule(asset);
    const totalDotation = schedule.reduce((s, l) => s + l.dotationMinor, 0);
    expect(totalDotation).toBe(9_000_00);
    expect(schedule.at(-1)!.netBookValueMinor).toBe(1_000_00);
  });

  it('DECLINING: uses coefficient 1.25 for 3-year asset — first year exceeds straight-line', () => {
    const asset: AssetInput = {
      id: 'a5',
      acquisitionCostMinor: 12_000_00,
      acquisitionDate: '2026-01-01',
      depreciationMethod: 'DECLINING',
      usefulLifeMonths: 36,
      residualValueMinor: 0,
    };
    const schedule = computeDepreciationSchedule(asset);
    const firstYearDotation = schedule.slice(0, 12).reduce((s, l) => s + l.dotationMinor, 0);
    const linearAnnual = Math.round(12_000_00 / 3);
    expect(firstYearDotation).toBeGreaterThan(linearAnnual);
    const total = schedule.reduce((s, l) => s + l.dotationMinor, 0);
    expect(total).toBe(12_000_00);
  });

  it('DECLINING: fully amortises a 5-year asset (coeff 1.75)', () => {
    const asset: AssetInput = {
      id: 'a6',
      acquisitionCostMinor: 50_000_00,
      acquisitionDate: '2026-01-01',
      depreciationMethod: 'DECLINING',
      usefulLifeMonths: 60,
      residualValueMinor: 0,
    };
    const schedule = computeDepreciationSchedule(asset);
    const total = schedule.reduce((s, l) => s + l.dotationMinor, 0);
    expect(total).toBe(50_000_00);
    expect(schedule.at(-1)!.netBookValueMinor).toBe(0);
  });

  it('computePeriodDotation returns 0 outside the schedule', () => {
    const asset: AssetInput = {
      id: 'a7',
      acquisitionCostMinor: 6_000_00,
      acquisitionDate: '2026-01-01',
      depreciationMethod: 'LINEAR',
      usefulLifeMonths: 12,
      residualValueMinor: 0,
    };
    expect(computePeriodDotation(asset, '2025-01')).toBe(0);
    expect(computePeriodDotation(asset, '2027-06')).toBe(0);
    expect(computePeriodDotation(asset, '2026-01')).toBeGreaterThan(0);
  });
});
