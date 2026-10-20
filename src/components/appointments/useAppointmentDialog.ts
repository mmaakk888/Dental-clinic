import { useEffect, useRef } from 'react';
import { bindDialogBackdrop, isTopDialog, lockDialogScroll } from '../../utils/dialogLifecycle';

export function useAppointmentDialog(isOpen: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const releaseScroll = lockDialogScroll(document.body);
    const releaseBackdrop = dialogRef.current ? bindDialogBackdrop(dialogRef.current, () => onCloseRef.current()) : () => {};
    const getControls = () => (Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    ) || []) as HTMLElement[]).filter(element => !element.matches(':disabled') && element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => {
      const initial = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]');
      (initial || getControls()[0] || dialogRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!dialogRef.current || !isTopDialog(dialogRef.current)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
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
      releaseBackdrop(); releaseScroll();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [isOpen]);

  return dialogRef;
}
