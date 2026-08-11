// Trial fee configuration. Code defaults; the DB row in trial_config overrides
// them and is editable by a super admin with no redeploy. Amounts are ex-VAT,
// minor units (pence). Ongoing subscription pricing is unchanged.
export interface TrialConfig {
  currency: string;
  trial7FeeMinor: number;
  trial14FeeMinor: number;
  defaultTrialDays: number;
  paidTrialEnabled: boolean;
}

export const DEFAULT_TRIAL_CONFIG: TrialConfig = {
  currency: "GBP",
  trial7FeeMinor: 1000,
  trial14FeeMinor: 3000,
  defaultTrialDays: 7,
  paidTrialEnabled: false,
};

export const TRIAL_CONFIG_COLUMNS: Record<keyof TrialConfig, string> = {
  currency: "currency",
  trial7FeeMinor: "trial_7_fee_minor",
  trial14FeeMinor: "trial_14_fee_minor",
  defaultTrialDays: "default_trial_days",
  paidTrialEnabled: "paid_trial_enabled",
};

export function trialFeeMinor(days: number, cfg: TrialConfig): number {
  return days >= 14 ? cfg.trial14FeeMinor : cfg.trial7FeeMinor;
}
