// Reusable branded HTML email template. Email-client-safe: table layout with
// inline styles and an absolute (hosted) logo URL. Returns both an HTML and a
// plain-text version.

export interface BrandedEmailOptions {
  /** Hidden preheader shown in the inbox preview. */
  previewText?: string;
  heading: string;
  /** One or more body paragraphs (plain text; will be HTML-escaped). */
  paragraphs: string[];
  /** Optional primary call-to-action button. */
  cta?: { label: string; url: string };
  /** Optional raw fallback URL shown under the button. */
  fallbackUrl?: string;
  /** Small print at the bottom. */
  footerNote?: string;
}

const BRAND = "The Prime Route";

function baseUrl(): string {
  return process.env.APP_BASE_URL ?? "https://theprimeroute.co.uk";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderBrandedEmail(opts: BrandedEmailOptions): { html: string; text: string } {
  const logo = `${baseUrl()}/email-logo.png`;
  const preheader = opts.previewText ? esc(opts.previewText) : "";

  const paras = opts.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${esc(p)}</p>`,
    )
    .join("");

  const button = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
         <tr><td align="center" bgcolor="#2563eb" style="border-radius:10px;">
           <a href="${esc(opts.cta.url)}" target="_blank"
              style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
             ${esc(opts.cta.label)}
           </a>
         </td></tr>
       </table>`
    : "";

  const fallback = opts.fallbackUrl
    ? `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#94a3b8;">
         If the button does not work, copy and paste this link into your browser:
       </p>
       <p style="margin:0 0 16px;font-size:12px;line-height:1.5;word-break:break-all;">
         <a href="${esc(opts.fallbackUrl)}" style="color:#2563eb;">${esc(opts.fallbackUrl)}</a>
       </p>`
    : "";

  const footer = opts.footerNote
    ? `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#94a3b8;">${esc(opts.footerNote)}</p>`
    : "";

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
  </head>
  <body style="margin:0;padding:0;background:#f4f6fb;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;">
            <tr>
              <td align="center" style="padding:0 0 20px;">
                <img src="${esc(logo)}" width="48" height="48" alt="${esc(BRAND)}"
                     style="display:block;border-radius:12px;" />
                <div style="margin-top:10px;font-size:16px;font-weight:700;color:#0f172a;letter-spacing:-0.01em;">
                  ${esc(BRAND)}
                </div>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e5e9f2;border-radius:16px;padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a;">${esc(opts.heading)}</h1>
                ${paras}
                ${button}
                ${fallback}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 8px 0;">
                ${footer}
                <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                  ${esc(BRAND)} - dispatch, live tracking and tachograph compliance for UK carriers.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [opts.heading, "", ...opts.paragraphs];
  if (opts.cta) textLines.push("", `${opts.cta.label}: ${opts.cta.url}`);
  else if (opts.fallbackUrl) textLines.push("", opts.fallbackUrl);
  if (opts.footerNote) textLines.push("", opts.footerNote);
  const text = textLines.join("\n");

  return { html, text };
}
