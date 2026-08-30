export function createCoalescedRefresh(refresh: () => Promise<void>, isActive: () => boolean = () => true) {
  let pending = false;
  let running: Promise<void> | undefined;

  return function trigger() {
    pending = true;
    if (!running) {
      running = (async () => {
        while (pending && isActive()) {
          pending = false;
          await refresh();
        }
      })().finally(() => {
        running = undefined;
        if (pending && isActive()) void trigger();
      });
    }
    return running;
  };
}
