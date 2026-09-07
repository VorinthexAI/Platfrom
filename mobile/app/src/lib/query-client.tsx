import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { AuthenticatedEventBridge } from "./event-bridge";
import { PushNotificationBridge } from "./push-notifications";
import { PresenceBridge } from "./presence";
import { listScopes, scopeListQueryKey } from "./scope-client";
import { useAuthStore } from "@/state/auth";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}><AuthenticatedEventBridge /><PresenceBridge /><PushNotificationBridge /><ScopeBootstrap />{children}</QueryClientProvider>;
}

function ScopeBootstrap() {
  const status = useAuthStore((state) => state.status);
  const userKey = useAuthStore((state) => String(state.user?.key ?? ""));
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  useQuery({
    queryKey: scopeListQueryKey(userKey, teamKey),
    queryFn: ({ signal }) => listScopes(teamKey, signal),
    enabled: status === "authenticated" && Boolean(userKey && teamKey),
  });
  return null;
}
