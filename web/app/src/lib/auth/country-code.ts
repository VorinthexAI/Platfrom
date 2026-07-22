export async function getClientCountryCode(): Promise<string | null> {
  try {
    const response = await fetch("/api/geo/country", { cache: "no-store" });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (typeof data === "object" && data !== null && "countryCode" in data) {
      const countryCode = data.countryCode;
      return typeof countryCode === "string" && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
    }
  } catch {
    // Country is enrichment, not a reason to block sign-in.
  }
  return null;
}
