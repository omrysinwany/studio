// src/app/edit-invoice/EditInvoiceContent.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "@/hooks/useTranslation";
import { Timestamp } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAnalytics } from "@/contexts/AnalyticsContext";

import {
  Loader2,
  AlertCircle,
  Edit,
  Save,
  PackageIcon,
  Info as InfoIcon,
  FileText as FileTextIconLucide,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle as AlertTitleComponent,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

// Hooks
import { useInvoiceLoader } from "./hooks/useInvoiceLoader";
import { useInvoiceStateManager } from "./hooks/useInvoiceStateManager";
import { useDialogFlow } from "./hooks/useDialogFlow";
import { useInvoiceSaver } from "./hooks/useInvoiceSaver";
import { useProductHandlers } from "./hooks/useProductHandlers";

// Components
import { InvoiceHeaderCard } from "./components/InvoiceHeaderCard";
import { InvoiceImagePreview } from "./components/InvoiceImagePreview";
import { InvoiceDetailsForm } from "./components/InvoiceDetailsForm";
import { InvoiceDetailsView } from "./components/InvoiceDetailsView";
import { ProductsTable } from "./components/ProductsTable";
import { PageActionButtons } from "./components/PageActionButtons";
import { ManualEntryPrompt } from "./components/ManualEntryPrompt";
import { InvoiceDetailsSkeleton } from "./components/InvoiceDetailsSkeleton";

// Dialog Components
import BarcodePromptDialog from "@/components/barcode-prompt-dialog";
import UnitPriceConfirmationDialog from "@/components/unit-price-confirmation-dialog";
import SupplierPaymentSheet from "@/components/supplier-payment-sheet";

import type {
  EditableProduct,
  EditableTaxInvoiceDetails,
  InvoiceHistoryItem,
} from "./types";
import type { DueDateOption } from "@/components/supplier-payment-sheet";
import type { InvoiceHistoryItem as BackendInvoiceHistoryItem } from "@/services/types";
import { DialogFlowStep } from "./types";

export default function EditInvoiceContent() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation();

  const docType = useMemo(
    () =>
      searchParams.get("docType") as
        | "deliveryNote"
        | "invoice"
        | "paymentReceipt"
        | null,
    [searchParams]
  );

  const loader = useInvoiceLoader({});
  const {
    initialProducts,
    initialTaxDetails: initialTaxDetailsFromLoader,
    originalFileName,
    displayedOriginalImageUrl,
    displayedCompressedImageUrl,
    isNewScan: isNewScanFromLoader,
    isViewModeInitially,
    isLoading: dataIsLoading,
    dataError,
    scanProcessErrorFromLoad,
    initialTempInvoiceId,
    initialInvoiceIdParam,
    cleanupTemporaryData,
    aiScannedSupplierNameFromStorage,
    aiScannedOsekMorsheFromStorage,
    initialDataLoaded,
  } = loader;

  const [currentOriginalFileName, setCurrentOriginalFileName] =
    useState(originalFileName);
  const [
    currentDisplayedOriginalImageUrl,
    setCurrentDisplayedOriginalImageUrl,
  ] = useState(displayedOriginalImageUrl);
  const [
    currentDisplayedCompressedImageUrl,
    setCurrentDisplayedCompressedImageUrl,
  ] = useState(displayedCompressedImageUrl);

  const [initialTaxDetailsForDialog, setInitialTaxDetailsForDialog] =
    useState<EditableTaxInvoiceDetails>(initialTaxDetailsFromLoader);

  useEffect(() => {
    setInitialTaxDetailsForDialog(initialTaxDetailsFromLoader);
  }, [initialTaxDetailsFromLoader]);

  useEffect(() => {
    setCurrentOriginalFileName(originalFileName);
  }, [originalFileName]);
  useEffect(() => {
    setCurrentDisplayedOriginalImageUrl(displayedOriginalImageUrl);
  }, [displayedOriginalImageUrl]);
  useEffect(() => {
    setCurrentDisplayedCompressedImageUrl(displayedCompressedImageUrl);
  }, [displayedCompressedImageUrl]);

  const stateManager = useInvoiceStateManager({
    initialProducts,
    initialTaxDetails: initialTaxDetailsFromLoader,
    isViewModeInitially,
    t,
  });
  const {
    products,
    setProducts,
    editableTaxInvoiceDetails,
    setEditableTaxInvoiceDetails,
    handleInputChange,
    handleTaxInvoiceDetailsChange,
    isViewMode,
    setIsViewMode,
    productsForNextStep,
    setProductsForNextStep,
    scanProcessError: generalScanErrorState,
    setScanProcessError,
    handleCancelEdit,
  } = stateManager;

  // Define callbacks with useCallback before passing to useDialogFlow
  const onSupplierChangeInMainForm = useCallback(
    (name: string | null) => {
      console.log(
        "[EditInvoiceContent] onSupplierChangeInMainForm called with:",
        name
      );
      setEditableTaxInvoiceDetails((prev) => ({
        ...prev,
        supplierName: name || undefined,
      }));
    },
    [setEditableTaxInvoiceDetails]
  );

  const onPaymentDetailsChangeInMainForm = useCallback(
    (date: Date | undefined, option: DueDateOption | null) => {
      console.log(
        "[EditInvoiceContent] onPaymentDetailsChangeInMainForm called with:",
        date,
        option
      );
      setEditableTaxInvoiceDetails((prev) => ({
        ...prev,
        paymentDueDate: date,
        // If 'option' (paymentTermOption) should also be stored in editableTaxInvoiceDetails,
        // it should be updated here as well. For now, only paymentDueDate is updated based on the existing logic.
      }));
    },
    [setEditableTaxInvoiceDetails]
  );

  const onProductsUpdatedFromDialog = useCallback(
    (updatedProducts: EditableProduct[] | null) => {
      if (updatedProducts) {
        setProducts(updatedProducts);
        setProductsForNextStep(updatedProducts);
      }
    },
    [setProducts, setProductsForNextStep]
  );

  const onDialogError = useCallback(
    (errorMessage: string) => {
      setScanProcessError(errorMessage);
    },
    [setScanProcessError]
  );

  const productHandlers = useProductHandlers({
    setProducts,
    setProductsForNextStep,
    t,
    user,
  });

  const dialogFlow = useDialogFlow({
    isNewScan: isNewScanFromLoader,
    user,
    docType,
    productsForNextStep,
    initialScannedTaxDetails: initialTaxDetailsForDialog,
    aiScannedSupplierNameFromStorage,
    aiScannedOsekMorsheFromStorage,
    currentInvoiceDate: editableTaxInvoiceDetails.invoiceDate,
    onSupplierChangeInMainForm,
    onPaymentDetailsChangeInMainForm,
    onProductsUpdatedFromDialog,
    onDialogError,
    t,
  });

  const saver = useInvoiceSaver({
    user,
    docType,
    productsToSave:
      productsForNextStep.length > 0 ? productsForNextStep : products,
    taxDetailsToSave: editableTaxInvoiceDetails,
    initialRawScanResultJsonFromLoader:
      initialTaxDetailsFromLoader?.rawScanResultJson,
    originalFileName: currentOriginalFileName,
    initialTempInvoiceId,
    initialInvoiceIdParam,
    displayedOriginalImageUrl: currentDisplayedOriginalImageUrl,
    displayedCompressedImageUrl: currentDisplayedCompressedImageUrl,
    isNewScan: isNewScanFromLoader,
    finalizedSupplierName: dialogFlow.finalizedSupplierName,
    finalizedPaymentDueDate: dialogFlow.finalizedPaymentDueDate,
    finalizedPaymentTermOption: dialogFlow.finalizedPaymentTermOption,
    cleanupTemporaryData: cleanupTemporaryData as (tempId?: string) => void,
    t,
    onSaveSuccess: (savedInvoice: BackendInvoiceHistoryItem) => {
      setIsViewMode(true);
      setProducts(
        (savedInvoice as any).products?.map(
          (p: any) => ({ ...p, _originalId: p.id } as EditableProduct)
        ) || []
      );
      setEditableTaxInvoiceDetails((prev) => ({
        ...prev,
        supplierName: savedInvoice.supplierName,
        invoiceNumber: savedInvoice.invoiceNumber,
        totalAmount: savedInvoice.totalAmount,
        invoiceDate: savedInvoice.invoiceDate as
          | string
          | Date
          | Timestamp
          | null,
        paymentMethod: savedInvoice.paymentMethod,
        paymentDueDate: savedInvoice.paymentDate as
          | string
          | Date
          | Timestamp
          | null,
        rawScanResultJson: savedInvoice.rawScanResultJson,
        paymentTerms: (savedInvoice as any).paymentTerms,
      }));
      setCurrentOriginalFileName(
        savedInvoice.generatedFileName || savedInvoice.originalFileName
      );
      setCurrentDisplayedOriginalImageUrl(
        savedInvoice.originalImagePreviewUri || null
      );
      setCurrentDisplayedCompressedImageUrl(
        savedInvoice.compressedImageForFinalRecordUri || null
      );
      setScanProcessError(savedInvoice.errorMessage || null);
      dialogFlow.resetDialogFlow();

      setTimeout(() => {
        if (docType === "deliveryNote") router.push("/inventory?refresh=true");
        else if (docType === "invoice" || docType === "paymentReceipt")
          router.push("/invoices?tab=scanned-docs&refresh=true");
      }, 100);
    },
    onSaveError: (errorMsg) => {
      setScanProcessError(errorMsg);
    },
  });

  useEffect(() => {
    if (!authLoading && !user && initialDataLoaded) {
      router.push("/login");
    }
  }, [user, authLoading, router, initialDataLoaded]);

  useEffect(() => {
    if (
      initialDataLoaded &&
      !dataIsLoading &&
      isNewScanFromLoader &&
      user &&
      dialogFlow.currentDialogStep === "idle"
    ) {
      dialogFlow.startInitialDialogFlow();
    }
  }, [
    initialDataLoaded,
    dataIsLoading,
    isNewScanFromLoader,
    user,
    dialogFlow.currentDialogStep,
  ]);

  const handleGoBack = () => {
    if (isNewScanFromLoader && initialTempInvoiceId) {
      cleanupTemporaryData(initialTempInvoiceId);
    }
    router.back();
  };

  const handleRescanClick = () => {
    if (initialTempInvoiceId) {
      cleanupTemporaryData(initialTempInvoiceId);
    }
    router.push(`/upload?docType=${docType || "invoice"}`);
  };

  const handleSaveInitiation = () => {
    console.log(
      "[EditInvoiceContent] Save button clicked. Calling saver.handleFullSave."
    );
    saver.handleFullSave();
  };

  if (authLoading || (dataIsLoading && !initialDataLoaded)) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg">{t("loading_invoice_data")}</p>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="container mx-auto p-4 flex flex-col items-center">
        <Alert variant="destructive" className="w-full max-w-lg mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitleComponent>{t("error_title")}</AlertTitleComponent>
          <AlertDescription>{dataError}</AlertDescription>
        </Alert>
        <Button onClick={handleGoBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> {t("go_back_button")}
        </Button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p>{t("redirecting_to_login")}</p>
      </div>
    );
  }

  const effectiveScanError =
    scanProcessErrorFromLoad ||
    generalScanErrorState ||
    dialogFlow.dialogFlowError ||
    saver.saveError;

  return (
    <div className="container mx-auto px-2 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8 max-w-7xl">
      <Button
        variant="ghost"
        onClick={handleGoBack}
        className="absolute top-2 left-2 sm:top-4 sm:left-4 z-20 h-9 w-9 p-0"
        aria-label={t("go_back_button")}
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <PageActionButtons
        isSaving={saver.isSaving}
        isViewMode={isViewMode}
        setIsViewMode={setIsViewMode}
        isNewScan={isNewScanFromLoader}
        handleSaveAll={saver.handleFullSave}
        handleCancelEdit={handleCancelEdit}
        onGoBack={handleGoBack}
        docType={docType}
        t={t}
      />

      {isNewScanFromLoader && !isViewMode && (
        <Card className="mb-4 bg-blue-50 border-blue-200 shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-start">
              <RefreshCw className="h-5 w-5 mr-3 mt-1 text-blue-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-700">
                  {t("edit_invoice_rescan_info_title")}
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  {t("edit_invoice_rescan_info_description")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {effectiveScanError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitleComponent>
            {t("scan_process_error_title")}
          </AlertTitleComponent>
          <AlertDescription>{effectiveScanError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-6 mt-4 md:mt-6">
        {/* פרטי החשבונית וכותרת הקובץ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <InvoiceHeaderCard
            originalFileName={currentOriginalFileName || t("unknown_file_name")}
            docType={docType}
            t={t}
          />
          {isViewMode ? (
            <InvoiceDetailsView
              detailsToDisplay={editableTaxInvoiceDetails}
              t={t}
            />
          ) : (
            <InvoiceDetailsForm
              editableTaxInvoiceDetails={editableTaxInvoiceDetails}
              handleTaxInvoiceDetailsChange={handleTaxInvoiceDetailsChange}
              isSaving={saver.isSaving}
              t={t}
            />
          )}
        </div>

        {/* טבלת המוצרים */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <PackageIcon className="mr-2 h-5 w-5" />
              {docType === "deliveryNote"
                ? t("delivery_note_products_title")
                : t("invoice_products_title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ProductsTable
              products={products}
              handleInputChange={stateManager.handleInputChange}
              onRemoveRow={productHandlers.handleRemoveRow}
              onAddRow={productHandlers.handleAddRow}
              isEditing={!isViewMode}
              isSaving={saver.isSaving}
              t={t}
            />
          </CardContent>
        </Card>

        {/* תצוגת התמונה הסרוקה - בתחתית הדף */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <FileTextIconLucide className="mr-2 h-5 w-5" />
              {t("edit_invoice_image_preview_title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceImagePreview
              displayedOriginalImageUrl={currentDisplayedOriginalImageUrl}
              displayedCompressedImageUrl={currentDisplayedCompressedImageUrl}
              t={t}
            />
          </CardContent>
        </Card>
      </div>

      {dialogFlow.currentDialogStep === "supplier_payment_details" &&
        dialogFlow.supplierPaymentSheetProps && (
          <SupplierPaymentSheet
            isOpen={true}
            onOpenChange={(isOpen) => {
              if (!isOpen && dialogFlow.isDialogFlowActive) {
                dialogFlow.supplierPaymentSheetProps?.onCancel();
              }
            }}
            {...dialogFlow.supplierPaymentSheetProps}
            t={t}
          />
        )}

      {dialogFlow.currentDialogStep === "new_product_details" &&
        dialogFlow.newProductDetailsDialogProps && (
          <BarcodePromptDialog
            isOpen={true}
            onOpenChange={(_openState) => {
              if (!_openState && dialogFlow.isDialogFlowActive) {
                dialogFlow.newProductDetailsDialogProps?.onComplete(null);
              }
            }}
            {...dialogFlow.newProductDetailsDialogProps}
          />
        )}

      {saver.priceDiscrepanciesForDialog &&
        saver.productsForPriceDiscrepancyDialog && (
          <UnitPriceConfirmationDialog
            isOpen={!!saver.priceDiscrepanciesForDialog}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                saver.resolvePriceDiscrepancies(null);
              }
            }}
            discrepancies={saver.productsForPriceDiscrepancyDialog.map((p) => ({
              ...p,
              id: p.id,
              shortName: p.description?.substring(0, 50),
              catalogNumber: p.catalogNumber || "",
              existingUnitPrice: p.unitPrice || 0,
              newUnitPrice: p.salePrice ?? p.unitPrice ?? 0,
              description: p.description || "",
            }))}
            onComplete={(resolvedProducts: EditableProduct[] | null) =>
              saver.resolvePriceDiscrepancies(resolvedProducts)
            }
          />
        )}

      {dialogFlow.currentDialogStep === "ready_to_save" &&
        !isViewMode &&
        isNewScanFromLoader &&
        docType !== "deliveryNote" &&
        products.length === 0 && (
          <ManualEntryPrompt
            originalFileName={
              currentOriginalFileName || t("edit_invoice_unknown_document")
            }
            docType={docType}
            scanProcessErrorState={effectiveScanError}
            productsCount={products.length}
            t={t}
          />
        )}
    </div>
  );
}
