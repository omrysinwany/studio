
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
import { format, parseISO, isValid } from 'date-fns';
import { Timestamp } from "firebase/firestore";
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/hooks/useTranslation';


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

type DialogStep = 'idle' | 'supplier_confirmation' | 'payment_due_date' | 'price_discrepancy' | 'new_product_details' | 'ready_to_save' | 'error_loading';


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

  const [priceDiscrepancies, setPriceDiscrepancies] = useState<ProductPriceDiscrepancy[] | null>(null);
  const [productsForNextStep, setProductsForNextStep] = useState<Product[]>([]);
  const [productsToDisplayForNewDetails, setProductsToDisplayForNewDetails] = useState<Product[]>([]);
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [aiScannedSupplierNameFromStorage, setAiScannedSupplierNameFromStorage] = useState<string | undefined | null>(undefined);
  const [selectedPaymentDueDate, setSelectedPaymentDueDate] = useState<string | Date | Timestamp | undefined>(undefined);

  // New state for managing dialog flow
  const [currentDialogStep, setCurrentDialogStep] = useState<DialogStep>('idle');


  const cleanupTemporaryData = useCallback(() => {
    console.log("[EditInvoice] cleanupTemporaryData called.");
    if (!user?.id) {
        console.warn("[EditInvoice] cleanupTemporaryData called, but user ID is missing.");
        return;
    }
    const uniqueScanIdToClear = initialTempInvoiceId ? initialTempInvoiceId.replace(`pending-inv-${user.id}_`, '') : (initialDataKey ? initialDataKey.replace(getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_`), '') : null);
    console.log(`[EditInvoice] Unique scan ID to clear: ${uniqueScanIdToClear}`);

    if (uniqueScanIdToClear) {
        clearTemporaryScanData(uniqueScanIdToClear, user.id);
    } else {
        console.log("[EditInvoice] No unique scan ID found to clear.");
    }
  }, [user?.id, initialDataKey, initialTempInvoiceId]);


  const processNextDialogStep = useCallback(async (previousStepOutcome?: any) => {
    console.log(`[EditInvoice] processNextDialogStep called. Current step: ${currentDialogStep}, Outcome from previous:`, previousStepOutcome);
    if (!isNewScan || !user?.id || !documentType) {
        console.log("[EditInvoice] processNextDialogStep: Not a new scan, user not loaded, or documentType missing. Setting to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }

    switch (currentDialogStep) {
      case 'supplier_confirmation':
        // Outcome of supplier confirmation is the confirmed supplier name
        // Next step: Payment due date
        console.log("[EditInvoice] processNextDialogStep: Supplier confirmed. Moving to payment_due_date.");
        setCurrentDialogStep('payment_due_date');
        break;

      case 'payment_due_date':
        // Outcome of payment due date is the selected date (or skipped)
        // Next step: Check for new products if delivery note
        console.log("[EditInvoice] processNextDialogStep: Payment due date handled. Checking document type.");
        if (documentType === 'deliveryNote' && products.length > 0) {
            console.log("[EditInvoice] processNextDialogStep: Delivery note with products. Checking for new products for details.");
            await checkForNewProductsAndDetails(products, true); // Pass true to indicate it's part of dialog flow
        } else {
            console.log("[EditInvoice] processNextDialogStep: Tax invoice or no products. Moving to ready_to_save.");
            setCurrentDialogStep('ready_to_save');
        }
        break;
      
      case 'new_product_details':
        // Outcome: array of products with updated details (or null if cancelled)
        console.log("[EditInvoice] processNextDialogStep: New product details handled. Moving to ready_to_save.");
        if(previousStepOutcome !== null){ // if not cancelled
            setProductsForNextStep(previousStepOutcome); // Save the products with potentially updated barcodes/salePrices
            setProducts(previousStepOutcome.map((p: Product) => ({...p, _originalId: p.id}))); // Also update main products state
        }
        setCurrentDialogStep('ready_to_save');
        break;

      case 'price_discrepancy':
        // Outcome: array of products with resolved prices (or null if cancelled)
        console.log("[EditInvoice] processNextDialogStep: Price discrepancy handled.");
        if (previousStepOutcome === null) { // User cancelled price confirmation
            console.log("[EditInvoice] Price confirmation cancelled. Aborting save sequence.");
            toast({ title: t('edit_invoice_toast_save_cancelled_title'), description: t('edit_invoice_toast_save_cancelled_desc_price'), variant: "default" });
            setCurrentDialogStep('idle'); // Or some other error/reset state
            setIsSaving(false);
            return;
        }
        // Price discrepancies resolved, now check for new product details
        setProductsForNextStep(previousStepOutcome);
        if (documentType === 'deliveryNote' && previousStepOutcome.length > 0) {
            console.log("[EditInvoice] processNextDialogStep: Price discrepancies resolved. Checking for new product details.");
            await checkForNewProductsAndDetails(previousStepOutcome, true);
        } else {
            console.log("[EditInvoice] processNextDialogStep: Price discrepancies resolved (or not a delivery note). Moving to ready_to_save.");
            setCurrentDialogStep('ready_to_save');
        }
        break;
      
      case 'idle': // Should be called by startDialogFlowForNewScan initially
      case 'ready_to_save':
      default:
        console.log(`[EditInvoice] processNextDialogStep: In step ${currentDialogStep}. No further automatic dialog step.`);
        break;
    }
  }, [currentDialogStep, isNewScan, user?.id, documentType, products, t, toast]);


  const startDialogFlowForNewScan = useCallback(async (scannedSupplier?: string | null) => {
    console.log("[EditInvoice] startDialogFlowForNewScan called with scannedSupplier:", scannedSupplier);
    if (!isNewScan || !user?.id) {
        console.log("[EditInvoice] startDialogFlowForNewScan: Not a new scan or no user. Setting to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }
    
    setIsLoading(true); // Show loading while fetching suppliers
    try {
        const fetchedSuppliersList = await getSupplierSummariesService(user.id);
        setExistingSuppliers(fetchedSuppliersList);
        console.log("[EditInvoice] startDialogFlowForNewScan: Fetched existing suppliers:", fetchedSuppliersList.length);

        if (scannedSupplier && !fetchedSuppliersList.some(s => s.name.toLowerCase() === scannedSupplier.toLowerCase())) {
            console.log("[EditInvoice] startDialogFlowForNewScan: Scanned supplier is new. Setting to supplier_confirmation.");
            setPotentialSupplierName(scannedSupplier);
            setCurrentDialogStep('supplier_confirmation');
        } else {
            // Supplier is existing, empty, or null
            console.log("[EditInvoice] startDialogFlowForNewScan: Supplier existing or not scanned. Moving to payment_due_date.");
            setExtractedSupplierName(scannedSupplier); // Use scanned or keep as null/undefined
            setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: scannedSupplier }));
            setIsSupplierConfirmed(true); // Assume confirmed if existing or not provided by scan
            setCurrentDialogStep('payment_due_date');
        }
    } catch (error) {
        console.error("[EditInvoice] startDialogFlowForNewScan: Error fetching suppliers:", error);
        toast({ title: t('edit_invoice_toast_error_fetching_suppliers'), variant: "destructive" });
        // Fallback: proceed as if supplier is confirmed and move to next step
        setIsSupplierConfirmed(true);
        setCurrentDialogStep('payment_due_date');
    } finally {
        setIsLoading(false);
    }
  }, [isNewScan, user?.id, toast, t]);


  const loadData = useCallback(async () => {
    if (!user || !searchParams || !user.id) {
        console.log("[EditInvoice] loadData: User or searchParams or user.id missing, returning early.");
        setIsLoading(false);
        setInitialDataLoaded(true);
        setErrorLoading(t('edit_invoice_user_not_authenticated_title'));
        setCurrentDialogStep('error_loading');
        return;
    }
    
    console.log("[EditInvoice] loadData started.");
    setIsLoading(true);
    setErrorLoading(null);
    setScanProcessErrorState(null);
    setCurrentDialogStep('idle'); // Reset dialog step
    
    const keyParam = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    const tempInvIdParam = searchParams.get('tempInvoiceId');
    const compressedKeyParam = searchParams.get('compressedImageKey');
    const docTypeParam = searchParams.get('docType') as 'deliveryNote' | 'invoice' | null;
    const invoiceIdParam = searchParams.get('invoiceId');
    
    const newScanFlag = !invoiceIdParam && !!(keyParam || tempInvIdParam);
    setIsNewScan(newScanFlag);
    console.log(`[EditInvoice] loadData flags: isNewScan: ${newScanFlag}, docTypeParam: ${docTypeParam}, keyParam: ${keyParam}, tempInvIdParam: ${tempInvIdParam}, invoiceIdParam: ${invoiceIdParam}`);

    // Reset states for new scan flow
    if (newScanFlag) {
        console.log("[EditInvoice] loadData: New scan detected, resetting dialog-related states.");
        setSelectedPaymentDueDate(undefined);
        // setIsSupplierConfirmed will be set by the dialog flow
        setPotentialSupplierName(undefined);
        setAiScannedSupplierNameFromStorage(undefined);
        // setIsPaymentDueDateDialogSkipped will be handled by its dialog
        setProductsToDisplayForNewDetails([]);
        setPriceDiscrepancies(null);
        setIsViewMode(true); 
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
    } else if (invoiceIdParam) {
        console.log("[EditInvoice] loadData: Existing invoice detected, setting view mode.");
        setIsViewMode(true);
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
        setCurrentDialogStep('ready_to_save'); // No dialogs needed for existing invoice view
    } else { // Manual new entry (no scan key, no invoiceId)
        console.log("[EditInvoice] loadData: No data (new manual entry), setting edit mode.");
        setIsViewMode(false); 
        setIsEditingTaxDetails(true);
        setIsEditingDeliveryNoteProducts(true);
        setCurrentDialogStep('ready_to_save'); // No dialogs for manual new entry
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
    console.log(`[EditInvoice] loadData: uniquePartFromKeyOrTempId for image keys: ${uniquePartFromKeyOrTempId}`);

    if (uniquePartFromKeyOrTempId) {
        setInitialOriginalImagePreviewKey(getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`));
    }

    if (nameParam) {
      setOriginalFileName(decodeURIComponent(nameParam));
    } else {
        setOriginalFileName(t('edit_invoice_unknown_document'));
    }
    
    if (invoiceIdParam) {
        console.log(`[EditInvoice] loadData: Loading existing invoice ID: ${invoiceIdParam}`);
        try {
            const inv = await getInvoicesService(user.id).then(all => all.find(i => i.id === invoiceIdParam));
            if (inv) {
                console.log("[EditInvoice] loadData: Existing invoice found:", inv);
                let finalFileName = inv.generatedFileName || inv.originalFileName;
                setOriginalFileName(finalFileName);
                setDocumentType(inv.documentType as 'deliveryNote' | 'invoice' | null);
                setExtractedSupplierName(inv.supplierName);
                setExtractedInvoiceNumber(inv.invoiceNumber);
                setExtractedTotalAmount(inv.totalAmount);
                setExtractedInvoiceDate(inv.invoiceDate);
                setExtractedPaymentMethod(inv.paymentMethod);
                setSelectedPaymentDueDate(inv.paymentDueDate ? (inv.paymentDueDate instanceof Timestamp ? inv.paymentDueDate.toDate() : parseISO(inv.paymentDueDate as string)) : undefined);

                const taxDetails = {
                    supplierName: inv.supplierName,
                    invoiceNumber: inv.invoiceNumber,
                    totalAmount: inv.totalAmount,
                    invoiceDate: inv.invoiceDate,
                    paymentMethod: inv.paymentMethod,
                };
                setEditableTaxInvoiceDetails(taxDetails);
                setInitialScannedTaxDetails(taxDetails);

                setDisplayedOriginalImageUrl(inv.originalImagePreviewUri || null);
                setDisplayedCompressedImageUrl(inv.compressedImageForFinalRecordUri || null);
                setProducts([]); 
                setInitialScannedProducts([]);
                // For existing invoices, dialog flow is not needed
                setCurrentDialogStep('ready_to_save'); 
            } else {
                setErrorLoading(t('edit_invoice_error_invoice_not_found_id', { invoiceId: invoiceIdParam }));
                setCurrentDialogStep('error_loading');
            }
        } catch (e) {
            console.error("[EditInvoice] loadData: Error loading existing invoice:", e);
            setErrorLoading(t('edit_invoice_error_loading_existing'));
            setCurrentDialogStep('error_loading');
        }
    } else if (keyParam || tempInvIdParam) { 
        console.log(`[EditInvoice] loadData: Loading new scan data from localStorage. Key: ${keyParam}, TempInvId: ${tempInvIdParam}`);
        let storedData: string | null = null;
        let actualDataKey = keyParam; 

        if (!actualDataKey && tempInvIdParam && uniquePartFromKeyOrTempId) {
            actualDataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`);
        }
        console.log(`[EditInvoice] loadData: Actual data key for localStorage: ${actualDataKey}`);

        try {
            if (actualDataKey) storedData = localStorage.getItem(actualDataKey);
            const previewKeyToLoad = initialOriginalImagePreviewKey || (uniquePartFromKeyOrTempId ? getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`) : null);
            const compressedKeyToLoad = initialCompressedImageKey || (uniquePartFromKeyOrTempId ? getStorageKey(TEMP_COMPRESSED_IMAGE_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`) : null);

            console.log(`[EditInvoice] loadData: Attempting to load images. PreviewKey: ${previewKeyToLoad}, CompressedKey: ${compressedKeyToLoad}`);
            if(previewKeyToLoad) setDisplayedOriginalImageUrl(localStorage.getItem(previewKeyToLoad));
            if(compressedKeyToLoad) setDisplayedCompressedImageUrl(localStorage.getItem(compressedKeyToLoad));

        } catch(e) {
            console.error("[EditInvoice] loadData: Error reading from localStorage for key:", actualDataKey, e);
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
            console.log("[EditInvoice] loadData: Parsed data from localStorage:", parsedData);
        } catch (jsonParseError) {
             console.error("[EditInvoice] loadData: Failed to parse JSON data from localStorage:", jsonParseError, "Raw data:", storedData);
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
           console.log("[EditInvoice] loadData: Scan process error from parsed data:", generalError);
        }
        
        let supplierFromScan: string | undefined | null = null;

        if (docTypeParam === 'invoice') {
            console.log("[EditInvoice] loadData: Processing as Tax Invoice.");
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
            console.log("[EditInvoice] loadData: Processing as Delivery Note.");
            const productData = parsedData as ScanInvoiceOutput;
            if (productData && Array.isArray(productData.products)) {
              const productsWithIds = productData.products.map((p: Product, index: number) => ({
                ...p,
                id: p.id || `prod-temp-${Date.now()}-${index}`,
                _originalId: p.id, // Keep track of original ID if it came from AI
                quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
                 unitPrice: (typeof p.quantity === 'number' && p.quantity !== 0 && typeof p.lineTotal === 'number' && p.lineTotal !== 0 && (p.lineTotal / p.quantity > 0))
                            ? parseFloat((p.lineTotal / p.quantity).toFixed(2))
                            : (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice)) || 0),
                minStockLevel: p.minStockLevel ?? undefined,
                maxStockLevel: p.maxStockLevel ?? undefined,
                salePrice: p.salePrice ?? undefined,
              }));
              setProducts(productsWithIds);
              setInitialScannedProducts(productsWithIds);
              console.log("[EditInvoice] loadData: Initial products set from delivery note scan:", productsWithIds);

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
                console.error("[EditInvoice] loadData: Parsed product data is missing 'products' array or is invalid:", productData);
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
             console.error("[EditInvoice] loadData: Unknown or missing docTypeParam:", docTypeParam, "Parsed Data:", parsedData);
             setErrorLoading(t('edit_invoice_error_unknown_document_type'));
             setCurrentDialogStep('error_loading');
             setProducts([]);
             setInitialScannedProducts([]);
             setEditableTaxInvoiceDetails({});
             setInitialScannedTaxDetails({});
        }

        if (newScanFlag) {
            console.log(`[EditInvoice] loadData: New scan, initiating dialog flow for supplier: "${supplierFromScan}"`);
            await startDialogFlowForNewScan(supplierFromScan);
        }
    } else if (!initialDataLoaded) { 
       console.error("[EditInvoice] loadData: No keyParam, tempInvIdParam, or invoiceIdParam provided.");
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
    console.log("[EditInvoice] loadData finished.");
  }, [user, searchParams, t, toast, cleanupTemporaryData, initialCompressedImageKey, initialOriginalImagePreviewKey, initialDataLoaded, startDialogFlowForNewScan]);


  useEffect(() => {
    if(user && user.id && !initialDataLoaded) { 
      console.log("[EditInvoice] useEffect (user, initialDataLoaded): Calling loadData.");
      loadData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, initialDataLoaded]); // loadData is memoized by useCallback



  const handleSupplierConfirmation = async (confirmedSupplierName: string | null, isNew: boolean = false) => {
    console.log(`[EditInvoice] handleSupplierConfirmation called. Confirmed: "${confirmedSupplierName}", isNew: ${isNew}. Current dialog step: ${currentDialogStep}`);
    // setShowSupplierDialog(false); // Handled by currentDialogStep
    if (!user?.id) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        return;
    }
    if (confirmedSupplierName) {
      setExtractedSupplierName(confirmedSupplierName);
      setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: confirmedSupplierName }));
      if (isNew) {
        try {
          await updateSupplierContactInfoService(confirmedSupplierName, {}, user.id, true); // Add isNewSupplier flag
          toast({ title: t('edit_invoice_toast_new_supplier_added_title'), description: t('edit_invoice_toast_new_supplier_added_desc', { supplierName: confirmedSupplierName }) });
        } catch (error) {
          console.error("[EditInvoice] handleSupplierConfirmation: Failed to add new supplier:", error);
          toast({ title: t('edit_invoice_toast_fail_add_supplier_title'), variant: "destructive" });
        }
      }
    } else { // User cancelled or selected nothing, use AI scanned or current
      setExtractedSupplierName(aiScannedSupplierNameFromStorage || extractedSupplierName);
      setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: aiScannedSupplierNameFromStorage || extractedSupplierName }));
    }
    processNextDialogStep(); // Move to next step
  };

  const handlePaymentDueDateConfirm = async (dueDate: string | Date | Timestamp | undefined) => {
    console.log(`[EditInvoice] handlePaymentDueDateConfirm called. DueDate: ${dueDate}. Current dialog step: ${currentDialogStep}`);
    setSelectedPaymentDueDate(dueDate);
    // setShowPaymentDueDateDialog(false); // Handled by currentDialogStep
    // setIsPaymentDueDateDialogSkipped(false); // User confirmed, not skipped.
    processNextDialogStep(dueDate); // Pass outcome (dueDate) to next step
  };

  const handleCancelPaymentDueDate = async () => {
    console.log("[EditInvoice] Payment Due Date dialog cancelled by user. Current dialog step:", currentDialogStep);
    // setShowPaymentDueDateDialog(false); // Handled by currentDialogStep
    setSelectedPaymentDueDate(undefined);
    // setIsPaymentDueDateDialogSkipped(true); // Mark as skipped
    processNextDialogStep('skipped_due_date'); // Indicate skip to next step
  };


  const handleInputChange = (id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(p => {
        if (p.id === id) {
          const updatedProduct = { ...p };
          let numericValue: number | string | undefined = value;

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
             } else if (currentQuantity === 0 || currentUnitPrice === 0) {
                currentLineTotal = 0;
             }
            updatedProduct.lineTotal = currentLineTotal;
          } else if (field === 'lineTotal') {
            if (currentQuantity > 0 && currentLineTotal !== 0) {
              currentUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
              updatedProduct.unitPrice = currentUnitPrice;
            } else {
                updatedProduct.unitPrice = (currentLineTotal === 0) ? 0 : (currentUnitPrice > 0 ? currentUnitPrice : 0);
            }
          }

          if (currentQuantity > 0 && currentLineTotal !== 0 ) {
            const derivedUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
            if (Math.abs(derivedUnitPrice - currentUnitPrice) > 0.001 && field !== 'unitPrice') {
                 updatedProduct.unitPrice = derivedUnitPrice;
            }
          } else if (currentQuantity === 0 && currentLineTotal === 0) {
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
      setIsSaving(true);
      if (!user?.id || !documentType) {
          toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
          setIsSaving(false);
          setCurrentDialogStep('error_loading');
          return;
      }
      try {
          const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => rest);

          let finalFileNameForSave = originalFileName;
          const finalSupplierNameForSave = extractedSupplierName;
          const finalInvoiceNumberForSave = extractedInvoiceNumber;
          const finalTotalAmountForSave = extractedTotalAmount;
          const finalInvoiceDateForSave = extractedInvoiceDate;
          const finalPaymentMethodForSave = extractedPaymentMethod;

          if(finalSupplierNameForSave && finalInvoiceNumberForSave) {
            finalFileNameForSave = `${finalSupplierNameForSave}_${finalInvoiceNumberForSave}`;
          } else if (finalSupplierNameForSave) {
            finalFileNameForSave = finalSupplierNameForSave;
          } else if (finalInvoiceNumberForSave) {
            finalFileNameForSave = `Invoice_${finalInvoiceNumberForSave}`;
          }
          finalFileNameForSave = finalFileNameForSave.replace(/[/\\?%*:|"<>]/g, '-');

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
            setInitialTempInvoiceId(result.finalInvoiceRecord.id);
            setDocumentType(result.finalInvoiceRecord.documentType as 'deliveryNote' | 'invoice' | null);
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
            const finalTaxDetails = {
                supplierName: result.finalInvoiceRecord.supplierName,
                invoiceNumber: result.finalInvoiceRecord.invoiceNumber,
                totalAmount: result.finalInvoiceRecord.totalAmount,
                invoiceDate: result.finalInvoiceRecord.invoiceDate,
                paymentMethod: result.finalInvoiceRecord.paymentMethod,
            };
            setEditableTaxInvoiceDetails(finalTaxDetails);
            setInitialScannedTaxDetails(finalTaxDetails);
            setScanProcessErrorState(result.finalInvoiceRecord.errorMessage || null);
            setIsEditingDeliveryNoteProducts(false);
            setIsEditingTaxDetails(false);
            setIsViewMode(true);
            setCurrentDialogStep('idle'); // Reset dialog flow
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
             setScanProcessErrorState(t('edit_invoice_toast_save_failed_desc_finalize', { message: result.uniqueScanIdToClear ? "Clear temp data & try again." : "Final invoice record not returned."}));
             if (result.uniqueScanIdToClear && user?.id) {
                clearTemporaryScanData(result.uniqueScanIdToClear, user.id);
             }
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
          if((error as any).uniqueScanIdToClear && user?.id){
             clearTemporaryScanData((error as any).uniqueScanIdToClear, user.id);
          }
          setCurrentDialogStep('error_loading');
      } finally {
          console.log("[EditInvoice] proceedWithFinalSave: Setting isSaving to false.");
          setIsSaving(false);
      }
  };

  const proceedWithFinalSaveForTaxInvoice = async () => {
    console.log("[EditInvoice] proceedWithFinalSaveForTaxInvoice called.");
    setIsSaving(true);
    if (!user?.id || !documentType) {
      toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
      setIsSaving(false);
      setCurrentDialogStep('error_loading');
      return;
    }
    try {
      let finalFileNameForSave = originalFileName;
      const finalSupplierNameForSave = editableTaxInvoiceDetails.supplierName || extractedSupplierName;
      const finalInvoiceNumberForSave = editableTaxInvoiceDetails.invoiceNumber || extractedInvoiceNumber;
      const finalTotalAmountForSave = editableTaxInvoiceDetails.totalAmount ?? extractedTotalAmount;
      const finalInvoiceDateForSave = editableTaxInvoiceDetails.invoiceDate || extractedInvoiceDate;
      const finalPaymentMethodForSave = editableTaxInvoiceDetails.paymentMethod || extractedPaymentMethod;

      if(finalSupplierNameForSave && finalInvoiceNumberForSave) {
        finalFileNameForSave = `${finalSupplierNameForSave}_${finalInvoiceNumberForSave}`;
      } else if (finalSupplierNameForSave) {
        finalFileNameForSave = finalSupplierNameForSave;
      } else if (finalInvoiceNumberForSave) {
        finalFileNameForSave = `Invoice_${finalInvoiceNumberForSave}`;
      }
      finalFileNameForSave = finalFileNameForSave.replace(/[/\\?%*:|"<>]/g, '-');

      const result = await finalizeSaveProductsService(
        [],
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
      console.log("[EditInvoice] proceedWithFinalSaveForTaxInvoice: finalizeSaveProductsService result (for tax invoice):", result);
      cleanupTemporaryData();

      if (result.finalInvoiceRecord) {
        setOriginalFileName(result.finalInvoiceRecord.generatedFileName);
        setInitialTempInvoiceId(result.finalInvoiceRecord.id);
        setDocumentType(result.finalInvoiceRecord.documentType as 'deliveryNote' | 'invoice' | null);
        setExtractedSupplierName(result.finalInvoiceRecord.supplierName);
        setExtractedInvoiceNumber(result.finalInvoiceRecord.invoiceNumber);
        setExtractedTotalAmount(result.finalInvoiceRecord.totalAmount);
        setExtractedInvoiceDate(result.finalInvoiceRecord.invoiceDate);
        setExtractedPaymentMethod(result.finalInvoiceRecord.paymentMethod);
        setSelectedPaymentDueDate(result.finalInvoiceRecord.paymentDueDate ? (result.finalInvoiceRecord.paymentDueDate instanceof Timestamp ? result.finalInvoiceRecord.paymentDueDate.toDate() : parseISO(result.finalInvoiceRecord.paymentDueDate as string)) : undefined);
        setDisplayedOriginalImageUrl(result.finalInvoiceRecord.originalImagePreviewUri || null);
        setDisplayedCompressedImageUrl(result.finalInvoiceRecord.compressedImageForFinalRecordUri || null);

        setProducts([]);
        setInitialScannedProducts([]);
        const finalTaxDetails = {
             supplierName: result.finalInvoiceRecord.supplierName,
             invoiceNumber: result.finalInvoiceRecord.invoiceNumber,
             totalAmount: result.finalInvoiceRecord.totalAmount,
             invoiceDate: result.finalInvoiceRecord.invoiceDate,
             paymentMethod: result.finalInvoiceRecord.paymentMethod,
        };
        setEditableTaxInvoiceDetails(finalTaxDetails);
        setInitialScannedTaxDetails(finalTaxDetails);
        setScanProcessErrorState(result.finalInvoiceRecord.errorMessage || null);
        setIsEditingDeliveryNoteProducts(false);
        setIsEditingTaxDetails(false);
        setIsViewMode(true);
        setCurrentDialogStep('idle');
        toast({
            title: t('edit_invoice_toast_invoice_details_saved_title'),
            description: t('edit_invoice_toast_invoice_details_saved_desc'),
        });
        router.push('/invoices?tab=scanned-docs');
      } else {
        setScanProcessErrorState(t('edit_invoice_toast_save_failed_desc_finalize', { message: result.uniqueScanIdToClear ? "Clear temp data & try again." : "Final invoice record not returned for tax invoice."}));
        if (result.uniqueScanIdToClear && user?.id) {
            clearTemporaryScanData(result.uniqueScanIdToClear, user.id);
        }
        setCurrentDialogStep('error_loading');
      }
    } catch (error: any) {
      console.error("[EditInvoice] proceedWithFinalSaveForTaxInvoice: Failed to finalize save for tax invoice:", error);
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        toast({
            title: t('upload_toast_storage_full_title_critical'),
            description: t('upload_toast_storage_full_desc_finalize', {context: "(tax invoice save)"}),
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
        if((error as any).uniqueScanIdToClear && user?.id){
            clearTemporaryScanData((error as any).uniqueScanIdToClear, user.id);
        }
        setCurrentDialogStep('error_loading');
    } finally {
        console.log("[EditInvoice] proceedWithFinalSaveForTaxInvoice: Setting isSaving to false.");
        setIsSaving(false);
    }
  };


 const handleSaveChecks = async () => {
    console.log(`[EditInvoice] handleSaveChecks called. Current step: ${currentDialogStep}, isNewScan: ${isNewScan}, isSaving: ${isSaving}`);
    if (isSaving) return;
    setIsSaving(true); 

    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setIsSaving(false);
        setCurrentDialogStep('error_loading');
        return;
    }

    if (isNewScan && currentDialogStep !== 'ready_to_save') {
        console.log("[EditInvoice] handleSaveChecks: New scan, but dialog flow not complete. Attempting to restart/continue flow.");
        // Attempt to re-trigger the dialog flow from its current or appropriate starting point
        await startDialogFlowForNewScan(aiScannedSupplierNameFromStorage);
        // setIsSaving(false) will be handled by the dialog flow or if it immediately determines it's ready_to_save
        return; 
    }
    
    console.log("[EditInvoice] handleSaveChecks: Dialog flow complete or not a new scan. Proceeding to actual save logic.");
    await proceedWithActualSave();
};

const proceedWithActualSave = async () => {
    console.log("[EditInvoice] proceedWithActualSave called.");
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setIsSaving(false); // Ensure saving is reset
        setCurrentDialogStep('error_loading');
        return;
    }

    if (documentType === 'invoice') {
        console.log("[EditInvoice] proceedWithActualSave: Document is Tax Invoice, calling proceedWithFinalSaveForTaxInvoice.");
        await proceedWithFinalSaveForTaxInvoice(); 
        return;
    }

    // For delivery notes, proceed with price checks etc.
    try {
        const productsFromEdit = products.map(({ _originalId, ...rest }) => rest);
        console.log("[EditInvoice] proceedWithActualSave: Products from edit page:", productsFromEdit);
        const priceCheckResult = await checkProductPricesBeforeSaveService(productsFromEdit, user.id);
        console.log("[EditInvoice] proceedWithActualSave: Price check result:", priceCheckResult);

        setProductsForNextStep(priceCheckResult.productsToSaveDirectly); // Store products that passed price check

        if (priceCheckResult.priceDiscrepancies.length > 0) {
            console.log("[EditInvoice] proceedWithActualSave: Price discrepancies found. Setting to price_discrepancy step.");
            setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
            setCurrentDialogStep('price_discrepancy');
            setIsSaving(false); // Allow interaction with discrepancy dialog
        } else {
            console.log("[EditInvoice] proceedWithActualSave: No price discrepancies. Moving to check for new products.");
            await checkForNewProductsAndDetails(priceCheckResult.productsToSaveDirectly, false); // Pass false for isDialogFlow
        }
    } catch (error) {
        console.error("[EditInvoice] proceedWithActualSave: Error during initial save checks:", error);
        toast({
            title: t('edit_invoice_toast_error_preparing_save_title'),
            description: t('edit_invoice_toast_error_preparing_save_desc', { message: (error as Error).message}),
            variant: "destructive",
        });
        setCurrentDialogStep('error_loading');
        setIsSaving(false);
    }
    // Note: setIsSaving(false) is handled within the final save functions or if an intermediate dialog is shown
};


const checkForNewProductsAndDetails = async (productsToCheck: Product[], isDialogFlow: boolean) => {
    console.log(`[EditInvoice] checkForNewProductsAndDetails called with ${productsToCheck.length} products. isDialogFlow: ${isDialogFlow}`);
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        if (isDialogFlow) setCurrentDialogStep('error_loading');
        else setIsSaving(false);
        return;
    }

    if (productsToCheck.length === 0 && documentType === 'deliveryNote') {
        console.log("[EditInvoice] checkForNewProductsAndDetails: No products for detail check (delivery note).");
        if (isDialogFlow) processNextDialogStep(productsToCheck); // Or move to ready_to_save
        else await proceedWithFinalSave([]);
        return;
    }
    if(documentType === 'invoice' && productsToCheck.length === 0) { // Should not happen if called correctly
        console.log("[EditInvoice] checkForNewProductsAndDetails: No products for detail check (tax invoice). This path should not be taken.");
        if(isDialogFlow) setCurrentDialogStep('ready_to_save');
        else await proceedWithFinalSaveForTaxInvoice();
        return;
    }

    try {
        const currentInventory = await getProductsService(user.id);
        const inventoryMap = new Map<string, Product>();
        currentInventory.forEach(p => {
            if (p.id) inventoryMap.set(`id:${p.id}`, p);
            if (p.catalogNumber && p.catalogNumber !== "N/A") inventoryMap.set(`catalog:${p.catalogNumber}`, p);
            if (p.barcode) inventoryMap.set(`barcode:${p.barcode}`, p);
        });

        const newProductsNeedingDetails = productsToCheck.filter(p => {
            const isExistingById = p.id && !p.id.startsWith('prod-temp-') && inventoryMap.has(`id:${p.id}`);
            const isExistingByCatalog = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
            const isExistingByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);
            const isProductConsideredNew = !(isExistingById || isExistingByCatalog || isExistingByBarcode);
            const needsSalePriceReview = p.salePrice === undefined || p.salePrice === null || Number(p.salePrice) <= 0;
            return isProductConsideredNew || needsSalePriceReview;
        });
        console.log("[EditInvoice] checkForNewProductsAndDetails: Products needing details:", newProductsNeedingDetails.length);

        if (newProductsNeedingDetails.length > 0) {
            setProductsToDisplayForNewDetails(newProductsNeedingDetails);
            if (isDialogFlow) {
                setCurrentDialogStep('new_product_details');
            } else {
                // This case (isDialogFlow=false but new products found) might mean
                // that we skipped price discrepancy, and now barcode prompt is shown.
                // setIsSaving should already be false if BarcodePrompt is to be interactive.
                // Or, if it's part of handleSaveChecks, ensure isSaving is false before dialog.
                setCurrentDialogStep('new_product_details'); // Force dialog
                setIsSaving(false); // Ensure save button is re-enabled for dialog
            }
        } else {
            console.log("[EditInvoice] checkForNewProductsAndDetails: No new products needing details.");
            if (isDialogFlow) processNextDialogStep(productsToCheck); // Pass products that passed all checks
            else await proceedWithFinalSave(productsToCheck);
        }
    } catch (error) {
        console.error("[EditInvoice] checkForNewProductsAndDetails: Error checking inventory:", error);
        toast({ title: t('edit_invoice_toast_error_new_product_details_title'), description: t('edit_invoice_toast_error_new_product_details_desc'), variant: "destructive" });
        if(isDialogFlow) setCurrentDialogStep('error_loading');
        else setIsSaving(false);
    }
};


const handlePriceConfirmationComplete = async (resolvedProducts: Product[] | null) => {
    console.log("[EditInvoice] handlePriceConfirmationComplete called. Resolved products:", resolvedProducts ? resolvedProducts.length : 'null', ". Current dialog step:", currentDialogStep);
    setPriceDiscrepancies(null); // Clear discrepancies
    processNextDialogStep(resolvedProducts); // Pass resolved products (or null if cancelled) to next step
};


 const handleNewProductDetailsComplete = async (updatedNewProductsFromDialog: Product[] | null) => {
     console.log("[EditInvoice] handleNewProductDetailsComplete called. Updated products:", updatedNewProductsFromDialog ? updatedNewProductsFromDialog.length : 'null', ". Current dialog step:", currentDialogStep);
     // setProductsToDisplayForNewDetails([]); // Clear prompt list // Handled by BarcodePromptDialog itself or step change
     
     let finalProductsAfterNewDetails: Product[];
     if (updatedNewProductsFromDialog) {
        finalProductsAfterNewDetails = productsForNextStep.map(originalProduct => {
             const updatedVersion = updatedNewProductsFromDialog.find(unp =>
                 (originalProduct.id && unp.id === originalProduct.id) || 
                 (unp.catalogNumber && unp.catalogNumber === originalProduct.catalogNumber && !originalProduct.id)
             );
             if (updatedVersion) {
                 return {
                     ...originalProduct,
                     barcode: updatedVersion.barcode || originalProduct.barcode,
                     salePrice: updatedVersion.salePrice, 
                 };
             }
             return originalProduct;
         });
     } else { // User cancelled barcode prompt
        console.log("[EditInvoice] New product details prompt cancelled. Proceeding with productsForNextStep as is.");
        finalProductsAfterNewDetails = [...productsForNextStep]; // Use products as they were before barcode prompt
     }
     
     processNextDialogStep(finalProductsAfterNewDetails); // Pass outcome to next step
 };


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


   if (authLoading || (isLoading && !initialDataLoaded) || (isNewScan && isLoading && currentDialogStep === 'idle')) {
     return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <span className="ml-2">{t('loading_editor')}...</span>
        </div>
     );
   }

   if (!user && !authLoading) {
    router.push('/login');
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

    const showManualEntryPrompt = isNewScan && currentDialogStep !== 'error_loading' &&
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
                                    disabled={isSaving || (products.length === 0 && documentType === 'deliveryNote') || (isNewScan && currentDialogStep !== 'ready_to_save')}
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
                <Input id="taxPaymentMethod" value={editableTaxInvoiceDetails.paymentMethod || ''} onChange={(e) => handleTaxInvoiceDetailsChange('paymentMethod', e.target.value)} disabled={isSaving} />
            </div>
        </div>
    );


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
        <Card className="shadow-md scale-fade-in overflow-hidden">
            <CardHeader>
                <div className="flex flex-row items-center justify-between">
                    <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                        <FileTextIconLucide className="mr-2 h-5 w-5" />
                        {documentType === 'invoice' ? t('edit_invoice_invoice_details_title') : t('edit_invoice_delivery_note_details_title')}
                    </CardTitle>
                     {!isSaving && (
                        <Button variant="ghost" size="icon" onClick={toggleEditTaxDetails} className="h-8 w-8 text-muted-foreground hover:text-primary">
                            {isEditingTaxDetails ? <X className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
                            <span className="sr-only">{isEditingTaxDetails ? t('cancel_button') : t('edit_button')}</span>
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
                 {displayedOriginalImageUrl && (
                    <div className="border rounded-lg p-4 mt-6">
                        <h3 className="text-lg font-semibold mb-2">{t('edit_invoice_image_preview_label')}</h3>
                        <div className="overflow-x-auto">
                            <NextImage src={displayedOriginalImageUrl} alt={t('edit_invoice_image_preview_alt')} width={600} height={850} className="rounded-md border shadow-md max-w-full h-auto mx-auto" data-ai-hint="document scan" />
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>

        {documentType === 'deliveryNote' && (
            <div className="mt-6">
                 <div className="flex flex-row items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold text-primary">{t('edit_invoice_extracted_products_title')} ({products.length})</h2>
                    {!isSaving && products.length > 0 && (
                        <Button variant="ghost" size="icon" onClick={toggleEditDeliveryNoteProducts} className="h-8 w-8 text-muted-foreground hover:text-primary">
                            {isEditingDeliveryNoteProducts ? <X className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
                             <span className="sr-only">{isEditingDeliveryNoteProducts ? t('cancel_button') : t('edit_button')}</span>
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
                     <div className="flex justify-between items-center pt-4 mt-2">
                         <Button variant="outline" onClick={handleAddRow} disabled={isSaving}>
                             <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                         </Button>
                         <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={handleCancelEditProducts} disabled={isSaving}>{t('cancel_button')}</Button>
                            <Button onClick={handleSaveEditProducts} disabled={isSaving}>{t('save_button')}</Button>
                        </div>
                     </div>
                 )}
            </div>
        )}
         {(documentType === 'invoice' && (!isViewMode || isEditingTaxDetails) ) && (
             <div className="mt-4">
                <Button 
                    onClick={handleSaveChecks} 
                    disabled={isSaving || (isNewScan && currentDialogStep !== 'ready_to_save')}
                    className="bg-primary hover:bg-primary/90 w-full sm:w-auto mt-4"
                >
                    {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {t('edit_invoice_save_changes_button')}</>}
                </Button>
            </div>
         )}


        <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
            <Button variant="outline" onClick={handleGoBack} className="w-full sm:w-auto order-last sm:order-first" disabled={isSaving}>
                <ArrowLeft className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_discard_scan_button') : t('edit_invoice_go_back_to_invoices_button')}
            </Button>
            {(documentType === 'deliveryNote' || (documentType === 'invoice' && isViewMode && !isEditingTaxDetails && !isEditingDeliveryNoteProducts && (!isNewScan || currentDialogStep === 'ready_to_save') ) ) && (
                <div className="flex-grow flex flex-col sm:flex-row sm:justify-end gap-3">
                    <Button
                        onClick={handleSaveChecks}
                        disabled={isSaving || (isNewScan && currentDialogStep !== 'ready_to_save')}
                        className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                    >
                        {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_confirm_and_save_button') : t('edit_invoice_save_changes_button')}</>}
                    </Button>
                </div>
            )}
        </div>
       {currentDialogStep === 'supplier_confirmation' && potentialSupplierName && user && (
        <SupplierConfirmationDialog
          potentialSupplierName={potentialSupplierName}
          existingSuppliers={existingSuppliers}
          onConfirm={handleSupplierConfirmation}
          onCancel={() => {
            console.log("[EditInvoice] Supplier confirmation dialog CANCELLED by user.");
            // Treat cancel as "use AI scanned name or current", then proceed
            handleSupplierConfirmation(aiScannedSupplierNameFromStorage || extractedSupplierName, false);
          }}
          isOpen={currentDialogStep === 'supplier_confirmation'}
          onOpenChange={(open) => { if (!open) handleSupplierConfirmation(aiScannedSupplierNameFromStorage || extractedSupplierName, false);}}
        />
      )}

      {currentDialogStep === 'payment_due_date' && isNewScan && (documentType === 'deliveryNote' || documentType === 'invoice') && (
        <PaymentDueDateDialog
          isOpen={currentDialogStep === 'payment_due_date'}
          onOpenChange={(open) => { if (!open) handleCancelPaymentDueDate();}}
          onConfirm={handlePaymentDueDateConfirm}
          onCancel={handleCancelPaymentDueDate}
        />
      )}


      {currentDialogStep === 'new_product_details' && documentType === 'deliveryNote' && productsToDisplayForNewDetails.length > 0 && (
        <BarcodePromptDialog
          products={productsToDisplayForNewDetails}
          onComplete={handleNewProductDetailsComplete}
          isOpen={currentDialogStep === 'new_product_details'}
          onOpenChange={(open) => {
              if (!open) handleNewProductDetailsComplete(null); // Treat close as cancel
          }}
        />
      )}

      {currentDialogStep === 'price_discrepancy' && priceDiscrepancies && priceDiscrepancies.length > 0 && documentType === 'deliveryNote' && (
        <UnitPriceConfirmationDialog
          discrepancies={priceDiscrepancies}
          onComplete={handlePriceConfirmationComplete}
          isOpen={currentDialogStep === 'price_discrepancy'}
          onOpenChange={(open) => {if(!open) handlePriceConfirmationComplete(null);}}
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

