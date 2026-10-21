import { useEffect, useRef } from 'react';
import { useToastAndConfirm } from './ToastAndConfirm';

/** Every dismissal route uses the same guard; a pending save is never hidden. */
export function useDialogCloseGuard(isOpen: boolean, dirty: boolean, busy: boolean, onClose: () => void) {
  const { askConfirm } = useToastAndConfirm();
  const latest = useRef({ isOpen, dirty, busy, onClose, askConfirm, generation: 0 });
  if (isOpen !== latest.current.isOpen) latest.current.generation++;
  Object.assign(latest.current, { isOpen, dirty, busy, onClose, askConfirm });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const handlerGeneration = latest.current.generation;
  return () => {
    const current = latest.current;
    if (!mounted.current || !current.isOpen || current.busy || current.generation !== handlerGeneration) return;
    if (!current.dirty) { current.onClose(); return; }
    const generation = current.generation;
    current.askConfirm({ title: 'تعديلات غير محفوظة', message: 'لم تُحفظ تعديلات هذه النافذة. يمكنك متابعة التعديل أو إغلاقها دون حفظ.',
      confirmLabel: 'إغلاق دون حفظ', cancelLabel: 'متابعة التعديل', tone: 'warning',
      onConfirm: () => {
        const value = latest.current;
        if (!mounted.current || !value.isOpen || value.generation !== generation) return;
        if (value.busy) throw Error('انتظر نتيجة العملية الجارية أولًا؛ النافذة لم تُغلق.');
        value.onClose();
      } });
  };
}

export function useDialogDraftClose(isOpen: boolean, busy: boolean, onClose: () => void, values: unknown) {
  const snapshot = JSON.stringify(values);
  const baseline = useRef({ open: false, value: snapshot });
  if (isOpen && !baseline.current.open) baseline.current.value = snapshot;
  baseline.current.open = isOpen;
  return useDialogCloseGuard(isOpen, isOpen && snapshot !== baseline.current.value, busy, onClose);
}
