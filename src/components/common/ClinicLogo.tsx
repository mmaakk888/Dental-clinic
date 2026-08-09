import React from 'react';

interface ClinicLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'header' | 'print';
  layout?: 'horizontal' | 'vertical' | 'icon-only';
  variant?: 'dark' | 'light';
  showText?: boolean;
  className?: string;
  customLogoUrl?: string | null;
}

export const ClinicLogo: React.FC<ClinicLogoProps> = ({
  size = 'md',
  layout = 'horizontal',
  variant = 'dark',
  showText = true,
  className = '',
  customLogoUrl
}) => {
  // Size dimensions
  const sizes = {
    sm: { icon: 'w-7 h-7', title: 'text-xs', sub: 'text-[9px]', gap: 'gap-1.5' },
    md: { icon: 'w-10 h-10', title: 'text-sm sm:text-base', sub: 'text-[10px]', gap: 'gap-2.5' },
    lg: { icon: 'w-14 h-14', title: 'text-xl', sub: 'text-xs', gap: 'gap-3' },
    xl: { icon: 'w-20 h-20', title: 'text-2xl sm:text-3xl', sub: 'text-sm', gap: 'gap-4' },
    header: { icon: 'w-10 h-10', title: 'text-sm sm:text-base', sub: 'text-[10px]', gap: 'gap-2.5' },
    print: { icon: 'w-16 h-16', title: 'text-2xl font-black', sub: 'text-xs', gap: 'gap-3.5' }
  };

  const selectedSize = sizes[size] || sizes.md;

  // Text color based on variant
  const textColor = variant === 'light' ? 'text-white' : 'text-slate-900';
  const dotColor = '#d97706'; // Gold/orange dot
  const blueColor = variant === 'light' ? '#60a5fa' : '#1e40af';
  const goldColor = '#d97706';

  // If a custom image logo URL is provided and valid, render high quality image
  if (customLogoUrl && customLogoUrl.trim() !== '') {
    return (
      <div className={`flex items-center ${layout === 'vertical' ? 'flex-col text-center' : 'flex-row'} ${selectedSize.gap} ${className}`}>
        <img
          src={customLogoUrl}
          alt="Clinic Logo"
          referrerPolicy="no-referrer"
          className={`${selectedSize.icon} object-contain rounded-2xl p-1 bg-white shadow-xs border border-slate-200/80 shrink-0`}
        />
        {showText && layout !== 'icon-only' && (
          <div className="flex flex-col text-right leading-none font-tajawal dir-ltr">
            <div className={`font-black ${selectedSize.title} ${textColor} tracking-tight flex items-center gap-1 font-mono uppercase dir-ltr`}>
              <span className="text-[#1e40af] font-black">
                DR<span style={{ color: dotColor }}>.</span>
              </span>
              <span className="text-[#0f3d3e] font-black">
                MOHAMED
              </span>
              <span className="text-[#1e40af] font-black">
                OSAMA
              </span>
            </div>
            <span className={`font-semibold ${selectedSize.sub} text-slate-500 mt-1 dir-rtl text-right`}>
              عيادة طب وجراحة الأسنان
            </span>
          </div>
        )}
      </div>
    );
  }

  // Vector High-Definition HD Logo Graphic SVG
  return (
    <div className={`flex items-center ${layout === 'vertical' ? 'flex-col text-center' : 'flex-row'} ${selectedSize.gap} ${className}`}>
      {/* High Quality Vector Tooth Logo Mark */}
      <div className={`${selectedSize.icon} shrink-0 relative flex items-center justify-center p-1 bg-white rounded-2xl border border-slate-200/80 shadow-xs group-hover:shadow-md transition-shadow`}>
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Blue Outer Stylized Tooth Outline */}
          <path
            d="M 22,25 C 20,10 40,12 50,22 C 60,12 80,10 78,25 C 75,45 82,75 70,88 C 62,95 55,80 50,70 C 45,80 38,95 30,88 C 18,75 25,45 22,25 Z"
            stroke={blueColor}
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />

          {/* Gold Inner Stylized M & Crown Accent */}
          <path
            d="M 33,35 C 38,20 48,15 50,30 C 52,15 62,20 67,35 C 60,50 50,60 50,75 C 50,60 40,50 33,35 Z"
            stroke={goldColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />

          {/* Golden Center M Line */}
          <path
            d="M 36,40 L 50,68 L 64,40"
            stroke={goldColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Accent Gold Dot */}
          <circle cx="50" cy="20" r="4" fill={goldColor} />
        </svg>
      </div>

      {/* Typography "DR. MOHAMED OSAMA" */}
      {showText && layout !== 'icon-only' && (
        <div className="flex flex-col leading-none font-tajawal text-right">
          <div className={`font-black ${selectedSize.title} ${textColor} tracking-tight flex items-center gap-1 font-mono uppercase dir-ltr`}>
            <span className="text-[#1e40af] font-black">
              DR<span style={{ color: dotColor }}>.</span>
            </span>
            <span className="text-[#0f3d3e] font-black">
              MOHAMED
            </span>
            <span className="text-[#1e40af] font-black">
              OSAMA
            </span>
          </div>
          <span className={`font-bold ${selectedSize.sub} text-amber-800/90 mt-1 flex items-center gap-1 dir-rtl justify-end`}>
            <span>عيادة طب وجراحة الأسنان</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
          </span>
        </div>
      )}
    </div>
  );
};
