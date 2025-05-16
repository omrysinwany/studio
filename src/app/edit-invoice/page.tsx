// src/app/edit-invoice/page.tsx
'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
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
    INVENTORY_COLLECTION,
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
import { Timestamp } from 'firebase/firestore';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/hooks/useTranslation';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';


interface EditableProduct extends Product {
  _originalId?: string; // To track if it's a new product from scan or an existing one
}

interface EditableTaxInvoiceDetails {
    supplierName?: string | null;
    invoiceNumber?: string | null;
    totalAmount?: number | null;
    invoiceDate?: string | Timestamp | null; // Allow string for input, convert to Timestamp for Firestore
    paymentMethod?: string | null;
}

type DialogFlowStep = 'idle' | 'supplier_confirmation' | 'payment_due_date' | 'new_product_details' | 'price_discrepancy' | 'ready_to_save' | 'error_loading';

interface ProductInputState { // For BarcodePromptDialog
  barcode: string;
  salePrice?: number;
  salePriceMethod: 'manual' | 'percentage';
  profitPercentage: string;
}

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
  const [initialScannedProducts, setInitialScannedProducts] = useState<EditableProduct[]>([]); // Products as they came from scan
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [errorLoading, setErrorLoading] = useState<string | null>(null);
  const [scanProcessErrorState, setScanProcessErrorState] = useState<string | null>(null); // For AI scan errors

  // Keys for localStorage temporary data
  const [initialDataKey, setInitialDataKey] = useState<string | null>(null);
  const [initialTempInvoiceId, setInitialTempInvoiceId] = useState<string | null>(null); // Firestore ID of PENDING doc
  const [initialOriginalImagePreviewKey, setInitialOriginalImagePreviewKey] = useState<string | null>(null);
  const [initialCompressedImageKey, setInitialCompressedImageKey] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState<'deliveryNote' | 'invoice' | null>(null);

  // View vs Edit state for sections
  const [isViewMode, setIsViewMode] = useState(true); // Global view mode, default to true if data is loaded
  const [isEditingTaxDetails, setIsEditingTaxDetails] = useState(false);
  const [isEditingDeliveryNoteProducts, setIsEditingDeliveryNoteProducts] = useState(false);

  const [isNewScan, setIsNewScan] = useState(false); // True if loading from a new scan, false if loading an existing doc

  // Extracted/Editable invoice-level details
  const [extractedInvoiceNumber, setExtractedInvoiceNumber] = useState<string | undefined | null>(undefined);
  const [extractedSupplierName, setExtractedSupplierName] = useState<string | undefined | null>(undefined);
  const [extractedTotalAmount, setExtractedTotalAmount] = useState<number | undefined | null>(undefined);
  const [extractedInvoiceDate, setExtractedInvoiceDate] = useState<string | Timestamp | undefined | null>(undefined);
  const [extractedPaymentMethod, setExtractedPaymentMethod] = useState<string | undefined | null>(undefined);

  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] = useState<EditableTaxInvoiceDetails>({});
  const [initialScannedTaxDetails, setInitialScannedTaxDetails] = useState<EditableTaxInvoiceDetails>({}); // Details as they came from scan/DB

  const [displayedOriginalImageUrl, setDisplayedOriginalImageUrl] = useState<string | null>(null);
  const [displayedCompressedImageUrl, setDisplayedCompressedImageUrl] = useState<string | null>(null);

  // For Dialog Flow
  const [currentDialogStep, setCurrentDialogStep] = useState<DialogFlowStep>('idle');
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [potentialSupplierName, setPotentialSupplierName] = useState<string | undefined>(undefined);
  const [isSupplierConfirmed, setIsSupplierConfirmed] = useState(false);
  const [selectedPaymentDueDate, setSelectedPaymentDueDate] = useState<string | Date | Timestamp | undefined>(undefined);
  const [isPaymentDueDateDialogSkipped, setIsPaymentDueDateDialogSkipped] = useState(false);
  const [productsToDisplayForNewDetails, setProductsToDisplayForNewDetails] = useState<Product[]>([]);
  const [isBarcodePromptOpen, setIsBarcodePromptOpen] = useState(false);
  const [productInputStates, setProductInputStates] = useState<Record<string, ProductInputState>>({}); // For BarcodePromptDialog inputs
  const [priceDiscrepancies, setPriceDiscrepancies] = useState<ProductPriceDiscrepancy[] | null>(null);
  const [productsForNextStep, setProductsForNextStep] = useState<Product[]>([]); // To pass products between dialog steps
  const [aiScannedSupplierNameFromStorage, setAiScannedSupplierNameFromStorage] = useState<string | undefined | null>(undefined); // Supplier name from scan

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

  const processNextDialogStep = useCallback(async (previousStepOutcome: string, data?: any) => {
    console.log(`[EditInvoice][processNextDialogStep] Current Step: ${currentDialogStep}, From Outcome:`, previousStepOutcome, "Data passed:", data, "DocumentType:", documentType);
    if (!isNewScan || !user?.id) {
        console.log("[EditInvoice][processNextDialogStep] Not a new scan or no user. Setting dialog step to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }

    switch (currentDialogStep) {
        case 'supplier_confirmation':
            console.log("[EditInvoice][processNextDialogStep] Outcome from supplier_confirmation:", previousStepOutcome);
            if ((documentType === 'deliveryNote' || documentType === 'invoice') && !selectedPaymentDueDate && !isPaymentDueDateDialogSkipped) {
                console.log("[EditInvoice][processNextDialogStep] Moving to payment_due_date dialog.");
                setCurrentDialogStep('payment_due_date');
            } else if (documentType === 'deliveryNote' && productsForNextStep.length > 0 && !isBarcodePromptOpen) {
                console.log("[EditInvoice][processNextDialogStep] Document is delivery note with products. Checking for new product details.");
                await checkForNewProductsAndDetails(productsForNextStep, true);
            } else {
                console.log("[EditInvoice][processNextDialogStep] All pre-save dialogs seem complete or not applicable. Setting to ready_to_save.");
                setCurrentDialogStep('ready_to_save');
            }
            break;

        case 'payment_due_date':
            console.log("[EditInvoice][processNextDialogStep] Outcome from payment_due_date:", previousStepOutcome);
            if (documentType === 'deliveryNote' && productsForNextStep.length > 0 && !isBarcodePromptOpen) {
                console.log("[EditInvoice][processNextDialogStep] Document is delivery note with products. Checking for new product details.");
                await checkForNewProductsAndDetails(productsForNextStep, true);
            } else {
                console.log("[EditInvoice][processNextDialogStep] All pre-save dialogs seem complete or not applicable. Setting to ready_to_save.");
                setCurrentDialogStep('ready_to_save');
            }
            break;

        case 'new_product_details':
             const updatedProductsFromPrompt = data as Product[] | null;
             console.log("[EditInvoice][processNextDialogStep] Outcome from new_product_details. Products returned from dialog:", updatedProductsFromPrompt);
             if (updatedProductsFromPrompt) {
                 setProductsForNextStep(updatedProductsFromPrompt);
                 setProducts(updatedProductsFromPrompt.map(p => ({...p, _originalId: p.id || p._originalId }))); // Ensure display updates
             }
             // After new product details, flow always moves to ready to save. User clicks main save.
             console.log("[EditInvoice][processNextDialogStep] New product details handled. Setting to ready_to_save.");
             setCurrentDialogStep('ready_to_save');
            break;

        case 'price_discrepancy':
             const resolvedProductsFromDiscrepancy = data as Product[] | null;
             console.log("[EditInvoice][processNextDialogStep] Outcome from price_discrepancy. Resolved products:", resolvedProductsFromDiscrepancy);
             if (resolvedProductsFromDiscrepancy === null) { // User cancelled
                 toast({ title: t('edit_invoice_toast_save_cancelled_title'), description: t('edit_invoice_toast_save_cancelled_desc_price'), variant: "default" });
                 setCurrentDialogStep('idle'); // Or some other appropriate state
                 return;
             }
            setProductsForNextStep(resolvedProductsFromDiscrepancy);
            setProducts(resolvedProductsFromDiscrepancy.map(p => ({...p, _originalId: p.id || p._originalId })));
            
            if (documentType === 'deliveryNote' && resolvedProductsFromDiscrepancy.length > 0 && !isBarcodePromptOpen) {
                console.log("[EditInvoice][processNextDialogStep] Moving to check for new products after price discrepancy.");
                await checkForNewProductsAndDetails(resolvedProductsFromDiscrepancy, true);
            } else {
                console.log("[EditInvoice][processNextDialogStep] No further dialogs after price discrepancy. Setting to ready_to_save.");
                setCurrentDialogStep('ready_to_save');
            }
            break;
        case 'idle':
            console.log("[EditInvoice][processNextDialogStep] In 'idle' state, typically called by startDialogFlowForNewScan. Attempting to start flow by checking supplier.");
            await _internalCheckSupplier(aiScannedSupplierNameFromStorage || extractedSupplierName || initialScannedTaxDetails.supplierName, user.id, existingSuppliers);
            break;
        case 'ready_to_save':
        case 'error_loading':
            console.log(`[EditInvoice][processNextDialogStep] In step ${currentDialogStep}. No further automatic progression from here. User should click main save button.`);
            break;
        default:
            console.warn(`[EditInvoice][processNextDialogStep] Unhandled currentDialogStep '${currentDialogStep}' with outcome '${previousStepOutcome}'. Defaulting to ready_to_save.`);
            setCurrentDialogStep('ready_to_save');
            break;
    }
  }, [currentDialogStep, isNewScan, user?.id, documentType, productsForNextStep, selectedPaymentDueDate, isPaymentDueDateDialogSkipped, isBarcodePromptOpen, t, toast, aiScannedSupplierNameFromStorage, extractedSupplierName, initialScannedTaxDetails.supplierName, existingSuppliers]);


  const _internalCheckSupplier = useCallback(async (scannedSupplier: string | null | undefined, currentUserId: string, suppliersList: SupplierSummary[]) => {
    console.log(`[EditInvoice][_internalCheckSupplier] Called. Scanned Supplier: "${scannedSupplier}", UserID: ${currentUserId}, Suppliers List Count: ${suppliersList.length}`);
    setExistingSuppliers(suppliersList || []);
    
    if (scannedSupplier && scannedSupplier.trim() !== '' && !(suppliersList || []).some(s => s && typeof s.name === 'string' && s.name.toLowerCase() === scannedSupplier.toLowerCase())) {
        console.log("[EditInvoice][_internalCheckSupplier] Scanned supplier is NEW. Setting currentDialogStep to 'supplier_confirmation'. Potential supplier:", scannedSupplier);
        setPotentialSupplierName(scannedSupplier);
        setCurrentDialogStep('supplier_confirmation');
    } else {
        console.log("[EditInvoice][_internalCheckSupplier] Supplier is existing, empty, or not scanned. Setting supplier confirmed and moving to next step via processNextDialogStep.");
        if (scannedSupplier && scannedSupplier.trim() !== '') {
            setExtractedSupplierName(scannedSupplier); // Ensure extracted state is updated
            setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: scannedSupplier }));
        }
        setIsSupplierConfirmed(true);
        processNextDialogStep('supplier_confirmed_or_skipped'); // This will then decide to go to payment_due_date or new_product_details
    }
  }, [processNextDialogStep]);


  const startDialogFlowForNewScan = useCallback(async (scannedSupplier: string | null | undefined, initialProductsFromScan: Product[]) => {
    console.log("[EditInvoice][startDialogFlowForNewScan] Called. Scanned supplier:", scannedSupplier, "isNewScan:", isNewScan, "user ID:", user?.id, "Initial products count:", initialProductsFromScan?.length);
    if (!isNewScan || !user?.id ) {
        console.log("[EditInvoice][startDialogFlowForNewScan] Conditions not met (not a new scan or no user). Setting dialog step to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }
    
    setIsLoading(true); // To show a general loading state if needed
    setProductsForNextStep(initialProductsFromScan || []); // Prime products for subsequent steps

    try {
        console.log("[EditInvoice][startDialogFlowForNewScan] Fetching suppliers for user:", user.id);
        const fetchedSuppliersList = await getSupplierSummariesService(user.id);
        console.log("[EditInvoice][startDialogFlowForNewScan] Fetched suppliers count:", fetchedSuppliersList.length);
        setExistingSuppliers(fetchedSuppliersList);
        // Now call _internalCheckSupplier which will then call processNextDialogStep
        await _internalCheckSupplier(scannedSupplier, user.id, fetchedSuppliersList);
    } catch (error) {
        console.error("[EditInvoice][startDialogFlowForNewScan] Error fetching suppliers:", error);
        toast({
          title: t('error_title'),
          description: `${t('edit_invoice_toast_error_fetching_suppliers')} ${error instanceof Error ? `(${error.message})` : ''}`,
          variant: "destructive"
        });
        setIsSupplierConfirmed(true); // Assume we skip supplier check if fetch fails
        processNextDialogStep('supplier_fetch_error'); // Let processNextDialogStep handle moving to the next logical step
    } finally {
        setIsLoading(false);
    }
  }, [isNewScan, user?.id, toast, t, _internalCheckSupplier, processNextDialogStep]);


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
    
    const keyParam = searchParams.get('key'); // localStorage key for scan data
    const nameParam = searchParams.get('fileName'); // original file name
    const tempInvIdParam = searchParams.get('tempInvoiceId'); // Firestore ID of PENDING doc
    const compressedKeyParam = searchParams.get('compressedImageKey'); // localStorage key for compressed image for Firestore
    const docTypeParam = searchParams.get('docType') as 'deliveryNote' | 'invoice' | null;
    const invoiceIdParam = searchParams.get('invoiceId'); // Firestore ID of an EXISTING FINAL doc

    const newScanFlag = !invoiceIdParam && !!(keyParam || tempInvIdParam);
    setIsNewScan(newScanFlag);
    console.log(`[EditInvoice][loadData] Flags: isNewScan: ${newScanFlag}, docTypeParam: ${docTypeParam}, keyParam: ${keyParam}, tempInvIdParam: ${tempInvIdParam}, invoiceIdParam: ${invoiceIdParam}`);

    if (newScanFlag) {
        console.log("[EditInvoice][loadData] New scan detected. Resetting relevant states for dialog flow.");
        setCurrentDialogStep('idle'); // Start the dialog flow from the beginning
        setIsSupplierConfirmed(false);
        setSelectedPaymentDueDate(undefined);
        setIsPaymentDueDateDialogSkipped(false);
        setPotentialSupplierName(undefined);
        setAiScannedSupplierNameFromStorage(undefined);
        setProductsToDisplayForNewDetails([]);
        setIsBarcodePromptOpen(false);
        setProductsForNextStep([]);
        setProductInputStates({});
        // Reset visual states too
        setProducts([]);
        setInitialScannedProducts([]);
        setEditableTaxInvoiceDetails({});
        setInitialScannedTaxDetails({});
        setExtractedSupplierName(undefined);
        setExtractedInvoiceNumber(undefined);
        setExtractedTotalAmount(undefined);
        setExtractedInvoiceDate(undefined);
        setExtractedPaymentMethod(undefined);
        setIsViewMode(true);
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
    } else if (invoiceIdParam) {
        console.log("[EditInvoice][loadData] Existing invoice mode. Setting dialog to ready_to_save, viewMode to true.");
        setIsViewMode(true);
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
        setCurrentDialogStep('ready_to_save'); 
    } else { 
       console.log("[EditInvoice][loadData] New manual entry mode (no key/id). Setting view mode false, edit modes true, ready_to_save.");
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
                    supplierName: inv.supplierName || null,
                    invoiceNumber: inv.invoiceNumber || null,
                    totalAmount: inv.totalAmount ?? null,
                    invoiceDate: inv.invoiceDate || null,
                    paymentMethod: inv.paymentMethod || null,
                };
                setEditableTaxInvoiceDetails(taxDetails);
                setInitialScannedTaxDetails(taxDetails); // For reset functionality
                setExtractedSupplierName(inv.supplierName || undefined);
                setExtractedInvoiceNumber(inv.invoiceNumber || undefined);
                setExtractedTotalAmount(inv.totalAmount ?? undefined);
                setExtractedInvoiceDate(inv.invoiceDate || undefined);
                setExtractedPaymentMethod(inv.paymentMethod || undefined);

                setSelectedPaymentDueDate(inv.paymentDueDate ? (inv.paymentDueDate instanceof Timestamp ? inv.paymentDueDate.toDate() : (typeof inv.paymentDueDate === 'string' && isValid(parseISO(inv.paymentDueDate)) ? parseISO(inv.paymentDueDate) : undefined)) : undefined);

                setDisplayedOriginalImageUrl(inv.originalImagePreviewUri || null); 
                setDisplayedCompressedImageUrl(inv.compressedImageForFinalRecordUri || null);
                
                const fetchedProducts = inv.documentType === 'deliveryNote' ? await getProductsService(user.id) : []; // This might need refinement if products are directly linked to invoice
                setProducts(fetchedProducts.map(p => ({...p, _originalId: p.id }))); 
                setInitialScannedProducts(fetchedProducts.map(p => ({...p, _originalId: p.id })));
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
            cleanupTemporaryData(); // Cleanup if we can't read
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
        
        let supplierFromScan: string | null | undefined = undefined;
        let initialProductsFromScanData: Product[] = [];

        if (docTypeParam === 'invoice') { 
            console.log("[EditInvoice][loadData] Processing as Tax Invoice.");
            const taxData = parsedData as ScanTaxInvoiceOutput;
            setProducts([]); 
            setInitialScannedProducts([]);
            const taxDetails = {
                supplierName: taxData.supplierName || null,
                invoiceNumber: taxData.invoiceNumber || null,
                totalAmount: taxData.totalAmount ?? null,
                invoiceDate: taxData.invoiceDate || null, // Store as string from scan, convert to TS later if needed
                paymentMethod: taxData.paymentMethod || null,
            };
            setEditableTaxInvoiceDetails(taxDetails);
            setInitialScannedTaxDetails(taxDetails);
            setExtractedSupplierName(taxData.supplierName || undefined);
            setExtractedInvoiceNumber(taxData.invoiceNumber || undefined);
            setExtractedTotalAmount(taxData.totalAmount ?? undefined);
            setExtractedInvoiceDate(taxData.invoiceDate || undefined);
            setExtractedPaymentMethod(taxData.paymentMethod || undefined);
            supplierFromScan = taxData.supplierName;
            setAiScannedSupplierNameFromStorage(supplierFromScan);
        } else if (docTypeParam === 'deliveryNote') { 
            console.log("[EditInvoice][loadData] Processing as Delivery Note.");
            const productScanData = parsedData as ScanInvoiceOutput;
            if (productScanData && Array.isArray(productScanData.products)) {
              const productsWithIds = productScanData.products.map((p: Product, index: number) => ({
                ...p,
                id: p.id || `prod-temp-${Date.now()}-${index}`, // Assign temp ID if none
                _originalId: p.id || `prod-temp-${Date.now()}-${index}`, 
                quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
                unitPrice: p.unitPrice !== undefined ? (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice))) : 0, 
                salePrice: undefined, // Explicitly undefined for new delivery note products before BarcodePromptDialog
                minStockLevel: p.minStockLevel ?? undefined,
                maxStockLevel: p.maxStockLevel ?? undefined,
                imageUrl: p.imageUrl ?? undefined,
              }));
              initialProductsFromScanData = productsWithIds;
              setProducts(productsWithIds);
              setInitialScannedProducts(productsWithIds); // For reset functionality
              console.log("[EditInvoice][loadData] Initial products set from delivery note scan:", productsWithIds);

              const deliveryNoteInvoiceDetails = {
                  supplierName: productScanData.supplier || null,
                  invoiceNumber: productScanData.invoiceNumber || null,
                  totalAmount: productScanData.totalAmount ?? null,
                  invoiceDate: productScanData.invoiceDate || null,
                  paymentMethod: productScanData.paymentMethod || null,
              };
              setEditableTaxInvoiceDetails(deliveryNoteInvoiceDetails);
              setInitialScannedTaxDetails(deliveryNoteInvoiceDetails);
              setExtractedInvoiceNumber(productScanData.invoiceNumber || undefined);
              setExtractedSupplierName(productScanData.supplier || undefined);
              setExtractedTotalAmount(productScanData.totalAmount ?? undefined);
              setExtractedInvoiceDate(productScanData.invoiceDate || undefined);
              setExtractedPaymentMethod(productScanData.paymentMethod || undefined);
              supplierFromScan = productScanData.supplier;
              setAiScannedSupplierNameFromStorage(supplierFromScan);
            } else if (!productScanData.error){
                console.error("[EditInvoice][loadData] Parsed product data is missing 'products' array or is invalid:", productScanData);
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
            console.log(`[EditInvoice][loadData] New scan, initiating dialog flow. Supplier from scan: "${supplierFromScan}"`);
            // Call startDialogFlowForNewScan which handles fetching suppliers and then calling _internalCheckSupplier
            await startDialogFlowForNewScan(supplierFromScan, initialProductsFromScanData);
        }
    } else if (!initialDataLoaded) { 
       console.error("[EditInvoice][loadData] No keyParam, tempInvIdParam, or invoiceIdParam provided. Cannot determine data source.");
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
  }, [user, searchParams, t, toast, cleanupTemporaryData, initialCompressedImageKey, initialOriginalImagePreviewKey, initialDataLoaded, startDialogFlowForNewScan, initialDataKey, initialTempInvoiceId]);


  useEffect(() => {
    if(user && user.id && !initialDataLoaded && !authLoading) { 
      console.log("[EditInvoice] useEffect (user, initialDataLoaded, authLoading): Calling loadData.");
      loadData();
    }
  }, [user, initialDataLoaded, authLoading, loadData]); 


  const handleSupplierConfirmation = useCallback(async (confirmedSupplierName: string | null, isNew: boolean = false) => {
    console.log(`[EditInvoice][handleSupplierConfirmation] Confirmed: "${confirmedSupplierName}", isNew: ${isNew}`);
    if (!user?.id) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        return;
    }

    let finalConfirmedName = confirmedSupplierName;
    if (finalConfirmedName && finalConfirmedName.trim() !== '') {
        setExtractedSupplierName(finalConfirmedName);
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
        if (isNew) {
            try {
                console.log(`[EditInvoice][handleSupplierConfirmation] Attempting to save new supplier '${finalConfirmedName}' via service.`);
                await updateSupplierContactInfoService(finalConfirmedName, {}, user.id, true); // Assuming updateSupplierContactInfoService can create if not found
                toast({ title: t('edit_invoice_toast_new_supplier_added_title'), description: t('edit_invoice_toast_new_supplier_added_desc', { supplierName: finalConfirmedName }) });
            } catch (error: any) {
                console.error("[EditInvoice][handleSupplierConfirmation] Failed to add new supplier:", error);
                toast({ title: t('edit_invoice_toast_fail_add_supplier_title'), description: (error as Error).message, variant: "destructive" });
            }
        }
    } else {
        // If user cancels/skips, use the AI scanned name or whatever was initially there
        finalConfirmedName = aiScannedSupplierNameFromStorage || extractedSupplierName || null; // Use AI scanned if available
        setExtractedSupplierName(finalConfirmedName);
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
        console.log(`[EditInvoice][handleSupplierConfirmation] Supplier dialog outcome was null or empty, using AI scanned/previous name: ${finalConfirmedName}`);
    }
    setIsSupplierConfirmed(true);
    processNextDialogStep('supplier_confirmed');
  }, [user, toast, t, aiScannedSupplierNameFromStorage, extractedSupplierName, processNextDialogStep]);


  const handlePaymentDueDateConfirm = useCallback(async (dueDate: string | Date | Timestamp | undefined) => {
    console.log(`[EditInvoice][PaymentDueDateDialog] Confirmed due date:`, dueDate);
    setSelectedPaymentDueDate(dueDate);
    setIsPaymentDueDateDialogSkipped(false); 
    processNextDialogStep('payment_due_date_confirmed');
  }, [processNextDialogStep]);

  const handleCancelPaymentDueDate = useCallback(async () => {
    console.log("[EditInvoice][PaymentDueDateDialog] Skipped/Cancelled.");
    setSelectedPaymentDueDate(undefined);
    setIsPaymentDueDateDialogSkipped(true); 
    processNextDialogStep('payment_due_date_skipped');
  }, [processNextDialogStep]);


  const handleInputChange = (id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(p => {
        if (p.id === id) {
          const updatedProduct = { ...p };
          let numericValue: number | string | null | undefined = value;

          if (['quantity', 'unitPrice', 'lineTotal', 'minStockLevel', 'maxStockLevel', 'salePrice'].includes(field)) {
            const stringValue = String(value);
            if ((field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice') && stringValue.trim() === '') {
              numericValue = undefined; // Allow clearing optional numeric fields
            } else {
              numericValue = parseFloat(stringValue.replace(/,/g, ''));
              if (isNaN(numericValue as number)) {
                // For optional fields, set to undefined if input is invalid and not just empty
                // For required numeric fields, default to 0
                numericValue = (field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice') ? undefined : 0;
              }
            }
            (updatedProduct as any)[field] = numericValue;
          } else {
            (updatedProduct as any)[field] = value;
          }

          // Auto-calculate lineTotal or unitPrice
          let currentQuantity = Number(updatedProduct.quantity) || 0;
          let currentUnitPrice = (updatedProduct.unitPrice !== undefined && updatedProduct.unitPrice !== null && !isNaN(Number(updatedProduct.unitPrice))) ? Number(updatedProduct.unitPrice) : 0;
          let currentLineTotal = Number(updatedProduct.lineTotal) || 0;


          if (field === 'quantity' || field === 'unitPrice') {
             if (currentQuantity > 0 && currentUnitPrice !== 0 ) { // Use currentUnitPrice which might have been just updated
                currentLineTotal = parseFloat((currentQuantity * currentUnitPrice).toFixed(2));
             } else {
                currentLineTotal = 0; // Or based on existing lineTotal if quantity/unitPrice is 0
             }
            updatedProduct.lineTotal = currentLineTotal;
          } else if (field === 'lineTotal') {
            if (currentQuantity > 0 && currentLineTotal !== 0) { // Use currentLineTotal which might have been just updated
              currentUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
              updatedProduct.unitPrice = currentUnitPrice;
            } else if (currentLineTotal === 0) {
                 updatedProduct.unitPrice = 0; // If total is 0, unit price is 0
            } else {
                 // If quantity is 0 but total is not, unitPrice remains as is (or becomes undefined/error)
                 updatedProduct.unitPrice = (updatedProduct.unitPrice !== undefined) ? updatedProduct.unitPrice : 0;
            }
          }

          // Final check to ensure unitPrice is derived if possible and not explicitly set
          if (currentQuantity > 0 && currentLineTotal !== 0 ) {
            const derivedUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
            // Only override unitPrice if it wasn't the field being edited AND there's a discrepancy
            if (Math.abs(derivedUnitPrice - currentUnitPrice) > 0.001 && field !== 'unitPrice') {
                 updatedProduct.unitPrice = derivedUnitPrice;
            }
          } else if (currentQuantity === 0 || currentLineTotal === 0) { // If either is zero, unit price is zero unless explicitly being set
            // Don't reset unitPrice to 0 if it was the field just edited to a non-zero value
            if(field !== 'unitPrice') updatedProduct.unitPrice = 0;
          }
          return updatedProduct;
        }
        return p;
      })
    );
  };

  const handleTaxInvoiceDetailsChange = (field: keyof EditableTaxInvoiceDetails, value: string | number | undefined | Date | Timestamp) => {
     setEditableTaxInvoiceDetails(prev => ({ ...prev, [field]: value === '' ? null : value })); // Store empty strings as null for consistency
        // Update extracted states as well for immediate display if these fields are shown read-only based on them
        switch(field) {
            case 'supplierName': setExtractedSupplierName(String(value || '')); break;
            case 'invoiceNumber': setExtractedInvoiceNumber(String(value || '')); break;
            case 'totalAmount': setExtractedTotalAmount(value === '' || value === undefined ? null : Number(value)); break;
            // For date, ensure it's stored as string if coming from input, or Timestamp if already so
            case 'invoiceDate': setExtractedInvoiceDate(value instanceof Date ? value.toISOString() : (value instanceof Timestamp ? value : (typeof value === 'string' ? value : null))); break;
            case 'paymentMethod': setExtractedPaymentMethod(String(value || '')); break;
        }
  };


  const handleAddRow = () => {
    const newProduct: EditableProduct = {
      id: `prod-temp-${Date.now()}-new`, // Ensure new products get temporary unique IDs
      _originalId: `prod-temp-${Date.now()}-new`, // Mark as new for dialog logic
      catalogNumber: '',
      description: '',
      quantity: 0,
      unitPrice: 0,
      lineTotal: 0,
      barcode: undefined, // Or null
      minStockLevel: undefined,
      maxStockLevel: undefined,
      salePrice: undefined, // Or null
      imageUrl: undefined,
    };
    setProducts(prevProducts => [...prevProducts, newProduct]);
  };

  const handleRemoveRow = (id: string) => {
    setProducts(prevProducts => prevProducts.filter(product => product.id !== id));
     toast({
        title: t('edit_invoice_toast_row_removed_title'),
        description: t('edit_invoice_toast_row_removed_desc'),
        variant: "default", // or "info"
     });
  };

 const proceedWithFinalSave = async (finalProductsToSave: Product[]) => {
      console.log("[EditInvoice][proceedWithFinalSave] Called with products:", finalProductsToSave);
      if (!user?.id || !documentType) {
          toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
          setCurrentDialogStep('error_loading');
          setIsSaving(false);
          return;
      }
      setIsSaving(true); 
      try {
          // Ensure products passed to service don't have _originalId unless service expects it
          const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => rest);

          let finalFileNameForSave = originalFileName;
          // Use current values from editableTaxInvoiceDetails as these are what user sees and can edit
          const finalSupplierNameForSave = editableTaxInvoiceDetails.supplierName;
          const finalInvoiceNumberForSave = editableTaxInvoiceDetails.invoiceNumber;
          const finalTotalAmountForSave = editableTaxInvoiceDetails.totalAmount;
          
          let finalInvoiceDateForSave: Timestamp | string | null = null;
          if (editableTaxInvoiceDetails.invoiceDate instanceof Timestamp) finalInvoiceDateForSave = editableTaxInvoiceDetails.invoiceDate;
          else if (typeof editableTaxInvoiceDetails.invoiceDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate))) finalInvoiceDateForSave = Timestamp.fromDate(parseISO(editableTaxInvoiceDetails.invoiceDate));
          else if (editableTaxInvoiceDetails.invoiceDate instanceof Date && isValid(editableTaxInvoiceDetails.invoiceDate)) finalInvoiceDateForSave = Timestamp.fromDate(editableTaxInvoiceDetails.invoiceDate);

          const finalPaymentMethodForSave = editableTaxInvoiceDetails.paymentMethod;


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
            initialTempInvoiceId || undefined, // Pass the ID of the PENDING Firestore doc if this was a new scan
            finalInvoiceNumberForSave || undefined,
            finalSupplierNameForSave || undefined,
            finalTotalAmountForSave ?? undefined,
            selectedPaymentDueDate,
            finalInvoiceDateForSave || undefined,
            finalPaymentMethodForSave || undefined,
            displayedOriginalImageUrl || undefined, // These are from localStorage
            displayedCompressedImageUrl || undefined // These are from localStorage
          );
          console.log("[EditInvoice][proceedWithFinalSave] finalizeSaveProductsService result:", result);
          cleanupTemporaryData(); // Clean up localStorage after successful Firestore save

          if (result.finalInvoiceRecord) {
            // Update UI with final data from Firestore
            setOriginalFileName(result.finalInvoiceRecord.generatedFileName); 
            setInitialTempInvoiceId(result.finalInvoiceRecord.id); // Now this is the FINAL Firestore ID
            setDocumentType(result.finalInvoiceRecord.documentType as 'deliveryNote' | 'invoice' | null);
            
            const finalTaxDetails = {
                supplierName: result.finalInvoiceRecord.supplierName,
                invoiceNumber: result.finalInvoiceRecord.invoiceNumber,
                totalAmount: result.finalInvoiceRecord.totalAmount,
                invoiceDate: result.finalInvoiceRecord.invoiceDate, // This should be ISO string or Timestamp
                paymentMethod: result.finalInvoiceRecord.paymentMethod,
            };
            setEditableTaxInvoiceDetails(finalTaxDetails);
            setInitialScannedTaxDetails(finalTaxDetails); // Update initial state for future edits
            setExtractedSupplierName(result.finalInvoiceRecord.supplierName || undefined);
            setExtractedInvoiceNumber(result.finalInvoiceRecord.invoiceNumber || undefined);
            setExtractedTotalAmount(result.finalInvoiceRecord.totalAmount ?? undefined);
            setExtractedInvoiceDate(result.finalInvoiceRecord.invoiceDate || undefined);
            setExtractedPaymentMethod(result.finalInvoiceRecord.paymentMethod || undefined);

            setSelectedPaymentDueDate(result.finalInvoiceRecord.paymentDueDate ? (result.finalInvoiceRecord.paymentDueDate instanceof Timestamp ? result.finalInvoiceRecord.paymentDueDate.toDate() : (typeof result.finalInvoiceRecord.paymentDueDate === 'string' ? parseISO(result.finalInvoiceRecord.paymentDueDate) : undefined )) : undefined);
            setDisplayedOriginalImageUrl(result.finalInvoiceRecord.originalImagePreviewUri || null);
            setDisplayedCompressedImageUrl(result.finalInvoiceRecord.compressedImageForFinalRecordUri || null);

            if (result.savedProductsWithFinalIds) {
                const finalProducts = result.savedProductsWithFinalIds.map(p => ({ ...p, _originalId: p.id }));
                setProducts(finalProducts);
                setInitialScannedProducts(finalProducts);
                setProductsForNextStep(finalProducts); 
            }
            setScanProcessErrorState(result.finalInvoiceRecord.errorMessage || null);
            setIsEditingDeliveryNoteProducts(false);
            setIsEditingTaxDetails(false);
            setIsViewMode(true); // Switch to view mode after save
            setCurrentDialogStep('idle'); // Reset dialog flow for future scans on this page (if any)
             toast({
                title: t('edit_invoice_toast_products_saved_title'),
                description: t('edit_invoice_toast_products_saved_desc'),
            });
            // Redirect after save
            if (documentType === 'deliveryNote') {
                 router.push('/inventory?refresh=true');
            } else if (documentType === 'invoice') {
                 router.push('/invoices?tab=scanned-docs');
            }
          } else {
             // This case should ideally be handled by an error in finalizeSaveProductsService
             console.error("[EditInvoice][proceedWithFinalSave] Final invoice record not returned or error occurred.", result);
             setScanProcessErrorState(t('edit_invoice_toast_save_failed_desc_finalize', { message: "Final invoice record not returned."}));
             setCurrentDialogStep('error_loading'); // Or appropriate error state
          }
      } catch (error: any) {
          console.error("[EditInvoice][proceedWithFinalSave] Failed to finalize save products:", error);
           if ((error as any).isQuotaError) { // Check for the custom quota error flag
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
          setCurrentDialogStep('error_loading'); // Or appropriate error state
      } finally {
          console.log("[EditInvoice][proceedWithFinalSave] Setting isSaving to false.");
          setIsSaving(false);
      }
  };


 const handleSaveChecks = async () => {
    console.log(`[EditInvoice][handleSaveChecks] Called. CurrentDialogStep: ${currentDialogStep}, isNewScan: ${isNewScan}, isSaving: ${isSaving}`);
    if (isSaving) {
        console.log("[EditInvoice][handleSaveChecks] Already saving, returning.");
        return;
    }
    setIsSaving(true); // Set saving true at the beginning of the action

    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        setIsSaving(false);
        return;
    }

    if (isNewScan && currentDialogStep !== 'ready_to_save') {
        console.log(`[EditInvoice][handleSaveChecks] New scan, current step '${currentDialogStep}' is not 'ready_to_save'. Attempting to resume dialog flow.`);
        // Try to resume dialog flow. If _internalCheckSupplier is the first step and supplier not confirmed.
        if (currentDialogStep === 'idle' || (currentDialogStep === 'supplier_confirmation' && !isSupplierConfirmed)) {
             await startDialogFlowForNewScan(aiScannedSupplierNameFromStorage || extractedSupplierName || initialScannedTaxDetails.supplierName, productsForNextStep.length > 0 ? productsForNextStep : products);
        } else if (currentDialogStep === 'supplier_confirmation' && isSupplierConfirmed && (documentType === 'deliveryNote' || documentType === 'invoice') && !selectedPaymentDueDate && !isPaymentDueDateDialogSkipped) {
             console.log("[EditInvoice][handleSaveChecks] Supplier confirmed, moving to payment due date dialog.");
             setCurrentDialogStep('payment_due_date');
        } else if ((currentDialogStep === 'payment_due_date' || (currentDialogStep === 'supplier_confirmation' && isSupplierConfirmed)) && documentType === 'deliveryNote' && (productsForNextStep.length > 0 || products.length > 0) && !isBarcodePromptOpen) {
             console.log("[EditInvoice][handleSaveChecks] Moving to check for new product details.");
             await checkForNewProductsAndDetails(productsForNextStep.length > 0 ? productsForNextStep : products, true);
        } else {
            console.log("[EditInvoice][handleSaveChecks] Unhandled dialog state for new scan, or dialog is active. Resetting isSaving.");
            // If none of the above resume conditions are met, but it's not ready_to_save, it implies a dialog is (or should be) active.
            // We shouldn't proceed to actual save, so reset isSaving.
        }
        setIsSaving(false); // Allow user to interact with dialog if one was opened, or if stuck.
        return;
    }
    
    console.log("[EditInvoice][handleSaveChecks] Proceeding to actual save logic (calling proceedWithActualSave).");
    await proceedWithActualSave();
    // setIsSaving(false) is handled within proceedWithActualSave's finally block
};

const proceedWithActualSave = async () => {
    console.log("[EditInvoice][proceedWithActualSave] Called with current productsForNextStep:", productsForNextStep, "and current products:", products);
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        setIsSaving(false);
        return;
    }

    // Use productsForNextStep if it's populated (meaning it went through dialogs), otherwise use current 'products' state.
    // This ensures we use the product list that has potentially been updated by dialogs.
    let currentProductsToProcess = (productsForNextStep && productsForNextStep.length > 0) 
                                    ? productsForNextStep 
                                    : products.map(({ _originalId, ...rest }) => rest); // Remove _originalId for service

    console.log("[EditInvoice][proceedWithActualSave] currentProductsToProcess before price check:", currentProductsToProcess);

    if (documentType === 'invoice') { // Tax Invoice processing
        console.log("[EditInvoice][proceedWithActualSave] Document is Tax Invoice, calling proceedWithFinalSave with empty products array (details only).");
        await proceedWithFinalSave([]); // Tax invoices don't have line items for inventory
        return;
    }
    
    // Price Check only makes sense if it's a delivery note and there are products
    try {
        if(documentType === 'deliveryNote' && currentProductsToProcess.length > 0) {
            const priceCheckResult = await checkProductPricesBeforeSaveService(currentProductsToProcess, user.id);
            
            if (priceCheckResult.priceDiscrepancies.length > 0) {
                console.log("[EditInvoice][proceedWithActualSave] Price discrepancies found. Setting currentDialogStep to 'price_discrepancy'.");
                setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
                setProductsForNextStep(priceCheckResult.productsToSaveDirectly.concat(
                    priceCheckResult.priceDiscrepancies.map(d => ({...d, unitPrice: d.newUnitPrice, salePrice: d.salePrice ?? undefined }))
                ));
                setCurrentDialogStep('price_discrepancy');
                //setIsSaving(false); // Allow dialog interaction, don't set to false until dialog resolves
                return; 
            }
            console.log("[EditInvoice][proceedWithActualSave] No price discrepancies or they were resolved (if that logic was here). Products to save directly:", priceCheckResult.productsToSaveDirectly);
            currentProductsToProcess = priceCheckResult.productsToSaveDirectly; 
        }
        
        // This state might have been updated if price discrepancy dialog resolved and called processNextDialogStep
        if(currentDialogStep === 'price_discrepancy'){
            console.log("[EditInvoice][proceedWithActualSave] Still in price_discrepancy step, means dialog should be open or just closed. Returning.");
            // If it's still price_discrepancy, it means the dialog is active or just closed without advancing the step.
            // We don't want to proceed to save if the dialog is meant to be open.
            // setIsSaving(false) is handled by the dialog's onComplete or the finally block of proceedWithActualSave if we proceed
            return;
        }
        
        // New Product Details check - Only if it hasn't run or if products changed
        if (documentType === 'deliveryNote' && currentProductsToProcess.length > 0 && currentDialogStep !== 'new_product_details' && !isBarcodePromptOpen) {
            console.log("[EditInvoice][proceedWithActualSave] Checking for new product details after price check (or if no price check).");
            const {needsReview} = await checkForNewProductsAndDetails(currentProductsToProcess, false); 
            if (needsReview) {
                console.log("[EditInvoice][proceedWithActualSave] Products need barcode/sale price review. Setting currentDialogStep to 'new_product_details'.");
                setCurrentDialogStep('new_product_details'); // This will trigger the BarcodePromptDialog
                // setIsSaving(false); // Allow dialog interaction
                return;
            }
        }
        
        if(currentDialogStep === 'new_product_details' && isBarcodePromptOpen){
            console.log("[EditInvoice][proceedWithActualSave] Still in new_product_details step and prompt is open. Returning.");
            // setIsSaving(false) is handled by the dialog's onComplete or the finally block
            return;
        }
        
        console.log("[EditInvoice][proceedWithActualSave] All checks passed or handled. Proceeding to final save with products:", currentProductsToProcess);
        await proceedWithFinalSave(currentProductsToProcess);

    } catch (error) {
        console.error("[EditInvoice][proceedWithActualSave] Error during save checks or final save:", error);
        toast({
            title: t('edit_invoice_toast_error_preparing_save_title'),
            description: t('edit_invoice_toast_error_preparing_save_desc', { message: (error as Error).message}),
            variant: "destructive",
        });
        setCurrentDialogStep('error_loading'); // Indicate an error state
    } finally {
         // Only set isSaving to false if we are NOT in a dialog step that needs to resolve
        if (currentDialogStep !== 'price_discrepancy' && currentDialogStep !== 'new_product_details' && currentDialogStep !== 'supplier_confirmation' && currentDialogStep !== 'payment_due_date') {
            setIsSaving(false);
        } else if (!isBarcodePromptOpen && priceDiscrepancies === null && isSupplierConfirmed && (selectedPaymentDueDate || isPaymentDueDateDialogSkipped)) {
            // If all dialogs are theoretically done, ensure saving is false
             setIsSaving(false);
        }
    }
};


  const checkForNewProductsAndDetails = useCallback(async (productsToCheck: Product[], isDialogFlowContinuation: boolean): Promise<{needsReview: boolean, productsToReview: Product[]}> => {
    console.log(`[EditInvoice][checkForNewProductsAndDetails] Called. isDialogFlowContinuation: ${isDialogFlowContinuation}, productsToCheck count: ${productsToCheck.length}`);
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        if (isDialogFlowContinuation) processNextDialogStep('new_product_details_error', []);
        else setCurrentDialogStep('error_loading');
        return {needsReview: false, productsToReview: []};
    }

    if (productsToCheck.length === 0 && documentType === 'deliveryNote') {
        console.log("[EditInvoice][checkForNewProductsAndDetails] No products for detail check (delivery note).");
        setProductsToDisplayForNewDetails([]);
        setIsBarcodePromptOpen(false);
        if (isDialogFlowContinuation) processNextDialogStep('new_product_details_complete', productsToCheck); 
        else setCurrentDialogStep('ready_to_save');
        return {needsReview: false, productsToReview: []};
    }
    if(documentType === 'invoice') { 
        console.log("[EditInvoice][checkForNewProductsAndDetails] Tax invoice, skipping new product details check.");
        setProductsToDisplayForNewDetails([]);
        setIsBarcodePromptOpen(false);
        if(isDialogFlowContinuation) processNextDialogStep('new_product_details_complete', []);
        else setCurrentDialogStep('ready_to_save');
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
            // Check if the product is truly new (not in inventory by any identifier)
            // OR if it's an existing product but its salePrice is undefined/null in the current state (productInputStates or p itself)
            const existingInInventoryById = p._originalId && !p._originalId.startsWith('prod-temp-') && inventoryMap.has(`id:${p._originalId}`);
            const existingInInventoryByCat = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
            const existingInInventoryByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);
            const isExistingProduct = existingInInventoryById || existingInInventoryByCat || existingInInventoryByBarcode;

            const currentSalePrice = productInputStates[p.id]?.salePrice ?? p.salePrice;
            const needsSalePriceReview = currentSalePrice === undefined || currentSalePrice === null || Number(currentSalePrice) <= 0;
            
            if (!isExistingProduct) return true; // Definitely new, needs review
            return needsSalePriceReview; // Existing product, but needs sale price
        });
        console.log("[EditInvoice][checkForNewProductsAndDetails] Products needing details review count:", productsRequiringDetailsReview.length);
        
        // Initialize input states for products that will be shown in the prompt
        const initialInputStatesForPrompt: Record<string, ProductInputState> = {};
        productsRequiringDetailsReview.forEach(p => {
             // Use existing state if available, otherwise default from product
            const existingState = productInputStates[p.id];
            initialInputStatesForPrompt[p.id] = { 
                barcode: existingState?.barcode || p.barcode || '', 
                salePrice: existingState?.salePrice ?? p.salePrice, // Use already input salePrice if available
                salePriceMethod: existingState?.salePriceMethod || (p.salePrice !== undefined ? 'manual' : 'percentage'),
                profitPercentage: existingState?.profitPercentage || ''
            };
        });
        // Only update states for products actually going to the prompt to preserve other states
        setProductInputStates(prev => ({...prev, ...initialInputStatesForPrompt})); 
        
        if (productsRequiringDetailsReview.length > 0) {
            setProductsToDisplayForNewDetails(productsRequiringDetailsReview);
            setIsBarcodePromptOpen(true); 
            if (isDialogFlowContinuation) setCurrentDialogStep('new_product_details'); 
            return {needsReview: true, productsToReview: productsRequiringDetailsReview};
        } else {
            console.log("[EditInvoice][checkForNewProductsAndDetails] No new products or products needing sale price details.");
            setProductsToDisplayForNewDetails([]);
            setIsBarcodePromptOpen(false);
            if (isDialogFlowContinuation) processNextDialogStep('new_product_details_complete', productsToCheck); 
            else setCurrentDialogStep('ready_to_save');
            return {needsReview: false, productsToReview: []};
        }
    } catch (error) {
        console.error("[EditInvoice][checkForNewProductsAndDetails] Error checking inventory:", error);
        toast({ title: t('edit_invoice_toast_error_new_product_details_title'), description: t('edit_invoice_toast_error_new_product_details_desc'), variant: "destructive" });
        setProductsToDisplayForNewDetails([]);
        setIsBarcodePromptOpen(false);
        if(isDialogFlowContinuation) processNextDialogStep('new_product_details_error', []);
        else setCurrentDialogStep('ready_to_save');
        return {needsReview: false, productsToReview: []}; 
    }
  }, [user?.id, documentType, toast, t, processNextDialogStep, productInputStates]);


const handlePriceConfirmationComplete = useCallback(async (resolvedProducts: Product[] | null) => {
    console.log("[EditInvoice][handlePriceConfirmationComplete] Resolved products from dialog count:", resolvedProducts ? resolvedProducts.length : 'null (cancelled)');
    setPriceDiscrepancies(null); // Close the price discrepancy dialog state
    if (resolvedProducts) {
        setProductsForNextStep(resolvedProducts); // Update the products to be used for the next step
    }
    // Crucially, call processNextDialogStep to move to the next logical step
    processNextDialogStep('price_discrepancy_complete', resolvedProducts);
}, [processNextDialogStep]);


 const handleNewProductDetailsComplete = useCallback(async (updatedNewProductsFromDialog: Product[] | null) => {
     console.log("[EditInvoice][handleNewProductDetailsComplete] Updated products from BarcodePromptDialog:", updatedNewProductsFromDialog);
     setIsBarcodePromptOpen(false); 
     setProductsToDisplayForNewDetails([]); // Clear the list as they've been "processed" by the dialog

     let finalProductsAfterDialog: Product[];
     if (updatedNewProductsFromDialog) {
        // Merge: Use productsForNextStep as base, update those present in updatedNewProductsFromDialog
        const updatedMap = new Map(updatedNewProductsFromDialog.map(p => [p._originalId || p.id, p]));
        finalProductsAfterDialog = productsForNextStep.map(originalP => {
            const updatedP = updatedMap.get(originalP._originalId || originalP.id);
            return updatedP ? { ...originalP, ...updatedP } : originalP;
        });
     } else { 
        console.log("[EditInvoice][handleNewProductDetailsComplete] BarcodePromptDialog cancelled/skipped. Using productsForNextStep as is.");
        finalProductsAfterDialog = productsForNextStep; // Or products, if productsForNextStep was empty
     }
     
     setProducts(finalProductsAfterDialog.map(p => ({...p, _originalId: p.id || p._originalId }))); // Update main display for consistency
     setProductsForNextStep(finalProductsAfterDialog); // THIS IS THE KEY: Ensure productsForNextStep has the latest data
     
     processNextDialogStep('new_product_details_complete', finalProductsAfterDialog);
 }, [productsForNextStep, processNextDialogStep]);


    const handleGoBack = () => {
        console.log("[EditInvoice] handleGoBack called. Cleaning up temp data and navigating.");
        cleanupTemporaryData();
        router.push(isNewScan ? '/upload' : (documentType === 'invoice' ? '/invoices?tab=scanned-docs' : '/inventory'));
    };

    const handleCancelEditTaxDetails = () => {
        setEditableTaxInvoiceDetails(initialScannedTaxDetails); // Reset to initially scanned/loaded
        if (documentType === 'deliveryNote' || documentType === 'invoice') {
          // Also reset the individual extracted states if they are used for display separately
          setExtractedSupplierName(initialScannedTaxDetails.supplierName || undefined);
          setExtractedInvoiceNumber(initialScannedTaxDetails.invoiceNumber || undefined);
          setExtractedTotalAmount(initialScannedTaxDetails.totalAmount ?? undefined);
          setExtractedInvoiceDate(initialScannedTaxDetails.invoiceDate || undefined);
          setExtractedPaymentMethod(initialScannedTaxDetails.paymentMethod || undefined);
        }
        setIsEditingTaxDetails(false);
        if (!isEditingDeliveryNoteProducts) setIsViewMode(true);
    };

    const handleSaveEditTaxDetails = () => {
        // Update "initial" state to reflect the save, so cancel goes back to these new values
        setInitialScannedTaxDetails({...editableTaxInvoiceDetails});
        // Ensure individual extracted states are also updated if they drive read-only display
        if (documentType === 'invoice' || documentType === 'deliveryNote') {
            setExtractedSupplierName(editableTaxInvoiceDetails.supplierName || undefined);
            setExtractedInvoiceNumber(editableTaxInvoiceDetails.invoiceNumber || undefined);
            setExtractedTotalAmount(editableTaxInvoiceDetails.totalAmount ?? undefined);
            setExtractedInvoiceDate(editableTaxInvoiceDetails.invoiceDate || undefined);
            setExtractedPaymentMethod(editableTaxInvoiceDetails.paymentMethod || undefined);
        }
        setIsEditingTaxDetails(false);
        if (!isEditingDeliveryNoteProducts) setIsViewMode(true);
        toast({ title: t('edit_invoice_toast_section_updated_title'), description: t('edit_invoice_toast_section_updated_desc') });
    };

    const handleCancelEditProducts = () => {
        setProducts(initialScannedProducts.map(p => ({...p}))); // Reset to initially scanned/loaded products
        setProductsForNextStep(initialScannedProducts.map(({_originalId, ...rest}) => rest)); // Also reset productsForNextStep
        setIsEditingDeliveryNoteProducts(false);
         if (!isEditingTaxDetails) setIsViewMode(true);
    };

    const handleSaveEditProducts = () => {
        // Update "initial" state to reflect the save
        setInitialScannedProducts(products.map(p => ({...p}))); 
        setProductsForNextStep(products.map(({_originalId, ...rest}) => rest)); // CRITICAL: Update productsForNextStep
        setIsEditingDeliveryNoteProducts(false);
        if (!isEditingTaxDetails) setIsViewMode(true);
        toast({ title: t('edit_invoice_toast_products_updated_title_section'), description: t('edit_invoice_toast_section_updated_desc') });
    };

    const toggleEditTaxDetails = () => {
        if (isEditingTaxDetails) {
            handleSaveEditTaxDetails(); // Save on toggle off
        } else {
            // Ensure editable state is primed from the most recent "saved" state
            setEditableTaxInvoiceDetails({...initialScannedTaxDetails});
            setIsEditingTaxDetails(true);
            setIsViewMode(false);
        }
    };
    
    const toggleEditDeliveryNoteProducts = () => {
        if (isEditingDeliveryNoteProducts) {
            handleSaveEditProducts(); // Save on toggle off
        } else {
            // Ensure editable state is primed from the most recent "saved" state
            setProducts([...initialScannedProducts.map(p => ({...p}))]);
            setIsEditingDeliveryNoteProducts(true);
            setIsViewMode(false);
        }
    };


   if (authLoading || (isLoading && !initialDataLoaded) || !user) {
     return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <span className="ml-2">{t('loading_editor')}...</span>
        </div>
     );
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
        const detailsToDisplay = initialScannedTaxDetails; // Always show what was initially scanned/loaded for read-only

        const noDetailsAvailable = Object.values(detailsToDisplay).every(
             val => val === undefined || val === null || String(val).trim() === ''
        );

        if (noDetailsAvailable && !isNewScan) { // If not a new scan and no details, show message
            return <p className="text-sm text-muted-foreground">{t('edit_invoice_no_details_extracted')}</p>;
        }
        if(noDetailsAvailable && isNewScan && currentDialogStep !== 'ready_to_save' && currentDialogStep !== 'error_loading'){
             // If it's a new scan and dialogs are still pending, show loading/pending message
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
                    value={editableTaxInvoiceDetails.invoiceDate ? (editableTaxInvoiceDetails.invoiceDate instanceof Timestamp ? format(editableTaxInvoiceDetails.invoiceDate.toDate(), 'yyyy-MM-dd') : (typeof editableTaxInvoiceDetails.invoiceDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate)) ? format(parseISO(editableTaxInvoiceDetails.invoiceDate), 'yyyy-MM-dd') : (editableTaxInvoiceDetails.invoiceDate instanceof Date && isValid(editableTaxInvoiceDetails.invoiceDate) ? format(editableTaxInvoiceDetails.invoiceDate, 'yyyy-MM-dd') : ''))) : ''}
                    onChange={(e) => handleTaxInvoiceDetailsChange('invoiceDate', e.target.value ? parseISO(e.target.value) : undefined)} // Store as Date object or ISO string for consistency
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
      <Card className="shadow-md scale-fade-in overflow-hidden bg-card">
         <CardHeader>
            <div className="flex flex-row items-center justify-between">
                <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                    <FileTextIconLucide className="mr-2 h-5 w-5" />
                    {documentType === 'invoice' ? t('edit_invoice_invoice_details_title') : t('edit_invoice_delivery_note_details_title')}
                </CardTitle>
                 {(isViewMode || !isEditingTaxDetails) && (
                    <Button variant="ghost" size="icon" onClick={toggleEditTaxDetails} className="h-8 w-8 text-muted-foreground hover:text-primary">
                        <Edit className="h-4 w-4" />
                        <span className="sr-only">{t('edit_button')}</span>
                    </Button>
                 )}
            </div>
            <CardDescription className="break-words">
                {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
                {(isViewMode ? initialScannedTaxDetails.supplierName : editableTaxInvoiceDetails.supplierName) &&
                    ` | ${t('edit_invoice_supplier', { supplierName: (isViewMode ? initialScannedTaxDetails.supplierName : editableTaxInvoiceDetails.supplierName) })}`}
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
                <CardFooter className="flex justify-end gap-2 pt-4 p-0">
                    <Button variant="outline" onClick={handleCancelEditTaxDetails} disabled={isSaving}>{t('cancel_button')}</Button>
                    <Button onClick={handleSaveEditTaxDetails} disabled={isSaving}>{t('save_button')}</Button>
                </CardFooter>
             )}
        </CardContent>
    </Card>

    {documentType === 'deliveryNote' && (
        <div className="mt-6">
            <div className="flex flex-row items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-primary">{t('edit_invoice_extracted_products_title')} ({products.length})</h2>
                {(isViewMode || !isEditingDeliveryNoteProducts) && products.length > 0 && (
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
                         </TableBody>
                        </Table>
                     </div>
                ) : (
                    <p className="text-muted-foreground">{t('edit_invoice_no_products_in_scan')}</p>
                )}
                 {isEditingDeliveryNoteProducts && (
                     <CardFooter className="flex justify-between items-center pt-4 mt-2 p-0">
                         <Button variant="outline" onClick={handleAddRow} disabled={isSaving}>
                             <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                         </Button>
                         <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={handleCancelEditProducts} disabled={isSaving}>{t('cancel_button')}</Button>
                            <Button onClick={handleSaveEditProducts} disabled={isSaving}>{t('save_button')}</Button>
                        </div>
                     </CardFooter>
                 )}
        </div>
    )}

    {(documentType === 'invoice' || (documentType === 'deliveryNote' && (!products || products.length === 0) && !isEditingDeliveryNoteProducts)) && (displayedOriginalImageUrl || displayedCompressedImageUrl) && (
        <Card className="shadow-md scale-fade-in mt-6 bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-semibold text-primary flex items-center">
                    <Eye className="mr-2 h-5 w-5"/> {t('edit_invoice_image_preview_label')}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <NextImage 
                        src={displayedOriginalImageUrl || displayedCompressedImageUrl!} 
                        alt={t('edit_invoice_image_preview_alt')} 
                        width={600} 
                        height={850} 
                        className="rounded-md border shadow-md max-w-full h-auto mx-auto" 
                        data-ai-hint="document scan" />
                </div>
            </CardContent>
        </Card>
    )}
         
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

    {currentDialogStep === 'supplier_confirmation' && isNewScan && user && potentialSupplierName && (
        <SupplierConfirmationDialog
            potentialSupplierName={potentialSupplierName}
            existingSuppliers={existingSuppliers}
            onConfirm={handleSupplierConfirmation}
            onCancel={() => {
                console.log("[EditInvoice][SupplierConfirmationDialog] CANCELLED/CLOSED by user.");
                setIsSupplierConfirmed(true); 
                processNextDialogStep('supplier_skipped');
            }}
            isOpen={currentDialogStep === 'supplier_confirmation'} // Only open when this is the current step
            onOpenChange={(open) => { 
                if (!open && currentDialogStep === 'supplier_confirmation' && !isSupplierConfirmed) {
                    console.log("[EditInvoice][SupplierConfirmationDialog] Externally closed.");
                    setIsSupplierConfirmed(true);
                    processNextDialogStep('supplier_skipped');
                }
            }}
        />
    )}

    {currentDialogStep === 'payment_due_date' && isNewScan && (
        <PaymentDueDateDialog
            isOpen={currentDialogStep === 'payment_due_date'}
            onOpenChange={(open) => {
                if (!open && currentDialogStep === 'payment_due_date') {
                    console.log("[EditInvoice][PaymentDueDateDialog] Externally closed by user.");
                    handleCancelPaymentDueDate(); 
                }
            }}
            onConfirm={handlePaymentDueDateConfirm}
            onCancel={handleCancelPaymentDueDate}
        />
    )}

    {currentDialogStep === 'new_product_details' && isNewScan && isBarcodePromptOpen && productsToDisplayForNewDetails.length > 0 && (
        <BarcodePromptDialog
            products={productsToDisplayForNewDetails}
            initialProductInputStates={productInputStates} // Pass the current input states
            onComplete={handleNewProductDetailsComplete}
            isOpen={currentDialogStep === 'new_product_details' && isBarcodePromptOpen}
            onOpenChange={(open) => {
                if (!open && currentDialogStep === 'new_product_details' && isBarcodePromptOpen) { 
                    console.log("[EditInvoice][BarcodePromptDialog] Externally closed.");
                    handleNewProductDetailsComplete(null); 
                } else if (open && currentDialogStep !== 'new_product_details') {
                    setIsBarcodePromptOpen(true); // Sync if being opened programmatically
                } else if (!open) {
                    setIsBarcodePromptOpen(false); 
                }
            }}
        />
    )}

    {currentDialogStep === 'price_discrepancy' && priceDiscrepancies && priceDiscrepancies.length > 0 && (
        <UnitPriceConfirmationDialog
            discrepancies={priceDiscrepancies}
            onComplete={handlePriceConfirmationComplete}
            // isOpen prop is implicitly managed by currentDialogStep check
        />
    )}
    </div>
  );
}

export default function EditInvoicePage() {
  const { t } = useTranslation(); // If t is needed directly in the Suspense fallback
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

