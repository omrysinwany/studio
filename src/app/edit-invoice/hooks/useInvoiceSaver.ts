import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation'; // ודא שזה המיקום הנכון
import { useToast } from '@/hooks/use-toast';
import type { User } from '@/context/AuthContext';
// ודא ש-InvoiceHistoryItem מיובא מהמקום הנכון (מה-types המקומי)
import type { EditableProduct, EditableTaxInvoiceDetails, InvoiceHistoryItem, DueDateOption } from '../types';
import {
  checkProductPricesBeforeSaveService,
  finalizeSaveProductsService,
  ProductPriceDiscrepancy,
  DOCUMENTS_COLLECTION,
} from '@/services/backend';
import { Timestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isValid, parseISO } from 'date-fns';
// ייבוא של Product מ-backend אם הוא שונה מ-EditableProduct
import type { Product as BackendProduct } from '@/services/backend';


interface UseInvoiceSaverProps {
  user: User | null;
  docType: 'deliveryNote' | 'invoice' | null;
  productsToSave: EditableProduct[];
  taxDetailsToSave: EditableTaxInvoiceDetails;
  originalFileName: string;
  initialTempInvoiceId: string | null;
  initialInvoiceIdParam: string | null;
  displayedOriginalImageUrl?: string | null;
  displayedCompressedImageUrl?: string | null;
  isNewScan: boolean;
  paymentDueDateForSave?: Date;
  currentDocumentPaymentTermOption?: DueDateOption | null;
  cleanupTemporaryData: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  onSaveSuccess: (savedInvoice: InvoiceHistoryItem) => void; // מצפה לטיפוס המקומי
  onSaveError: (errorMsg: string) => void;
}

export interface UseInvoiceSaverReturn {
  isSaving: boolean;
  handleSaveChecks: () => Promise<void>;
  priceDiscrepanciesForDialog: ProductPriceDiscrepancy[] | null;
  productsForPriceDiscrepancyDialog: EditableProduct[] | null;
  resolvePriceDiscrepancies: (resolvedProducts: EditableProduct[] | null) => void;
  clearPriceDiscrepancies: () => void;
}

export function useInvoiceSaver({
  user, docType, productsToSave, taxDetailsToSave, originalFileName: initialOriginalFileName,
  initialTempInvoiceId, initialInvoiceIdParam, displayedOriginalImageUrl, displayedCompressedImageUrl,
  isNewScan, paymentDueDateForSave, currentDocumentPaymentTermOption, cleanupTemporaryData, t,
  onSaveSuccess, onSaveError,
}: UseInvoiceSaverProps): UseInvoiceSaverReturn {
  const [isSaving, setIsSaving] = useState(false);
  // const router = useRouter(); // לא בשימוש ישיר כאן, הניווט מטופל ב-EditInvoiceContent
  const { toast } = useToast();

  const [priceDiscrepanciesForDialog, setPriceDiscrepanciesForDialog] = useState<ProductPriceDiscrepancy[] | null>(null);
  const [productsForPriceDiscrepancyDialog, setProductsForPriceDiscrepancyDialog] = useState<EditableProduct[] | null>(null);

  const proceedWithFinalSave = useCallback(async (finalProductsToSave: EditableProduct[]) => {
    if (!user?.id || !docType) {
      onSaveError(t("edit_invoice_user_not_authenticated_desc"));
      return;
    }
    setIsSaving(true);
    try {
      const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => ({
        ...rest,
        salePrice: (rest.salePrice !== undefined && !isNaN(Number(rest.salePrice)) && Number(rest.salePrice) > 0) ? Number(rest.salePrice) : null,
        barcode: rest.barcode || null,
      } as BackendProduct)); // השתמש בטיפוס Product מהשירות אם הוא שונה

      let finalFileNameForSave = initialOriginalFileName;
      const finalSupplierNameForSave = taxDetailsToSave.supplierName;
      const finalInvoiceNumberForSave = taxDetailsToSave.invoiceNumber;
      let finalTotalAmountForSave = taxDetailsToSave.totalAmount;

      if(docType === 'deliveryNote' && productsForService.length > 0 && (finalTotalAmountForSave === null || finalTotalAmountForSave === 0 || finalTotalAmountForSave === undefined)){
        finalTotalAmountForSave = productsForService.reduce((sum, p) => sum + (p.lineTotal || 0), 0);
      }

      let finalInvoiceDateForSave: Date | Timestamp | string | null = null;
      if (taxDetailsToSave.invoiceDate instanceof Timestamp) finalInvoiceDateForSave = taxDetailsToSave.invoiceDate;
      else if (typeof taxDetailsToSave.invoiceDate === 'string' && isValid(parseISO(taxDetailsToSave.invoiceDate))) finalInvoiceDateForSave = parseISO(taxDetailsToSave.invoiceDate);
      else if (taxDetailsToSave.invoiceDate instanceof Date && isValid(taxDetailsToSave.invoiceDate)) finalInvoiceDateForSave = taxDetailsToSave.invoiceDate;

      let finalPaymentDueDateForSave: Date | Timestamp | string | null = null;
      if (paymentDueDateForSave instanceof Timestamp) finalPaymentDueDateForSave = paymentDueDateForSave;
      else if (typeof paymentDueDateForSave === 'string' && isValid(parseISO(paymentDueDateForSave))) finalPaymentDueDateForSave = parseISO(paymentDueDateForSave);
      else if (paymentDueDateForSave instanceof Date && isValid(paymentDueDateForSave)) finalPaymentDueDateForSave = paymentDueDateForSave;

      if(finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '' && finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
        finalFileNameForSave = `${finalSupplierNameForSave}_${finalInvoiceNumberForSave}`;
      } else if (finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '') {
        finalFileNameForSave = finalSupplierNameForSave;
      } else if (finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
        finalFileNameForSave = `Invoice_${finalInvoiceNumberForSave}`;
      }
      finalFileNameForSave = finalFileNameForSave.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);

      let rawScanResultJsonToSave: string | null = null;
      const currentTempId = initialTempInvoiceId;
      if (currentTempId && db && user?.id) {
         const pendingDocRef = doc(db, DOCUMENTS_COLLECTION, currentTempId);
         const pendingDocSnapForJson = await getDoc(pendingDocRef);
         if (pendingDocSnapForJson.exists()) rawScanResultJsonToSave = pendingDocSnapForJson.data()?.rawScanResultJson || null;
      } else if (initialInvoiceIdParam && db) {
         const finalDocRef = doc(db, DOCUMENTS_COLLECTION, initialInvoiceIdParam);
         const finalDocSnap = await getDoc(finalDocRef);
         if (finalDocSnap.exists()) rawScanResultJsonToSave = finalDocSnap.data()?.rawScanResultJson || null;
      }

      const result = await finalizeSaveProductsService(
        productsForService, finalFileNameForSave, docType, user.id,
        currentTempId || initialInvoiceIdParam || undefined,
        finalInvoiceNumberForSave || undefined, finalSupplierNameForSave || undefined,
        finalTotalAmountForSave ?? undefined, finalPaymentDueDateForSave,
        finalInvoiceDateForSave, taxDetailsToSave.paymentMethod || undefined,
        displayedOriginalImageUrl || undefined, displayedCompressedImageUrl || undefined,
        rawScanResultJsonToSave
        // ✅ הערה: הסרנו את currentDocumentPaymentTermOption מכאן זמנית
        // , currentDocumentPaymentTermOption // אם פונקציית השירות שלך לא מעודכנת לקבל 15 ארגומנטים
      );

      if (isNewScan && !initialInvoiceIdParam) cleanupTemporaryData();

      if (result.finalInvoiceRecord) {
        // ✅ תיקון לשגיאה 2: "העשרת" האובייקט המוחזר מהשירות
        const recordFromService = result.finalInvoiceRecord as any; // המרה זמנית ל-any כדי למנוע שגיאות אם השדות באמת חסרים
        const augmentedRecord: InvoiceHistoryItem = {
            ...recordFromService,
            id: recordFromService.id || '', // ודא ש-id קיים
            userId: recordFromService.userId || user.id, // ודא ש-userId קיים
            originalFileName: recordFromService.originalFileName || finalFileNameForSave,
            docType: recordFromService.docType || docType, // הוסף אם חסר
            uploadDate: recordFromService.uploadDate || Timestamp.now(), // הוסף עם ערך ברירת מחדל אם חסר
            // ודא ששאר השדות הנדרשים על ידי הטיפוס המקומי InvoiceHistoryItem קיימים
            // או ספק להם ערכי ברירת מחדל / הפוך אותם לאופציונליים בטיפוס המקומי אם זה נכון
        };

        onSaveSuccess(augmentedRecord);
        toast({
          title: docType === 'deliveryNote' ? t('edit_invoice_toast_products_saved_title') : t('edit_invoice_toast_invoice_details_saved_title'),
          description: docType === 'deliveryNote' ? t('edit_invoice_toast_products_saved_desc') : t('edit_invoice_toast_invoice_details_saved_desc'),
        });
      } else {
        onSaveError(t('edit_invoice_toast_save_failed_desc_finalize', { message: "Final invoice record not returned."}));
      }
    } catch (error: any) {
      console.error("[useInvoiceSaver][proceedWithFinalSave] Failed to finalize save:", error);
      let errorMsg = t('edit_invoice_toast_save_failed_desc_finalize', { message: (error as Error).message || t('edit_invoice_try_again')});
      if ((error as any).isQuotaError) {
        errorMsg = t('upload_toast_storage_full_desc_finalize', {context: "(finalize save)"});
        toast({ title: t('upload_toast_storage_full_title_critical'), description: errorMsg, variant: "destructive", duration: 10000 });
      } else {
        toast({ title: t('edit_invoice_toast_save_failed_title'), description: errorMsg, variant: "destructive", });
      }
      onSaveError(errorMsg);
    } finally {
      setIsSaving(false);
    }
  }, [
    user, docType, taxDetailsToSave, initialOriginalFileName, initialTempInvoiceId, initialInvoiceIdParam,
    displayedOriginalImageUrl, displayedCompressedImageUrl, isNewScan, paymentDueDateForSave, /* currentDocumentPaymentTermOption, */ // הוסר זמנית
    cleanupTemporaryData, t, onSaveSuccess, onSaveError, toast
  ]);

  const handleSaveChecks = useCallback(async () => {
    if (isSaving || !user?.id || !docType) return;
    setIsSaving(true);
    setPriceDiscrepanciesForDialog(null);
    setProductsForPriceDiscrepancyDialog(null);

    let currentProductsToProcess = [...productsToSave];

    try {
      if(docType === 'deliveryNote' && currentProductsToProcess.length > 0) {
        const priceCheckResult = await checkProductPricesBeforeSaveService(currentProductsToProcess, user.id);
        if (priceCheckResult.priceDiscrepancies.length > 0) {
          setPriceDiscrepanciesForDialog(priceCheckResult.priceDiscrepancies);
          const productsForDialog = priceCheckResult.productsToSaveDirectly.concat(
            priceCheckResult.priceDiscrepancies.map(d => ({ ...d, unitPrice: d.newUnitPrice, salePrice: d.salePrice, } as EditableProduct))
          );
          setProductsForPriceDiscrepancyDialog(productsForDialog);
          setIsSaving(false);
          return;
        }
        currentProductsToProcess = priceCheckResult.productsToSaveDirectly.map(p => ({...p} as EditableProduct));
      }
      await proceedWithFinalSave(currentProductsToProcess);
    } catch (error) {
      console.error("[useInvoiceSaver][handleSaveChecks] Error during save preparation:", error);
      const errorMsg = t('edit_invoice_toast_error_preparing_save_desc', { message: (error as Error).message});
      toast({ title: t('edit_invoice_toast_error_preparing_save_title'), description: errorMsg, variant: "destructive",});
      onSaveError(errorMsg);
      setIsSaving(false);
    }
  }, [
    isSaving, user, docType, productsToSave, t, toast, proceedWithFinalSave, onSaveError
  ]);

  const resolvePriceDiscrepancies = useCallback(async (resolvedProducts: EditableProduct[] | null) => {
    setPriceDiscrepanciesForDialog(null);
    setProductsForPriceDiscrepancyDialog(null);
    if (resolvedProducts === null) {
      toast({ title: t("edit_invoice_toast_save_cancelled_title"), description: t("edit_invoice_toast_save_cancelled_desc_price"), variant: "default" });
      setIsSaving(false);
      return;
    }
    await proceedWithFinalSave(resolvedProducts);
  }, [t, toast, proceedWithFinalSave]);

  const clearPriceDiscrepancies = useCallback(() => {
    setPriceDiscrepanciesForDialog(null);
    setProductsForPriceDiscrepancyDialog(null);
  }, []);

  return {
    isSaving,
    handleSaveChecks,
    priceDiscrepanciesForDialog,
    productsForPriceDiscrepancyDialog,
    resolvePriceDiscrepancies,
    clearPriceDiscrepancies,
  };
}