import { useEffect, useRef } from 'react';

export function useAppointmentDialog(isOpen: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const getControls = () => (Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    ) || []) as HTMLElement[]).filter(element => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => {
      const initial = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]');
      (initial || getControls()[0] || dialogRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
      const topDialog = dialogs.filter(element => element.getClientRects().length > 0).at(-1);
      if (topDialog && topDialog !== dialogRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = getControls();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  return dialogRef;
}
