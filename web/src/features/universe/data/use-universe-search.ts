"use client";

// neural-map.md §34.4 — debounced fuzzy node search, backing the floating
// island's Universe command bar (§6.5/§8.3) and the `useUniverseSearch`
// export other agents' `universe-command-bar.tsx` imports (cross-agent
// contract).

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchUniverseSearch } from "./universe-api";

const DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

export function useUniverseSearch(query: string) {
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  return useQuery({
    queryKey: queryKeys.universeSearch(debounced),
    queryFn: () => fetchUniverseSearch(debounced),
    enabled: debounced.trim().length >= MIN_QUERY_LENGTH,
    // Keep showing the last result set while the next debounced query
    // resolves, rather than flashing empty between keystrokes.
    placeholderData: (prev) => prev,
  });
}
