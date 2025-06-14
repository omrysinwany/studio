import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@/contexts/AuthContext";
import type {
  EditableProduct,
  EditableTaxInvoiceDetails,
  DueDateOption,
} from "../types";
import {
  checkProductPricesBeforeSaveService,
  finalizeSaveProductsService,
  syncProductsWithCaspitService,
  archiveDocumentService,
  updateInvoicePaymentStatusService,
} from "@/services/backend";
import { Timestamp } from "firebase/firestore";
import { isValid, parseISO, format } from "date-fns";
import { he as heLocale, enUS as enUSLocale } from "date-fns/locale";
import type {
  Product as BackendProduct,
  InvoiceHistoryItem as BackendInvoiceHistoryItem,
  ProductPriceDiscrepancy,
} from "@/services/types";
import { useTranslation } from "@/hooks/useTranslation";
import { useDialogFlow } from "./useDialogFlow";

interface UseInvoiceSaverProps {
  user: User | null;
  docType: "deliveryNote" | "invoice" | "paymentReceipt" | null;
  productsToSave: EditableProduct[];
  taxDetailsToSave: EditableTaxInvoiceDetails;
  initialRawScanResultJsonFromLoader: string | null | undefined;
  originalFileName: string | null;
  initialTempInvoiceId: string | null;
  initialInvoiceIdParam: string | null;
  displayedOriginalImageUrl?: string | null;
  displayedCompressedImageUrl?: string | null;
  isNewScan: boolean;
  finalizedSupplierName: string | null | undefined;
  finalizedPaymentDueDate: Date | undefined;
  finalizedPaymentTermOption: DueDateOption | null;
  cleanupTemporaryData: (tempId?: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  onSaveSuccess: (savedInvoice: BackendInvoiceHistoryItem) => void;
  onSaveError: (errorMsg: string) => void;
}

export interface UseInvoiceSaverReturn {
  isSaving: boolean;
  saveError: string | null;
  handleFullSave: () => Promise<void>;
  priceDiscrepanciesForDialog: ProductPriceDiscrepancy[] | null;
  productsForPriceDiscrepancyDialog: EditableProduct[] | null;
  resolvePriceDiscrepancies: (
    resolvedProducts: EditableProduct[] | null
  ) => void;
  clearPriceDiscrepancies: () => void;
  handleMarkAsPaid: () => Promise<void>;
  handleArchiveDocument: () => Promise<void>;
  isArchiving: boolean;
  isMarkingAsPaid: boolean;
}

function getPaymentTermStringForDocumentPersistence(
  termOption: DueDateOption | null,
  dueDate: Date | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): string | undefined {
  if (!termOption) return undefined;
  switch (termOption) {
    case "immediate":
    case "net30":
    case "net60":
    case "eom":
      return t(`payment_terms_option_${termOption}`);
    case "custom":
      return dueDate
        ? format(dueDate, "PP", {
            locale:
              t("locale_code_for_date_fns") === "he" ? heLocale : enUSLocale,
          })
        : t("payment_terms_option_custom_fallback");
    default:
      console.warn(
        "[useInvoiceSaver] Unexpected paymentTermOption value in helper:",
        termOption
      );
      return typeof termOption === "string"
        ? termOption
        : t("payment_terms_option_unknown");
  }
}

export function useInvoiceSaver({
  user,
  docType,
  productsToSave,
  taxDetailsToSave,
  initialRawScanResultJsonFromLoader,
  originalFileName: initialOriginalFileName,
  initialTempInvoiceId,
  initialInvoiceIdParam,
  displayedOriginalImageUrl,
  displayedCompressedImageUrl,
  isNewScan,
  finalizedSupplierName,
  finalizedPaymentDueDate,
  finalizedPaymentTermOption,
  cleanupTemporaryData,
  t,
  onSaveSuccess,
  onSaveError,
}: UseInvoiceSaverProps): UseInvoiceSaverReturn {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const [priceDiscrepanciesForDialog, setPriceDiscrepanciesForDialog] =
    useState<ProductPriceDiscrepancy[] | null>(null);
  const [
    productsForPriceDiscrepancyDialog,
    setProductsForPriceDiscrepancyDialog,
  ] = useState<EditableProduct[] | null>(null);

  const [isArchiving, setIsArchiving] = useState(false);
  const [isMarkingAsPaid, setIsMarkingAsPaid] = useState(false);

  const proceedWithFinalSave = useCallback(
    async (finalProductsToSave: EditableProduct[]) => {
      if (!user?.id || !docType) {
        const err = t("edit_invoice_user_not_authenticated_desc");
        setSaveError(err);
        onSaveError(err);
        return;
      }
      setIsSaving(true);
      setSaveError(null);

      try {
        const productsForService = finalProductsToSave.map(
          ({ _originalId, ...rest }) => {
            const backendProduct: Partial<BackendProduct> = { ...rest };
            if (
              rest.salePrice !== undefined &&
              !isNaN(Number(rest.salePrice))
            ) {
              backendProduct.salePrice =
                Number(rest.salePrice) > 0 ? Number(rest.salePrice) : null;
            } else {
              backendProduct.salePrice = null;
            }
            backendProduct.barcode = rest.barcode || null;
            if (
              rest.id &&
              !rest.id.startsWith("prod-temp-") &&
              !rest.id.startsWith("scan-temp-")
            ) {
              backendProduct.id = rest.id;
            } else {
              delete backendProduct.id;
            }
            return backendProduct as BackendProduct;
          }
        );

        let finalFileNameForSave = initialOriginalFileName;

        const finalSupplierNameForSave = finalizedSupplierName;
        const finalInvoiceNumberForSave = taxDetailsToSave.invoiceNumber;
        let finalTotalAmountForSave = taxDetailsToSave.totalAmount;

        if (
          docType === "deliveryNote" &&
          productsForService.length > 0 &&
          (finalTotalAmountForSave === null ||
            finalTotalAmountForSave === 0 ||
            finalTotalAmountForSave === undefined)
        ) {
          finalTotalAmountForSave = productsForService.reduce(
            (sum, p) => sum + (p.lineTotal || 0),
            0
          );
        }

        let finalInvoiceDateForSave: Date | Timestamp | string | null = null;
        if (taxDetailsToSave.invoiceDate instanceof Timestamp) {
          finalInvoiceDateForSave = taxDetailsToSave.invoiceDate;
        } else if (typeof taxDetailsToSave.invoiceDate === "string") {
          const parsed = parseISO(taxDetailsToSave.invoiceDate);
          if (isValid(parsed))
            finalInvoiceDateForSave = Timestamp.fromDate(parsed);
          else finalInvoiceDateForSave = taxDetailsToSave.invoiceDate;
        } else if (
          taxDetailsToSave.invoiceDate instanceof Date &&
          isValid(taxDetailsToSave.invoiceDate)
        ) {
          finalInvoiceDateForSave = Timestamp.fromDate(
            taxDetailsToSave.invoiceDate
          );
        }

        let paymentDueDateForDoc: Date | Timestamp | string | null = null;
        if (finalizedPaymentDueDate) {
          paymentDueDateForDoc = Timestamp.fromDate(finalizedPaymentDueDate);
        }

        const paymentTermStringForDocument =
          getPaymentTermStringForDocumentPersistence(
            finalizedPaymentTermOption,
            finalizedPaymentDueDate,
            t
          );

        const rawScanResultJsonForSave = initialRawScanResultJsonFromLoader;

        const { finalInvoiceRecord, savedOrUpdatedProducts } =
          await finalizeSaveProductsService(
            productsForService,
            initialOriginalFileName || "Unnamed Document",
            docType,
            user.id,
            initialTempInvoiceId || initialInvoiceIdParam,
            finalInvoiceNumberForSave,
            finalSupplierNameForSave,
            finalTotalAmountForSave,
            paymentDueDateForDoc,
            finalInvoiceDateForSave,
            taxDetailsToSave.paymentMethod,
            displayedOriginalImageUrl,
            displayedCompressedImageUrl,
            rawScanResultJsonForSave,
            paymentTermStringForDocument
          );

        // --- Sync with Caspit in the background ---
        if (savedOrUpdatedProducts.length > 0) {
          syncProductsWithCaspitService(savedOrUpdatedProducts, user.id).catch(
            (e) => {
              console.error("Background Caspit sync failed:", e);
              // Optional: You could show a non-blocking toast notification here
            }
          );
        }

        toast({
          title: t("edit_invoice_toast_save_success_title"),
          description: t("edit_invoice_toast_save_success_desc", {
            fileName:
              finalInvoiceRecord.originalFileName ||
              finalInvoiceRecord.generatedFileName ||
              "Document",
          }),
        });
        if (isNewScan && initialTempInvoiceId) {
          cleanupTemporaryData(initialTempInvoiceId);
        }
        onSaveSuccess(finalInvoiceRecord);
      } catch (error: any) {
        console.error(
          "[useInvoiceSaver] Error in proceedWithFinalSave:",
          error
        );
        const errorMsg =
          error.message || t("edit_invoice_toast_error_saving_desc_default");
        setSaveError(errorMsg);
        onSaveError(errorMsg);
        toast({
          title: t("edit_invoice_toast_error_saving_title"),
          description: errorMsg,
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    },
    [
      user?.id,
      docType,
      initialOriginalFileName,
      initialTempInvoiceId,
      initialInvoiceIdParam,
      displayedOriginalImageUrl,
      displayedCompressedImageUrl,
      isNewScan,
      finalizedSupplierName,
      finalizedPaymentDueDate,
      finalizedPaymentTermOption,
      taxDetailsToSave,
      initialRawScanResultJsonFromLoader,
      cleanupTemporaryData,
      t,
      onSaveSuccess,
      onSaveError,
      toast,
    ]
  );

  const handleFullSave = useCallback(async () => {
    setSaveError(null);
    if (!user?.id) {
      const err = t("edit_invoice_user_not_authenticated_desc");
      setSaveError(err);
      onSaveError(err);
      return;
    }
    if (!docType) {
      const err = t("edit_invoice_error_no_doctype");
      setSaveError(err);
      onSaveError(err);
      return;
    }
    if (productsToSave.length === 0 && docType === "deliveryNote") {
      toast({
        title: t("edit_invoice_toast_error_no_products_title"),
        description: t("edit_invoice_toast_error_no_products_desc"),
        variant: "destructive",
      });
      return;
    }

    if (docType === "deliveryNote") {
      try {
        setIsSaving(true);
        const result = await checkProductPricesBeforeSaveService(
          productsToSave.map((p) => ({ ...p, userId: user.id })),
          user.id
        );
        setIsSaving(false);

        if (result.priceDiscrepancies.length > 0) {
          setPriceDiscrepanciesForDialog(result.priceDiscrepancies);
          setProductsForPriceDiscrepancyDialog(productsToSave);
        } else {
          await proceedWithFinalSave(productsToSave);
        }
      } catch (error: any) {
        setIsSaving(false);
        console.error(
          "[useInvoiceSaver] Error checking product prices:",
          error
        );
        const errorMsg =
          error.message || t("edit_invoice_toast_error_price_check_default");
        setSaveError(errorMsg);
        onSaveError(errorMsg);
        toast({
          title: t("edit_invoice_toast_error_price_check_title"),
          description: errorMsg,
          variant: "destructive",
        });
      }
    } else {
      await proceedWithFinalSave(productsToSave);
    }
  }, [
    user?.id,
    docType,
    productsToSave,
    proceedWithFinalSave,
    t,
    toast,
    onSaveError,
  ]);

  const resolvePriceDiscrepancies = useCallback(
    (resolvedProducts: EditableProduct[] | null) => {
      setPriceDiscrepanciesForDialog(null);
      setProductsForPriceDiscrepancyDialog(null);
      if (resolvedProducts) {
        proceedWithFinalSave(resolvedProducts);
      } else {
        toast({
          title: t("edit_invoice_price_discrepancy_not_resolved_title"),
          description: t("edit_invoice_price_discrepancy_not_resolved_desc"),
          variant: "default",
        });
      }
    },
    [proceedWithFinalSave, t, toast]
  );

  const clearPriceDiscrepancies = useCallback(() => {
    setPriceDiscrepanciesForDialog(null);
    setProductsForPriceDiscrepancyDialog(null);
  }, []);

  const handleArchiveDocument = useCallback(async () => {
    const docId = initialTempInvoiceId || initialInvoiceIdParam;
    if (!docId || !user?.id) {
      toast({
        title: t("archive_error_title"),
        description: t("archive_error_no_doc_id_desc"),
        variant: "destructive",
      });
      return;
    }
    setIsArchiving(true);
    try {
      await archiveDocumentService(docId, user.id);
      toast({
        title: t("archive_success_title"),
        description: t("archive_success_desc"),
      });
      router.push("/invoices");
    } catch (error: any) {
      toast({
        title: t("archive_error_title"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsArchiving(false);
    }
  }, [initialTempInvoiceId, initialInvoiceIdParam, user, toast, t, router]);

  const handleMarkAsPaid = useCallback(async () => {
    if (!initialInvoiceIdParam || !user?.id || !docType) {
      toast({
        title: t("error_title"),
        description: t("mark_as_paid_error_no_id_or_doctype"),
        variant: "destructive",
      });
      return;
    }
    setIsMarkingAsPaid(true);
    try {
      await updateInvoicePaymentStatusService(
        initialInvoiceIdParam,
        "paid",
        user.id
      );
      toast({
        title: t("success_title"),
        description: t("mark_as_paid_success_desc"),
      });

      const updatedDocPartial: Partial<BackendInvoiceHistoryItem> = {
        id: initialInvoiceIdParam,
        paymentStatus: "paid",
        userId: user.id,
        documentType: docType,
      };
      onSaveSuccess(updatedDocPartial as BackendInvoiceHistoryItem);
    } catch (error: any) {
      console.error("[useInvoiceSaver] Error marking document as paid:", error);
      toast({
        title: t("error_title"),
        description: error.message || t("mark_as_paid_error_generic"),
        variant: "destructive",
      });
    } finally {
      setIsMarkingAsPaid(false);
    }
  }, [initialInvoiceIdParam, user?.id, docType, t, toast, onSaveSuccess]);

  return {
    isSaving,
    saveError,
    handleFullSave,
    priceDiscrepanciesForDialog,
    productsForPriceDiscrepancyDialog,
    resolvePriceDiscrepancies,
    clearPriceDiscrepancies,
    handleArchiveDocument,
    isArchiving,
    handleMarkAsPaid,
    isMarkingAsPaid,
  };
}
