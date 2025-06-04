"use client";

import React from "react";

export const InvoiceDetailsSkeleton = () => {
  return (
    <div className="border rounded-lg shadow-sm p-6 space-y-4 animate-pulse bg-white">
      {/* Header Skeleton */}
      <div className="h-6 bg-slate-200 rounded w-3/5 mb-4"></div>

      {/* Detail Line Skeletons */}
      <div className="space-y-3">
        <div className="flex justify-between">
          <div className="h-4 bg-slate-200 rounded w-1/4"></div>
          <div className="h-4 bg-slate-200 rounded w-2/3"></div>
        </div>
        <div className="flex justify-between">
          <div className="h-4 bg-slate-200 rounded w-1/3"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        </div>
        <div className="flex justify-between">
          <div className="h-4 bg-slate-200 rounded w-1/5"></div>
          <div className="h-4 bg-slate-200 rounded w-3/4"></div>
        </div>
        <div className="flex justify-between">
          <div className="h-4 bg-slate-200 rounded w-1/4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        </div>
      </div>

      {/* Separator */}
      <div className="pt-3">
        <div className="h-px bg-slate-200 w-full"></div>
      </div>

      {/* More Detail Line Skeletons */}
      <div className="space-y-3 pt-1">
        <div className="flex justify-between">
          <div className="h-4 bg-slate-200 rounded w-1/3"></div>
          <div className="h-4 bg-slate-200 rounded w-2/5"></div>
        </div>
        <div className="flex justify-between">
          <div className="h-4 bg-slate-200 rounded w-1/4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        </div>
      </div>
    </div>
  );
};

// EditInvoiceContent.tsx uses named import: import { InvoiceDetailsSkeleton } ...
// So, keeping it as a named export.
