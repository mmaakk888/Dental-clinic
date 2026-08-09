import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Trash2, RotateCcw, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  undoFn?: () => void;
  duration?: number;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
}

interface ToastAndConfirmContextType {
  showToast: (message: string, type?: ToastType, options?: { undoFn?: () => void; duration?: number }) => void;
  askConfirm: (options: ConfirmOptions) => void;
  validationFail: (modalId: string, fieldId: string, message: string) => void;
}

const ToastAndConfirmContext = createContext<ToastAndConfirmContextType | null>(null);

export function useToastAndConfirm() {
  const ctx = useContext(ToastAndConfirmContext);
  if (!ctx) {
    throw new Error('useToastAndConfirm must be used within ToastAndConfirmProvider');
  }
  return ctx;
}

export const ToastAndConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);

  const showToast = useCallback((
    message: string,
    type: ToastType = 'success',
    options?: { undoFn?: () => void; duration?: number }
  ) => {
    const id = Math.random().toString(36).substring(2, 9);
    const duration = options?.duration ?? (options?.undoFn ? 6000 : 3500);

    const newToast: ToastItem = {
      id,
      message,
      type,
      undoFn: options?.undoFn,
      duration
    };

    setToasts(prev => [...prev, newToast]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const askConfirm = useCallback((options: ConfirmOptions) => {
    setConfirmState(options);
  }, []);

  const validationFail = useCallback((modalId: string, fieldId: string, message: string) => {
    showToast(message, 'error');

    // Highlight input field
    const inputEl = document.getElementById(fieldId);
    if (inputEl) {
      inputEl.classList.add('border-red-500', 'ring-2', 'ring-red-200');
      inputEl.focus();
      const removeHighlight = () => {
        inputEl.classList.remove('border-red-500', 'ring-2', 'ring-red-200');
        inputEl.removeEventListener('input', removeHighlight);
      };
      inputEl.addEventListener('input', removeHighlight);
    }

    // Shake modal container
    const modalEl = document.getElementById(modalId);
    if (modalEl) {
      modalEl.classList.remove('animate-shake');
      // Trigger reflow
      void modalEl.offsetWidth;
      modalEl.classList.add('animate-shake');
      setTimeout(() => {
        modalEl.classList.remove('animate-shake');
      }, 500);
    }
  }, [showToast]);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <ToastAndConfirmContext.Provider value={{ showToast, askConfirm, validationFail }}>
      {children}

      {/* Toast Stack */}
      <div id="toastStack" className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2.5 max-w-md w-full px-4 pointer-events-none">
        {toasts.map(toast => {
          let bg = 'bg-[#0f3d3e] text-white border-[#c9a227]/40';
          let icon = <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />;

          if (toast.type === 'error') {
            bg = 'bg-[#8b4049] text-white border-red-300/40';
            icon = <XCircle className="w-5 h-5 text-red-200 shrink-0" />;
          } else if (toast.type === 'warning') {
            bg = 'bg-[#c9a227] text-slate-950 font-medium border-amber-300';
            icon = <AlertTriangle className="w-5 h-5 text-slate-950 shrink-0" />;
          }

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl shadow-xl border text-sm transition-all duration-300 transform translate-y-0 ${bg}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {icon}
                <span className="truncate">{toast.message}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {toast.undoFn && (
                  <button
                    onClick={() => {
                      toast.undoFn?.();
                      removeToast(toast.id);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-bold transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    تراجع
                  </button>
                )}
                <button
                  onClick={() => removeToast(toast.id)}
                  className="p-1 rounded-md hover:bg-black/10 transition-colors opacity-70 hover:opacity-100"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirm Modal */}
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-xl shrink-0 ${
                confirmState.tone === 'danger'
                  ? 'bg-red-100 text-red-600'
                  : confirmState.tone === 'warning'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-teal-100 text-teal-800'
              }`}>
                {confirmState.tone === 'danger' ? (
                  <Trash2 className="w-6 h-6" />
                ) : confirmState.tone === 'warning' ? (
                  <AlertTriangle className="w-6 h-6" />
                ) : (
                  <AlertCircle className="w-6 h-6" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900 font-tajawal">
                  {confirmState.title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {confirmState.message}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                {confirmState.cancelLabel || 'إلغاء'}
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmState.onConfirm();
                  setConfirmState(null);
                }}
                className={`px-5 py-2 rounded-xl text-sm font-bold text-white shadow-md transition-all cursor-pointer ${
                  confirmState.tone === 'danger'
                    ? 'bg-red-600 hover:bg-red-700 shadow-red-600/20'
                    : confirmState.tone === 'warning'
                    ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                    : 'bg-[#0f3d3e] hover:bg-[#1b5e5a] shadow-teal-900/20'
                }`}
              >
                {confirmState.confirmLabel || 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastAndConfirmContext.Provider>
  );
};
