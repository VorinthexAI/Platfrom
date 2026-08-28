import { publicBookShareAccessSchema, publicBookShareReadRequestSchema } from "./books-client";
import { publicApiHeaders, publicApiUrl } from "./public-api-client";
import { consumeServerSentEvents, parseServerSentEvent } from "./sse";

export function subscribePublicBookShareAccess(token: string, onAccess: (status: "active" | "inactive") => void) {
  const safeToken = publicBookShareReadRequestSchema.shape.token.parse(token);
  let stopped = false;
  let request: XMLHttpRequest | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (stopped) return;
    request = new XMLHttpRequest();
    let processed = 0;
    let buffer = "";
    const processAvailable = () => {
      const available = request!.responseText.slice(processed);
      processed = request!.responseText.length;
      buffer = consumeServerSentEvents(buffer + available, (event) => {
        if (event.event !== "access") return;
        const status = publicBookShareAccessSchema.parse(JSON.parse(event.data)).status;
        onAccess(status);
        if (status === "inactive") stopped = true;
      });
    };
    const reconnect = () => {
      if (!stopped) retry = setTimeout(connect, 1_000);
    };
    request.open("GET", publicApiUrl(`/public/books/shares/stream?token=${encodeURIComponent(safeToken)}`), true);
    for (const [name, value] of Object.entries(publicApiHeaders())) request.setRequestHeader(name, value);
    request.onprogress = processAvailable;
    request.onerror = reconnect;
    request.onabort = () => undefined;
    request.onload = () => {
      processAvailable();
      const finalEvent = parseServerSentEvent(buffer);
      if (finalEvent?.event === "access") {
        const status = publicBookShareAccessSchema.parse(JSON.parse(finalEvent.data)).status;
        onAccess(status);
        if (status === "inactive") stopped = true;
      }
      reconnect();
    };
    request.send();
  };

  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    request?.abort();
  };
}
