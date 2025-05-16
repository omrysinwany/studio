
// src/app/edit-invoice/page.tsx
'use client';

import React, { useState, useEffect, Suspense, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Trash2, PlusCircle, Save, Loader2, ArrowLeft, Edit, Eye, FileText as FileTextIconLucide, CheckCircle, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
    Product,
    getProductsService,
    checkProductPricesBeforeSaveService,
    finalizeSaveProductsService,
    ProductPriceDiscrepancy,
    getSupplierSummariesService,
    updateSupplierContactInfoService,
    SupplierSummary,
    clearTemporaryScanData,
    TEMP_DATA_KEY_PREFIX,
    TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX,
    TEMP_COMPRESSED_IMAGE_KEY_PREFIX,
    getStorageKey,
    InvoiceHistoryItem,
    getInvoicesService,
    MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES,
    MAX_SCAN_RESULTS_SIZE_BYTES,
    updateInvoiceService,
    DOCUMENTS_COLLECTION,
    INVENTORY_COLLECTION
} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import type { ScanTaxInvoiceOutput } from '@/ai/flows/tax-invoice-schemas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog';
import SupplierConfirmationDialog from '@/components/supplier-confirmation-dialog';
import PaymentDueDateDialog from '@/components/payment-due-date-dialog';
import { useAuth } from '@/context/AuthContext';
import { Label } from '@/components/ui/label';
import { Timestamp, doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/hooks/useTranslation';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';


interface EditableProduct extends Product {
  _originalId?: string;
}

interface EditableTaxInvoiceDetails {
    supplierName?: string | null;
    invoiceNumber?: string | null;
    totalAmount?: number | null;
    invoiceDate?: string | Timestamp | null;
    paymentMethod?: string | null;
}

type DialogFlowStep = 'idle' | 'supplier_confirmation' | 'payment_due_date' | 'new_product_details' | 'price_discrepancy' | 'ready_to_save' | 'error_loading';


const formatInputValue = (value: number | undefined | null, fieldType: 'currency' | 'quantity' | 'stockLevel', t: (key: string, params?: Record<string, string | number>) => string): string => {
     if ((fieldType === 'currency' || fieldType === 'stockLevel') && (value === undefined || value === null)) {
        return '';
    }
    if (value === null || value === undefined || isNaN(value)) {
        return fieldType === 'currency' ? `0.00` : '0';
    }
    if (fieldType === 'currency') {
      return parseFloat(String(value)).toFixed(2);
    }
    return String(Math.round(value));
};

const isValidImageSrc = (src: string | undefined | null): src is string => {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/');
};


function EditInvoiceContent() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [initialScannedProducts, setInitialScannedProducts] = useState<EditableProduct[]>([]);
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [errorLoading, setErrorLoading] = useState<string | null>(null);
  const [scanProcessErrorState, setScanProcessErrorState] = useState<string | null>(null);

  const [initialDataKey, setInitialDataKey] = useState<string | null>(null);
  const [initialTempInvoiceId, setInitialTempInvoiceId] = useState<string | null>(null);
  const [initialOriginalImagePreviewKey, setInitialOriginalImagePreviewKey] = useState<string | null>(null);
  const [initialCompressedImageKey, setInitialCompressedImageKey] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState<'deliveryNote' | 'invoice' | null>(null);

  const [isViewMode, setIsViewMode] = useState(true);
  const [isEditingTaxDetails, setIsEditingTaxDetails] = useState(false);
  const [isEditingDeliveryNoteProducts, setIsEditingDeliveryNoteProducts] = useState(false);

  const [isNewScan, setIsNewScan] = useState(false);

  const [extractedInvoiceNumber, setExtractedInvoiceNumber] = useState<string | undefined | null>(undefined);
  const [extractedSupplierName, setExtractedSupplierName] = useState<string | undefined | null>(undefined);
  const [extractedTotalAmount, setExtractedTotalAmount] = useState<number | undefined | null>(undefined);
  const [extractedInvoiceDate, setExtractedInvoiceDate] = useState<string | Timestamp | undefined | null>(undefined);
  const [extractedPaymentMethod, setExtractedPaymentMethod] = useState<string | undefined | null>(undefined);

  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] = useState<EditableTaxInvoiceDetails>({});
  const [initialScannedTaxDetails, setInitialScannedTaxDetails] = useState<EditableTaxInvoiceDetails>({});

  const [displayedOriginalImageUrl, setDisplayedOriginalImageUrl] = useState<string | null>(null);
  const [displayedCompressedImageUrl, setDisplayedCompressedImageUrl] = useState<string | null>(null);

  // For Dialog Flow
  const [currentDialogStep, setCurrentDialogStep] = useState<DialogFlowStep>('idle');
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [potentialSupplierName, setPotentialSupplierName] = useState<string | undefined>(undefined);

  const [isSupplierConfirmed, setIsSupplierConfirmed] = useState(false);
  const [selectedPaymentDueDate, setSelectedPaymentDueDate] = useState<string | Date | Timestamp | undefined>(undefined);
  const [isPaymentDueDateDialogSkipped, setIsPaymentDueDateDialogSkipped] = useState(false);

  const [promptingForNewProductDetails, setPromptingForNewProductDetails] = useState<Product[] | null>(null);
  const [isBarcodePromptOpen, setIsBarcodePromptOpen] = useState(false);
  const [productInputStates, setProductInputStates] = useState<Record<string, { barcode: string; salePrice?: number }>>({});
  const [priceDiscrepancies, setPriceDiscrepancies] = useState<ProductPriceDiscrepancy[] | null>(null);
  const [productsForNextStep, setProductsForNextStep] = useState<Product[]>([]);
  const [aiScannedSupplierNameFromStorage, setAiScannedSupplierNameFromStorage] = useState<string | undefined | null>(undefined);


  const cleanupTemporaryData = useCallback(() => {
    console.log("[EditInvoice] cleanupTemporaryData called.");
    if (!user?.id) {
        console.warn("[EditInvoice] cleanupTemporaryData called, but user ID is missing.");
        return;
    }
    const uniqueScanIdToClear = initialTempInvoiceId ? initialTempInvoiceId.replace(`pending-inv-${user.id}_`, '') : (initialDataKey ? initialDataKey.replace(getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_`), '') : null);
    console.log(`[EditInvoice] Unique scan ID to clear from cleanupTemporaryData: ${uniqueScanIdToClear}`);

    if (uniqueScanIdToClear) {
        clearTemporaryScanData(uniqueScanIdToClear, user.id);
    } else {
        console.log("[EditInvoice] No unique scan ID found to clear from cleanupTemporaryData.");
    }
  }, [user?.id, initialDataKey, initialTempInvoiceId]);


  const processNextDialogStep = useCallback(async (previousStepOutcome?: string, data?: any) => {
    console.log(`[EditInvoice][processNextDialogStep] Called. Current Step: ${currentDialogStep}, From Outcome:`, previousStepOutcome, "Data:", data);
    if (!isNewScan || !user?.id) {
        console.log("[EditInvoice][processNextDialogStep] Not a new scan or no user. Defaulting to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        setIsSaving(false);
        return;
    }

    switch (currentDialogStep) {
        case 'supplier_confirmation':
            if (previousStepOutcome === 'supplier_confirmed_or_skipped') {
                console.log("[EditInvoice][processNextDialogStep] Supplier handling complete. SelectedPaymentDueDate:", selectedPaymentDueDate, "isPaymentDueDateDialogSkipped:", isPaymentDueDateDialogSkipped, "DocumentType:", documentType);
                if (!selectedPaymentDueDate && !isPaymentDueDateDialogSkipped && (documentType === 'deliveryNote' || documentType === 'invoice')) {
                    console.log("[EditInvoice][processNextDialogStep] Moving to payment_due_date dialog.");
                    setCurrentDialogStep('payment_due_date');
                } else if (documentType === 'deliveryNote' && productsForNextStep.length > 0) {
                    console.log("[EditInvoice][processNextDialogStep] Document is delivery note with products. Checking for new product details.");
                    await checkForNewProductsAndDetails(productsForNextStep, true);
                } else {
                    console.log("[EditInvoice][processNextDialogStep] All pre-save dialogs complete. Setting to ready_to_save.");
                    setCurrentDialogStep('ready_to_save');
                }
            }
            break;

        case 'payment_due_date':
            if (previousStepOutcome === 'payment_due_date_confirmed_or_skipped') {
                console.log("[EditInvoice][processNextDialogStep] Payment due date handling complete. DocumentType:", documentType, "productsForNextStep length:", productsForNextStep.length);
                if (documentType === 'deliveryNote' && productsForNextStep.length > 0) {
                    console.log("[EditInvoice][processNextDialogStep] Document is delivery note with products. Checking for new product details.");
                    await checkForNewProductsAndDetails(productsForNextStep, true);
                } else {
                    console.log("[EditInvoice][processNextDialogStep] All pre-save dialogs complete. Setting to ready_to_save.");
                    setCurrentDialogStep('ready_to_save');
                }
            }
            break;

        case 'new_product_details':
             const updatedProductsFromPrompt = data as Product[] | null;
             const finalProductsAfterNewDetails = updatedProductsFromPrompt || productsForNextStep;
             setProductsForNextStep(finalProductsAfterNewDetails);
             setProducts(finalProductsAfterNewDetails.map(p => ({...p, _originalId: p.id })));
             console.log("[EditInvoice][processNextDialogStep] New product details handled. Products for final save:", finalProductsAfterNewDetails);
             setCurrentDialogStep('ready_to_save');
            break;

        case 'price_discrepancy':
             const resolvedProductsFromDiscrepancy = data as Product[] | null;
             if (resolvedProductsFromDiscrepancy === null) {
                 toast({ title: t('edit_invoice_toast_save_cancelled_title'), description: t('edit_invoice_toast_save_cancelled_desc_price'), variant: "default" });
                 setCurrentDialogStep('idle'); // Or a more appropriate state
                 setIsSaving(false);
                 return;
             }
            console.log("[EditInvoice][processNextDialogStep] Price discrepancy resolved. Resolved products:", resolvedProductsFromDiscrepancy);
            setProductsForNextStep(resolvedProductsFromDiscrepancy);
            setProducts(resolvedProductsFromDiscrepancy.map(p => ({...p, _originalId: p.id })));
            if (documentType === 'deliveryNote' && resolvedProductsFromDiscrepancy.length > 0) {
                console.log("[EditInvoice][processNextDialogStep] Moving to check for new products after price discrepancy.");
                await checkForNewProductsAndDetails(resolvedProductsFromDiscrepancy, true);
            } else {
                console.log("[EditInvoice][processNextDialogStep] No further dialogs after price discrepancy. Setting to ready_to_save.");
                setCurrentDialogStep('ready_to_save');
            }
            break;

        default:
            console.log(`[EditInvoice][processNextDialogStep] In step ${currentDialogStep} with unhandled outcome '${previousStepOutcome}'. Defaulting to ready_to_save if not already there.`);
            if (currentDialogStep !== 'ready_to_save' && currentDialogStep !== 'idle') {
                 setCurrentDialogStep('ready_to_save');
            }
            break;
    }
  }, [currentDialogStep, isNewScan, user?.id, documentType, productsForNextStep, selectedPaymentDueDate, isPaymentDueDateDialogSkipped, t, toast]);


  const _internalCheckSupplier = useCallback(async (scannedSupplier?: string | null, currentUserId?: string, suppliersList?: SupplierSummary[]) => {
    console.log(`[EditInvoice][_internalCheckSupplier] Called. Scanned Supplier: "${scannedSupplier}", UserID: ${currentUserId}, Suppliers List Count: ${suppliersList?.length}, isNewScan: ${isNewScan}`);
    if (!currentUserId || !isNewScan) {
      console.log("[EditInvoice][_internalCheckSupplier] Not a new scan or no user. Setting supplier as confirmed and moving.");
      setIsSupplierConfirmed(true);
      setCurrentDialogStep('payment_due_date'); // Move to next logical step
      processNextDialogStep('supplier_confirmed_or_skipped');
      return;
    }

    setExistingSuppliers(suppliersList || []);

    if (scannedSupplier && scannedSupplier.trim() !== '' && !(suppliersList || []).some(s => s.name.toLowerCase() === scannedSupplier.toLowerCase())) {
        console.log("[EditInvoice][_internalCheckSupplier] Scanned supplier is NEW. Setting currentDialogStep to 'supplier_confirmation'.");
        setPotentialSupplierName(scannedSupplier);
        setCurrentDialogStep('supplier_confirmation');
    } else {
        console.log("[EditInvoice][_internalCheckSupplier] Supplier is existing, empty, or not scanned. Setting as confirmed and moving to next step.");
        setExtractedSupplierName(scannedSupplier);
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: scannedSupplier }));
        setIsSupplierConfirmed(true);
        processNextDialogStep('supplier_confirmed_or_skipped');
    }
  }, [isNewScan, processNextDialogStep]);


  const startDialogFlowForNewScan = useCallback(async (scannedSupplier?: string | null) => {
    console.log("[EditInvoice][startDialogFlowForNewScan] Called. Scanned supplier:", scannedSupplier, "isNewScan:", isNewScan, "user ID:", user?.id, "Current Dialog Step:", currentDialogStep);
    if (!isNewScan || !user?.id ) {
        console.log("[EditInvoice][startDialogFlowForNewScan] Not a new scan or no user or dialog flow already started. Defaulting to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }
    
    setIsLoading(true);
    try {
        console.log("[EditInvoice][startDialogFlowForNewScan] Fetching suppliers for user:", user.id);
        const fetchedSuppliersList = await getSupplierSummariesService(user.id);
        console.log("[EditInvoice][startDialogFlowForNewScan] Fetched suppliers count:", fetchedSuppliersList.length);
        await _internalCheckSupplier(scannedSupplier, user.id, fetchedSuppliersList);
    } catch (error) {
        console.error("[EditInvoice][startDialogFlowForNewScan] Error fetching suppliers:", error);
        toast({ title: t('edit_invoice_toast_error_fetching_suppliers'), variant: "destructive" });
        setIsSupplierConfirmed(true);
        setCurrentDialogStep('payment_due_date'); // Fallback to next step
        processNextDialogStep('supplier_confirmed_or_skipped');
    } finally {
        setIsLoading(false);
    }
  }, [isNewScan, user?.id, toast, t, _internalCheckSupplier, currentDialogStep, processNextDialogStep]);


  const loadData = useCallback(async () => {
    console.log("[EditInvoice][loadData] Initiated.");
    if (!user || !searchParams || !user.id) {
        console.warn("[EditInvoice][loadData] User, searchParams, or user.id missing. Aborting.");
        setIsLoading(false);
        setInitialDataLoaded(true);
        setErrorLoading(t('edit_invoice_user_not_authenticated_title'));
        setCurrentDialogStep('error_loading');
        return;
    }
    
    console.log("[EditInvoice][loadData] Started for user:", user.id);
    setIsLoading(true);
    setErrorLoading(null);
    setScanProcessErrorState(null);
    
    const keyParam = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    const tempInvIdParam = searchParams.get('tempInvoiceId'); 
    const compressedKeyParam = searchParams.get('compressedImageKey');
    const docTypeParam = searchParams.get('docType') as 'deliveryNote' | 'invoice' | null;
    const invoiceIdParam = searchParams.get('invoiceId'); 
    
    const newScanFlag = !invoiceIdParam && !!(keyParam || tempInvIdParam);
    setIsNewScan(newScanFlag);
    console.log(`[EditInvoice][loadData] Flags: isNewScan: ${newScanFlag}, docTypeParam: ${docTypeParam}, keyParam: ${keyParam}, tempInvIdParam: ${tempInvIdParam}, invoiceIdParam: ${invoiceIdParam}`);

    if (newScanFlag) {
        console.log("[EditInvoice][loadData] New scan detected. Resetting relevant states.");
        setCurrentDialogStep('idle'); // Reset dialog step for new scans
        setSelectedPaymentDueDate(undefined);
        setIsSupplierConfirmed(false);
        setPotentialSupplierName(undefined);
        setAiScannedSupplierNameFromStorage(undefined);
        setIsPaymentDueDateDialogSkipped(false);
        setPromptingForNewProductDetails(null);
        setIsBarcodePromptOpen(false);
        setPriceDiscrepancies(null);
        setIsViewMode(true);
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
        setProductsForNextStep([]);
        setProductInputStates({});
        setProducts([]);
        setInitialScannedProducts([]);
        setEditableTaxInvoiceDetails({});
        setInitialScannedTaxDetails({});
        setExtractedSupplierName(undefined);
        setExtractedInvoiceNumber(undefined);
        setExtractedTotalAmount(undefined);
        setExtractedInvoiceDate(undefined);
        setExtractedPaymentMethod(undefined);
    } else if (invoiceIdParam) {
        console.log("[EditInvoice][loadData] Existing invoice mode. Setting dialog to ready_to_save.");
        setIsViewMode(true);
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
        setCurrentDialogStep('ready_to_save'); 
    } else { 
        console.log("[EditInvoice][loadData] New manual entry mode (no key/id). Setting view mode false.");
        setIsViewMode(false); 
        setIsEditingTaxDetails(true);
        setIsEditingDeliveryNoteProducts(true);
        setCurrentDialogStep('ready_to_save'); 
    }

    setInitialDataKey(keyParam);
    setInitialTempInvoiceId(tempInvIdParam);
    setInitialCompressedImageKey(compressedKeyParam);
    setDocumentType(docTypeParam);

    let uniquePartFromKeyOrTempId: string | null = null;
    if (keyParam?.startsWith(getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_`))) {
        uniquePartFromKeyOrTempId = keyParam.substring(getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_`).length);
    } else if (tempInvIdParam?.startsWith(`pending-inv-${user.id}_`)) {
        uniquePartFromKeyOrTempId = tempInvIdParam.substring(`pending-inv-${user.id}_`.length);
    }
    console.log(`[EditInvoice][loadData] Unique part for localStorage image keys: ${uniquePartFromKeyOrTempId}`);

    if (uniquePartFromKeyOrTempId) {
        setInitialOriginalImagePreviewKey(getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`));
    }

    if (nameParam) {
      setOriginalFileName(decodeURIComponent(nameParam));
    } else {
        setOriginalFileName(t('edit_invoice_unknown_document'));
    }
    
    if (invoiceIdParam) { 
        console.log(`[EditInvoice][loadData] Loading existing FINAL invoice ID: ${invoiceIdParam}`);
        try {
            const allUserInvoices = await getInvoicesService(user.id);
            const inv = allUserInvoices.find(i => i.id === invoiceIdParam);
            if (inv) {
                console.log("[EditInvoice][loadData] Existing final invoice found:", inv);
                let finalFileName = inv.generatedFileName || inv.originalFileName;
                setOriginalFileName(finalFileName);
                setDocumentType(inv.documentType as 'deliveryNote' | 'invoice' | null);
                
                const taxDetails = {
                    supplierName: inv.supplierName,
                    invoiceNumber: inv.invoiceNumber,
                    totalAmount: inv.totalAmount,
                    invoiceDate: inv.invoiceDate,
                    paymentMethod: inv.paymentMethod,
                };
                setEditableTaxInvoiceDetails(taxDetails);
                setInitialScannedTaxDetails(taxDetails);
                setExtractedSupplierName(inv.supplierName);
                setExtractedInvoiceNumber(inv.invoiceNumber);
                setExtractedTotalAmount(inv.totalAmount);
                setExtractedInvoiceDate(inv.invoiceDate);
                setExtractedPaymentMethod(inv.paymentMethod);

                setSelectedPaymentDueDate(inv.paymentDueDate ? (inv.paymentDueDate instanceof Timestamp ? inv.paymentDueDate.toDate() : (typeof inv.paymentDueDate === 'string' ? parseISO(inv.paymentDueDate) : undefined)) : undefined);

                setDisplayedOriginalImageUrl(inv.originalImagePreviewUri || null); 
                setDisplayedCompressedImageUrl(inv.compressedImageForFinalRecordUri || null);
                
                setProducts([]); 
                setInitialScannedProducts([]);
                setCurrentDialogStep('ready_to_save'); 
            } else {
                setErrorLoading(t('edit_invoice_error_invoice_not_found_id', { invoiceId: invoiceIdParam }));
                setCurrentDialogStep('error_loading');
            }
        } catch (e) {
            console.error("[EditInvoice][loadData] Error loading existing final invoice:", e);
            setErrorLoading(t('edit_invoice_error_loading_existing'));
            setCurrentDialogStep('error_loading');
        }
    } else if (keyParam || tempInvIdParam) { 
        console.log(`[EditInvoice][loadData] Loading new scan data. Key: ${keyParam}, TempInvId: ${tempInvIdParam}`);
        let storedData: string | null = null;
        let actualDataKey = keyParam; 

        if (!actualDataKey && tempInvIdParam && uniquePartFromKeyOrTempId) {
            actualDataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`);
        }
        console.log(`[EditInvoice][loadData] Actual localStorage data key: ${actualDataKey}`);

        try {
            if (actualDataKey) storedData = localStorage.getItem(actualDataKey);
            const previewKeyToLoad = initialOriginalImagePreviewKey || (uniquePartFromKeyOrTempId ? getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`) : null);
            const compressedKeyToLoad = initialCompressedImageKey || (uniquePartFromKeyOrTempId ? getStorageKey(TEMP_COMPRESSED_IMAGE_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`) : null);

            console.log(`[EditInvoice][loadData] Attempting to load images. PreviewKey: ${previewKeyToLoad}, CompressedKey: ${compressedKeyToLoad}`);
            if(previewKeyToLoad) setDisplayedOriginalImageUrl(localStorage.getItem(previewKeyToLoad));
            if(compressedKeyToLoad) setDisplayedCompressedImageUrl(localStorage.getItem(compressedKeyToLoad));

        } catch(e) {
            console.error("[EditInvoice][loadData] Error reading from localStorage for key:", actualDataKey, e);
            setErrorLoading(t('edit_invoice_error_localstorage_read'));
            setCurrentDialogStep('error_loading');
            cleanupTemporaryData();
            setIsLoading(false);
            setInitialDataLoaded(true);
            return;
        }

        if (!storedData) {
            setErrorLoading(t('edit_invoice_error_scan_results_not_found_key', {key: actualDataKey || 'unknown'}));
            setCurrentDialogStep('error_loading');
            toast({
              title: t('edit_invoice_toast_error_loading_title'),
              description: t('edit_invoice_toast_error_loading_desc_not_found_with_key', {key: actualDataKey || 'unknown'}),
              variant: "destructive",
            });
            cleanupTemporaryData();
            setIsLoading(false);
            setInitialDataLoaded(true);
            return;
        }

        let parsedData: ScanInvoiceOutput | ScanTaxInvoiceOutput;
        try {
            parsedData = JSON.parse(storedData);
            console.log("[EditInvoice][loadData] Parsed data from localStorage:", parsedData);
        } catch (jsonParseError) {
             console.error("[EditInvoice][loadData] Failed to parse JSON data from localStorage:", jsonParseError, "Raw data:", storedData);
             cleanupTemporaryData();
             setErrorLoading(t('edit_invoice_error_invalid_json'));
             setCurrentDialogStep('error_loading');
              toast({
                  title: t('edit_invoice_toast_error_loading_title'),
                  description: t('edit_invoice_toast_error_loading_desc_invalid_format'),
                  variant: "destructive",
              });
            setProducts([]);
            setInitialScannedProducts([]);
            setEditableTaxInvoiceDetails({});
            setInitialScannedTaxDetails({});
            setIsLoading(false);
            setInitialDataLoaded(true);
            return;
        }

        const generalError = (parsedData as any).error;
        if (generalError) {
          setScanProcessErrorState(generalError);
           console.log("[EditInvoice][loadData] Scan process error from parsed data:", generalError);
        }
        
        let supplierFromScan: string | undefined | null = null;
        let initialProductsFromScanData: Product[] = [];

        if (docTypeParam === 'invoice') { 
            console.log("[EditInvoice][loadData] Processing as Tax Invoice.");
            const taxData = parsedData as ScanTaxInvoiceOutput;
            setProducts([]);
            setInitialScannedProducts([]);
            const taxDetails = {
                supplierName: taxData.supplierName,
                invoiceNumber: taxData.invoiceNumber,
                totalAmount: taxData.totalAmount,
                invoiceDate: taxData.invoiceDate,
                paymentMethod: taxData.paymentMethod,
            };
            setEditableTaxInvoiceDetails(taxDetails);
            setInitialScannedTaxDetails(taxDetails);
            setExtractedSupplierName(taxData.supplierName);
            setExtractedInvoiceNumber(taxData.invoiceNumber);
            setExtractedTotalAmount(taxData.totalAmount);
            setExtractedInvoiceDate(taxData.invoiceDate);
            setExtractedPaymentMethod(taxData.paymentMethod);
            supplierFromScan = taxData.supplierName;
            setAiScannedSupplierNameFromStorage(supplierFromScan); 
        } else if (docTypeParam === 'deliveryNote') { 
            console.log("[EditInvoice][loadData] Processing as Delivery Note.");
            const productData = parsedData as ScanInvoiceOutput;
            if (productData && Array.isArray(productData.products)) {
              const productsWithIds = productData.products.map((p: Product, index: number) => ({
                ...p,
                id: p.id || `prod-temp-${Date.now()}-${index}`,
                _originalId: p.id, 
                quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
                unitPrice: p.unitPrice !== undefined ? (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice))) : undefined, 
                salePrice: undefined, // Always undefined initially for delivery notes
                minStockLevel: p.minStockLevel ?? undefined,
                maxStockLevel: p.maxStockLevel ?? undefined,
              }));
              initialProductsFromScanData = productsWithIds;
              setProducts(productsWithIds);
              setInitialScannedProducts(productsWithIds);
              console.log("[EditInvoice][loadData] Initial products set from delivery note scan:", productsWithIds);

              const deliveryNoteInvoiceDetails = {
                  supplierName: productData.supplier,
                  invoiceNumber: productData.invoiceNumber,
                  totalAmount: productData.totalAmount,
                  invoiceDate: productData.invoiceDate,
                  paymentMethod: productData.paymentMethod,
              };
              setEditableTaxInvoiceDetails(deliveryNoteInvoiceDetails);
              setInitialScannedTaxDetails(deliveryNoteInvoiceDetails);
              setExtractedInvoiceNumber(productData.invoiceNumber);
              setExtractedSupplierName(productData.supplier);
              setExtractedTotalAmount(productData.totalAmount);
              setExtractedInvoiceDate(productData.invoiceDate);
              setExtractedPaymentMethod(productData.paymentMethod);
              supplierFromScan = productData.supplier;
              setAiScannedSupplierNameFromStorage(supplierFromScan); 
            } else if (!productData.error){
                console.error("[EditInvoice][loadData] Parsed product data is missing 'products' array or is invalid:", productData);
                setErrorLoading(t('edit_invoice_error_invalid_structure_parsed'));
                setCurrentDialogStep('error_loading');
                setProducts([]);
                setInitialScannedProducts([]);
                toast({
                   title: t('edit_invoice_toast_error_loading_title'),
                   description: t('edit_invoice_toast_error_loading_desc_invalid_structure'),
                   variant: "destructive",
                });
            }
        } else {
             console.error("[EditInvoice][loadData] Unknown or missing docTypeParam:", docTypeParam, "Parsed Data:", parsedData);
             setErrorLoading(t('edit_invoice_error_unknown_document_type'));
             setCurrentDialogStep('error_loading');
             setProducts([]);
             setInitialScannedProducts([]);
             setEditableTaxInvoiceDetails({});
             setInitialScannedTaxDetails({});
        }

        if (newScanFlag && user?.id) {
            console.log(`[EditInvoice][loadData] New scan, setting productsForNextStep and initiating dialog flow. Supplier from scan: "${supplierFromScan}"`);
            setProductsForNextStep(initialProductsFromScanData); 
            await startDialogFlowForNewScan(supplierFromScan);
        }
    } else if (!initialDataLoaded) { 
       console.error("[EditInvoice][loadData] No keyParam, tempInvIdParam, or invoiceIdParam provided.");
       setErrorLoading(t('edit_invoice_error_no_key_or_id'));
       setCurrentDialogStep('error_loading');
       setProducts([]);
       setInitialScannedProducts([]);
       setEditableTaxInvoiceDetails({});
       setInitialScannedTaxDetails({});
       toast({
          title: t('edit_invoice_toast_no_data_title'),
          description: t('edit_invoice_toast_no_data_desc'),
          variant: "destructive",
        });
    }
    setIsLoading(false);
    setInitialDataLoaded(true);
    console.log("[EditInvoice][loadData] Finished.");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams, t, toast, cleanupTemporaryData, initialCompressedImageKey, initialOriginalImagePreviewKey, initialDataLoaded, startDialogFlowForNewScan]);


  useEffect(() => {
    if(user && user.id && !initialDataLoaded && !authLoading) { 
      console.log("[EditInvoice] useEffect (user, initialDataLoaded, authLoading): Calling loadData.");
      loadData();
    }
  }, [user, initialDataLoaded, authLoading, loadData]); 


  const handleSupplierConfirmation = useCallback(async (confirmedSupplierName: string | null, isNew: boolean = false) => {
    console.log(`[EditInvoice][handleSupplierConfirmation] Confirmed: "${confirmedSupplierName}", isNew: ${isNew}. Current Step: ${currentDialogStep}`);
    if (!user?.id) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        return;
    }

    let finalConfirmedName = confirmedSupplierName;
    if (finalConfirmedName) {
        setExtractedSupplierName(finalConfirmedName);
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
        if (isNew) {
            try {
                console.log(`[EditInvoice][handleSupplierConfirmation] Attempting to save new supplier '${finalConfirmedName}' via service.`);
                await updateSupplierContactInfoService(finalConfirmedName, {}, user.id, true); 
                toast({ title: t('edit_invoice_toast_new_supplier_added_title'), description: t('edit_invoice_toast_new_supplier_added_desc', { supplierName: finalConfirmedName }) });
            } catch (error: any) {
                console.error("[EditInvoice][handleSupplierConfirmation] Failed to add new supplier:", error);
                toast({ title: t('edit_invoice_toast_fail_add_supplier_title'), description: (error as Error).message, variant: "destructive" });
            }
        }
    } else {
        finalConfirmedName = aiScannedSupplierNameFromStorage || extractedSupplierName || null;
        setExtractedSupplierName(finalConfirmedName);
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
        console.log(`[EditInvoice][handleSupplierConfirmation] Supplier dialog outcome was null, using AI scanned/previous name: ${finalConfirmedName}`);
    }
    setIsSupplierConfirmed(true);
    processNextDialogStep('supplier_confirmed_or_skipped');
  }, [user, toast, t, aiScannedSupplierNameFromStorage, extractedSupplierName, processNextDialogStep, currentDialogStep]);


  const handlePaymentDueDateConfirm = useCallback(async (dueDate: string | Date | Timestamp | undefined) => {
    console.log(`[EditInvoice][PaymentDueDateDialog] Confirmed due date:`, dueDate, "CurrentStep before update:", currentDialogStep);
    setSelectedPaymentDueDate(dueDate);
    setIsPaymentDueDateDialogSkipped(false); 
    processNextDialogStep('payment_due_date_confirmed_or_skipped');
  }, [processNextDialogStep, currentDialogStep]);

  const handleCancelPaymentDueDate = useCallback(async () => {
    console.log("[EditInvoice][PaymentDueDateDialog] Skipped/Cancelled. CurrentStep before update:", currentDialogStep);
    setSelectedPaymentDueDate(undefined);
    setIsPaymentDueDateDialogSkipped(true); 
    processNextDialogStep('payment_due_date_confirmed_or_skipped');
  }, [processNextDialogStep, currentDialogStep]);


  const handleInputChange = (id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(p => {
        if (p.id === id) {
          const updatedProduct = { ...p };
          let numericValue: number | string | null | undefined = value;

          if (['quantity', 'unitPrice', 'lineTotal', 'minStockLevel', 'maxStockLevel', 'salePrice'].includes(field)) {
            const stringValue = String(value);
            if ((field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice') && stringValue.trim() === '') {
              numericValue = undefined;
            } else {
              numericValue = parseFloat(stringValue.replace(/,/g, ''));
              if (isNaN(numericValue as number)) {
                numericValue = (field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice') ? undefined : 0;
              }
            }
            (updatedProduct as any)[field] = numericValue;
          } else {
            (updatedProduct as any)[field] = value;
          }

          let currentQuantity = Number(updatedProduct.quantity) || 0;
          let currentUnitPrice = (updatedProduct.unitPrice !== undefined && updatedProduct.unitPrice !== null && !isNaN(Number(updatedProduct.unitPrice))) ? Number(updatedProduct.unitPrice) : 0;
          let currentLineTotal = Number(updatedProduct.lineTotal) || 0;


          if (field === 'quantity' || field === 'unitPrice') {
             if (currentQuantity > 0 && currentUnitPrice !== 0 ) { 
                currentLineTotal = parseFloat((currentQuantity * currentUnitPrice).toFixed(2));
             } else {
                currentLineTotal = 0; 
             }
            updatedProduct.lineTotal = currentLineTotal;
          } else if (field === 'lineTotal') {
            if (currentQuantity > 0 && currentLineTotal !== 0) { 
              currentUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
              updatedProduct.unitPrice = currentUnitPrice;
            } else if (currentLineTotal === 0) {
                 updatedProduct.unitPrice = 0;
            } else {
                 updatedProduct.unitPrice = (updatedProduct.unitPrice !== undefined) ? updatedProduct.unitPrice : 0;
            }
          }

          if (currentQuantity > 0 && currentLineTotal !== 0 ) {
            const derivedUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
            if (Math.abs(derivedUnitPrice - currentUnitPrice) > 0.001 && field !== 'unitPrice') {
                 updatedProduct.unitPrice = derivedUnitPrice;
            }
          } else if (currentQuantity === 0 || currentLineTotal === 0) { 
            updatedProduct.unitPrice = 0;
          }
          return updatedProduct;
        }
        return p;
      })
    );
  };

  const handleTaxInvoiceDetailsChange = (field: keyof EditableTaxInvoiceDetails, value: string | number | undefined | Date | Timestamp) => {
     setEditableTaxInvoiceDetails(prev => ({ ...prev, [field]: value === '' ? null : value })); 
        switch(field) {
            case 'supplierName': setExtractedSupplierName(String(value || '')); break;
            case 'invoiceNumber': setExtractedInvoiceNumber(String(value || '')); break;
            case 'totalAmount': setExtractedTotalAmount(value === '' || value === undefined ? null : Number(value)); break;
            case 'invoiceDate': setExtractedInvoiceDate(value instanceof Date ? value : (value instanceof Timestamp ? value : (typeof value === 'string' ? value : null))); break;
            case 'paymentMethod': setExtractedPaymentMethod(String(value || '')); break;
        }
  };


  const handleAddRow = () => {
    const newProduct: EditableProduct = {
      id: `prod-temp-${Date.now()}-new`,
      catalogNumber: '',
      description: '',
      quantity: 0,
      unitPrice: 0,
      lineTotal: 0,
      barcode: undefined,
      minStockLevel: undefined,
      maxStockLevel: undefined,
      salePrice: undefined,
    };
    setProducts(prevProducts => [...prevProducts, newProduct]);
  };

  const handleRemoveRow = (id: string) => {
    setProducts(prevProducts => prevProducts.filter(product => product.id !== id));
     toast({
        title: t('edit_invoice_toast_row_removed_title'),
        description: t('edit_invoice_toast_row_removed_desc'),
        variant: "default",
     });
  };

 const proceedWithFinalSave = async (finalProductsToSave: Product[]) => {
      console.log("[EditInvoice] proceedWithFinalSave called with products:", finalProductsToSave);
      if (!user?.id || !documentType) {
          toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
          setCurrentDialogStep('error_loading');
          setIsSaving(false);
          return;
      }
      // isSaving should already be true here
      try {
          const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => rest);

          let finalFileNameForSave = originalFileName;
          const finalSupplierNameForSave = extractedSupplierName;
          const finalInvoiceNumberForSave = extractedInvoiceNumber;
          const finalTotalAmountForSave = extractedTotalAmount;
          const finalInvoiceDateForSave = extractedInvoiceDate;
          const finalPaymentMethodForSave = extractedPaymentMethod;

          if(finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '' && finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
            finalFileNameForSave = `${finalSupplierNameForSave}_${finalInvoiceNumberForSave}`;
          } else if (finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '') {
            finalFileNameForSave = finalSupplierNameForSave;
          } else if (finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
            finalFileNameForSave = `Invoice_${finalInvoiceNumberForSave}`;
          }
          finalFileNameForSave = finalFileNameForSave.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);


          const result = await finalizeSaveProductsService(
            productsForService,
            finalFileNameForSave,
            documentType,
            user.id,
            initialTempInvoiceId || undefined,
            finalInvoiceNumberForSave || undefined,
            finalSupplierNameForSave || undefined,
            finalTotalAmountForSave ?? undefined,
            selectedPaymentDueDate ? (selectedPaymentDueDate instanceof Timestamp ? selectedPaymentDueDate : (selectedPaymentDueDate instanceof Date ? selectedPaymentDueDate.toISOString() : selectedPaymentDueDate)) : undefined,
            finalInvoiceDateForSave || undefined,
            finalPaymentMethodForSave || undefined,
            displayedOriginalImageUrl || undefined,
            displayedCompressedImageUrl || undefined
          );
          console.log("[EditInvoice] proceedWithFinalSave: finalizeSaveProductsService result:", result);
          cleanupTemporaryData();

          if (result.finalInvoiceRecord) {
            setOriginalFileName(result.finalInvoiceRecord.generatedFileName); 
            setInitialTempInvoiceId(result.finalInvoiceRecord.id); // Update temp ID to final ID for non-new scans
            setDocumentType(result.finalInvoiceRecord.documentType as 'deliveryNote' | 'invoice' | null);
            
            const finalTaxDetails = {
                supplierName: result.finalInvoiceRecord.supplierName,
                invoiceNumber: result.finalInvoiceRecord.invoiceNumber,
                totalAmount: result.finalInvoiceRecord.totalAmount,
                invoiceDate: result.finalInvoiceRecord.invoiceDate,
                paymentMethod: result.finalInvoiceRecord.paymentMethod,
            };
            setEditableTaxInvoiceDetails(finalTaxDetails);
            setInitialScannedTaxDetails(finalTaxDetails);
            setExtractedSupplierName(result.finalInvoiceRecord.supplierName);
            setExtractedInvoiceNumber(result.finalInvoiceRecord.invoiceNumber);
            setExtractedTotalAmount(result.finalInvoiceRecord.totalAmount);
            setExtractedInvoiceDate(result.finalInvoiceRecord.invoiceDate);
            setExtractedPaymentMethod(result.finalInvoiceRecord.paymentMethod);

            setSelectedPaymentDueDate(result.finalInvoiceRecord.paymentDueDate ? (result.finalInvoiceRecord.paymentDueDate instanceof Timestamp ? result.finalInvoiceRecord.paymentDueDate.toDate() : parseISO(result.finalInvoiceRecord.paymentDueDate as string)) : undefined);
            setDisplayedOriginalImageUrl(result.finalInvoiceRecord.originalImagePreviewUri || null);
            setDisplayedCompressedImageUrl(result.finalInvoiceRecord.compressedImageForFinalRecordUri || null);

            if (result.savedProductsWithFinalIds) {
                const finalProducts = result.savedProductsWithFinalIds.map(p => ({ ...p, _originalId: p.id }));
                setProducts(finalProducts);
                setInitialScannedProducts(finalProducts);
            }
            setScanProcessErrorState(result.finalInvoiceRecord.errorMessage || null);
            setIsEditingDeliveryNoteProducts(false);
            setIsEditingTaxDetails(false);
            setIsViewMode(true);
            setCurrentDialogStep('idle');
             toast({
                title: t('edit_invoice_toast_products_saved_title'),
                description: t('edit_invoice_toast_products_saved_desc'),
            });
            if (documentType === 'deliveryNote') {
                 router.push('/inventory?refresh=true');
            } else if (documentType === 'invoice') {
                 router.push('/invoices?tab=scanned-docs');
            }
          } else {
             console.error("[EditInvoice] proceedWithFinalSave: Final invoice record not returned or error occurred.", result);
             setScanProcessErrorState(t('edit_invoice_toast_save_failed_desc_finalize', { message: "Final invoice record not returned."}));
             setCurrentDialogStep('error_loading');
          }
      } catch (error: any) {
          console.error("[EditInvoice] proceedWithFinalSave: Failed to finalize save products:", error);
           if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            toast({
                title: t('upload_toast_storage_full_title_critical'),
                description: t('upload_toast_storage_full_desc_finalize', {context: "(finalize save)"}),
                variant: "destructive",
                duration: 10000,
            });
          } else {
            toast({
                title: t('edit_invoice_toast_save_failed_title'),
                description: t('edit_invoice_toast_save_failed_desc_finalize', { message: (error as Error).message || t('edit_invoice_try_again')}),
                variant: "destructive",
            });
          }
          setCurrentDialogStep('error_loading');
      } finally {
          console.log("[EditInvoice] proceedWithFinalSave: Setting isSaving to false.");
          setIsSaving(false);
      }
  };


 const handleSaveChecks = async () => {
    console.log(`[EditInvoice][handleSaveChecks] Called. CurrentDialogStep: ${currentDialogStep}, isNewScan: ${isNewScan}, isSaving: ${isSaving}`);
    if (isSaving) {
        console.log("[EditInvoice][handleSaveChecks] Already saving, returning.");
        return;
    }
    setIsSaving(true);

    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        setIsSaving(false);
        return;
    }

    if (isNewScan) {
        console.log("[EditInvoice][handleSaveChecks] Is a new scan. Current Dialog Step:", currentDialogStep);
        if (currentDialogStep === 'idle' || currentDialogStep === 'supplier_confirmation' || currentDialogStep === 'error_loading') {
            console.log("[EditInvoice][handleSaveChecks] New scan in early dialog step. Attempting to (re)start dialog flow.");
            await startDialogFlowForNewScan(aiScannedSupplierNameFromStorage || extractedSupplierName || initialScannedTaxDetails.supplierName);
            setIsSaving(false); // Release save button as dialog flow will handle progression
            return;
        } else if (currentDialogStep === 'payment_due_date') {
            console.log("[EditInvoice][handleSaveChecks] New scan, awaiting payment due date. Dialog should be open.");
            // The PaymentDueDateDialog should be open and handling this.
            // User needs to confirm or skip it.
            setIsSaving(false); // Release save button, user interacts with dialog
            return;
        } else if (currentDialogStep === 'new_product_details') {
             console.log("[EditInvoice][handleSaveChecks] New scan, awaiting new product details. BarcodePromptDialog should be open.");
            // The BarcodePromptDialog should be open.
            // User needs to confirm/skip products.
            setIsSaving(false); // Release save button
            return;
        } else if (currentDialogStep === 'price_discrepancy') {
            console.log("[EditInvoice][handleSaveChecks] New scan, awaiting price discrepancy resolution. UnitPriceConfirmationDialog should be open.");
            setIsSaving(false); // Release save button
            return;
        }
        // If currentDialogStep is 'ready_to_save', it will fall through to proceedWithActualSave
        console.log("[EditInvoice][handleSaveChecks] New scan, dialog step is 'ready_to_save' or unhandled. Proceeding to actual save logic.");
    }
    
    console.log("[EditInvoice][handleSaveChecks] Proceeding to actual save logic.");
    await proceedWithActualSave();
};

const proceedWithActualSave = async () => {
    console.log("[EditInvoice] proceedWithActualSave called with current products state:", products);
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        setIsSaving(false); 
        return;
    }

    const currentProductsToProcess = products.map(({ _originalId, ...rest }) => rest);
    console.log("[EditInvoice] proceedWithActualSave: currentProductsToProcess:", currentProductsToProcess);

    if (documentType === 'invoice') {
        console.log("[EditInvoice] proceedWithActualSave: Document is Tax Invoice, calling proceedWithFinalSave with empty products array (details only).");
        await proceedWithFinalSave([]); // Tax invoices don't have line items in our current model for inventory
        return;
    }

    // For deliveryNote
    try {
        const priceCheckResult = await checkProductPricesBeforeSaveService(currentProductsToProcess, user.id);
        let productsAfterPriceCheck = [...priceCheckResult.productsToSaveDirectly]; 
        
        if (priceCheckResult.priceDiscrepancies.length > 0) {
            console.log("[EditInvoice] proceedWithActualSave: Price discrepancies found. Setting currentDialogStep to 'price_discrepancy'.");
            setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
            setProductsForNextStep([...priceCheckResult.productsToSaveDirectly, ...priceCheckResult.priceDiscrepancies.map(d => ({...d, unitPrice: d.newUnitPrice}))]); // Use newUnitPrice for review
            setCurrentDialogStep('price_discrepancy');
            // isSaving is already true, will be set to false by dialog completion
            return; 
        }
        
        console.log("[EditInvoice] proceedWithActualSave: No price discrepancies. Current productsForNextStep for BarcodePrompt:", productsAfterPriceCheck);
        
        const {needsReview, productsToReview} = await checkForNewProductsAndDetails(productsAfterPriceCheck, false); // Call with isDialogFlowContinuation = false
        if (needsReview) {
            console.log("[EditInvoice] proceedWithActualSave: Products need barcode/sale price review. Setting currentDialogStep to 'new_product_details'.");
            // productsToDisplayForNewDetails is already set by checkForNewProductsAndDetails
            // isBarcodePromptOpen will be set by the new_product_details step
            setCurrentDialogStep('new_product_details');
            // isSaving is already true, will be set to false by dialog completion
            return;
        }
        
        console.log("[EditInvoice] proceedWithActualSave: All checks passed. Proceeding to final save with products:", productsAfterPriceCheck);
        await proceedWithFinalSave(productsAfterPriceCheck);
    } catch (error) {
        console.error("[EditInvoice] proceedWithActualSave: Error during save checks or final save:", error);
        toast({
            title: t('edit_invoice_toast_error_preparing_save_title'),
            description: t('edit_invoice_toast_error_preparing_save_desc', { message: (error as Error).message}),
            variant: "destructive",
        });
        setCurrentDialogStep('error_loading');
        setIsSaving(false); // Ensure isSaving is reset on error
    }
    // Removed finally block here, isSaving should be managed by the paths above or by proceedWithFinalSave
};


const checkForNewProductsAndDetails = useCallback(async (productsToCheck: Product[], isDialogFlowContinuation: boolean): Promise<{needsReview: boolean, productsToReview: Product[]}> => {
    console.log(`[EditInvoice][checkForNewProductsAndDetails] Called. isDialogFlowContinuation: ${isDialogFlowContinuation}, productsToCheck count: ${productsToCheck.length}`);
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        if (isDialogFlowContinuation) setCurrentDialogStep('error_loading');
        return {needsReview: false, productsToReview: []};
    }

    if (productsToCheck.length === 0 && documentType === 'deliveryNote') {
        console.log("[EditInvoice][checkForNewProductsAndDetails] No products for detail check (delivery note).");
        if (isDialogFlowContinuation) processNextDialogStep('new_product_details', []); 
        else setCurrentDialogStep('ready_to_save'); // If not part of dialog flow, and no products, we're ready.
        setPromptingForNewProductDetails(null);
        setIsBarcodePromptOpen(false);
        return {needsReview: false, productsToReview: []};
    }
    if(documentType === 'invoice') { 
        console.log("[EditInvoice][checkForNewProductsAndDetails] Tax invoice, skipping new product details check.");
        if(isDialogFlowContinuation) processNextDialogStep('new_product_details', []);
        else setCurrentDialogStep('ready_to_save');
        setPromptingForNewProductDetails(null);
        setIsBarcodePromptOpen(false);
        return {needsReview: false, productsToReview: []};
    }

    try {
        const currentInventory = await getProductsService(user.id);
        const inventoryMap = new Map<string, Product>();
        currentInventory.forEach(p => {
            if (p.id) inventoryMap.set(`id:${p.id}`, p);
            if (p.catalogNumber && p.catalogNumber !== "N/A") inventoryMap.set(`catalog:${p.catalogNumber}`, p);
            if (p.barcode) inventoryMap.set(`barcode:${p.barcode}`, p);
        });

        const productsRequiringDetailsReview = productsToCheck.filter(p => {
            const existingInInventory = (p.id && !p.id.startsWith('prod-temp-') && inventoryMap.has(`id:${p.id}`)) ||
                                      (p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`)) ||
                                      (p.barcode && inventoryMap.has(`barcode:${p.barcode}`));
            const needsSalePriceReview = p.salePrice === undefined || p.salePrice === null || Number(p.salePrice) <= 0;
            
            if (!existingInInventory) { // Definitely a new product, requires review if sale price not set.
                return needsSalePriceReview;
            }
            // Product exists in inventory, only review if sale price is missing/invalid
            const inventoryProduct = inventoryMap.get(`id:${p.id}`) || inventoryMap.get(`catalog:${p.catalogNumber}`) || inventoryMap.get(`barcode:${p.barcode}`);
            return (inventoryProduct?.salePrice === undefined || inventoryProduct?.salePrice === null || Number(inventoryProduct?.salePrice) <=0) && needsSalePriceReview;
        });
        console.log("[EditInvoice][checkForNewProductsAndDetails] Products needing details review count:", productsRequiringDetailsReview.length);
        
        const initialInputStatesForPrompt: Record<string, { barcode: string; salePrice?: number }> = {};
        productsRequiringDetailsReview.forEach(p => {
            initialInputStatesForPrompt[p.id] = { barcode: p.barcode || '', salePrice: p.salePrice };
        });
        setProductInputStates(initialInputStatesForPrompt);
        setProductsToDisplayForNewDetails(productsRequiringDetailsReview);
        setPromptingForNewProductDetails(productsRequiringDetailsReview);


        if (productsRequiringDetailsReview.length > 0) {
            setIsBarcodePromptOpen(true); // This will now control the BarcodePromptDialog visibility via currentDialogStep
            if (isDialogFlowContinuation) setCurrentDialogStep('new_product_details');
            return {needsReview: true, productsToReview: productsRequiringDetailsReview};
        } else {
            console.log("[EditInvoice][checkForNewProductsAndDetails] No new products needing details.");
            setIsBarcodePromptOpen(false);
            setPromptingForNewProductDetails(null);
            if (isDialogFlowContinuation) processNextDialogStep('new_product_details', productsToCheck); 
            else setCurrentDialogStep('ready_to_save');
            return {needsReview: false, productsToReview: []};
        }
    } catch (error) {
        console.error("[EditInvoice][checkForNewProductsAndDetails] Error checking inventory:", error);
        toast({ title: t('edit_invoice_toast_error_new_product_details_title'), description: t('edit_invoice_toast_error_new_product_details_desc'), variant: "destructive" });
        setIsBarcodePromptOpen(false);
        setPromptingForNewProductDetails(null);
        if(isDialogFlowContinuation) setCurrentDialogStep('error_loading'); // Or some other error state
        else setCurrentDialogStep('ready_to_save'); // Allow save if not in dialog flow, to avoid getting stuck
        return {needsReview: false, productsToReview: []}; 
    }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user?.id, documentType, toast, t, processNextDialogStep]);


const handlePriceConfirmationComplete = useCallback(async (resolvedProducts: Product[] | null) => {
    console.log("[EditInvoice][handlePriceConfirmationComplete] Resolved products count:", resolvedProducts ? resolvedProducts.length : 'null (cancelled)', "CurrentStep:", currentDialogStep);
    setPriceDiscrepancies(null);
    if (resolvedProducts) {
        setProductsForNextStep(resolvedProducts);
    }
    processNextDialogStep('price_discrepancy', resolvedProducts);
}, [processNextDialogStep, currentDialogStep]);


 const handleNewProductDetailsComplete = useCallback(async (updatedNewProductsFromDialog: Product[] | null) => {
     console.log("[EditInvoice][handleNewProductDetailsComplete] Updated products from dialog:", updatedNewProductsFromDialog, "CurrentStep:", currentDialogStep);
     setIsBarcodePromptOpen(false); 
     setPromptingForNewProductDetails(null);
     
     let finalProductsForSave: Product[];
     if (updatedNewProductsFromDialog) {
        const updatedProductMap = new Map(updatedNewProductsFromDialog.map(p => [p.id, p]));
        finalProductsForSave = productsForNextStep.map(originalProduct => 
            updatedProductMap.get(originalProduct.id) || originalProduct
        );
     } else { 
        console.log("[EditInvoice] New product details prompt cancelled. Using productsForNextStep as is.");
        finalProductsForSave = productsForNextStep;
     }
     
     setProducts(finalProductsForSave.map(p => ({...p, _originalId: p.id })));
     setProductsForNextStep(finalProductsForSave); 
     processNextDialogStep('new_product_details', finalProductsForSave); // Use 'new_product_details' as previousStepOutcome
 }, [productsForNextStep, processNextDialogStep, currentDialogStep]);


    const handleGoBack = () => {
        console.log("[EditInvoice] handleGoBack called. Cleaning up temp data and navigating.");
        cleanupTemporaryData();
        router.push(isNewScan ? '/upload' : '/invoices?tab=scanned-docs');
    };

    const handleCancelEditTaxDetails = () => {
        setEditableTaxInvoiceDetails(initialScannedTaxDetails);
        if (documentType === 'deliveryNote' || documentType === 'invoice') {
          setExtractedSupplierName(initialScannedTaxDetails.supplierName);
          setExtractedInvoiceNumber(initialScannedTaxDetails.invoiceNumber);
          setExtractedTotalAmount(initialScannedTaxDetails.totalAmount);
          setExtractedInvoiceDate(initialScannedTaxDetails.invoiceDate);
          setExtractedPaymentMethod(initialScannedTaxDetails.paymentMethod);
        }
        setIsEditingTaxDetails(false);
        if (!isEditingDeliveryNoteProducts) setIsViewMode(true);
    };

    const handleSaveEditTaxDetails = () => {
        if (documentType === 'invoice' || documentType === 'deliveryNote') {
            setExtractedSupplierName(editableTaxInvoiceDetails.supplierName);
            setExtractedInvoiceNumber(editableTaxInvoiceDetails.invoiceNumber);
            setExtractedTotalAmount(editableTaxInvoiceDetails.totalAmount);
            setExtractedInvoiceDate(editableTaxInvoiceDetails.invoiceDate);
            setExtractedPaymentMethod(editableTaxInvoiceDetails.paymentMethod);
        }
        setInitialScannedTaxDetails({...editableTaxInvoiceDetails});
        setIsEditingTaxDetails(false);
        if (!isEditingDeliveryNoteProducts) setIsViewMode(true);
        toast({ title: t('edit_invoice_toast_section_updated_title'), description: t('edit_invoice_toast_section_updated_desc') });
    };

    const handleCancelEditProducts = () => {
        setProducts(initialScannedProducts.map(p => ({...p})));
        setIsEditingDeliveryNoteProducts(false);
         if (!isEditingTaxDetails) setIsViewMode(true);
    };

    const handleSaveEditProducts = () => {
        setInitialScannedProducts(products.map(p => ({...p})));
        setIsEditingDeliveryNoteProducts(false);
        if (!isEditingTaxDetails) setIsViewMode(true);
        toast({ title: t('edit_invoice_toast_products_updated_title_section'), description: t('edit_invoice_toast_section_updated_desc') });
    };

    const toggleEditTaxDetails = () => {
        if (isEditingTaxDetails) {
            handleSaveEditTaxDetails();
        } else {
            setEditableTaxInvoiceDetails({...initialScannedTaxDetails});
            setIsEditingTaxDetails(true);
            setIsViewMode(false);
        }
    };
    
    const toggleEditDeliveryNoteProducts = () => {
        if (isEditingDeliveryNoteProducts) {
            handleSaveEditProducts();
        } else {
            setProducts([...initialScannedProducts]);
            setIsEditingDeliveryNoteProducts(true);
            setIsViewMode(false);
        }
    };


   if (authLoading || (isLoading && !initialDataLoaded)) {
     return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <span className="ml-2">{t('loading_editor')}...</span>
        </div>
     );
   }

   if (!user && !authLoading) {
    return null;
   }

    if (currentDialogStep === 'error_loading' || errorLoading) {
        return (
            <div className="container mx-auto p-4 md:p-8 space-y-4">
                <Alert variant="destructive">
                    <AlertTitle>{t('edit_invoice_error_loading_title')}</AlertTitle>
                    <AlertDescription>{errorLoading || "An unknown error occurred."}</AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleGoBack}>
                   <ArrowLeft className="mr-2 h-4 w-4" /> {t('edit_invoice_go_back_button')}
                </Button>
            </div>
        );
    }

    const showManualEntryPrompt = isNewScan && currentDialogStep !== 'error_loading' && !isLoading &&
        ((documentType === 'deliveryNote' && products.length === 0 && !scanProcessErrorState) ||
         (scanProcessErrorState && ((documentType === 'deliveryNote' && products.length === 0) || (documentType === 'invoice' && Object.values(editableTaxInvoiceDetails).every(val => val === undefined || val === '' || val === 0 || val === null)))));


    if (showManualEntryPrompt) {
         return (
             <div className="container mx-auto p-4 md:p-8 space-y-4">
                 {scanProcessErrorState && (
                    <Alert variant="destructive">
                        <AlertTitle>{t('edit_invoice_scan_process_error_title')}</AlertTitle>
                        <AlertDescription>
                            {t('edit_invoice_scan_process_error_desc', { error: scanProcessErrorState })}
                        </AlertDescription>
                    </Alert>
                 )}
                 {!scanProcessErrorState && documentType === 'deliveryNote' && products.length === 0 && (
                     <Alert variant="default">
                         <AlertTitle>{t('edit_invoice_no_products_found_title')}</AlertTitle>
                         <AlertDescription>
                            {t('edit_invoice_no_products_found_desc')}
                         </AlertDescription>
                     </Alert>
                 )}
                 <Card className="shadow-md scale-fade-in">
                     <CardHeader>
                         <CardTitle className="text-xl sm:text-2xl font-semibold text-primary">{t('edit_invoice_add_manually_title')}</CardTitle>
                         <CardDescription>
                            {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
                         </CardDescription>
                     </CardHeader>
                      <CardContent>
                           {documentType === 'deliveryNote' && (
                             <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                                <Button variant="outline" onClick={() => { handleAddRow(); setIsEditingDeliveryNoteProducts(true); setIsViewMode(false); setCurrentDialogStep('ready_to_save');}} className="w-full sm:w-auto">
                                <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                                </Button>
                                <Button 
                                    onClick={handleSaveChecks} 
                                     disabled={isSaving || (isNewScan && currentDialogStep !== 'ready_to_save')}
                                    className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                                >
                                {isSaving ? (
                                    <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...
                                    </>
                                ) : (
                                    <>
                                    <Save className="mr-2 h-4 w-4" /> {t('edit_invoice_save_changes_button')}
                                    </>
                                )}
                                </Button>
                            </div>
                           )}
                           {documentType === 'invoice' && (
                            <React.Fragment key="invoice-manual-entry-block">
                                 {renderEditableTaxInvoiceDetails()}
                                <Button 
                                    onClick={handleSaveChecks} 
                                     disabled={isSaving || (isNewScan && currentDialogStep !== 'ready_to_save')}
                                    className="bg-primary hover:bg-primary/90 w-full sm:w-auto mt-4"
                                >
                                 {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {t('edit_invoice_save_changes_button')}</>}
                                </Button>
                             </React.Fragment>
                           )}
                           <div className="mt-6">
                               <Button variant="outline" onClick={handleGoBack}>
                                   <ArrowLeft className="mr-2 h-4 w-4" /> {t('edit_invoice_go_back_button')}
                               </Button>
                           </div>
                      </CardContent>
                 </Card>
             </div>
         );
    }

    const renderScanSummaryItem = (labelKey: string, value?: string | number | null | Timestamp, field?: keyof EditableTaxInvoiceDetails) => {
        if (value === undefined || value === null || String(value).trim() === '') return null;
        let displayValue = String(value); 
        if (typeof value === 'number') {
             displayValue = t('currency_symbol') + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2});
        } else if ((field === 'invoiceDate' || field === 'paymentDueDate') && value) {
             let dateToFormat: Date | null = null;
             if (value instanceof Timestamp) dateToFormat = value.toDate();
             else if (typeof value === 'string') {
                 const parsed = parseISO(value);
                 if (isValid(parsed)) dateToFormat = parsed;
             } else if (value instanceof Date && isValid(value)) {
                 dateToFormat = value;
             }

             if (dateToFormat && isValid(dateToFormat)) {
                 displayValue = format(dateToFormat, 'PP');
             }
        }

        return (
            <div className="break-words">
                <p className="text-sm text-muted-foreground">{t(labelKey)}</p>
                <p className="font-medium">{displayValue}</p>
            </div>
        );
    };


    const renderReadOnlyTaxInvoiceDetails = () => {
        const detailsToDisplay = initialScannedTaxDetails;

        const noDetailsAvailable = Object.values(detailsToDisplay).every(
             val => val === undefined || val === null || String(val).trim() === ''
        );

        if (noDetailsAvailable && !isNewScan) {
            return <p className="text-sm text-muted-foreground">{t('edit_invoice_no_details_extracted')}</p>;
        }
        if(noDetailsAvailable && isNewScan && !scanProcessErrorState && currentDialogStep !== 'ready_to_save' && currentDialogStep !== 'error_loading'){
             return <p className="text-sm text-muted-foreground">{t('edit_invoice_awaiting_scan_details')}</p>;
        }

        return (
             <div className="space-y-3">
                {renderScanSummaryItem('invoice_details_supplier_label', detailsToDisplay.supplierName)}
                {renderScanSummaryItem('invoice_details_invoice_number_label', detailsToDisplay.invoiceNumber)}
                {renderScanSummaryItem('invoice_details_total_amount_label', detailsToDisplay.totalAmount)}
                {renderScanSummaryItem('invoice_details_invoice_date_label', detailsToDisplay.invoiceDate, 'invoiceDate')}
                {renderScanSummaryItem('invoice_details_payment_method_label', detailsToDisplay.paymentMethod)}
             </div>
        );
    };


    const renderEditableTaxInvoiceDetails = () => (
         <div className="space-y-4">
            <div>
                <Label htmlFor="taxSupplierName">{t('invoice_details_supplier_label')}</Label>
                <Input id="taxSupplierName" value={editableTaxInvoiceDetails.supplierName || ''} onChange={(e) => handleTaxInvoiceDetailsChange('supplierName', e.target.value)} disabled={isSaving} />
            </div>
            <div>
                <Label htmlFor="taxInvoiceNumber">{t('invoice_details_invoice_number_label')}</Label>
                <Input id="taxInvoiceNumber" value={editableTaxInvoiceDetails.invoiceNumber || ''} onChange={(e) => handleTaxInvoiceDetailsChange('invoiceNumber', e.target.value)} disabled={isSaving} />
            </div>
            <div>
                <Label htmlFor="taxTotalAmount">{t('invoice_details_total_amount_label')}</Label>
                <Input id="taxTotalAmount" type="number" value={editableTaxInvoiceDetails.totalAmount ?? ''} onChange={(e) => handleTaxInvoiceDetailsChange('totalAmount', e.target.value === '' ? undefined : parseFloat(e.target.value))} disabled={isSaving} />
            </div>
            <div>
                <Label htmlFor="taxInvoiceDate">{t('invoice_details_invoice_date_label')}</Label>
                <Input
                    id="taxInvoiceDate"
                    type="date"
                    value={editableTaxInvoiceDetails.invoiceDate ? (editableTaxInvoiceDetails.invoiceDate instanceof Timestamp ? format(editableTaxInvoiceDetails.invoiceDate.toDate(), 'yyyy-MM-dd') : (typeof editableTaxInvoiceDetails.invoiceDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate)) ? format(parseISO(editableTaxInvoiceDetails.invoiceDate), 'yyyy-MM-dd') : '')) : ''}
                    onChange={(e) => handleTaxInvoiceDetailsChange('invoiceDate', e.target.value ? parseISO(e.target.value).toISOString() : undefined)}
                    disabled={isSaving} />
            </div>
            <div>
                <Label htmlFor="taxPaymentMethod">{t('invoice_details_payment_method_label')}</Label>
                 <Select 
                    value={editableTaxInvoiceDetails.paymentMethod || ''} 
                    onValueChange={(value) => handleTaxInvoiceDetailsChange('paymentMethod', value)}
                    disabled={isSaving}
                >
                    <SelectTrigger className="mt-1">
                        <SelectValue placeholder={t('invoice_details_payment_method_placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="cash">{t('payment_method_cash')}</SelectItem>
                        <SelectItem value="credit_card">{t('payment_method_credit_card')}</SelectItem>
                        <SelectItem value="bank_transfer">{t('payment_method_bank_transfer')}</SelectItem>
                        <SelectItem value="check">{t('payment_method_check')}</SelectItem>
                        <SelectItem value="other">{t('payment_method_other')}</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
        {/* Invoice Details Section */}
        <Card className="shadow-md scale-fade-in overflow-hidden">
             <CardHeader>
                <div className="flex flex-row items-center justify-between">
                    <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                        <FileTextIconLucide className="mr-2 h-5 w-5" />
                        {documentType === 'invoice' ? t('edit_invoice_invoice_details_title') : t('edit_invoice_delivery_note_details_title')}
                    </CardTitle>
                     {isViewMode && !isEditingTaxDetails && (
                        <Button variant="ghost" size="icon" onClick={toggleEditTaxDetails} className="h-8 w-8 text-muted-foreground hover:text-primary">
                            <Edit className="h-4 w-4" />
                            <span className="sr-only">{t('edit_button')}</span>
                        </Button>
                     )}
                </div>
                <CardDescription className="break-words">
                    {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
                    {(initialScannedTaxDetails.supplierName) &&
                        ` | ${t('edit_invoice_supplier', { supplierName: (initialScannedTaxDetails.supplierName) })}`}
                </CardDescription>
                 {scanProcessErrorState && !isSaving && (
                    <Alert variant="destructive" className="mt-2">
                        <AlertTitle>{t('edit_invoice_scan_process_error_title')}</AlertTitle>
                        <AlertDescription>{scanProcessErrorState}</AlertDescription>
                    </Alert>
                )}
            </CardHeader>
            <CardContent className="space-y-6">
                 <div className={cn("border rounded-lg p-4", isEditingTaxDetails && "bg-muted/20")}>
                    {isEditingTaxDetails ? renderEditableTaxInvoiceDetails() : renderReadOnlyTaxInvoiceDetails()}
                </div>
                 {isEditingTaxDetails && (
                    <CardFooter className="flex justify-end gap-2 pt-4">
                        <Button variant="outline" onClick={handleCancelEditTaxDetails} disabled={isSaving}>{t('cancel_button')}</Button>
                        <Button onClick={handleSaveEditTaxDetails} disabled={isSaving}>{t('save_button')}</Button>
                    </CardFooter>
                 )}
            </CardContent>
        </Card>

        {/* Products Table / Image Preview Section */}
        <div className="mt-6">
            {documentType === 'deliveryNote' && (
                <>
                <div className="flex flex-row items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold text-primary">{t('edit_invoice_extracted_products_title')} ({products.length})</h2>
                    {isViewMode && !isEditingDeliveryNoteProducts && products.length > 0 && (
                        <Button variant="ghost" size="icon" onClick={toggleEditDeliveryNoteProducts} className="h-8 w-8 text-muted-foreground hover:text-primary">
                            <Edit className="h-4 w-4" />
                             <span className="sr-only">{t('edit_button')}</span>
                        </Button>
                    )}
                </div>
                 {products.length > 0 || isEditingDeliveryNoteProducts ? (
                     <div className="overflow-x-auto relative border rounded-md bg-card">
                         <Table className="min-w-full sm:min-w-[600px]">
                         <TableHeader>
                             <TableRow>
                             <TableHead className="px-2 sm:px-4 py-2">{t('edit_invoice_th_catalog')}</TableHead>
                             <TableHead className="px-2 sm:px-4 py-2">{t('edit_invoice_th_description')}</TableHead>
                             <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_qty')}</TableHead>
                             <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_unit_price', { currency_symbol: t('currency_symbol') })}</TableHead>
                             <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_line_total', { currency_symbol: t('currency_symbol') })}</TableHead>
                             {isEditingDeliveryNoteProducts && <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_actions')}</TableHead>}
                             </TableRow>
                         </TableHeader>
                         <TableBody>
                             {products.map(product => (
                                 <TableRow key={product.id}>
                                     <TableCell className="px-2 sm:px-4 py-2 max-w-[100px] sm:max-w-xs truncate">
                                         {isEditingDeliveryNoteProducts ? (
                                             <Input value={product.catalogNumber || ''} onChange={(e) => handleInputChange(product.id, 'catalogNumber', e.target.value)} className="h-9" disabled={isSaving}/>
                                         ) : (
                                             product.catalogNumber || t('invoices_na')
                                         )}
                                     </TableCell>
                                     <TableCell className="px-2 sm:px-4 py-2 max-w-[150px] sm:max-w-md truncate">
                                          {isEditingDeliveryNoteProducts ? (
                                             <Input value={product.description || ''} onChange={(e) => handleInputChange(product.id, 'description', e.target.value)} className="h-9" disabled={isSaving}/>
                                          ) : (
                                             product.description || t('invoices_na')
                                          )}
                                     </TableCell>
                                      <TableCell className="text-right px-2 sm:px-4 py-2">
                                          {isEditingDeliveryNoteProducts ? (
                                             <Input type="number" value={formatInputValue(product.quantity, 'quantity', t)} onChange={(e) => handleInputChange(product.id, 'quantity', e.target.value)} className="w-20 sm:w-24 text-right h-9" disabled={isSaving}/>
                                          ) : (
                                             formatInputValue(product.quantity, 'quantity', t)
                                          )}
                                     </TableCell>
                                     <TableCell className="text-right px-2 sm:px-4 py-2">
                                          {isEditingDeliveryNoteProducts ? (
                                             <Input type="number" value={formatInputValue(product.unitPrice, 'currency', t)} onChange={(e) => handleInputChange(product.id, 'unitPrice', e.target.value)} className="w-24 sm:w-28 text-right h-9" disabled={isSaving}/>
                                          ) : (
                                             t('currency_symbol') + formatInputValue(product.unitPrice, 'currency', t)
                                          )}
                                     </TableCell>
                                     <TableCell className="text-right px-2 sm:px-4 py-2">
                                          {isEditingDeliveryNoteProducts ? (
                                             <Input type="number" value={formatInputValue(product.lineTotal, 'currency', t)} onChange={(e) => handleInputChange(product.id, 'lineTotal', e.target.value)} className="w-24 sm:w-28 text-right h-9" disabled={isSaving}/>
                                          ) : (
                                             t('currency_symbol') + formatInputValue(product.lineTotal, 'currency', t)
                                          )}
                                     </TableCell>
                                     {isEditingDeliveryNoteProducts && (
                                         <TableCell className="text-right px-2 sm:px-4 py-2">
                                             <Button variant="ghost" size="icon" onClick={() => handleRemoveRow(product.id)} className="text-destructive hover:text-destructive/80 h-8 w-8" disabled={isSaving}>
                                                 <Trash2 className="h-4 w-4" />
                                             </Button>
                                         </TableCell>
                                     )}
                                 </TableRow>
                             ))}
                         </TableBody></Table>
                     </div>
                ) : (
                    <p className="text-muted-foreground">{t('edit_invoice_no_products_in_scan')}</p>
                )}
                 {isEditingDeliveryNoteProducts && (
                     <CardFooter className="flex justify-between items-center pt-4 mt-2">
                         <Button variant="outline" onClick={handleAddRow} disabled={isSaving}>
                             <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                         </Button>
                         <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={handleCancelEditProducts} disabled={isSaving}>{t('cancel_button')}</Button>
                            <Button onClick={handleSaveEditProducts} disabled={isSaving}>{t('save_button')}</Button>
                        </div>
                     </CardFooter>
                 )}
                </>
            )}
            {(documentType === 'invoice' || (documentType === 'deliveryNote' && (!products || products.length === 0) && !isEditingDeliveryNoteProducts)) && (displayedOriginalImageUrl || displayedCompressedImageUrl) && (
                <div className="border rounded-lg p-4 mt-6">
                    <h3 className="text-lg font-semibold mb-2">{t('edit_invoice_image_preview_label')}</h3>
                    <div className="overflow-x-auto">
                        <NextImage 
                            src={displayedOriginalImageUrl || displayedCompressedImageUrl!} // Prioritize original for view
                            alt={t('edit_invoice_image_preview_alt')} 
                            width={600} 
                            height={850} 
                            className="rounded-md border shadow-md max-w-full h-auto mx-auto" 
                            data-ai-hint="document scan" />
                    </div>
                </div>
            )}
        </div>
         
        <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
            <Button variant="outline" onClick={handleGoBack} className="w-full sm:w-auto order-last sm:order-first" disabled={isSaving}>
                <ArrowLeft className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_discard_scan_button') : t('edit_invoice_go_back_to_invoices_button')}
            </Button>
            
            <div className="flex-grow flex flex-col sm:flex-row sm:justify-end gap-3">
                <Button
                    onClick={handleSaveChecks}
                     disabled={isSaving || (isNewScan && currentDialogStep !== 'ready_to_save')}
                    className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                >
                    {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_confirm_and_save_button') : t('edit_invoice_save_changes_button')}</>}
                </Button>
            </div>
        </div>

       {currentDialogStep === 'supplier_confirmation' && potentialSupplierName && user && (
        <SupplierConfirmationDialog
          potentialSupplierName={potentialSupplierName}
          existingSuppliers={existingSuppliers}
          onConfirm={handleSupplierConfirmation}
          onCancel={() => {
            console.log("[EditInvoice][SupplierConfirmationDialog] CANCELLED/CLOSED by user. Current Step:", currentDialogStep);
            setIsSupplierConfirmed(true);
            processNextDialogStep('supplier_confirmed_or_skipped');
          }}
          isOpen={currentDialogStep === 'supplier_confirmation'}
          onOpenChange={(open) => { 
              if (!open && currentDialogStep === 'supplier_confirmation') {
                console.log("[EditInvoice][SupplierConfirmationDialog] Externally closed. Current step:", currentDialogStep);
                setIsSupplierConfirmed(true);
                processNextDialogStep('supplier_confirmed_or_skipped');
              }
          }}
        />
      )}

      {currentDialogStep === 'payment_due_date' && (
        <PaymentDueDateDialog
          isOpen={currentDialogStep === 'payment_due_date'}
          onOpenChange={(open) => {
              console.log(`[EditInvoice] PaymentDueDateDialog onOpenChange triggered. New open state: ${open}, Current step: ${currentDialogStep}`);
              if (!open && currentDialogStep === 'payment_due_date') {
                 console.log("[EditInvoice][PaymentDueDateDialog] Externally closed by user. CurrentStep:", currentDialogStep);
                 handleCancelPaymentDueDate(); 
              }
          }}
          onConfirm={handlePaymentDueDateConfirm}
          onCancel={handleCancelPaymentDueDate}
        />
      )}

      {currentDialogStep === 'new_product_details' && promptingForNewProductDetails && promptingForNewProductDetails.length > 0 && (
        <BarcodePromptDialog
          products={promptingForNewProductDetails}
          onComplete={handleNewProductDetailsComplete}
          isOpen={currentDialogStep === 'new_product_details'}
          onOpenChange={(open) => {
              if (!open && currentDialogStep === 'new_product_details') { 
                console.log("[EditInvoice][BarcodePromptDialog] Externally closed. CurrentStep:", currentDialogStep);
                handleNewProductDetailsComplete(null);
              }
          }}
        />
      )}

      {currentDialogStep === 'price_discrepancy' && priceDiscrepancies && priceDiscrepancies.length > 0 && (
        <UnitPriceConfirmationDialog
          discrepancies={priceDiscrepancies}
          onComplete={handlePriceConfirmationComplete}
          isOpen={currentDialogStep === 'price_discrepancy'}
          onOpenChange={(open) => {
              if (!open && currentDialogStep === 'price_discrepancy') { 
                 console.log("[EditInvoice][UnitPriceConfirmationDialog] Externally closed. CurrentStep:", currentDialogStep);
                 handlePriceConfirmationComplete(null); 
              }
          }}
        />
      )}
    </div>
  );
}

export default function EditInvoicePage() {
  const { t } = useTranslation();
  return (
    <Suspense fallback={
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <span className="ml-2">{t('loading_editor')}...</span>
        </div>
    }>
      <EditInvoiceContent />
    </Suspense>
  );
}
