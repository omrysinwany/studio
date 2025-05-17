
'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'; // Removed CardTitle as it's not directly used here, but through CardHeader
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
    getStorageKey,
    MAX_SCAN_RESULTS_SIZE_BYTES,

} from '@/services/backend';
import type { ScanInvoiceOutput, ExtractedProductSchema as AIScannedProduct } from '@/ai/flows/invoice-schemas';
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
import { CardTitle } from '@/components/ui/card'; // Explicitly import CardTitle


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

  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [initialScannedProducts, setInitialScannedProducts] = useState<EditableProduct[]>([]);
  const [productsForNextStep, setProductsForNextStep] = useState<EditableProduct[]>([]);
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [errorLoading, setErrorLoading] = useState<string | null>(null);
  const [scanProcessErrorState, setScanProcessErrorState] = useState<string | null>(null);
  const [isNewScan, setIsNewScan] = useState(false);
  const [isViewMode, setIsViewMode] = useState(true);
  const [isEditingTaxDetails, setIsEditingTaxDetails] = useState(false);
  const [isEditingDeliveryNoteProducts, setIsEditingDeliveryNoteProducts] = useState(false);

  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] = useState<EditableTaxInvoiceDetails>({});
  const [initialScannedTaxDetails, setInitialScannedTaxDetails] = useState<EditableTaxInvoiceDetails>({});
  const [displayedOriginalImageUrl, setDisplayedOriginalImageUrl] = useState<string | null>(null);
  const [displayedCompressedImageUrl, setDisplayedCompressedImageUrl] = useState<string | null>(null);
  
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

  const cleanupTemporaryData = useCallback(() => {
    console.log("[EditInvoice][cleanupTemporaryData] Called.");
    // Get fresh keyParam inside the callback, as searchParams can change
    const keyParamForCleanup = searchParams.get('key');
    if (keyParamForCleanup && user?.id) {
      try {
        const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_${keyParamForCleanup}`);
        if (localStorage.getItem(dataKey)) {
          localStorage.removeItem(dataKey);
          console.log(`[EditInvoice][cleanupTemporaryData] Cleared localStorage scan result JSON for key: ${dataKey}`);
        }
      } catch (e) {
        console.error(`[EditInvoice][cleanupTemporaryData] Error removing localStorage key ${keyParamForCleanup}:`, e);
      }
    }
  }, [searchParams, user?.id]);

  const _internalCheckSupplier = useCallback(async (scannedSupplierFromAi: string | null | undefined, currentUserId: string, fetchedSuppliersList: SupplierSummary[]) => {
    console.log(`[EditInvoice][_internalCheckSupplier] Called. Scanned Supplier: "${scannedSupplierFromAi}", UserID: ${currentUserId}, Fetched Suppliers: ${fetchedSuppliersList.length}`);
    setExistingSuppliers(fetchedSuppliersList || []);
    
    const trimmedScannedSupplier = scannedSupplierFromAi?.trim();
    console.log(`[EditInvoice][_internalCheckSupplier] Trimmed scanned supplier from AI: "${trimmedScannedSupplier}"`);

    if (trimmedScannedSupplier && trimmedScannedSupplier !== '') {
      const supplierExists = (fetchedSuppliersList || []).some(s => s && typeof s.name === 'string' && s.name.toLowerCase() === trimmedScannedSupplier.toLowerCase());
      console.log(`[EditInvoice][_internalCheckSupplier] Does supplier "${trimmedScannedSupplier}" exist in list? ${supplierExists}`);
      
      if (!supplierExists) {
          console.log("[EditInvoice][_internalCheckSupplier] Scanned supplier is NEW and NOT EMPTY. Setting potential supplier. Potential supplier:", trimmedScannedSupplier);
          setPotentialSupplierName(trimmedScannedSupplier); 
          // processNextDialogStep will be called by the dialog flow
          setCurrentDialogStep('supplier_confirmation');
      } else {
          console.log("[EditInvoice][_internalCheckSupplier] Supplier is EXISTING. Confirming supplier.");
          setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: trimmedScannedSupplier }));
          setIsSupplierConfirmed(true); 
          processNextDialogStep('supplier_confirmed');
      }
    } else {
        console.log("[EditInvoice][_internalCheckSupplier] Scanned supplier is EMPTY or null. Skipping supplier confirmation.");
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: null })); 
        setIsSupplierConfirmed(true); 
        processNextDialogStep('supplier_existing_or_empty');
    }
  }, []); // processNextDialogStep will be added after its definition

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
            const existingInInventoryById = p._originalId && !p._originalId.startsWith('prod-temp-') && !p._originalId.startsWith('temp-id-') && inventoryMap.has(`id:${p._originalId}`);
            const existingInInventoryByCat = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
            const existingInInventoryByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);
            const isExistingProduct = existingInInventoryById || existingInInventoryByCat || existingInInventoryByBarcode;
            const needsSalePriceReview = p.salePrice === undefined; 
            
            console.log(`[EditInvoice][checkForNewProductsAndDetails] Product: ${p.shortName || p.id}, isExisting: ${isExistingProduct}, needsSalePriceReview: ${needsSalePriceReview}`);
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
                    salePriceMethod: p.salePrice !== undefined ? 'manual' : 'percentage',
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
            if (previousStepOutcome === 'supplier_skipped' || previousStepOutcome === 'supplier_confirmed' || previousStepOutcome === 'supplier_existing_or_empty' || previousStepOutcome === 'supplier_fetch_error' || previousStepOutcome === 'supplier_and_payment_date_pre_confirmed_for_existing_supplier') {
                console.log("[EditInvoice][processNextDialogStep] From supplier outcome. isNewScan:", isNewScan, "selectedPaymentDueDate:", selectedPaymentDueDate, "isPaymentDueDateDialogSkipped:", isPaymentDueDateDialogSkipped, "docTypeParam:", docTypeParam);
                 if (previousStepOutcome === 'supplier_and_payment_date_pre_confirmed_for_existing_supplier'){
                     if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
                        const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
                        if (reviewResult.needsReview) {
                            setCurrentDialogStep('new_product_details');
                        } else {
                            setCurrentDialogStep('ready_to_save');
                        }
                    } else {
                        setCurrentDialogStep('ready_to_save');
                    }
                 } else if (!selectedPaymentDueDate && !isPaymentDueDateDialogSkipped && (docTypeParam === 'deliveryNote' || docTypeParam === 'invoice')) {
                    console.log("[EditInvoice][processNextDialogStep] Moving to payment_due_date.");
                    setCurrentDialogStep('payment_due_date');
                } else {
                    console.log("[EditInvoice][processNextDialogStep] Payment due date done or skipped. Checking new product details. DocType:", docTypeParam);
                    if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
                        const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
                        if (reviewResult.needsReview) {
                            setCurrentDialogStep('new_product_details');
                        } else {
                            setCurrentDialogStep('ready_to_save');
                        }
                    } else { 
                        setCurrentDialogStep('ready_to_save');
                    }
                }
            }
            break;

        case 'payment_due_date':
            if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
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

        case 'new_product_details':
             const updatedProductsFromPrompt = data as EditableProduct[] | null;
             if (updatedProductsFromPrompt) { 
                 setProductsForNextStep(updatedProductsFromPrompt); 
                 setProducts(updatedProductsFromPrompt.map(p => ({...p, _originalId: p.id || p._originalId })));
             }
             setCurrentDialogStep('ready_to_save'); 
            break;

        case 'price_discrepancy':
             const resolvedProductsFromDiscrepancy = data as EditableProduct[] | null;
             if (resolvedProductsFromDiscrepancy === null) { 
                 toast({ title: t("edit_invoice_toast_save_cancelled_title"), description: t("edit_invoice_toast_save_cancelled_desc_price"), variant: "default" });
                 setCurrentDialogStep('ready_to_save'); 
                 return;
             }
            setProductsForNextStep(resolvedProductsFromDiscrepancy);
            setProducts(resolvedProductsFromDiscrepancy.map(p => ({...p, _originalId: p.id || p._originalId })));
            currentProductsForCheck = resolvedProductsFromDiscrepancy; 
            
             if (docTypeParam === 'deliveryNote' && currentProductsForCheck.length > 0) {
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
            setCurrentDialogStep('ready_to_save');
            break;
    }
  }, [currentDialogStep, isNewScan, user?.id, docTypeParam, products, productsForNextStep, selectedPaymentDueDate, isPaymentDueDateDialogSkipped, t, toast, checkForNewProductsAndDetails]);
  
  // This needs to be defined after processNextDialogStep if it uses it.
  // Reordering _internalCheckSupplier and processNextDialogStep
  useCallback(() => {
      // Make sure _internalCheckSupplier is defined correctly
      if (typeof _internalCheckSupplier !== 'function') {
          console.error("_internalCheckSupplier is not a function within processNextDialogStep's scope");
      }
  }, [_internalCheckSupplier]);


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
            setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: trimmedScannedSupplier }));
            setIsSupplierConfirmed(true);
            setIsPaymentDueDateDialogSkipped(true); // Skip payment date for existing
            processNextDialogStep('supplier_and_payment_date_pre_confirmed_for_existing_supplier');
        } else {
             await _internalCheckSupplier(scannedSupplierFromStorage, user.id, fetchedSuppliersList);
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
  }, [isNewScan, user?.id, t, toast, _internalCheckSupplier, processNextDialogStep]);


  const loadData = useCallback(async () => {
    if (!user?.id || authLoading) {
      if (!authLoading && !user) router.push('/login');
      return;
    }
     if (initialDataLoaded && !searchParams.get('refresh') && !initialTempInvoiceId && !initialInvoiceIdParam) {
        return;
    }
    
    console.log("[EditInvoice][loadData] Proceeding with data load for user:", user.id);
    setIsLoading(true);
    setErrorLoading(null);
    setScanProcessErrorState(null);
    
    const currentIsNewScanVal = !initialInvoiceIdParam && !!initialTempInvoiceId;
    setIsNewScan(currentIsNewScanVal);

    if (currentIsNewScanVal) {
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
      setIsViewMode(false); 
    } else if (initialInvoiceIdParam) {
      setIsViewMode(true);
      setIsEditingTaxDetails(false);
      setIsEditingDeliveryNoteProducts(false);
      setCurrentDialogStep('ready_to_save'); 
    } else { 
      setIsViewMode(false);
      setIsEditingTaxDetails(docTypeParam === 'invoice');
      setIsEditingDeliveryNoteProducts(docTypeParam === 'deliveryNote');
      setCurrentDialogStep('ready_to_save'); 
      setOriginalFileName(t('edit_invoice_manual_entry_title'));
      setIsNewScan(true);
    }

    setOriginalFileName(searchParams.get('originalFileName') || t('edit_invoice_unknown_document'));

    let localAiScannedSupplierName: string | undefined = undefined;
    let scanResultJsonFromStorage: string | null = null; 
    let pendingDocData: InvoiceHistoryItem | null = null;

    if (initialInvoiceIdParam) {
      try {
        if (!db) throw new Error("Firestore not initialized.");
        const finalDocRef = doc(db, DOCUMENTS_COLLECTION, initialInvoiceIdParam);
        const finalDocSnap = await getDoc(finalDocRef);
        if (finalDocSnap.exists() && finalDocSnap.data().userId === user.id) {
          pendingDocData = { id: finalDocSnap.id, ...finalDocSnap.data() } as InvoiceHistoryItem;
        } else {
          setErrorLoading(t('edit_invoice_error_invoice_not_found_id', { invoiceId: initialInvoiceIdParam }));
          setCurrentDialogStep('error_loading');
        }
      } catch (e) {
        setErrorLoading(t('edit_invoice_error_loading_existing'));
        setCurrentDialogStep('error_loading');
      }
    } else if (initialTempInvoiceId) {
      try {
        if (!db) throw new Error("Firestore not initialized.");
        const pendingDocRef = doc(db, DOCUMENTS_COLLECTION, initialTempInvoiceId);
        const pendingDocSnap = await getDoc(pendingDocRef);
        if (pendingDocSnap.exists() && pendingDocSnap.data().userId === user.id) {
          pendingDocData = { id: pendingDocSnap.id, ...pendingDocSnap.data() } as InvoiceHistoryItem;
           if(pendingDocData.rawScanResultJson && typeof pendingDocData.rawScanResultJson === 'string'){
             scanResultJsonFromStorage = pendingDocData.rawScanResultJson;
           } else if (localStorageScanDataMissingParam) {
              console.warn("[EditInvoice][loadData] rawScanResultJson missing in Firestore, localStorage also failed/skipped.");
           }
        } else {
          setErrorLoading(t('edit_invoice_error_scan_results_not_found_firestore_pending', { tempId: initialTempInvoiceId}));
          setCurrentDialogStep('error_loading');
        }
      } catch (firestoreError) {
        setErrorLoading(t('edit_invoice_error_loading_existing'));
        setCurrentDialogStep('error_loading');
      }
    }

    let initialProductsFromScanData: EditableProduct[] = [];

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
      }
      
      setDisplayedOriginalImageUrl(pendingDocData.originalImagePreviewUri || null);
      setDisplayedCompressedImageUrl(pendingDocData.compressedImageForFinalRecordUri || null);
      
      const generalErrorFromPendingDoc = pendingDocData.errorMessage;
      if (generalErrorFromPendingDoc) {
          setScanProcessErrorState(prev => prev ? `${prev}; FIRESTORE_DOC_ERROR: ${generalErrorFromPendingDoc}` : `FIRESTORE_DOC_ERROR: ${generalErrorFromPendingDoc}`);
      }
    }
    
    if (scanResultJsonFromStorage && typeof scanResultJsonFromStorage === 'string') {
      try {
        const parsedScanResult = JSON.parse(scanResultJsonFromStorage);
        if (docTypeParam === 'deliveryNote' && parsedScanResult && 'products' in parsedScanResult && Array.isArray(parsedScanResult.products)) {
            initialProductsFromScanData = parsedScanResult.products.map((p: AIScannedProduct | Product, index: number) => ({
                id: (p as Product).id || (p as EditableProduct)._originalId || `prod-temp-${Date.now()}-${index}`,
                _originalId: (p as Product).id || (p as EditableProduct)._originalId || `prod-temp-${Date.now()}-${index}`,
                userId: user.id,
                catalogNumber: p.catalogNumber || 'N/A',
                description: (p as AIScannedProduct).product_name || (p as Product).description || 'N/A',
                shortName: p.shortName || (p as AIScannedProduct).short_product_name || (p as AIScannedProduct).product_name?.substring(0,20) || 'N/A',
                quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                unitPrice: (p as AIScannedProduct).purchase_price !== undefined ? Number((p as AIScannedProduct).purchase_price) : (p as Product).unitPrice !== undefined ? Number((p as Product).unitPrice) : 0,
                lineTotal: p.lineTotal !== undefined ? Number(p.lineTotal) : ((typeof p.quantity === 'number' ? p.quantity : 0) * ((p as AIScannedProduct).purchase_price !== undefined ? Number((p as AIScannedProduct).purchase_price) : (p as Product).unitPrice !== undefined ? Number((p as Product).unitPrice) : 0)),
                salePrice: undefined, // Explicitly undefined for new delivery notes initially
                minStockLevel: (p as Product).minStockLevel === undefined ? null : Number((p as Product).minStockLevel),
                maxStockLevel: (p as Product).maxStockLevel === undefined ? null : Number((p as Product).maxStockLevel),
                imageUrl: (p as Product).imageUrl === undefined ? null : (p as Product).imageUrl,
            }));
        } else if (docTypeParam === 'invoice' && parsedScanResult) {
          const taxScan = parsedScanResult as ScanTaxInvoiceOutput;
          const updatedTaxDetails = { 
            supplierName: editableTaxInvoiceDetails.supplierName || taxScan.supplierName || null,
            invoiceNumber: editableTaxInvoiceDetails.invoiceNumber || taxScan.invoiceNumber || null,
            totalAmount: editableTaxInvoiceDetails.totalAmount ?? taxScan.totalAmount ?? null,
            invoiceDate: editableTaxInvoiceDetails.invoiceDate || taxScan.invoiceDate || null,
            paymentMethod: editableTaxInvoiceDetails.paymentMethod || taxScan.paymentMethod || null,
          };
          setEditableTaxInvoiceDetails(updatedTaxDetails);
          setInitialScannedTaxDetails(updatedTaxDetails); 
          localAiScannedSupplierName = updatedTaxDetails.supplierName || localAiScannedSupplierName;
          setAiScannedSupplierNameFromStorage(localAiScannedSupplierName);
        }
        const generalErrorFromScanJson = parsedScanResult?.error; 
        if (generalErrorFromScanJson) {
             const errorString = typeof generalErrorFromScanJson === 'object' ? JSON.stringify(generalErrorFromScanJson) : String(generalErrorFromScanJson);
             setScanProcessErrorState(prev => prev ? `${prev}; AI_SCAN_JSON_ERROR: ${errorString}` : `AI_SCAN_JSON_ERROR: ${errorString}`);
        }
      } catch (jsonError) {
        const parseErrorMsg = t('edit_invoice_toast_error_loading_desc_invalid_format');
        setScanProcessErrorState(prev => prev ? `${prev}; ${parseErrorMsg}` : parseErrorMsg);
        setErrorLoading(parseErrorMsg); 
        setCurrentDialogStep('error_loading');
      }
    } else if (currentIsNewScanVal && !scanResultJsonFromStorage && docTypeParam === 'deliveryNote') {
         if(localStorageScanDataMissingParam){
             toast({ title: t('edit_invoice_toast_scan_data_missing_title'), description: t('edit_invoice_toast_scan_data_missing_desc_ls_fail_critical'), variant: "warning", duration: 7000 });
         }
    } else if (currentIsNewScanVal && !scanResultJsonFromStorage) { // If no JSON from Firestore and new scan
         setErrorLoading(t('edit_invoice_error_scan_results_not_found_key_both', {tempId: initialTempInvoiceId || 'N/A', key: 'N/A'}));
         setCurrentDialogStep('error_loading');
    }
    
    setProducts(initialProductsFromScanData);
    setInitialScannedProducts(initialProductsFromScanData);
    setProductsForNextStep(initialProductsFromScanData);

    if (currentIsNewScanVal && currentDialogStep !== 'error_loading') { 
      await startDialogFlowForNewScan(localAiScannedSupplierName, initialProductsFromScanData);
    } else if (!currentIsNewScanVal && !errorLoading) { 
        setIsViewMode(true); 
        setCurrentDialogStep('ready_to_save'); 
    }
    setInitialDataLoaded(true);
    setIsLoading(false);
    console.log("[EditInvoice][loadData] Finished. Current Dialog Step after load:", currentDialogStep);
  }, [
      user?.id, authLoading, searchParams, t, toast, router,
      docTypeParam, initialTempInvoiceId, initialInvoiceIdParam, localStorageScanDataMissingParam, // Memoized params from searchParams
      startDialogFlowForNewScan, // Memoized function
      // All state setters are removed from here
    ]);


  useEffect(() => {
    if(user && user.id && !authLoading) {
      // Condition to run loadData only once unless specific params change or refresh is requested
      if(!initialDataLoaded || searchParams.get('refresh') === 'true' || (initialTempInvoiceId && !pendingDocData?.id) || (initialInvoiceIdParam && pendingDocData?.id !== initialInvoiceIdParam) ) {
        loadData();
        if(searchParams.get('refresh') === 'true'){
             const newParams = new URLSearchParams(searchParams.toString());
             newParams.delete('refresh');
             router.replace(`${window.location.pathname}?${newParams.toString()}`, {scroll: false});
        }
      }
    } else if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, initialDataLoaded, loadData, searchParams, router, initialTempInvoiceId, initialInvoiceIdParam, pendingDocData?.id]); // Added pendingDocData for better control on reruns


  useEffect(() => {
    // This effect manages which dialog component should be considered "open"
    // based on the currentDialogStep.
    // It also handles cleanup of dialog-specific states when they are no longer active.
    console.log(`[EditInvoice] Dialog effect triggered. currentDialogStep: ${currentDialogStep}`);
    // Cleanup other dialog related states if not in their respective steps
    if (currentDialogStep !== 'supplier_confirmation') {
        setPotentialSupplierName(undefined);
    }
    if (currentDialogStep !== 'price_discrepancy') {
        setPriceDiscrepancies(null);
    }
    if (currentDialogStep !== 'new_product_details') {
      setProductsToDisplayForNewDetails([]); 
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
    } else {
        finalConfirmedName = aiScannedSupplierNameFromStorage || initialScannedTaxDetails.supplierName || null;
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
    }
    setIsSupplierConfirmed(true); 
    processNextDialogStep('supplier_confirmed');
  }, [user?.id, t, toast, aiScannedSupplierNameFromStorage, initialScannedTaxDetails.supplierName, processNextDialogStep]);

  const handlePaymentDueDateConfirm = useCallback((dueDate: string | Date | Timestamp | undefined) => {
    setSelectedPaymentDueDate(dueDate);
    setIsPaymentDueDateDialogSkipped(false); 
    setEditableTaxInvoiceDetails(prev => ({ ...prev, paymentDueDate: dueDate }));
    processNextDialogStep('payment_due_date_confirmed');
  }, [processNextDialogStep]);

  const handleCancelPaymentDueDate = useCallback(() => {
    setSelectedPaymentDueDate(undefined);
    setIsPaymentDueDateDialogSkipped(true); 
    setEditableTaxInvoiceDetails(prev => ({ ...prev, paymentDueDate: undefined })); 
    processNextDialogStep('payment_due_date_skipped');
  }, [processNextDialogStep]);

   const handleNewProductDetailsComplete = useCallback((updatedNewProductsFromDialog: EditableProduct[] | null) => {
     let finalProductsForSave: EditableProduct[];
      if (updatedNewProductsFromDialog === null) { // Dialog was cancelled/skipped entirely
          finalProductsForSave = productsForNextStep.length > 0 ? productsForNextStep : products;
          console.log("[EditInvoice][handleNewProductDetailsComplete] Dialog cancelled/skipped. Using existing productsForNextStep or products. Count:", finalProductsForSave.length);
      } else if (updatedNewProductsFromDialog.length > 0) {
          const baseProducts = (productsForNextStep.length > 0 && isNewScan) ? productsForNextStep : initialScannedProducts;
          const updatedMap = new Map(updatedNewProductsFromDialog.map(p => [p._originalId || p.id, p]));
          finalProductsForSave = baseProducts.map(originalP => {
              const idToMatch = originalP._originalId || originalP.id;
              const updatedPData = updatedMap.get(idToMatch);
              if (updatedPData) {
                  return { ...originalP, barcode: updatedPData.barcode || originalP.barcode, salePrice: updatedPData.salePrice, id: originalP.id };
              }
              return originalP;
          });
          console.log("[EditInvoice][handleNewProductDetailsComplete] Dialog confirmed. Merged updated products. Count:", finalProductsForSave.length);
      } else { // Dialog confirmed but no products returned (e.g., all were skipped one by one inside the dialog)
          finalProductsForSave = (productsForNextStep.length > 0 && isNewScan) ? productsForNextStep : products;
          console.log("[EditInvoice][handleNewProductDetailsComplete] Dialog confirmed with no new details provided (all skipped individually). Using existing. Count:", finalProductsForSave.length);
      }
     
     setProductsForNextStep(finalProductsForSave); 
     setProducts(finalProductsForSave.map(p => ({...p, _originalId: p.id || p._originalId})));
     setProductsToDisplayForNewDetails([]); 
     setCurrentDialogStep('ready_to_save');
   }, [products, productsForNextStep, initialScannedProducts, isNewScan]);

  const handlePriceConfirmationComplete = useCallback(async (resolvedProducts: EditableProduct[] | null) => {
    setPriceDiscrepancies(null); 
    processNextDialogStep('price_discrepancy_complete', resolvedProducts);
  }, [processNextDialogStep]);

  const proceedWithFinalSave = useCallback(async (finalProductsToSave: EditableProduct[]) => {
    if (!user?.id || !docTypeParam) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), description: t("edit_invoice_user_not_authenticated_desc"), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        return; 
    }
    
    let finalDocumentRecord: InvoiceHistoryItem | null = null;

    try {
        const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => rest as Product);
        let finalFileNameForSave = originalFileName;
        const finalSupplierNameForSave = editableTaxInvoiceDetails.supplierName;
        const finalInvoiceNumberForSave = editableTaxInvoiceDetails.invoiceNumber;
        let finalTotalAmountForSave = editableTaxInvoiceDetails.totalAmount;
        
        if(docTypeParam === 'deliveryNote' && productsForService.length > 0 && (finalTotalAmountForSave === null || finalTotalAmountForSave === 0)){
            finalTotalAmountForSave = productsForService.reduce((sum, p) => sum + (p.lineTotal || 0), 0);
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
          setIsViewMode(true); setCurrentDialogStep('idle'); 
           toast({
              title: docTypeParam === 'deliveryNote' ? t('edit_invoice_toast_products_saved_title') : t('edit_invoice_toast_invoice_details_saved_title'),
              description: docTypeParam === 'deliveryNote' ? t('edit_invoice_toast_products_saved_desc') : t('edit_invoice_toast_invoice_details_saved_desc'),
          });
          if (docTypeParam === 'deliveryNote') router.push('/inventory?refresh=true');
          else if (docTypeParam === 'invoice') router.push('/invoices?tab=scanned-docs&refresh=true'); 
        } else {
           setScanProcessErrorState(t('edit_invoice_toast_save_failed_desc_finalize', { message: "Final invoice record not returned."}));
           setCurrentDialogStep('error_loading'); 
        }
    } catch (error: any) {
        console.error("[EditInvoice][proceedWithFinalSave] Failed to finalize save:", error);
         if ((error as any).isQuotaError) { 
          toast({ title: t('upload_toast_storage_full_title_critical'), description: t('upload_toast_storage_full_desc_finalize', {context: "(finalize save)"}), variant: "destructive", duration: 10000, });
        } else {
          toast({ title: t('edit_invoice_toast_save_failed_title'), description: t('edit_invoice_toast_save_failed_desc_finalize', { message: (error as Error).message || t('edit_invoice_try_again')}), variant: "destructive", });
        }
        if (finalDocumentRecord && finalDocumentRecord.id) {
            setIsViewMode(true);
            setOriginalFileName(finalDocumentRecord.generatedFileName || finalDocumentRecord.originalFileName || t('edit_invoice_unknown_document'));
            setEditableTaxInvoiceDetails({
                supplierName: finalDocumentRecord.supplierName, invoiceNumber: finalDocumentRecord.invoiceNumber,
                totalAmount: finalDocumentRecord.totalAmount, invoiceDate: finalDocumentRecord.invoiceDate,
                paymentMethod: finalDocumentRecord.paymentMethod, paymentDueDate: finalDocumentRecord.paymentDueDate,
            });
        } else setCurrentDialogStep('error_loading'); 
    }
  }, [
      user?.id, docTypeParam, originalFileName, editableTaxInvoiceDetails, selectedPaymentDueDate,
      initialTempInvoiceId, searchParams, displayedOriginalImageUrl, displayedCompressedImageUrl,
      isNewScan, cleanupTemporaryData, t, toast, router, initialInvoiceIdParam
    ]);

  const proceedWithActualSave = useCallback(async (productsToSave: EditableProduct[]) => {
    if (!user?.id || !docTypeParam) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        return;
    }
    
    let currentProductsToProcess = [...productsToSave];
    try {
        if(docTypeParam === 'deliveryNote' && currentProductsToProcess.length > 0) {
            const priceCheckResult = await checkProductPricesBeforeSaveService(currentProductsToProcess, user.id);
            if (priceCheckResult.priceDiscrepancies.length > 0) {
                setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
                const productsForDiscrepancyDialog = priceCheckResult.productsToSaveDirectly.concat(
                    priceCheckResult.priceDiscrepancies.map(d => ({ ...d, unitPrice: d.newUnitPrice, salePrice: d.salePrice, }))
                ).map(p => ({...p} as EditableProduct));
                setProductsForNextStep(productsForDiscrepancyDialog); 
                setCurrentDialogStep('price_discrepancy');
                return; 
            }
            currentProductsToProcess = priceCheckResult.productsToSaveDirectly.map(p => ({...p} as EditableProduct)); 
        }
        await proceedWithFinalSave(currentProductsToProcess);
    } catch (error) {
        toast({ title: t('edit_invoice_toast_error_preparing_save_title'), description: t('edit_invoice_toast_error_preparing_save_desc', { message: (error as Error).message}), variant: "destructive",});
        setCurrentDialogStep('error_loading');
    } finally {
       if (currentDialogStep !== 'price_discrepancy' && currentDialogStep !== 'new_product_details') setIsSaving(false);
    }
  }, [user?.id, docTypeParam, t, toast, proceedWithFinalSave, currentDialogStep]);


 const handleSaveChecks = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true); 
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        setIsSaving(false); 
        return;
    }
    if (isNewScan && currentDialogStep !== 'ready_to_save') {
        processNextDialogStep(`manual_advance_from_${currentDialogStep}`);
        // setIsSaving will be reset in processNextDialogStep or its subsequent effects if it doesn't lead to save
        return;
    }
    await proceedWithActualSave(productsForNextStep.length > 0 ? productsForNextStep : products);
}, [
    isSaving, user?.id, t, toast, isNewScan, currentDialogStep,
    processNextDialogStep, productsForNextStep, products, proceedWithActualSave
]);


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
  }, []);

  const handleTaxInvoiceDetailsChange = useCallback((field: keyof EditableTaxInvoiceDetails, value: string | number | undefined | Date | Timestamp) => {
     setEditableTaxInvoiceDetails(prev => ({ ...prev, [field]: value === '' ? null : value }));
  }, []);

  const handleAddRow = useCallback(() => {
    const newProduct: EditableProduct = {
      id: `prod-temp-${Date.now()}-new`, _originalId: `prod-temp-${Date.now()}-new`, 
      userId: user?.id || 'unknown', catalogNumber: '', description: '', quantity: 0, unitPrice: 0,
      lineTotal: 0, barcode: null, minStockLevel: null, maxStockLevel: null, salePrice: null, imageUrl: null,
    };
    setProducts(prevProducts => [...prevProducts, newProduct]);
  }, [user?.id]);

  const handleRemoveRow = useCallback((id: string) => {
    setProducts(prevProducts => prevProducts.filter(product => product.id !== id));
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
    setProducts(initialScannedProducts.map(p => ({...p}))); setIsEditingDeliveryNoteProducts(false);
  }, [initialScannedProducts]);

  const handleSaveEditProducts = useCallback(() => {
    setInitialScannedProducts(products.map(p => ({...p}))); setIsEditingDeliveryNoteProducts(false);
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
                    <AlertTitleComponent>{t('edit_invoice_error_loading_title')}</AlertTitleComponent>
                    <AlertDescriptionComponent>{errorLoading || "An unknown error occurred."}</AlertDescriptionComponent>
                </Alert>
                <Button variant="outline" onClick={handleGoBack}>
                   <ArrowLeft className="mr-2 h-4 w-4" /> {t('edit_invoice_go_back_button')}
                </Button>
            </div>
        );
    }

    const showManualEntryPrompt = !isNewScan && 
        currentDialogStep !== 'error_loading' && !isLoading &&
        ((docTypeParam === 'deliveryNote' && products.length === 0 && !scanProcessErrorState) ||
         (docTypeParam === 'invoice' && Object.values(editableTaxInvoiceDetails).every(val => val === undefined || val === '' || val === 0 || val === null) && !scanProcessErrorState && !errorLoading && !initialTempInvoiceId && !initialInvoiceIdParam )
        );

    if ((!initialTempInvoiceId && !initialInvoiceIdParam && !isNewScan) || (showManualEntryPrompt && !isLoading && !isNewScan)) { 
         return (
             <div className="container mx-auto p-4 md:p-8 space-y-4">
                 {scanProcessErrorState && (
                    <Alert variant="destructive">
                        <AlertTitleComponent>{t('edit_invoice_scan_process_error_title')}</AlertTitleComponent>
                        <AlertDescriptionComponent>
                            {t('edit_invoice_scan_process_error_desc', { error: scanProcessErrorState })}
                        </AlertDescriptionComponent>
                    </Alert>
                 )}
                 {!scanProcessErrorState && docTypeParam === 'deliveryNote' && products.length === 0 && (!initialTempInvoiceId && !initialInvoiceIdParam) && (
                     <Alert variant="default">
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
                             <React.Fragment>
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
                            <React.Fragment>
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
        const detailsToDisplay = isViewMode ? initialScannedTaxDetails : editableTaxInvoiceDetails;
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
                <Input id="taxSupplierName" value={editableTaxInvoiceDetails.supplierName || ''} onChange={(e) => handleTaxInvoiceDetailsChange('supplierName', e.target.value)} disabled={isSaving || isViewMode} />
            </div>
            <div>
                <Label htmlFor="taxInvoiceNumber">{t('invoice_details_invoice_number_label')}</Label>
                <Input id="taxInvoiceNumber" value={editableTaxInvoiceDetails.invoiceNumber || ''} onChange={(e) => handleTaxInvoiceDetailsChange('invoiceNumber', e.target.value)} disabled={isSaving || isViewMode} />
            </div>
            <div>
                <Label htmlFor="taxTotalAmount">{t('invoice_details_total_amount_label')}</Label>
                <Input id="taxTotalAmount" type="number" value={editableTaxInvoiceDetails.totalAmount ?? ''} onChange={(e) => handleTaxInvoiceDetailsChange('totalAmount', e.target.value === '' ? undefined : parseFloat(e.target.value))} disabled={isSaving || isViewMode} />
            </div>
            <div>
                <Label htmlFor="taxInvoiceDate">{t('invoice_details_invoice_date_label')}</Label>
                <Input
                    id="taxInvoiceDate" 
                    type="date" 
                    value={editableTaxInvoiceDetails.invoiceDate ? (editableTaxInvoiceDetails.invoiceDate instanceof Timestamp ? format(editableTaxInvoiceDetails.invoiceDate.toDate(), 'yyyy-MM-dd') : (typeof editableTaxInvoiceDetails.invoiceDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate)) ? format(parseISO(editableTaxInvoiceDetails.invoiceDate), 'yyyy-MM-dd') : (editableTaxInvoiceDetails.invoiceDate instanceof Date && isValid(editableTaxInvoiceDetails.invoiceDate) ? format(editableTaxInvoiceDetails.invoiceDate, 'yyyy-MM-dd') : ''))) : ''} 
                    onChange={(e) => handleTaxInvoiceDetailsChange('invoiceDate', e.target.value ? parseISO(e.target.value).toISOString() : undefined)} 
                    disabled={isSaving || isViewMode} />
            </div>
            <div>
                <Label htmlFor="taxPaymentMethod">{t('invoice_details_payment_method_label')}</Label>
                 <Select 
                    value={editableTaxInvoiceDetails.paymentMethod || ''} 
                    onValueChange={(value) => handleTaxInvoiceDetailsChange('paymentMethod', value)}
                    disabled={isSaving || isViewMode}
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
                        setSelectedPaymentDueDate(newDate); // Update this state for the dialog
                        handleTaxInvoiceDetailsChange('paymentDueDate', newDate ? newDate.toISOString() : undefined);
                    }} 
                    disabled={isSaving || isViewMode} />
            </div>
        </div>
    );

    const renderEditableProductTable = () => (
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
        <Card className="shadow-md scale-fade-in overflow-hidden">
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
                {!isViewMode && (docTypeParam === 'invoice' || docTypeParam === 'deliveryNote') && (
                     <Button variant="ghost" size="icon" onClick={toggleEditTaxDetails} className="h-8 w-8 text-muted-foreground hover:text-primary flex-shrink-0">
                         {isEditingTaxDetails ? <Save className="h-4 w-4 text-green-600" /> : <Edit className="h-4 w-4" />}
                        <span className="sr-only">{isEditingTaxDetails ? t('save_button') : t('edit_button')} {t('invoice_details_title')}</span>
                     </Button>
                )}
            </CardHeader>
            <CardContent className="p-4 space-y-4">
                {scanProcessErrorState && !isSaving && (
                    <Alert variant="destructive" className="mt-2">
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
                     <div className="md:col-span-1 space-y-3">
                        {isEditingTaxDetails ? renderEditableTaxInvoiceDetails() : renderReadOnlyTaxInvoiceDetails()}
                     </div>
                </div>
                 <div className="mt-6">
                    {docTypeParam === 'deliveryNote' && (
                        <React.Fragment>
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
                      {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {t('edit_invoice_confirm_and_save_button')}</>}
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

