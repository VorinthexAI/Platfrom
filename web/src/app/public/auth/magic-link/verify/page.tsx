import { redirect } from "next/navigation";

export default async function MagicLinkVerifyAliasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tokenHash =
    typeof params.token_hash === "string" ? params.token_hash.trim() : "";
  const query = tokenHash ? `?token_hash=${encodeURIComponent(tokenHash)}` : "";

  redirect(`/public/auth/token${query}`);
}
