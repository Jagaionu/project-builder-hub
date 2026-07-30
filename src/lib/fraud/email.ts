// Pure email helpers used by the abuse engine.
export type EmailKind = "business" | "free" | "disposable";

// Lowercase, strip plus-tags, and collapse gmail dots so aliases of the same
// mailbox normalise to one identity.
export function normalizeEmail(raw: string): string {
  const email = (raw || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 0) return email;
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.split(".").join("");
    return local + "@gmail.com";
  }
  return local + "@" + domain;
}

export function emailDomain(raw: string): string {
  const email = (raw || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1);
}

// A domain is disposable, free (personal provider), or business (anything else).
export function classifyEmailDomain(
  domain: string,
  freeSet: Set<string>,
  disposableSet: Set<string>,
): EmailKind {
  const d = (domain || "").trim().toLowerCase();
  if (disposableSet.has(d)) return "disposable";
  if (freeSet.has(d)) return "free";
  return "business";
}
