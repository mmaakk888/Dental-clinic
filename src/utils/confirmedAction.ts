/** One outstanding save; success/reset happens only after durable confirmation. */
export function createConfirmedActionExecutor(onBusyChange: (busy: boolean) => void, onError: (error: unknown) => void) {
  let busy = false;
  return async (action: () => void | Promise<void>, onSuccess?: () => void): Promise<boolean> => {
    if (busy) return false;
    busy = true;
    onBusyChange(true);
    try {
      await action();
      onSuccess?.();
      return true;
    } catch (error) { onError(error); return false; }
    finally { busy = false; onBusyChange(false); }
  };
}
