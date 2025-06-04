import React from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ArrowLeft, Edit, X } from "lucide-react";
import type { DialogFlowStep } from "../types"; // Assuming DialogFlowStep is in types

interface PageActionButtonsProps {
  isSaving: boolean;
  isViewMode: boolean;
  setIsViewMode: React.Dispatch<React.SetStateAction<boolean>>;
  isNewScan: boolean;
  handleSaveAll: () => void;
  handleCancelEdit: () => void;
  onGoBack: () => void;
  docType: "deliveryNote" | "invoice" | "paymentReceipt" | null;
  t: (key: string) => string;
}

export function PageActionButtons({
  isSaving,
  isViewMode,
  setIsViewMode,
  isNewScan,
  handleSaveAll,
  handleCancelEdit,
  onGoBack,
  docType,
  t,
}: PageActionButtonsProps) {
  let primaryButton;
  let secondaryButton;

  if (isNewScan) {
    // Scenario 1: New Scan
    primaryButton = (
      <Button
        onClick={handleSaveAll}
        disabled={isSaving}
        className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
      >
        {isSaving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("saving")}...
          </>
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />{" "}
            {t("edit_invoice_confirm_and_save_button")}
          </>
        )}
      </Button>
    );
    secondaryButton = (
      <Button
        variant="outline"
        onClick={onGoBack} // This is "Discard & Go Back" for new scan
        className="w-full sm:w-auto order-last sm:order-first"
        disabled={isSaving}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />{" "}
        {t("edit_invoice_discard_scan_button")}
      </Button>
    );
  } else {
    // Scenario 2 or 3: Existing Document
    if (isViewMode) {
      // Scenario 2: Existing Document, View Mode
      primaryButton = (
        <Button
          onClick={() => setIsViewMode(false)}
          disabled={isSaving} // Should generally not be saving in view mode
          className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
        >
          <Edit className="mr-2 h-4 w-4" /> {t("edit_button")}
        </Button>
      );
      const backToText =
        docType === "invoice"
          ? t("edit_invoice_go_back_to_invoices_button")
          : // TODO: Add key for receipts if needed, like "edit_invoice_go_back_to_receipts_button"
          docType === "paymentReceipt"
          ? t("edit_invoice_go_back_to_documents_button") // Fallback or define specific key
          : t("product_detail_back_to_inventory_button");
      secondaryButton = (
        <Button
          variant="outline"
          onClick={onGoBack} // "Back to Documents"
          className="w-full sm:w-auto order-last sm:order-first"
          disabled={isSaving}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> {backToText}
        </Button>
      );
    } else {
      // Scenario 3: Existing Document, Edit Mode
      primaryButton = (
        <Button
          onClick={handleSaveAll}
          disabled={isSaving}
          className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("saving")}...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />{" "}
              {t("edit_invoice_save_all_changes_button")}
            </>
          )}
        </Button>
      );
      secondaryButton = (
        <Button
          variant="outline"
          onClick={handleCancelEdit} // "Discard Changes"
          className="w-full sm:w-auto order-last sm:order-first"
          disabled={isSaving}
        >
          <X className="mr-2 h-4 w-4" />{" "}
          {t("edit_invoice_discard_changes_button")}
        </Button>
      );
    }
  }

  return (
    <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
      {secondaryButton}
      <div className="flex-grow flex flex-col sm:flex-row sm:justify-end gap-3">
        {primaryButton}
      </div>
    </div>
  );
}
