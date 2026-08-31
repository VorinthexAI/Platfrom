import type { QueryClient } from "@tanstack/react-query";

import type { CityDetail } from "@/lib/travel-client";
import { compassQueryKeys, type WorkspaceContext } from "@/lib/compass-query-keys";

export const PLACE_GUIDE_CACHE_MS = Infinity;

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
    queryClient.setQueryData(compassQueryKeys.cityDetail(context, countryCode, city.location.name), city);
  });
}
