import geoip from "fast-geoip";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function firstHeader(request: Request, names: string[]) {
  for (const name of names) {
    const value = request.headers.get(name)?.split(",")[0]?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value)) return value;
  }
  return null;
}

function firstValue(request: Request, names: string[]) {
  for (const name of names) {
    const value = request.headers.get(name)?.split(",")[0]?.trim();
    if (value) return value;
  }
  return null;
}

export async function GET(request: Request) {
  const trustedCountry = firstHeader(request, ["cf-ipcountry", "x-vercel-ip-country", "x-country-code"]);
  const ip = firstValue(request, ["x-forwarded-for", "x-real-ip"]);
  const country = trustedCountry ?? (ip ? (await geoip.lookup(ip))?.country ?? null : null);
  return NextResponse.json({ countryCode: country && /^[A-Z]{2}$/.test(country) ? country : null }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
