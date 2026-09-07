import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AppState } from "react-native";
import { z } from "zod";

import { apiClient } from "./api-client";
import { useAuthStore } from "@/state/auth";

const HEARTBEAT_INTERVAL_MS = 15_000;
const joinResponseSchema = z.strictObject({ ok: z.literal(true), session_key: z.string().min(8), visitor_key: z.string().min(1), alias: z.string().min(1) });

export function PresenceBridge() {
  const status = useAuthStore((state) => state.status);
  const sessionKey = useRef<string | undefined>(undefined);
  const heartbeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const joining = useRef(false);
  const lifecycleGeneration = useRef(0);
  const mounted = useRef(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const leave = useEffectEvent(async () => {
    lifecycleGeneration.current += 1;
    if (heartbeat.current) clearInterval(heartbeat.current);
    heartbeat.current = undefined;
    const key = sessionKey.current;
    sessionKey.current = undefined;
    if (key) await apiClient.post("/presence/leave", { session_key: key, source: "mobile" }).catch(() => undefined);
  });

  const join = useEffectEvent(async () => {
    if (status !== "authenticated" || AppState.currentState !== "active" || sessionKey.current || joining.current) return;
    joining.current = true;
    const generation = lifecycleGeneration.current;
    try {
      const response = await apiClient.post("/presence/join", { source: "mobile" });
      const joined = joinResponseSchema.parse(response.data);
      if (generation !== lifecycleGeneration.current || useAuthStore.getState().status !== "authenticated" || AppState.currentState !== "active") {
        await apiClient.post("/presence/leave", { session_key: joined.session_key, source: "mobile" }).catch(() => undefined);
        if (mounted.current && useAuthStore.getState().status === "authenticated" && AppState.currentState === "active") setRetry((value) => value + 1);
        return;
      }
      sessionKey.current = joined.session_key;
      heartbeat.current = setInterval(() => {
        const key = sessionKey.current;
        if (!key) return;
        void apiClient.post("/presence/beat", { session_key: key, source: "mobile", position: [0, 6.5, 15.5] }).catch(async () => {
          await leave();
          setRetry((value) => value + 1);
        });
      }, HEARTBEAT_INTERVAL_MS);
    } finally {
      joining.current = false;
    }
  });

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    if (status === "authenticated") void join().catch(() => { retryTimer = setTimeout(() => setRetry((value) => value + 1), 5_000); });
    else void leave();
    const subscription = AppState.addEventListener("change", (state) => { void (state === "active" ? join() : leave()).catch(() => { if (state === "active") setRetry((value) => value + 1); }); });
    return () => { if (retryTimer) clearTimeout(retryTimer); subscription.remove(); void leave(); };
  }, [retry, status]);

  return null;
}
