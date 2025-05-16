
// src/app/edit-invoice/page.tsx
'use client';

import React, { useState, useEffect, Suspense, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, PlusCircle, Save, Loader2, ArrowLeft, Edit, Eye, FileText as FileTextIconLucide, CheckCircle, X, Package as PackageIcon } from 'lucide-react';
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
    // TEMP_DATA_KEY_PREFIX, // No longer needed as main data transfer mechanism
    getStorageKey, // Still used for potential fallback if query params fail, or other local settings
    InvoiceHistoryItem,
    getInvoicesService,
    // MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES, // No longer directly used
    MAX_SCAN_RESULTS_SIZE_BYTES, // Still relevant for checking AI output size
    updateInvoiceService,
    DOCUMENTS_COLLECTION,
    INVENTORY_COLLECTION,
} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import type { ScanTaxInvoiceOutput } from '@/ai/flows/tax-invoice-schemas';
import { Alert, AlertDescription, AlertTitle as AlertTitleComponent } from '@/components/ui/alert';
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog';
import SupplierConfirmationDialog from '@/components/supplier-confirmation-dialog';
import PaymentDueDateDialog from '@/components/payment-due-date-dialog';
import { useAuth } from '@/context/AuthContext';
import { Label } from '@/components/ui/label';
import { Timestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/hooks/useTranslation';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';


interface EditableProduct extends Product {
  _originalId?: string;
}

interface EditableTaxInvoiceDetails {
    supplierName?: string | null;
    invoiceNumber?: string | null;
    totalAmount?: number | null;
    invoiceDate?: string | Timestamp | Date | null;
    paymentMethod?: string | null;
    paymentDueDate?: string | Timestamp | Date | null;
}

type DialogFlowStep = 'idle' | 'supplier_confirmation' | 'payment_due_date' | 'new_product_details' | 'price_discrepancy' | 'ready_to_save' | 'error_loading';

interface ProductInputState {
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
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/') || src.startsWith('blob:');
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
  
  const [initialTempInvoiceId, setInitialTempInvoiceId] = useState<string | null>(null); 
  
  const docTypeParam = useMemo(() => searchParams.get('docType') as 'deliveryNote' | 'invoice' | null, [searchParams]);
  
  const [isViewMode, setIsViewMode] = useState(true);
  const [isEditingTaxDetails, setIsEditingTaxDetails] = useState(false);
  const [isEditingDeliveryNoteProducts, setIsEditingDeliveryNoteProducts] = useState(false);

  const [isNewScan, setIsNewScan] = useState(false);

  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] = useState<EditableTaxInvoiceDetails>({});
  const [initialScannedTaxDetails, setInitialScannedTaxDetails] = useState<EditableTaxInvoiceDetails>({});
  
  const [displayedOriginalImageUrl, setDisplayedOriginalImageUrl] = useState<string | null>(null);
  const [displayedCompressedImageUrl, setDisplayedCompressedImageUrl] = useState<string | null>(null);

  const [currentDialogStep, setCurrentDialogStep] = useState<DialogFlowStep>('idle');
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [potentialSupplierName, setPotentialSupplierName] = useState<string | undefined>(undefined);
  const [aiScannedSupplierNameFromStorage, setAiScannedSupplierNameFromStorage] = useState<string | undefined | null>(undefined);

  const [isSupplierConfirmed, setIsSupplierConfirmed] = useState(false);
  const [selectedPaymentDueDate, setSelectedPaymentDueDate] = useState<string | Date | Timestamp | undefined>(undefined);
  const [isPaymentDueDateDialogSkipped, setIsPaymentDueDateDialogSkipped] = useState(false);
  
  const [productsToDisplayForNewDetails, setProductsToDisplayForNewDetails] = useState<Product[]>([]);
  const [productInputStates, setProductInputStates] = useState<Record<string, ProductInputState>>({});
  const [productsForNextStep, setProductsForNextStep] = useState<Product[]>([]);
  const [priceDiscrepancies, setPriceDiscrepancies] = useState<ProductPriceDiscrepancy[] | null>(null);


  const cleanupTemporaryData = useCallback(() => {
    console.log("[EditInvoice][cleanupTemporaryData] Called.");
    if (!user?.id) {
        console.warn("[EditInvoice] cleanupTemporaryData called, but user ID is missing.");
        return;
    }
    // No localStorage keys for images to clear anymore as they are passed via pending doc or not at all
    const keyFromParams = searchParams.get('key'); // This was for localStorage JSON scan results
    if (keyFromParams) {
      try {
        // Assuming `keyFromParams` was constructed with TEMP_DATA_KEY_PREFIX + userId + unique part
        // We only need to construct the full key to remove
        const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_${keyFromParams.substring(TEMP_DATA_KEY_PREFIX.length + (user.id).length + 1)}`);
        if (localStorage.getItem(dataKey)) { // Check if it exists before trying to remove
          localStorage.removeItem(dataKey);
          console.log(`[EditInvoice][cleanupTemporaryData] Cleared localStorage scan result JSON for key: ${dataKey}`);
        }
      } catch (e) {
        console.error(`[EditInvoice][cleanupTemporaryData] Error removing localStorage key ${keyFromParams}:`, e);
      }
    }
  }, [user?.id, searchParams]);


  const _internalCheckSupplier = useCallback(async (scannedSupplier: string | null | undefined, currentUserId: string, suppliersList: SupplierSummary[]) => {
    console.log(`[EditInvoice][_internalCheckSupplier] Called. Scanned Supplier: "${scannedSupplier}", UserID: ${currentUserId}, Suppliers List Count: ${suppliersList.length}`);
    setExistingSuppliers(suppliersList || []);
    
    if (scannedSupplier && scannedSupplier.trim() !== '' && !(suppliersList || []).some(s => s && typeof s.name === 'string' && s.name.toLowerCase() === scannedSupplier.toLowerCase())) {
        console.log("[EditInvoice][_internalCheckSupplier] Scanned supplier is NEW. Setting currentDialogStep to 'supplier_confirmation'. Potential supplier:", scannedSupplier);
        setPotentialSupplierName(scannedSupplier);
        setCurrentDialogStep('supplier_confirmation');
    } else {
        console.log("[EditInvoice][_internalCheckSupplier] Supplier is existing, empty, or not scanned. Confirming supplier and moving to next step.");
        if (scannedSupplier && scannedSupplier.trim() !== '') {
            setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: scannedSupplier }));
        }
        setIsSupplierConfirmed(true); 
        // processNextDialogStep will be called from the effect that calls this, or from a confirmation handler
    }
  }, []); // Dependencies will be managed by functions calling this or the main load effect


  const checkForNewProductsAndDetails = useCallback(async (productsToCheck: Product[]) => {
    console.log(`[EditInvoice][checkForNewProductsAndDetails] Called. Products to check count: ${productsToCheck.length}. Document Type: ${docTypeParam}`);
    if (!user?.id) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), description: t("edit_invoice_user_not_authenticated_desc"), variant: "destructive" });
        return {needsReview: false, productsForReview: []};
    }

    if (docTypeParam !== 'deliveryNote' || productsToCheck.length === 0) {
        console.log("[EditInvoice][checkForNewProductsAndDetails] Not a delivery note or no products. Skipping details check.");
        setProductsToDisplayForNewDetails([]);
        return {needsReview: false, productsForReview: []};
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
            const existingInInventoryById = p._originalId && !p._originalId.startsWith('prod-temp-') && !p._originalId.startsWith('temp-id-') && inventoryMap.has(`id:${p._originalId}`);
            const existingInInventoryByCat = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
            const existingInInventoryByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);
            const isExistingProduct = existingInInventoryById || existingInInventoryByCat || existingInInventoryByBarcode;
            
            // For delivery notes, we *always* want to prompt for salePrice if it's not explicitly set
            // The `p.salePrice === undefined` check is key here.
            const needsSalePriceReview = p.salePrice === undefined; 
            
            console.log(`[EditInvoice][checkForNewProductsAndDetails] Product: ${p.shortName || p.id}, isExisting: ${isExistingProduct}, needsSalePriceReview: ${needsSalePriceReview}`);
            if (!isExistingProduct) return true; // Always review new products
            return needsSalePriceReview; // Review existing products only if they are missing a sale price
        });
        console.log("[EditInvoice][checkForNewProductsAndDetails] Products needing details review count:", productsRequiringDetailsReview.length);
        
        if (productsRequiringDetailsReview.length > 0) {
            const initialInputStatesForPrompt: Record<string, ProductInputState> = {};
            productsRequiringDetailsReview.forEach(p => {
                const pId = p.id || p._originalId || `temp-id-${Math.random().toString(36).substring(2,9)}`;
                initialInputStatesForPrompt[pId] = { 
                    barcode: p.barcode || '', 
                    salePrice: p.salePrice, // Will be undefined here for these products
                    salePriceMethod: 'percentage', // Default to percentage
                    profitPercentage: ''
                };
            });
            setProductInputStates(prev => ({...prev, ...initialInputStatesForPrompt})); 
            setProductsToDisplayForNewDetails(productsRequiringDetailsReview);
            return {needsReview: true, productsForReview: productsRequiringDetailsReview};
        } else {
            setProductsToDisplayForNewDetails([]);
            return {needsReview: false, productsForReview: []};
        }
    } catch (error) {
        console.error("[EditInvoice][checkForNewProductsAndDetails] Error checking inventory:", error);
        toast({ title: t('edit_invoice_toast_error_new_product_details_title'), description: t('edit_invoice_toast_error_new_product_details_desc'), variant: "destructive" });
        setProductsToDisplayForNewDetails([]);
        return {needsReview: false, productsForReview: []};
    }
  }, [user?.id, docTypeParam, toast, t]);


   const processNextDialogStep = useCallback(async (previousStepOutcome: string, data?: any) => {
    console.log(`[EditInvoice][processNextDialogStep] Current Step BEFORE: ${currentDialogStep}, From Outcome:`, previousStepOutcome, "Data passed:", data, "isNewScan:", isNewScan, "DocType:", docTypeParam);
    if (!isNewScan || !user?.id) {
        console.log("[EditInvoice][processNextDialogStep] Not a new scan or no user. Setting dialog step to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }

    let currentProductsForCheck = productsForNextStep.length > 0 ? productsForNextStep : products;

    switch (currentDialogStep) {
        case 'idle': 
        case 'supplier_confirmation': 
             if (previousStepOutcome === 'supplier_skipped' || previousStepOutcome === 'supplier_confirmed' || previousStepOutcome === 'supplier_existing_or_empty' || previousStepOutcome === 'supplier_fetch_error') {
                 console.log("[EditInvoice][processNextDialogStep] From supplier/idle outcome. Checking payment due date step. isNewScan:", isNewScan, "selectedPaymentDueDate:", selectedPaymentDueDate, "isPaymentDueDateDialogSkipped:", isPaymentDueDateDialogSkipped, "docTypeParam:", docTypeParam);
                if (isNewScan && !selectedPaymentDueDate && !isPaymentDueDateDialogSkipped && (docTypeParam === 'deliveryNote' || docTypeParam === 'invoice')) {
                    console.log("[EditInvoice][processNextDialogStep] Moving to payment_due_date dialog.");
                    setCurrentDialogStep('payment_due_date');
                } else {
                    console.log("[EditInvoice][processNextDialogStep] Payment due date step skipped, completed, or not applicable. Checking new product details for DocType:", docTypeParam);
                    if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
                        const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
                        if (reviewResult.needsReview) {
                            console.log("[EditInvoice][processNextDialogStep] Needs new product details review. Moving to new_product_details dialog.");
                            setCurrentDialogStep('new_product_details');
                        } else {
                            console.log("[EditInvoice][processNextDialogStep] No new product details review needed. Moving to ready_to_save.");
                            setCurrentDialogStep('ready_to_save');
                        }
                    } else { 
                        console.log("[EditInvoice][processNextDialogStep] Not a delivery note or no products to check. Moving to ready_to_save.");
                        setCurrentDialogStep('ready_to_save');
                    }
                }
            }
            break;

        case 'payment_due_date':
            console.log("[EditInvoice][processNextDialogStep] From payment_due_date. Outcome:", previousStepOutcome, "DocType:", docTypeParam);
            if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
                const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
                if (reviewResult.needsReview) {
                    console.log("[EditInvoice][processNextDialogStep] Needs new product details review. Moving to new_product_details dialog.");
                    setCurrentDialogStep('new_product_details');
                } else { 
                     console.log("[EditInvoice][processNextDialogStep] No new product details review needed. Moving to ready_to_save.");
                    setCurrentDialogStep('ready_to_save');
                }
            } else { 
                 console.log("[EditInvoice][processNextDialogStep] Not a delivery note or no products to check (after payment_due_date). Moving to ready_to_save.");
                setCurrentDialogStep('ready_to_save');
            }
            break;

        case 'new_product_details':
             const updatedProductsFromPrompt = data as Product[] | null;
             console.log("[EditInvoice][processNextDialogStep] From new_product_details. Products from dialog:", updatedProductsFromPrompt ? updatedProductsFromPrompt.length : 'null');
             if (updatedProductsFromPrompt) {
                 setProductsForNextStep(updatedProductsFromPrompt); 
                 setProducts(updatedProductsFromPrompt.map(p => ({...p, _originalId: p.id || p._originalId })));
             }
             console.log("[EditInvoice][processNextDialogStep] Moving to ready_to_save after new_product_details.");
             setCurrentDialogStep('ready_to_save'); 
            break;

        case 'price_discrepancy':
             const resolvedProductsFromDiscrepancy = data as Product[] | null;
             if (resolvedProductsFromDiscrepancy === null) { 
                 toast({ title: t('edit_invoice_toast_save_cancelled_title'), description: t('edit_invoice_toast_save_cancelled_desc_price'), variant: "default" });
                 setCurrentDialogStep('ready_to_save'); 
                 setIsSaving(false);
                 return;
             }
            setProductsForNextStep(resolvedProductsFromDiscrepancy);
            setProducts(resolvedProductsFromDiscrepancy.map(p => ({...p, _originalId: p.id || p._originalId })));
            currentProductsForCheck = resolvedProductsFromDiscrepancy; 
            
            console.log("[EditInvoice][processNextDialogStep] From price_discrepancy. Checking new product details for DocType:", docTypeParam);
            if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
                 const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck); 
                 if (reviewResult.needsReview) {
                    console.log("[EditInvoice][processNextDialogStep] Needs new product details review (after price discrepancy). Moving to new_product_details dialog.");
                    setCurrentDialogStep('new_product_details');
                } else {
                    console.log("[EditInvoice][processNextDialogStep] No new product details review needed (after price discrepancy). Moving to ready_to_save.");
                    setCurrentDialogStep('ready_to_save');
                }
            } else { 
                console.log("[EditInvoice][processNextDialogStep] Not a delivery note or no products (after price discrepancy). Moving to ready_to_save.");
                setCurrentDialogStep('ready_to_save');
            }
            break;

        case 'ready_to_save':
        case 'error_loading':
            console.log(`[EditInvoice][processNextDialogStep] In step ${currentDialogStep}. No further automatic progression from here.`);
            break;
        default:
            console.warn(`[EditInvoice][processNextDialogStep] Unhandled currentDialogStep '${currentDialogStep}' with outcome '${previousStepOutcome}'. Defaulting to ready_to_save.`);
            setCurrentDialogStep('ready_to_save');
            break;
    }
  }, [currentDialogStep, isNewScan, user?.id, docTypeParam, products, productsForNextStep, selectedPaymentDueDate, isPaymentDueDateDialogSkipped, t, toast, checkForNewProductsAndDetails]);


  const startDialogFlowForNewScan = useCallback(async (scannedSupplierFromStorage: string | null | undefined, initialProductsFromScan: Product[]) => {
    console.log("[EditInvoice][startDialogFlowForNewScan] Called. Scanned supplier from storage:", scannedSupplierFromStorage, "isNewScan:", isNewScan, "user ID:", user?.id, "initialProducts length:", initialProductsFromScan.length);
    if (!isNewScan || !user?.id ) {
        console.log("[EditInvoice][startDialogFlowForNewScan] Conditions not met (not new scan or no user). Setting dialog step to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }
    
    setCurrentDialogStep('idle'); 
    setProductsForNextStep(initialProductsFromScan || []); 
    
    console.log("[EditInvoice][startDialogFlowForNewScan] Initial productsForNextStep set. Count:", (initialProductsFromScan || []).length);

    try {
        console.log("[EditInvoice][startDialogFlowForNewScan] Fetching suppliers for user:", user.id);
        const fetchedSuppliersList = await getSupplierSummariesService(user.id);
        console.log("[EditInvoice][startDialogFlowForNewScan] Fetched suppliers count:", fetchedSuppliersList.length);
        await _internalCheckSupplier(scannedSupplierFromStorage, user.id, fetchedSuppliersList);
        // After _internalCheckSupplier, if it doesn't set a dialog step, we need to advance
        // This is now handled by calling processNextDialogStep from the effect that calls startDialogFlowForNewScan
         if(currentDialogStep === 'idle') { // If _internalCheckSupplier decided no dialog was needed (e.g. supplier known)
             processNextDialogStep('supplier_existing_or_empty');
         }
    } catch (error) {
        console.error("[EditInvoice][startDialogFlowForNewScan] Error fetching suppliers:", error);
        toast({
          title: t('error_title'),
          description: `${t('edit_invoice_toast_error_fetching_suppliers')} ${error instanceof Error ? `(${error.message})` : ''}`,
          variant: "destructive"
        });
        setIsSupplierConfirmed(true); 
        processNextDialogStep('supplier_fetch_error');
    }
  }, [isNewScan, user?.id, toast, t, _internalCheckSupplier, processNextDialogStep, currentDialogStep]); // Added currentDialogStep


  const loadData = useCallback(async () => {
    const tempInvIdParam = searchParams.get('tempInvoiceId'); 
    const invoiceIdParam = searchParams.get('invoiceId');
    // docTypeParam is already defined in the component scope using useMemo
    const keyParam = searchParams.get('key'); // This key is for localStorage results if Firestore pending doc fails
    const localStorageScanDataMissingParam = searchParams.get('localStorageScanDataMissing') === 'true';

    if (initialDataLoaded && !tempInvIdParam && !invoiceIdParam && initialTempInvoiceId === null) {
      console.log("[EditInvoice][loadData] Already loaded and no new identifiers. Skipping.");
      return;
    }
    if (initialDataLoaded && (tempInvIdParam && tempInvIdParam === initialTempInvoiceId) && !invoiceIdParam) {
        console.log("[EditInvoice][loadData] Already loaded for current tempInvId. Skipping.");
        return;
    }

    if (!user || !user.id) {
        console.warn("[EditInvoice][loadData] User or user.id missing. Aborting.");
        setErrorLoading(t('edit_invoice_user_not_authenticated_title'));
        setCurrentDialogStep('error_loading');
        setIsLoading(false);
        return;
    }
    
    console.log("[EditInvoice][loadData] Proceeding with data load for user:", user.id);
    setIsLoading(true);
    setErrorLoading(null);
    setScanProcessErrorState(null);
    
    const nameParam = searchParams.get('fileName'); 
    
    const currentIsNewScanVal = !invoiceIdParam && !!tempInvIdParam;
    setIsNewScan(currentIsNewScanVal);
    console.log(`[EditInvoice][loadData] Flags: isNewScan: ${currentIsNewScanVal}, documentType: ${docTypeParam}, tempInvIdParam(FS): ${tempInvIdParam}, invoiceIdParam(FS final): ${invoiceIdParam}, localStorageKeyParam: ${keyParam}`);

    if (currentIsNewScanVal) {
        console.log("[EditInvoice][loadData] New scan detected. Resetting states for dialog flow.");
        setCurrentDialogStep('idle');
        setIsSupplierConfirmed(false);
        setSelectedPaymentDueDate(undefined);
        setIsPaymentDueDateDialogSkipped(false);
        setPotentialSupplierName(undefined);
        setAiScannedSupplierNameFromStorage(undefined);
        setProductsToDisplayForNewDetails([]);
        setProductInputStates({});
        setProductsForNextStep([]);
        setProducts([]);
        setInitialScannedProducts([]);
        setEditableTaxInvoiceDetails({});
        setInitialScannedTaxDetails({});
        setPriceDiscrepancies(null);
    } else if (invoiceIdParam) {
        setIsViewMode(true);
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
        setCurrentDialogStep('ready_to_save'); 
    } else { 
       setIsViewMode(false); 
       setIsEditingTaxDetails(true); 
       setIsEditingDeliveryNoteProducts(true);
       setCurrentDialogStep('ready_to_save'); 
    }

    setInitialTempInvoiceId(tempInvIdParam); // Store the current tempInvId being processed
    
    if (nameParam) {
      setOriginalFileName(decodeURIComponent(nameParam));
    } else if (!invoiceIdParam) { 
        setOriginalFileName(t('edit_invoice_unknown_document'));
    }
    
    let finalScanResult: ScanInvoiceOutput | ScanTaxInvoiceOutput | null = null;
    let scanResultJsonFromStorage: string | null = null; 
    let initialProductsFromScanData: Product[] = [];
    let localAiScannedSupplierName: string | null | undefined = undefined; // Changed from null to undefined for consistency

    if (invoiceIdParam) { 
        console.log(`[EditInvoice][loadData] Loading existing FINAL invoice ID: ${invoiceIdParam}`);
        try {
            const allUserInvoices = await getInvoicesService(user.id); // This already filters by userId
            const inv = allUserInvoices.find(i => i.id === invoiceIdParam);
            if (inv) {
                console.log("[EditInvoice][loadData] Existing final invoice found:", inv);
                setOriginalFileName(inv.generatedFileName || inv.originalFileName || t('edit_invoice_unknown_document'));
                
                const taxDetails: EditableTaxInvoiceDetails = {
                    supplierName: inv.supplierName || null,
                    invoiceNumber: inv.invoiceNumber || null,
                    totalAmount: inv.totalAmount ?? null,
                    invoiceDate: inv.invoiceDate || null,
                    paymentMethod: inv.paymentMethod || null,
                    paymentDueDate: inv.paymentDueDate || null,
                };
                setEditableTaxInvoiceDetails(taxDetails);
                setInitialScannedTaxDetails(taxDetails); 
                setSelectedPaymentDueDate(inv.paymentDueDate ? (inv.paymentDueDate instanceof Timestamp ? inv.paymentDueDate.toDate() : (typeof inv.paymentDueDate === 'string' && isValid(parseISO(inv.paymentDueDate)) ? parseISO(inv.paymentDueDate) : undefined)) : undefined);
                setDisplayedOriginalImageUrl(inv.originalImagePreviewUri || null); 
                setDisplayedCompressedImageUrl(inv.compressedImageForFinalRecordUri || null);
                
                let fetchedProducts: Product[] = [];
                 if (docTypeParam === 'deliveryNote' && inv.rawScanResultJson) { // Use docTypeParam here
                     try {
                         const parsedScan = JSON.parse(inv.rawScanResultJson) as ScanInvoiceOutput;
                         if (parsedScan && Array.isArray(parsedScan.products)) {
                             fetchedProducts = parsedScan.products.map((p: any, index: number) => ({
                                ...p,
                                id: p.id || `prod-from-final-${inv.id}-${index}`,
                                _originalId: p.id || `prod-from-final-${inv.id}-${index}`,
                                salePrice: p.salePrice === null || p.salePrice === undefined ? undefined : p.salePrice,
                             }));
                         }
                     } catch (e) {
                         console.error("[EditInvoice][loadData] Error parsing rawScanResultJson from final invoice:", e);
                     }
                 }
                
                const productsWithSalePriceHandling = fetchedProducts.map(p => ({ ...p, salePrice: p.salePrice, _originalId: p.id }));
                setProducts(productsWithSalePriceHandling);
                setInitialScannedProducts(productsWithSalePriceHandling);
                setProductsForNextStep(productsWithSalePriceHandling); 
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
    } else if (tempInvIdParam && user?.id && db) { 
        console.log(`[EditInvoice][loadData] New scan, attempting to load PENDING Firestore doc: ${tempInvIdParam}`);
        const pendingDocRef = doc(db, DOCUMENTS_COLLECTION, tempInvIdParam);
        try {
            const pendingDocSnap = await getDoc(pendingDocRef);
            if (pendingDocSnap.exists() && pendingDocSnap.data().userId === user.id) {
                const pendingData = pendingDocSnap.data() as InvoiceHistoryItem;
                console.log("[EditInvoice][loadData] Loaded PENDING document from Firestore:", pendingData);
                setOriginalFileName(pendingData.originalFileName || t('edit_invoice_unknown_document'));
                console.log("[EditInvoice][loadData] Document type from PENDING Firestore doc:", pendingData.documentType);

                const taxDetails: EditableTaxInvoiceDetails = {
                    supplierName: pendingData.supplierName || null,
                    invoiceNumber: pendingData.invoiceNumber || null,
                    totalAmount: pendingData.totalAmount ?? null,
                    invoiceDate: pendingData.invoiceDate || null,
                    paymentMethod: pendingData.paymentMethod || null,
                    paymentDueDate: pendingData.paymentDueDate || null,
                };
                setEditableTaxInvoiceDetails(taxDetails);
                setInitialScannedTaxDetails(taxDetails); 
                localAiScannedSupplierName = pendingData.supplierName;
                setAiScannedSupplierNameFromStorage(localAiScannedSupplierName); 
                console.log("[EditInvoice][loadData] Tax details set from PENDING Firestore doc. AI Scanned Supplier:", pendingData.supplierName);

                setSelectedPaymentDueDate(pendingData.paymentDueDate ? (pendingData.paymentDueDate instanceof Timestamp ? pendingData.paymentDueDate.toDate() : (typeof pendingData.paymentDueDate === 'string' && isValid(parseISO(pendingData.paymentDueDate)) ? parseISO(pendingData.paymentDueDate) : undefined)) : undefined);
                setDisplayedOriginalImageUrl(pendingData.originalImagePreviewUri || null);
                setDisplayedCompressedImageUrl(pendingData.compressedImageForFinalRecordUri || null);
                
                scanResultJsonFromStorage = pendingData.rawScanResultJson || null; 
                console.log("[EditInvoice][loadData] rawScanResultJson from Firestore pending doc:", scanResultJsonFromStorage ? "Exists" : "Missing");


                if (scanResultJsonFromStorage) {
                    try {
                        const parsedScanResult = JSON.parse(scanResultJsonFromStorage);
                        console.log("[EditInvoice][loadData] Parsed rawScanResultJson:", parsedScanResult);

                        if (docTypeParam === 'deliveryNote' && parsedScanResult && 'products' in parsedScanResult && Array.isArray(parsedScanResult.products)) {
                            initialProductsFromScanData = parsedScanResult.products.map((p: any, index: number) => ({
                                ...p,
                                id: p.id || `prod-temp-${Date.now()}-${index}`, 
                                _originalId: p.id || `prod-temp-${Date.now()}-${index}`,
                                userId: user.id, 
                                quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                                lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
                                unitPrice: p.unitPrice !== undefined ? (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice))) : 0, 
                                salePrice: undefined, // Explicitly set to undefined for delivery notes to trigger BarcodePromptDialog
                                minStockLevel: p.minStockLevel ?? undefined,
                                maxStockLevel: p.maxStockLevel ?? undefined,
                                imageUrl: p.imageUrl ?? undefined,
                            }));
                            console.log("[EditInvoice][loadData] Initial products set from delivery note scan (salePrice reset for prompt):", initialProductsFromScanData.length);
                        } else if (docTypeParam === 'invoice' && parsedScanResult) {
                            console.log("[EditInvoice][loadData] Tax invoice, no product list expected from AI scan. Using top-level fields from pending doc.");
                            // Tax details already set from pendingData object above, AI scan results are primarily for products.
                        }
                         if (parsedScanResult.error && !pendingData.errorMessage) { // If AI had an error not captured in pendingData.errorMessage
                           setScanProcessErrorState(parsedScanResult.error);
                           console.log("[EditInvoice][loadData] Scan process error from rawScanResultJson:", parsedScanResult.error);
                        }

                    } catch (jsonError) {
                        console.error("[EditInvoice][loadData] Error parsing rawScanResultJson:", jsonError);
                        const parseErrorMsg = t('edit_invoice_toast_error_loading_desc_invalid_format');
                        setScanProcessErrorState(prev => prev ? `${prev}; ${parseErrorMsg}` : parseErrorMsg);
                    }
                } else if (docTypeParam === 'deliveryNote') { // rawScanResultJson is crucial for delivery notes
                    console.warn("[EditInvoice][loadData] rawScanResultJson missing from Firestore pending doc for delivery note. User will need to add items manually.");
                    toast({
                        title: t('edit_invoice_toast_scan_data_missing_title'),
                        description: t('edit_invoice_toast_scan_data_missing_desc_ls_fail'), // Re-using a similar translation
                        variant: "warning",
                        duration: 7000
                    });
                }
                
                if (pendingData.errorMessage && !scanProcessErrorState) { // If pendingData had an error already
                  setScanProcessErrorState(pendingData.errorMessage);
                  console.log("[EditInvoice][loadData] Scan process error from pendingData.errorMessage:", pendingData.errorMessage);
                }
                
            } else {
                 console.warn(`[EditInvoice][loadData] PENDING Firestore doc ${tempInvIdParam} not found or permission denied. This might happen if upload page failed to create it or if it was already finalized/deleted.`);
                 // If Firestore pending doc failed, we don't attempt localStorage fallback for rawScanResultJson anymore
                 // as this data is now expected to be in the pending doc.
                 // Image URIs are also expected from pending doc.
                 setErrorLoading(t('edit_invoice_error_scan_results_not_found_key', {key: tempInvIdParam || 'unknown'}));
                 setCurrentDialogStep('error_loading');
            }
        } catch (firestoreError) {
            console.error(`[EditInvoice][loadData] Error loading PENDING Firestore doc ${tempInvIdParam}:`, firestoreError);
            setErrorLoading(t('edit_invoice_error_loading_existing'));
            setCurrentDialogStep('error_loading');
        }

    } else if (!initialDataLoaded && !invoiceIdParam && !tempInvIdParam) { 
       console.error("[EditInvoice][loadData] No identifiers provided. Cannot determine data source.");
       setErrorLoading(t('edit_invoice_error_no_key_or_id'));
       setCurrentDialogStep('error_loading');
    }
    
    console.log("[EditInvoice][loadData] Setting initial products based on scan data. Count:", initialProductsFromScanData.length);
    setProducts(initialProductsFromScanData);
    setInitialScannedProducts(initialProductsFromScanData);
    setProductsForNextStep(initialProductsFromScanData); 

    if (currentIsNewScanVal && currentDialogStep !== 'error_loading') {
       await startDialogFlowForNewScan(localAiScannedSupplierName, initialProductsFromScanData);
    }

    setInitialDataLoaded(true);
    setIsLoading(false);
    console.log("[EditInvoice][loadData] Finished. Current Dialog Step after load:", currentDialogStep);
  }, [
      user?.id, authLoading, searchParams, t, toast, startDialogFlowForNewScan, docTypeParam, 
      initialTempInvoiceId, initialDataLoaded, // To prevent re-running if these haven't changed
      processNextDialogStep, _internalCheckSupplier, checkForNewProductsAndDetails // Added for stability
  ]); 
  

  useEffect(() => {
    console.log("[EditInvoice] Main useEffect (user, authLoading, initialDataLoaded, loadData) triggered.");
    if(user && user.id && !initialDataLoaded && !authLoading) { 
      console.log("[EditInvoice] Main useEffect: Conditions met, calling loadData.");
      loadData();
    } else if (!authLoading && !user) {
        console.log("[EditInvoice] Main useEffect: No user and not auth loading, redirecting to login.");
        router.push('/login');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, initialDataLoaded, loadData, router]); // SearchParams can be too broad, rely on specific query param changes handled by initialDataLoaded flag
  
  
  useEffect(() => {
    console.log(`[EditInvoice] Dialog effect triggered. currentDialogStep: ${currentDialogStep}`);
    if (currentDialogStep !== 'supplier_confirmation') setPotentialSupplierName(undefined); 
    if (currentDialogStep !== 'price_discrepancy') setPriceDiscrepancies(null);
    if (currentDialogStep !== 'new_product_details') {
        setProductsToDisplayForNewDetails([]); // Ensure this clears when not in this step
    }
  }, [currentDialogStep]);


  const handleSupplierConfirmation = useCallback(async (confirmedSupplierName: string | null, isNew: boolean = false) => {
    console.log(`[EditInvoice][handleSupplierConfirmation] Confirmed: "${confirmedSupplierName}", isNew: ${isNew}`);
    if (!user?.id) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        return;
    }

    let finalConfirmedName = confirmedSupplierName;
    if (finalConfirmedName && finalConfirmedName.trim() !== '') {
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
        if (isNew) {
            try {
                console.log(`[EditInvoice][handleSupplierConfirmation] Attempting to save new supplier '${finalConfirmedName}' via service.`);
                await updateSupplierContactInfoService(finalConfirmedName, {}, user.id, true); // Assuming this now handles create if not found
                toast({ title: t('edit_invoice_toast_new_supplier_added_title'), description: t('edit_invoice_toast_new_supplier_added_desc', { supplierName: finalConfirmedName }) });
                const fetchedSuppliersList = await getSupplierSummariesService(user.id); // Refresh supplier list
                setExistingSuppliers(fetchedSuppliersList);
            } catch (error: any) {
                console.error("[EditInvoice][handleSupplierConfirmation] Failed to add new supplier:", error);
                let errorMsg = t('suppliers_toast_create_fail_desc', {message: (error as Error).message});
                 if (error.message && (error.message.includes("already exists") || error.message.includes("Supplier with name") )) {
                  errorMsg = t('edit_invoice_toast_supplier_already_exists_error', { supplierName: finalConfirmedName });
                }
                toast({ title: t('edit_invoice_toast_fail_add_supplier_title'), description: errorMsg, variant: "destructive" });
            }
        }
    } else {
        // If cancelled or no name provided, use the AI scanned name if available, or the one from initial scan
        finalConfirmedName = aiScannedSupplierNameFromStorage || initialScannedTaxDetails.supplierName || null;
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
    }
    setIsSupplierConfirmed(true); 
    processNextDialogStep('supplier_confirmed');
  }, [user?.id, toast, t, aiScannedSupplierNameFromStorage, initialScannedTaxDetails.supplierName, processNextDialogStep]);

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


  const handleNewProductDetailsComplete = useCallback(async (updatedNewProductsFromDialog: Product[] | null) => {
     console.log("[EditInvoice][handleNewProductDetailsComplete] Updated products from BarcodePromptDialog:", updatedNewProductsFromDialog ? updatedNewProductsFromDialog.length : 'null (dialog cancelled/skipped)');
     setProductsToDisplayForNewDetails([]);

     let finalProductsForProcess: Product[];

     if (updatedNewProductsFromDialog && updatedNewProductsFromDialog.length > 0) {
        const baseProducts = (productsForNextStep.length > 0 && isNewScan) ? productsForNextStep : initialScannedProducts;
        const updatedMap = new Map(updatedNewProductsFromDialog.map(p => [p._originalId || p.id, p]));
        
        finalProductsForProcess = baseProducts.map(originalP => {
            const idToMatch = originalP._originalId || originalP.id;
            const updatedPData = updatedMap.get(idToMatch);
            if (updatedPData) {
                return { 
                    ...originalP, 
                    barcode: updatedPData.barcode || originalP.barcode, 
                    salePrice: updatedPData.salePrice, // Will be undefined if skipped
                    id: originalP.id 
                };
            }
            return originalP; 
        });
     } else { 
        finalProductsForProcess = (productsForNextStep.length > 0 && isNewScan) ? productsForNextStep : products;
        // If dialog was cancelled, ensure salePrice is undefined for products that were meant to be reviewed
        finalProductsForProcess = finalProductsForProcess.map(p => {
            if (initialProductsFromProps.find(ip => ip.id === p.id && ip.salePrice === undefined)) { // Check against original prop data
                return { ...p, salePrice: undefined };
            }
            return p;
        });
     }
     
     setProductsForNextStep(finalProductsForProcess); 
     setProducts(finalProductsForProcess.map(p => ({...p, _originalId: p.id || p._originalId})));
     console.log("[EditInvoice][handleNewProductDetailsComplete] Dialog complete. productsForNextStep updated. Moving to ready_to_save.");
     processNextDialogStep('new_product_details_complete', finalProductsForProcess); // Pass data here if needed by processNext
   }, [products, productsForNextStep, initialScannedProducts, isNewScan, processNextDialogStep, initialProductsFromProps]); // Added initialProductsFromProps

  const handlePriceConfirmationComplete = useCallback(async (resolvedProducts: Product[] | null) => {
    console.log("[EditInvoice][handlePriceConfirmationComplete] Resolved products from dialog count:", resolvedProducts ? resolvedProducts.length : 'null (cancelled)');
    setPriceDiscrepancies(null); 
    processNextDialogStep('price_discrepancy_complete', resolvedProducts);
  }, [processNextDialogStep]);


  const proceedWithFinalSave = useCallback(async (finalProductsToSave: Product[]) => {
      console.log("[EditInvoice][proceedWithFinalSave] Called with products:", finalProductsToSave);
      if (!user?.id || !docTypeParam) {
          toast({ title: t("edit_invoice_user_not_authenticated_title"), description: t("edit_invoice_user_not_authenticated_desc"), variant: "destructive" });
          setCurrentDialogStep('error_loading');
          setIsSaving(false);
          return; 
      }
      
      try {
          const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => rest);

          let finalFileNameForSave = originalFileName;
          const finalSupplierNameForSave = editableTaxInvoiceDetails.supplierName;
          const finalInvoiceNumberForSave = editableTaxInvoiceDetails.invoiceNumber;
          const finalTotalAmountForSave = editableTaxInvoiceDetails.totalAmount;
          
          let finalInvoiceDateForSave: Timestamp | string | Date | null = null;
          if (editableTaxInvoiceDetails.invoiceDate instanceof Timestamp) finalInvoiceDateForSave = editableTaxInvoiceDetails.invoiceDate;
          else if (typeof editableTaxInvoiceDetails.invoiceDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate))) finalInvoiceDateForSave = parseISO(editableTaxInvoiceDetails.invoiceDate);
          else if (editableTaxInvoiceDetails.invoiceDate instanceof Date && isValid(editableTaxInvoiceDetails.invoiceDate)) finalInvoiceDateForSave = editableTaxInvoiceDetails.invoiceDate;

          const finalPaymentMethodForSave = editableTaxInvoiceDetails.paymentMethod;
          
          let finalPaymentDueDateForSave: Timestamp | string | Date | null = null;
          if (selectedPaymentDueDate instanceof Timestamp) finalPaymentDueDateForSave = selectedPaymentDueDate;
          else if (typeof selectedPaymentDueDate === 'string' && isValid(parseISO(selectedPaymentDueDate))) finalPaymentDueDateForSave = parseISO(selectedPaymentDueDate);
          else if (selectedPaymentDueDate instanceof Date && isValid(selectedPaymentDueDate)) finalPaymentDueDateForSave = selectedPaymentDueDate;


          if(finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '' && finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
            finalFileNameForSave = `${finalSupplierNameForSave}_${finalInvoiceNumberForSave}`;
          } else if (finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '') {
            finalFileNameForSave = finalSupplierNameForSave;
          } else if (finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
            finalFileNameForSave = `Invoice_${finalInvoiceNumberForSave}`;
          }
          finalFileNameForSave = finalFileNameForSave.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);
          
          let rawScanResultJsonToSave: string | null = null;
          // Get rawScanResultJson from the initial loaded state if available
          // It might have been stored on the pending Firestore document from upload page
          if (initialTempInvoiceId && db && user?.id) { // Check if we are editing a pending doc
             const pendingDocRef = doc(db, DOCUMENTS_COLLECTION, initialTempInvoiceId);
             const pendingDocSnap = await getDoc(pendingDocRef);
             if (pendingDocSnap.exists()) {
                 rawScanResultJsonToSave = pendingDocSnap.data()?.rawScanResultJson || null;
             }
          } else if (searchParams.get('invoiceId') && !initialTempInvoiceId) { // Editing an existing final doc
             const finalDocRef = doc(db, DOCUMENTS_COLLECTION, searchParams.get('invoiceId')!);
             const finalDocSnap = await getDoc(finalDocRef);
             if (finalDocSnap.exists()) {
                rawScanResultJsonToSave = finalDocSnap.data()?.rawScanResultJson || null;
             }
          }
          
          const result = await finalizeSaveProductsService(
            productsForService,
            finalFileNameForSave,
            docTypeParam,
            user.id,
            initialTempInvoiceId || searchParams.get('invoiceId') || undefined, // Use final invoiceId if temp is not available (editing existing)
            finalInvoiceNumberForSave || undefined,
            finalSupplierNameForSave || undefined,
            finalTotalAmountForSave ?? undefined,
            finalPaymentDueDateForSave, 
            finalInvoiceDateForSave, 
            finalPaymentMethodForSave || undefined, 
            displayedOriginalImageUrl || undefined, 
            displayedCompressedImageUrl || undefined,
            rawScanResultJsonToSave 
          );
          console.log("[EditInvoice][proceedWithFinalSave] finalizeSaveProductsService result:", result);
          cleanupTemporaryData(); 

          if (result.finalInvoiceRecord) {
            setOriginalFileName(result.finalInvoiceRecord.generatedFileName || result.finalInvoiceRecord.originalFileName || t('edit_invoice_unknown_document')); 
            // setInitialTempInvoiceId(result.finalInvoiceRecord.id); // Comment out for now, as we might be editing a final doc
            
            const finalTaxDetails: EditableTaxInvoiceDetails = {
                supplierName: result.finalInvoiceRecord.supplierName,
                invoiceNumber: result.finalInvoiceRecord.invoiceNumber,
                totalAmount: result.finalInvoiceRecord.totalAmount,
                invoiceDate: result.finalInvoiceRecord.invoiceDate,
                paymentMethod: result.finalInvoiceRecord.paymentMethod,
                paymentDueDate: result.finalInvoiceRecord.paymentDueDate,
            };
            setEditableTaxInvoiceDetails(finalTaxDetails);
            setInitialScannedTaxDetails(finalTaxDetails); 
            setSelectedPaymentDueDate(result.finalInvoiceRecord.paymentDueDate ? (result.finalInvoiceRecord.paymentDueDate instanceof Timestamp ? result.finalInvoiceRecord.paymentDueDate.toDate() : (typeof result.finalInvoiceRecord.paymentDueDate === 'string' && isValid(parseISO(result.finalInvoiceRecord.paymentDueDate)) ? parseISO(result.finalInvoiceRecord.paymentDueDate) : undefined )) : undefined);
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
            setIsViewMode(true); 
            setCurrentDialogStep('idle'); 
             toast({
                title: docTypeParam === 'deliveryNote' ? t('edit_invoice_toast_products_saved_title') : t('edit_invoice_toast_invoice_details_saved_title'),
                description: docTypeParam === 'deliveryNote' ? t('edit_invoice_toast_products_saved_desc') : t('edit_invoice_toast_invoice_details_saved_desc'),
            });
            if (docTypeParam === 'deliveryNote') {
                 router.push('/inventory?refresh=true');
            } else if (docTypeParam === 'invoice') {
                 router.push('/invoices?tab=scanned-docs'); 
            }
          } else {
             console.error("[EditInvoice][proceedWithFinalSave] Final invoice record not returned or error occurred.", result);
             setScanProcessErrorState(t('edit_invoice_toast_save_failed_desc_finalize', { message: "Final invoice record not returned."}));
             setCurrentDialogStep('error_loading'); 
          }
      } catch (error: any) {
          console.error("[EditInvoice][proceedWithFinalSave] Failed to finalize save products:", error);
           if ((error as any).isQuotaError) { 
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
          console.log("[EditInvoice][proceedWithFinalSave] Setting isSaving to false.");
          setIsSaving(false);
      }
  }, [user?.id, docTypeParam, originalFileName, editableTaxInvoiceDetails, selectedPaymentDueDate, initialTempInvoiceId, searchParams, displayedOriginalImageUrl, displayedCompressedImageUrl, cleanupTemporaryData, toast, t, router]);

 const proceedWithActualSave = useCallback(async (productsToSave: Product[]) => {
    console.log("[EditInvoice][proceedWithActualSave] Called. Products to save:", productsToSave, "Current Dialog Step:", currentDialogStep);
    if (!user?.id || !docTypeParam) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        setIsSaving(false); 
        return;
    }
    
    let currentProductsToProcess = [...productsToSave];

    try {
        if(docTypeParam === 'deliveryNote' && currentProductsToProcess.length > 0) {
            console.log("[EditInvoice][proceedWithActualSave] Delivery note, checking prices...");
            const priceCheckResult = await checkProductPricesBeforeSaveService(currentProductsToProcess, user.id);
            
            if (priceCheckResult.priceDiscrepancies.length > 0) {
                console.log("[EditInvoice][proceedWithActualSave] Price discrepancies found. Setting state and opening dialog.");
                setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
                const productsForDiscrepancyDialog = priceCheckResult.productsToSaveDirectly.concat(
                    priceCheckResult.priceDiscrepancies.map(d => ({
                        ...d, 
                        unitPrice: d.newUnitPrice, 
                        salePrice: d.salePrice, 
                    }))
                );
                setProductsForNextStep(productsForDiscrepancyDialog); 
                setCurrentDialogStep('price_discrepancy');
                setIsSaving(false); // Allow user interaction with dialog
                return; 
            }
            console.log("[EditInvoice][proceedWithActualSave] No price discrepancies. Products to save directly:", priceCheckResult.productsToSaveDirectly);
            currentProductsToProcess = priceCheckResult.productsToSaveDirectly; 
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
        setCurrentDialogStep('error_loading');
    } finally {
       // Only set isSaving to false here if we are not waiting for another dialog (price_discrepancy)
       // proceedWithFinalSave will handle its own setIsSaving(false)
       if (currentDialogStep !== 'price_discrepancy' && currentDialogStep !== 'new_product_details') {
           setIsSaving(false);
           console.log("[EditInvoice][proceedWithActualSave] Finally block: setIsSaving(false). Current step:", currentDialogStep);
       }
    }
}, [user?.id, docTypeParam, toast, t, proceedWithFinalSave, currentDialogStep]); // Added currentDialogStep

 const handleSaveChecks = useCallback(async () => {
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

    if (isNewScan && currentDialogStep !== 'ready_to_save') {
        console.log(`[EditInvoice][handleSaveChecks] New scan, current step '${currentDialogStep}' is not 'ready_to_save'. Re-triggering dialog flow.`);
        
        // Manually re-trigger the flow from the current known state
        if (currentDialogStep === 'idle' || currentDialogStep === 'supplier_confirmation') {
            await startDialogFlowForNewScan(aiScannedSupplierNameFromStorage || initialScannedTaxDetails.supplierName, productsForNextStep.length > 0 ? productsForNextStep : initialScannedProducts);
        } else if (currentDialogStep === 'payment_due_date') {
            processNextDialogStep('payment_due_date_confirm_attempt_from_save'); // Custom outcome
        } else if (currentDialogStep === 'new_product_details') {
            // If user forces save while new_product_details dialog should be open, treat as completing it with current inputs
            const currentProductsWithInputs = (productsToDisplayForNewDetails.length > 0 ? productsToDisplayForNewDetails : initialScannedProducts).map(p => {
                const inputs = productInputStates[p.id || p._originalId!] || {};
                return {
                    ...p,
                    barcode: inputs.barcode || p.barcode,
                    salePrice: inputs.salePrice, // Will be undefined if not set
                };
            });
            console.log("[EditInvoice][handleSaveChecks] Forcing completion of new_product_details. Products with inputs:", currentProductsWithInputs);
            await handleNewProductDetailsComplete(currentProductsWithInputs); 
            // handleNewProductDetailsComplete now sets step to 'ready_to_save',
            // so the next click on save should proceed. Or we could call proceedWithActualSave directly here
            // but that might bypass price discrepancy. It's safer to let user click save again.
        } else {
           console.warn("[EditInvoice][handleSaveChecks] Save clicked in an unexpected dialog step for new scan:", currentDialogStep);
        }
        setIsSaving(false); 
        return;
    }
    
    console.log("[EditInvoice][handleSaveChecks] Proceeding to actual save logic. Products for save:", productsForNextStep.length > 0 ? productsForNextStep : products);
    await proceedWithActualSave(productsForNextStep.length > 0 ? productsForNextStep : products);
}, [isSaving, user?.id, toast, t, isNewScan, currentDialogStep, startDialogFlowForNewScan, processNextDialogStep, productsForNextStep, products, initialScannedProducts, proceedWithActualSave, aiScannedSupplierNameFromStorage, initialScannedTaxDetails, handleNewProductDetailsComplete, productInputStates, productsToDisplayForNewDetails]);

    // This useEffect now only depends on user, authLoading, and the memoized loadData function.
    // searchParams changes are handled inside loadData by comparing with initialTempInvoiceId.
    useEffect(() => {
        console.log(`[EditInvoice][Main useEffect] Triggered. User: ${user?.id}, AuthLoading: ${authLoading}, InitialDataLoaded: ${initialDataLoaded}`);
        if (user && user.id && !authLoading) {
            if (!initialDataLoaded || (searchParams.get('tempInvoiceId') && searchParams.get('tempInvoiceId') !== initialTempInvoiceId)) {
                console.log(`[EditInvoice][Main useEffect] Conditions met to call loadData. TempInvoiceId: ${searchParams.get('tempInvoiceId')}, initialTempInvoiceId: ${initialTempInvoiceId}`);
                loadData();
            } else {
                console.log("[EditInvoice][Main useEffect] Data already loaded or no relevant param change, skipping loadData call.");
            }
        } else if (!authLoading && !user) {
            console.log("[EditInvoice][Main useEffect] No user, redirecting to login.");
            router.push('/login');
        }
    }, [user, authLoading, searchParams, loadData, router, initialDataLoaded, initialTempInvoiceId]); // Added initialDataLoaded and initialTempInvoiceId
    

    const handleGoBack = useCallback(() => {
        console.log("[EditInvoice] handleGoBack called. Cleaning up temp data and navigating.");
        cleanupTemporaryData(); 
        router.push(isNewScan ? '/upload' : (docTypeParam === 'invoice' ? '/invoices?tab=scanned-docs' : '/inventory'));
    }, [cleanupTemporaryData, router, isNewScan, docTypeParam]);

  const handleInputChange = useCallback((id: string, field: keyof EditableProduct, value: string | number) => {
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
             if (currentQuantity > 0 && currentUnitPrice >= 0 ) {
                currentLineTotal = parseFloat((currentQuantity * currentUnitPrice).toFixed(2));
             } else if ((field === 'unitPrice' && currentUnitPrice === 0 && currentQuantity > 0) || (field === 'quantity' && currentQuantity === 0) ) { 
                 currentLineTotal = 0; 
             }
            updatedProduct.lineTotal = currentLineTotal;
          } else if (field === 'lineTotal') {
            if (currentQuantity > 0 && currentLineTotal >= 0) { 
              currentUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
              updatedProduct.unitPrice = currentUnitPrice;
            } else if (currentLineTotal === 0) { 
                 updatedProduct.unitPrice = 0;
            }
          }
          
           if (currentQuantity === 0 || currentUnitPrice === 0) {
                updatedProduct.lineTotal = 0;
           }
           if (currentQuantity > 0 && currentLineTotal > 0 && field !== 'unitPrice' && currentUnitPrice === 0) {
               updatedProduct.unitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
           }
          return updatedProduct;
        }
        return p;
      })
    );
    setProductsForNextStep(prev => prev.map(p => {
        const editedP = products.find(ep => ep.id === p.id);
        return editedP || p;
    }));
  }, [products]);

  const handleTaxInvoiceDetailsChange = useCallback((field: keyof EditableTaxInvoiceDetails, value: string | number | undefined | Date | Timestamp) => {
     setEditableTaxInvoiceDetails(prev => ({ ...prev, [field]: value === '' ? null : value }));
  }, []);

  const handleAddRow = useCallback(() => {
    const newProduct: EditableProduct = {
      id: `prod-temp-${Date.now()}-new`,
      _originalId: `prod-temp-${Date.now()}-new`,
      userId: user?.id || 'unknown',
      catalogNumber: '',
      description: '',
      quantity: 0,
      unitPrice: 0,
      lineTotal: 0,
      barcode: null,
      minStockLevel: null,
      maxStockLevel: null,
      salePrice: null,
      imageUrl: null,
    };
    setProducts(prevProducts => [...prevProducts, newProduct]);
    setProductsForNextStep(prev => [...prev, newProduct]); 
  }, [user?.id]);

  const handleRemoveRow = useCallback((id: string) => {
    setProducts(prevProducts => prevProducts.filter(product => product.id !== id));
    setProductsForNextStep(prev => prev.filter(product => product.id !== id)); 
     toast({
        title: t('edit_invoice_toast_row_removed_title'),
        description: t('edit_invoice_toast_row_removed_desc'),
        variant: "default",
     });
  }, [t, toast]);

    const handleCancelEditTaxDetails = useCallback(() => {
        setEditableTaxInvoiceDetails({...initialScannedTaxDetails}); 
        setIsEditingTaxDetails(false);
        if (!isEditingDeliveryNoteProducts) setIsViewMode(true); 
    }, [initialScannedTaxDetails, isEditingDeliveryNoteProducts]);

    const handleSaveEditTaxDetails = useCallback(() => {
        setInitialScannedTaxDetails({...editableTaxInvoiceDetails}); 
        setIsEditingTaxDetails(false);
        if (!isEditingDeliveryNoteProducts) setIsViewMode(true);
        toast({ title: t('edit_invoice_toast_section_updated_title'), description: t('edit_invoice_toast_section_updated_desc') });
    }, [editableTaxInvoiceDetails, isEditingDeliveryNoteProducts, toast, t]);

    const handleCancelEditProducts = useCallback(() => {
        setProducts(initialScannedProducts.map(p => ({...p}))); 
        setProductsForNextStep(initialScannedProducts.map(({_originalId, ...rest}) => rest)); 
        setIsEditingDeliveryNoteProducts(false);
         if (!isEditingTaxDetails) setIsViewMode(true);
    }, [initialScannedProducts, isEditingTaxDetails]);

    const handleSaveEditProducts = useCallback(() => {
        setInitialScannedProducts(products.map(p => ({...p}))); 
        setProductsForNextStep(products.map(({_originalId, ...rest}) => rest)); 
        setIsEditingDeliveryNoteProducts(false);
        if (!isEditingTaxDetails) setIsViewMode(true);
        toast({ title: t('edit_invoice_toast_products_updated_title_section'), description: t('edit_invoice_toast_section_updated_desc') });
    }, [products, isEditingTaxDetails, toast, t]);

    const toggleEditTaxDetails = useCallback(() => {
        if (isEditingTaxDetails) {
            handleSaveEditTaxDetails(); 
        } else {
            setEditableTaxInvoiceDetails({...initialScannedTaxDetails}); 
            setIsEditingTaxDetails(true);
            setIsViewMode(false); 
        }
    }, [isEditingTaxDetails, handleSaveEditTaxDetails, initialScannedTaxDetails]);
    
    const toggleEditDeliveryNoteProducts = useCallback(() => {
        if (isEditingDeliveryNoteProducts) {
            handleSaveEditProducts(); 
        } else {
            setProducts([...initialScannedProducts.map(p => ({...p}))]); 
            setIsEditingDeliveryNoteProducts(true);
            setIsViewMode(false); 
        }
    }, [isEditingDeliveryNoteProducts, handleSaveEditProducts, initialScannedProducts]);


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
                    <AlertTitleComponent>{t('edit_invoice_error_loading_title')}</AlertTitleComponent>
                    <AlertDescription>{errorLoading || "An unknown error occurred."}</AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleGoBack}>
                   <ArrowLeft className="mr-2 h-4 w-4" /> {t('edit_invoice_go_back_button')}
                </Button>
            </div>
        );
    }

    const showManualEntryPrompt = isNewScan && currentDialogStep !== 'error_loading' && !isLoading &&
        ((docTypeParam === 'deliveryNote' && products.length === 0 && !scanProcessErrorState) ||
         (docTypeParam === 'invoice' && Object.values(editableTaxInvoiceDetails).every(val => val === undefined || val === '' || val === 0 || val === null) && !scanProcessErrorState));


    if (showManualEntryPrompt && !isLoading) { 
         return (
             <div className="container mx-auto p-4 md:p-8 space-y-4">
                 {scanProcessErrorState && (
                    <Alert variant="destructive">
                        <AlertTitleComponent>{t('edit_invoice_scan_process_error_title')}</AlertTitleComponent>
                        <AlertDescription>
                            {t('edit_invoice_scan_process_error_desc', { error: scanProcessErrorState })}
                        </AlertDescription>
                    </Alert>
                 )}
                 {!scanProcessErrorState && docTypeParam === 'deliveryNote' && products.length === 0 && (
                     <Alert variant="default">
                         <AlertTitleComponent>{t('edit_invoice_no_products_found_title')}</AlertTitleComponent>
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
                           {docTypeParam === 'deliveryNote' && (
                             <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                                <Button variant="outline" onClick={() => { handleAddRow(); setIsEditingDeliveryNoteProducts(true); setIsViewMode(false); setCurrentDialogStep('ready_to_save');}} className="w-full sm:w-auto">
                                <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                                </Button>
                            </div>
                           )}
                           {docTypeParam === 'invoice' && (
                             <React.Fragment>
                                 {renderEditableTaxInvoiceDetails()}
                             </React.Fragment>
                           )}
                            <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
                                <Button variant="outline" onClick={handleGoBack} className="w-full sm:w-auto order-last sm:order-first" disabled={isSaving}>
                                    <ArrowLeft className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_discard_scan_button') : t('edit_invoice_go_back_to_invoices_button')}
                                </Button>
                                
                                <div className="flex-grow flex flex-col sm:flex-row sm:justify-end gap-3">
                                    <Button 
                                        onClick={handleSaveChecks} 
                                        disabled={isSaving || (isNewScan && currentDialogStep !== 'ready_to_save') || (!isNewScan && isViewMode && !isEditingDeliveryNoteProducts && !isEditingTaxDetails) }
                                        className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                                    >
                                    {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_confirm_and_save_button') : t('edit_invoice_save_changes_button')}</>}
                                    </Button>
                                </div>
                            </div>
                      </CardContent>
                 </Card>
             </div>
         );
    }

    const renderScanSummaryItem = (labelKey: string, value?: string | number | null | Timestamp | Date, field?: keyof EditableTaxInvoiceDetails) => {
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
        if(noDetailsAvailable && isNewScan && currentDialogStep !== 'ready_to_save' && currentDialogStep !== 'error_loading'){
             return <p className="text-sm text-muted-foreground">{t('edit_invoice_awaiting_scan_details')}</p>;
        }

        return (
             <div className="space-y-3">
                {renderScanSummaryItem('invoice_details_supplier_label', detailsToDisplay.supplierName)}
                {renderScanSummaryItem('invoice_details_invoice_number_label', detailsToDisplay.invoiceNumber)}
                {renderScanSummaryItem('invoice_details_total_amount_label', detailsToDisplay.totalAmount)}
                {renderScanSummaryItem('invoice_details_invoice_date_label', detailsToDisplay.invoiceDate, 'invoiceDate')}
                {renderScanSummaryItem('invoice_details_payment_method_label', detailsToDisplay.paymentMethod)}
                {renderScanSummaryItem('payment_due_date_dialog_title', selectedPaymentDueDate || detailsToDisplay.paymentDueDate, 'paymentDueDate')}
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
             <div>
                <Label htmlFor="taxPaymentDueDate">{t('payment_due_date_dialog_title')}</Label>
                <Input
                    id="taxPaymentDueDate" 
                    type="date" 
                    value={selectedPaymentDueDate ? (selectedPaymentDueDate instanceof Timestamp ? format(selectedPaymentDueDate.toDate(), 'yyyy-MM-dd') : (typeof selectedPaymentDueDate === 'string' && isValid(parseISO(selectedPaymentDueDate)) ? format(parseISO(selectedPaymentDueDate), 'yyyy-MM-dd') : (selectedPaymentDueDate instanceof Date && isValid(selectedPaymentDueDate) ? format(selectedPaymentDueDate, 'yyyy-MM-dd') : ''))) : (editableTaxInvoiceDetails.paymentDueDate ? (editableTaxInvoiceDetails.paymentDueDate instanceof Timestamp ? format(editableTaxInvoiceDetails.paymentDueDate.toDate(), 'yyyy-MM-dd') : (typeof editableTaxInvoiceDetails.paymentDueDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.paymentDueDate)) ? format(parseISO(editableTaxInvoiceDetails.paymentDueDate), 'yyyy-MM-dd') : (editableTaxInvoiceDetails.paymentDueDate instanceof Date && isValid(editableTaxInvoiceDetails.paymentDueDate) ? format(editableTaxInvoiceDetails.paymentDueDate, 'yyyy-MM-dd') : ''))) : '')} 
                    onChange={(e) => { 
                        const newDate = e.target.value ? parseISO(e.target.value) : undefined;
                        setSelectedPaymentDueDate(newDate);
                        handleTaxInvoiceDetailsChange('paymentDueDate', newDate ? newDate.toISOString() : undefined);
                    }} 
                    disabled={isSaving} />
            </div>
        </div>
    );

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
       {/* Document Summary & Image Preview Section */}
        <Card className="shadow-md scale-fade-in overflow-hidden">
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-muted/30 p-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                            <FileTextIconLucide className="mr-2 h-5 w-5 flex-shrink-0" />
                            <span className="truncate" title={isViewMode || docTypeParam === 'invoice' ? t('edit_invoice_invoice_details_title') : t('edit_invoice_delivery_note_details_title')}>
                                {isViewMode || docTypeParam === 'invoice' ? t('edit_invoice_invoice_details_title') : t('edit_invoice_delivery_note_details_title')}
                            </span>
                        </CardTitle>
                         {!isNewScan && (
                            <Button variant="ghost" size="icon" onClick={toggleEditTaxDetails} className="h-8 w-8 text-muted-foreground hover:text-primary flex-shrink-0">
                                {isEditingTaxDetails ? <X className="h-4 w-4 text-destructive"/> : <Edit className="h-4 w-4" />}
                                <span className="sr-only">{isEditingTaxDetails ? t('cancel_button') : t('edit_button')}</span>
                            </Button>
                        )}
                    </div>
                    <CardDescription className="break-words mt-1 text-xs sm:text-sm">
                        {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
                    </CardDescription>
                </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
                {scanProcessErrorState && !isSaving && (
                    <Alert variant="destructive" className="mt-2">
                        <AlertTitleComponent>{t('edit_invoice_scan_process_error_title')}</AlertTitleComponent>
                        <AlertDescription>{scanProcessErrorState}</AlertDescription>
                    </Alert>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-1">
                         <Label className="text-sm font-medium text-muted-foreground mb-1 block">{t('edit_invoice_image_preview_label')}</Label>
                        {(displayedOriginalImageUrl || displayedCompressedImageUrl) && isValidImageSrc(displayedOriginalImageUrl || displayedCompressedImageUrl) ? (
                            <div className="relative aspect-auto w-full max-h-[400px] border rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800" data-ai-hint="invoice document">
                                <NextImage
                                    src={displayedOriginalImageUrl || displayedCompressedImageUrl!}
                                    alt={t('edit_invoice_image_preview_alt')}
                                    layout="fill"
                                    objectFit="contain"
                                />
                            </div>
                        ) : (
                             <div className="aspect-auto w-full max-h-[400px] border rounded-md bg-muted flex items-center justify-center text-muted-foreground" data-ai-hint="document placeholder">
                                <FileTextIconLucide className="h-16 w-16 opacity-50"/>
                            </div>
                        )}
                    </div>
                    <div className={cn("md:col-span-1 space-y-3", (isEditingTaxDetails && !isNewScan) && "p-3 border rounded-md bg-muted/20")}>
                         {(isEditingTaxDetails && !isNewScan) ? renderEditableTaxInvoiceDetails() : renderReadOnlyTaxInvoiceDetails()}
                         {(isEditingTaxDetails && !isNewScan) && (
                            <div className="flex justify-end gap-2 pt-3">
                                <Button variant="outline" size="sm" onClick={handleCancelEditTaxDetails} disabled={isSaving}>{t('cancel_button')}</Button>
                                <Button size="sm" onClick={handleSaveEditTaxDetails} disabled={isSaving}>{t('save_button')}</Button>
                            </div>
                         )}
                    </div>
                </div>
            </CardContent>
            {/* No separate footer for this card anymore if save/cancel are within content */}
        </Card>

       {/* Products Table Section */}
       {docTypeParam === 'deliveryNote' && (
            <div className="mt-6">
                 <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold text-primary flex items-center">
                        <PackageIcon className="mr-2 h-5 w-5"/>
                        {t('edit_invoice_extracted_products_title')} ({products.length})
                    </h2>
                    {!isNewScan && (
                        <Button variant="ghost" size="icon" onClick={toggleEditDeliveryNoteProducts} className="h-8 w-8 text-muted-foreground hover:text-primary">
                             {isEditingDeliveryNoteProducts ? <X className="h-4 w-4 text-destructive"/> : <Edit className="h-4 w-4" />}
                            <span className="sr-only">{isEditingDeliveryNoteProducts ? t('cancel_button') : t('edit_button')}</span>
                        </Button>
                    )}
                </div>
                {products.length > 0 || (isEditingDeliveryNoteProducts && !isNewScan) ? (
                     <div className="overflow-x-auto relative border rounded-md bg-card">
                         <Table className="min-w-full sm:min-w-[600px]">
                         <TableHeader>
                             <TableRow>
                             <TableHead className="px-2 sm:px-4 py-2">{t('edit_invoice_th_catalog')}</TableHead>
                             <TableHead className="px-2 sm:px-4 py-2">{t('edit_invoice_th_description')}</TableHead>
                             <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_qty')}</TableHead>
                             <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_unit_price', { currency_symbol: t('currency_symbol') })}</TableHead>
                             <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_line_total', { currency_symbol: t('currency_symbol') })}</TableHead>
                             {(isEditingDeliveryNoteProducts && !isNewScan) && <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_actions')}</TableHead>}
                             </TableRow>
                         </TableHeader>
                         <TableBody>
                             {products.map(product => (
                                 <TableRow key={product.id}>
                                     <TableCell className="px-2 sm:px-4 py-2 max-w-[100px] sm:max-w-xs truncate">
                                         {(isEditingDeliveryNoteProducts && !isNewScan) ? (
                                             <Input value={product.catalogNumber || ''} onChange={(e) => handleInputChange(product.id, 'catalogNumber', e.target.value)} className="h-9" disabled={isSaving}/>
                                         ) : (
                                             product.catalogNumber || t('invoices_na')
                                         )}
                                     </TableCell>
                                     <TableCell className="px-2 sm:px-4 py-2 max-w-[150px] sm:max-w-md truncate">
                                          {(isEditingDeliveryNoteProducts && !isNewScan) ? (
                                             <Input value={product.description || ''} onChange={(e) => handleInputChange(product.id, 'description', e.target.value)} className="h-9" disabled={isSaving}/>
                                          ) : (
                                             product.description || t('invoices_na')
                                          )}
                                     </TableCell>
                                      <TableCell className="text-right px-2 sm:px-4 py-2">
                                          {(isEditingDeliveryNoteProducts && !isNewScan) ? (
                                             <Input type="number" value={formatInputValue(product.quantity, 'quantity', t)} onChange={(e) => handleInputChange(product.id, 'quantity', e.target.value)} className="w-20 sm:w-24 text-right h-9" disabled={isSaving}/>
                                          ) : (
                                             formatInputValue(product.quantity, 'quantity', t)
                                          )}
                                     </TableCell>
                                     <TableCell className="text-right px-2 sm:px-4 py-2">
                                          {(isEditingDeliveryNoteProducts && !isNewScan) ? (
                                             <Input type="number" value={formatInputValue(product.unitPrice, 'currency', t)} onChange={(e) => handleInputChange(product.id, 'unitPrice', e.target.value)} className="w-24 sm:w-28 text-right h-9" disabled={isSaving}/>
                                          ) : (
                                             t('currency_symbol') + formatInputValue(product.unitPrice, 'currency', t)
                                          )}
                                     </TableCell>
                                     <TableCell className="text-right px-2 sm:px-4 py-2">
                                          {(isEditingDeliveryNoteProducts && !isNewScan) ? (
                                             <Input type="number" value={formatInputValue(product.lineTotal, 'currency', t)} onChange={(e) => handleInputChange(product.id, 'lineTotal', e.target.value)} className="w-24 sm:w-28 text-right h-9" disabled={isSaving}/>
                                          ) : (
                                             t('currency_symbol') + formatInputValue(product.lineTotal, 'currency', t)
                                          )}
                                     </TableCell>
                                     {(isEditingDeliveryNoteProducts && !isNewScan) && (
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
                 {(isEditingDeliveryNoteProducts && !isNewScan) && (
                     <div className="flex justify-between items-center pt-4 mt-2 border-t">
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
       {docTypeParam === 'invoice' && (
         <div className="mt-4">
            {/* Tax Invoice view does not need a product table if it's not being edited via this section
                If isNewScan is true, the editable details are handled by isEditingTaxDetails set to true by default for new scans.
                The save button for the whole form (handleSaveChecks) will handle it.
            */}
         </div>
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

       {currentDialogStep === 'supplier_confirmation' && isNewScan && user && (
        <SupplierConfirmationDialog
          potentialSupplierName={potentialSupplierName || aiScannedSupplierNameFromStorage || ''}
          existingSuppliers={existingSuppliers}
          onConfirm={handleSupplierConfirmation}
          onCancel={() => {
              console.log("[EditInvoice][SupplierConfirmationDialog] CANCELLED/CLOSED by user.");
              processNextDialogStep('supplier_skipped');
          }}
          isOpen={currentDialogStep === 'supplier_confirmation'}
          onOpenChange={(open) => { 
              if (!open && currentDialogStep === 'supplier_confirmation') { 
                  console.log("[EditInvoice][SupplierConfirmationDialog] Externally closed. Assuming skip.");
                  processNextDialogStep('supplier_skipped'); 
              }
          }}
        />
      )}

      {currentDialogStep === 'payment_due_date' && isNewScan && (docTypeParam === 'deliveryNote' || docTypeParam === 'invoice') && (
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

      {currentDialogStep === 'new_product_details' && productsToDisplayForNewDetails && productsToDisplayForNewDetails.length > 0 && (
        <BarcodePromptDialog
          products={productsToDisplayForNewDetails}
          initialProductInputStates={productInputStates} // Changed prop name
          onComplete={handleNewProductDetailsComplete}
          isOpen={currentDialogStep === 'new_product_details' && productsToDisplayForNewDetails.length > 0}
          onOpenChange={(open) => {
              if (!open && currentDialogStep === 'new_product_details') { 
                  console.log("[EditInvoice][BarcodePromptDialog] Externally closed. Passing null (cancel).");
                  handleNewProductDetailsComplete(null); 
              }
          }}
        />
      )}

      {currentDialogStep === 'price_discrepancy' && priceDiscrepancies && priceDiscrepancies.length > 0 && (
        <UnitPriceConfirmationDialog
          discrepancies={priceDiscrepancies}
          onComplete={handlePriceConfirmationComplete}
          isOpen={currentDialogStep === 'price_discrepancy' && priceDiscrepancies && priceDiscrepancies.length > 0}
          onOpenChange={(open) => {
                if(!open && currentDialogStep === 'price_discrepancy') {
                    console.log("[EditInvoice][UnitPriceConfirmationDialog] Externally closed. Passing null (cancel).");
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
    
