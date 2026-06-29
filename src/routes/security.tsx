// Public Security & Trust page — a plain (non-legal) reassurance page carriers
// often look for before procurement. Bullets are kept factual to what the
// platform actually does.
import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "@/components/legal/LegalShell";

export const Route = createFileRoute("/security")({
  component: SecurityPage,
  head: () => ({ meta: [{ title: "Security & Trust — The Prime Route" }] }),
});

function Item({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

function SecurityPage() {
  return (
    <LegalShell title="Security & Trust" updated="29 June 2026">
      <p>
        We take the security of your operational and driver data seriously. Here is a plain summary
        of how The Prime Route is built and operated.
      </p>

      <h2>How we protect your data</h2>
      <ul>
        <Item>Data encrypted in transit (HTTPS/TLS).</Item>
        <Item>Tenant isolation enforced at the database level with row-level security.</Item>
        <Item>Individual user accounts — no shared logins.</Item>
        <Item>New-device approval to prevent credential sharing.</Item>
        <Item>Audit logging of key actions.</Item>
        <Item>Card and bank details are never stored on our servers.</Item>
        <Item>
          Encrypted backups maintained by our infrastructure providers to support recovery.
        </Item>
        <Item>Built to support UK GDPR compliance; a Data Processing Agreement is available.</Item>
      </ul>

      <h2>Our infrastructure</h2>
      <ul>
        <Item>Application hosting: Vercel.</Item>
        <Item>Database, authentication and file storage: Supabase.</Item>
        <Item>Payments: Stripe and GoCardless.</Item>
        <Item>Maps: CartoDB / OpenStreetMap tiles.</Item>
      </ul>

      <h2>Location data</h2>
      <p>
        The Driver App collects location only during an active assignment or route, to provide
        tracking, ETAs and operational reporting to the driver&apos;s company. Full details are in
        our <a href="/privacy-policy">Privacy Policy</a>.
      </p>

      <h2>Documents</h2>
      <p>
        For the detail behind this summary, see our <a href="/terms">Terms of Service</a>,{" "}
        <a href="/privacy-policy">Privacy Policy</a>, and{" "}
        <a href="/dpa">Data Processing Agreement</a>.
      </p>

      <h2>Contact</h2>
      <p>
        Security questions? Email{" "}
        <a href="mailto:security@theprimeroute.co.uk">security@theprimeroute.co.uk</a>.
      </p>
    </LegalShell>
  );
}
