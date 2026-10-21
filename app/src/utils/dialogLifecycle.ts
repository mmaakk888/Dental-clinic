/** One dismissal/focus policy for framed dialogs, including nested overlays. */
const scrollLocks = new WeakMap<HTMLElement, { count: number; overflow: string }>();
export function lockDialogScroll(body: HTMLElement): () => void {
  const state = scrollLocks.get(body) ?? { count: 0, overflow: body.style.overflow };
  state.count++; scrollLocks.set(body, state); body.style.overflow = 'hidden';
  let released = false;
  return () => { if (released) return; released = true; if (--state.count === 0) { body.style.overflow = state.overflow; scrollLocks.delete(body); } };
}

export function isTopDialog(panel: HTMLElement): boolean {
  const doc = panel.ownerDocument;
  const dialogs = Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open]'))
    .filter(element => element.getClientRects().length > 0);
  const native = dialogs.filter(element => element.tagName === 'DIALOG' && element.hasAttribute('open'));
  if (native.length) return native.at(-1) === panel;
  const layer = (element: HTMLElement) => {
    let value = 0;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const z = Number.parseInt(doc.defaultView?.getComputedStyle(node).zIndex ?? '', 10);
      if (Number.isFinite(z)) value = Math.max(value, z);
    }
    return value;
  };
  return dialogs.map((element, order) => ({ element, order, layer: layer(element) }))
    .sort((a, b) => a.layer - b.layer || a.order - b.order).at(-1)?.element === panel;
}

/** Outside means a primary-pointer gesture started AND ended on this backdrop.
 * Capturing the click consumes old bubbling handlers, so one gesture dismisses
 * only the top dialog once. Dragging out of a field must never discard a draft. */
export function bindDialogBackdrop(panel: HTMLElement, dismiss: () => void): () => void {
  const overlay = panel.parentElement?.closest<HTMLElement>('.clinic-modal-overlay');
  if (!overlay) return () => {};
  let startedOutside = false;
  const down = (event: PointerEvent) => { startedOutside = event.button === 0 && event.isPrimary !== false && event.target === overlay && isTopDialog(panel); };
  const cancel = () => { startedOutside = false; };
  const click = (event: MouseEvent) => {
    if (event.target !== overlay || !isTopDialog(panel)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const shouldClose = startedOutside && event.button === 0; startedOutside = false;
    if (shouldClose) dismiss();
  };
  overlay.addEventListener('pointerdown', down, true);
  overlay.addEventListener('pointercancel', cancel, true);
  overlay.addEventListener('click', click, true);
  return () => { overlay.removeEventListener('pointerdown', down, true); overlay.removeEventListener('pointercancel', cancel, true); overlay.removeEventListener('click', click, true); };
}
