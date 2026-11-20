import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class FirebaseErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || 'حدث خطأ غير متوقع في الاتصال بقاعدة البيانات السحابية',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('[FirebaseErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.errorMessage;
      try {
        const parsed = JSON.parse(this.state.errorMessage) as { error?: string; operationType?: string; path?: string };
        if (parsed?.error) {
          friendly = `تعذر تنفيذ عملية (${parsed.operationType || 'write'}) على المسار (${parsed.path || '-'}): ${parsed.error}`;
        }
      } catch {
        // keep plain string
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
          <div className="max-w-lg w-full bg-white rounded-2xl border border-rose-200 shadow-lg p-6 text-right space-y-4">
            <div className="flex items-center gap-3 text-rose-700">
              <AlertTriangle className="w-7 h-7 shrink-0" />
              <h2 className="text-lg font-extrabold">تنبيه من قاعدة البيانات السحابية</h2>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed break-words">{friendly}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة تحميل لوحة التحكم
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
