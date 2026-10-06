import { useMemo, useState } from 'react';
import { useToastAndConfirm } from './ToastAndConfirm';
import { createConfirmedActionExecutor } from '../../utils/confirmedAction';

/** Never close/reset a financial draft or report success until storage confirms. */
export function useConfirmedAction() {
  const { showToast } = useToastAndConfirm();
  const [saving, setSaving] = useState(false);
  const run = useMemo(() => createConfirmedActionExecutor(setSaving, error => {
      showToast(error instanceof Error ? error.message : 'تعذّر الحفظ. البيانات لم تتغيّر؛ راجع المسودة وحاول مرة أخرى.', 'error', { duration: 12000 });
  }), [showToast]);
  return { saving, run };
}
