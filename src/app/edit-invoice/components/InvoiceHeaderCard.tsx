import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText as FileTextIconLucide, Edit, Save } from "lucide-react"; // Assuming FileTextIconLucide is FileText

interface InvoiceHeaderCardProps {
  originalFileName: string;
  docType: "deliveryNote" | "invoice" | "paymentReceipt" | null;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export function InvoiceHeaderCard({
  originalFileName,
  docType,
  t,
}: InvoiceHeaderCardProps) {
  const title = originalFileName || t("edit_invoice_unknown_document");
  const description =
    docType === "deliveryNote"
      ? t("edit_invoice_delivery_note_details_title")
      : docType === "invoice"
      ? t("edit_invoice_invoice_details_title")
      : docType === "paymentReceipt"
      ? t("edit_invoice_payment_receipt_details_title")
      : t("edit_invoice_title");

  return (
    <Card className="shadow-md overflow-hidden">
      {" "}
      {/* Removed scale-fade-in here, apply on parent if needed */}
      <CardHeader className="flex flex-row items-start sm:items-center justify-between gap-2 bg-muted/30 p-4">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
            <FileTextIconLucide className="mr-2 h-5 w-5 flex-shrink-0" />
            <span className="truncate" title={title}>
              {title}
            </span>
          </CardTitle>
          <CardDescription className="break-words mt-1 text-xs sm:text-sm">
            {description}
          </CardDescription>
        </div>
      </CardHeader>
      {/* CardContent will be provided by the parent component that uses this header */}
    </Card>
  );
}
