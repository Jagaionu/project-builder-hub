// Single source of truth for the legal entity shown across all policy pages.
//
// TODO (once incorporated): set `name` to "The Prime Route Ltd" and fill
// `companyNumber` + `registeredOffice`. The registered-details line only renders
// when `companyNumber` is set, so customers never see placeholder text.
export const LEGAL_ENTITY = {
  name: "The Prime Route",
  /** Companies House number, e.g. "12345678". Leave empty until incorporated. */
  companyNumber: "",
  /** Registered office address. Leave empty until incorporated. */
  registeredOffice: "",
  jurisdiction: "England and Wales",
  supportEmail: "support@theprimeroute.co.uk",
  privacyEmail: "privacy@theprimeroute.co.uk",
};
