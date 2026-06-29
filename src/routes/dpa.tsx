// NOTE: Template Data Processing Agreement (DPA). This is a summary suitable for
// early customers; enterprise carriers may require a signed, negotiated DPA.
// MUST be reviewed by a qualified data-protection adviser before relying on it.
import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "@/components/legal/LegalShell";

export const Route = createFileRoute("/dpa")({
  component: DpaPage,
  head: () => ({ meta: [{ title: "Data Processing Agreement — The Prime Route" }] }),
});

function DpaPage() {
  return (
    <LegalShell title="Data Processing Agreement" updated="29 June 2026">
      <p>
        This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the{" "}
        <a href="/terms">Terms of Service</a> between your company (the &ldquo;Controller&rdquo;)
        and The Prime Route (the &ldquo;Processor&rdquo;) and applies where we process personal data
        on your behalf, including driver location data.
      </p>

      <h2>1. Roles</h2>
      <p>
        You are the Controller of the operational and location data you process through the Service
        (including your drivers&apos; personal and location data). We act as your Processor and
        process that data only on your documented instructions, which include your configuration
        and use of the Service.
      </p>

      <h2>2. Scope and purpose</h2>
      <p>
        We process personal data solely to provide the Service: dispatch and planning, real-time
        and historical vehicle tracking, estimated arrival times, proof of attendance, reporting,
        and related support. Categories of data subjects include your administrators, members and
        drivers; categories of data include identifiers, contact details, operational records and
        location data.
      </p>

      <h2>3. Sub-processors</h2>
      <p>
        You authorise us to engage the sub-processors listed in our{" "}
        <a href="/privacy-policy">Privacy Policy</a> (including Supabase, Vercel, Stripe,
        GoCardless, OpenAI, map-tile and email providers). We impose data-protection obligations on
        each sub-processor and remain responsible for their performance. We will give reasonable
        notice of new sub-processors so you can object on reasonable grounds.
      </p>

      <h2>4. Security</h2>
      <p>
        We implement appropriate technical and organisational measures, including tenant isolation
        (row-level security), encryption in transit, access controls, per-person logins with device
        approval, and audit logging, designed to protect personal data against unauthorised access,
        loss or disclosure.
      </p>

      <h2>5. Confidentiality</h2>
      <p>
        Personnel authorised to process personal data are bound by appropriate confidentiality
        obligations and access data only as needed to operate and support the Service.
      </p>

      <h2>6. Data subject requests</h2>
      <p>
        Taking into account the nature of the processing, we will assist you with appropriate
        measures to respond to requests from data subjects to exercise their rights under
        applicable data protection law.
      </p>

      <h2>7. Personal data breaches</h2>
      <p>
        We will notify you without undue delay after becoming aware of a personal data breach
        affecting your data, and provide the information reasonably needed for you to meet your
        notification obligations.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Where personal data is transferred outside the UK/EEA, we rely on appropriate safeguards
        such as the UK International Data Transfer Agreement or Standard Contractual Clauses.
      </p>

      <h2>9. Return and deletion</h2>
      <p>
        On termination, we retain your data for 30 days to allow export or reactivation, after
        which we delete or anonymise it unless we are legally required to retain it. Operational
        location history is deleted in line with the retention period described in our Privacy
        Policy.
      </p>

      <h2>10. Audit</h2>
      <p>
        We will make available information reasonably necessary to demonstrate compliance with this
        DPA and, on reasonable request and subject to confidentiality, allow for audits limited to
        the processing of your personal data.
      </p>

      <h2>Contact</h2>
      <p>
        For DPA or data-protection matters, contact{" "}
        <a href="mailto:privacy@theprimeroute.co.uk">privacy@theprimeroute.co.uk</a>.
      </p>
    </LegalShell>
  );
}
