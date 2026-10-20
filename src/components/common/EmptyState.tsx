import React from 'react';
import { FolderOpen } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode | React.ComponentType<{ className?: string }>;
  message?: string;
  title?: string;
  description?: string;
  ctaLabel?: string;
  actionLabel?: string;
  onCtaClick?: () => void;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  message,
  title,
  description,
  ctaLabel,
  actionLabel,
  onCtaClick,
  onAction
}) => {
  const displayMessage = message || title || 'لا توجد بيانات للعرض';
  const displayCta = ctaLabel || actionLabel;
  const displayHandler = onCtaClick || onAction;

  const renderIcon = () => {
    if (!icon) return <FolderOpen className="w-8 h-8 opacity-80" />;

    if (React.isValidElement(icon)) {
      return icon;
    }

    if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null)) {
      const IconComp = icon as React.ComponentType<{ className?: string }>;
      return <IconComp className="w-8 h-8 opacity-80" />;
    }

    return <FolderOpen className="w-8 h-8 opacity-80" />;
  };

  return (
    <div className="clinic-empty-state flex flex-col items-center justify-center py-12 px-4 text-center bg-white/60 border border-dashed border-slate-300 rounded-2xl my-4">
      <div className="clinic-empty-icon w-16 h-16 rounded-2xl flex items-center justify-center mb-4">
        {renderIcon()}
      </div>
      <h3 className="text-lg font-bold text-slate-800 font-tajawal mb-1">
        {displayMessage}
      </h3>
      {description && (
        <p className="text-sm text-slate-500 max-w-md mb-5 leading-relaxed">
          {description}
        </p>
      )}
      {displayCta && displayHandler && (
        <button
          onClick={displayHandler}
          type="button"
          className="clinic-empty-action"
        >
          {displayCta}
        </button>
      )}
    </div>
  );
};


