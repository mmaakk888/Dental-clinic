import React from 'react';

export const ViewSkeleton: React.FC = () => {
  return (
    <div className="w-full space-y-4 p-3 sm:p-6 animate-pulse dir-rtl">
      {/* Header bar skeleton */}
      <div className="h-16 bg-slate-200/80 rounded-2xl w-full" />

      {/* Top metrics / quick stats skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="h-24 bg-slate-200/80 rounded-2xl" />
        <div className="h-24 bg-slate-200/80 rounded-2xl" />
        <div className="h-24 bg-slate-200/80 rounded-2xl" />
        <div className="h-24 bg-slate-200/80 rounded-2xl" />
      </div>

      {/* Main content list / table skeleton */}
      <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-3">
        <div className="h-6 bg-slate-200/80 rounded-lg w-1/3" />
        <div className="h-12 bg-slate-100 rounded-xl w-full" />
        <div className="h-12 bg-slate-100 rounded-xl w-full" />
        <div className="h-12 bg-slate-100 rounded-xl w-full" />
        <div className="h-12 bg-slate-100 rounded-xl w-full" />
      </div>
    </div>
  );
};

