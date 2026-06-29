// NOTE: Template Cookie/local-storage policy. The app currently uses only
// essential storage (auth/session + preferences) and no third-party analytics
// or advertising cookies. Update this if analytics are added later.
import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "@/components/legal/LegalShell";

export const Route = createFileRoute("/cookie-policy")({
  component: CookiePolicyPage,
  head: () => ({ meta: [{ title: "Cookie Policy — The Prime Route" }] }),
});

function CookiePolicyPage() {
  return (
    <LegalShell title="Cookie Policy" updated="29 June 2026">
      <p>
        This policy explains the cookies and similar local-storage technologies The Prime Route
        uses. We use only what is necessary to run the Service securely — we do not use advertising
        cookies or third-party tracking.
      </p>

      <h2>Strictly necessary</h2>
      <ul>
        <li>
          <strong>Authentication / session</strong> — keeps you signed in securely (set by our
          authentication provider, Supabase). Without these you cannot use the Service.
        </li>
        <li>
          <strong>Device identifier</strong> — a random value stored on your device to recognise
          approved devices and prevent credential sharing.
        </li>
      </ul>

      <h2>Preferences</h2>
      <ul>
        <li>
          <strong>Theme</strong> — remembers light/dark mode.
        </li>
        <li>
          <strong>Layout preferences</strong> — for example whether the sidebar is collapsed and
          your chosen accent colour for the assistant.
        </li>
      </ul>

      <h2>Third-party content</h2>
      <p>
        Map tiles are loaded from CartoDB / OpenStreetMap to display maps. These requests are
        limited to rendering the map and do not identify individual drivers.
      </p>

      <h2>Managing cookies</h2>
      <p>
        You can clear or block storage in your browser settings, but the strictly necessary items
        are required to sign in and use the Service. Because we currently use only strictly
        necessary and preference cookies, we do not request consent for advertising or analytics
        cookies. Should this change, we will update this policy and implement an appropriate
        consent mechanism where required.
      </p>

      <h2>Contact</h2>
      <p>
        Questions? Email <a href="mailto:privacy@theprimeroute.co.uk">privacy@theprimeroute.co.uk</a>
        .
      </p>
    </LegalShell>
  );
}
