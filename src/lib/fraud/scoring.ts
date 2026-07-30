// Pure scoring + decision engine. Reads a FraudSettings config so every weight
// and threshold is tunable without a code change.
import type { FraudSettings } from "./fraud-config";
import type { EmailKind } from "./email";

export type VerificationMethod = "companies_house" | "manual";

export interface IdentitySignals {
  verificationMethod: VerificationMethod;
  businessEmail: boolean;
  directorProvided: boolean;
}

export interface RiskSignals {
  deviceSeenBefore: boolean;
  ipSeenBefore: boolean;
  emailKind: EmailKind;
  recentFailedSignups: boolean;
}

export function computeIdentityTrust(s: IdentitySignals, cfg: FraudSettings): number {
  let t = 0;
  t += s.verificationMethod === "companies_house" ? cfg.weightIdentityCh : cfg.weightIdentityManual;
  if (s.businessEmail) t += cfg.weightIdentityBusinessEmail;
  if (s.directorProvided) t += cfg.weightIdentityDirector;
  return t;
}

export function computeFraudRisk(s: RiskSignals, cfg: FraudSettings): number {
  let r = 0;
  if (s.deviceSeenBefore) r += cfg.weightRiskDevice;
  if (s.ipSeenBefore) r += cfg.weightRiskIp;
  if (s.emailKind === "disposable") r += cfg.weightRiskDisposableEmail;
  else if (s.emailKind === "free") r += cfg.weightRiskFreeEmail;
  if (s.recentFailedSignups) r += cfg.weightRiskFailedSignups;
  return r;
}

export type SignupDecision = "active" | "pending_review" | "blocked";

export interface DecisionInput {
  identityTrust: number;
  fraudRisk: number;
  chVerified: boolean;
  duplicateWithinCooldown: boolean;
  alreadyTrusted: boolean;
}

export interface DecisionResult {
  decision: SignupDecision;
  reasons: string[];
}

// Verified duplicate company number in the cooldown window is blocked BEFORE
// scoring. Trusted companies skip checks. Otherwise a CH-verified, high-trust,
// low-risk signup is auto-activated; everything else goes to manual review.
export function decideSignup(input: DecisionInput, cfg: FraudSettings): DecisionResult {
  if (input.duplicateWithinCooldown) {
    return { decision: "blocked", reasons: ["duplicate_company_number_within_cooldown"] };
  }
  if (input.alreadyTrusted) {
    return { decision: "active", reasons: ["trusted"] };
  }
  if (input.chVerified && input.identityTrust >= cfg.trustMin && input.fraudRisk < cfg.riskThreshold) {
    return { decision: "active", reasons: ["ch_verified_low_risk"] };
  }
  const reasons: string[] = [];
  if (!input.chVerified) reasons.push("manual_verification");
  if (input.fraudRisk >= cfg.riskThreshold) reasons.push("risk_threshold_exceeded");
  if (input.identityTrust < cfg.trustMin) reasons.push("identity_trust_below_min");
  return { decision: "pending_review", reasons };
}

const AVG_MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;

// True if the last trial for this identity is still inside the cooldown window.
export function cooldownActive(
  lastTrialAtMs: number | null,
  nowMs: number,
  months: number,
): boolean {
  if (!lastTrialAtMs) return false;
  return nowMs - lastTrialAtMs < months * AVG_MONTH_MS;
}
