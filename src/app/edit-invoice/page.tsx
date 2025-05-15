
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

  const [promptingForNewProductDetails, setPromptingForNewProductDetails] = useState<Product[] | null>(null);
  const [isBarcodePromptOpen, setIsBarcodePromptOpen] = useState(false);
  const [priceDiscrepancies, setPriceDiscrepancies] = useState<ProductPriceDiscrepancy[] | null>(null);

  const [productsForNextStep, setProductsForNextStep] = useState<Product[]>([]);

  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [potentialSupplierName, setPotentialSupplierName] = useState<string | undefined>(undefined);
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [isSupplierConfirmed, setIsSupplierConfirmed] = useState(false);
  const [aiScannedSupplierNameFromStorage, setAiScannedSupplierNameFromStorage] = useState<string | undefined>(undefined);


  const [showPaymentDueDateDialog, setShowPaymentDueDateDialog] = useState(false);
  const [selectedPaymentDueDate, setSelectedPaymentDueDate] = useState<string | Date | Timestamp | undefined>(undefined);


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


  const _internalCheckSupplier = async (scannedSupplierName: string | undefined | null, currentUserId: string, suppliersList: SupplierSummary[]) => {
    console.log(`[EditInvoice] _internalCheckSupplier called. Scanned: ${scannedSupplierName}, UserID: ${currentUserId}, isNewScan: ${isNewScan}`);
    setShowSupplierDialog(false);
    setShowPaymentDueDateDialog(false);
    setIsBarcodePromptOpen(false);

    if (!isNewScan) {
        console.log("[EditInvoice] _internalCheckSupplier: Not a new scan, skipping dialogs.");
        setIsSupplierConfirmed(true); // Assume confirmed for existing invoices or manual entries
        return;
    }
    if (!scannedSupplierName) {
        console.log("[EditInvoice] _internalCheckSupplier: No supplier name from scan, assuming confirmed and proceeding.");
        setIsSupplierConfirmed(true);
        if (!selectedPaymentDueDate && (documentType === 'deliveryNote' || documentType === 'invoice')) {
            console.log("[EditInvoice] _internalCheckSupplier: No supplier name, prompting for Payment Due Date.");
            setShowPaymentDueDateDialog(true);
        } else if (documentType === 'deliveryNote' && products.length > 0) {
            console.log("[EditInvoice] _internalCheckSupplier: No supplier name, prompting for New Product Details.");
            checkForNewProductsAndDetails(products);
        }
        return;
    }

    setExistingSuppliers(suppliersList);
    const isExisting = suppliersList.some(s => s.name.toLowerCase() === scannedSupplierName.toLowerCase());

    if (isExisting) {
      console.log("[EditInvoice] _internalCheckSupplier: Supplier is existing.");
      setExtractedSupplierName(scannedSupplierName);
      setIsSupplierConfirmed(true);
      if (!selectedPaymentDueDate && (documentType === 'deliveryNote' || documentType === 'invoice')) {
           console.log("[EditInvoice] _internalCheckSupplier: Existing supplier, prompting for Payment Due Date.");
           setShowPaymentDueDateDialog(true);
      } else if (documentType === 'deliveryNote' && products.length > 0) {
          console.log("[EditInvoice] _internalCheckSupplier: Existing supplier, prompting for New Product Details.");
          checkForNewProductsAndDetails(products);
      }
    } else {
      console.log("[EditInvoice] _internalCheckSupplier: Supplier is new. Prompting for confirmation.");
      setPotentialSupplierName(scannedSupplierName);
      setShowSupplierDialog(true);
    }
  };


  const loadData = useCallback(async () => {
    if (!user || !searchParams || !user.id) return;
    
    console.log("[EditInvoice] loadData started.");
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
    console.log(`[EditInvoice] newScanFlag: ${newScanFlag}, docTypeParam: ${docTypeParam}, keyParam: ${keyParam}, tempInvIdParam: ${tempInvIdParam}, invoiceIdParam: ${invoiceIdParam}`);

    if (newScanFlag) {
        console.log("[EditInvoice] New scan detected, resetting dialog states for new flow.");
        setSelectedPaymentDueDate(undefined);
        setIsSupplierConfirmed(false);
        setPotentialSupplierName(undefined);
        setAiScannedSupplierNameFromStorage(undefined);
        setIsViewMode(true); 
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
    } else if (invoiceIdParam) {
        console.log("[EditInvoice] Existing invoice detected, setting view mode.");
        setIsViewMode(true);
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
    } else {
        console.log("[EditInvoice] No data (new manual entry), setting edit mode.");
        setIsViewMode(false); 
        setIsEditingTaxDetails(true);
        setIsEditingDeliveryNoteProducts(true);
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
    console.log(`[EditInvoice] uniquePartFromKeyOrTempId for image keys: ${uniquePartFromKeyOrTempId}`);

    if (uniquePartFromKeyOrTempId) {
        setInitialOriginalImagePreviewKey(getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`));
    }

    if (nameParam) {
      setOriginalFileName(decodeURIComponent(nameParam));
    } else {
        setOriginalFileName(t('edit_invoice_unknown_document'));
    }
    

    if (invoiceIdParam) {
        console.log(`[EditInvoice] Loading existing invoice ID: ${invoiceIdParam}`);
        try {
            const allInvoices = await getInvoicesService(user.id);
            const inv = allInvoices.find(i => i.id === invoiceIdParam);
            if (inv) {
                console.log("[EditInvoice] Existing invoice found:", inv);
                let finalFileName = inv.fileName;
                if(inv.supplierName && inv.invoiceNumber) {
                    finalFileName = `${inv.supplierName}_${inv.invoiceNumber}`;
                } else if (inv.supplierName) {
                    finalFileName = inv.supplierName;
                } else if (inv.invoiceNumber) {
                    finalFileName = `Invoice_${inv.invoiceNumber}`;
                }
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
                setIsSupplierConfirmed(true); // For existing invoices, supplier is considered confirmed.
            } else {
                setErrorLoading(t('edit_invoice_error_invoice_not_found_id', { invoiceId: invoiceIdParam }));
            }
        } catch (e) {
            console.error("Error loading existing invoice:", e);
            setErrorLoading(t('edit_invoice_error_loading_existing'));
        }
    } else if (keyParam || tempInvIdParam) { 
        console.log(`[EditInvoice] Loading new scan data from localStorage. Key: ${keyParam}, TempInvId: ${tempInvIdParam}`);
        let storedData: string | null = null;
        let actualDataKey = keyParam; 

        if (!actualDataKey && tempInvIdParam && uniquePartFromKeyOrTempId) {
            actualDataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`);
        }
        console.log(`[EditInvoice] Actual data key for localStorage: ${actualDataKey}`);


        try {
            if (actualDataKey) storedData = localStorage.getItem(actualDataKey);
            const previewKeyToLoad = initialOriginalImagePreviewKey || (uniquePartFromKeyOrTempId ? getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`) : null);
            const compressedKeyToLoad = initialCompressedImageKey || (uniquePartFromKeyOrTempId ? getStorageKey(TEMP_COMPRESSED_IMAGE_KEY_PREFIX, `${user.id}_${uniquePartFromKeyOrTempId}`) : null);

            console.log(`[EditInvoice] Attempting to load images. PreviewKey: ${previewKeyToLoad}, CompressedKey: ${compressedKeyToLoad}`);
            if(previewKeyToLoad) setDisplayedOriginalImageUrl(localStorage.getItem(previewKeyToLoad));
            if(compressedKeyToLoad) setDisplayedCompressedImageUrl(localStorage.getItem(compressedKeyToLoad));

        } catch(e) {
            console.error("Error reading from localStorage for key:", actualDataKey, e);
            setErrorLoading(t('edit_invoice_error_localstorage_read'));
            cleanupTemporaryData();
            setIsLoading(false);
            setInitialDataLoaded(true);
            return;
        }

        if (!storedData) {
            setErrorLoading(t('edit_invoice_error_scan_results_not_found_key', {key: actualDataKey || 'unknown'}));
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
            console.log("[EditInvoice] Parsed data from localStorage:", parsedData);
        } catch (jsonParseError) {
             console.error("Failed to parse JSON data from localStorage:", jsonParseError, "Raw data:", storedData);
             cleanupTemporaryData();
             setErrorLoading(t('edit_invoice_error_invalid_json'));
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
           console.log("[EditInvoice] Scan process error from parsed data:", generalError);
        }
        
        let supplierFromScan: string | undefined | null = null;

        if (docTypeParam === 'invoice') {
            console.log("[EditInvoice] Processing as Tax Invoice.");
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
            setAiScannedSupplierNameFromStorage(supplierFromScan); // Store it


        } else if (docTypeParam === 'deliveryNote') {
            console.log("[EditInvoice] Processing as Delivery Note.");
            const productData = parsedData as ScanInvoiceOutput;
            if (productData && Array.isArray(productData.products)) {
              const productsWithIds = productData.products.map((p: Product, index: number) => ({
                ...p,
                id: p.id || `prod-temp-${Date.now()}-${index}`,
                _originalId: p.id,
                quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
                 unitPrice: (typeof p.quantity === 'number' && p.quantity !== 0 && typeof p.lineTotal === 'number' && p.lineTotal !== 0 && (p.lineTotal / p.quantity > 0))
                            ? parseFloat((p.lineTotal / p.quantity).toFixed(2))
                            : (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice)) || 0),
                minStockLevel: p.minStockLevel ?? undefined,
                maxStockLevel: p.maxStockLevel ?? undefined,
                salePrice: undefined, 
              }));
              setProducts(productsWithIds);
              setInitialScannedProducts(productsWithIds);
              console.log("[EditInvoice] Initial products set from delivery note scan:", productsWithIds);

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
              setAiScannedSupplierNameFromStorage(supplierFromScan); // Store it


            } else if (!productData.error){
                console.error("Parsed product data is missing 'products' array or is invalid:", productData);
                setErrorLoading(t('edit_invoice_error_invalid_structure_parsed'));
                setProducts([]);
                setInitialScannedProducts([]);
                toast({
                   title: t('edit_invoice_toast_error_loading_title'),
                   description: t('edit_invoice_toast_error_loading_desc_invalid_structure'),
                   variant: "destructive",
                });
            }
        } else {
             console.error("Unknown or missing docTypeParam:", docTypeParam, "Parsed Data:", parsedData);
             setErrorLoading(t('edit_invoice_error_unknown_document_type'));
             setProducts([]);
             setInitialScannedProducts([]);
             setEditableTaxInvoiceDetails({});
             setInitialScannedTaxDetails({});
        }

        if (newScanFlag && user?.id) {
            console.log("[EditInvoice] New scan, initiating supplier check sequence for supplier:", supplierFromScan);
            try {
                const suppliersList = await getSupplierSummariesService(user.id);
                console.log("[EditInvoice] Fetched existing suppliers for dialog flow:", suppliersList);
                await _internalCheckSupplier(supplierFromScan, user.id, suppliersList);
            } catch (supplierError) {
                console.error("[EditInvoice] Error fetching suppliers for dialog flow:", supplierError);
                toast({ title: t('edit_invoice_toast_error_fetching_suppliers'), variant: "destructive" });
                // Fallback: assume supplier is confirmed and proceed to payment due date if applicable
                setIsSupplierConfirmed(true);
                if (!selectedPaymentDueDate && (docTypeParam === 'deliveryNote' || docTypeParam === 'invoice')) {
                    setShowPaymentDueDateDialog(true);
                } else if (docTypeParam === 'deliveryNote' && products.length > 0) {
                    checkForNewProductsAndDetails(products);
                }
            }
        } else if (!newScanFlag) {
            console.log("[EditInvoice] Not a new scan, assuming supplier and payment due date are already set or not needed for dialog flow.");
            setIsSupplierConfirmed(true); // For existing invoices, or if not a new scan.
        }


    } else if (!initialDataLoaded) { 
       console.error("[EditInvoice] No keyParam, tempInvIdParam, or invoiceIdParam provided.");
       setErrorLoading(t('edit_invoice_error_no_key_or_id'));
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
  }, [user, searchParams, t, toast, cleanupTemporaryData, initialCompressedImageKey, initialOriginalImagePreviewKey, initialDataLoaded]); // Removed loadData from dependencies


  useEffect(() => {
    if(user && user.id && !initialDataLoaded) { 
      loadData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, initialDataLoaded]); 



  const handleSupplierConfirmation = async (confirmedSupplierName: string | null, isNew: boolean = false) => {
    console.log(`[EditInvoice] handleSupplierConfirmation called. Confirmed: ${confirmedSupplierName}, isNew: ${isNew}`);
    setShowSupplierDialog(false);
    if (!user?.id) {
        toast({ title: t("edit_invoice_user_not_authenticated_title"), variant: "destructive" });
        return;
    }
    if (confirmedSupplierName) {
      setExtractedSupplierName(confirmedSupplierName);
      setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: confirmedSupplierName }));
      if (isNew) {
        try {
          await updateSupplierContactInfoService(confirmedSupplierName, {}, user.id); 
          toast({ title: t('edit_invoice_toast_new_supplier_added_title'), description: t('edit_invoice_toast_new_supplier_added_desc', { supplierName: confirmedSupplierName }) });
        } catch (error) {
          console.error("Failed to add new supplier:", error);
          toast({ title: t('edit_invoice_toast_fail_add_supplier_title'), variant: "destructive" });
        }
      }
    } else {
      setExtractedSupplierName(aiScannedSupplierNameFromStorage || extractedSupplierName);
      setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: aiScannedSupplierNameFromStorage || extractedSupplierName }));
    }
    setIsSupplierConfirmed(true);
    
    if (isNewScan && !selectedPaymentDueDate && (documentType === 'deliveryNote' || documentType === 'invoice')) {
        console.log("[EditInvoice] handleSupplierConfirmation: Prompting for Payment Due Date.");
        setShowPaymentDueDateDialog(true);
    } else if (isNewScan && documentType === 'deliveryNote' && products.length > 0) {
        console.log("[EditInvoice] handleSupplierConfirmation: Prompting for New Product Details.");
        checkForNewProductsAndDetails(products);
    }
  };

  const handlePaymentDueDateConfirm = (dueDate: string | Date | Timestamp | undefined) => {
    console.log(`[EditInvoice] handlePaymentDueDateConfirm called. DueDate: ${dueDate}`);
    setSelectedPaymentDueDate(dueDate);
    setShowPaymentDueDateDialog(false);
    if (isNewScan && documentType === 'deliveryNote' && products.length > 0) {
        console.log("[EditInvoice] handlePaymentDueDateConfirm: Prompting for New Product Details.");
        checkForNewProductsAndDetails(products);
    } else if (isNewScan && documentType === 'invoice' && !products.length) {
        console.log("[EditInvoice] handlePaymentDueDateConfirm for Tax Invoice, no products to detail. Ready for final save.");
        // Potentially trigger save here or enable save button, as no further dialogs for tax invoice
    }
};

 const handleCancelPaymentDueDate = () => {
    console.log("[EditInvoice] Payment Due Date dialog cancelled by user.");
    setShowPaymentDueDateDialog(false);
    setSelectedPaymentDueDate(undefined); // Explicitly clear if skipped
    if (isNewScan && documentType === 'deliveryNote' && products.length > 0) {
        console.log("[EditInvoice] Payment Due Date dialog cancelled, prompting for New Product Details for Delivery Note.");
        checkForNewProductsAndDetails(products);
    } else if (isNewScan && documentType === 'invoice') {
        console.log("[EditInvoice] Payment Due Date dialog cancelled for Tax Invoice. User can click save to proceed without due date.");
    }
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
          console.log("[EditInvoice] finalizeSaveProductsService result:", result);

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
             console.error("[finalizeSaveProductsService] Final invoice record not returned or error occurred.", result);
             setScanProcessErrorState(t('edit_invoice_toast_save_failed_desc_finalize', { message: result.uniqueScanIdToClear ? "Clear temp data & try again." : "Final invoice record not returned."}));
             if (result.uniqueScanIdToClear && user?.id) {
                clearTemporaryScanData(result.uniqueScanIdToClear, user.id);
             }
          }

      } catch (error: any) {
          console.error("Failed to finalize save products:", error);
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
      } finally {
          setIsSaving(false);
      }
  };

  const proceedWithFinalSaveForTaxInvoice = async () => {
    console.log("[EditInvoice] proceedWithFinalSaveForTaxInvoice called.");
    setIsSaving(true);
    if (!user?.id || !documentType) {
      toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
      setIsSaving(false);
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
      console.log("[EditInvoice] finalizeSaveProductsService result (for tax invoice):", result);

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
      }
    } catch (error: any) {
      console.error("Failed to finalize save for tax invoice:", error);
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
    } finally {
      setIsSaving(false);
    }
  };


 const handleSaveChecks = async () => {
    console.log("[EditInvoice] handleSaveChecks called.");
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        return;
    }

    if (isNewScan && !isSupplierConfirmed) {
        console.log("[EditInvoice] handleSaveChecks: Supplier not confirmed, initiating checkSupplier flow for:", aiScannedSupplierNameFromStorage);
         try {
            const suppliersList = await getSupplierSummariesService(user.id);
            console.log("[EditInvoice] Fetched existing suppliers for save checks:", suppliersList);
            await _internalCheckSupplier(aiScannedSupplierNameFromStorage, user.id, suppliersList);
         } catch (supplierError) {
            console.error("[EditInvoice] Error fetching suppliers during save checks:", supplierError);
            toast({ title: t('edit_invoice_toast_error_fetching_suppliers'), variant: "destructive" });
            setIsSupplierConfirmed(true); // Fallback: assume confirmed and proceed
            if (isNewScan && !selectedPaymentDueDate && (documentType === 'deliveryNote' || documentType === 'invoice')) {
                setShowPaymentDueDateDialog(true);
                return;
            }
             await proceedWithActualSave();
         }
        return; // Wait for supplier confirmation flow to complete
    }

    if (isNewScan && !selectedPaymentDueDate && (documentType === 'deliveryNote' || documentType === 'invoice')) {
        console.log("[EditInvoice] handleSaveChecks: Payment due date not selected, showing dialog.");
        setShowPaymentDueDateDialog(true);
        return; // Wait for due date selection
    }
    
    console.log("[EditInvoice] handleSaveChecks: Supplier and due date confirmed (or not needed for this flow), proceeding to actual save logic.");
    await proceedWithActualSave();
};

const proceedWithActualSave = async () => {
    console.log("[EditInvoice] proceedWithActualSave called.");
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        return;
    }

    if (documentType === 'invoice') {
        console.log("[EditInvoice] proceedWithActualSave: Document is Tax Invoice, calling proceedWithFinalSaveForTaxInvoice.");
        await proceedWithFinalSaveForTaxInvoice();
        return;
    }

    setIsSaving(true);
    try {
        const productsFromEdit = products.map(({ _originalId, ...rest }) => rest);
        console.log("[EditInvoice] proceedWithActualSave: Products from edit page:", productsFromEdit);
        const priceCheckResult = await checkProductPricesBeforeSaveService(productsFromEdit, user.id);
        console.log("[EditInvoice] proceedWithActualSave: Price check result:", priceCheckResult);

        setProductsForNextStep(priceCheckResult.productsToSaveDirectly);

        if (priceCheckResult.priceDiscrepancies.length > 0) {
            console.log("[EditInvoice] proceedWithActualSave: Price discrepancies found, showing dialog.");
            setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
        } else {
            console.log("[EditInvoice] proceedWithActualSave: No price discrepancies. Checking for new products.");
            if (isNewScan && documentType === 'deliveryNote' && priceCheckResult.productsToSaveDirectly.length > 0) { 
                await checkForNewProductsAndDetails(priceCheckResult.productsToSaveDirectly);
            } else {
                console.log("[EditInvoice] proceedWithActualSave: Not a new delivery note or no products to detail check, proceeding to final save.");
                await proceedWithFinalSave(priceCheckResult.productsToSaveDirectly);
            }
        }
    } catch (error) {
        console.error("Error during initial save checks:", error);
        toast({
            title: t('edit_invoice_toast_error_preparing_save_title'),
            description: t('edit_invoice_toast_error_preparing_save_desc', { message: (error as Error).message}),
            variant: "destructive",
        });
    } finally {
         setIsSaving(false);
    }
};


const checkForNewProductsAndDetails = async (productsReadyForDetailCheck: Product[]) => {
    console.log("[EditInvoice] checkForNewProductsAndDetails called with products:", productsReadyForDetailCheck);
    setIsSaving(true); 
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setIsSaving(false);
        return;
    }
    if (productsReadyForDetailCheck.length === 0 && documentType === 'deliveryNote') {
        console.log("[EditInvoice] checkForNewProductsAndDetails: No products for detail check (delivery note), proceeding to final save.");
        await proceedWithFinalSave([]);
        return;
    }
    if(documentType === 'invoice' && productsReadyForDetailCheck.length === 0) {
        console.log("[EditInvoice] checkForNewProductsAndDetails: No products for detail check (tax invoice), proceeding to tax invoice final save.");
        await proceedWithFinalSaveForTaxInvoice();
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

        const newProductsNeedingDetails = productsReadyForDetailCheck.filter(p => {
            const isExistingById = p.id && !p.id.startsWith('prod-temp-') && inventoryMap.has(`id:${p.id}`);
            const isExistingByCatalog = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
            const isExistingByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);

            const isProductConsideredNew = !(isExistingById || isExistingByCatalog || isExistingByBarcode);
            const needsSalePriceReview = p.salePrice === undefined || p.salePrice === null || Number(p.salePrice) <= 0;
            
            return isProductConsideredNew || needsSalePriceReview;
        });
        console.log("[EditInvoice] checkForNewProductsAndDetails: Products needing details for BarcodePromptDialog:", newProductsNeedingDetails);


        if (newProductsNeedingDetails.length > 0) {
            setProductsForNextStep(productsReadyForDetailCheck); 
            setPromptingForNewProductDetails(newProductsNeedingDetails); 
            setShowSupplierDialog(false);
            setShowPaymentDueDateDialog(false);
            setIsBarcodePromptOpen(true); 
        } else {
            console.log("[EditInvoice] checkForNewProductsAndDetails: No new products needing details, proceeding to final save.");
            await proceedWithFinalSave(productsReadyForDetailCheck);
        }
    } catch (error) {
        console.error("Error checking inventory for new product details prompt:", error);
        toast({
            title: t('edit_invoice_toast_error_new_product_details_title'),
            description: t('edit_invoice_toast_error_new_product_details_desc'),
            variant: "destructive",
        });
    } finally {
        setIsSaving(false); 
    }
};


const handlePriceConfirmationComplete = (resolvedProducts: Product[] | null) => {
    console.log("[EditInvoice] handlePriceConfirmationComplete called with products:", resolvedProducts);
    setPriceDiscrepancies(null);
    if (resolvedProducts) {
        const updatedProductsForDetailCheck = productsForNextStep.map(originalProduct => {
            const resolvedVersion = resolvedProducts.find(rp => rp.id === originalProduct.id);
            return resolvedVersion ? { ...originalProduct, unitPrice: resolvedVersion.unitPrice } : originalProduct;
        });
        setProductsForNextStep(updatedProductsForDetailCheck);
        
        if (isNewScan && documentType === 'deliveryNote' && updatedProductsForDetailCheck.length > 0) {
            console.log("[EditInvoice] handlePriceConfirmationComplete: Prompting for New Product Details after price confirmation.");
            checkForNewProductsAndDetails(updatedProductsForDetailCheck);
        } else {
            console.log("[EditInvoice] handlePriceConfirmationComplete: Not a new delivery note or no products, proceeding to final save.");
            proceedWithFinalSave(updatedProductsForDetailCheck);
        }
    } else {
        toast({
            title: t('edit_invoice_toast_save_cancelled_title'),
            description: t('edit_invoice_toast_save_cancelled_desc_price'),
            variant: "default",
        });
        setIsSaving(false);
    }
};


 const handleNewProductDetailsComplete = (updatedNewProductsFromDialog: Product[] | null) => {
     console.log("[EditInvoice] handleNewProductDetailsComplete called with products:", updatedNewProductsFromDialog);
     setPromptingForNewProductDetails(null);
     setIsBarcodePromptOpen(false);

     if (updatedNewProductsFromDialog) {
         const finalProductsToSave = productsForNextStep.map(originalProduct => {
             const updatedVersion = updatedNewProductsFromDialog.find(unp =>
                 (originalProduct.id && unp.id === originalProduct.id) || 
                 (unp.catalogNumber && unp.catalogNumber === originalProduct.catalogNumber) 
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
         console.log("[EditInvoice] handleNewProductDetailsComplete: Proceeding to final save with products:", finalProductsToSave);
         proceedWithFinalSave(finalProductsToSave);
     } else {
         toast({
             title: t('edit_invoice_toast_save_incomplete_title'),
             description: t('edit_invoice_toast_save_incomplete_desc_details'),
             variant: "default",
         });
          setIsSaving(false);
     }
 };


    const handleGoBack = () => {
        console.log("[EditInvoice] handleGoBack called. Cleaning up temp data and navigating to /upload.");
        cleanupTemporaryData();
        router.push('/upload');
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

    if (errorLoading) {
        return (
            <div className="container mx-auto p-4 md:p-8 space-y-4">
                <Alert variant="destructive">
                    <AlertTitle>{t('edit_invoice_error_loading_title')}</AlertTitle>
                    <AlertDescription>{errorLoading}</AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleGoBack}>
                   <ArrowLeft className="mr-2 h-4 w-4" /> {t('edit_invoice_go_back_button')}
                </Button>
            </div>
        );
    }

    const showManualEntryPrompt = isNewScan &&
        ((documentType === 'deliveryNote' && products.length === 0 && !errorLoading && !scanProcessErrorState) ||
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
                                <Button variant="outline" onClick={() => { handleAddRow(); setIsEditingDeliveryNoteProducts(true); setIsViewMode(false);}} className="w-full sm:w-auto">
                                <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                                </Button>
                                <Button 
                                    onClick={handleSaveChecks} 
                                    disabled={isSaving || products.length === 0 || (isNewScan && !isSupplierConfirmed) || (isNewScan && (documentType === 'deliveryNote') && !selectedPaymentDueDate) } 
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
                                    disabled={isSaving || (isNewScan && !isSupplierConfirmed) || (isNewScan && (documentType === 'invoice') && !selectedPaymentDueDate) } 
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
        if(noDetailsAvailable && isNewScan && !scanProcessErrorState){
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
        {documentType === 'invoice' && !isViewMode && (
             <div className="mt-4">
                <Button 
                    onClick={handleSaveChecks} 
                    disabled={isSaving || (isNewScan && !isSupplierConfirmed) || (isNewScan && (documentType === 'invoice') && !selectedPaymentDueDate) } 
                    className="bg-primary hover:bg-primary/90 w-full sm:w-auto mt-4"
                >
                    {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {t('edit_invoice_save_changes_button')}</>}
                </Button>
            </div>
         )}


        <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
            <Button variant="outline" onClick={isNewScan ? handleGoBack : () => router.push(documentType === 'invoice' ? '/invoices?tab=scanned-docs' : '/invoices?tab=scanned-docs')} className="w-full sm:w-auto order-last sm:order-first" disabled={isSaving}>
                <ArrowLeft className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_discard_scan_button') : t('edit_invoice_go_back_to_invoices_button')}
            </Button>
            {(documentType === 'deliveryNote' || documentType === 'invoice') && (
                 <div className="flex-grow flex flex-col sm:flex-row sm:justify-end gap-3">
                    <Button
                        onClick={handleSaveChecks}
                        disabled={isSaving || (!isEditingDeliveryNoteProducts && !isEditingTaxDetails && !isNewScan && !!initialTempInvoiceId) || (isNewScan && !isSupplierConfirmed) || (isNewScan && !selectedPaymentDueDate) }
                        className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                    >
                        {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_confirm_and_save_button') : t('edit_invoice_save_changes_button')}</>}
                    </Button>
                </div>
            )}
        </div>
       {showSupplierDialog && potentialSupplierName && user && (
        <SupplierConfirmationDialog
          potentialSupplierName={potentialSupplierName}
          existingSuppliers={existingSuppliers}
          onConfirm={handleSupplierConfirmation}
          onCancel={() => {
            console.log("[EditInvoice] Supplier confirmation dialog cancelled by user.");
            setShowSupplierDialog(false);
            setIsSupplierConfirmed(true); 
            setExtractedSupplierName(aiScannedSupplierNameFromStorage || extractedSupplierName);
            setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: aiScannedSupplierNameFromStorage || extractedSupplierName }));
            if (isNewScan && !selectedPaymentDueDate && (documentType === 'deliveryNote' || documentType === 'invoice')) {
                 console.log("[EditInvoice] Supplier dialog cancelled, prompting for Payment Due Date.");
                 setShowPaymentDueDateDialog(true);
            } else if (isNewScan && documentType === 'deliveryNote' && products.length > 0) {
                console.log("[EditInvoice] Supplier dialog cancelled, prompting for New Product Details.");
                checkForNewProductsAndDetails(products);
            }
          }}
          isOpen={showSupplierDialog}
          onOpenChange={setShowSupplierDialog}
        />
      )}

      {showPaymentDueDateDialog && isNewScan && isSupplierConfirmed && (documentType === 'deliveryNote' || documentType === 'invoice') && (
        <PaymentDueDateDialog
          isOpen={showPaymentDueDateDialog}
          onOpenChange={setShowPaymentDueDateDialog}
          onConfirm={handlePaymentDueDateConfirm}
          onCancel={handleCancelPaymentDueDate}
        />
      )}


      {promptingForNewProductDetails && documentType === 'deliveryNote' && isBarcodePromptOpen && (
        <BarcodePromptDialog
          products={promptingForNewProductDetails}
          onComplete={handleNewProductDetailsComplete}
          isOpen={isBarcodePromptOpen}
          onOpenChange={(open) => {
              setIsBarcodePromptOpen(open);
              if (!open && promptingForNewProductDetails) { 
                  console.log("[EditInvoice] BarcodePromptDialog closed externally, treating as cancellation.");
                  handleNewProductDetailsComplete(null); 
              }
          }}
        />
      )}

      {priceDiscrepancies && documentType === 'deliveryNote' && (
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
