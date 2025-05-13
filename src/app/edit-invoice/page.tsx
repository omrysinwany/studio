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
    MAX_INVOICE_HISTORY_ITEMS,
    INVOICES_STORAGE_KEY_BASE,
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
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { Label } from '@/components/ui/label';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';


interface EditableProduct extends Product {
  _originalId?: string;
}

interface EditableTaxInvoiceDetails {
    supplierName?: string;
    invoiceNumber?: string;
    totalAmount?: number;
    invoiceDate?: string;
    paymentMethod?: string;
}

const formatInputValue = (value: number | undefined | null, fieldType: 'currency' | 'quantity' | 'stockLevel'): string => {
     if ((fieldType === 'currency' || fieldType === 'stockLevel') && (value === undefined || value === null)) {
        return '';
    }
    if (value === null || value === undefined || isNaN(value)) {
        return fieldType === 'currency' ? '0.00' : '0';
    }
    if (fieldType === 'currency') {
      return parseFloat(String(value)).toFixed(2);
    }
    return String(value);
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
  const [scanProcessError, setScanProcessError] = useState<string | null>(null);

  const [initialDataKey, setInitialDataKey] = useState<string | null>(null);
  const [initialTempInvoiceId, setInitialTempInvoiceId] = useState<string | null>(null);
  const [initialOriginalImagePreviewKey, setInitialOriginalImagePreviewKey] = useState<string | null>(null);
  const [initialCompressedImageKey, setInitialCompressedImageKey] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState<'deliveryNote' | 'invoice' | null>(null);

  const [isViewMode, setIsViewMode] = useState(true); // Start in view mode
  const [isEditingTaxDetails, setIsEditingTaxDetails] = useState(false);
  const [isEditingDeliveryNoteProducts, setIsEditingDeliveryNoteProducts] = useState(false);


  const [isNewScan, setIsNewScan] = useState(false);

  const [extractedInvoiceNumber, setExtractedInvoiceNumber] = useState<string | undefined>(undefined);
  const [extractedSupplierName, setExtractedSupplierName] = useState<string | undefined>(undefined);
  const [extractedTotalAmount, setExtractedTotalAmount] = useState<number | undefined>(undefined);
  const [extractedInvoiceDate, setExtractedInvoiceDate] = useState<string | undefined>(undefined);
  const [extractedPaymentMethod, setExtractedPaymentMethod] = useState<string | undefined>(undefined);

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
  const [aiScannedSupplierName, setAiScannedSupplierName] = useState<string | undefined>(undefined);

  const [showPaymentDueDateDialog, setShowPaymentDueDateDialog] = useState(false);
  const [selectedPaymentDueDate, setSelectedPaymentDueDate] = useState<string | Date | undefined>(undefined);


  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const cleanupTemporaryData = useCallback(() => {
    if (!user?.id) {
        console.warn("[EditInvoice] cleanupTemporaryData called, but user ID is missing.");
        return;
    }
    const uniqueScanIdToClear = initialTempInvoiceId ? initialTempInvoiceId.replace(`pending-inv-${user.id}_`, '') : (initialDataKey ? initialDataKey.replace(`${TEMP_DATA_KEY_PREFIX}${user.id}_`, '') : null);

    if (uniqueScanIdToClear) {
        clearTemporaryScanData(uniqueScanIdToClear, user.id);
        console.log(`[EditInvoice] Triggered cleanup for scan result associated with UserID: ${user.id}, Unique ID: ${uniqueScanIdToClear} using initial keys.`);
    } else {
        console.log("[EditInvoice] cleanupTemporaryData: No initialDataKey or tempInvoiceId found in state to derive uniqueIdToClear.");
    }
  }, [user?.id, initialDataKey, initialTempInvoiceId]);


  useEffect(() => {
    if (!user || initialDataLoaded) return;

    const keyParam = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    const tempInvIdParam = searchParams.get('tempInvoiceId');
    const compressedKeyParam = searchParams.get('compressedImageKey');
    const docTypeParam = searchParams.get('docType') as 'deliveryNote' | 'invoice' | null;
    const invoiceIdParam = searchParams.get('invoiceId');

    setInitialDataKey(keyParam);
    setInitialTempInvoiceId(tempInvIdParam);
    setInitialCompressedImageKey(compressedKeyParam);

    let uniquePartFromKeyOrTempId: string | null = null;
    if (keyParam?.startsWith(`${TEMP_DATA_KEY_PREFIX}${user.id}_`)) {
        uniquePartFromKeyOrTempId = keyParam.substring(`${TEMP_DATA_KEY_PREFIX}${user.id}_`.length);
    } else if (tempInvIdParam?.startsWith(`pending-inv-${user.id}_`)) {
        uniquePartFromKeyOrTempId = tempInvIdParam.substring(`pending-inv-${user.id}_`.length);
    }

    if (uniquePartFromKeyOrTempId) {
        setInitialOriginalImagePreviewKey(`${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${user.id}_${uniquePartFromKeyOrTempId}`);
    }


    if (nameParam) {
      setOriginalFileName(decodeURIComponent(nameParam));
    } else {
        setOriginalFileName(t('edit_invoice_unknown_document'));
    }
    setDocumentType(docTypeParam);
    setIsNewScan(!invoiceIdParam && !!keyParam);


    const loadData = async () => {
        setIsLoading(true);
        setErrorLoading(null);
        setScanProcessError(null);
        setIsViewMode(true); // Reset to view mode on new data load

        if (invoiceIdParam) {
            try {
                const inv = await getInvoicesService(user.id).then(all => all.find(i => i.id === invoiceIdParam));
                if (inv) {
                    let finalFileName = inv.fileName;
                    if(inv.supplier && inv.invoiceNumber) {
                        finalFileName = `${inv.supplier}_${inv.invoiceNumber}`;
                    } else if (inv.supplier) {
                        finalFileName = inv.supplier;
                    } else if (inv.invoiceNumber) {
                        finalFileName = `Invoice_${inv.invoiceNumber}`;
                    }
                    setOriginalFileName(finalFileName);
                    setDocumentType(inv.documentType);
                    setExtractedSupplierName(inv.supplier);
                    setExtractedInvoiceNumber(inv.invoiceNumber);
                    setExtractedTotalAmount(inv.totalAmount);
                    setExtractedInvoiceDate(inv.invoiceDate ? (inv.invoiceDate as string) : undefined);
                    setExtractedPaymentMethod(inv.paymentMethod);
                    setSelectedPaymentDueDate(inv.paymentDueDate);

                    const taxDetails = {
                        supplierName: inv.supplier,
                        invoiceNumber: inv.invoiceNumber,
                        totalAmount: inv.totalAmount,
                        invoiceDate: inv.invoiceDate ? (inv.invoiceDate as string) : undefined,
                        paymentMethod: inv.paymentMethod,
                    };
                    setEditableTaxInvoiceDetails(taxDetails);
                    setInitialScannedTaxDetails(taxDetails);

                    setDisplayedOriginalImageUrl(inv.originalImagePreviewUri || null);
                    setDisplayedCompressedImageUrl(inv.compressedImageForFinalRecordUri || null);

                    if (inv.documentType === 'deliveryNote' && Array.isArray((inv as any).products)) {
                       const loadedProducts = ((inv as any).products as Product[]).map((p: Product) => ({ ...p, _originalId: p.id }));
                       setProducts(loadedProducts);
                       setInitialScannedProducts(loadedProducts);
                    } else {
                        setProducts([]);
                        setInitialScannedProducts([]);
                    }
                    setIsSupplierConfirmed(true);
                    setIsViewMode(true);
                } else {
                    setErrorLoading(t('edit_invoice_error_invoice_not_found_id', { invoiceId: invoiceIdParam }));
                }
            } catch (e) {
                console.error("Error loading existing invoice:", e);
                setErrorLoading(t('edit_invoice_error_loading_existing'));
            }
        } else if (keyParam) {
            let storedData: string | null = null;
            try {
                storedData = localStorage.getItem(keyParam);
                if(initialOriginalImagePreviewKey) setDisplayedOriginalImageUrl(localStorage.getItem(initialOriginalImagePreviewKey));
                if(initialCompressedImageKey) setDisplayedCompressedImageUrl(localStorage.getItem(initialCompressedImageKey));

            } catch(e) {
                console.error("Error reading from localStorage for key:", keyParam, e);
                setErrorLoading(t('edit_invoice_error_localstorage_read'));
                cleanupTemporaryData();
                setIsLoading(false);
                setInitialDataLoaded(true);
                return;
            }

            if (!storedData) {
                setErrorLoading(t('edit_invoice_error_scan_results_not_found_key', {key: keyParam}));
                toast({
                  title: t('edit_invoice_toast_error_loading_title'),
                  description: t('edit_invoice_toast_error_loading_desc_not_found_with_key', {key: keyParam}),
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
              setScanProcessError(generalError);
            }

            if (docTypeParam === 'invoice') {
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
                setAiScannedSupplierName(taxData.supplierName);
                if (user?.id) checkSupplier(taxData.supplierName, user.id); else {setIsSupplierConfirmed(true); if (docTypeParam === 'invoice') { /* No payment due date for pure invoices initially */ } else { setShowPaymentDueDateDialog(true); }}


            } else if (docTypeParam === 'deliveryNote') {
                const productData = parsedData as ScanInvoiceOutput;
                if (productData && Array.isArray(productData.products)) {
                  const productsWithIds = productData.products.map((p: Product, index: number) => ({
                    ...p,
                    id: p.id || `prod-temp-${Date.now()}-${index}`,
                    _originalId: p.id,
                    quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                    lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
                     unitPrice: (typeof p.quantity === 'number' && p.quantity !== 0 && typeof p.lineTotal === 'number' && p.lineTotal !== 0)
                                ? parseFloat((p.lineTotal / p.quantity).toFixed(2))
                                : (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice)) || 0),
                    minStockLevel: p.minStockLevel ?? undefined,
                    maxStockLevel: p.maxStockLevel ?? undefined,
                  }));
                  setProducts(productsWithIds);
                  setInitialScannedProducts(productsWithIds);
                  // For delivery notes, populate editableTaxInvoiceDetails from the productData.invoice_details equivalent if available
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
                  setAiScannedSupplierName(productData.supplier);
                  setExtractedSupplierName(productData.supplier);
                  setExtractedTotalAmount(productData.totalAmount);
                  setExtractedInvoiceDate(productData.invoiceDate);
                  setExtractedPaymentMethod(productData.paymentMethod);
                  if (user?.id) checkSupplier(productData.supplier, user.id); else {setIsSupplierConfirmed(true); if (docTypeParam === 'invoice') { /* No payment due date for pure invoices initially */ } else { setShowPaymentDueDateDialog(true); }}
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
        } else if (!initialDataLoaded) {
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
    };

    if(user) loadData();
  }, [searchParams, user, toast, t, initialDataLoaded, cleanupTemporaryData, initialCompressedImageKey, initialDataKey, initialOriginalImagePreviewKey, initialTempInvoiceId]);


  const checkSupplier = async (scannedSupplierName?: string, currentUserId?: string) => {
    if (!currentUserId) {
        setIsSupplierConfirmed(true);
        if (documentType !== 'invoice') setShowPaymentDueDateDialog(true);
        return;
    }

    if (!scannedSupplierName) {
        setIsSupplierConfirmed(true);
         if (documentType !== 'invoice') setShowPaymentDueDateDialog(true);
        return;
    }

    try {
      const suppliers = await getSupplierSummariesService(currentUserId);
      setExistingSuppliers(suppliers);
      const isExisting = suppliers.some(s => s.name.toLowerCase() === scannedSupplierName.toLowerCase());
      if (isExisting) {
        setExtractedSupplierName(scannedSupplierName);
        setIsSupplierConfirmed(true);
        if (documentType !== 'invoice') setShowPaymentDueDateDialog(true);
      } else {
        setPotentialSupplierName(scannedSupplierName);
        setShowSupplierDialog(true);
      }
    } catch (error) {
      console.error("Error fetching existing suppliers:", error);
      toast({ title: t('edit_invoice_toast_error_fetching_suppliers'), variant: "destructive" });
      setExtractedSupplierName(scannedSupplierName);
      setIsSupplierConfirmed(true);
      if (documentType !== 'invoice') setShowPaymentDueDateDialog(true);
    }
  };

  const handleSupplierConfirmation = async (confirmedSupplierName: string | null, isNew: boolean = false) => {
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
      setExtractedSupplierName(aiScannedSupplierName);
      setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: aiScannedSupplierName }));
    }
    setIsSupplierConfirmed(true);
    if (documentType === 'invoice') { /* No payment due date for pure invoices */ } else { setShowPaymentDueDateDialog(true); }
  };

  const handlePaymentDueDateConfirm = (dueDate: string | Date | undefined) => {
    setSelectedPaymentDueDate(dueDate);
    setShowPaymentDueDateDialog(false);
};


  const handleInputChange = (id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(p => {
        if (p.id === id) {
          const updatedProduct = { ...p };
          let numericValue: number | string | undefined = value;

          if (['quantity', 'unitPrice', 'lineTotal', 'minStockLevel', 'maxStockLevel'].includes(field)) {
            const stringValue = String(value);
            if ((field === 'minStockLevel' || field === 'maxStockLevel') && stringValue.trim() === '') {
              numericValue = undefined;
            } else {
              numericValue = parseFloat(stringValue.replace(/,/g, ''));
              if (isNaN(numericValue as number)) {
                numericValue = (field === 'minStockLevel' || field === 'maxStockLevel') ? undefined : 0;
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
             if (currentQuantity > 0 && currentUnitPrice !== 0) {
                currentLineTotal = parseFloat((currentQuantity * currentUnitPrice).toFixed(2));
             } else if (currentQuantity === 0 || currentUnitPrice === 0) {
                currentLineTotal = 0;
             }
            updatedProduct.lineTotal = currentLineTotal;
          } else if (field === 'lineTotal') {
            if (currentQuantity > 0) {
              currentUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
              updatedProduct.unitPrice = currentUnitPrice;
            } else {
                updatedProduct.unitPrice = (currentLineTotal === 0) ? 0 : currentUnitPrice;
            }
          }


          if (currentQuantity > 0 && currentLineTotal !== 0) {
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

  const handleTaxInvoiceDetailsChange = (field: keyof EditableTaxInvoiceDetails, value: string | number | undefined) => {
     setEditableTaxInvoiceDetails(prev => ({ ...prev, [field]: value }));
        switch(field) {
            case 'supplierName': setExtractedSupplierName(String(value || '')); break;
            case 'invoiceNumber': setExtractedInvoiceNumber(String(value || '')); break;
            case 'totalAmount': setExtractedTotalAmount(Number(value || 0)); break;
            case 'invoiceDate': setExtractedInvoiceDate(String(value || '')); break;
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

          const result = await finalizeSaveProductsService(
            productsForService,
            finalFileNameForSave,
            documentType,
            user.id,
            initialTempInvoiceId || undefined,
            finalInvoiceNumberForSave,
            finalSupplierNameForSave,
            finalTotalAmountForSave,
            selectedPaymentDueDate,
            finalInvoiceDateForSave,
            finalPaymentMethodForSave,
            displayedOriginalImageUrl || undefined,
            displayedCompressedImageUrl || undefined
          );

          cleanupTemporaryData();

          if (result.finalInvoiceRecord) {
            setOriginalFileName(result.finalInvoiceRecord.fileName);
            setInitialTempInvoiceId(result.finalInvoiceRecord.id);
            setDocumentType(result.finalInvoiceRecord.documentType);
            setExtractedSupplierName(result.finalInvoiceRecord.supplier);
            setExtractedInvoiceNumber(result.finalInvoiceRecord.invoiceNumber);
            setExtractedTotalAmount(result.finalInvoiceRecord.totalAmount);
            setExtractedInvoiceDate(result.finalInvoiceRecord.invoiceDate ? (result.finalInvoiceRecord.invoiceDate as string) : undefined);
            setExtractedPaymentMethod(result.finalInvoiceRecord.paymentMethod);
            setSelectedPaymentDueDate(result.finalInvoiceRecord.paymentDueDate);
            setDisplayedOriginalImageUrl(result.finalInvoiceRecord.originalImagePreviewUri || null);
            setDisplayedCompressedImageUrl(result.finalInvoiceRecord.compressedImageForFinalRecordUri || null);

            if (result.savedProductsWithFinalIds) {
                const finalProducts = result.savedProductsWithFinalIds.map(p => ({ ...p, _originalId: p.id }));
                setProducts(finalProducts);
                setInitialScannedProducts(finalProducts);
            }
            const finalTaxDetails = {
                supplierName: result.finalInvoiceRecord.supplier,
                invoiceNumber: result.finalInvoiceRecord.invoiceNumber,
                totalAmount: result.finalInvoiceRecord.totalAmount,
                invoiceDate: result.finalInvoiceRecord.invoiceDate ? (result.finalInvoiceRecord.invoiceDate as string) : undefined,
                paymentMethod: result.finalInvoiceRecord.paymentMethod,
            };
            setEditableTaxInvoiceDetails(finalTaxDetails);
            setInitialScannedTaxDetails(finalTaxDetails);

            setScanProcessError(result.finalInvoiceRecord.errorMessage || null);
            setIsViewMode(true); // Switch to view mode after successful save
             toast({
                title: t('edit_invoice_toast_products_saved_title'),
                description: t('edit_invoice_toast_products_saved_desc'),
            });
          } else {
            throw new Error(t('edit_invoice_toast_save_failed_desc_finalize', { message: "Final invoice record not returned."}));
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
          if(error.uniqueScanIdToClear && user?.id){
             clearTemporaryScanData(error.uniqueScanIdToClear, user.id);
          }
      } finally {
          setIsSaving(false);
      }
  };

  const proceedWithFinalSaveForTaxInvoice = async () => {
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

      const result = await finalizeSaveProductsService(
        [],
        finalFileNameForSave,
        documentType,
        user.id,
        initialTempInvoiceId || undefined,
        finalInvoiceNumberForSave,
        finalSupplierNameForSave,
        finalTotalAmountForSave,
        selectedPaymentDueDate,
        finalInvoiceDateForSave,
        finalPaymentMethodForSave,
        displayedOriginalImageUrl || undefined,
        displayedCompressedImageUrl || undefined
      );

      cleanupTemporaryData();

      if (result.finalInvoiceRecord) {
        setOriginalFileName(result.finalInvoiceRecord.fileName);
        setInitialTempInvoiceId(result.finalInvoiceRecord.id);
        setDocumentType(result.finalInvoiceRecord.documentType);
        setExtractedSupplierName(result.finalInvoiceRecord.supplier);
        setExtractedInvoiceNumber(result.finalInvoiceRecord.invoiceNumber);
        setExtractedTotalAmount(result.finalInvoiceRecord.totalAmount);
        setExtractedInvoiceDate(result.finalInvoiceRecord.invoiceDate ? (result.finalInvoiceRecord.invoiceDate as string) : undefined);
        setExtractedPaymentMethod(result.finalInvoiceRecord.paymentMethod);
        setSelectedPaymentDueDate(result.finalInvoiceRecord.paymentDueDate);
        setDisplayedOriginalImageUrl(result.finalInvoiceRecord.originalImagePreviewUri || null);
        setDisplayedCompressedImageUrl(result.finalInvoiceRecord.compressedImageForFinalRecordUri || null);

        setProducts([]);
        setInitialScannedProducts([]);
        const finalTaxDetails = {
             supplierName: result.finalInvoiceRecord.supplier,
             invoiceNumber: result.finalInvoiceRecord.invoiceNumber,
             totalAmount: result.finalInvoiceRecord.totalAmount,
             invoiceDate: result.finalInvoiceRecord.invoiceDate ? (result.finalInvoiceRecord.invoiceDate as string) : undefined,
             paymentMethod: result.finalInvoiceRecord.paymentMethod,
        };
        setEditableTaxInvoiceDetails(finalTaxDetails);
        setInitialScannedTaxDetails(finalTaxDetails);
        setScanProcessError(result.finalInvoiceRecord.errorMessage || null);
        setIsViewMode(true); // Switch to view mode after successful save
        toast({
            title: t('edit_invoice_toast_invoice_details_saved_title'),
            description: t('edit_invoice_toast_invoice_details_saved_desc'),
        });
      } else {
        throw new Error(t('edit_invoice_toast_save_failed_desc_finalize', { message: "Final invoice record not returned for tax invoice."}));
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
        if(error.uniqueScanIdToClear && user?.id){
            clearTemporaryScanData(error.uniqueScanIdToClear, user.id);
        }
    } finally {
      setIsSaving(false);
    }
  };


 const handleSaveChecks = async () => {
    if (!isSupplierConfirmed) {
        if (user?.id && (extractedSupplierName || aiScannedSupplierName)) {
            checkSupplier(extractedSupplierName || aiScannedSupplierName, user.id);
        } else {
            setIsSupplierConfirmed(true);
            if (documentType !== 'invoice') { setShowPaymentDueDateDialog(true); }
        }
        return;
    }

    if (documentType !== 'invoice' && !selectedPaymentDueDate) {
        setShowPaymentDueDateDialog(true);
        return;
    }

    proceedWithActualSave();
};

const proceedWithActualSave = async () => {
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        return;
    }

    if (documentType === 'invoice') {
        await proceedWithFinalSaveForTaxInvoice();
        return;
    }

    setIsSaving(true);
    try {
        const productsFromEdit = products.map(({ _originalId, ...rest }) => rest);
        const priceCheckResult = await checkProductPricesBeforeSaveService(productsFromEdit, user.id);

        setProductsForNextStep(priceCheckResult.productsToSaveDirectly);

        if (priceCheckResult.priceDiscrepancies.length > 0) {
            setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
            setIsSaving(false);
        } else {
            await checkForNewProductsAndDetails(priceCheckResult.productsToSaveDirectly);
        }
    } catch (error) {
        console.error("Error during initial save checks for delivery note:", error);
        toast({
            title: t('edit_invoice_toast_error_preparing_save_title'),
            description: t('edit_invoice_toast_error_preparing_save_desc', { message: (error as Error).message}),
            variant: "destructive",
        });
        setIsSaving(false);
    }
};


const checkForNewProductsAndDetails = async (productsReadyForDetailCheck: Product[]) => {
    setIsSaving(true);
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setIsSaving(false);
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
            const needsSalePrice = p.salePrice === undefined || p.salePrice === null;
            return isProductConsideredNew || needsSalePrice;
        });

        if (newProductsNeedingDetails.length > 0) {
            setProductsForNextStep(productsReadyForDetailCheck);
            setPromptingForNewProductDetails(newProductsNeedingDetails);
            setIsBarcodePromptOpen(true);
            setIsSaving(false);
        } else {
            await proceedWithFinalSave(productsReadyForDetailCheck);
        }
    } catch (error) {
        console.error("Error checking inventory for new product details prompt:", error);
        toast({
            title: t('edit_invoice_toast_error_new_product_details_title'),
            description: t('edit_invoice_toast_error_new_product_details_desc'),
            variant: "destructive",
        });
        setIsSaving(false);
    }
};


const handlePriceConfirmationComplete = (resolvedProducts: Product[] | null) => {
    setPriceDiscrepancies(null);
    if (resolvedProducts) {
        const updatedProductsForNextStep = productsForNextStep.map(originalProduct => {
            const resolvedVersion = resolvedProducts.find(rp => rp.id === originalProduct.id);
            return resolvedVersion ? { ...originalProduct, unitPrice: resolvedVersion.unitPrice } : originalProduct;
        });
        setProductsForNextStep(updatedProductsForNextStep);
        checkForNewProductsAndDetails(updatedProductsForNextStep);
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
     setPromptingForNewProductDetails(null);
     setIsBarcodePromptOpen(false);

     if (updatedNewProductsFromDialog) {
         const finalProductsToSave = productsForNextStep.map(originalProduct => {
             const updatedVersion = updatedNewProductsFromDialog.find(unp =>
                 (originalProduct.id && unp.id === originalProduct.id) ||
                 (!originalProduct.id.startsWith('prod-temp-') && unp.catalogNumber === originalProduct.catalogNumber)
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
        cleanupTemporaryData();
        router.push('/upload');
    };

    const handleCancelEditTaxDetails = () => {
        setEditableTaxInvoiceDetails(initialScannedTaxDetails);
        if (documentType === 'deliveryNote') {
          setExtractedSupplierName(initialScannedTaxDetails.supplierName);
          setExtractedInvoiceNumber(initialScannedTaxDetails.invoiceNumber);
          setExtractedTotalAmount(initialScannedTaxDetails.totalAmount);
          setExtractedInvoiceDate(initialScannedTaxDetails.invoiceDate);
          setExtractedPaymentMethod(initialScannedTaxDetails.paymentMethod);
        }
        setIsEditingTaxDetails(false);
        setIsViewMode(true);
    };

    const handleSaveEditTaxDetails = () => {
        if (documentType === 'invoice') {
            setExtractedSupplierName(editableTaxInvoiceDetails.supplierName);
            setExtractedInvoiceNumber(editableTaxInvoiceDetails.invoiceNumber);
            setExtractedTotalAmount(editableTaxInvoiceDetails.totalAmount);
            setExtractedInvoiceDate(editableTaxInvoiceDetails.invoiceDate);
            setExtractedPaymentMethod(editableTaxInvoiceDetails.paymentMethod);
        } else if (documentType === 'deliveryNote') {
             setExtractedSupplierName(editableTaxInvoiceDetails.supplierName);
            setExtractedInvoiceNumber(editableTaxInvoiceDetails.invoiceNumber);
            setExtractedTotalAmount(editableTaxInvoiceDetails.totalAmount);
            setExtractedInvoiceDate(editableTaxInvoiceDetails.invoiceDate);
            setExtractedPaymentMethod(editableTaxInvoiceDetails.paymentMethod);
        }
        setInitialScannedTaxDetails({...editableTaxInvoiceDetails}); // Update initial for next view/edit
        setIsEditingTaxDetails(false);
        setIsViewMode(true);
        toast({ title: t('edit_invoice_toast_section_updated_title'), description: t('edit_invoice_toast_section_updated_desc') });
    };

    const handleCancelEditProducts = () => {
        setProducts(initialScannedProducts.map(p => ({...p})));
        setIsEditingDeliveryNoteProducts(false);
        setIsViewMode(true);
    };

    const handleSaveEditProducts = () => {
        setInitialScannedProducts(products.map(p => ({...p}))); // Update initial for next view/edit
        setIsEditingDeliveryNoteProducts(false);
        setIsViewMode(true);
        toast({ title: t('edit_invoice_toast_products_updated_title_section'), description: t('edit_invoice_toast_section_updated_desc') });
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

    if (initialDataLoaded && documentType === 'deliveryNote' && products.length === 0 && !errorLoading && !scanProcessError && isNewScan) {
         return (
             <div className="container mx-auto p-4 md:p-8 space-y-4">
                 <Alert variant="default">
                     <AlertTitle>{t('edit_invoice_no_products_found_title')}</AlertTitle>
                     <AlertDescription>
                        {t('edit_invoice_no_products_found_desc')}
                     </AlertDescription>
                 </Alert>
                 <Card className="shadow-md scale-fade-in">
                     <CardHeader>
                         <CardTitle className="text-xl sm:text-2xl font-semibold text-primary">{t('edit_invoice_add_manually_title')}</CardTitle>
                         <CardDescription>
                            {t('edit_invoice_file')}: <span className="font-medium">{originalFileName || t('edit_invoice_unknown_document')}</span>
                         </CardDescription>
                     </CardHeader>
                      <CardContent>
                           <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                             <Button variant="outline" onClick={() => { handleAddRow(); setIsViewMode(false); setIsEditingDeliveryNoteProducts(true); }} className="w-full sm:w-auto">
                               <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                             </Button>
                             <Button onClick={handleSaveChecks} disabled={isSaving || !isSupplierConfirmed || (documentType !== 'invoice' && !selectedPaymentDueDate)} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
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

     if (scanProcessError && ((documentType === 'deliveryNote' && products.length === 0) || (documentType === 'invoice' && Object.values(editableTaxInvoiceDetails).every(val => val === undefined || val === '' || val === 0) )) && isNewScan ) {
        return (
            <div className="container mx-auto p-4 md:p-8 space-y-4">
                <Alert variant="destructive">
                    <AlertTitle>{t('edit_invoice_scan_process_error_title')}</AlertTitle>
                    <AlertDescription>
                        {t('edit_invoice_scan_process_error_desc', { error: scanProcessError })}
                    </AlertDescription>
                </Alert>
                 <Card className="shadow-md scale-fade-in">
                     <CardHeader>
                         <CardTitle className="text-xl sm:text-2xl font-semibold text-primary">{t('edit_invoice_add_manually_title')}</CardTitle>
                         <CardDescription>
                           {t('edit_invoice_file')}: <span className="font-medium">{originalFileName || t('edit_invoice_unknown_document')}</span>
                         </CardDescription>
                     </CardHeader>
                      <CardContent>
                           {documentType === 'deliveryNote' && (
                             <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                                <Button variant="outline" onClick={() => { handleAddRow(); setIsViewMode(false); setIsEditingDeliveryNoteProducts(true); }} className="w-full sm:w-auto">
                                <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                                </Button>
                                <Button onClick={handleSaveChecks} disabled={isSaving || products.length === 0 || !isSupplierConfirmed || (documentType !== 'invoice' && !selectedPaymentDueDate)} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
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
                                <div className="mt-4">
                                    {renderEditableTaxInvoiceDetails()}
                                    <Button onClick={handleSaveChecks} disabled={isSaving || !isSupplierConfirmed || (documentType === 'invoice' && !selectedPaymentDueDate)} className="bg-primary hover:bg-primary/90 w-full sm:w-auto mt-4">
                                     {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {t('edit_invoice_save_changes_button')}</>}
                                    </Button>
                                </div>
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

    const renderScanSummaryItem = (label: string, value?: string | number | null, field?: keyof EditableTaxInvoiceDetails) => {
        if (value === undefined || value === null || String(value).trim() === '') return null;
        return (
            <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="font-medium">
                    {typeof value === 'number' ? t('currency_symbol') + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2}) : (field === 'invoiceDate' && value && isValid(parseISO(value as string)) ? format(parseISO(value as string), 'PP') : value) }
                </p>
            </div>
        );
    };

    const renderReadOnlyProductItem = (product: EditableProduct, isSummary: boolean = false) => (
        <TableRow key={`view-${product.id}`}>
            <TableCell className="px-2 sm:px-4 py-2">{product.catalogNumber || 'N/A'}</TableCell>
            <TableCell className="px-2 sm:px-4 py-2">{product.shortName || product.description || 'N/A'}</TableCell>
            {!isSummary && <TableCell className="hidden md:table-cell px-2 sm:px-4 py-2">{product.description || 'N/A'}</TableCell>}
            <TableCell className="text-right px-2 sm:px-4 py-2">{formatInputValue(product.quantity, 'quantity')}</TableCell>
            <TableCell className="text-right px-2 sm:px-4 py-2">{t('currency_symbol')}{formatInputValue(product.unitPrice, 'currency')}</TableCell>
            <TableCell className="text-right px-2 sm:px-4 py-2">{t('currency_symbol')}{formatInputValue(product.lineTotal, 'currency')}</TableCell>
        </TableRow>
    );

    const renderEditableProductItem = (product: EditableProduct) => (
         <TableRow key={product.id}>
            <TableCell className="px-2 sm:px-4 py-2">
                <Input
                value={product.catalogNumber || ''}
                onChange={(e) => handleInputChange(product.id, 'catalogNumber', e.target.value)}
                className="min-w-[100px] h-9"
                aria-label={t('edit_invoice_aria_catalog', { description: product.description || '' })}
                />
            </TableCell>
            <TableCell className="px-2 sm:px-4 py-2">
                <Input
                value={product.description || ''}
                onChange={(e) => handleInputChange(product.id, 'description', e.target.value)}
                className="min-w-[150px] sm:min-w-[200px] h-9"
                aria-label={t('edit_invoice_aria_description', { catalogNumber: product.catalogNumber || '' })}
                />
            </TableCell>
            <TableCell className="text-right px-2 sm:px-4 py-2">
                <Input
                type="number"
                value={formatInputValue(product.quantity, 'quantity')}
                onChange={(e) => handleInputChange(product.id, 'quantity', e.target.value)}
                className="w-20 sm:w-24 text-right h-9"
                min="0"
                step="any"
                aria-label={t('edit_invoice_aria_qty', { description: product.description || '' })}
                />
            </TableCell>
            <TableCell className="text-right px-2 sm:px-4 py-2">
                <Input
                type="number"
                value={formatInputValue(product.unitPrice, 'currency')}
                onChange={(e) => handleInputChange(product.id, 'unitPrice', e.target.value)}
                className="w-24 sm:w-28 text-right h-9"
                step="0.01"
                min="0"
                aria-label={t('edit_invoice_aria_unit_price', { description: product.description || '' })}
                />
            </TableCell>
            <TableCell className="text-right px-2 sm:px-4 py-2">
                <Input
                type="number"
                value={formatInputValue(product.lineTotal, 'currency')}
                onChange={(e) => handleInputChange(product.id, 'lineTotal', e.target.value)}
                className="w-24 sm:w-28 text-right h-9"
                step="0.01"
                min="0"
                aria-label={t('edit_invoice_aria_line_total', { description: product.description || '' })}
                />
            </TableCell>
            <TableCell className="text-right px-2 sm:px-4 py-2">
                <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveRow(product.id)}
                className="text-destructive hover:text-destructive/80 h-8 w-8"
                aria-label={t('edit_invoice_aria_remove_row', { description: product.description || '' })}
                >
                <Trash2 className="h-4 w-4" />
                </Button>
            </TableCell>
        </TableRow>
    );

    const renderReadOnlyTaxInvoiceDetails = () => {
        const detailsToDisplay = (documentType === 'invoice' && initialScannedTaxDetails && Object.keys(initialScannedTaxDetails).length > 0 && !isEditingTaxDetails) ? initialScannedTaxDetails :
            {
                supplierName: extractedSupplierName,
                invoiceNumber: extractedInvoiceNumber,
                totalAmount: extractedTotalAmount,
                invoiceDate: extractedInvoiceDate,
                paymentMethod: extractedPaymentMethod,
            };

        const noDetailsAvailable = Object.values(detailsToDisplay).every(
             val => val === undefined || val === null || String(val).trim() === ''
        );

        if (noDetailsAvailable) {
            return <p className="text-sm text-muted-foreground">{t('edit_invoice_no_details_extracted')}</p>;
        }

        return (
             <div className="space-y-3">
                {renderScanSummaryItem(t('invoice_details_supplier_label'), detailsToDisplay.supplierName)}
                {renderScanSummaryItem(t('invoice_details_invoice_number_label'), detailsToDisplay.invoiceNumber)}
                {renderScanSummaryItem(t('invoice_details_total_amount_label'), detailsToDisplay.totalAmount)}
                {renderScanSummaryItem(t('invoice_details_invoice_date_label'), detailsToDisplay.invoiceDate, 'invoiceDate')}
                {renderScanSummaryItem(t('invoice_details_payment_method_label'), detailsToDisplay.paymentMethod)}
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
                    value={editableTaxInvoiceDetails.invoiceDate && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate)) ? format(parseISO(editableTaxInvoiceDetails.invoiceDate), 'yyyy-MM-dd') : ''}
                    onChange={(e) => handleTaxInvoiceDetailsChange('invoiceDate', e.target.value ? parseISO(e.target.value).toISOString() : undefined)}
                    disabled={isSaving}
                />
            </div>
            <div>
                <Label htmlFor="taxPaymentMethod">{t('invoice_details_payment_method_label')}</Label>
                <Input id="taxPaymentMethod" value={editableTaxInvoiceDetails.paymentMethod || ''} onChange={(e) => handleTaxInvoiceDetailsChange('paymentMethod', e.target.value)} disabled={isSaving} />
            </div>
        </div>
    );


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md scale-fade-in overflow-hidden"> {/* Added overflow-hidden */}
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <FileTextIconLucide className="mr-2 h-5 w-5" />
            {t('edit_invoice_scan_summary_title')}
          </CardTitle>
          <CardDescription>
             {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
             {(documentType === 'invoice' ? (isEditingTaxDetails ? editableTaxInvoiceDetails.supplierName : (initialScannedTaxDetails.supplierName || extractedSupplierName)) : (isEditingTaxDetails ? editableTaxInvoiceDetails.supplierName : extractedSupplierName)) &&
                ` | ${t('edit_invoice_supplier', { supplierName: (documentType === 'invoice' ? (isEditingTaxDetails ? editableTaxInvoiceDetails.supplierName : (initialScannedTaxDetails.supplierName || extractedSupplierName)) : (isEditingTaxDetails ? editableTaxInvoiceDetails.supplierName : extractedSupplierName)) })}`}
          </CardDescription>
           {scanProcessError && !isSaving && ( // Only show if not currently saving (save error handled by toast)
             <Alert variant="destructive" className="mt-2">
                <AlertTitle>{t('edit_invoice_scan_process_error_title')}</AlertTitle>
                <AlertDescription>{scanProcessError}</AlertDescription>
             </Alert>
           )}
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="border rounded-lg p-4">
                <div className="flex flex-row items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold">{documentType === 'invoice' ? t('edit_invoice_tax_invoice_details_title') : t('edit_invoice_extracted_details_title')}</h3>
                    {!isEditingTaxDetails && isViewMode && (
                        <Button variant="ghost" size="icon" onClick={() => { setIsEditingTaxDetails(true); setIsViewMode(false); }} className="h-8 w-8 text-muted-foreground hover:text-primary">
                            <Edit className="h-4 w-4" />
                            <span className="sr-only">{t('edit_button')}</span>
                        </Button>
                    )}
                </div>
                {isEditingTaxDetails ? renderEditableTaxInvoiceDetails() : renderReadOnlyTaxInvoiceDetails()}
                 {isEditingTaxDetails && (
                    <CardFooter className="flex justify-end gap-2 pt-4 px-0 pb-0">
                        <Button variant="outline" onClick={handleCancelEditTaxDetails} disabled={isSaving}>{t('cancel_button')}</Button>
                        <Button onClick={handleSaveEditTaxDetails} disabled={isSaving}>{t('save_button')}</Button>
                    </CardFooter>
                )}
            </div>


            {documentType === 'deliveryNote' && (
                 <div className="mt-6">
                     <div className="flex flex-row items-center justify-between mb-2">
                         <h2 className="text-lg font-semibold text-primary">{t('edit_invoice_extracted_products_title')} ({products.length})</h2>
                         {!isEditingDeliveryNoteProducts && isViewMode && (
                             <Button variant="ghost" size="icon" onClick={() => { setIsEditingDeliveryNoteProducts(true); setIsViewMode(false); }} className="h-8 w-8 text-muted-foreground hover:text-primary">
                                 <Edit className="h-4 w-4" />
                                 <span className="sr-only">{t('edit_button')}</span>
                             </Button>
                         )}
                     </div>
                     {products.length > 0 ? (
                         <div className="overflow-x-auto relative border rounded-md">
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
                                 {products.map(product => isEditingDeliveryNoteProducts ? renderEditableProductItem(product) : renderReadOnlyProductItem(product, true))}
                             </TableBody>
                             </Table>
                         </div>
                     ) : (
                         <p className="text-muted-foreground">{t('edit_invoice_no_products_in_scan')}</p>
                     )}
                     {isEditingDeliveryNoteProducts && (
                         <div className="flex justify-between items-center pt-4 mt-2 border-t">
                             <Button variant="outline" onClick={handleAddRow}>
                                 <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                             </Button>
                             <div className="flex gap-2">
                                <Button variant="outline" onClick={handleCancelEditProducts} disabled={isSaving}>{t('cancel_button')}</Button>
                                <Button onClick={handleSaveEditProducts} disabled={isSaving || products.length === 0}>{t('save_button')}</Button>
                             </div>
                         </div>
                     )}
                 </div>
            )}
             {displayedOriginalImageUrl && (
                <div className="border rounded-lg p-4 mt-6">
                    <h3 className="text-lg font-semibold mb-2">{t('edit_invoice_image_preview_label')}</h3>
                    <NextImage src={displayedOriginalImageUrl} alt={t('edit_invoice_image_preview_alt')} width={600} height={850} className="rounded-md border shadow-md max-w-full h-auto" data-ai-hint="document scan" />
                </div>
            )}
            <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
                <Button variant="outline" onClick={isNewScan ? handleGoBack : () => router.push('/invoices')} className="w-full sm:w-auto order-last sm:order-first">
                    <ArrowLeft className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_discard_scan_button') : t('edit_invoice_go_back_to_invoices_button')}
                </Button>
                {(isViewMode || isNewScan) && ( // Show save only in view mode or if it's a new scan
                     <div className="flex-grow flex flex-col sm:flex-row sm:justify-end gap-3">
                        <Button
                            onClick={handleSaveChecks}
                            disabled={isSaving || !isSupplierConfirmed || (documentType !== 'invoice' && !selectedPaymentDueDate) || isEditingTaxDetails || isEditingDeliveryNoteProducts}
                            className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                        >
                            {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {isNewScan ? t('edit_invoice_confirm_and_save_button') : t('edit_invoice_save_changes_button')}</>}
                        </Button>
                    </div>
                )}
            </div>
        </CardContent>
      </Card>

       {showSupplierDialog && potentialSupplierName && (
        <SupplierConfirmationDialog
          potentialSupplierName={potentialSupplierName}
          existingSuppliers={existingSuppliers}
          onConfirm={handleSupplierConfirmation}
          onCancel={() => {
            setShowSupplierDialog(false);
            setIsSupplierConfirmed(true);
            setExtractedSupplierName(aiScannedSupplierName);
            setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: aiScannedSupplierName }));
            if (documentType !== 'invoice') { setShowPaymentDueDateDialog(true); }
          }}
          isOpen={showSupplierDialog}
          onOpenChange={setShowSupplierDialog}
        />
      )}

      {showPaymentDueDateDialog && isSupplierConfirmed && (
        <PaymentDueDateDialog
          isOpen={showPaymentDueDateDialog}
          onOpenChange={setShowPaymentDueDateDialog}
          onConfirm={handlePaymentDueDateConfirm}
          onCancel={() => {
            setShowPaymentDueDateDialog(false);
            toast({title: t('edit_invoice_toast_payment_due_date_skipped_title'), description: t('edit_invoice_toast_payment_due_date_skipped_desc'), variant: "default"});
            setSelectedPaymentDueDate(undefined);
          }}
        />
      )}


      {promptingForNewProductDetails && documentType === 'deliveryNote' && (
        <BarcodePromptDialog
          products={promptingForNewProductDetails}
          onComplete={(updatedProducts) => {
            setIsBarcodePromptOpen(false);
            setPromptingForNewProductDetails(null);

            if (updatedProducts) {
                const fullyDetailedProducts = productsForNextStep.map(originalProd => {
                    const updatedDetails = updatedProducts.find(upd => upd.id === originalProd.id);
                    return updatedDetails ? { ...originalProd, ...updatedDetails } : originalProd;
                });
                proceedWithFinalSave(fullyDetailedProducts);
            } else {
                toast({
                    title: t('edit_invoice_toast_save_incomplete_title'),
                    description: t('edit_invoice_toast_save_incomplete_desc_details'),
                    variant: "default",
                });
                setIsSaving(false);
            }
          }}
          isOpen={isBarcodePromptOpen}
          onOpenChange={(open) => {
              setIsBarcodePromptOpen(open);
              if (!open && promptingForNewProductDetails) {
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
