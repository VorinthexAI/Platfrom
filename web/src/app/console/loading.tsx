// neural-map.md §5.1 — shell-level skeleton. Rare in practice: most loading
// is handled inside the chat/universe panels themselves (§22.1, §22.2), this
// only covers the brief window before ConsoleShell itself has streamed in
// (e.g. while `verifySession()` is resolving).

import { Spinner } from "@vorinthex/shared/ui";

export default function ConsoleLoading() {
  return (
    <div className="vx-console-loading" data-console-theme="dark">
      <Spinner />
    </div>
  );
}
