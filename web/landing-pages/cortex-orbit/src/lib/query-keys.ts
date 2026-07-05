// Central query-key registry. Keeping every TanStack Query key in one place
// prevents ad-hoc key shapes drifting across features as they're added.

export const queryKeys = {
  session: () => ["auth", "session"] as const,
};
