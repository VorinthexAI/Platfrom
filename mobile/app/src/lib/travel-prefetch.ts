import type { QueryClient } from "@tanstack/react-query";

import type { CityDetail, PlaceImageResponse } from "@/lib/travel-client";
import { compassQueryKeys, type WorkspaceContext } from "@/lib/compass-query-keys";

export const PLACE_GUIDE_CACHE_MS = Infinity;
export const PLACE_IMAGE_GC_MS = 5 * 60_000;
type GeneratePlaceHeroImage = (input: { imageRequestToken: string }, signal?: AbortSignal) => Promise<PlaceImageResponse>;

export function hydratePlaceChildren(
  queryClient: QueryClient,
  context: WorkspaceContext,
  countryCode: string,
  expectedCities: readonly { name: string }[],
  cities: readonly CityDetail[],
  generateImage: GeneratePlaceHeroImage,
) {
  if (cities.length !== 10 || expectedCities.length !== cities.length || cities.some((city, index) => city.location.name.toLocaleLowerCase() !== expectedCities[index]?.name.toLocaleLowerCase())) {
    throw new Error("Country cities did not match the requested city order.");
  }

  cities.forEach((city) => {
    queryClient.setQueryData(compassQueryKeys.cityDetail(context, countryCode, city.location.name), city);
  });

  return cities.map((city) => queryClient.ensureQueryData<PlaceImageResponse>({
    queryKey: compassQueryKeys.cityImage(context, countryCode, city.location.name, city.imageRequestToken),
    queryFn: ({ signal }) => generateImage({ imageRequestToken: city.imageRequestToken }, signal),
    staleTime: PLACE_GUIDE_CACHE_MS,
    gcTime: PLACE_IMAGE_GC_MS,
    retry: false,
  }));
}
