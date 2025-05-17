
'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Trash2, PlusCircle, Save, Loader2, ArrowLeft, Edit, Eye, FileText as FileTextIconLucide, CheckCircle, X, Package as PackageIcon, AlertCircle, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
    Product,
    getProductsService,
    checkProductPricesBeforeSaveService,
    finalizeSaveProductsService,
    ProductPriceDiscrepancy,
    getSupplierSummariesService,
    updateSupplierContactInfoService,
    createSupplierService,
    SupplierSummary,
    clearTemporaryScanData,
    TEMP_DATA_KEY_PREFIX,
    InvoiceHistoryItem,
    getInvoicesService,
    updateInvoiceService,
    DOCUMENTS_COLLECTION,
    INVENTORY_COLLECTION,
    MAX_SCAN_RESULTS_SIZE_BYTES,

} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import type { ScanTaxInvoiceOutput } from '@/ai/flows/tax-invoice-schemas';
import { Alert, AlertDescription as AlertDescriptionComponent, AlertTitle as AlertTitleComponent } from '@/components/ui/alert';
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog';
import SupplierConfirmationDialog from '@/components/supplier-confirmation-dialog';
import PaymentDueDateDialog from '@/components/payment-due-date-dialog';
import { useAuth } from '@/context/AuthContext';
import { Label } from '@/components/ui/label';
import { Timestamp, doc, getDoc, serverTimestamp, FieldValue } from 'firebase/firestore';
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

const isValidImageSrc = (src: string | undefined | null): src is string => {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/') || src.startsWith('blob:');
};

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

function EditInvoiceContent() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation();

  const docTypeParam = useMemo(() => searchParams.get('docType') as 'deliveryNote' | 'invoice' | null, [searchParams]);
  const initialTempInvoiceId = useMemo(() => searchParams.get('tempInvoiceId'), [searchParams]);
  const initialInvoiceIdParam = useMemo(() => searchParams.get('invoiceId'), [searchParams]);
  const localStorageScanDataMissingParam = useMemo(() => searchParams.get('localStorageScanDataMissing') === 'true', [searchParams]);

  // Core Data States
  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [initialScannedProducts, setInitialScannedProducts] = useState<EditableProduct[]>([]);
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] = useState<EditableTaxInvoiceDetails>({});
  const [initialScannedTaxDetails, setInitialScannedTaxDetails] = useState<EditableTaxInvoiceDetails>({});
  const [displayedOriginalImageUrl, setDisplayedOriginalImageUrl] = useState<string | null>(null);
  const [displayedCompressedImageUrl, setDisplayedCompressedImageUrl] = useState<string | null>(null);
  
  // Loading and Error States
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [errorLoading, setErrorLoading] = useState<string | null>(null);
  const [scanProcessErrorState, setScanProcessErrorState] = useState<string | null>(null);

  // Edit Mode / View Mode States
  const [isNewScan, setIsNewScan] = useState(false);
  const [isViewMode, setIsViewMode] = useState(true); // Start in view mode by default for existing invoices
  const [isEditingTaxDetails, setIsEditingTaxDetails] = useState(false);
  const [isEditingDeliveryNoteProducts, setIsEditingDeliveryNoteProducts] = useState(false);

  // Dialog Flow States
  const [currentDialogStep, setCurrentDialogStep] = useState<DialogFlowStep>('idle');
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [potentialSupplierName, setPotentialSupplierName] = useState<string | undefined>(undefined);
  const [aiScannedSupplierNameFromStorage, setAiScannedSupplierNameFromStorage] = useState<string | undefined>(undefined);
  const [isSupplierConfirmed, setIsSupplierConfirmed] = useState(false);
  const [selectedPaymentDueDate, setSelectedPaymentDueDate] = useState<string | Date | Timestamp | undefined>(undefined);
  const [isPaymentDueDateDialogSkipped, setIsPaymentDueDateDialogSkipped] = useState(false);
  
  const [productsToDisplayForNewDetails, setProductsToDisplayForNewDetails] = useState<Product[]>([]);
  const [productInputStates, setProductInputStates] = useState<Record<string, ProductInputState>>({});
  const [priceDiscrepancies, setPriceDiscrepancies] = useState<ProductPriceDiscrepancy[] | null>(null);
  const [productsForNextStep, setProductsForNextStep] = useState<EditableProduct[]>([]);


  const cleanupTemporaryData = useCallback(() => {
    console.log("[EditInvoice][cleanupTemporaryData] Called.");
    // This function is now less critical as we don't rely heavily on localStorage for transfer
    // but can be used for clearing any residual temp keys if needed.
    const keyParamForCleanup = searchParams.get('key'); // Obsolete, but kept for potential future use
    if (keyParamForCleanup && user?.id) {
      clearTemporaryScanData(keyParamForCleanup, user.id);
      console.log(`[EditInvoice][cleanupTemporaryData] Cleared localStorage scan JSON for key (if existed): ${keyParamForCleanup}`);
    }
  }, [searchParams, user?.id]);

  const _internalCheckSupplier = useCallback(async (scannedSupplier: string | null | undefined, currentUserId: string, suppliersList: SupplierSummary[]) => {
    console.log(`[EditInvoice][_internalCheckSupplier] Called. Scanned Supplier: "${scannedSupplier}", UserID: ${currentUserId}, Fetched Suppliers: ${suppliersList.length}`);
    setExistingSuppliers(suppliersList || []);
    
    const trimmedScannedSupplier = scannedSupplier?.trim();
    console.log(`[EditInvoice][_internalCheckSupplier] Trimmed scanned supplier from AI: "${trimmedScannedSupplier}"`);

    if (trimmedScannedSupplier && trimmedScannedSupplier !== '') {
      const supplierExists = (suppliersList || []).some(s => s && typeof s.name === 'string' && s.name.toLowerCase() === trimmedScannedSupplier.toLowerCase());
      console.log(`[EditInvoice][_internalCheckSupplier] Does supplier "${trimmedScannedSupplier}" exist in list? ${supplierExists}`);
      
      if (!supplierExists) {
          console.log("[EditInvoice][_internalCheckSupplier] Scanned supplier is NEW and NOT EMPTY. Setting potential supplier. Potential supplier:", trimmedScannedSupplier);
          setPotentialSupplierName(trimmedScannedSupplier); 
          setCurrentDialogStep('supplier_confirmation');
      } else {
          console.log("[EditInvoice][_internalCheckSupplier] Supplier is EXISTING. Confirming supplier.");
          setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: trimmedScannedSupplier }));
          setInitialScannedTaxDetails(prev => ({ ...prev, supplierName: trimmedScannedSupplier }));
          setIsSupplierConfirmed(true); 
          processNextDialogStep('supplier_confirmed');
      }
    } else {
        console.log("[EditInvoice][_internalCheckSupplier] Scanned supplier is EMPTY or null. Skipping supplier confirmation.");
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: null })); 
        setInitialScannedTaxDetails(prev => ({ ...prev, supplierName: null })); 
        setIsSupplierConfirmed(true); 
        processNextDialogStep('supplier_existing_or_empty');
    }
  }, [/* No state setters here, only functions listed in loadData's dep array should be here if they were external */]);


  const checkForNewProductsAndDetails = useCallback(async (productsToCheck: Product[]): Promise<{needsReview: boolean, productsForReview: Product[]}> => {
    console.log(`[EditInvoice][checkForNewProductsAndDetails] Called. Products to check count: ${productsToCheck.length}. DocType: ${docTypeParam}`);
    if (!user?.id) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), description: t("edit_invoice_user_not_authenticated_desc"), variant: "destructive" });
        setProductsToDisplayForNewDetails([]);
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
            // Product IDs from scan might be temporary, so rely on catalog/barcode for "existing" check primarily
            // unless _originalId is a Firestore ID.
            const isTempId = p._originalId?.startsWith('prod-temp-') || p._originalId?.startsWith('temp-id-') || !p._originalId;
            
            const existingInInventoryById = !isTempId && p._originalId && inventoryMap.has(`id:${p._originalId}`);
            const existingInInventoryByCat = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
            const existingInInventoryByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);
            
            const isExistingProduct = existingInInventoryById || existingInInventoryByCat || existingInInventoryByBarcode;
            const needsSalePriceReview = p.salePrice === undefined; // Always prompt for sale price if not set
            
            console.log(`[EditInvoice][checkForNewProductsAndDetails] Product: ${p.shortName || p.id}, catalog: ${p.catalogNumber}, barcode: ${p.barcode}, _originalId: ${p._originalId}, isTempId: ${isTempId}, existingById: ${existingInInventoryById}, existingByCat: ${existingInInventoryByCat}, existingByBarcode: ${existingInInventoryByBarcode}, isExisting: ${isExistingProduct}, needsSalePriceReview: ${needsSalePriceReview}`);
            
            if (!isExistingProduct) {
                 console.log(`[EditInvoice][checkForNewProductsAndDetails] Product '${p.shortName || p.id}' is NEW.`);
                 return true; 
            }
            if (needsSalePriceReview) {
                console.log(`[EditInvoice][checkForNewProductsAndDetails] Product '${p.shortName || p.id}' is EXISTING but needs sale price review.`);
                return true;
            }
            return false; 
        });
        console.log("[EditInvoice][checkForNewProductsAndDetails] Products needing review count:", productsRequiringDetailsReview.length);
        
        if (productsRequiringDetailsReview.length > 0) {
            const initialInputStatesForPrompt: Record<string, ProductInputState> = {};
            productsRequiringDetailsReview.forEach(p => {
                const pId = p.id || p._originalId || `temp-id-${Math.random().toString(36).substring(2,9)}`;
                initialInputStatesForPrompt[pId] = { 
                    barcode: p.barcode || '', 
                    salePrice: p.salePrice, 
                    salePriceMethod: p.salePrice !== undefined ? 'manual' : 'percentage', // Default to manual if sale price exists
                    profitPercentage: '',
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
  }, [user?.id, docTypeParam, t, toast]);


  const startDialogFlowForNewScan = useCallback(async (scannedSupplierFromStorage: string | null | undefined, initialProductsFromScan: Product[]) => {
    console.log("[EditInvoice][startDialogFlowForNewScan] Called. Scanned supplier:", scannedSupplierFromStorage, "isNewScan:", isNewScan, "user ID:", user?.id, "initialProducts length:", initialProductsFromScan.length);
    if (!isNewScan || !user?.id ) {
        setCurrentDialogStep('ready_to_save');
        return;
    }
    
    setProductsForNextStep(initialProductsFromScan.map(p => ({...p} as EditableProduct)));
    
    try {
        const fetchedSuppliersList = await getSupplierSummariesService(user.id);
        setExistingSuppliers(fetchedSuppliersList);
        
        const trimmedScannedSupplier = scannedSupplierFromStorage?.trim();
        if (trimmedScannedSupplier && fetchedSuppliersList.some(s => s && typeof s.name === 'string' && s.name.toLowerCase() === trimmedScannedSupplier.toLowerCase())) {
            console.log("[EditInvoice][startDialogFlowForNewScan] Existing supplier found. Setting supplier and skipping payment date dialog for now (will be handled by main flow).");
            setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: trimmedScannedSupplier }));
            setInitialScannedTaxDetails(prev => ({ ...prev, supplierName: trimmedScannedSupplier }));
            setIsSupplierConfirmed(true);
            // No payment due date set here - let processNextDialogStep handle it
            // setIsPaymentDueDateDialogSkipped(true); // This might be too aggressive, let main flow decide
            processNextDialogStep('supplier_confirmed'); // Changed from 'supplier_and_payment_date_pre_confirmed_for_existing_supplier' to simpler state
        } else {
             console.log("[EditInvoice][startDialogFlowForNewScan] Supplier is new or not provided from scan, calling _internalCheckSupplier.");
             await _internalCheckSupplier(scannedSupplierFromStorage, user.id, fetchedSuppliersList);
        }
    } catch (error) {
        console.error("[EditInvoice][startDialogFlowForNewScan] Error fetching suppliers:", error);
        toast({
          title: t('error_title'),
          description: `${t('edit_invoice_toast_error_fetching_suppliers')} ${error instanceof Error ? `(${error.message})` : ''}`,
          variant: "destructive"
        });
        setIsSupplierConfirmed(true); // Assume confirmed to not block flow on this error
        processNextDialogStep('supplier_fetch_error'); 
    }
  }, [isNewScan, user?.id, t, toast, _internalCheckSupplier]); // processNextDialogStep removed as it would cause a loop if it depends on this

   const processNextDialogStep = useCallback(async (previousStepOutcome: string, data?: any) => {
    console.log(`[EditInvoice][processNextDialogStep] Current Step BEFORE: ${currentDialogStep}, From Outcome:`, previousStepOutcome, "Data:", data ? (Array.isArray(data) ? `Array(${data.length})` : typeof data) : 'N/A', "isNewScan:", isNewScan);
    if (!isNewScan || !user?.id) {
        console.log("[EditInvoice][processNextDialogStep] Conditions not met (not new scan or no user). Setting currentDialogStep to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }

    let currentProductsForCheck = productsForNextStep.length > 0 ? productsForNextStep : products;
    console.log(`[EditInvoice][processNextDialogStep] Using productsForCheck from: ${productsForNextStep.length > 0 ? 'productsForNextStep' : 'products'}. Count: ${currentProductsForCheck.length}`);

    switch (currentDialogStep) {
        case 'idle': 
        case 'supplier_confirmation': 
            // This case handles outcomes from supplier confirmation OR if supplier was pre-confirmed/skipped
            if (previousStepOutcome.startsWith('supplier_')) {
                console.log("[EditInvoice][processNextDialogStep] From supplier outcome. isNewScan:", isNewScan, "selectedPaymentDueDate:", selectedPaymentDueDate, "isPaymentDueDateDialogSkipped:", isPaymentDueDateDialogSkipped, "docTypeParam:", docTypeParam);
                 if (docTypeParam && (!selectedPaymentDueDate && !isPaymentDueDateDialogSkipped)) { // Always ask for payment due date for new scan
                    console.log("[EditInvoice][processNextDialogStep] Moving to payment_due_date.");
                    setCurrentDialogStep('payment_due_date');
                } else { // Payment due date already handled or skipped
                    console.log("[EditInvoice][processNextDialogStep] Payment due date done or skipped. Checking new product details. DocType:", docTypeParam);
                    if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
                        const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
                        if (reviewResult.needsReview) {
                            setCurrentDialogStep('new_product_details');
                        } else {
                            setCurrentDialogStep('ready_to_save');
                        }
                    } else { // Tax invoice or delivery note with no products
                        setCurrentDialogStep('ready_to_save');
                    }
                }
            }
            break;

        case 'payment_due_date': // After payment due date dialog (confirmed or skipped)
            console.log("[EditInvoice][processNextDialogStep] From payment_due_date outcome. Checking new product details. DocType:", docTypeParam);
            if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
                const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
                if (reviewResult.needsReview) {
                    setCurrentDialogStep('new_product_details');
                } else { 
                    setCurrentDialogStep('ready_to_save');
                }
            } else { // Tax invoice or delivery note with no products
                setCurrentDialogStep('ready_to_save');
            }
            break;

        case 'new_product_details': // After new product details dialog
             const updatedProductsFromPrompt = data as EditableProduct[] | null;
             if (updatedProductsFromPrompt) { 
                 setProductsForNextStep(updatedProductsFromPrompt); 
                 setProducts(updatedProductsFromPrompt.map(p => ({...p, _originalId: p.id || p._originalId })));
             }
             console.log("[EditInvoice][processNextDialogStep] From new_product_details outcome. Moving to ready_to_save.");
             setCurrentDialogStep('ready_to_save'); 
            break;

        case 'price_discrepancy': // After price discrepancy dialog
             const resolvedProductsFromDiscrepancy = data as EditableProduct[] | null;
             if (resolvedProductsFromDiscrepancy === null) { 
                 toast({ title: t("edit_invoice_toast_save_cancelled_title"), description: t("edit_invoice_toast_save_cancelled_desc_price"), variant: "default" });
                 setCurrentDialogStep('ready_to_save'); 
                 return;
             }
            setProductsForNextStep(resolvedProductsFromDiscrepancy);
            setProducts(resolvedProductsFromDiscrepancy.map(p => ({...p, _originalId: p.id || p._originalId })));
            currentProductsForCheck = resolvedProductsFromDiscrepancy; 
            
            console.log("[EditInvoice][processNextDialogStep] From price_discrepancy outcome. Re-checking new product details (should ideally be none if this was the last step).");
             if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
                 // It's possible that after resolving price discrepancies, some products *still* need barcode/sale price (if new products were part of discrepancy list)
                 // However, typically, price discrepancy is for existing items, and new product details are for new items.
                 // For simplicity now, assume price discrepancy leads to ready_to_save if no *other* new products exist.
                 // A more robust flow might re-evaluate if *any* product still needs barcode/salePrice after price resolution.
                const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck); 
                if (reviewResult.needsReview) {
                   setCurrentDialogStep('new_product_details');
               } else {
                   setCurrentDialogStep('ready_to_save');
               }
            } else { 
                setCurrentDialogStep('ready_to_save');
            }
            break;
        case 'ready_to_save':
        case 'error_loading':
            console.log(`[EditInvoice][processNextDialogStep] In step ${currentDialogStep}. No further auto progression.`);
            break;
        default:
            console.warn(`[EditInvoice][processNextDialogStep] Unhandled currentDialogStep: ${currentDialogStep}. Defaulting to ready_to_save.`);
            setCurrentDialogStep('ready_to_save');
            break;
    }
  }, [currentDialogStep, isNewScan, user?.id, docTypeParam, products, productsForNextStep, selectedPaymentDueDate, isPaymentDueDateDialogSkipped, t, toast, checkForNewProductsAndDetails]); 

  const loadData = useCallback(async () => {
    if (!user?.id || authLoading) {
      if (!authLoading && !user) router.push('/login');
      return;
    }
     if (initialDataLoaded && !searchParams.get('refresh') && !initialTempInvoiceId && !initialInvoiceIdParam) {
        console.log("[EditInvoice][loadData] Data already loaded and no refresh requested. Skipping.");
        return;
    }
    
    console.log("[EditInvoice][loadData] Started for user:", user.id);
    setIsLoading(true);
    setErrorLoading(null);
    setScanProcessErrorState(null);
    
    const currentIsNewScanVal = !initialInvoiceIdParam && !!initialTempInvoiceId;
    setIsNewScan(currentIsNewScanVal);
    console.log("[EditInvoice][loadData] isNewScan set to:", currentIsNewScanVal);

    if (currentIsNewScanVal) {
      console.log("[EditInvoice][loadData] New scan identified. Resetting states.");
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
      setIsEditingTaxDetails(false); 
      setIsEditingDeliveryNoteProducts(false); 
      setIsViewMode(false); // For new scans, start in a mode that allows save/dialog flow
      console.log("[EditInvoice][loadData] States reset for new scan.");
    } else if (initialInvoiceIdParam) {
      console.log("[EditInvoice][loadData] Existing invoice identified. Setting view mode and ready_to_save.");
      setIsViewMode(true); // For existing invoices, start in view mode
      setIsEditingTaxDetails(false);
      setIsEditingDeliveryNoteProducts(false);
      setCurrentDialogStep('ready_to_save'); 
    } else { // Manual entry - no tempInvoiceId, no initialInvoiceIdParam
      console.log("[EditInvoice][loadData] Manual entry mode detected.");
      setIsViewMode(false);
      setIsEditingTaxDetails(docTypeParam === 'invoice'); // Editable by default for manual invoice
      setIsEditingDeliveryNoteProducts(docTypeParam === 'deliveryNote'); // Editable by default for manual delivery note
      setCurrentDialogStep('ready_to_save'); 
      setOriginalFileName(t('edit_invoice_manual_entry_title'));
      setIsNewScan(true); // Treat manual entry as a new scan flow for save logic
    }

    setOriginalFileName(searchParams.get('originalFileName') || t('edit_invoice_unknown_document'));
    const keyParam = searchParams.get('key'); // This key was for localStorage scan JSON
    let scanResultJsonFromStorage: string | null = null; // Will hold JSON from Firestore pending doc or LS
    let pendingDocData: InvoiceHistoryItem | null = null;

    try {
        if (initialInvoiceIdParam && db) { // Viewing/editing existing FINALIZED document
            console.log("[EditInvoice][loadData] Fetching FINALIZED document from Firestore. ID:", initialInvoiceIdParam);
            const finalDocRef = doc(db, DOCUMENTS_COLLECTION, initialInvoiceIdParam);
            const finalDocSnap = await getDoc(finalDocRef);
            if (finalDocSnap.exists() && finalDocSnap.data().userId === user.id) {
              pendingDocData = { id: finalDocSnap.id, ...finalDocSnap.data() } as InvoiceHistoryItem;
              if (pendingDocData.rawScanResultJson) {
                scanResultJsonFromStorage = pendingDocData.rawScanResultJson;
                console.log("[EditInvoice][loadData] rawScanResultJson loaded from FINALIZED Firestore document.");
              } else {
                console.log("[EditInvoice][loadData] No rawScanResultJson in FINALIZED Firestore document.");
              }
            } else {
              setErrorLoading(t('edit_invoice_error_invoice_not_found_id', { invoiceId: initialInvoiceIdParam }));
              setCurrentDialogStep('error_loading');
            }
        } else if (initialTempInvoiceId && db) { // Processing a NEW scan via PENDING document
            console.log("[EditInvoice][loadData] Fetching PENDING document from Firestore. Temp ID:", initialTempInvoiceId);
            const pendingDocRef = doc(db, DOCUMENTS_COLLECTION, initialTempInvoiceId);
            const pendingDocSnap = await getDoc(pendingDocRef);
            if (pendingDocSnap.exists() && pendingDocSnap.data().userId === user.id) {
              pendingDocData = { id: pendingDocSnap.id, ...pendingDocSnap.data() } as InvoiceHistoryItem;
              if(pendingDocData.rawScanResultJson){
                scanResultJsonFromStorage = pendingDocData.rawScanResultJson;
                console.log("[EditInvoice][loadData] rawScanResultJson loaded from PENDING Firestore document.");
              } else {
                console.warn("[EditInvoice][loadData] rawScanResultJson missing in PENDING Firestore document.");
                 if (localStorageScanDataMissingParam) {
                    console.warn("[EditInvoice][loadData] localStorageScanDataMissingParam is true, indicating LS also failed/skipped.");
                     toast({ title: t('edit_invoice_ls_scan_data_missing_toast_title'), description: t('edit_invoice_ls_scan_data_missing_toast_desc'), variant: "warning", duration: 7000 });
                 }
              }
            } else {
              console.error(`[EditInvoice][loadData] PENDING document not found or user mismatch. Temp ID: ${initialTempInvoiceId}`);
              setErrorLoading(t('edit_invoice_error_scan_results_not_found_firestore_pending', { tempId: initialTempInvoiceId}));
              setCurrentDialogStep('error_loading');
            }
        } else if (currentIsNewScanVal && !db) { // Should not happen if db is initialized properly
             console.error("[EditInvoice][loadData] Firestore (db) is not initialized for new scan pending doc.");
             setErrorLoading("Firestore database is not available.");
             setCurrentDialogStep('error_loading');
        } else if (!initialTempInvoiceId && !initialInvoiceIdParam && currentIsNewScanVal) {
            console.log("[EditInvoice][loadData] No temp or existing ID, preparing for manual entry (treated as new scan).");
            // This is effectively a new scan, but without prior AI results.
            // Dialog flow will start based on empty initial data.
        }


        let initialProductsFromScanData: EditableProduct[] = [];
        let taxDetailsFromScan: Partial<EditableTaxInvoiceDetails> = {};
        let localAiScannedSupplierName: string | undefined = undefined;

        if (pendingDocData) {
          setOriginalFileName(pendingDocData.originalFileName || t('edit_invoice_unknown_document'));
          const taxDetails: EditableTaxInvoiceDetails = {
            supplierName: pendingDocData.supplierName || null,
            invoiceNumber: pendingDocData.invoiceNumber || null,
            totalAmount: pendingDocData.totalAmount ?? null,
            invoiceDate: pendingDocData.invoiceDate || null,
            paymentMethod: pendingDocData.paymentMethod || null,
            paymentDueDate: pendingDocData.paymentDueDate || null,
          };
          setEditableTaxInvoiceDetails(taxDetails);
          setInitialScannedTaxDetails(taxDetails); 
          localAiScannedSupplierName = pendingDocData.supplierName || undefined;
          setAiScannedSupplierNameFromStorage(localAiScannedSupplierName);

          const paymentDueDateFromDoc = pendingDocData.paymentDueDate;
          if (paymentDueDateFromDoc) {
            if (paymentDueDateFromDoc instanceof Timestamp) setSelectedPaymentDueDate(paymentDueDateFromDoc.toDate());
            else if (typeof paymentDueDateFromDoc === 'string' && isValid(parseISO(paymentDueDateFromDoc))) setSelectedPaymentDueDate(parseISO(paymentDueDateFromDoc));
            else if (paymentDueDateFromDoc instanceof Date && isValid(paymentDueDateFromDoc)) setSelectedPaymentDueDate(paymentDueDateFromDoc);
          } else {
            setSelectedPaymentDueDate(undefined); // Ensure it's reset if not present
          }
          
          setDisplayedOriginalImageUrl(pendingDocData.originalImagePreviewUri || null);
          setDisplayedCompressedImageUrl(pendingDocData.compressedImageForFinalRecordUri || null);
          
          const generalErrorFromPendingDoc = pendingDocData.errorMessage;
          if (generalErrorFromPendingDoc) {
              setScanProcessErrorState(prev => prev ? `${prev}; FIRESTORE_DOC_ERROR: ${generalErrorFromPendingDoc}` : `FIRESTORE_DOC_ERROR: ${generalErrorFromPendingDoc}`);
              console.log("[EditInvoice][loadData] Error from pending Firestore doc:", generalErrorFromPendingDoc);
          }
        }
        
        if (scanResultJsonFromStorage && typeof scanResultJsonFromStorage === 'string') {
          try {
            const parsedScanResult = JSON.parse(scanResultJsonFromStorage);
            console.log("[EditInvoice][loadData] Parsed scanResultJsonFromStorage:", parsedScanResult);
            if (docTypeParam === 'deliveryNote' && parsedScanResult && 'products' in parsedScanResult && Array.isArray(parsedScanResult.products)) {
                initialProductsFromScanData = parsedScanResult.products.map((p: any, index: number) => ({ // Using 'any' here as AIScannedProduct might not match Product exactly
                    id: p.id || `scan-temp-${Date.now()}-${index}`,
                    _originalId: p.id || p.catalogNumber || `scan-temp-${Date.now()}-${index}`, // Use catalog if no id
                    userId: user.id,
                    catalogNumber: p.catalogNumber || 'N/A',
                    description: p.product_name || p.description || 'N/A',
                    shortName: p.shortName || p.short_product_name || p.product_name?.substring(0,20) || 'N/A',
                    quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                    unitPrice: (p.purchase_price !== undefined ? Number(p.purchase_price) : (p.unitPrice !== undefined ? Number(p.unitPrice) : 0)),
                    lineTotal: p.total !== undefined ? Number(p.total) : ((typeof p.quantity === 'number' ? p.quantity : 0) * ((p.purchase_price !== undefined ? Number(p.purchase_price) : (p.unitPrice !== undefined ? Number(p.unitPrice) : 0)))),
                    salePrice: undefined, // Explicitly undefined for new delivery notes initially
                    minStockLevel: p.minStockLevel === undefined ? null : Number(p.minStockLevel),
                    maxStockLevel: p.maxStockLevel === undefined ? null : Number(p.maxStockLevel),
                    imageUrl: p.imageUrl === undefined ? null : p.imageUrl,
                }));
                console.log("[EditInvoice][loadData] Products mapped for deliveryNote:", initialProductsFromScanData.length);
            } else if (docTypeParam === 'invoice' && parsedScanResult) {
              const taxScan = parsedScanResult as ScanTaxInvoiceOutput; // Assume this is the structure
              taxDetailsFromScan = { 
                supplierName: editableTaxInvoiceDetails.supplierName || taxScan.supplierName || null,
                invoiceNumber: editableTaxInvoiceDetails.invoiceNumber || taxScan.invoiceNumber || null,
                totalAmount: editableTaxInvoiceDetails.totalAmount ?? taxScan.totalAmount ?? null,
                invoiceDate: editableTaxInvoiceDetails.invoiceDate || taxScan.invoiceDate || null,
                paymentMethod: editableTaxInvoiceDetails.paymentMethod || taxScan.paymentMethod || null,
              };
              setEditableTaxInvoiceDetails(prev => ({ ...prev, ...taxDetailsFromScan }));
              setInitialScannedTaxDetails(prev => ({ ...prev, ...taxDetailsFromScan })); 
              localAiScannedSupplierName = taxDetailsFromScan.supplierName || localAiScannedSupplierName;
              setAiScannedSupplierNameFromStorage(localAiScannedSupplierName);
              console.log("[EditInvoice][loadData] Tax details updated from parsed scan for invoice.");
            }
            const generalErrorFromScanJson = parsedScanResult?.error; 
            if (generalErrorFromScanJson) {
                 const errorString = typeof generalErrorFromScanJson === 'object' ? JSON.stringify(generalErrorFromScanJson) : String(generalErrorFromScanJson);
                 setScanProcessErrorState(prev => prev ? `${prev}; AI_SCAN_JSON_ERROR: ${errorString}` : `AI_SCAN_JSON_ERROR: ${errorString}`);
                 console.log("[EditInvoice][loadData] Error from parsed scan JSON:", errorString);
            }
          } catch (jsonError) {
            const parseErrorMsg = t('edit_invoice_toast_error_loading_desc_invalid_format');
            setScanProcessErrorState(prev => prev ? `${prev}; ${parseErrorMsg}` : parseErrorMsg);
            console.error("[EditInvoice][loadData] JSON Parse Error for scanResultJsonFromStorage:", jsonError, "Content:", scanResultJsonFromStorage.substring(0, 200));
            setErrorLoading(parseErrorMsg); 
            setCurrentDialogStep('error_loading');
          }
        } else if (currentIsNewScanVal && docTypeParam === 'deliveryNote' && !scanResultJsonFromStorage) {
             if(localStorageScanDataMissingParam){ // This flag is set if upload page knew LS save failed
                 toast({ title: t('edit_invoice_toast_scan_data_missing_title'), description: t('edit_invoice_toast_scan_data_missing_desc_ls_fail_critical'), variant: "warning", duration: 7000 });
                 console.log("[EditInvoice][loadData] localStorageScanDataMissingParam was true. Displayed critical missing data toast.");
             } else {
                 console.warn("[EditInvoice][loadData] New delivery note scan, but no rawScanResultJson found in pending Firestore doc. User will need to add products manually or re-scan.");
                 // This is not an error per se, but user needs to know
                 toast({ title: t('edit_invoice_toast_info_ls_missing'), variant: "default", duration: 6000});
             }
        } else if (currentIsNewScanVal && docTypeParam === 'invoice' && !scanResultJsonFromStorage) {
             console.warn("[EditInvoice][loadData] New tax invoice scan, but no rawScanResultJson found in pending Firestore doc. User will need to add details manually or re-scan.");
             toast({ title: t('edit_invoice_toast_info_ls_missing'), variant: "default", duration: 6000});
        } else if (!currentIsNewScanVal && !scanResultJsonFromStorage && docTypeParam === 'deliveryNote') {
             console.warn("[EditInvoice][loadData] Viewing existing delivery note, but no rawScanResultJson found. Products might be missing if not saved previously via other means.");
        }
        
        setProducts(initialProductsFromScanData);
        setInitialScannedProducts(initialProductsFromScanData);
        setProductsForNextStep(initialProductsFromScanData);
        console.log(`[EditInvoice][loadData] Set products states. initialProductsFromScanData count: ${initialProductsFromScanData.length}`);

        if (currentIsNewScanVal && currentDialogStep !== 'error_loading') { 
          console.log("[EditInvoice][loadData] Starting dialog flow for new scan. AI Scanned Supplier:", localAiScannedSupplierName);
          await startDialogFlowForNewScan(localAiScannedSupplierName, initialProductsFromScanData);
        } else if (!currentIsNewScanVal && !errorLoading) { 
            setIsViewMode(true); 
            setCurrentDialogStep('ready_to_save'); 
            console.log("[EditInvoice][loadData] Existing document, view mode set, ready to save.");
        }
    } catch (e) {
        console.error("[EditInvoice][loadData] Outer catch block error:", e);
        setErrorLoading(t('edit_invoice_error_loading_existing') + `: ${(e as Error).message}`);
        setCurrentDialogStep('error_loading');
    } finally {
        setIsLoading(false);
        setInitialDataLoaded(true);
        console.log("[EditInvoice][loadData] Finished. Current Dialog Step after load:", currentDialogStep);
    }
  }, [user?.id, authLoading, searchParams, t, toast, router, docTypeParam, initialTempInvoiceId, initialInvoiceIdParam, localStorageScanDataMissingParam, startDialogFlowForNewScan, _internalCheckSupplier, checkForNewProductsAndDetails, processNextDialogStep]); // Added all dependencies here


  useEffect(() => {
    console.log("[EditInvoice] Main useEffect triggered. User ID:", user?.id, "AuthLoading:", authLoading, "InitialDataLoaded:", initialDataLoaded);
    if(user && user.id && !initialDataLoaded && !authLoading) { 
        console.log("[EditInvoice] Main useEffect: Conditions met, calling loadData.");
        loadData();
    } else if (!authLoading && !user) {
      console.log("[EditInvoice] Main useEffect: No user and not auth loading, redirecting to login.");
      router.push('/login');
    }
  }, [user, authLoading, initialDataLoaded, loadData, router]);


  useEffect(() => {
    console.log(`[EditInvoice] Dialog effect triggered. currentDialogStep: ${currentDialogStep}`);
    if (currentDialogStep !== 'supplier_confirmation') setPotentialSupplierName(undefined); 
    if (currentDialogStep !== 'price_discrepancy') setPriceDiscrepancies(null);
    if (currentDialogStep !== 'new_product_details') {
      // No longer managing isBarcodePromptOpen directly
    }
  }, [currentDialogStep]);


  const handleSupplierConfirmation = useCallback(async (confirmedSupplierName: string | null, isNew: boolean = false) => {
    console.log(`[EditInvoice][handleSupplierConfirmation] Confirmed: "${confirmedSupplierName}", isNew: ${isNew}, UserID: ${user?.id}`);
    if (!user?.id) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        return;
    }

    let finalConfirmedName = confirmedSupplierName;
    if (finalConfirmedName && finalConfirmedName.trim() !== '') {
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
        setInitialScannedTaxDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
        if (isNew) {
            try {
                console.log(`[EditInvoice][handleSupplierConfirmation] Attempting to save new supplier '${finalConfirmedName}'.`);
                await createSupplierService(finalConfirmedName, {}, user.id); 
                toast({ title: t('edit_invoice_toast_new_supplier_added_title'), description: t('edit_invoice_toast_new_supplier_added_desc', { supplierName: finalConfirmedName }) });
                const fetchedSuppliersList = await getSupplierSummariesService(user.id); 
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
    } else { // User skipped or provided empty name, try to use AI scanned or initial from DB
        finalConfirmedName = aiScannedSupplierNameFromStorage || initialScannedTaxDetails.supplierName || null;
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
        setInitialScannedTaxDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
    }
    setIsSupplierConfirmed(true); 
    processNextDialogStep('supplier_confirmed');
  }, [user?.id, t, toast, aiScannedSupplierNameFromStorage, initialScannedTaxDetails, processNextDialogStep]);

  const handlePaymentDueDateConfirm = useCallback((dueDate: string | Date | Timestamp | undefined) => {
    setSelectedPaymentDueDate(dueDate);
    setIsPaymentDueDateDialogSkipped(false); 
    setEditableTaxInvoiceDetails(prev => ({ ...prev, paymentDueDate: dueDate }));
    setInitialScannedTaxDetails(prev => ({ ...prev, paymentDueDate: dueDate }));
    processNextDialogStep('payment_due_date_confirmed');
  }, [processNextDialogStep]);

  const handleCancelPaymentDueDate = useCallback(() => {
    setSelectedPaymentDueDate(undefined);
    setIsPaymentDueDateDialogSkipped(true); 
    setEditableTaxInvoiceDetails(prev => ({ ...prev, paymentDueDate: undefined })); 
    setInitialScannedTaxDetails(prev => ({ ...prev, paymentDueDate: undefined })); 
    processNextDialogStep('payment_due_date_skipped');
  }, [processNextDialogStep]);

   const handleNewProductDetailsComplete = useCallback((updatedNewProductsFromDialog: Product[] | null) => {
     let finalProductsForSave: EditableProduct[];
      if (updatedNewProductsFromDialog === null) {
          finalProductsForSave = productsForNextStep.length > 0 ? productsForNextStep : products;
          console.log("[EditInvoice][handleNewProductDetailsComplete] Dialog cancelled/skipped. Using existing productsForNextStep or products. Count:", finalProductsForSave.length);
      } else if (updatedNewProductsFromDialog.length > 0) {
          // Base products are those that were initially identified as needing review OR all initial products if it's a fresh scan
          const baseProducts = (productsForNextStep.length > 0 && isNewScan && productsToDisplayForNewDetails.length > 0) ? productsToDisplayForNewDetails : initialScannedProducts;
          
          const updatedMap = new Map(updatedNewProductsFromDialog.map(p => [p._originalId || p.id, p]));
          
          finalProductsForSave = initialScannedProducts.map(originalP => { // Iterate over ALL initial products
              const idToMatch = originalP._originalId || originalP.id;
              const updatedPData = updatedMap.get(idToMatch);
              if (updatedPData) { // If this product was in the dialog and updated
                  return { ...originalP, barcode: updatedPData.barcode || originalP.barcode, salePrice: updatedPData.salePrice, id: originalP.id };
              }
              return originalP; // If product wasn't in the dialog, keep its original state
          });
          console.log("[EditInvoice][handleNewProductDetailsComplete] Dialog confirmed. Merged updated products. Count:", finalProductsForSave.length);
      } else { 
          finalProductsForSave = (productsForNextStep.length > 0 && isNewScan) ? productsForNextStep : products;
          console.log("[EditInvoice][handleNewProductDetailsComplete] Dialog confirmed with no new details provided (all skipped individually). Using existing. Count:", finalProductsForSave.length);
      }
     
     setProductsForNextStep(finalProductsForSave); 
     setProducts(finalProductsForSave.map(p => ({...p, _originalId: p.id || p._originalId}))); // Update main products state
     setProductsToDisplayForNewDetails([]); 
     console.log("[EditInvoice][handleNewProductDetailsComplete] Dialog complete. productsForNextStep updated. Moving to ready_to_save.");
     processNextDialogStep('new_product_details_complete', finalProductsForSave);
   }, [products, productsForNextStep, initialScannedProducts, isNewScan, processNextDialogStep, productsToDisplayForNewDetails]); 

  const handlePriceConfirmationComplete = useCallback(async (resolvedProducts: Product[] | null) => {
    console.log("[EditInvoice][handlePriceConfirmationComplete] Resolved products from dialog count:", resolvedProducts ? resolvedProducts.length : 'null (cancelled)');
    setPriceDiscrepancies(null); 
    processNextDialogStep('price_discrepancy_complete', resolvedProducts);
  }, [processNextDialogStep]);

  const proceedWithFinalSave = useCallback(async (finalProductsToSave: Product[]) => {
    if (!user?.id || !docTypeParam) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), description: t("edit_invoice_user_not_authenticated_desc"), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        return null; 
    }
    
    let finalDocumentRecord: InvoiceHistoryItem | null = null;

    try {
        const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => rest as Product);
        console.log("[EditInvoice][proceedWithFinalSave] Products being sent to finalizeSaveProductsService:", productsForService);

        let finalFileNameForSave = originalFileName;
        const finalSupplierNameForSave = editableTaxInvoiceDetails.supplierName;
        const finalInvoiceNumberForSave = editableTaxInvoiceDetails.invoiceNumber;
        let finalTotalAmountForSave = editableTaxInvoiceDetails.totalAmount;
        
        if(docTypeParam === 'deliveryNote' && productsForService.length > 0 && (finalTotalAmountForSave === null || finalTotalAmountForSave === 0)){
            finalTotalAmountForSave = productsForService.reduce((sum, p) => sum + (p.lineTotal || 0), 0);
            console.log("[EditInvoice][proceedWithFinalSave] Calculated totalAmount for delivery note:", finalTotalAmountForSave);
        }

        let finalInvoiceDateForSave: Timestamp | string | Date | null = null;
        if (editableTaxInvoiceDetails.invoiceDate instanceof Timestamp) finalInvoiceDateForSave = editableTaxInvoiceDetails.invoiceDate;
        else if (typeof editableTaxInvoiceDetails.invoiceDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate))) finalInvoiceDateForSave = parseISO(editableTaxInvoiceDetails.invoiceDate);
        else if (editableTaxInvoiceDetails.invoiceDate instanceof Date && isValid(editableTaxInvoiceDetails.invoiceDate)) finalInvoiceDateForSave = editableTaxInvoiceDetails.invoiceDate;

        const finalPaymentMethodForSave = editableTaxInvoiceDetails.paymentMethod;
        let finalPaymentDueDateForSave: Timestamp | string | Date | null = null;
        const dueDateToProcess = selectedPaymentDueDate || editableTaxInvoiceDetails.paymentDueDate;
        if (dueDateToProcess instanceof Timestamp) finalPaymentDueDateForSave = dueDateToProcess;
        else if (typeof dueDateToProcess === 'string' && isValid(parseISO(dueDateToProcess))) finalPaymentDueDateForSave = parseISO(dueDateToProcess);
        else if (dueDateToProcess instanceof Date && isValid(dueDateToProcess)) finalPaymentDueDateForSave = dueDateToProcess;

        if(finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '' && finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
          finalFileNameForSave = `${finalSupplierNameForSave}_${finalInvoiceNumberForSave}`;
        } else if (finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '') {
          finalFileNameForSave = finalSupplierNameForSave;
        } else if (finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
          finalFileNameForSave = `Invoice_${finalInvoiceNumberForSave}`;
        }
        finalFileNameForSave = finalFileNameForSave.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);
        
        let rawScanResultJsonToSave: string | null = null;
        const currentTempInvoiceId = initialTempInvoiceId || searchParams.get('tempInvoiceId'); 
        if (currentTempInvoiceId && db && user?.id) { 
           const pendingDocRef = doc(db, DOCUMENTS_COLLECTION, currentTempInvoiceId);
           const pendingDocSnap = await getDoc(pendingDocRef);
           if (pendingDocSnap.exists()) rawScanResultJsonToSave = pendingDocSnap.data()?.rawScanResultJson || null;
        } else if (initialInvoiceIdParam && db) { 
           const finalDocRef = doc(db, DOCUMENTS_COLLECTION, initialInvoiceIdParam);
           const finalDocSnap = await getDoc(finalDocRef);
           if (finalDocSnap.exists()) rawScanResultJsonToSave = finalDocSnap.data()?.rawScanResultJson || null;
        }
        
        const result = await finalizeSaveProductsService(
          productsForService, finalFileNameForSave, docTypeParam, user.id,
          currentTempInvoiceId || initialInvoiceIdParam || undefined, 
          finalInvoiceNumberForSave || undefined, finalSupplierNameForSave || undefined,
          finalTotalAmountForSave ?? undefined, finalPaymentDueDateForSave, 
          finalInvoiceDateForSave, finalPaymentMethodForSave || undefined, 
          displayedOriginalImageUrl || undefined, displayedCompressedImageUrl || undefined,
          rawScanResultJsonToSave 
        );
        finalDocumentRecord = result.finalInvoiceRecord;
        console.log("[EditInvoice][proceedWithFinalSave] finalizeSaveProductsService result:", result);
        
        if (isNewScan && !initialInvoiceIdParam) cleanupTemporaryData(); 

        if (result.finalInvoiceRecord) {
          setOriginalFileName(result.finalInvoiceRecord.generatedFileName || result.finalInvoiceRecord.originalFileName || t('edit_invoice_unknown_document')); 
          const finalTaxDetails: EditableTaxInvoiceDetails = {
              supplierName: result.finalInvoiceRecord.supplierName, invoiceNumber: result.finalInvoiceRecord.invoiceNumber,
              totalAmount: result.finalInvoiceRecord.totalAmount, invoiceDate: result.finalInvoiceRecord.invoiceDate,
              paymentMethod: result.finalInvoiceRecord.paymentMethod, paymentDueDate: result.finalInvoiceRecord.paymentDueDate,
          };
          setEditableTaxInvoiceDetails(finalTaxDetails); setInitialScannedTaxDetails(finalTaxDetails); 
          const paymentDueDateFromResult = result.finalInvoiceRecord.paymentDueDate;
          if(paymentDueDateFromResult){
              if (paymentDueDateFromResult instanceof Timestamp) setSelectedPaymentDueDate(paymentDueDateFromResult.toDate());
              else if (typeof paymentDueDateFromResult === 'string' && isValid(parseISO(paymentDueDateFromResult))) setSelectedPaymentDueDate(parseISO(paymentDueDateFromResult));
              else if (paymentDueDateFromResult instanceof Date && isValid(paymentDueDateFromResult)) setSelectedPaymentDueDate(paymentDueDateFromResult);
          } else setSelectedPaymentDueDate(undefined);
          setDisplayedOriginalImageUrl(result.finalInvoiceRecord.originalImagePreviewUri || null);
          setDisplayedCompressedImageUrl(result.finalInvoiceRecord.compressedImageForFinalRecordUri || null);
          if (result.savedProductsWithFinalIds) {
              const finalProducts = result.savedProductsWithFinalIds.map(p => ({ ...p, _originalId: p.id }));
              setProducts(finalProducts); setInitialScannedProducts(finalProducts); setProductsForNextStep(finalProducts); 
          }
          setScanProcessErrorState(result.finalInvoiceRecord.errorMessage || null); 
          setIsEditingDeliveryNoteProducts(false); setIsEditingTaxDetails(false);
          setIsViewMode(true); setCurrentDialogStep('idle'); // Important: Reset dialog step
           toast({
              title: docTypeParam === 'deliveryNote' ? t('edit_invoice_toast_products_saved_title') : t('edit_invoice_toast_invoice_details_saved_title'),
              description: docTypeParam === 'deliveryNote' ? t('edit_invoice_toast_products_saved_desc') : t('edit_invoice_toast_invoice_details_saved_desc'),
          });
          // Navigate after state updates have a chance to process
          setTimeout(() => {
             if (docTypeParam === 'deliveryNote') router.push('/inventory?refresh=true');
             else if (docTypeParam === 'invoice') router.push('/invoices?tab=scanned-docs&refresh=true'); 
          }, 100);

        } else {
           setScanProcessErrorState(t('edit_invoice_toast_save_failed_desc_finalize', { message: "Final invoice record not returned."}));
           setCurrentDialogStep('error_loading'); 
        }
        return result.finalInvoiceRecord;
    } catch (error: any) {
        console.error("[EditInvoice][proceedWithFinalSave] Failed to finalize save:", error);
         if ((error as any).isQuotaError) { 
          toast({ title: t('upload_toast_storage_full_title_critical'), description: t('upload_toast_storage_full_desc_finalize', {context: "(finalize save)"}), variant: "destructive", duration: 10000, });
        } else {
          toast({ title: t('edit_invoice_toast_save_failed_title'), description: t('edit_invoice_toast_save_failed_desc_finalize', { message: (error as Error).message || t('edit_invoice_try_again')}), variant: "destructive", });
        }
        if (finalDocumentRecord && finalDocumentRecord.id) { // If record was partially created before error
            setIsViewMode(true);
            setOriginalFileName(finalDocumentRecord.generatedFileName || finalDocumentRecord.originalFileName || t('edit_invoice_unknown_document'));
            setEditableTaxInvoiceDetails({
                supplierName: finalDocumentRecord.supplierName, invoiceNumber: finalDocumentRecord.invoiceNumber,
                totalAmount: finalDocumentRecord.totalAmount, invoiceDate: finalDocumentRecord.invoiceDate,
                paymentMethod: finalDocumentRecord.paymentMethod, paymentDueDate: finalDocumentRecord.paymentDueDate,
            });
        } else setCurrentDialogStep('error_loading'); 
        return null;
    }
  }, [user?.id, docTypeParam, originalFileName, editableTaxInvoiceDetails, selectedPaymentDueDate, initialTempInvoiceId, searchParams, displayedOriginalImageUrl, displayedCompressedImageUrl, isNewScan, cleanupTemporaryData, t, toast, router, initialInvoiceIdParam]);

  const proceedWithActualSave = useCallback(async (productsToSave: Product[]) => {
    if (!user?.id || !docTypeParam) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), description: t("edit_invoice_user_not_authenticated_desc"), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        return;
    }
    
    let currentProductsToProcess = [...productsToSave];
    console.log("[EditInvoice][proceedWithActualSave] Starting. Products to save count:", productsToSave.length);
    try {
        if(docTypeParam === 'deliveryNote' && currentProductsToProcess.length > 0) {
            console.log("[EditInvoice][proceedWithActualSave] Checking product prices for delivery note.");
            const priceCheckResult = await checkProductPricesBeforeSaveService(currentProductsToProcess, user.id);
            console.log("[EditInvoice][proceedWithActualSave] Price check result:", priceCheckResult);
            if (priceCheckResult.priceDiscrepancies.length > 0) {
                setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
                const productsForDiscrepancyDialog = priceCheckResult.productsToSaveDirectly.concat(
                    priceCheckResult.priceDiscrepancies.map(d => ({ ...d, unitPrice: d.newUnitPrice, salePrice: d.salePrice, }))
                ).map(p => ({...p} as EditableProduct));
                setProductsForNextStep(productsForDiscrepancyDialog); 
                setCurrentDialogStep('price_discrepancy');
                console.log("[EditInvoice][proceedWithActualSave] Price discrepancies found. Moving to 'price_discrepancy' dialog.");
                return; 
            }
            currentProductsToProcess = priceCheckResult.productsToSaveDirectly.map(p => ({...p} as EditableProduct)); 
            console.log("[EditInvoice][proceedWithActualSave] No price discrepancies or resolved. Products to save directly:", currentProductsToProcess.length);
        }
        await proceedWithFinalSave(currentProductsToProcess);
    } catch (error) {
        console.error("[EditInvoice][proceedWithActualSave] Error during actual save process:", error);
        toast({ title: t('edit_invoice_toast_error_preparing_save_title'), description: t('edit_invoice_toast_error_preparing_save_desc', { message: (error as Error).message}), variant: "destructive",});
        setCurrentDialogStep('error_loading');
    } finally {
       if (currentDialogStep !== 'price_discrepancy' && currentDialogStep !== 'new_product_details') {
           console.log("[EditInvoice][proceedWithActualSave] Resetting isSaving in finally block.");
           setIsSaving(false); // Ensure isSaving is reset if not moving to another dialog
       }
    }
  }, [user?.id, docTypeParam, t, toast, proceedWithFinalSave, currentDialogStep]); // Added currentDialogStep


 const handleSaveChecks = useCallback(async () => {
    if (isSaving) {
        console.log("[EditInvoice][handleSaveChecks] Already saving, returning.");
        return;
    }
    console.log("[EditInvoice][handleSaveChecks] Initiated. isNewScan:", isNewScan, "currentDialogStep:", currentDialogStep);
    setIsSaving(true); 
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        setIsSaving(false); 
        return;
    }
    if (isNewScan && currentDialogStep !== 'ready_to_save') {
        console.log("[EditInvoice][handleSaveChecks] New scan, but not ready to save. Processing next dialog step from:", currentDialogStep);
        await processNextDialogStep(`manual_advance_from_${currentDialogStep}`);
        // setIsSaving will be reset if a dialog opens or if processNext errors.
        // If it goes directly to ready_to_save, the disabled state of button will allow next click.
        if (currentDialogStep !== 'ready_to_save') setIsSaving(false); // only reset if a dialog is still pending
        return;
    }
    console.log("[EditInvoice][handleSaveChecks] Proceeding to actual save logic. Products for save:", productsForNextStep.length > 0 ? productsForNextStep : products);
    await proceedWithActualSave(productsForNextStep.length > 0 ? productsForNextStep : products);
}, [isSaving, user?.id, toast, t, isNewScan, currentDialogStep, processNextDialogStep, productsForNextStep, products, proceedWithActualSave, startDialogFlowForNewScan, _internalCheckSupplier, checkForNewProductsAndDetails, handleNewProductDetailsComplete, initialScannedProducts, productInputStates, aiScannedSupplierNameFromStorage, initialScannedTaxDetails ]);


  const handleInputChange = useCallback((id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(p => {
        if (p.id === id) {
          const updatedProduct = { ...p };
          let numericValue: number | string | null | undefined = value;
          if (['quantity', 'unitPrice', 'lineTotal', 'minStockLevel', 'maxStockLevel', 'salePrice'].includes(field)) {
            const stringValue = String(value);
            if ((field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice') && stringValue.trim() === '') numericValue = undefined; 
            else {
              numericValue = parseFloat(stringValue.replace(/,/g, ''));
              if (isNaN(numericValue as number)) numericValue = (field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice') ? undefined : 0;
            }
            (updatedProduct as any)[field] = numericValue;
          } else (updatedProduct as any)[field] = value;

          let currentQuantity = Number(updatedProduct.quantity) || 0;
          let currentUnitPrice = (updatedProduct.unitPrice !== undefined && updatedProduct.unitPrice !== null && !isNaN(Number(updatedProduct.unitPrice))) ? Number(updatedProduct.unitPrice) : 0;
          let currentLineTotal = Number(updatedProduct.lineTotal) || 0;

          if (field === 'quantity' || field === 'unitPrice') {
             if (currentQuantity > 0 && currentUnitPrice >= 0 ) currentLineTotal = parseFloat((currentQuantity * currentUnitPrice).toFixed(2));
             else if ((field === 'unitPrice' && currentUnitPrice === 0 && currentQuantity > 0) || (field === 'quantity' && currentQuantity === 0) ) currentLineTotal = 0; 
            updatedProduct.lineTotal = currentLineTotal;
          } else if (field === 'lineTotal') {
            if (currentQuantity > 0 && currentLineTotal >= 0) { currentUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2)); updatedProduct.unitPrice = currentUnitPrice; } 
            else if (currentLineTotal === 0) updatedProduct.unitPrice = 0;
          }
           if (currentQuantity === 0 || currentUnitPrice === 0) updatedProduct.lineTotal = 0;
           if (currentQuantity > 0 && currentLineTotal > 0 && field !== 'unitPrice' && currentUnitPrice === 0) updatedProduct.unitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
          return updatedProduct;
        }
        return p;
      })
    );
     setProductsForNextStep(prev => prev.map(p => p.id === id ? ({...p, [field]:value}) : p));
  }, []);

  const handleTaxInvoiceDetailsChange = useCallback((field: keyof EditableTaxInvoiceDetails, value: string | number | undefined | Date | Timestamp) => {
     setEditableTaxInvoiceDetails(prev => ({ ...prev, [field]: value === '' ? null : value }));
  }, []);

  const handleAddRow = useCallback(() => {
    const newProduct: EditableProduct = {
      id: `prod-temp-${Date.now()}-newManual`, _originalId: `prod-temp-${Date.now()}-newManual`, 
      userId: user?.id || 'unknown', catalogNumber: '', description: '', quantity: 0, unitPrice: 0,
      lineTotal: 0, barcode: null, minStockLevel: null, maxStockLevel: null, salePrice: null, imageUrl: null,
    };
    setProducts(prevProducts => [...prevProducts, newProduct]);
    setProductsForNextStep(prev => [...prev, newProduct]); // Also add to productsForNextStep if editing starts immediately
  }, [user?.id]);

  const handleRemoveRow = useCallback((id: string) => {
    setProducts(prevProducts => prevProducts.filter(product => product.id !== id));
    setProductsForNextStep(prev => prev.filter(product => product.id !== id));
     toast({ title: t('edit_invoice_toast_row_removed_title'), description: t('edit_invoice_toast_row_removed_desc'), variant: "default", });
  }, [t, toast]);

  const handleCancelEditTaxDetails = useCallback(() => {
    setEditableTaxInvoiceDetails({...initialScannedTaxDetails}); setIsEditingTaxDetails(false);
  }, [initialScannedTaxDetails]);

  const handleSaveEditTaxDetails = useCallback(() => {
    setInitialScannedTaxDetails({...editableTaxInvoiceDetails}); setIsEditingTaxDetails(false);
    toast({ title: t('edit_invoice_toast_section_updated_title'), description: t('edit_invoice_toast_section_updated_desc') });
  }, [editableTaxInvoiceDetails, t, toast]);

  const handleCancelEditProducts = useCallback(() => {
    setProducts(initialScannedProducts.map(p => ({...p}))); 
    setProductsForNextStep(initialScannedProducts.map(p => ({...p})));
    setIsEditingDeliveryNoteProducts(false);
  }, [initialScannedProducts]);

  const handleSaveEditProducts = useCallback(() => {
    setInitialScannedProducts(products.map(p => ({...p}))); 
    setProductsForNextStep(products.map(p => ({...p})));
    setIsEditingDeliveryNoteProducts(false);
    toast({ title: t('edit_invoice_toast_products_updated_title_section'), description: t('edit_invoice_toast_section_updated_desc') });
  }, [products, t, toast]);

  const toggleEditTaxDetails = useCallback(() => {
    if (isEditingTaxDetails) handleSaveEditTaxDetails(); 
    else {
        setEditableTaxInvoiceDetails(prev => ({...prev, ...initialScannedTaxDetails})); 
        setIsEditingTaxDetails(true); if (isViewMode) setIsViewMode(false); 
    }
  }, [isEditingTaxDetails, handleSaveEditTaxDetails, initialScannedTaxDetails, isViewMode]);
    
  const toggleEditDeliveryNoteProducts = useCallback(() => {
    if (isEditingDeliveryNoteProducts) handleSaveEditProducts(); 
    else {
        setProducts([...initialScannedProducts.map(p => ({...p}))]); 
        setProductsForNextStep([...initialScannedProducts.map(p => ({...p}))]);
        setIsEditingDeliveryNoteProducts(true); if (isViewMode) setIsViewMode(false); 
    }
  }, [isEditingDeliveryNoteProducts, handleSaveEditProducts, initialScannedProducts, isViewMode]);

  const handleGoBack = useCallback(() => {
    if (isNewScan && !initialInvoiceIdParam) cleanupTemporaryData(); 
    router.push(isNewScan && !initialInvoiceIdParam ? '/upload' : (docTypeParam === 'invoice' ? '/invoices?tab=scanned-docs' : '/inventory'));
  }, [cleanupTemporaryData, router, isNewScan, docTypeParam, initialInvoiceIdParam]);


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
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitleComponent>{t('edit_invoice_error_loading_title')}</AlertTitleComponent>
                    <AlertDescriptionComponent>{errorLoading || "An unknown error occurred."}</AlertDescriptionComponent>
                </Alert>
                <Button variant="outline" onClick={handleGoBack}>
                   <ArrowLeft className="mr-2 h-4 w-4" /> {t('edit_invoice_go_back_button')}
                </Button>
            </div>
        );
    }
    
    const showManualEntryCard = !isNewScan && 
        currentDialogStep !== 'error_loading' && !isLoading &&
        ((docTypeParam === 'deliveryNote' && products.length === 0 && !scanProcessErrorState) ||
         (docTypeParam === 'invoice' && Object.values(editableTaxInvoiceDetails).every(val => val === undefined || val === '' || val === 0 || val === null) && !scanProcessErrorState && !errorLoading && !initialTempInvoiceId && !initialInvoiceIdParam )
        );

    if (showManualEntryCard) { 
         return (
             <div className="container mx-auto p-4 md:p-8 space-y-4">
                 {scanProcessErrorState && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitleComponent>{t('edit_invoice_scan_process_error_title')}</AlertTitleComponent>
                        <AlertDescriptionComponent>
                            {t('edit_invoice_scan_process_error_desc', { error: scanProcessErrorState })}
                        </AlertDescriptionComponent>
                    </Alert>
                 )}
                 {!scanProcessErrorState && docTypeParam === 'deliveryNote' && products.length === 0 && (
                     <Alert variant="default">
                        <Info className="h-4 w-4" />
                         <AlertTitleComponent>{t('edit_invoice_no_products_found_title')}</AlertTitleComponent>
                         <AlertDescriptionComponent>
                            {t('edit_invoice_no_products_found_desc')}
                         </AlertDescriptionComponent>
                     </Alert>
                 )}
                 <Card className="shadow-md scale-fade-in">
                     <CardHeader>
                         <CardTitle className="text-xl sm:text-2xl font-semibold text-primary">{originalFileName || t('edit_invoice_manual_entry_title')}</CardTitle>
                         <CardDescription>
                            {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
                         </CardDescription>
                     </CardHeader>
                      <CardContent className="space-y-4">
                           {docTypeParam === 'deliveryNote' && (
                             <React.Fragment key="delivery-note-manual-entry-block">
                                 {renderEditableTaxInvoiceDetails()}
                                 <Separator className="my-4" />
                                 <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-lg font-semibold text-primary flex items-center">
                                        <PackageIcon className="mr-2 h-5 w-5"/>
                                        {t('edit_invoice_extracted_products_title')} ({products.length})
                                    </h3>
                                    <Button variant="ghost" size="icon" onClick={toggleEditDeliveryNoteProducts} className="h-8 w-8 text-muted-foreground hover:text-primary">
                                        {isEditingDeliveryNoteProducts ? <Save className="h-4 w-4 text-green-600" /> : <Edit className="h-4 w-4" />}
                                        <span className="sr-only">{isEditingDeliveryNoteProducts ? t('save_button') : t('edit_button')}</span>
                                    </Button>
                                </div>
                                 {renderEditableProductTable()}
                             </React.Fragment>
                           )}
                           {docTypeParam === 'invoice' && (
                             <React.Fragment key="invoice-manual-entry-block">
                                 {renderEditableTaxInvoiceDetails()}
                             </React.Fragment>
                           )}
                            <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
                                <Button variant="outline" onClick={handleGoBack} className="w-full sm:w-auto order-last sm:order-first" disabled={isSaving}>
                                    <ArrowLeft className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_discard_scan_button') : (docTypeParam === 'invoice' ? t('edit_invoice_go_back_to_invoices_button') : t('product_detail_back_to_inventory_button'))}
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
                      </CardContent>
                 </Card>
             </div>
         );
    }

    const renderScanSummaryItem = (labelKey: string, value?: string | number | null | Timestamp | Date, field?: keyof EditableTaxInvoiceDetails) => {
        if (value === undefined || value === null || String(value).trim() === '') return null;
        let displayValue = String(value); 
        if (typeof value === 'number') {
             displayValue = t('currency_symbol') + value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0});
        } else if ((field === 'invoiceDate' || field === 'paymentDueDate') && value) { 
             let dateToFormat: Date | null = null;
             if (value instanceof Timestamp) dateToFormat = value.toDate();
             else if (typeof value === 'string' && isValid(parseISO(value))) dateToFormat = parseISO(value);
             else if (value instanceof Date && isValid(value)) dateToFormat = value;

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
        const detailsToDisplay = initialScannedTaxDetails; // Always show initial for read-only after scan
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

    const renderEditableProductTable = () => (
        <div className="overflow-x-auto relative border rounded-md bg-card">
           <Table className="min-w-full sm:min-w-[600px]"> {/* Ensure table can be wider than screen */}
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
                                formatInputValue(product.unitPrice, 'currency', t)
                            )}
                        </TableCell>
                        <TableCell className="text-right px-2 sm:px-4 py-2">
                             {isEditingDeliveryNoteProducts ? (
                                <Input type="number" value={formatInputValue(product.lineTotal, 'currency', t)} onChange={(e) => handleInputChange(product.id, 'lineTotal', e.target.value)} className="w-24 sm:w-28 text-right h-9" disabled={isSaving}/>
                            ) : (
                                formatInputValue(product.lineTotal, 'currency', t)
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
   );

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
        <Card className="shadow-md scale-fade-in overflow-hidden"> {/* Added overflow-hidden to card */}
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-muted/30 p-4">
                <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                        <FileTextIconLucide className="mr-2 h-5 w-5 flex-shrink-0" />
                        <span className="truncate" title={originalFileName || t('edit_invoice_unknown_document')}>
                            {originalFileName || t('edit_invoice_unknown_document')}
                        </span>
                    </CardTitle>
                    <CardDescription className="break-words mt-1 text-xs sm:text-sm">
                        {docTypeParam === 'deliveryNote' ? t('edit_invoice_delivery_note_details_title') : (docTypeParam === 'invoice' ? t('edit_invoice_invoice_details_title') : t('edit_invoice_title'))}
                    </CardDescription>
                </div>
                 {!isViewMode && docTypeParam && (
                     <Button variant="ghost" size="icon" onClick={toggleEditTaxDetails} className="h-8 w-8 text-muted-foreground hover:text-primary flex-shrink-0">
                         {isEditingTaxDetails ? <Save className="h-4 w-4 text-green-600" /> : <Edit className="h-4 w-4" />}
                        <span className="sr-only">{isEditingTaxDetails ? t('save_button') : t('edit_button')} {t('invoice_details_title')}</span>
                     </Button>
                )}
            </CardHeader>
            <CardContent className="p-4 space-y-4">
                {scanProcessErrorState && !isSaving && (
                    <Alert variant="destructive" className="mt-2">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitleComponent>{t('edit_invoice_scan_process_error_title')}</AlertTitleComponent>
                        <AlertDescriptionComponent>{scanProcessErrorState}</AlertDescriptionComponent>
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
                                    fill // Changed from layout="fill" to fill for Next 13+
                                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" // Example sizes, adjust as needed
                                    style={{objectFit:"contain"}} // Changed from objectFit to style
                                />
                            </div>
                        ) : (
                             <div className="aspect-auto w-full max-h-[400px] border rounded-md bg-muted flex items-center justify-center text-muted-foreground" data-ai-hint="document placeholder">
                                <FileTextIconLucide className="h-16 w-16 opacity-50"/>
                            </div>
                        )}
                    </div>
                     <div className="md:col-span-1 space-y-3">
                        {isEditingTaxDetails ? renderEditableTaxInvoiceDetails() : renderReadOnlyTaxInvoiceDetails()}
                     </div>
                </div>
                 <div className="mt-6">
                    {docTypeParam === 'deliveryNote' && (
                        <React.Fragment key="delivery-note-section">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-lg font-semibold text-primary flex items-center">
                                    <PackageIcon className="mr-2 h-5 w-5"/>
                                    {t('edit_invoice_extracted_products_title')} ({products.length})
                                </h3>
                                {!isViewMode && (
                                     <Button variant="ghost" size="icon" onClick={toggleEditDeliveryNoteProducts} className="h-8 w-8 text-muted-foreground hover:text-primary">
                                        {isEditingDeliveryNoteProducts ? <Save className="h-4 w-4 text-green-600" /> : <Edit className="h-4 w-4" />}
                                         <span className="sr-only">{isEditingDeliveryNoteProducts ? t('save_button') : t('edit_button')} {t('edit_invoice_extracted_products_title')}</span>
                                     </Button>
                                )}
                            </div>
                            {products.length > 0 || isEditingDeliveryNoteProducts ? (
                                 renderEditableProductTable()
                            ) : (
                                <p className="text-muted-foreground">{t('edit_invoice_no_products_in_scan')}</p>
                            )}
                             {isEditingDeliveryNoteProducts && (
                                 <div className="flex justify-between items-center pt-4 mt-2 border-t">
                                     <Button variant="outline" onClick={handleAddRow} disabled={isSaving}>
                                         <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                                     </Button>
                                 </div>
                             )}
                        </React.Fragment>
                    )}
                           {docTypeParam === 'invoice' && !isViewMode && !isEditingTaxDetails && (
                            <div className="mt-4">
                                {/* For tax invoice view mode, we don't typically edit general details unless explicitly toggled */}
                            </div>
                           )}
                 </div>
            </CardContent>
            {(!isViewMode && (isEditingTaxDetails || isEditingDeliveryNoteProducts)) && (
                 <CardFooter className="p-4 border-t flex justify-end gap-2">
                      {isEditingTaxDetails && (
                        <>
                         <Button variant="outline" onClick={handleCancelEditTaxDetails} disabled={isSaving}>{t('cancel_button')}</Button>
                         <Button onClick={handleSaveEditTaxDetails} disabled={isSaving}>{t('save_button')}</Button>
                        </>
                      )}
                      {isEditingDeliveryNoteProducts && (
                         <>
                          <Button variant="outline" onClick={handleCancelEditProducts} disabled={isSaving}>{t('cancel_button')}</Button>
                          <Button onClick={handleSaveEditProducts} disabled={isSaving}>{t('save_button')}</Button>
                         </>
                      )}
                 </CardFooter>
            )}
        </Card>
                            
        <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
            <Button variant="outline" onClick={handleGoBack} className="w-full sm:w-auto order-last sm:order-first" disabled={isSaving}>
                <ArrowLeft className="mr-2 h-4 w-4" /> {isViewMode ? (docTypeParam === 'invoice' ? t('edit_invoice_go_back_to_invoices_button') : t('product_detail_back_to_inventory_button')) : t('edit_invoice_discard_scan_button')}
            </Button>
            
            {!isViewMode && (
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

       {currentDialogStep === 'supplier_confirmation' && isNewScan && user && !!potentialSupplierName && (
        <SupplierConfirmationDialog
          potentialSupplierName={potentialSupplierName}
          existingSuppliers={existingSuppliers}
          onConfirm={handleSupplierConfirmation}
          onCancel={() => processNextDialogStep('supplier_skipped')}
          isOpen={currentDialogStep === 'supplier_confirmation' && !!potentialSupplierName}
          onOpenChange={(open) => { 
              if (!open && currentDialogStep === 'supplier_confirmation') { 
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
          onComplete={handleNewProductDetailsComplete}
          isOpen={currentDialogStep === 'new_product_details' && productsToDisplayForNewDetails.length > 0}
          onOpenChange={(open) => {
              if (!open && currentDialogStep === 'new_product_details') { 
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
