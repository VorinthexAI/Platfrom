import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { recordContentSearchHistory, type ContentContext } from "@/lib/content-client";
import { reconcileCachedUserSearchHistory } from "@/lib/user-search-history-cache";

export function useDebouncedContentSearchHistory({ context, enabled, query, settledQuery, search }: {
  context: ContentContext;
  enabled: boolean;
  query: string;
  settledQuery: string;
  search: { data?: { query: string }; isFetching: boolean; isSuccess: boolean };
}) {
  const queryClient = useQueryClient();
  const sequence = useRef(0);
  const submitted = useRef(0);
  const [intent, setIntent] = useState<{ query: string; sequence: number }>();
  const trimmed = query.trim();

  useEffect(() => {
    const current = ++sequence.current;
    if (!enabled || !trimmed) return;
    const timeout = setTimeout(() => setIntent({ query: trimmed, sequence: current }), 800);
    return () => clearTimeout(timeout);
  }, [context.scopeKey, context.userKey, enabled, trimmed]);

  useEffect(() => {
    if (!enabled || !intent || intent.sequence !== sequence.current || intent.sequence === submitted.current || intent.query !== trimmed || intent.query !== settledQuery || !search.isSuccess || search.isFetching || search.data?.query !== intent.query) return;
    submitted.current = intent.sequence;
    void recordContentSearchHistory(intent.query, context).then((item) => reconcileCachedUserSearchHistory(queryClient, context, item)).catch(() => undefined);
  }, [context, enabled, intent, queryClient, search.data?.query, search.isFetching, search.isSuccess, settledQuery, trimmed]);
}
