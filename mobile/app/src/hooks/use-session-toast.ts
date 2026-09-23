import { useToast } from "@vorinthex/shared/ui/toast";
import { useCallback } from "react";
import { sessionEpoch, sessionIsCurrent } from "@/lib/session-lifecycle";

/** Async callbacks from an ended session must not notify a subsequent screen. */
export function useSessionToast() {
  const toast = useToast();
  const owner = sessionEpoch();
  const present = toast.showToast;
  const showToast = useCallback((notice: Parameters<typeof present>[0]) => sessionIsCurrent(owner) && notice.title ? present(notice) : -1, [owner, present]);
  return { ...toast, showToast };
}
