"use client";

import React, { ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  initiallyOpen?: boolean;
  isLoading?: boolean; // Added isLoading prop as it seems to be used in EditInvoiceContent
  // className?: string; // Optional additional className for the wrapper
  // Future: onOpenChange?: (isOpen: boolean) => void;
}

export const CollapsibleSection = ({
  title,
  children,
  initiallyOpen = true, // Default to open
  isLoading = false,
}: // className = '',
CollapsibleSectionProps) => {
  // This is a placeholder. A real implementation would use state for isOpen
  // and conditional rendering for children. For now, it always shows children.
  // The isLoading prop is available for future use (e.g., showing a spinner in the header).

  return (
    <div className={`border rounded-md mb-4 shadow-sm`}>
      <div className="bg-slate-50 p-3 border-b rounded-t-md">
        <h3 className="font-semibold text-md text-slate-700">
          {title}
          {isLoading && (
            <span className="text-slate-500 font-normal"> (Loading...)</span>
          )}
        </h3>
      </div>
      {/* Content is always rendered for this basic placeholder */}
      <div className="p-4 bg-white rounded-b-md">{children}</div>
    </div>
  );
};

// To make it a default export if it's typically used that way
// export default CollapsibleSection;
// However, EditInvoiceContent.tsx uses named import: import { CollapsibleSection } ...
// So, keeping it as a named export.
