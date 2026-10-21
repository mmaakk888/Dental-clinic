import { useEffect, useRef } from 'react';
import type { ProtectedWhatsAppAction, ProtectedWhatsAppActions } from '../utils/whatsappSafety';
/** First click freshly checks the cloud. The second stays synchronous for
 * Safari's native share/window gesture. No redesigned composer or local DB. */
export function useProtectedWhatsAppAction(actions: ProtectedWhatsAppActions | undefined, notice: (message: string) => void) {
  const latest = useRef({ actions, notice }); latest.current = { actions, notice };
  const busy = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return (input: ProtectedWhatsAppAction) => {
    const captured = latest.current.actions; if (!captured) throw Error('تعذر التحقق من إعدادات الرسالة.');
    const output = captured.consume(input); if (output) return output;
    if (!busy.current) { busy.current = true;
      void captured.prepare(input).then(() => { if (active.current && latest.current.actions === captured) latest.current.notice('تم التحقق. اضغط نفس زر الفتح أو المشاركة مرة أخرى خلال ٣٠ ثانية.'); })
        .catch(() => { if (active.current && latest.current.actions === captured) latest.current.notice('تعذر التحقق أو تغيّرت بيانات الرسالة؛ حدّث البيانات وراجع المستلم والقالب.'); })
        .finally(() => { busy.current = false; });
    }
    throw Error('جارٍ التحقق من أحدث البيانات قبل فتح واتساب…');
  };
}
