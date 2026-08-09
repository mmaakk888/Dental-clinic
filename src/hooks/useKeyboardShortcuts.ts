import { useEffect } from 'react';

interface KeyboardShortcutsOptions {
  onNewPatient?: () => void;
  onGlobalSearch?: () => void;
  onCollectPayment?: () => void;
  onNewAppointment?: () => void;
  onPrint?: () => void;
  onSave?: () => void;
  onEscape?: () => void;
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing inside an input/textarea and presses simple keys, but intercept F-keys & Ctrl shortcuts
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // F1: New Patient
      if (e.key === 'F1') {
        e.preventDefault();
        options.onNewPatient?.();
        return;
      }

      // F2 or Ctrl+K: Global Search
      if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        options.onGlobalSearch?.();
        return;
      }

      // F3: Collect Payment
      if (e.key === 'F3') {
        e.preventDefault();
        options.onCollectPayment?.();
        return;
      }

      // Ctrl + N: New Appointment
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        options.onNewAppointment?.();
        return;
      }

      // Ctrl + S: Save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        options.onSave?.();
        return;
      }

      // Ctrl + P: Print
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (options.onPrint) {
          options.onPrint();
        } else {
          window.print();
        }
        return;
      }

      // Esc: Close Modal / Search
      if (e.key === 'Escape') {
        options.onEscape?.();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [options]);
}
