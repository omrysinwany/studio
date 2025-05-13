// src/app/edit-invoice/page.tsx
'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, PlusCircle, Save, Loader2, ArrowLeft, Edit, Eye, FileText as FileTextIconLucide } from 'lucide-react';
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
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [errorLoading, setErrorLoading] = useState<string | null>(null);
  const [scanProcessError, setScanProcessError] = useState<string | null>(null);

  // States to store the initial temporary keys
  const [initialDataKey, setInitialDataKey] = useState<string | null>(null);
  const [initialTempInvoiceId, setInitialTempInvoiceId] = useState<string | null>(null);
  const [initialOriginalImagePreviewKey, setInitialOriginalImagePreviewKey] = useState<string | null>(null);
  const [initialCompressedImageKey, setInitialCompressedImageKey] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState<'deliveryNote' | 'invoice' | null>(null);

  const [isViewMode, setIsViewMode] = useState(true);

  const [extractedInvoiceNumber, setExtractedInvoiceNumber] = useState<string | undefined>(undefined);
  const [extractedSupplierName, setExtractedSupplierName] = useState<string | undefined>(undefined);
  const [extractedTotalAmount, setExtractedTotalAmount] = useState<number | undefined>(undefined);
  const [extractedInvoiceDate, setExtractedInvoiceDate] = useState<string | undefined>(undefined);
  const [extractedPaymentMethod, setExtractedPaymentMethod] = useState<string | undefined>(undefined);
  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] = useState<EditableTaxInvoiceDetails>({});

  // State for displaying images
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

  const cleanupTemporaryDataAfterSave = useCallback(() => {
    if (!user?.id) {
        console.warn("[EditInvoice] cleanupTemporaryDataAfterSave called, but user ID is missing.");
        return;
    }
    // Use the initial keys stored in state for cleanup
    const uniqueIdToClear = initialTempInvoiceId ? initialTempInvoiceId.replace(`pending-inv-${user.id}_`, '') : (initialDataKey ? initialDataKey.replace(`${TEMP_DATA_KEY_PREFIX}${user.id}_`, '') : null);

    if (uniqueIdToClear) {
        clearTemporaryScanData(uniqueIdToClear, user.id);
        console.log(`[EditInvoice] Triggered cleanup for scan result associated with UserID: ${user.id}, Unique ID: ${uniqueIdToClear} using initial keys.`);
    } else {
        console.log("[EditInvoice] cleanupTemporaryDataAfterSave: No initial dataKey or tempInvoiceId found in state to derive uniqueIdToClear.");
    }
  }, [user?.id, initialDataKey, initialTempInvoiceId]);


  useEffect(() => {
    if (!user || initialDataLoaded) return;

    const keyParam = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    const tempInvIdParam = searchParams.get('tempInvoiceId');
    const compressedKeyParam = searchParams.get('compressedImageKey');
    const docTypeParam = searchParams.get('docType') as 'deliveryNote' | 'invoice' | null;
    const invoiceIdParam = searchParams.get('invoiceId'); // For loading existing invoices

    // Store initial keys for cleanup later
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


    const loadData = async () => {
        setIsLoading(true);
        setErrorLoading(null);
        setScanProcessError(null);

        if (invoiceIdParam) { // Loading an existing, finalized invoice
            try {
                const inv = await getInvoicesService(user.id).then(all => all.find(i => i.id === invoiceIdParam));
                if (inv) {
                    setOriginalFileName(inv.fileName);
                    setDocumentType(inv.documentType);
                    setExtractedSupplierName(inv.supplier);
                    setExtractedInvoiceNumber(inv.invoiceNumber);
                    setExtractedTotalAmount(inv.totalAmount);
                    setExtractedInvoiceDate(inv.invoiceDate ? (inv.invoiceDate as string) : undefined);
                    setExtractedPaymentMethod(inv.paymentMethod);
                    setSelectedPaymentDueDate(inv.paymentDueDate);
                    setEditableTaxInvoiceDetails({ // Also set for tax invoices
                        supplierName: inv.supplier,
                        invoiceNumber: inv.invoiceNumber,
                        totalAmount: inv.totalAmount,
                        invoiceDate: inv.invoiceDate ? (inv.invoiceDate as string) : undefined,
                        paymentMethod: inv.paymentMethod,
                    });
                    setDisplayedOriginalImageUrl(inv.originalImagePreviewUri || null);
                    setDisplayedCompressedImageUrl(inv.compressedImageForFinalRecordUri || null);

                    if (inv.documentType === 'deliveryNote') {
                        // This part is tricky: products are not directly linked to invoices in current localStorage setup.
                        // For simplicity, when viewing an existing delivery note, we might show all products or none.
                        // Or, ideally, the products that were part of THIS invoice (would require linking products to invoices)
                        // For now, let's assume we can't easily get *just* the products for *this* invoice.
                        // We could load all products and the user edits them in context of the supplier/invoice number.
                        // Or, if `finalizeSaveProductsService` returned the products for THIS invoice, we'd load those.
                        // For now, we will clear products for existing, assuming user will re-add if needed or this page is for review.
                        // This is a limitation of not having a relational DB.
                        // Let's try to load products from what was originally scanned if `keyParam` is also present.
                        // If not, an empty product list or all products could be shown for general editing context.
                        // This needs to be rethought if specific products for a *past* invoice must be shown.
                        // For now, if just invoiceIdParam is present, we can't reliably get ONLY its products.
                        // Let's assume for viewing a *saved* invoice, if product data was part of its original scan (via keyParam), we'd load it.
                        // This scenario is complex because the keyParam points to *temporary* scan data.
                        // For viewing a truly *existing* (not just-saved) invoice, product loading is ambiguous.
                        // We will keep products empty here, assuming the user is viewing the invoice summary.
                        // Or they will add items if it was a delivery note context.
                        const allUserProducts = await getProductsService(user.id);
                        // This is still all products. A better way would be to store product IDs on the invoice item.
                        // For now, if it's a delivery note, we can't truly re-populate *only* its items.
                        // Let's just show an empty table if it's not a fresh scan.
                        setProducts([]);
                    }
                    setIsSupplierConfirmed(true); // Assume supplier is confirmed for existing invoices
                } else {
                    setErrorLoading(t('edit_invoice_error_invoice_not_found_id', { invoiceId: invoiceIdParam }));
                }
            } catch (e) {
                console.error("Error loading existing invoice:", e);
                setErrorLoading(t('edit_invoice_error_loading_existing'));
            }
        } else if (keyParam) { // Loading from a temporary scan result
            let storedData: string | null = null;
            try {
                storedData = localStorage.getItem(keyParam);
                // Also load image URIs from their respective keys
                if(initialOriginalImagePreviewKey) setDisplayedOriginalImageUrl(localStorage.getItem(initialOriginalImagePreviewKey));
                if(initialCompressedImageKey) setDisplayedCompressedImageUrl(localStorage.getItem(initialCompressedImageKey));

            } catch(e) {
                console.error("Error reading from localStorage for key:", keyParam, e);
                setErrorLoading(t('edit_invoice_error_localstorage_read'));
                cleanupTemporaryDataAfterSave();
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
                cleanupTemporaryDataAfterSave();
                setIsLoading(false);
                setInitialDataLoaded(true);
                return;
            }

            let parsedData: ScanInvoiceOutput | ScanTaxInvoiceOutput;
            try {
                parsedData = JSON.parse(storedData);
            } catch (jsonParseError) {
                 console.error("Failed to parse JSON data from localStorage:", jsonParseError, "Raw data:", storedData);
                 cleanupTemporaryDataAfterSave();
                 setErrorLoading(t('edit_invoice_error_invalid_json'));
                  toast({
                      title: t('edit_invoice_toast_error_loading_title'),
                      description: t('edit_invoice_toast_error_loading_desc_invalid_format'),
                      variant: "destructive",
                  });
                setProducts([]);
                setEditableTaxInvoiceDetails({});
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
                setEditableTaxInvoiceDetails({
                    supplierName: taxData.supplierName,
                    invoiceNumber: taxData.invoiceNumber,
                    totalAmount: taxData.totalAmount,
                    invoiceDate: taxData.invoiceDate,
                    paymentMethod: taxData.paymentMethod,
                });
                setExtractedSupplierName(taxData.supplierName);
                setExtractedInvoiceNumber(taxData.invoiceNumber);
                setExtractedTotalAmount(taxData.totalAmount);
                setExtractedInvoiceDate(taxData.invoiceDate);
                setExtractedPaymentMethod(taxData.paymentMethod);
                setAiScannedSupplierName(taxData.supplierName);
                checkSupplier(taxData.supplierName, user.id);

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
                    salePrice: p.salePrice ?? undefined,
                  }));
                  setProducts(productsWithIds);
                  setEditableTaxInvoiceDetails({});
                  setExtractedInvoiceNumber(productData.invoiceNumber);
                  setAiScannedSupplierName(productData.supplier);
                  setExtractedSupplierName(productData.supplier);
                  setExtractedTotalAmount(productData.totalAmount);
                  setExtractedInvoiceDate(productData.invoiceDate);
                  setExtractedPaymentMethod(productData.paymentMethod);
                  checkSupplier(productData.supplier, user.id);
                } else if (!productData.error){
                    console.error("Parsed product data is missing 'products' array or is invalid:", productData);
                    setErrorLoading(t('edit_invoice_error_invalid_structure_parsed'));
                    setProducts([]);
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
                 setEditableTaxInvoiceDetails({});
            }
        } else if (!initialDataLoaded) { // No key and not an existing invoice ID, and first load
           setErrorLoading(t('edit_invoice_error_no_key_or_id'));
           setProducts([]);
           setEditableTaxInvoiceDetails({});
           toast({
              title: t('edit_invoice_toast_no_data_title'),
              description: t('edit_invoice_toast_no_data_desc'),
              variant: "destructive",
            });
        }
        setIsLoading(false);
        setInitialDataLoaded(true);
    };

    loadData();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user, toast, t]); // Removed cleanupTemporaryDataAfterSave, it's called specifically


  const checkSupplier = async (scannedSupplierName?: string, currentUserId?: string) => {
    if (!currentUserId) {
        setIsSupplierConfirmed(true);
        if (documentType === 'deliveryNote' || documentType === 'invoice') {
            setShowPaymentDueDateDialog(true);
        } else {
            handleSaveChecks();
        }
        return;
    }

    if (!scannedSupplierName) {
        setIsSupplierConfirmed(true);
        if (documentType === 'deliveryNote' || documentType === 'invoice') {
            setShowPaymentDueDateDialog(true);
        } else {
            handleSaveChecks();
        }
        return;
    }

    try {
      const suppliers = await getSupplierSummariesService(currentUserId);
      setExistingSuppliers(suppliers);
      const isExisting = suppliers.some(s => s.name.toLowerCase() === scannedSupplierName.toLowerCase());
      if (isExisting) {
        setExtractedSupplierName(scannedSupplierName);
        setIsSupplierConfirmed(true);
        if (documentType === 'deliveryNote' || documentType === 'invoice') {
            setShowPaymentDueDateDialog(true);
        } else {
            handleSaveChecks();
        }
      } else {
        setPotentialSupplierName(scannedSupplierName);
        setShowSupplierDialog(true);
      }
    } catch (error) {
      console.error("Error fetching existing suppliers:", error);
      toast({ title: t('edit_invoice_toast_error_fetching_suppliers'), variant: "destructive" });
      setExtractedSupplierName(scannedSupplierName);
      setIsSupplierConfirmed(true);
      if (documentType === 'deliveryNote' || documentType === 'invoice') {
          setShowPaymentDueDateDialog(true);
      } else {
          handleSaveChecks();
      }
    }
  };

  const handleSupplierConfirmation = async (confirmedSupplierName: string | null, isNew: boolean = false) => {
    setShowSupplierDialog(false);
    if (!user?.id) {
        toast({ title: "User not authenticated", variant: "destructive" });
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
    if (documentType === 'deliveryNote' || documentType === 'invoice') {
      setShowPaymentDueDateDialog(true);
    } else {
      handleSaveChecks();
    }
  };

  const handlePaymentDueDateConfirm = (dueDate: string | Date | undefined) => {
    setSelectedPaymentDueDate(dueDate);
    setShowPaymentDueDateDialog(false);
    handleSaveChecks();
  };


  const handleInputChange = (id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(p => {
        if (p.id === id) {
          const updatedProduct = { ...p };
          let numericValue: number | string | undefined = value;

          if (['quantity', 'unitPrice', 'lineTotal', 'salePrice', 'minStockLevel', 'maxStockLevel'].includes(field)) {
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
            initialTempInvoiceId || undefined, // Use initial temp ID
            finalInvoiceNumberForSave,
            finalSupplierNameForSave,
            finalTotalAmountForSave,
            selectedPaymentDueDate,
            finalInvoiceDateForSave,
            finalPaymentMethodForSave,
            displayedOriginalImageUrl || undefined, // Pass displayed URIs
            displayedCompressedImageUrl || undefined
          );

          cleanupTemporaryDataAfterSave();

          if (result.finalInvoiceRecord) {
            setOriginalFileName(result.finalInvoiceRecord.fileName);
            setInitialTempInvoiceId(result.finalInvoiceRecord.id); // Update temp ID to final ID
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
                setProducts(result.savedProductsWithFinalIds.map(p => ({ ...p, _originalId: p.id })));
            }
            setScanError(result.finalInvoiceRecord.errorMessage || null);
            setIsViewMode(true);
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
        [], // No products for tax invoice
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

      cleanupTemporaryDataAfterSave();

      if (result.finalInvoiceRecord) {
        setOriginalFileName(result.finalInvoiceRecord.fileName);
        setInitialTempInvoiceId(result.finalInvoiceRecord.id); // Update to final ID
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
        setEditableTaxInvoiceDetails({
             supplierName: result.finalInvoiceRecord.supplier,
             invoiceNumber: result.finalInvoiceRecord.invoiceNumber,
             totalAmount: result.finalInvoiceRecord.totalAmount,
             invoiceDate: result.finalInvoiceRecord.invoiceDate ? (result.finalInvoiceRecord.invoiceDate as string) : undefined,
             paymentMethod: result.finalInvoiceRecord.paymentMethod,
        });
        setScanError(result.finalInvoiceRecord.errorMessage || null);
        setIsViewMode(true);
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
    } finally {
      setIsSaving(false);
    }
  };


 const handleSaveChecks = async () => {
    if (!isSupplierConfirmed) {
        setShowSupplierDialog(true);
        toast({ title: t('edit_invoice_toast_supplier_not_confirmed_title'), description: t('edit_invoice_toast_supplier_not_confirmed_desc'), variant: "default" });
        return;
    }
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

            const needsSalePrice = p.salePrice === undefined || p.salePrice === null; // Check if salePrice is missing
            return isProductConsideredNew || needsSalePrice;
        });

        if (newProductsNeedingDetails.length > 0) {
            setProductsForNextStep(productsReadyForDetailCheck);
            setPromptingForNewProductDetails(newProductsNeedingDetails);
            setIsBarcodePromptOpen(true); // This opens the BarcodePromptDialog
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
        const allProductsAfterPriceCheck = productsForNextStep.map(originalProduct => {
            const resolvedVersion = resolvedProducts.find(rp => rp.id === originalProduct.id);
            return resolvedVersion ? { ...originalProduct, unitPrice: resolvedVersion.unitPrice } : originalProduct;
        });
        setProductsForNextStep(allProductsAfterPriceCheck);
        checkForNewProductsAndDetails(allProductsAfterPriceCheck);
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
                 (originalProduct.id.startsWith('prod-temp-') && unp.id === originalProduct.id) ||
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
         console.log("[EditInvoice] Products ready for final save after details dialog:", JSON.stringify(finalProductsToSave.slice(0,2)));
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
        cleanupTemporaryDataAfterSave();
        router.push('/upload');
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

    if (initialDataLoaded && documentType === 'deliveryNote' && products.length === 0 && !errorLoading && !scanProcessError) {
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
                             <Button variant="outline" onClick={handleAddRow} className="w-full sm:w-auto">
                               <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                             </Button>
                             <Button onClick={handleSaveChecks} disabled={isSaving || !isSupplierConfirmed || !selectedPaymentDueDate} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
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

     if (scanProcessError && documentType === 'deliveryNote' && products.length === 0) {
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
                           <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                             <Button variant="outline" onClick={handleAddRow} className="w-full sm:w-auto">
                               <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                             </Button>
                             <Button onClick={handleSaveChecks} disabled={isSaving || products.length === 0 || !isSupplierConfirmed || !selectedPaymentDueDate} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
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

    const renderReadOnlyProductItem = (product: EditableProduct) => (
        <TableRow key={`view-${product.id}`}>
            <TableCell className="px-2 sm:px-4 py-2">{product.catalogNumber || 'N/A'}</TableCell>
            <TableCell className="px-2 sm:px-4 py-2">{product.description || 'N/A'}</TableCell>
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

    const renderReadOnlyTaxInvoiceDetails = () => (
        <div className="space-y-3">
            {extractedSupplierName && <p><span className="font-semibold">{t('invoice_details_supplier_label')}:</span> {extractedSupplierName}</p>}
            {extractedInvoiceNumber && <p><span className="font-semibold">{t('invoice_details_invoice_number_label')}:</span> {extractedInvoiceNumber}</p>}
            {extractedTotalAmount !== undefined && <p><span className="font-semibold">{t('invoice_details_total_amount_label')}:</span> {t('currency_symbol')}{extractedTotalAmount.toFixed(2)}</p>}
            {extractedInvoiceDate && <p><span className="font-semibold">{t('invoice_details_invoice_date_label')}:</span> {isValid(parseISO(extractedInvoiceDate)) ? format(parseISO(extractedInvoiceDate), 'PP') : extractedInvoiceDate}</p>}
            {extractedPaymentMethod && <p><span className="font-semibold">{t('invoice_details_payment_method_label')}:</span> {extractedPaymentMethod}</p>}
            {displayedOriginalImageUrl && (
                <div className="mt-4">
                    <p className="font-semibold mb-2">{t('edit_invoice_image_preview_label')}:</p>
                    <NextImage src={displayedOriginalImageUrl} alt={t('edit_invoice_image_preview_alt')} width={500} height={700} className="rounded-md border" data-ai-hint="document scan" />
                </div>
            )}
        </div>
    );

    const renderEditableTaxInvoiceDetails = () => (
         <div className="space-y-4">
            <div>
                <Label htmlFor="taxSupplierName">{t('invoice_details_supplier_label')}</Label>
                <Input id="taxSupplierName" value={editableTaxInvoiceDetails.supplierName || extractedSupplierName || ''} onChange={(e) => handleTaxInvoiceDetailsChange('supplierName', e.target.value)} disabled={isSaving} />
            </div>
            <div>
                <Label htmlFor="taxInvoiceNumber">{t('invoice_details_invoice_number_label')}</Label>
                <Input id="taxInvoiceNumber" value={editableTaxInvoiceDetails.invoiceNumber || extractedInvoiceNumber || ''} onChange={(e) => handleTaxInvoiceDetailsChange('invoiceNumber', e.target.value)} disabled={isSaving} />
            </div>
            <div>
                <Label htmlFor="taxTotalAmount">{t('invoice_details_total_amount_label')}</Label>
                <Input id="taxTotalAmount" type="number" value={editableTaxInvoiceDetails.totalAmount ?? extractedTotalAmount ?? ''} onChange={(e) => handleTaxInvoiceDetailsChange('totalAmount', e.target.value === '' ? undefined : parseFloat(e.target.value))} disabled={isSaving} />
            </div>
            <div>
                <Label htmlFor="taxInvoiceDate">{t('invoice_details_invoice_date_label')}</Label>
                <Input
                id="taxInvoiceDate"
                type="date"
                value={ (editableTaxInvoiceDetails.invoiceDate && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate))) ? format(parseISO(editableTaxInvoiceDetails.invoiceDate), 'yyyy-MM-dd') : (extractedInvoiceDate && isValid(parseISO(extractedInvoiceDate))) ? format(parseISO(extractedInvoiceDate), 'yyyy-MM-dd') : '' }
                onChange={(e) => handleTaxInvoiceDetailsChange('invoiceDate', e.target.value && isValid(parseISO(e.target.value)) ? parseISO(e.target.value).toISOString() : undefined)}
                disabled={isSaving} />
            </div>
            <div>
                <Label htmlFor="taxPaymentMethod">{t('invoice_details_payment_method_label')}</Label>
                <Input id="taxPaymentMethod" value={editableTaxInvoiceDetails.paymentMethod || extractedPaymentMethod || ''} onChange={(e) => handleTaxInvoiceDetailsChange('paymentMethod', e.target.value)} disabled={isSaving} />
            </div>
            {displayedOriginalImageUrl && (
                <div className="mt-4">
                     <p className="font-semibold mb-2">{t('edit_invoice_image_preview_label')}:</p>
                    <NextImage src={displayedOriginalImageUrl} alt={t('edit_invoice_image_preview_alt')} width={500} height={700} className="rounded-md border" data-ai-hint="document scan"/>
                </div>
            )}
        </div>
    );


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md scale-fade-in">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <FileTextIconLucide className="mr-2 h-5 w-5" />
            {isViewMode ? t('edit_invoice_view_title') : (documentType === 'invoice' ? t('edit_invoice_title_tax_invoice') : t('edit_invoice_title'))}
          </CardTitle>
          <CardDescription>
             {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
             {(isViewMode ? extractedSupplierName : (editableTaxInvoiceDetails.supplierName || extractedSupplierName)) &&
                ` | ${t('edit_invoice_supplier', { supplierName: (isViewMode ? extractedSupplierName : (editableTaxInvoiceDetails.supplierName || extractedSupplierName)) })}`}
          </CardDescription>
           {scanProcessError && (
             <Alert variant="destructive" className="mt-2">
                <AlertTitle>{t('edit_invoice_scan_process_error_title')}</AlertTitle>
                <AlertDescription>{scanProcessError}</AlertDescription>
             </Alert>
           )}
        </CardHeader>
        <CardContent>
            {documentType === 'invoice' ? (
                 isViewMode ? renderReadOnlyTaxInvoiceDetails() : renderEditableTaxInvoiceDetails()
            ) : (
              <>
              <div className="overflow-x-auto relative">
                <Table className="min-w-[600px]"> {/* Adjusted min-width */}
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 sm:px-4 py-2">{t('edit_invoice_th_catalog')}</TableHead>
                      <TableHead className="px-2 sm:px-4 py-2">{t('edit_invoice_th_description')}</TableHead>
                      <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_qty')}</TableHead>
                      <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_unit_price', { currency_symbol: t('currency_symbol') })}</TableHead>
                      <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_line_total', { currency_symbol: t('currency_symbol') })}</TableHead>
                      {!isViewMode && <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_actions')}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map(product => isViewMode ? renderReadOnlyProductItem(product) : renderEditableProductItem(product))}
                  </TableBody>
                </Table>
              </div>
               {isViewMode && displayedOriginalImageUrl && (
                    <div className="mt-6">
                        <p className="font-semibold mb-2 text-lg">{t('edit_invoice_image_preview_label')}:</p>
                        <NextImage src={displayedOriginalImageUrl} alt={t('edit_invoice_image_preview_alt')} width={600} height={850} className="rounded-md border shadow-md" data-ai-hint="document scan" />
                    </div>
                )}
                {!isViewMode && displayedOriginalImageUrl && (
                     <div className="mt-4">
                        <p className="font-semibold mb-2">{t('edit_invoice_image_preview_label')}:</p>
                        <NextImage src={displayedOriginalImageUrl} alt={t('edit_invoice_image_preview_alt')} width={500} height={700} className="rounded-md border" data-ai-hint="document scan"/>
                    </div>
                )}
              </>
            )}
            <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
                <Button variant="outline" onClick={handleGoBack} className="w-full sm:w-auto order-last sm:order-first">
                    <ArrowLeft className="mr-2 h-4 w-4" /> {t('edit_invoice_go_back_button')}
                </Button>
                <div className="flex-grow flex flex-col sm:flex-row sm:justify-end gap-3">
                    {isViewMode ? (
                        <>
                            <Button onClick={() => setIsViewMode(false)} variant="outline" className="w-full sm:w-auto">
                                <Edit className="mr-2 h-4 w-4" /> {t('edit_invoice_edit_data_button')}
                            </Button>
                            {/* Save button is only relevant if changes can be made, so perhaps remove from pure view mode or disable if no changes */}
                        </>
                    ) : (
                        <>
                            {documentType === 'deliveryNote' && (
                                <Button variant="outline" onClick={handleAddRow} className="w-full sm:w-auto">
                                    <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
                                </Button>
                            )}
                            <Button variant="outline" onClick={() => setIsViewMode(true)} className="w-full sm:w-auto">
                                {t('edit_invoice_cancel_edit_button')}
                            </Button>
                            <Button
                                onClick={handleSaveChecks}
                                disabled={isSaving || (documentType === 'deliveryNote' && products.length === 0 && !scanProcessError) || !isSupplierConfirmed || (documentType !== 'invoice' && !selectedPaymentDueDate)}
                                className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                            >
                                {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</> : <><Save className="mr-2 h-4 w-4" /> {t('edit_invoice_save_changes_button')}</>}
                            </Button>
                        </>
                    )}
                </div>
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
            if (documentType === 'deliveryNote' || documentType === 'invoice') {
              setShowPaymentDueDateDialog(true);
            } else {
              handleSaveChecks();
            }
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
            setSelectedPaymentDueDate(undefined); // Explicitly set to undefined
            handleSaveChecks(); // Proceed with save even if skipped
          }}
        />
      )}


      {promptingForNewProductDetails && documentType === 'deliveryNote' && (
        <BarcodePromptDialog
          products={promptingForNewProductDetails}
          onComplete={handleNewProductDetailsComplete}
          isOpen={isBarcodePromptOpen}
          onOpenChange={setIsBarcodePromptOpen}
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
