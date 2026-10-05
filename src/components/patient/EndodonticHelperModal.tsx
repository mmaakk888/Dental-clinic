import React, { useState } from 'react';
import { Camera, Sparkles, Check, AlertCircle, X, Trash2, Image as ImageIcon, Ruler } from 'lucide-react';
import { AiService, EndodonticAnalysis } from '../../services/aiService';
import { useToastAndConfirm } from '../common/ToastAndConfirm';

interface EndodonticHelperModalProps {
  isOpen: boolean;
  onClose: () => void;
  toothNumber: string;
  patientName: string;
  onSaveWorkingLength: (data: EndodonticAnalysis & { imagePreview?: string }) => void;
}

export const EndodonticHelperModal: React.FC<EndodonticHelperModalProps> = ({
  isOpen,
  onClose,
  toothNumber,
  patientName,
  onSaveWorkingLength,
}) => {
  const { showToast } = useToastAndConfirm();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<EndodonticAnalysis | null>(null);

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setSelectedImage(base64);
        runAiAnalysis(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const runAiAnalysis = async (base64Img: string) => {
    setIsAnalyzing(true);
    setAnalysis(null);
    try {
      const result = await AiService.analyzeEndoWorkingLength(base64Img, toothNumber);
      setAnalysis(result);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحليل الصورة.', 'error');
    } finally { setIsAnalyzing(false); }
  };

  const handleSave = () => {
    if (analysis) {
      onSaveWorkingLength({
        ...analysis,
        imagePreview: selectedImage || undefined,
      });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-cyan-950 via-teal-900 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-300">
              <Ruler className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">مساعد علاج الجذور (Working Length AI)</h3>
              <p className="text-xs text-teal-200/80">
                قياس طول العمل وحساب القنوات للسن رقم #{toothNumber} للمريض {patientName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Upload Area */}
          {!selectedImage ? (
            <div className="border-2 border-dashed border-teal-200 hover:border-teal-400 bg-teal-50/40 rounded-2xl p-6 text-center transition cursor-pointer relative">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImageUpload}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <div className="w-12 h-12 mx-auto bg-teal-100 text-teal-700 rounded-full flex items-center justify-center mb-3">
                <Camera className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">التقاط أشعة الذروة / قياس طول العمل بكاميرا الجوال</h4>
              <p className="text-xs text-slate-500 mt-1">اضغط لالتقاط الصورة مباشرة أو اختيار ملف من المعرض</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 max-h-52 flex items-center justify-center">
                <img src={selectedImage} alt="Endo Working Length" className="object-contain max-h-52" />
                <button
                  onClick={() => {
                    setSelectedImage(null);
                    setAnalysis(null);
                  }}
                  className="absolute top-2 left-2 bg-rose-600/90 text-white p-1.5 rounded-lg text-xs flex items-center gap-1 hover:bg-rose-700 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>إعادة التقاط</span>
                </button>
              </div>

              {/* AI Loading State */}
              {isAnalyzing && (
                <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 flex items-center gap-3 animate-pulse">
                  <Sparkles className="w-6 h-6 text-teal-600 animate-spin" />
                  <div>
                    <h5 className="text-sm font-bold text-teal-900">جاري الكشف التلقائي عن أطوال الجذور...</h5>
                    <p className="text-xs text-teal-700">Gemini AI يحسب القنوات والحد الذروي بالأشعة</p>
                  </div>
                </div>
              )}

              {/* AI Results */}
              {analysis && !isAnalyzing && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="text-xs font-bold text-teal-700 flex items-center gap-1">
                      <Sparkles className="w-4 h-4" /> نتائج تحليل الذكاء الاصطناعي
                    </span>
                    <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md font-medium">
                      التنظيف التلقائي مفعل (Auto-Cleanup)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {analysis.canals?.map((canal, idx) => (
                      <div key={idx} className="bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">{canal.name}</span>
                        <div className="text-left">
                          <span className="text-sm font-extrabold text-teal-700">{canal.estimatedLengthMm} mm</span>
                          <span className="block text-[10px] text-slate-400">دقة: {canal.confidence}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                    <strong>ملاحظة حد الذروة:</strong> {analysis.apicalLimitNote}
                  </div>

                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">
                    {analysis.recommendation}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 rounded-xl transition"
          >
            إلغاء وإغلاق
          </button>
          {analysis && (
            <button
              onClick={handleSave}
              className="px-5 py-2 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-md transition flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>اعتماد الأطوال وحفظ الجلسة</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

