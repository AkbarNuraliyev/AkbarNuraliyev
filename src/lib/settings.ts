export interface TenantSettings {
  chilledMinTempC: number;
  chilledMaxTempC: number;
  frozenTargetTempC: number;
  frozenMaxTempC: number;
  chilledShelfLifeHours: number;
  frozenShelfLifeDays: number;
  massBalanceTolerancePct: number;
  inFullTolerancePct: number;
  expiryWarningHours: number;
  forecastWeeks: number;
  forecastSafetyStockPct: number;
  seasonalFactors: number[];
  showFarmOnPublicPage: boolean;
  publicPageMessage: string;
  defaultPaymentTermsDays: number;
}

export const DEFAULT_SETTINGS: TenantSettings = {
  chilledMinTempC: 0,
  chilledMaxTempC: 4,
  frozenTargetTempC: -18,
  frozenMaxTempC: -18,
  chilledShelfLifeHours: 72,
  frozenShelfLifeDays: 180,
  massBalanceTolerancePct: 3,
  inFullTolerancePct: 2,
  expiryWarningHours: 72,
  forecastWeeks: 6,
  forecastSafetyStockPct: 10,
  seasonalFactors: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  showFarmOnPublicPage: true,
  publicPageMessage: "",
  defaultPaymentTermsDays: 14,
};

export function parseSettings(raw: unknown): TenantSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<TenantSettings>;
  const merged = { ...DEFAULT_SETTINGS, ...obj };
  if (!Array.isArray(merged.seasonalFactors) || merged.seasonalFactors.length !== 12) {
    merged.seasonalFactors = DEFAULT_SETTINGS.seasonalFactors;
  }
  return merged;
}

/** Temperature limits for a storage type according to tenant settings. */
export function tempLimits(settings: TenantSettings, type: "CHILLED" | "FROZEN" | "AMBIENT" | "QUARANTINE") {
  if (type === "FROZEN") return { min: null as number | null, max: settings.frozenMaxTempC };
  if (type === "CHILLED" || type === "QUARANTINE") return { min: settings.chilledMinTempC, max: settings.chilledMaxTempC };
  return { min: null as number | null, max: 25 };
}
