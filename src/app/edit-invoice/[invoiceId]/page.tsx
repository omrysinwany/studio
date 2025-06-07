// src/app/edit-invoice/page.tsx
import React, { Suspense } from "react";
import EditInvoiceContent from "../EditInvoiceContent"; // או EditInvoiceContent, תלוי בשם הקובץ/קומפוננטה
import { Loader2 } from "lucide-react";
// import { useTranslation } from '@/hooks/useTranslation'; // אם צריך לתרגום ב-fallback

export default function Page() {
  // <-- זה השם המקובל לקומפוננטה הראשית של הנתיב
  // const { t } = useTranslation(); // אם צריך
  return (
    <Suspense
      fallback={
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          {/* <span className="ml-2">{t('loading_editor')}...</span> */}
          <span className="ml-2">טוען עורך...</span> {/* טקסט לדוגמה */}
        </div>
      }
    >
      <EditInvoiceContent />
    </Suspense>
  );
}
