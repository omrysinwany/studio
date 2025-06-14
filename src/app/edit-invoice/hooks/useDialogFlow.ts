// src/app/edit-invoice/hooks/useDialogFlow.ts
import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  DialogFlowStep,
  EditableProduct,
  EditableTaxInvoiceDetails,
  DueDateOption,
} from "../types";
import type { User } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  getSuppliersService,
  createSupplierService,
  Supplier,
  getProductsService,
  Product as BackendProduct,
  updateSupplierService,
  getUserSettingsService,
  UserSettings,
  createSupplierAndSyncWithCaspitService,
} from "@/services/backend";
import { parseISO, isValid, format, addDays, endOfMonth } from "date-fns";
import { he as heLocale, enUS as enUSLocale } from "date-fns/locale";
import { Timestamp } from "firebase/firestore";
import { createOrUpdatePosSupplierAction } from "@/actions/pos-actions";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Import dialog prop types
import type { BarcodePromptDialogProps as NewProductDetailsDialogProps } from "@/components/barcode-prompt-dialog";

// Import new sheet prop type
import type { SupplierPaymentSheetProps } from "@/components/supplier-payment-sheet";

// Helper function to parse payment term string
function parsePaymentTermString(
  termString: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): { option: DueDateOption | null; date: Date | undefined } {
  if (!termString) return { option: null, date: undefined };

  // It's crucial that these keys and their defaultValues match how they are used in `getPaymentTermStringForSupplier`
  // and the actual translations.
  const immediateText = t("payment_terms_option_immediate", {
    defaultValue: "Immediate",
  });
  const net30Text = t("payment_terms_option_net30", { defaultValue: "Net 30" });
  const net60Text = t("payment_terms_option_net60", { defaultValue: "Net 60" });
  const eomText = t("payment_terms_option_eom", {
    defaultValue: "End of Month",
  });

  if (termString === immediateText)
    return { option: "immediate", date: undefined };
  if (termString === net30Text) return { option: "net30", date: undefined };
  if (termString === net60Text) return { option: "net60", date: undefined };
  if (termString === eomText) return { option: "eom", date: undefined };

  // Attempt to parse as ISO date first (most reliable if stored this way)
  let parsedDate = parseISO(termString);
  if (isValid(parsedDate)) {
    return { option: "custom", date: parsedDate };
  }

  // Fallback for non-ISO date strings or other custom text.
  // If it's not a predefined keyword and not a parseable ISO date,
  // we assume it's a 'custom' term. We can't reliably extract the Date object
  // if it was stored in a localized "PP" format without knowing the original locale.
  // The UI might just display this string.
  console.warn(
    `[useDialogFlow] parsePaymentTermString: Term string "${termString}" is not a standard option or parsable ISO date. Assuming 'custom'.`
  );
  return { option: "custom", date: undefined }; // Date is unknown
}

// Helper to get payment term string for saving (similar to useInvoiceSaver's)
function getPaymentTermStringForSupplierPersistence(
  currentOption: DueDateOption | null,
  paymentDueDate: Date | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): string | undefined {
  if (!currentOption) return undefined;
  switch (currentOption) {
    case "immediate":
    case "net30":
    case "net60":
    case "eom":
      return t(`payment_terms_option_${currentOption}`);
    case "custom":
      return paymentDueDate
        ? format(paymentDueDate, "PP", {
            locale:
              t("locale_code_for_date_fns") === "he" ? heLocale : enUSLocale,
          })
        : t("payment_terms_option_custom_fallback");
    default:
      return typeof currentOption === "string"
        ? currentOption
        : t("payment_terms_option_unknown");
  }
}

interface UseDialogFlowProps {
  isNewScan: boolean;
  user: User | null;
  docType: "deliveryNote" | "invoice" | "paymentReceipt" | null;
  productsForNextStep: EditableProduct[];
  initialScannedTaxDetails: EditableTaxInvoiceDetails;
  aiScannedSupplierNameFromStorage?: string;
  aiScannedOsekMorsheFromStorage?: string;
  currentInvoiceDate?: Date | string | Timestamp | null;
  onSupplierChangeInMainForm: (name: string | null) => void;
  onPaymentDetailsChangeInMainForm: (
    date: Date | undefined,
    option: DueDateOption | null
  ) => void;
  onProductsUpdatedFromDialog: (
    updatedProducts: EditableProduct[] | null
  ) => void;
  onDialogError: (errorMessage: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export interface UseDialogFlowReturn {
  currentDialogStep: DialogFlowStep;
  isDialogFlowActive: boolean;
  startInitialDialogFlow: () => Promise<void>;
  resetDialogFlow: () => void;
  supplierPaymentSheetProps: Omit<
    SupplierPaymentSheetProps,
    "isOpen" | "onOpenChange" | "t"
  > & { invoiceDate?: Date | string | Timestamp | null };
  newProductDetailsDialogProps: Omit<
    NewProductDetailsDialogProps,
    "isOpen" | "onOpenChange"
  > | null;
  finalizedSupplierName: string | null | undefined;
  finalizedPaymentDueDate: Date | undefined;
  finalizedPaymentTermOption: DueDateOption | null;
  finalizedOsekMorshe: string | null | undefined;
  dialogFlowError: string | null;
  productsForDialog: EditableProduct[];
}

export function useDialogFlow({
  isNewScan,
  user,
  docType,
  productsForNextStep,
  initialScannedTaxDetails,
  aiScannedSupplierNameFromStorage,
  aiScannedOsekMorsheFromStorage,
  currentInvoiceDate,
  onSupplierChangeInMainForm,
  onPaymentDetailsChangeInMainForm,
  onProductsUpdatedFromDialog,
  onDialogError,
  t,
}: UseDialogFlowProps): UseDialogFlowReturn {
  const { toast } = useToast();
  const [currentDialogStep, setCurrentDialogStep] =
    useState<DialogFlowStep>("idle");
  const [dialogFlowError, setDialogFlowError] = useState<string | null>(null);
  const [isDialogFlowActive, setIsDialogFlowActive] = useState(false);
  const [existingSuppliers, setExistingSuppliers] = useState<Supplier[]>([]);
  const [potentialSupplierNameForSheet, setPotentialSupplierNameForSheet] =
    useState<string | undefined>(undefined);
  const [
    initialPaymentTermOptionForSheet,
    setInitialPaymentTermOptionForSheet,
  ] = useState<DueDateOption | null>(null);
  const [initialCustomDateForSheet, setInitialCustomDateForSheet] = useState<
    Date | undefined
  >(undefined);
  const [finalSupplierNameFromFlow, setFinalSupplierNameFromFlow] = useState<
    string | null | undefined
  >(initialScannedTaxDetails.supplierName);
  const [finalPaymentDueDateFromFlow, setFinalPaymentDueDateFromFlow] =
    useState<Date | undefined>(undefined);
  const [finalPaymentTermOptionFromFlow, setFinalPaymentTermOptionFromFlow] =
    useState<DueDateOption | null>(null);
  const [finalOsekMorsheFromFlow, setFinalOsekMorsheFromFlow] = useState<
    string | null | undefined
  >();
  const [productsToDisplayForNewDetails, setProductsToDisplayForNewDetails] =
    useState<EditableProduct[]>([]);
  const [hasFlowStarted, setHasFlowStarted] = useState(false);
  const [isSupplierFlowLocked, setIsSupplierFlowLocked] = useState(false);

  // New useEffect for logging state changes
  useEffect(() => {
    console.log(
      "[useDialogFlow] State Change: currentDialogStep:",
      currentDialogStep,
      "| finalPaymentTermOptionFromFlow:",
      finalPaymentTermOptionFromFlow,
      "| finalSupplierNameFromFlow:",
      finalSupplierNameFromFlow,
      "| finalOsekMorsheFromFlow:",
      finalOsekMorsheFromFlow
    );
    // Update main form when finalized values change internally, especially if sheet is skipped
    if (currentDialogStep === "idle" || currentDialogStep === "ready_to_save") {
      onSupplierChangeInMainForm(finalSupplierNameFromFlow || null);
      onPaymentDetailsChangeInMainForm(
        finalPaymentDueDateFromFlow,
        finalPaymentTermOptionFromFlow
      );
    }
  }, [
    currentDialogStep,
    finalPaymentTermOptionFromFlow,
    finalSupplierNameFromFlow,
    finalPaymentDueDateFromFlow,
    finalOsekMorsheFromFlow,
    onSupplierChangeInMainForm,
    onPaymentDetailsChangeInMainForm,
  ]);

  const checkForNewProductsAndDetails = useCallback(
    async (
      productsToCheck: EditableProduct[]
    ): Promise<{
      needsReview: boolean;
      productsForReview: EditableProduct[];
    }> => {
      if (!user?.id) {
        toast({
          title: t("edit_invoice_user_not_authenticated_title"),
          description: t("edit_invoice_user_not_authenticated_desc"),
          variant: "destructive",
        });
        return { needsReview: false, productsForReview: [] };
      }
      if (docType !== "deliveryNote" || productsToCheck.length === 0) {
        return { needsReview: false, productsForReview: [] };
      }
      try {
        const currentInventory = await getProductsService(user.id);
        const inventoryMap = new Map<string, BackendProduct>(); // Use BackendProduct
        currentInventory.forEach((p) => {
          if (p.id) inventoryMap.set(`id:${p.id}`, p);
          if (p.catalogNumber && p.catalogNumber !== "N/A")
            inventoryMap.set(`catalog:${p.catalogNumber}`, p);
          if (p.barcode) inventoryMap.set(`barcode:${p.barcode}`, p);
        });

        const productsRequiringDetailsReview = productsToCheck.filter((p) => {
          const isTempId =
            p._originalId?.startsWith("prod-temp-") ||
            p._originalId?.startsWith("scan-temp-") ||
            p.id?.startsWith("prod-temp-") ||
            p.id?.startsWith("scan-temp-") ||
            !p._originalId;
          const existingInInventoryById =
            !isTempId &&
            p._originalId &&
            inventoryMap.has(`id:${p._originalId}`);
          const existingInInventoryByCat =
            p.catalogNumber &&
            p.catalogNumber !== "N/A" &&
            inventoryMap.has(`catalog:${p.catalogNumber}`);
          const existingInInventoryByBarcode =
            p.barcode && inventoryMap.has(`barcode:${p.barcode}`);
          const isExistingProduct =
            existingInInventoryById ||
            existingInInventoryByCat ||
            existingInInventoryByBarcode;
          const needsSalePriceReview = p.salePrice === undefined; // Assuming salePrice is a field on EditableProduct
          if (!isExistingProduct) return true;
          if (isExistingProduct && needsSalePriceReview) return true;
          return false;
        });
        setProductsToDisplayForNewDetails(productsRequiringDetailsReview);
        return {
          needsReview: productsRequiringDetailsReview.length > 0,
          productsForReview: productsRequiringDetailsReview,
        };
      } catch (error) {
        console.error(
          "[useDialogFlow][checkForNewProductsAndDetails] Error:",
          error
        );
        const errorMsg =
          error instanceof Error
            ? error.message
            : t("edit_invoice_toast_error_new_product_details_desc");
        toast({
          title: t("edit_invoice_toast_error_new_product_details_title"),
          description: errorMsg,
          variant: "destructive",
        });
        setDialogFlowError(errorMsg);
        return { needsReview: false, productsForReview: [] };
      }
    },
    [user?.id, docType, t, toast]
  );

  const processNextDialogStep = useCallback(
    async (previousStepOutcome: string) => {
      console.log(
        `[useDialogFlow] processNextDialogStep CALLED. Current Step BEFORE: ${currentDialogStep}, From Outcome: ${previousStepOutcome}, isNewScan: ${isNewScan}`
      );
      if (!isNewScan || !user?.id) {
        setCurrentDialogStep("ready_to_save");
        setIsDialogFlowActive(false);
        return;
      }

      let nextStep: DialogFlowStep = "ready_to_save";
      let shouldFlowBeActive = false;
      const currentProductsForCheck = productsForNextStep;

      switch (currentDialogStep) {
        case "idle":
          if (previousStepOutcome === "supplier_payment_sheet_needed") {
            nextStep = "supplier_payment_details";
            shouldFlowBeActive = true;
          } else {
            const reviewResult = await checkForNewProductsAndDetails(
              currentProductsForCheck
            );
            if (reviewResult.needsReview) {
              nextStep = "new_product_details";
              shouldFlowBeActive = true;
            } else {
              nextStep = "ready_to_save";
            }
          }
          break;

        case "supplier_payment_details":
          const reviewResultAfterSheet = await checkForNewProductsAndDetails(
            currentProductsForCheck
          );
          if (reviewResultAfterSheet.needsReview) {
            nextStep = "new_product_details";
            shouldFlowBeActive = true;
          } else {
            nextStep = "ready_to_save";
          }
          break;

        case "new_product_details":
          nextStep = "ready_to_save";
          break;

        case "ready_to_save":
        case "error_loading":
          nextStep = currentDialogStep;
          shouldFlowBeActive = isDialogFlowActive; // Maintain current active state for error_loading potentially
          break;
        default:
          console.warn(
            `[useDialogFlow] processNextDialogStep: Unhandled currentDialogStep "${currentDialogStep}". Defaulting to ready_to_save.`
          );
          nextStep = "ready_to_save";
          break;
      }
      console.log(
        `[useDialogFlow] processNextDialogStep FINISHED. New state will be: nextStep="${nextStep}", shouldFlowBeActive=${shouldFlowBeActive}`
      );
      setCurrentDialogStep(nextStep);
      setIsDialogFlowActive(shouldFlowBeActive);
    },
    [
      isNewScan,
      user?.id,
      productsForNextStep,
      currentDialogStep,
      checkForNewProductsAndDetails,
      isDialogFlowActive,
    ]
  );

  const prepareDialogFlowLogic = useCallback(
    async (
      scannedSupplierFromAi: string | null | undefined,
      _currentUserId: string, // UserID is available via user prop
      fetchedSuppliersList: Supplier[]
    ) => {
      console.log(
        `[useDialogFlow] prepareDialogFlowLogic: scannedName='${scannedSupplierFromAi}', fetchedSuppliersCount=${fetchedSuppliersList.length}`
      );
      setExistingSuppliers(fetchedSuppliersList || []);
      const trimmedScannedSupplier = scannedSupplierFromAi?.trim();

      setPotentialSupplierNameForSheet(trimmedScannedSupplier);

      if (trimmedScannedSupplier && trimmedScannedSupplier !== "") {
        const existingSupplierMatch = (fetchedSuppliersList || []).find(
          (s) =>
            s &&
            typeof s.name === "string" &&
            s.name.toLowerCase() === trimmedScannedSupplier.toLowerCase()
        );

        if (existingSupplierMatch) {
          setFinalSupplierNameFromFlow(trimmedScannedSupplier);
          setFinalOsekMorsheFromFlow(
            existingSupplierMatch.osekMorshe || aiScannedOsekMorsheFromStorage
          );
          onSupplierChangeInMainForm(trimmedScannedSupplier);

          if (
            existingSupplierMatch.paymentTerms &&
            existingSupplierMatch.paymentTerms.trim() !== ""
          ) {
            console.log(
              `[useDialogFlow] Existing supplier has payment terms: "${existingSupplierMatch.paymentTerms}". Parsing and skipping dialog.`
            );
            const parsedTerms = parsePaymentTermString(
              existingSupplierMatch.paymentTerms,
              t
            );
            onPaymentDetailsChangeInMainForm(
              parsedTerms.date,
              parsedTerms.option
            );
            if (parsedTerms.date) {
              setFinalPaymentDueDateFromFlow(parsedTerms.date);
            }
            setFinalPaymentTermOptionFromFlow(parsedTerms.option);
            await processNextDialogStep(
              "supplier_sheet_skipped_existing_with_terms"
            );
          } else {
            console.log(
              "[useDialogFlow] Existing supplier has NO payment terms. Preparing for payment dialog."
            );
            setFinalPaymentDueDateFromFlow(undefined);
            setFinalPaymentTermOptionFromFlow(null);
            setFinalOsekMorsheFromFlow(null);
            await processNextDialogStep("supplier_payment_sheet_needed");
          }
        } else {
          console.log(
            "[useDialogFlow] New supplier scenario: '${trimmedScannedSupplier}'. SupplierPaymentSheet needed."
          );
          setFinalSupplierNameFromFlow(trimmedScannedSupplier);
          setFinalOsekMorsheFromFlow(null);
          setFinalPaymentDueDateFromFlow(undefined);
          setFinalPaymentTermOptionFromFlow(null);
          setInitialPaymentTermOptionForSheet(null);
          setInitialCustomDateForSheet(undefined);
          await processNextDialogStep("supplier_payment_sheet_needed");
        }
      } else {
        console.log(
          "[useDialogFlow] No supplier name scanned by AI. Will show sheet for manual entry."
        );
        setFinalSupplierNameFromFlow(null);
        setFinalOsekMorsheFromFlow(null);
        setFinalPaymentDueDateFromFlow(undefined);
        setFinalPaymentTermOptionFromFlow(null);
        setInitialPaymentTermOptionForSheet(null);
        setInitialCustomDateForSheet(undefined);
        setPotentialSupplierNameForSheet(undefined);
        await processNextDialogStep("supplier_payment_sheet_needed");
      }
    },
    [user?.id, processNextDialogStep, t]
  );

  const startInitialDialogFlow = useCallback(async () => {
    if (!user?.id || hasFlowStarted) return;
    setHasFlowStarted(true);
    setIsDialogFlowActive(true);
    console.log("[useDialogFlow] startInitialDialogFlow: Flow started.");

    try {
      const suppliers = await getSuppliersService(user.id);
      setExistingSuppliers(suppliers);
      const potentialSupplierName =
        aiScannedSupplierNameFromStorage ||
        initialScannedTaxDetails.supplierName;

      if (potentialSupplierName) {
        const existingSupplier = suppliers.find(
          (s) => s.name === potentialSupplierName
        );
        if (existingSupplier) {
          console.log(
            `[useDialogFlow] Scanned supplier '${potentialSupplierName}' already exists. Skipping supplier sheet.`
          );
          setFinalSupplierNameFromFlow(existingSupplier.name);
          setFinalOsekMorsheFromFlow(
            existingSupplier.osekMorshe || aiScannedOsekMorsheFromStorage
          );
          const { option, date } = parsePaymentTermString(
            existingSupplier.paymentTerms,
            t
          );
          setFinalPaymentTermOptionFromFlow(option);
          processNextDialogStep("supplier_payment_details_confirmed");
          return;
        }
      }
      console.log(
        "[useDialogFlow] New scan of Invoice/Delivery Note. Starting with supplier/payment sheet."
      );
      setPotentialSupplierNameForSheet(potentialSupplierName ?? undefined);
      setFinalSupplierNameFromFlow(potentialSupplierName);
      setCurrentDialogStep("supplier_payment_details");
    } catch (error: any) {
      const msg =
        error.message || t("edit_invoice_toast_error_fetching_suppliers_desc");
      console.error(
        "[useDialogFlow] Error fetching suppliers on flow start:",
        error
      );
      setDialogFlowError(msg);
      onDialogError(msg);
      setIsDialogFlowActive(false);
    }
  }, [
    user?.id,
    hasFlowStarted,
    aiScannedSupplierNameFromStorage,
    aiScannedOsekMorsheFromStorage,
    initialScannedTaxDetails.supplierName,
    t,
    onDialogError,
    processNextDialogStep,
  ]);

  const handleSupplierPaymentSheetSave = useCallback(
    async (data: {
      confirmedSupplierName: string;
      isNewSupplierFlag: boolean;
      paymentTermOption: DueDateOption | null;
      paymentDueDate: Date | undefined;
      osekMorshe?: string | null;
    }) => {
      const {
        confirmedSupplierName,
        isNewSupplierFlag,
        paymentTermOption,
        paymentDueDate,
        osekMorshe,
      } = data;
      console.log("[useDialogFlow] handleSupplierPaymentSheetSave", {
        confirmedSupplierName,
        isNewSupplierFlag,
        paymentTermOption,
        paymentDueDate,
        osekMorshe,
      });

      if (!user?.id) {
        toast({
          title: t("edit_invoice_user_not_authenticated_title"),
          description: t("edit_invoice_user_not_authenticated_desc"),
          variant: "destructive",
        });
        return;
      }

      if (isSupplierFlowLocked) {
        console.warn("[useDialogFlow] Supplier flow is locked. Aborting save.");
        return;
      }
      setIsSupplierFlowLocked(true);

      setFinalSupplierNameFromFlow(confirmedSupplierName);
      setFinalPaymentTermOptionFromFlow(paymentTermOption);
      setFinalPaymentDueDateFromFlow(paymentDueDate);
      setFinalOsekMorsheFromFlow(osekMorshe);

      onSupplierChangeInMainForm(confirmedSupplierName);
      onPaymentDetailsChangeInMainForm(paymentDueDate, paymentTermOption);

      if (isNewSupplierFlag) {
        console.log(
          `[useDialogFlow] Creating new supplier: ${confirmedSupplierName}`
        );
        try {
          const paymentTermString = getPaymentTermStringForSupplierPersistence(
            paymentTermOption,
            paymentDueDate,
            t
          );

          const newSupplierData: Partial<Supplier> = {
            name: confirmedSupplierName,
            paymentTerms: paymentTermString,
            osekMorshe: osekMorshe,
          };

          const newSupplier = await createSupplierAndSyncWithCaspitService(
            newSupplierData,
            user.id
          );

          setExistingSuppliers((prev) => [...prev, newSupplier]);
          toast({
            title: t("edit_invoice_toast_new_supplier_created_title"),
            description: t("edit_invoice_toast_new_supplier_created_desc", {
              supplierName: newSupplier.name,
            }),
          });
        } catch (error: any) {
          console.error(
            `[useDialogFlow] Failed to create new supplier:`,
            error
          );
          const errorMsg =
            error.message || t("edit_invoice_toast_error_creating_supplier");
          toast({
            title: t("edit_invoice_toast_error_creating_supplier_title"),
            description: errorMsg,
            variant: "destructive",
          });
          setIsSupplierFlowLocked(false);
          return; // Stop the flow if supplier creation fails
        }
      } else {
        const existingSupplier = existingSuppliers.find(
          (s) => s.name === confirmedSupplierName
        );
        if (existingSupplier) {
          const paymentTermString = getPaymentTermStringForSupplierPersistence(
            paymentTermOption,
            paymentDueDate,
            t
          );

          const dataToUpdate: Partial<Supplier> = {};
          let needsUpdate = false;

          if (existingSupplier.paymentTerms !== paymentTermString) {
            dataToUpdate.paymentTerms = paymentTermString;
            needsUpdate = true;
          }
          if (osekMorshe && existingSupplier.osekMorshe !== osekMorshe) {
            dataToUpdate.osekMorshe = osekMorshe;
            needsUpdate = true;
          }

          if (needsUpdate) {
            console.log(
              `[useDialogFlow] Updating details for existing supplier: ${confirmedSupplierName}`
            );
            try {
              await updateSupplierService(
                existingSupplier.id,
                dataToUpdate,
                user.id
              );
              setExistingSuppliers((prev) =>
                prev.map((s) =>
                  s.id === existingSupplier.id ? { ...s, ...dataToUpdate } : s
                )
              );
              toast({
                title: t("edit_invoice_toast_supplier_updated_title"),
                description: t("edit_invoice_toast_supplier_updated_desc", {
                  supplierName: confirmedSupplierName,
                }),
              });
            } catch (error: any) {
              console.error(
                `[useDialogFlow] Failed to update supplier:`,
                error
              );
              toast({
                title: t("edit_invoice_toast_error_updating_supplier_title"),
                description:
                  error.message ||
                  t("edit_invoice_toast_error_updating_supplier_desc"),
                variant: "destructive",
              });
              setIsSupplierFlowLocked(false);
              return;
            }
          }
        }
      }

      processNextDialogStep("supplier_payment_details_confirmed");
    },
    [
      user?.id,
      isSupplierFlowLocked,
      t,
      toast,
      onSupplierChangeInMainForm,
      onPaymentDetailsChangeInMainForm,
      processNextDialogStep,
      existingSuppliers,
    ]
  );

  const handleSupplierPaymentSheetCancel = useCallback(async () => {
    console.log("[useDialogFlow] SupplierPaymentSheet cancelled by user.");
    setDialogFlowError(null);
    // Main form state would have been set by prepareDialogFlowLogic initially.
    // If user cancels, these initial/scanned values should persist in the main form.
    // No explicit reversion needed here unless specific requirements arise.
    await processNextDialogStep("supplier_payment_details_cancelled");
  }, [processNextDialogStep]);

  const handleNewProductDetailsDialogComplete = useCallback(
    async (updatedNewProductsFromDialog: EditableProduct[] | null) => {
      onProductsUpdatedFromDialog(updatedNewProductsFromDialog);
      setProductsToDisplayForNewDetails([]);
      await processNextDialogStep("new_product_details_complete");
    },
    [onProductsUpdatedFromDialog, processNextDialogStep]
  );

  let determinedSupplierPaymentSheetProps: Omit<
    SupplierPaymentSheetProps,
    "isOpen" | "onOpenChange" | "t"
  > & { invoiceDate?: Date | string | Timestamp | null } = {
    potentialSupplierNameFromScan: potentialSupplierNameForSheet,
    potentialOsekMorsheFromScan: aiScannedOsekMorsheFromStorage,
    existingSuppliers,
    initialPaymentTermOption: initialPaymentTermOptionForSheet,
    initialCustomPaymentDate: initialCustomDateForSheet,
    invoiceDate: currentInvoiceDate || initialScannedTaxDetails.invoiceDate,
    onSave: handleSupplierPaymentSheetSave,
    onCancel: handleSupplierPaymentSheetCancel,
  };

  let determinedNewProductDetailsDialogProps: Omit<
    NewProductDetailsDialogProps,
    "isOpen" | "onOpenChange"
  > | null = null;
  if (
    currentDialogStep === "new_product_details" &&
    productsToDisplayForNewDetails.length > 0
  ) {
    determinedNewProductDetailsDialogProps = {
      products: productsToDisplayForNewDetails,
      onComplete: handleNewProductDetailsDialogComplete,
    };
  }

  return {
    currentDialogStep,
    isDialogFlowActive,
    startInitialDialogFlow,
    resetDialogFlow: () => {
      setCurrentDialogStep("idle");
      setDialogFlowError(null);
      setIsDialogFlowActive(false);
      setHasFlowStarted(false);
      setIsSupplierFlowLocked(false);
      setFinalSupplierNameFromFlow(null);
      setFinalPaymentDueDateFromFlow(undefined);
      setFinalPaymentTermOptionFromFlow(null);
      setFinalOsekMorsheFromFlow(null);
      setProductsToDisplayForNewDetails([]);
      console.log("[useDialogFlow] Dialog flow reset.");
    },
    supplierPaymentSheetProps: determinedSupplierPaymentSheetProps,
    newProductDetailsDialogProps: determinedNewProductDetailsDialogProps,
    finalizedSupplierName: finalSupplierNameFromFlow,
    finalizedPaymentDueDate: finalPaymentDueDateFromFlow,
    finalizedPaymentTermOption: finalPaymentTermOptionFromFlow,
    finalizedOsekMorshe: finalOsekMorsheFromFlow,
    dialogFlowError,
    productsForDialog: productsToDisplayForNewDetails,
  };
}
