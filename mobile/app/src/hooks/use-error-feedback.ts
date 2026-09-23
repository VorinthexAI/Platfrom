import { useEffect, useRef } from "react";
import { useSessionToast } from "./use-session-toast";
import { sessionIsEnding } from "@/lib/session-lifecycle";
import { extractDomainErrorMessage, isRequestCancellation, isSparkFundingError } from "@/lib/domain-error-observer";

const recentlyPresented = new Map<string, number>();

/** Present new failures once, without persistent inline panels or render-time toasts. */
export function useErrorFeedback(errors: readonly unknown[]) {
  const previous = useRef(new Set<string>());
  const { notices, showToast } = useSessionToast();
  useEffect(() => {
    if (sessionIsEnding()) { previous.current.clear(); return; }
    const messages = new Set(errors.flatMap((error) => {
      if (!error || isRequestCancellation(error) || isSparkFundingError(typeof error === "string" ? { message: error } : error)) return [];
      const message = typeof error === "string" ? error : extractDomainErrorMessage(error);
      // Some existing screen states contain only the transport error's message.
      if (!message || /^(CancelledError|CanceledError|canceled|cancelled|The operation was aborted\.?|This operation was aborted\.?)$/i.test(message)) return [];
      return [message];
    }));
    for (const title of messages) {
      const now = Date.now();
      for (const [message, at] of recentlyPresented) if (now - at > 2_500) recentlyPresented.delete(message);
      if (!previous.current.has(title) && !recentlyPresented.has(title) && !notices.some((notice) => notice.title === title)) {
        recentlyPresented.set(title, now);
        showToast({ title, duration: 2_500 });
      }
    }
    previous.current = messages;
  }, [errors, notices, showToast]);
}
