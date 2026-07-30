// Fraud/abuse configuration. Code holds only sane DEFAULTS; the DB row in
// fraud_settings overrides these and is editable from the dashboard with no
// deploy. Keep these defaults in sync with migration 50.
export interface FraudSettings {
  riskThreshold: number;
  trustMin: number;
  cooldownMonths: number;
  rateLimitMaxAttempts: number;
  rateLimitWindowMinutes: number;
  weightIdentityCh: number;
  weightIdentityManual: number;
  weightIdentityBusinessEmail: number;
  weightIdentityDirector: number;
  weightRiskDevice: number;
  weightRiskIp: number;
  weightRiskFreeEmail: number;
  weightRiskDisposableEmail: number;
  weightRiskFailedSignups: number;
  trustedMinPaidInvoices: number;
  trustedMinActiveDays: number;
  behaviourMaxDevices24h: number;
  behaviourMaxCountries24h: number;
  behaviourMaxJobs24h: number;
  behaviourMaxDrivers24h: number;
}

export const DEFAULT_FRAUD_SETTINGS: FraudSettings = {
  riskThreshold: 50,
  trustMin: 100,
  cooldownMonths: 24,
  rateLimitMaxAttempts: 10,
  rateLimitWindowMinutes: 10,
  weightIdentityCh: 100,
  weightIdentityManual: 40,
  weightIdentityBusinessEmail: 20,
  weightIdentityDirector: 10,
  weightRiskDevice: 30,
  weightRiskIp: 20,
  weightRiskFreeEmail: 15,
  weightRiskDisposableEmail: 40,
  weightRiskFailedSignups: 30,
  trustedMinPaidInvoices: 3,
  trustedMinActiveDays: 60,
  behaviourMaxDevices24h: 5,
  behaviourMaxCountries24h: 3,
  behaviourMaxJobs24h: 300,
  behaviourMaxDrivers24h: 30,
};

// Maps camelCase FraudSettings keys to the fraud_settings column names.
export const FRAUD_SETTING_COLUMNS: Record<keyof FraudSettings, string> = {
  riskThreshold: "risk_threshold",
  trustMin: "trust_min",
  cooldownMonths: "cooldown_months",
  rateLimitMaxAttempts: "rate_limit_max_attempts",
  rateLimitWindowMinutes: "rate_limit_window_minutes",
  weightIdentityCh: "weight_identity_ch",
  weightIdentityManual: "weight_identity_manual",
  weightIdentityBusinessEmail: "weight_identity_business_email",
  weightIdentityDirector: "weight_identity_director",
  weightRiskDevice: "weight_risk_device",
  weightRiskIp: "weight_risk_ip",
  weightRiskFreeEmail: "weight_risk_free_email",
  weightRiskDisposableEmail: "weight_risk_disposable_email",
  weightRiskFailedSignups: "weight_risk_failed_signups",
  trustedMinPaidInvoices: "trusted_min_paid_invoices",
  trustedMinActiveDays: "trusted_min_active_days",
  behaviourMaxDevices24h: "behaviour_max_devices_24h",
  behaviourMaxCountries24h: "behaviour_max_countries_24h",
  behaviourMaxJobs24h: "behaviour_max_jobs_24h",
  behaviourMaxDrivers24h: "behaviour_max_drivers_24h",
};
