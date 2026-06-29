// NOTE: Template Privacy Policy for an early-stage UK B2B SaaS that tracks driver
// location. MUST be reviewed by a qualified data-protection adviser before
// go-live, and the retention periods/sub-processor list kept in sync with the
// actual implementation.
import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "@/components/legal/LegalShell";

export const Route = createFileRoute("/privacy-policy")({
  component: PrivacyPolicyPage,
  head: () => ({ meta: [{ title: "Privacy Policy — The Prime Route" }] }),
});

function PrivacyPolicyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="29 June 2026">
      <p>
        This policy explains how The Prime Route (&ldquo;we&rdquo;, &ldquo;us&rdquo;) handles
        personal data when you use our logistics dispatch platform and driver app. We act as a data
        controller for our direct business relationship with you, and as a data processor for the
        operational and location data your company processes through the Service (see our{" "}
        <a href="/dpa">Data Processing Agreement</a>).
      </p>

      <h2>Data we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> company details, administrator and member names, email
          addresses, and login information.
        </li>
        <li>
          <strong>Operational data:</strong> jobs, routes, warehouses, drivers, schedules and
          related records your company enters.
        </li>
        <li>
          <strong>Location data:</strong> driver device location during active assignments (see
          below).
        </li>
        <li>
          <strong>Billing data:</strong> plan, invoices and VAT details. Card and bank details are
          handled by our payment providers and are not stored by us.
        </li>
        <li>
          <strong>Technical data:</strong> device identifiers, approximate location derived from IP
          at login, and basic usage logs, used to secure accounts and prevent credential sharing.
        </li>
      </ul>

      <h2>Location Data</h2>
      <p>
        The Prime Route Driver App collects the device&apos;s location while the application is in
        use to provide real-time vehicle tracking, route monitoring, estimated arrival times, proof
        of attendance, and operational reporting for your employer or contracting company.
      </p>
      <p>
        Location data is only collected when tracking has been enabled as part of an active
        assignment or route. The app does not collect location data when no active tracking session
        is running, unless explicitly indicated within the application. On the native app, location
        may be collected in the background while a shift or route is active so tracking continues
        when the app is minimised; this is disclosed in the app and requires the relevant device
        permission.
      </p>
      <p>
        The collected location data may be visible to authorised users within your company,
        including dispatchers, planners, and administrators, for operational purposes.
      </p>
      <p>
        Location data is securely stored and retained only for as long as necessary to provide the
        Service and meet legal or contractual obligations (operational location history is
        typically retained for up to 12 months, after which it is deleted unless a shorter period
        is configured by your company).
      </p>

      <h2>Why we process data and the legal basis</h2>
      <ul>
        <li>
          <strong>To provide the Service</strong> (account, operational and location data) —
          performance of our contract with your company.
        </li>
        <li>
          <strong>Driver location</strong> — processed on behalf of your company (the carrier) for
          its legitimate interests in fleet management, safety and operational reporting, or to
          perform its contract with you. Your employer or contracting company is responsible for
          the lawful basis it relies on towards its drivers.
        </li>
        <li>
          <strong>Security and anti-abuse</strong> (device and IP-derived location) — our
          legitimate interest in protecting accounts and preventing misuse.
        </li>
        <li>
          <strong>Billing and tax</strong> — performance of contract and legal obligation.
        </li>
      </ul>

      <h2>Who can see the data</h2>
      <p>
        Operational and location data is visible to authorised users within the same company only.
        Companies are isolated from one another. Our staff access data only as needed to operate
        and support the Service.
      </p>

      <h2>Sub-processors</h2>
      <p>We use the following providers to deliver the Service:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — database, authentication and file storage.
        </li>
        <li>
          <strong>Vercel</strong> — application hosting.
        </li>
        <li>
          <strong>Stripe</strong> and <strong>GoCardless</strong> — payment processing.
        </li>
        <li>
          <strong>OpenAI</strong> — the in-app AI assistant (only the content you send to it is
          processed).
        </li>
        <li>
          <strong>CartoDB / OpenStreetMap</strong> — map tiles (these receive map view requests,
          not driver identities).
        </li>
        <li>
          Our configured <strong>email provider</strong> — transactional email.
        </li>
      </ul>
      <p>
        Where data is processed outside the UK/EEA, we rely on appropriate safeguards such as the
        UK International Data Transfer Agreement or Standard Contractual Clauses.
      </p>

      <h2>Retention</h2>
      <p>
        We keep personal data for as long as your account is active and as needed to provide the
        Service. After cancellation, company data is retained for 30 days to allow export or
        reactivation, after which it may be permanently deleted unless we are legally required to
        keep it. Operational location history follows the retention period described above.
      </p>

      <h2>Your rights</h2>
      <p>
        Subject to UK data protection law, individuals have rights to access, correct, delete,
        restrict or object to processing, and to data portability. For operational and location
        data, requests are usually directed to the company (carrier) that controls that data; we
        will assist that company as its processor. To exercise rights relating to data we control,
        contact us below.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions or requests, email{" "}
        <a href="mailto:privacy@theprimeroute.co.uk">privacy@theprimeroute.co.uk</a>. You also have
        the right to complain to the UK Information Commissioner&apos;s Office (ICO).
      </p>
    </LegalShell>
  );
}
