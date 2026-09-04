export type WorkspaceContext = { organizationKey: string; scopeKey: string };

const contextKey = (context: WorkspaceContext) => [context.organizationKey, context.scopeKey] as const;
const sortedTagKeys = (tagKeys: readonly string[]) => [...tagKeys].sort();

export const compassQueryKeys = {
  all: (context: WorkspaceContext) => ["compass", ...contextKey(context)] as const,
  overview: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "overview"] as const,
  places: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "places"] as const,
  placeReferences: (context: WorkspaceContext, placeKey: string, kind: string) => [...compassQueryKeys.places(context), placeKey, "references", kind] as const,
  trips: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "trips"] as const,
  tripGuides: (context: WorkspaceContext, tripKey: string) => [...compassQueryKeys.trips(context), tripKey, "guides"] as const,
  placeSearches: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "place-searches"] as const,
  placeSearch: (context: WorkspaceContext, query: string, tagKeys: readonly string[] = []) => [...compassQueryKeys.placeSearches(context), query.trim().toLocaleLowerCase(), sortedTagKeys(tagKeys)] as const,
  tripSearches: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "trip-searches"] as const,
  tripSearch: (context: WorkspaceContext, query: string, tagKeys: readonly string[] = []) => [...compassQueryKeys.tripSearches(context), query.trim().toLocaleLowerCase(), sortedTagKeys(tagKeys)] as const,
  countryDetails: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "country-details"] as const,
  countryDetail: (context: WorkspaceContext, countryCode: string) => [...compassQueryKeys.countryDetails(context), countryCode] as const,
  countryImage: (context: WorkspaceContext, imageRequestToken: string) => [...compassQueryKeys.all(context), "country-image", imageRequestToken] as const,
  placeChildren: (context: WorkspaceContext, childrenRequestToken: string) => [...compassQueryKeys.all(context), "place-children", childrenRequestToken] as const,
  cityDetails: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "city-details"] as const,
  cityDetail: (context: WorkspaceContext, countryCode: string, city: string) => [...compassQueryKeys.cityDetails(context), countryCode, city.trim().toLocaleLowerCase()] as const,
  cityImage: (context: WorkspaceContext, countryCode: string, city: string, imageRequestToken: string) => [...compassQueryKeys.all(context), "city-image", countryCode, city.trim().toLocaleLowerCase(), imageRequestToken] as const,
};
