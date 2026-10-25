export interface AssetInput {
  id: string;
  acquisitionCostMinor: number;
  acquisitionDate: string; // ISO date YYYY-MM-DD
  depreciationMethod: 'LINEAR' | 'DECLINING' | 'NONE';
  usefulLifeMonths: number;
  residualValueMinor: number;
}

export interface DepreciationLine {
  periodLabel: string; // 'YYYY-MM'
  dotationMinor: number;
  cumulAmortMinor: number;
  netBookValueMinor: number;
}

// French fiscal declining balance coefficients
function decliningCoeff(usefulLifeMonths: number): number {
  const years = usefulLifeMonths / 12;
  if (years < 3) return 1.0; // not allowed, falls back to linear
  if (years <= 4) return 1.25;
  if (years <= 6) return 1.75;
  return 2.25;
}

// Returns the number of days between two dates
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Days in a given year
function daysInYear(year: number): number {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

export function computeDepreciationSchedule(asset: AssetInput): DepreciationLine[] {
  if (asset.depreciationMethod === 'NONE' || asset.usefulLifeMonths <= 0) return [];

  const acquisitionDate = new Date(asset.acquisitionDate);
  const depreciableBase = asset.acquisitionCostMinor - asset.residualValueMinor;
  if (depreciableBase <= 0) return [];

  const lines: DepreciationLine[] = [];
  let cumulAmort = 0;

  if (asset.depreciationMethod === 'LINEAR') {
    const annualRate = 1 / (asset.usefulLifeMonths / 12);
    const annualDotation = Math.round(depreciableBase * annualRate);

    // First period: pro-rata from acquisition day to end of year
    let currentYear = acquisitionDate.getFullYear();
    const endOfFirstYear = new Date(currentYear, 11, 31);
    const firstDays = daysBetween(acquisitionDate, endOfFirstYear) + 1;
    const diy = daysInYear(currentYear);

    // Build schedule month by month
    let remainingMonths = asset.usefulLifeMonths;
    let currentDate = new Date(acquisitionDate);
    let nbvRemaining = depreciableBase;

    while (remainingMonths > 0 && nbvRemaining > 0) {
      const month = currentDate.getMonth();
      const year = currentDate.getFullYear();
      const periodLabel = `${year}-${String(month + 1).padStart(2, '0')}`;

      // For first month, pro-rata based on days remaining in that month
      let dotation: number;
      if (lines.length === 0) {
        // Pro-rata temporis: days from acquisition to end of acquisition month
        const endOfMonth = new Date(year, month + 1, 0);
        const daysInFirstMonth = daysBetween(acquisitionDate, endOfMonth) + 1;
        const daysInThisMonth = endOfMonth.getDate();
        dotation = Math.round((annualDotation / 12) * (daysInFirstMonth / daysInThisMonth));
      } else {
        dotation = Math.round(annualDotation / 12);
      }

      dotation = Math.min(dotation, nbvRemaining);
      cumulAmort += dotation;
      nbvRemaining -= dotation;

      lines.push({
        periodLabel,
        dotationMinor: dotation,
        cumulAmortMinor: cumulAmort,
        netBookValueMinor: Math.max(0, asset.acquisitionCostMinor - cumulAmort),
      });

      remainingMonths--;
      currentDate = new Date(year, month + 1, 1);
    }

    // Final period: adjust last line to clear any rounding remainder
    if (lines.length > 0 && nbvRemaining > 0) {
      const last = lines[lines.length - 1]!;
      last.dotationMinor += nbvRemaining;
      last.cumulAmortMinor += nbvRemaining;
      last.netBookValueMinor = asset.residualValueMinor;
    }
  } else {
    // DECLINING balance
    const usefulYears = asset.usefulLifeMonths / 12;
    const coeff = decliningCoeff(asset.usefulLifeMonths);
    const linearRate = 1 / usefulYears;
    const decliningRate = linearRate * coeff;

    let currentNbv = depreciableBase;
    let remainingMonths = asset.usefulLifeMonths;
    let currentDate = new Date(acquisitionDate);

    while (remainingMonths > 0 && currentNbv > 0) {
      const month = currentDate.getMonth();
      const year = currentDate.getFullYear();
      const periodLabel = `${year}-${String(month + 1).padStart(2, '0')}`;

      const remainingYears = remainingMonths / 12;
      // Switch to linear when linear rate > declining rate
      const effectiveRate = (remainingYears > 0 && (1 / remainingYears) > decliningRate)
        ? (1 / remainingYears)
        : decliningRate;

      let dotation: number;
      if (lines.length === 0) {
        const endOfMonth = new Date(year, month + 1, 0);
        const daysInFirstMonth = daysBetween(acquisitionDate, endOfMonth) + 1;
        const daysInThisMonth = endOfMonth.getDate();
        dotation = Math.round((currentNbv * effectiveRate / 12) * (daysInFirstMonth / daysInThisMonth));
      } else {
        dotation = Math.round(currentNbv * effectiveRate / 12);
      }

      dotation = Math.min(dotation, currentNbv);
      if (dotation <= 0) break;

      cumulAmort += dotation;
      currentNbv -= dotation;

      lines.push({
        periodLabel,
        dotationMinor: dotation,
        cumulAmortMinor: cumulAmort,
        netBookValueMinor: Math.max(0, asset.acquisitionCostMinor - cumulAmort),
      });

      remainingMonths--;
      currentDate = new Date(year, month + 1, 1);
    }

    // Clear any final rounding residual
    if (lines.length > 0 && currentNbv > 0) {
      const last = lines[lines.length - 1]!;
      last.dotationMinor += currentNbv;
      last.cumulAmortMinor += currentNbv;
      last.netBookValueMinor = asset.residualValueMinor;
    }
  }

  return lines;
}

export function computePeriodDotation(asset: AssetInput, periodLabel: string): number {
  const schedule = computeDepreciationSchedule(asset);
  return schedule.find((l) => l.periodLabel === periodLabel)?.dotationMinor ?? 0;
}
