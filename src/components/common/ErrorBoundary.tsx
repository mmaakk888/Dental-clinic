import React, { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public props: Props;
  public state: State = {
    hasError: false
  };

  constructor(props: Props) {
    super(props);
    this.props = props;
  }

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch() {
    // Provider/render errors can contain record or credential details. Keep
    // those out of both the fallback UI and normal browser diagnostics.
    console.error('The clinic interface could not be displayed. No save confirmation is implied.');
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-tajawal text-right dir-rtl">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-200 text-center space-y-5">
            <div className="w-16 h-16 rounded-3xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto shadow-sm">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black text-slate-900">حدث خطأ مفاجئ في النظام</h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                تعذر إكمال العرض. إذا كنت تُجري عملية حفظ، تحقق من سجلها قبل إعادة المحاولة؛ هذه الرسالة لا تؤكد نجاح الحفظ.
              </p>
            </div>

            <button
              onClick={this.handleReload}
              className="w-full py-3.5 px-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة تشغيل العيادة الآن
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

