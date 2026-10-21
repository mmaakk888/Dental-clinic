/** A confirmation authorizes only the open draft that produced it. */
export function createAppointmentDraftGuard() {
  let open = false;
  let context = '';
  let revision = 0;
  return {
    update(nextOpen: boolean, nextContext: string) {
      if (open !== nextOpen || context !== nextContext) revision++;
      open = nextOpen;
      context = nextContext;
    },
    invalidate() { revision++; },
    capture() {
      const capturedRevision = revision;
      return () => open && revision === capturedRevision;
    },
  };
}
