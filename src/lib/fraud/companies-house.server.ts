// Companies House Public Data API client + public search server fn.
// Auth: HTTP Basic with the API key as the username and a blank password.
// Responses are cached in companies_house_cache for 24h to cut API load and
// speed the signup picker. Graceful no-op if COMPANIES_HOUSE_API_KEY is unset
// (the signup UI then offers manual verification).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

const BASE = "https://api.company-information.service.gov.uk";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface ChCompany {
  companyNumber: string;
  title: string;
  status?: string;
  addressSnippet?: string;
}

export interface ChProfile {
  companyNumber: string;
  title: string;
  status?: string;
}

function authHeader(): string | null {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cacheGet(key: string): Promise<any | null> {
  try {
    const { data } = await sb
      .from("companies_house_cache")
      .select("payload, created_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    if (Date.now() - new Date(data.created_at).getTime() > TTL_MS) return null;
    return data.payload;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cacheSet(key: string, payload: any): Promise<void> {
  try {
    await sb
      .from("companies_house_cache")
      .upsert({ cache_key: key, payload, created_at: new Date().toISOString() } as never, {
        onConflict: "cache_key",
      });
  } catch {
    // tolerant pre-migration
  }
}

export async function searchCompanies(query: string, limit = 8): Promise<ChCompany[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = "search:" + limit + ":" + q.toLowerCase();
  const cached = await cacheGet(key);
  if (cached) return cached as ChCompany[];
  const auth = authHeader();
  if (!auth) return [];
  const url = BASE + "/search/companies?q=" + encodeURIComponent(q) + "&items_per_page=" + limit;
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await res.json().catch(() => ({}))) as any;
  const items = Array.isArray(body.items) ? body.items : [];
  const out: ChCompany[] = items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((it: any) => ({
      companyNumber: String(it.company_number ?? ""),
      title: String(it.title ?? ""),
      status: it.company_status ? String(it.company_status) : undefined,
      addressSnippet: it.address_snippet ? String(it.address_snippet) : undefined,
    }))
    .filter((c: ChCompany) => c.companyNumber && c.title);
  await cacheSet(key, out);
  return out;
}

export async function getCompany(companyNumber: string): Promise<ChProfile | null> {
  const num = companyNumber.trim().toUpperCase();
  if (!num) return null;
  const key = "company:" + num;
  const cached = await cacheGet(key);
  if (cached) return cached as ChProfile;
  const auth = authHeader();
  if (!auth) return null;
  const res = await fetch(BASE + "/company/" + encodeURIComponent(num), {
    headers: { Authorization: auth },
  });
  if (!res.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await res.json().catch(() => ({}))) as any;
  if (!body || !body.company_number) return null;
  const profile: ChProfile = {
    companyNumber: String(body.company_number),
    title: String(body.company_name ?? ""),
    status: body.company_status ? String(body.company_status) : undefined,
  };
  await cacheSet(key, profile);
  return profile;
}

// PUBLIC: used by the signup company picker (before authentication).
export const searchCompaniesHouse = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ query: z.string().trim().min(2).max(100) }).parse(d))
  .handler(async ({ data }) => {
    return await searchCompanies(data.query);
  });
