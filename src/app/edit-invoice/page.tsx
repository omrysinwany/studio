
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
    getStorageKey,
    InvoiceHistoryItem,
    getInvoicesService,
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
  
  const [initialDataKey, setInitialDataKey] = useState<string | null>(null); // localStorage key, less used now
  const [initialTempInvoiceId, setInitialTempInvoiceId] = useState<string | null>(null); // Firestore pending doc ID
  
  const [documentType, setDocumentType] = useState<'deliveryNote' | 'invoice' | null>(null);

  const [isViewMode, setIsViewMode] = useState(true);
  const [isEditingTaxDetails, setIsEditingTaxDetails] = useState(false);
  const [isEditingDeliveryNoteProducts, setIsEditingDeliveryNoteProducts] = useState(false);

  const [isNewScan, setIsNewScan] = useState(false);

  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] = useState<EditableTaxInvoiceDetails>({});
  const [initialScannedTaxDetails, setInitialScannedTaxDetails] = useState<EditableTaxInvoiceDetails>({});
  
  const [displayedOriginalImageUrl, setDisplayedOriginalImageUrl] = useState<string | null>(null);
  const [displayedCompressedImageUrl, setDisplayedCompressedImageUrl] = useState<string | null>(null);

  // Dialog Flow State Management
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
    // The primary cleanup should now be deleting the pending Firestore document if it's no longer needed,
    // OR marking it as processed/finalized so it's not picked up as "pending" again.
    // For localStorage, we only clear the scan result JSON if it was even used as a fallback.
    const keyFromParams = searchParams.get('key'); // dataKeyForLocalStorageJson from upload page
    if (keyFromParams) {
        try {
            localStorage.removeItem(keyFromParams);
            console.log(`[EditInvoice][cleanupTemporaryData] Cleared localStorage scan result JSON for key: ${keyFromParams}`);
        } catch (e) {
            console.error(`[EditInvoice][cleanupTemporaryData] Error removing localStorage key ${keyFromParams}:`, e);
        }
    }
    // No need to clear image keys as they are not passed via localStorage anymore.
    // The pending Firestore document (tempInvoiceId) should be deleted or updated to 'completed' status by finalizeSaveProductsService.
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
        processNextDialogStep('supplier_existing_or_empty'); 
    }
  }, [/* processNextDialogStep must be added if defined earlier with useCallback*/]); 


  const checkForNewProductsAndDetails = useCallback(async (productsToCheck: Product[]) => {
    console.log(`[EditInvoice][checkForNewProductsAndDetails] Called. Products to check count: ${productsToCheck.length}`);
    if (!user?.id) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), description: t("edit_invoice_user_not_authenticated_desc"), variant: "destructive" });
        return {needsReview: false, productsForReview: []};
    }

    if (documentType !== 'deliveryNote' || productsToCheck.length === 0) {
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
            
            const needsSalePriceReview = p.salePrice === undefined || p.salePrice === null; 
            
            console.log(`[EditInvoice][checkForNewProductsAndDetails] Product: ${p.shortName || p.id}, isExisting: ${isExistingProduct}, needsSalePriceReview: ${needsSalePriceReview}`);
            if (!isExistingProduct) return true; 
            return needsSalePriceReview; 
        });
        console.log("[EditInvoice][checkForNewProductsAndDetails] Products needing details review count:", productsRequiringDetailsReview.length);
        
        const initialInputStatesForPrompt: Record<string, ProductInputState> = {};
        productsRequiringDetailsReview.forEach(p => {
            const pId = p.id || p._originalId || `temp-id-${Math.random().toString(36).substring(2,9)}`;
            initialInputStatesForPrompt[pId] = { 
                barcode: productInputStates[pId]?.barcode || p.barcode || '', 
                salePrice: productInputStates[pId]?.salePrice ?? p.salePrice,
                salePriceMethod: productInputStates[pId]?.salePriceMethod || (p.salePrice !== undefined ? 'manual' : 'percentage'),
                profitPercentage: productInputStates[pId]?.profitPercentage || ''
            };
        });
        setProductInputStates(prev => ({...prev, ...initialInputStatesForPrompt})); 
        
        if (productsRequiringDetailsReview.length > 0) {
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
  }, [user?.id, documentType, toast, t, productInputStates]);


  const startDialogFlowForNewScan = useCallback(async (scannedSupplierFromStorage: string | null | undefined, initialProductsFromScan: Product[]) => {
    console.log("[EditInvoice][startDialogFlowForNewScan] Called. Scanned supplier from storage:", scannedSupplierFromStorage, "isNewScan:", isNewScan, "user ID:", user?.id);
    if (!isNewScan || !user?.id ) {
        console.log("[EditInvoice][startDialogFlowForNewScan] Conditions not met (not a new scan or no user). Setting dialog step to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }
    
    setIsLoading(true);
    setCurrentDialogStep('idle'); 
    setProductsForNextStep(initialProductsFromScan || []); 

    try {
        console.log("[EditInvoice][startDialogFlowForNewScan] Fetching suppliers for user:", user.id);
        const fetchedSuppliersList = await getSupplierSummariesService(user.id);
        console.log("[EditInvoice][startDialogFlowForNewScan] Fetched suppliers count:", fetchedSuppliersList.length);
        await _internalCheckSupplier(scannedSupplierFromStorage, user.id, fetchedSuppliersList);
    } catch (error) {
        console.error("[EditInvoice][startDialogFlowForNewScan] Error fetching suppliers:", error);
        toast({
          title: t('error_title'),
          description: `${t('edit_invoice_toast_error_fetching_suppliers')} ${(error instanceof Error ? `(${error.message})` : '')}`,
          variant: "destructive"
        });
        setIsSupplierConfirmed(true); 
        processNextDialogStep('supplier_fetch_error');
    } finally {
        setIsLoading(false);
    }
  }, [isNewScan, user?.id, toast, t, _internalCheckSupplier /* processNextDialogStep needs to be a dependency if used directly */ ]);


  const processNextDialogStep = useCallback(async (previousStepOutcome: string, data?: any) => {
    console.log(`[EditInvoice][processNextDialogStep] Current Step BEFORE: ${currentDialogStep}, From Outcome:`, previousStepOutcome, "Data passed:", data, "isNewScan:", isNewScan, "DocType:", documentType);
    if (!isNewScan || !user?.id) {
        console.log("[EditInvoice][processNextDialogStep] Not a new scan or no user. Setting dialog step to ready_to_save.");
        setCurrentDialogStep('ready_to_save');
        return;
    }

    let currentProductsForCheck = productsForNextStep.length > 0 ? productsForNextStep : products;

    switch (currentDialogStep) {
        case 'idle': 
        case 'supplier_confirmation': 
        case 'supplier_existing_or_empty':
        case 'supplier_fetch_error':
            if (isNewScan && (documentType === 'deliveryNote' || documentType === 'invoice') && !selectedPaymentDueDate && !isPaymentDueDateDialogSkipped) {
                console.log("[EditInvoice][processNextDialogStep] From supplier/idle, moving to payment_due_date dialog.");
                setCurrentDialogStep('payment_due_date');
            } else {
                console.log("[EditInvoice][processNextDialogStep] From supplier/idle. Payment due date step skipped or completed. DocType:", documentType);
                if (documentType === 'deliveryNote' && currentProductsForCheck.length > 0) {
                    const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
                    if (reviewResult.needsReview) {
                        setPromptingForNewProductDetails(reviewResult.productsForReview);
                        setCurrentDialogStep('new_product_details');
                    } else {
                        setCurrentDialogStep('ready_to_save');
                    }
                } else {
                    setCurrentDialogStep('ready_to_save');
                }
            }
            break;

        case 'payment_due_date':
            console.log("[EditInvoice][processNextDialogStep] From payment_due_date. Outcome:", previousStepOutcome);
            if (documentType === 'deliveryNote' && currentProductsForCheck.length > 0) {
                const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
                if (reviewResult.needsReview) {
                    setPromptingForNewProductDetails(reviewResult.productsForReview);
                    setCurrentDialogStep('new_product_details');
                } else {
                    setCurrentDialogStep('ready_to_save');
                }
            } else {
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
            
            if (documentType === 'deliveryNote' && currentProductsForCheck.length > 0) {
                const reviewResult = await checkForNewProductsAndDetails(currentProductsForCheck);
                 if (reviewResult.needsReview) {
                    setPromptingForNewProductDetails(reviewResult.productsForReview);
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
            console.log(`[EditInvoice][processNextDialogStep] In step ${currentDialogStep}. No further automatic progression from here.`);
            break;
        default:
            console.warn(`[EditInvoice][processNextDialogStep] Unhandled currentDialogStep '${currentDialogStep}' with outcome '${previousStepOutcome}'. Defaulting to ready_to_save.`);
            setCurrentDialogStep('ready_to_save');
            break;
    }
  }, [currentDialogStep, isNewScan, user?.id, documentType, products, productsForNextStep, selectedPaymentDueDate, isPaymentDueDateDialogSkipped, t, toast, checkForNewProductsAndDetails]);
  
  useEffect(() => {
    if (currentDialogStep === 'idle' && isNewScan && user?.id && !isLoading && initialDataLoaded && 
        (aiScannedSupplierNameFromStorage !== undefined || initialScannedTaxDetails.supplierName !== undefined) &&
        (initialScannedProducts.length > 0 || documentType === 'invoice')
        ) {
        console.log("[EditInvoice] useEffect for starting dialog flow. aiScannedSupplierNameFromStorage:", aiScannedSupplierNameFromStorage, "initialScannedTaxDetails.supplierName:", initialScannedTaxDetails.supplierName);
        startDialogFlowForNewScan(aiScannedSupplierNameFromStorage || initialScannedTaxDetails.supplierName, initialScannedProducts);
    }
  }, [currentDialogStep, isNewScan, user?.id, isLoading, initialDataLoaded, aiScannedSupplierNameFromStorage, initialScannedTaxDetails.supplierName, initialScannedProducts, startDialogFlowForNewScan, documentType]);
  

  const loadData = useCallback(async () => {
    console.log("[EditInvoice][loadData] Initiated.");
    if (!user || !searchParams || !user.id) {
        console.warn("[EditInvoice][loadData] User, searchParams, or user.id missing. Aborting.");
        setIsLoading(false);
        setErrorLoading(t('edit_invoice_user_not_authenticated_title'));
        setCurrentDialogStep('error_loading');
        return;
    }
    
    console.log("[EditInvoice][loadData] Started for user:", user.id);
    setIsLoading(true);
    setErrorLoading(null);
    setScanProcessErrorState(null);
    
    const keyParam = searchParams.get('key'); // From localStorage (fallback for scan JSON)
    const nameParam = searchParams.get('fileName'); // Original file name
    const tempInvIdParam = searchParams.get('tempInvoiceId'); // Firestore pending doc ID
    const docTypeParam = searchParams.get('docType') as 'deliveryNote' | 'invoice' | null;
    const invoiceIdParam = searchParams.get('invoiceId'); // Final Firestore doc ID (for existing records)
    const localStorageScanDataMissingParam = searchParams.get('localStorageScanDataMissing') === 'true';


    const newScanFlag = !invoiceIdParam && !!(tempInvIdParam);
    setIsNewScan(newScanFlag);
    console.log(`[EditInvoice][loadData] Flags: isNewScan: ${newScanFlag}, docTypeParam: ${docTypeParam}, keyParam(LS): ${keyParam}, tempInvIdParam(FS): ${tempInvIdParam}, invoiceIdParam(FS final): ${invoiceIdParam}`);

    if (newScanFlag) {
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

    setInitialDataKey(keyParam);
    setInitialTempInvoiceId(tempInvIdParam);
    setDocumentType(docTypeParam);

    if (nameParam) {
      setOriginalFileName(decodeURIComponent(nameParam));
    } else if (!invoiceIdParam) {
        setOriginalFileName(t('edit_invoice_unknown_document'));
    }
    
    if (invoiceIdParam) { 
        console.log(`[EditInvoice][loadData] Loading existing FINAL invoice ID: ${invoiceIdParam}`);
        try {
            const allUserInvoices = await getInvoicesService(user.id);
            const inv = allUserInvoices.find(i => i.id === invoiceIdParam);
            if (inv) {
                console.log("[EditInvoice][loadData] Existing final invoice found:", inv);
                setOriginalFileName(inv.generatedFileName || inv.originalFileName);
                setDocumentType(inv.documentType as 'deliveryNote' | 'invoice' | null);
                
                const taxDetails = {
                    supplierName: inv.supplierName || null,
                    invoiceNumber: inv.invoiceNumber || null,
                    totalAmount: inv.totalAmount ?? null,
                    invoiceDate: inv.invoiceDate || null,
                    paymentMethod: inv.paymentMethod || null,
                };
                setEditableTaxInvoiceDetails(taxDetails);
                setInitialScannedTaxDetails(taxDetails);

                setSelectedPaymentDueDate(inv.paymentDueDate ? (inv.paymentDueDate instanceof Timestamp ? inv.paymentDueDate.toDate() : (typeof inv.paymentDueDate === 'string' && isValid(parseISO(inv.paymentDueDate)) ? parseISO(inv.paymentDueDate) : undefined)) : undefined);
                setDisplayedOriginalImageUrl(inv.originalImagePreviewUri || null); 
                setDisplayedCompressedImageUrl(inv.compressedImageForFinalRecordUri || null);
                
                let fetchedProducts: Product[] = [];
                if (inv.documentType === 'deliveryNote' && db) {
                    const productsCollectionRef = collection(db, INVENTORY_COLLECTION);
                    const lineItemsQuery = query(productsCollectionRef, where("userId", "==", user.id), where("linkedDocumentId", "==", inv.id)); // Hypothetical field
                    // This is simplified. In reality, you'd fetch from a subcollection or based on a list of product IDs stored on the invoice.
                    // For now, let's assume products related to a *finalized* delivery note are fetched via general inventory and filtered/identified.
                    // Or, if no explicit line items stored with doc, you might fetch all inventory and try to match.
                    // This part needs a more robust way to link specific *versions* of products to a past delivery note.
                    // For simplicity, we'll fetch all and user has to "know" which ones were part of it, or we just show current inventory.
                    // For now, let's assume `getProductsService(user.id, inv.id)` would fetch products specifically linked to this invoice (needs backend change).
                    // Since such service doesn't exist, we'll keep products empty for existing delivery notes for now to avoid confusion.
                    console.warn("[EditInvoice][loadData] Viewing existing deliveryNote. Product line items not directly fetched from this document yet. Manual review of inventory required if needed.");
                }
                const productsWithSalePriceHandling = fetchedProducts.map(p => ({ ...p, salePrice: p.salePrice === null ? undefined : p.salePrice, _originalId: p.id }));
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
                const currentDocType = pendingData.documentType as 'deliveryNote' | 'invoice' | null;
                setDocumentType(currentDocType);
                console.log("[EditInvoice][loadData] Document type set to:", currentDocType);

                const taxDetails = {
                    supplierName: pendingData.supplierName || null,
                    invoiceNumber: pendingData.invoiceNumber || null,
                    totalAmount: pendingData.totalAmount ?? null,
                    invoiceDate: pendingData.invoiceDate || null,
                    paymentMethod: pendingData.paymentMethod || null,
                };
                setEditableTaxInvoiceDetails(taxDetails);
                setInitialScannedTaxDetails(taxDetails);
                setAiScannedSupplierNameFromStorage(pendingData.supplierName); // Store AI scanned name for supplier dialog
                console.log("[EditInvoice][loadData] Tax details set. AI Scanned Supplier:", pendingData.supplierName);

                setSelectedPaymentDueDate(pendingData.paymentDueDate ? (pendingData.paymentDueDate instanceof Timestamp ? pendingData.paymentDueDate.toDate() : (typeof pendingData.paymentDueDate === 'string' && isValid(parseISO(pendingData.paymentDueDate)) ? parseISO(pendingData.paymentDueDate) : undefined)) : undefined);
                setDisplayedOriginalImageUrl(pendingData.originalImagePreviewUri || null);
                setDisplayedCompressedImageUrl(pendingData.compressedImageForFinalRecordUri || null);
                
                let initialProductsFromScanData: Product[] = [];
                const rawScanResultJsonFromFirestore = pendingData.rawScanResultJson;

                if (rawScanResultJsonFromFirestore) {
                    try {
                        const productScanData = JSON.parse(rawScanResultJsonFromFirestore) as ScanInvoiceOutput | ScanTaxInvoiceOutput | null;
                        console.log("[EditInvoice][loadData] Parsed rawScanResultJsonFromFirestore:", productScanData);
                        if (currentDocType === 'deliveryNote' && productScanData && 'products' in productScanData && Array.isArray(productScanData.products)) {
                            initialProductsFromScanData = productScanData.products.map((p: Product, index: number) => ({
                                ...p,
                                id: p.id || `prod-temp-${Date.now()}-${index}`, 
                                _originalId: p.id || `prod-temp-${Date.now()}-${index}`,
                                quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                                lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
                                unitPrice: p.unitPrice !== undefined ? (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice))) : 0, 
                                salePrice: undefined, // Explicitly undefined for new scan, will be prompted
                                minStockLevel: p.minStockLevel ?? undefined,
                                maxStockLevel: p.maxStockLevel ?? undefined,
                                imageUrl: p.imageUrl ?? undefined,
                            }));
                            console.log("[EditInvoice][loadData] Initial products set from delivery note scan (Firestore JSON, salePrice reset):", initialProductsFromScanData);
                        } else if (currentDocType === 'invoice') {
                             console.log("[EditInvoice][loadData] Tax invoice, no product list expected from AI scan or already handled at top level fields.");
                        }
                    } catch (jsonError) {
                        console.error("[EditInvoice][loadData] Error parsing rawScanResultJson from Firestore:", jsonError);
                        if (finalScanResult) finalScanResult.error = `Error parsing scan data: ${(jsonError as Error).message}`;
                        else finalScanResult = { error: `Error parsing scan data: ${(jsonError as Error).message}` } as any;
                        setScanProcessErrorState(finalScanResult.error);
                    }
                } else if (localStorageScanDataMissingParam) {
                    // This means Firestore pending doc exists, but explicitly told that localStorage data is missing.
                    // Usually because localStorage.setItem for scan JSON failed (e.g. quota).
                    toast({
                        title: t('edit_invoice_toast_scan_data_missing_title'),
                        description: t('edit_invoice_toast_scan_data_missing_desc_ls_fail'),
                        variant: "warning",
                        duration: 7000
                    });
                    console.warn("[EditInvoice][loadData] localStorageScanDataMissingParam is true. User will need to add items manually for delivery note.");
                }

                setProducts(initialProductsFromScanData);
                setInitialScannedProducts(initialProductsFromScanData);
                setProductsForNextStep(initialProductsFromScanData); 
                
                const generalError = pendingData.errorMessage || (rawScanResultJsonFromFirestore && JSON.parse(rawScanResultJsonFromFirestore).error);
                if (generalError) {
                  setScanProcessErrorState(generalError);
                  console.log("[EditInvoice][loadData] Scan process error from pending data:", generalError);
                }
                // Dialog flow for new scan will be triggered by useEffect watching currentDialogStep and other flags

            } else {
                 console.warn(`[EditInvoice][loadData] PENDING Firestore doc ${tempInvIdParam} not found or permission denied. This shouldn't happen if upload page created it.`);
                 setErrorLoading(t('edit_invoice_error_scan_results_not_found_key', {key: tempInvIdParam || 'unknown'}));
                 setCurrentDialogStep('error_loading');
            }
        } catch (firestoreError) {
            console.error(`[EditInvoice][loadData] Error loading PENDING Firestore doc ${tempInvIdParam}:`, firestoreError);
            setErrorLoading(t('edit_invoice_error_loading_existing'));
            setCurrentDialogStep('error_loading');
        }

    } else if (keyParam && user?.id) { // Fallback for older flow if only localStorage key is present (less likely now)
        console.warn("[EditInvoice][loadData] Loading from localStorage key (fallback, less likely):", keyParam);
        // ... (existing localStorage fallback logic, ensure products' salePrice is undefined for deliveryNote)
        // This path is less critical as we prioritize Firestore pending doc
        let scanResultJsonFromStorage = null;
        try {
            scanResultJsonFromStorage = localStorage.getItem(keyParam);
            if (!scanResultJsonFromStorage) {
                throw new Error(t('edit_invoice_error_scan_results_not_found_key', {key: keyParam}));
            }
            const parsedData = JSON.parse(scanResultJsonFromStorage) as ScanInvoiceOutput | ScanTaxInvoiceOutput | null;
            if (!parsedData) throw new Error(t('edit_invoice_error_invalid_json'));

            if (docTypeParam === 'deliveryNote' && parsedData && 'products' in parsedData) {
                const deliveryNoteData = parsedData as ScanInvoiceOutput;
                const productsWithResetSalePrice = (deliveryNoteData.products || []).map((p, idx) => ({
                    ...p,
                    id: p.id || `prod-temp-ls-${Date.now()}-${idx}`,
                    _originalId: p.id || `prod-temp-ls-${Date.now()}-${idx}`,
                    salePrice: undefined, // Ensure sale price is reset for delivery notes from LS
                }));
                setProducts(productsWithResetSalePrice);
                setInitialScannedProducts(productsWithResetSalePrice);
                setProductsForNextStep(productsWithResetSalePrice);
                const taxDetails = {
                    supplierName: deliveryNoteData.supplier || null,
                    invoiceNumber: deliveryNoteData.invoiceNumber || null,
                    totalAmount: deliveryNoteData.totalAmount ?? null,
                    invoiceDate: deliveryNoteData.invoiceDate || null,
                    paymentMethod: deliveryNoteData.paymentMethod || null,
                };
                setEditableTaxInvoiceDetails(taxDetails);
                setInitialScannedTaxDetails(taxDetails);
                setAiScannedSupplierNameFromStorage(deliveryNoteData.supplier);
            } else if (docTypeParam === 'invoice' && parsedData) {
                const taxInvoiceData = parsedData as ScanTaxInvoiceOutput;
                 const taxDetails = {
                    supplierName: taxInvoiceData.supplierName || null,
                    invoiceNumber: taxInvoiceData.invoiceNumber || null,
                    totalAmount: taxInvoiceData.totalAmount ?? null,
                    invoiceDate: taxInvoiceData.invoiceDate || null,
                    paymentMethod: taxInvoiceData.paymentMethod || null,
                };
                setEditableTaxInvoiceDetails(taxDetails);
                setInitialScannedTaxDetails(taxDetails);
                setAiScannedSupplierNameFromStorage(taxInvoiceData.supplierName);
                setProducts([]); setInitialScannedProducts([]); setProductsForNextStep([]);
            }
            if (parsedData.error) setScanProcessErrorState(parsedData.error);

        } catch (e: any) {
            console.error("[EditInvoice][loadData] Error loading from localStorage fallback:", e);
            setErrorLoading(`${t('edit_invoice_toast_error_loading_desc_invalid_format')}: ${e.message}`);
            setCurrentDialogStep('error_loading');
        }
    } else if (!initialDataLoaded && !invoiceIdParam && !tempInvIdParam && !keyParam) { 
       console.error("[EditInvoice][loadData] No identifiers provided. Cannot determine data source.");
       setErrorLoading(t('edit_invoice_error_no_key_or_id'));
       setCurrentDialogStep('error_loading');
    }
    setIsLoading(false);
    setInitialDataLoaded(true);
    console.log("[EditInvoice][loadData] Finished. Current Dialog Step:", currentDialogStep);
  }, [user, searchParams, t, toast, startDialogFlowForNewScan, _internalCheckSupplier /*Removed initialDataLoaded*/]); 

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
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
        if (isNew) {
            try {
                console.log(`[EditInvoice][handleSupplierConfirmation] Attempting to save new supplier '${finalConfirmedName}' via service.`);
                await updateSupplierContactInfoService(finalConfirmedName, {}, user.id, true); 
                toast({ title: t('edit_invoice_toast_new_supplier_added_title'), description: t('edit_invoice_toast_new_supplier_added_desc', { supplierName: finalConfirmedName }) });
                const fetchedSuppliersList = await getSupplierSummariesService(user.id);
                setExistingSuppliers(fetchedSuppliersList);
            } catch (error: any) {
                console.error("[EditInvoice][handleSupplierConfirmation] Failed to add new supplier:", error);
                const errorMsg = (error.message.includes("already exists")) 
                  ? error.message 
                  : `${t('suppliers_toast_create_fail_desc')} ${(error as Error).message}`;
                toast({ title: t('edit_invoice_toast_fail_add_supplier_title'), description: errorMsg, variant: "destructive" });
            }
        }
    } else {
        finalConfirmedName = aiScannedSupplierNameFromStorage || initialScannedTaxDetails.supplierName || null;
        setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: finalConfirmedName }));
    }
    setIsSupplierConfirmed(true);
    await processNextDialogStep('supplier_confirmed');
  }, [user?.id, toast, t, aiScannedSupplierNameFromStorage, initialScannedTaxDetails.supplierName, processNextDialogStep]);

  const handlePaymentDueDateConfirm = useCallback(async (dueDate: string | Date | Timestamp | undefined) => {
    console.log(`[EditInvoice][PaymentDueDateDialog] Confirmed due date:`, dueDate);
    setSelectedPaymentDueDate(dueDate);
    setIsPaymentDueDateDialogSkipped(false); 
    await processNextDialogStep('payment_due_date_confirmed');
  }, [processNextDialogStep]);

  const handleCancelPaymentDueDate = useCallback(async () => {
    console.log("[EditInvoice][PaymentDueDateDialog] Skipped/Cancelled.");
    setSelectedPaymentDueDate(undefined);
    setIsPaymentDueDateDialogSkipped(true); 
    await processNextDialogStep('payment_due_date_skipped');
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
             if (currentQuantity > 0 && currentUnitPrice > 0 ) {
                currentLineTotal = parseFloat((currentQuantity * currentUnitPrice).toFixed(2));
             } else if (field === 'unitPrice' && currentUnitPrice === 0 && currentQuantity > 0) { 
                 currentLineTotal = 0;
             } else if (field === 'quantity' && currentQuantity === 0) { 
                currentLineTotal = 0;
             }
            updatedProduct.lineTotal = currentLineTotal;
          } else if (field === 'lineTotal') {
            if (currentQuantity > 0 && currentLineTotal > 0) {
              currentUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
              updatedProduct.unitPrice = currentUnitPrice;
            } else if (currentLineTotal === 0) {
                 updatedProduct.unitPrice = 0;
            } else {
                 updatedProduct.unitPrice = (updatedProduct.unitPrice !== undefined) ? updatedProduct.unitPrice : 0;
            }
          }
          
           if (currentQuantity === 0 || currentUnitPrice === 0) {
                updatedProduct.lineTotal = 0;
           }
           if (currentQuantity > 0 && currentLineTotal > 0 && field !== 'unitPrice' && currentUnitPrice === 0) {
               updatedProduct.unitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
           }
           if (field === 'unitPrice' && currentUnitPrice === 0 && currentQuantity > 0) {
               updatedProduct.lineTotal = 0;
           }
          return updatedProduct;
        }
        return p;
      })
    );
  };

  const handleTaxInvoiceDetailsChange = (field: keyof EditableTaxInvoiceDetails, value: string | number | undefined | Date | Timestamp) => {
     setEditableTaxInvoiceDetails(prev => ({ ...prev, [field]: value === '' ? null : value }));
  };

  const handleAddRow = () => {
    const newProduct: EditableProduct = {
      id: `prod-temp-${Date.now()}-new`,
      _originalId: `prod-temp-${Date.now()}-new`,
      userId: user?.id || 'unknown',
      catalogNumber: '',
      description: '',
      quantity: 0,
      unitPrice: 0,
      lineTotal: 0,
      barcode: undefined,
      minStockLevel: undefined,
      maxStockLevel: undefined,
      salePrice: undefined,
      imageUrl: undefined,
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


 const proceedWithFinalSave = useCallback(async (finalProductsToSave: Product[]) => {
      console.log("[EditInvoice][proceedWithFinalSave] Called with products:", finalProductsToSave);
      if (!user?.id || !documentType) {
          toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
          setCurrentDialogStep('error_loading');
          setIsSaving(false); 
          return; 
      }
      
      if (!isSaving) setIsSaving(true); // Ensure saving state is set if not already
      
      try {
          const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => rest);

          let finalFileNameForSave = originalFileName;
          const finalSupplierNameForSave = editableTaxInvoiceDetails.supplierName;
          const finalInvoiceNumberForSave = editableTaxInvoiceDetails.invoiceNumber;
          const finalTotalAmountForSave = editableTaxInvoiceDetails.totalAmount;
          
          let finalInvoiceDateForSave: Timestamp | string | null = null;
          if (editableTaxInvoiceDetails.invoiceDate instanceof Timestamp) finalInvoiceDateForSave = editableTaxInvoiceDetails.invoiceDate;
          else if (typeof editableTaxInvoiceDetails.invoiceDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate))) finalInvoiceDateForSave = Timestamp.fromDate(parseISO(editableTaxInvoiceDetails.invoiceDate));
          else if (editableTaxInvoiceDetails.invoiceDate instanceof Date && isValid(editableTaxInvoiceDetails.invoiceDate)) finalInvoiceDateForSave = Timestamp.fromDate(editableTaxInvoiceDetails.invoiceDate);

          const finalPaymentMethodForSave = editableTaxInvoiceDetails.paymentMethod;
          
          let finalPaymentDueDateForSave: Timestamp | string | Date | null = null;
          if (selectedPaymentDueDate instanceof Timestamp) finalPaymentDueDateForSave = selectedPaymentDueDate;
          else if (typeof selectedPaymentDueDate === 'string' && isValid(parseISO(selectedPaymentDueDate))) finalPaymentDueDateForSave = Timestamp.fromDate(parseISO(selectedPaymentDueDate));
          else if (selectedPaymentDueDate instanceof Date && isValid(selectedPaymentDueDate)) finalPaymentDueDateForSave = Timestamp.fromDate(selectedPaymentDueDate);


          if(finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '' && finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
            finalFileNameForSave = `${finalSupplierNameForSave}_${finalInvoiceNumberForSave}`;
          } else if (finalSupplierNameForSave && finalSupplierNameForSave.trim() !== '') {
            finalFileNameForSave = finalSupplierNameForSave;
          } else if (finalInvoiceNumberForSave && finalInvoiceNumberForSave.trim() !== '') {
            finalFileNameForSave = `Invoice_${finalInvoiceNumberForSave}`;
          }
          finalFileNameForSave = finalFileNameForSave.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);
          const rawScanResultJsonFromFirestore = initialTempInvoiceId && db && user?.id ? (await getDoc(doc(db, DOCUMENTS_COLLECTION, initialTempInvoiceId))).data()?.rawScanResultJson : null;


          console.log("[EditInvoice][proceedWithFinalSave] Calling finalizeSaveProductsService. TempID:", initialTempInvoiceId, "Products count:", productsForService.length);
          const result = await finalizeSaveProductsService(
            productsForService,
            finalFileNameForSave,
            documentType,
            user.id,
            initialTempInvoiceId || undefined, 
            finalInvoiceNumberForSave || undefined,
            finalSupplierNameForSave || undefined,
            finalTotalAmountForSave ?? undefined,
            finalPaymentDueDateForSave, 
            finalInvoiceDateForSave || undefined, 
            finalPaymentMethodForSave || undefined, 
            displayedOriginalImageUrl || undefined, 
            displayedCompressedImageUrl || undefined,
            rawScanResultJsonFromFirestore 
          );
          console.log("[EditInvoice][proceedWithFinalSave] finalizeSaveProductsService result:", result);
          cleanupTemporaryData();

          if (result.finalInvoiceRecord) {
            setOriginalFileName(result.finalInvoiceRecord.generatedFileName); 
            setInitialTempInvoiceId(result.finalInvoiceRecord.id); 
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
  }, [user?.id, documentType, originalFileName, editableTaxInvoiceDetails, selectedPaymentDueDate, initialTempInvoiceId, displayedOriginalImageUrl, displayedCompressedImageUrl, cleanupTemporaryData, toast, t, router, isSaving]);


 const proceedWithActualSave = useCallback(async (productsToSave: Product[]) => {
    console.log("[EditInvoice][proceedWithActualSave] Called. Products to save:", productsToSave, "Current Dialog Step:", currentDialogStep);
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setCurrentDialogStep('error_loading');
        setIsSaving(false);
        return;
    }

    let currentProductsToProcess = [...productsToSave];

    try {
        if(documentType === 'deliveryNote' && currentProductsToProcess.length > 0) {
            console.log("[EditInvoice][proceedWithActualSave] Delivery note, checking prices...");
            const priceCheckResult = await checkProductPricesBeforeSaveService(currentProductsToProcess, user.id);
            
            if (priceCheckResult.priceDiscrepancies.length > 0) {
                setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
                const productsForDiscrepancyDialog = priceCheckResult.productsToSaveDirectly.concat(
                    priceCheckResult.priceDiscrepancies.map(d => ({
                        ...d, 
                        unitPrice: d.newUnitPrice, 
                        salePrice: d.salePrice ?? undefined 
                    }))
                );
                setProductsForNextStep(productsForDiscrepancyDialog); 
                setCurrentDialogStep('price_discrepancy');
                return; 
            }
            currentProductsToProcess = priceCheckResult.productsToSaveDirectly; 
        }
        
        // This check was part of the loop issue. Removed direct call.
        // if (isNewScan && documentType === 'deliveryNote' && currentProductsToProcess.length > 0 && currentDialogStep !== 'new_product_details' && currentDialogStep !== 'ready_to_save') {
        //     const reviewResult = await checkForNewProductsAndDetails(currentProductsToProcess);
        //     if (reviewResult.needsReview) {
        //          setPromptingForNewProductDetails(reviewResult.productsForReview);
        //          setCurrentDialogStep('new_product_details');
        //          return; 
        //     }
        // }
        
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
         if (currentDialogStep !== 'price_discrepancy' && currentDialogStep !== 'new_product_details') { 
            setIsSaving(false);
        }
    }
}, [user?.id, documentType, toast, t, proceedWithFinalSave, currentDialogStep, isNewScan, checkForNewProductsAndDetails]);


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
        console.log(`[EditInvoice][handleSaveChecks] New scan, current step '${currentDialogStep}' is not 'ready_to_save'. Triggering next dialog step.`);
        await processNextDialogStep(`save_clicked_during_${currentDialogStep}`);
        setIsSaving(false); // Dialog flow might set it again, or it might be an error.
        return;
    }
    
    console.log("[EditInvoice][handleSaveChecks] Proceeding to actual save logic. Products for save:", productsForNextStep.length > 0 ? productsForNextStep : products);
    await proceedWithActualSave(productsForNextStep.length > 0 ? productsForNextStep : products);
}, [isSaving, user?.id, toast, t, isNewScan, currentDialogStep, processNextDialogStep, productsForNextStep, products, proceedWithActualSave]);


const handlePriceConfirmationComplete = useCallback(async (resolvedProducts: Product[] | null) => {
    console.log("[EditInvoice][handlePriceConfirmationComplete] Resolved products from dialog count:", resolvedProducts ? resolvedProducts.length : 'null (cancelled)');
    setPriceDiscrepancies(null); 
    await processNextDialogStep('price_discrepancy_complete', resolvedProducts);
}, [processNextDialogStep]);


 const handleNewProductDetailsComplete = useCallback(async (updatedNewProductsFromDialog: Product[] | null) => {
     console.log("[EditInvoice][handleNewProductDetailsComplete] Updated products from BarcodePromptDialog:", updatedNewProductsFromDialog ? updatedNewProductsFromDialog.length : 'null (dialog cancelled/skipped)');
     setProductsToDisplayForNewDetails([]); 

     let finalProductsForSave: Product[];

     if (updatedNewProductsFromDialog && updatedNewProductsFromDialog.length > 0) {
        const baseProducts = (productsForNextStep && productsForNextStep.length > 0) ? productsForNextStep : products;
        const updatedMap = new Map(updatedNewProductsFromDialog.map(p => [p._originalId || p.id, p]));
        
        finalProductsForSave = baseProducts.map(originalP => {
            const idToMatch = originalP._originalId || originalP.id;
            const updatedPData = updatedMap.get(idToMatch);
            if (updatedPData) {
                return { 
                    ...originalP, 
                    barcode: updatedPData.barcode || originalP.barcode, 
                    salePrice: updatedPData.salePrice !== undefined ? updatedPData.salePrice : originalP.salePrice,
                    id: originalP.id 
                };
            }
            return originalP; 
        });
     } else { 
        finalProductsForSave = (productsForNextStep && productsForNextStep.length > 0) ? productsForNextStep : products;
     }
     
     setProductsForNextStep(finalProductsForSave); 
     setCurrentDialogStep('ready_to_save'); 
     console.log("[EditInvoice][handleNewProductDetailsComplete] Dialog complete. Products for next step:", finalProductsForSave, "Step set to ready_to_save.");
 }, [products, productsForNextStep, setCurrentDialogStep]);


    const handleGoBack = () => {
        console.log("[EditInvoice] handleGoBack called. Cleaning up temp data and navigating.");
        cleanupTemporaryData(); // Still relevant for localStorage fallback key if used by upload page
        router.push(isNewScan ? '/upload' : (documentType === 'invoice' ? '/invoices?tab=scanned-docs' : '/inventory'));
    };

    const handleCancelEditTaxDetails = () => {
        setEditableTaxInvoiceDetails(initialScannedTaxDetails);
        setIsEditingTaxDetails(false);
        if (!isEditingDeliveryNoteProducts) setIsViewMode(true);
    };

    const handleSaveEditTaxDetails = () => {
        setInitialScannedTaxDetails({...editableTaxInvoiceDetails}); 
        setIsEditingTaxDetails(false);
        if (!isEditingDeliveryNoteProducts) setIsViewMode(true);
        toast({ title: t('edit_invoice_toast_section_updated_title'), description: t('edit_invoice_toast_section_updated_desc') });
    };

    const handleCancelEditProducts = () => {
        setProducts(initialScannedProducts.map(p => ({...p})));
        setProductsForNextStep(initialScannedProducts.map(({_originalId, ...rest}) => rest));
        setIsEditingDeliveryNoteProducts(false);
         if (!isEditingTaxDetails) setIsViewMode(true);
    };

    const handleSaveEditProducts = () => {
        setInitialScannedProducts(products.map(p => ({...p}))); 
        setProductsForNextStep(products.map(({_originalId, ...rest}) => rest));
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
            setProducts([...initialScannedProducts.map(p => ({...p}))]);
            setIsEditingDeliveryNoteProducts(true);
            setIsViewMode(false); 
        }
    };

    useEffect(() => {
        console.log(`[EditInvoice] Effect for dialog visibility. currentDialogStep: ${currentDialogStep}`);
        // This effect is now primarily for cleanup and logging, actual dialog visibility is driven by JSX conditions.
        if (currentDialogStep !== 'supplier_confirmation') {
          setPotentialSupplierName(undefined);
        }
        if (currentDialogStep !== 'price_discrepancy') {
          setPriceDiscrepancies(null);
        }
        // BarcodePromptDialog visibility is now handled directly in JSX
    }, [currentDialogStep]);


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
                            </div>
                           )}
                           {documentType === 'invoice' && (
                            <React.Fragment key="invoice-manual-entry-block">
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
                                        disabled={
                                            isSaving || 
                                            (isNewScan && currentDialogStep !== 'ready_to_save') ||
                                            (!isNewScan && !isEditingTaxDetails && !isEditingDeliveryNoteProducts && isViewMode) 
                                        }
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
                {selectedPaymentDueDate && renderScanSummaryItem('payment_due_date_dialog_title', selectedPaymentDueDate)}
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
                    value={selectedPaymentDueDate ? (selectedPaymentDueDate instanceof Timestamp ? format(selectedPaymentDueDate.toDate(), 'yyyy-MM-dd') : (typeof selectedPaymentDueDate === 'string' && isValid(parseISO(selectedPaymentDueDate)) ? format(parseISO(selectedPaymentDueDate), 'yyyy-MM-dd') : (selectedPaymentDueDate instanceof Date && isValid(selectedPaymentDueDate) ? format(selectedPaymentDueDate, 'yyyy-MM-dd') : ''))) : ''} 
                    onChange={(e) => setSelectedPaymentDueDate(e.target.value ? parseISO(e.target.value).toISOString() : undefined)} 
                    disabled={isSaving} />
            </div>
        </div>
    );

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
       <Card className="shadow-md scale-fade-in overflow-hidden bg-card">
         <CardHeader className="flex flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
                <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                    <FileTextIconLucide className="mr-2 h-5 w-5 flex-shrink-0" />
                    <span className="truncate" title={documentType === 'invoice' ? t('edit_invoice_invoice_details_title') : t('edit_invoice_delivery_note_details_title')}>
                        {documentType === 'invoice' ? t('edit_invoice_invoice_details_title') : t('edit_invoice_delivery_note_details_title')}
                    </span>
                </CardTitle>
                <CardDescription className="break-words mt-1 text-xs sm:text-sm">
                    {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
                    {((isViewMode && initialScannedTaxDetails.supplierName) || (!isViewMode && editableTaxInvoiceDetails.supplierName)) && 
                        ` | ${t('edit_invoice_supplier', { supplierName: (isViewMode ? initialScannedTaxDetails.supplierName : editableTaxInvoiceDetails.supplierName) })}`}
                </CardDescription>
            </div>
            {isViewMode && (documentType === 'invoice' || documentType === 'deliveryNote') && (
                <Button variant="ghost" size="icon" onClick={toggleEditTaxDetails} className="h-8 w-8 text-muted-foreground hover:text-primary flex-shrink-0 ml-auto sm:ml-2">
                    <Edit className="h-4 w-4" />
                    <span className="sr-only">{t('edit_button')}</span>
                </Button>
            )}
        </CardHeader>
        <CardContent className="space-y-6">
            {scanProcessErrorState && !isSaving && (
                <Alert variant="destructive" className="mt-2">
                    <AlertTitle>{t('edit_invoice_scan_process_error_title')}</AlertTitle>
                    <AlertDescription>{scanProcessErrorState}</AlertDescription>
                </Alert>
            )}
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

    <div className="mt-6">
        <div className="flex flex-row items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-primary">{documentType === 'invoice' ? t('edit_invoice_extracted_data_title_invoice') : t('edit_invoice_extracted_products_title')} ({documentType === 'invoice' ? 1 : products.length})</h2>
            {isViewMode && documentType === 'deliveryNote' && products.length > 0 && (
                <Button variant="ghost" size="icon" onClick={toggleEditDeliveryNoteProducts} className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <Edit className="h-4 w-4" />
                    <span className="sr-only">{t('edit_button')}</span>
                </Button>
            )}
        </div>
        {documentType === 'deliveryNote' && (
            <>
                {products.length > 0 || isEditingDeliveryNoteProducts ? (
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
                     <CardFooter className="flex justify-between items-center pt-4 mt-2 border-t">
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
    </div>
    
    <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
        <Button variant="outline" onClick={handleGoBack} className="w-full sm:w-auto order-last sm:order-first" disabled={isSaving}>
            <ArrowLeft className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_discard_scan_button') : t('edit_invoice_go_back_to_invoices_button')}
        </Button>
        
        <div className="flex-grow flex flex-col sm:flex-row sm:justify-end gap-3">
             {/* Main save button, re-enabled when dialog flow is 'ready_to_save' or if not a new scan */}
            <Button 
                onClick={handleSaveChecks} 
                disabled={
                    isSaving ||
                    (isNewScan && currentDialogStep !== 'ready_to_save') ||
                    (!isNewScan && !isEditingTaxDetails && !isEditingDeliveryNoteProducts && isViewMode)
                }
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
                setIsSupplierConfirmed(true); // Treat as confirmed to proceed if user skips
                processNextDialogStep('supplier_skipped');
            }}
            isOpen={currentDialogStep === 'supplier_confirmation'}
            onOpenChange={(open) => { 
                if (!open && currentDialogStep === 'supplier_confirmation' && !isSupplierConfirmed) {
                    console.log("[EditInvoice][SupplierConfirmationDialog] Externally closed. Assuming skip.");
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

    {currentDialogStep === 'new_product_details' && productsToDisplayForNewDetails && productsToDisplayForNewDetails.length > 0 && (
        <BarcodePromptDialog
            products={productsToDisplayForNewDetails}
            initialProductInputStates={productInputStates}
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
    

