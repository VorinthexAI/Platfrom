"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { isRetryableError } from "@/lib/is-retryable-error";

type ProvidersProps = {
  children: ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // A background universe tile refetch on tab-focus would be
            // jarring mid-exploration; the realtime feed (neural-map.md
            // §11.4) is the actual freshness mechanism instead.
            refetchOnWindowFocus: false,
            retry: (failureCount, error) =>
              isRetryableError(error) && failureCount < 2,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
