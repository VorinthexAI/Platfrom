export type WorkspaceContext = { organizationKey: string; scopeKey: string };

const contextKey = (context: WorkspaceContext) => [context.organizationKey, context.scopeKey] as const;

export const compassQueryKeys = {
  all: (context: WorkspaceContext) => ["compass", ...contextKey(context)] as const,
  overview: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "overview"] as const,
  trips: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "trips"] as const,
  countryDetails: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "country-details"] as const,
  countryDetail: (context: WorkspaceContext, countryCode: string) => [...compassQueryKeys.countryDetails(context), countryCode] as const,
  countryImage: (context: WorkspaceContext, imageRequestToken: string) => [...compassQueryKeys.all(context), "country-image", imageRequestToken] as const,
  placeChildren: (context: WorkspaceContext, childrenRequestToken: string) => [...compassQueryKeys.all(context), "place-children", childrenRequestToken] as const,
  cityDetails: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "city-details"] as const,
  cityDetail: (context: WorkspaceContext, countryCode: string, city: string) => [...compassQueryKeys.cityDetails(context), countryCode, city.trim().toLocaleLowerCase()] as const,
  cityImage: (context: WorkspaceContext, countryCode: string, city: string, imageRequestToken: string) => [...compassQueryKeys.all(context), "city-image", countryCode, city.trim().toLocaleLowerCase(), imageRequestToken] as const,
};
