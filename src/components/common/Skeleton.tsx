import React from 'react';

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 5 }) => {
  return (
    <>
      {Array.from({ length: rows }).map((_, rIdx) => (
        <tr key={rIdx} className="border-b border-slate-100 animate-pulse">
          {Array.from({ length: cols }).map((_, cIdx) => (
            <td key={cIdx} className="p-4">
              <div className="h-4 bg-slate-200/70 rounded-md w-full"></div>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
};

export const CardSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm animate-pulse space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-5 bg-slate-200 rounded-md w-1/3"></div>
            <div className="h-8 w-8 bg-slate-200 rounded-full"></div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-slate-100 rounded-md w-full"></div>
            <div className="h-4 bg-slate-100 rounded-md w-2/3"></div>
          </div>
          <div className="h-10 bg-slate-200/60 rounded-xl w-full pt-2"></div>
        </div>
      ))}
    </div>
  );
};
