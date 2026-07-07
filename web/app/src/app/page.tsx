import { LandingPage } from "@/components/landing/LandingPage";
import { getDeepLinkTarget } from "@/lib/galaxy/registry-helpers";

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Galaxy overview. Deep-link inputs — `?focus=`, `?capability=`,
 * `?target=core.archive` — resolve through the registry server-side so
 * shared links start the camera at the right body on refresh.
 */
export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") urlParams.set(key, value);
  }
  const entity = getDeepLinkTarget({ pathname: "/", searchParams: urlParams });

  return (
    <LandingPage
      initialEntityId={entity.id === "nexus.star" ? undefined : entity.id}
    />
  );
}
