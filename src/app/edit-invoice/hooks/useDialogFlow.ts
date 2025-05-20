// src/app/edit-invoice/hooks/useDialogFlow.ts
import { useState, useEffect, useCallback } from 'react';
import type {
  DialogFlowStep,
  EditableProduct,
  EditableTaxInvoiceDetails,
} from '../types';
import type { DueDateOption } from '@/components/payment-due-date-dialog';
import type { User } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  getSupplierSummariesService,
  createSupplierService,
  SupplierSummary,
  getProductsService,
  Product as BackendProduct, // שימוש בשם מיובא ברור יותר
} from '@/services/backend';

interface UseDialogFlowProps {
  isNewScan: boolean;
  user: User | null;
  docType: 'deliveryNote' | 'invoice' | null;
  productsForNextStep: EditableProduct[];
  initialScannedTaxDetails: EditableTaxInvoiceDetails;
  aiScannedSupplierNameFromStorage?: string;
  initialSelectedPaymentDueDate?: Date;
  onSupplierConfirmed: (name: string | null, isNew: boolean) => void;
  onPaymentDueDateChanged: (date: Date | undefined, option: DueDateOption | null) => void;
  onProductsUpdatedFromDialog: (updatedProducts: EditableProduct[] | null) => void;
  onDialogError: (errorMessage: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export interface UseDialogFlowReturn {
  currentDialogStep: DialogFlowStep;
  startInitialDialogFlow: () => void;
  supplierDialogProps?: {
    potentialSupplierName: string;
    existingSuppliers: SupplierSummary[];
    onConfirm: (confirmedSupplierName: string | null, isNew?: boolean) => void;
    onCancel: () => void;
  };
  paymentDueDateDialogProps?: {
    onConfirm: (dueDate: Date | undefined, selectedOption: DueDateOption) => void;
    onCancel: () => void;
  };
  newProductDetailsDialogProps?: {
    products: EditableProduct[];
    onComplete: (updatedProducts: EditableProduct[] | null) => void;
  };
  finalizedSupplierName: string | null;
  finalizedPaymentDueDate: Date | undefined;
  finalizedPaymentTermOption: DueDateOption | null;
  dialogFlowError: string | null;
  isDialogFlowActive: boolean;
  setDialogFlowError: React.Dispatch<React.SetStateAction<string | null>>;
  proceedToNextStep: (outcome: string, data?: any) => void;
}

export function useDialogFlow({
  isNewScan, user, docType, productsForNextStep, initialScannedTaxDetails,
  aiScannedSupplierNameFromStorage, initialSelectedPaymentDueDate,
  onSupplierConfirmed, onPaymentDueDateChanged, onProductsUpdatedFromDialog,
  onDialogError, t
}: UseDialogFlowProps): UseDialogFlowReturn {
  const { toast } = useToast();
  const [currentDialogStep, setCurrentDialogStep] = useState<DialogFlowStep>('idle');
  const [dialogFlowError, setDialogFlowError] = useState<string | null>(null);
  const [isDialogFlowActive, setIsDialogFlowActive] = useState(false);
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [potentialSupplierName, setPotentialSupplierName] = useState<string | undefined>(undefined);
  const [isSupplierConfirmed, setIsSupplierConfirmed] = useState(false);
  const [selectedPaymentDueDate, setSelectedPaymentDueDate] = useState<Date | undefined>(initialSelectedPaymentDueDate);
  const [currentDocumentPaymentTermOption, setCurrentDocumentPaymentTermOption] = useState<DueDateOption | null>(null);
  const [isPaymentDueDateDialogSkipped, setIsPaymentDueDateDialogSkipped] = useState(false);
  const [productsToDisplayForNewDetails, setProductsToDisplayForNewDetails] = useState<EditableProduct[]>([]);

  const processNextDialogStep = useCallback(async (previousStepOutcome: string, data?: any) => {
    // הדפסה לדיבאג - חשוב מאוד לבעיית כפתור השמירה
    console.log(`[useDialogFlow] processNextDialogStep CALLED. Current Step BEFORE: ${currentDialogStep}, From Outcome: ${previousStepOutcome}, isNewScan: ${isNewScan}`);

    if (!isNewScan || !user?.id) {
      setCurrentDialogStep('ready_to_save');
      setIsDialogFlowActive(false);
      console.log(`[useDialogFlow] processNextDialogStep: Not a new scan or no user. Setting to ready_to_save.`);
      return;
    }

    const currentProductsForCheck = productsForNextStep; // Assume this prop is always up-to-date
    let nextStep: DialogFlowStep = 'ready_to_save';
    let shouldFlowBeActive = false;

    switch (currentDialogStep) {
      case 'idle': // Usually, startInitialDialogFlow handles transition from 'idle'
      case 'supplier_confirmation':
        if (previousStepOutcome.startsWith('supplier_')) {
          if (!selectedPaymentDueDate && !isPaymentDueDateDialogSkipped) {
            nextStep = 'payment_due_date';
            shouldFlowBeActive = true;
          } else {
            const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
            if (reviewResult.needsReview) {
              nextStep = 'new_product_details';
              shouldFlowBeActive = true;
            } else {
              nextStep = 'ready_to_save'; // No more dialogs
            }
          }
        } else { // Fallback if called with unexpected outcome from these states
            nextStep = 'ready_to_save';
        }
        break;
      case 'payment_due_date':
        const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
        if (reviewResult.needsReview) {
          nextStep = 'new_product_details';
          shouldFlowBeActive = true;
        } else {
          nextStep = 'ready_to_save'; // No more dialogs
        }
        break;
      case 'new_product_details':
        // After new product details are handled (or skipped), flow is ready to save
        nextStep = 'ready_to_save';
        break;
      case 'ready_to_save':
      case 'error_loading':
        // Already in a final state, no transition needed from here by this function
        nextStep = currentDialogStep; // Stay in current state
        shouldFlowBeActive = false; // Or based on current state if error_loading allows retry
        break;
      default:
        console.warn(`[useDialogFlow] processNextDialogStep: Unhandled currentDialogStep "${currentDialogStep}". Defaulting to ready_to_save.`);
        nextStep = 'ready_to_save';
        break;
    }
    console.log(`[useDialogFlow] processNextDialogStep FINISHED. New state will be: nextStep="${nextStep}", shouldFlowBeActive=${shouldFlowBeActive}`);
    setCurrentDialogStep(nextStep);
    setIsDialogFlowActive(shouldFlowBeActive);
  }, [
    isNewScan, user?.id, productsForNextStep, currentDialogStep, // Added currentDialogStep here
    selectedPaymentDueDate, isPaymentDueDateDialogSkipped, // checkForNewProductsAndDetails is a dependency not a state var
    // No need to list checkForNewProductsAndDetails itself if its own dependencies are stable
    // However, if its behavior changes based on external factors not listed, it could be an issue.
    // For simplicity, let's assume its dependencies (user?.id, docType, t, toast) are stable enough or handled by parent re-renders.
  ]);


  const _internalCheckSupplier = useCallback(async (
    scannedSupplierFromAi: string | null | undefined,
    currentUserId: string,
    fetchedSuppliersList: SupplierSummary[]
  ) => {
    setExistingSuppliers(fetchedSuppliersList || []);
    const trimmedScannedSupplier = scannedSupplierFromAi?.trim();

    if (trimmedScannedSupplier && trimmedScannedSupplier !== '') {
      const supplierExists = (fetchedSuppliersList || []).some(s => s && typeof s.name === 'string' && s.name.toLowerCase() === trimmedScannedSupplier.toLowerCase());
      if (!supplierExists) {
        setPotentialSupplierName(trimmedScannedSupplier);
        setCurrentDialogStep('supplier_confirmation');
        setIsDialogFlowActive(true);
      } else {
        onSupplierConfirmed(trimmedScannedSupplier, false);
        setIsSupplierConfirmed(true);
        await processNextDialogStep('supplier_existing_or_empty');
      }
    } else {
      onSupplierConfirmed(null, false);
      setIsSupplierConfirmed(true);
      await processNextDialogStep('supplier_existing_or_empty');
    }
  }, [onSupplierConfirmed, processNextDialogStep]); // Added processNextDialogStep


  const checkForNewProductsAndDetails = useCallback(async (productsToCheck: EditableProduct[]): Promise<{needsReview: boolean, productsForReview: EditableProduct[]}> => {
    if (!user?.id) {
      toast({ title: t("edit_invoice_user_not_authenticated_title"), description: t("edit_invoice_user_not_authenticated_desc"), variant: "destructive" });
      return {needsReview: false, productsForReview: []};
    }
    if (docType !== 'deliveryNote' || productsToCheck.length === 0) {
      return {needsReview: false, productsForReview: []};
    }
    try {
      const currentInventory = await getProductsService(user.id);
      const inventoryMap = new Map<string, BackendProduct>(); // Use BackendProduct
      currentInventory.forEach(p => {
        if (p.id) inventoryMap.set(`id:${p.id}`, p);
        if (p.catalogNumber && p.catalogNumber !== "N/A") inventoryMap.set(`catalog:${p.catalogNumber}`, p);
        if (p.barcode) inventoryMap.set(`barcode:${p.barcode}`, p);
      });

      const productsRequiringDetailsReview = productsToCheck.filter(p => {
        const isTempId = p._originalId?.startsWith('prod-temp-') || p._originalId?.startsWith('scan-temp-') || p.id?.startsWith('prod-temp-') || p.id?.startsWith('scan-temp-') || !p._originalId;
        const existingInInventoryById = !isTempId && p._originalId && inventoryMap.has(`id:${p._originalId}`);
        const existingInInventoryByCat = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
        const existingInInventoryByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);
        const isExistingProduct = existingInInventoryById || existingInInventoryByCat || existingInInventoryByBarcode;
        const needsSalePriceReview = p.salePrice === undefined; // Assuming salePrice is a field on EditableProduct
        if (!isExistingProduct) return true;
        if (isExistingProduct && needsSalePriceReview) return true;
        return false;
      });

      setProductsToDisplayForNewDetails(productsRequiringDetailsReview);
      return {needsReview: productsRequiringDetailsReview.length > 0, productsForReview: productsRequiringDetailsReview};
    } catch (error) {
      console.error("[useDialogFlow][checkForNewProductsAndDetails] Error:", error);
      const errorMsg = (error instanceof Error ? error.message : t('edit_invoice_toast_error_new_product_details_desc'));
      toast({ title: t('edit_invoice_toast_error_new_product_details_title'), description: errorMsg, variant: "destructive" });
      setDialogFlowError(errorMsg);
      return {needsReview: false, productsForReview: []};
    }
  }, [user?.id, docType, t, toast]); // Removed setDialogFlowError from here to avoid re-runs if it's not essential to this specific callback's identity


  const startInitialDialogFlow = useCallback(async () => {
    console.log('[useDialogFlow] startInitialDialogFlow called. isNewScan:', isNewScan, 'user:', !!user, 'currentDialogStep:', currentDialogStep);
    if (!isNewScan || !user?.id || currentDialogStep !== 'idle') {
        if (!isNewScan) {
            console.log('[useDialogFlow] Not a new scan in startInitialDialogFlow, setting to ready_to_save.');
            setCurrentDialogStep('ready_to_save');
            setIsDialogFlowActive(false);
        } else {
            console.log('[useDialogFlow] startInitialDialogFlow conditions not fully met or already started. Current step:', currentDialogStep);
        }
        return;
    }
    setIsDialogFlowActive(true); // Mark as active when starting
    try {
      const fetchedSuppliers = await getSupplierSummariesService(user.id);
      setExistingSuppliers(fetchedSuppliers);
      const supplierToUse = aiScannedSupplierNameFromStorage || initialScannedTaxDetails.supplierName;
      await _internalCheckSupplier(supplierToUse, user.id, fetchedSuppliers);
    } catch (error) {
      console.error("[useDialogFlow][startInitialDialogFlow] Error fetching suppliers:", error);
      const errorMsg = t('edit_invoice_toast_error_fetching_suppliers');
      toast({ title: t('error_title'), description: errorMsg, variant: "destructive" });
      onDialogError(errorMsg); // Notify parent
      setDialogFlowError(errorMsg); // Set local error state
      setIsSupplierConfirmed(true); // Assume can proceed
      await processNextDialogStep('supplier_fetch_error');
    }
  }, [
      isNewScan, user?.id, currentDialogStep, aiScannedSupplierNameFromStorage, initialScannedTaxDetails.supplierName,
      _internalCheckSupplier, toast, t, onDialogError, processNextDialogStep
  ]);

  const handleSupplierDialogConfirm = useCallback(async (confirmedSupplierName: string | null, isNewDialog: boolean = false) => {
    if (isNewDialog && confirmedSupplierName && user?.id) {
      try {
        await createSupplierService(confirmedSupplierName, {}, user.id);
        toast({ title: t('edit_invoice_toast_new_supplier_added_title')});
        const updatedSuppliers = await getSupplierSummariesService(user.id);
        setExistingSuppliers(updatedSuppliers);
      } catch (error: any) {
         const errorMsg = error.message || t('edit_invoice_toast_fail_add_supplier_desc_unknown');
         toast({ title: t('edit_invoice_toast_fail_add_supplier_title'), description: errorMsg, variant: "destructive" });
         setDialogFlowError(errorMsg);
      }
    }
    onSupplierConfirmed(confirmedSupplierName, isNewDialog);
    setIsSupplierConfirmed(true);
    await processNextDialogStep('supplier_confirmed');
  }, [user?.id, onSupplierConfirmed, t, toast, processNextDialogStep, setDialogFlowError]); // Added setDialogFlowError

  const handleSupplierDialogCancel = useCallback(async () => {
    const fallbackSupplier = aiScannedSupplierNameFromStorage || initialScannedTaxDetails.supplierName || null;
    onSupplierConfirmed(fallbackSupplier, false); // Confirm with fallback or null
    setIsSupplierConfirmed(true); // Mark as confirmed/skipped
    await processNextDialogStep('supplier_skipped');
  }, [aiScannedSupplierNameFromStorage, initialScannedTaxDetails.supplierName, onSupplierConfirmed, processNextDialogStep]);

  const handlePaymentDueDateDialogConfirm = useCallback(async (dueDate: Date | undefined, selectedOption: DueDateOption) => {
    setSelectedPaymentDueDate(dueDate);
    setCurrentDocumentPaymentTermOption(selectedOption);
    setIsPaymentDueDateDialogSkipped(false);
    onPaymentDueDateChanged(dueDate, selectedOption);
    await processNextDialogStep('payment_due_date_confirmed');
  }, [onPaymentDueDateChanged, processNextDialogStep]);

  const handlePaymentDueDateDialogCancel = useCallback(async () => {
    setSelectedPaymentDueDate(initialSelectedPaymentDueDate);
    setCurrentDocumentPaymentTermOption(null);
    setIsPaymentDueDateDialogSkipped(true);
    onPaymentDueDateChanged(initialSelectedPaymentDueDate, null);
    await processNextDialogStep('payment_due_date_skipped');
  }, [initialSelectedPaymentDueDate, onPaymentDueDateChanged, processNextDialogStep]);

  const handleNewProductDetailsDialogComplete = useCallback(async (updatedNewProductsFromDialog: EditableProduct[] | null) => {
    onProductsUpdatedFromDialog(updatedNewProductsFromDialog);
    setProductsToDisplayForNewDetails([]);
    await processNextDialogStep('new_product_details_complete', updatedNewProductsFromDialog);
  }, [onProductsUpdatedFromDialog, processNextDialogStep]);

  return {
    currentDialogStep,
    startInitialDialogFlow,
    supplierDialogProps: currentDialogStep === 'supplier_confirmation' && potentialSupplierName !== undefined ? {
      potentialSupplierName,
      existingSuppliers,
      onConfirm: handleSupplierDialogConfirm,
      onCancel: handleSupplierDialogCancel,
    } : undefined,
    paymentDueDateDialogProps: currentDialogStep === 'payment_due_date' ? {
      onConfirm: handlePaymentDueDateDialogConfirm,
      onCancel: handlePaymentDueDateDialogCancel,
    } : undefined,
    newProductDetailsDialogProps: currentDialogStep === 'new_product_details' && productsToDisplayForNewDetails.length > 0 ? {
      products: productsToDisplayForNewDetails,
      onComplete: handleNewProductDetailsDialogComplete,
    } : undefined,
    finalizedSupplierName: isSupplierConfirmed ? (potentialSupplierName || initialScannedTaxDetails.supplierName || null) : null, // This might need adjustment based on actual confirmation
    finalizedPaymentDueDate: selectedPaymentDueDate,
    finalizedPaymentTermOption: currentDocumentPaymentTermOption,
    dialogFlowError,
    isDialogFlowActive,
    setDialogFlowError,
    proceedToNextStep: processNextDialogStep,
  };
}