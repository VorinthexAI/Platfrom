import type { QueryClient } from "@tanstack/react-query";

import type { CityDetail } from "@/lib/travel-client";
import { compassQueryKeys, type WorkspaceContext } from "@/lib/compass-query-keys";

// Guide payloads contain one-hour authorization tokens, not just durable prose.
export const PLACE_GUIDE_CACHE_MS = 45 * 60_000;
export const PLACE_IMAGE_CACHE_MS = 10 * 60_000;

export function hydratePlaceChildren(
  queryClient: QueryClient,
  context: WorkspaceContext,
  countryCode: string,
  expectedCities: readonly { name: string }[],
  cities: readonly CityDetail[],
) {
  if (cities.length !== 10 || expectedCities.length !== cities.length || cities.some((city, index) => city.location.name.toLocaleLowerCase() !== expectedCities[index]?.name.toLocaleLowerCase())) {
    throw new Error("Country cities did not match the requested city order.");
  }

  cities.forEach((city) => {
    const key = compassQueryKeys.cityDetail(context, countryCode, city.location.name);
    const existing = queryClient.getQueryState(key);
    if (existing?.fetchStatus === "fetching" || existing?.status === "success" && Date.now() - existing.dataUpdatedAt < PLACE_GUIDE_CACHE_MS) return;
    queryClient.setQueryData(key, city);
  });
}
