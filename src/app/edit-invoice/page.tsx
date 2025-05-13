// src/app/edit-invoice/page.tsx
'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, PlusCircle, Save, Loader2, ArrowLeft, Edit } from 'lucide-react';
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
} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import type { ScanTaxInvoiceOutput } from '@/ai/flows/tax-invoice-schemas'; // Import new type
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog';
import SupplierConfirmationDialog from '@/components/supplier-confirmation-dialog';
import PaymentDueDateDialog from '@/components/payment-due-date-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { Label } from '@/components/ui/label';
import { format, parseISO, isValid } from 'date-fns';


interface EditableProduct extends Product {
  _originalId?: string;
}

// Define a type for the editable tax invoice details
interface EditableTaxInvoiceDetails {
    supplierName?: string;
    invoiceNumber?: string;
    totalAmount?: number;
    invoiceDate?: string; // Stored as ISO string, displayed as 'yyyy-MM-dd'
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


function EditInvoiceContent() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const [products, setProducts] = useState&lt;EditableProduct[]&gt;([]);
  const [originalFileName, setOriginalFileName] = useState&lt;string&gt;('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [errorLoading, setErrorLoading] = useState&lt;string | null&gt;(null);
  const [scanProcessError, setScanProcessError] = useState&lt;string | null&gt;(null);

  const [dataKey, setDataKey] = useState&lt;string | null&gt;(null);
  const [tempInvoiceId, setTempInvoiceId] = useState&lt;string | null&gt;(null);
  const [originalImagePreviewKey, setOriginalImagePreviewKey] = useState&lt;string | null&gt;(null);
  const [compressedImageKeyFromParam, setCompressedImageKeyFromParam] = useState&lt;string | null&gt;(null);
  const [documentType, setDocumentType] = useState&lt;'deliveryNote' | 'invoice' | null&gt;(null);


  const [extractedInvoiceNumber, setExtractedInvoiceNumber] = useState&lt;string | undefined&gt;(undefined);
  const [extractedSupplierName, setExtractedSupplierName] = useState&lt;string | undefined&gt;(undefined);
  const [extractedTotalAmount, setExtractedTotalAmount] = useState&lt;number | undefined&gt;(undefined);
  const [extractedInvoiceDate, setExtractedInvoiceDate] = useState&lt;string | undefined&gt;(undefined);
  const [extractedPaymentMethod, setExtractedPaymentMethod] = useState&lt;string | undefined&gt;(undefined);
  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] = useState&lt;EditableTaxInvoiceDetails&gt;({});


  const [promptingForNewProductDetails, setPromptingForNewProductDetails] = useState&lt;Product[] | null&gt;(null);
  const [isBarcodePromptOpen, setIsBarcodePromptOpen] = useState(false);
  const [priceDiscrepancies, setPriceDiscrepancies] = useState&lt;ProductPriceDiscrepancy[] | null&gt;(null);

  const [productsForNextStep, setProductsForNextStep] = useState&lt;Product[]&gt;([]);

  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [potentialSupplierName, setPotentialSupplierName] = useState&lt;string | undefined&gt;(undefined);
  const [existingSuppliers, setExistingSuppliers] = useState&lt;SupplierSummary[]&gt;([]);
  const [isSupplierConfirmed, setIsSupplierConfirmed] = useState(false);
  const [aiScannedSupplierName, setAiScannedSupplierName] = useState&lt;string | undefined&gt;(undefined);

  const [showPaymentDueDateDialog, setShowPaymentDueDateDialog] = useState(false);
  const [selectedPaymentDueDate, setSelectedPaymentDueDate] = useState&lt;string | Date | undefined&gt;(undefined);


  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);


   const cleanupTemporaryDataLocal = useCallback(() =&gt; {
    if (!user?.id) {
        console.warn("[EditInvoice] cleanupTemporaryDataLocal called, but user ID is missing. Cannot reliably clear data.");
        return;
    }
    let uniqueIdToClear: string | null = null;
    if (dataKey?.startsWith(TEMP_DATA_KEY_PREFIX)) {
        const prefix = `${TEMP_DATA_KEY_PREFIX}${user.id}_`;
        if (dataKey.startsWith(prefix)) {
            uniqueIdToClear = dataKey.substring(prefix.length);
        }
    } else if (tempInvoiceId?.startsWith('pending-inv-')) {
        const prefix = `pending-inv-${user.id}_`;
        if (tempInvoiceId.startsWith(prefix)) {
            uniqueIdToClear = tempInvoiceId.substring(prefix.length);
        }
    }


    if (uniqueIdToClear) {
        clearTemporaryScanData(uniqueIdToClear, user.id);
        console.log(`[EditInvoice] Triggered cleanup for scan result associated with UserID: ${user.id}, Unique ID: ${uniqueIdToClear}`);
    } else {
        console.log("[EditInvoice] cleanupTemporaryDataLocal called, but no dataKey or relevant tempInvoiceId found to clear for the current user.");
    }
  }, [dataKey, tempInvoiceId, user?.id]);


  useEffect(() =&gt; {
    if (!user) return;
    const key = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    const tempInvIdParam = searchParams.get('tempInvoiceId');
    const compressedKeyParam = searchParams.get('compressedImageKey');
    const docTypeParam = searchParams.get('docType') as 'deliveryNote' | 'invoice' | null;

    setDataKey(key);
    setTempInvoiceId(tempInvIdParam);
    setCompressedImageKeyFromParam(compressedKeyParam);
    setDocumentType(docTypeParam);

    let uniquePartFromKeyOrTempId: string | null = null;
    if (key?.startsWith(`${TEMP_DATA_KEY_PREFIX}${user.id}_`)) {
        uniquePartFromKeyOrTempId = key.substring(`${TEMP_DATA_KEY_PREFIX}${user.id}_`.length);
    } else if (tempInvIdParam?.startsWith(`pending-inv-${user.id}_`)) {
        uniquePartFromKeyOrTempId = tempInvIdParam.substring(`pending-inv-${user.id}_`.length);
    }

    if (uniquePartFromKeyOrTempId) {
        setOriginalImagePreviewKey(`${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${user.id}_${uniquePartFromKeyOrTempId}`);
    }


    let hasAttemptedLoad = false;

    if (nameParam) {
      setOriginalFileName(decodeURIComponent(nameParam));
    } else {
        setOriginalFileName(t('edit_invoice_unknown_document'));
    }

    if (key) {
        hasAttemptedLoad = true;
        const storedData = localStorage.getItem(key);

        if (!storedData) {
            setErrorLoading(t('edit_invoice_error_scan_results_not_found'));
            setProducts([]);
            setEditableTaxInvoiceDetails({});
            toast({
              title: t('edit_invoice_toast_error_loading_title'),
              description: t('edit_invoice_toast_error_loading_desc_not_found'),
              variant: "destructive",
            });
            cleanupTemporaryDataLocal();
            setIsLoading(false);
            setInitialDataLoaded(true);
            return;
        }

        let parsedData: ScanInvoiceOutput | ScanTaxInvoiceOutput;
        try {
            parsedData = JSON.parse(storedData);
        } catch (jsonParseError) {
             console.error("Failed to parse JSON data from localStorage:", jsonParseError, "Raw data:", storedData);
             cleanupTemporaryDataLocal();
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
            setProducts([]); // No products for tax invoice
            setEditableTaxInvoiceDetails({
                supplierName: taxData.supplierName,
                invoiceNumber: taxData.invoiceNumber,
                totalAmount: taxData.totalAmount,
                invoiceDate: taxData.invoiceDate,
                paymentMethod: taxData.paymentMethod,
            });
            setExtractedSupplierName(taxData.supplierName); // For supplier confirmation
            setAiScannedSupplierName(taxData.supplierName);
            checkSupplier(taxData.supplierName, user.id);

        } else if (docTypeParam === 'deliveryNote') {
            const productData = parsedData as ScanInvoiceOutput;
            if (productData && Array.isArray(productData.products)) {
              const productsWithIds = productData.products.map((p: Product, index: number) =&gt; ({
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
              setEditableTaxInvoiceDetails({}); // Clear tax invoice details
              setExtractedInvoiceNumber(productData.invoiceNumber);
              setAiScannedSupplierName(productData.supplier);
              setExtractedTotalAmount(productData.totalAmount);
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
         setErrorLoading(null);

    } else if (!initialDataLoaded) {
       hasAttemptedLoad = true;
       setErrorLoading(t('edit_invoice_error_no_key'));
       setProducts([]);
       setEditableTaxInvoiceDetails({});
       toast({
          title: t('edit_invoice_toast_no_data_title'),
          description: t('edit_invoice_toast_no_data_desc'),
          variant: "destructive",
        });
    }

    setIsLoading(false);
    if (hasAttemptedLoad) {
        setInitialDataLoaded(true);
    }
  }, [searchParams, toast, initialDataLoaded, cleanupTemporaryDataLocal, t, user]);


  const checkSupplier = async (scannedSupplierName?: string, currentUserId?: string) =&gt; {
    if (!scannedSupplierName || !currentUserId) {
      setIsSupplierConfirmed(true);
      setShowPaymentDueDateDialog(true); 
      return;
    }
    try {
      const suppliers = await getSupplierSummariesService(currentUserId);
      setExistingSuppliers(suppliers);
      const isExisting = suppliers.some(s =&gt; s.name.toLowerCase() === scannedSupplierName.toLowerCase());
      if (isExisting) {
        setExtractedSupplierName(scannedSupplierName);
        setIsSupplierConfirmed(true);
        setShowPaymentDueDateDialog(true); 
      } else {
        setPotentialSupplierName(scannedSupplierName);
        setShowSupplierDialog(true); 
      }
    } catch (error) {
      console.error("Error fetching existing suppliers:", error);
      toast({ title: t('edit_invoice_toast_error_fetching_suppliers'), variant: "destructive" });
      setExtractedSupplierName(scannedSupplierName);
      setIsSupplierConfirmed(true);
      setShowPaymentDueDateDialog(true); 
    }
  };

  const handleSupplierConfirmation = async (confirmedSupplierName: string | null, isNew: boolean = false) =&gt; {
    setShowSupplierDialog(false);
    if (!user?.id) {
        toast({ title: "User not authenticated", variant: "destructive" });
        return;
    }
    if (confirmedSupplierName) {
      setExtractedSupplierName(confirmedSupplierName);
      setEditableTaxInvoiceDetails(prev =&gt; ({ ...prev, supplierName: confirmedSupplierName }));
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
      setEditableTaxInvoiceDetails(prev =&gt; ({ ...prev, supplierName: aiScannedSupplierName }));
    }
    setIsSupplierConfirmed(true);
    setShowPaymentDueDateDialog(true); 
  };

  const handlePaymentDueDateConfirm = (dueDate: string | Date | undefined) =&gt; {
    setSelectedPaymentDueDate(dueDate);
    setShowPaymentDueDateDialog(false);
    handleSaveChecks();
  };


  const handleInputChange = (id: string, field: keyof EditableProduct, value: string | number) =&gt; {
    setProducts(prevProducts =&gt;
      prevProducts.map(p =&gt; {
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
             if (currentQuantity &gt; 0 && currentUnitPrice !== 0) {
                currentLineTotal = parseFloat((currentQuantity * currentUnitPrice).toFixed(2));
             } else if (currentQuantity === 0 || currentUnitPrice === 0) {
                currentLineTotal = 0;
             }
            updatedProduct.lineTotal = currentLineTotal;
          } else if (field === 'lineTotal') {
            if (currentQuantity &gt; 0) {
              currentUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
              updatedProduct.unitPrice = currentUnitPrice;
            } else {
                updatedProduct.unitPrice = (currentLineTotal === 0) ? 0 : currentUnitPrice;
            }
          }


          if (currentQuantity &gt; 0 && currentLineTotal !== 0) {
            const derivedUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
            if (Math.abs(derivedUnitPrice - currentUnitPrice) &gt; 0.001 && field !== 'unitPrice') {
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

  const handleTaxInvoiceDetailsChange = (field: keyof EditableTaxInvoiceDetails, value: string | number | undefined) =&gt; {
     setEditableTaxInvoiceDetails(prev =&gt; ({ ...prev, [field]: value }));
  };


  const handleAddRow = () =&gt; {
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
    setProducts(prevProducts =&gt; [...prevProducts, newProduct]);
  };

  const handleRemoveRow = (id: string) =&gt; {
    setProducts(prevProducts =&gt; prevProducts.filter(product =&gt; product.id !== id));
     toast({
        title: t('edit_invoice_toast_row_removed_title'),
        description: t('edit_invoice_toast_row_removed_desc'),
        variant: "default",
     });
  };


  const proceedWithFinalSave = async (finalProductsToSave: Product[]) =&gt; {
      setIsSaving(true);
      if (!user?.id) {
          toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
          setIsSaving(false);
          return;
      }
      try {
          console.log("[EditInvoice] Proceeding with final save. Products:", JSON.stringify(finalProductsToSave.slice(0,2)));

          const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) =&gt; rest);

          let finalFileNameForSave = originalFileName;
          const finalSupplierNameForSave = extractedSupplierName || editableTaxInvoiceDetails.supplierName;
          const finalInvoiceNumberForSave = extractedInvoiceNumber || editableTaxInvoiceDetails.invoiceNumber;
          const finalTotalAmountForSave = extractedTotalAmount ?? editableTaxInvoiceDetails.totalAmount;

          if(finalSupplierNameForSave && finalInvoiceNumberForSave) {
            finalFileNameForSave = `${finalSupplierNameForSave}_${finalInvoiceNumberForSave}`;
          } else if (finalSupplierNameForSave) {
            finalFileNameForSave = finalSupplierNameForSave;
          } else if (finalInvoiceNumberForSave) {
            finalFileNameForSave = `Invoice_${finalInvoiceNumberForSave}`;
          }

          console.log(`[EditInvoice] Finalizing save for file: ${finalFileNameForSave}, tempInvoiceId: ${tempInvoiceId}, UserID: ${user.id}`);

          await finalizeSaveProductsService(
            productsForService,
            finalFileNameForSave,
            'upload',
            user.id,
            tempInvoiceId || undefined,
            finalInvoiceNumberForSave,
            finalSupplierNameForSave,
            finalTotalAmountForSave,
            selectedPaymentDueDate,
            editableTaxInvoiceDetails.invoiceDate,
            editableTaxInvoiceDetails.paymentMethod
          );

          cleanupTemporaryDataLocal();
          console.log("[EditInvoice] All temporary localStorage keys cleared after successful save.");


          toast({
              title: t('edit_invoice_toast_products_saved_title'),
              description: t('edit_invoice_toast_products_saved_desc'),
          });
          router.push('/inventory?refresh=true');

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

  const proceedWithFinalSaveForTaxInvoice = async () =&gt; {
    setIsSaving(true);
    if (!user?.id) {
      toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
      setIsSaving(false);
      return;
    }
    try {
      let finalFileNameForSave = originalFileName;
      const finalSupplierNameForSave = editableTaxInvoiceDetails.supplierName || extractedSupplierName; // Prioritize edited
      const finalInvoiceNumberForSave = editableTaxInvoiceDetails.invoiceNumber || extractedInvoiceNumber;
      const finalTotalAmountForSave = editableTaxInvoiceDetails.totalAmount ?? extractedTotalAmount; // Prioritize edited

      if(finalSupplierNameForSave && finalInvoiceNumberForSave) {
        finalFileNameForSave = `${finalSupplierNameForSave}_${finalInvoiceNumberForSave}`;
      } else if (finalSupplierNameForSave) {
        finalFileNameForSave = finalSupplierNameForSave;
      } else if (finalInvoiceNumberForSave) {
        finalFileNameForSave = `Invoice_${finalInvoiceNumberForSave}`;
      }

      console.log(`[EditInvoice] Finalizing TAX INVOICE save for file: ${finalFileNameForSave}, tempInvoiceId: ${tempInvoiceId}`);
      await finalizeSaveProductsService(
        [], // No products for tax invoice
        finalFileNameForSave,
        'upload',
        user.id,
        tempInvoiceId || undefined,
        finalInvoiceNumberForSave,
        finalSupplierNameForSave,
        finalTotalAmountForSave,
        selectedPaymentDueDate,
        editableTaxInvoiceDetails.invoiceDate,
        editableTaxInvoiceDetails.paymentMethod
      );
      cleanupTemporaryDataLocal();
      toast({
        title: t('edit_invoice_toast_invoice_details_saved_title'),
        description: t('edit_invoice_toast_invoice_details_saved_desc'),
      });
      router.push('/invoices?view=paid'); // Redirect to paid invoices tab perhaps

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


 const handleSaveChecks = async () =&gt; {
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

    // For deliveryNote
    setIsSaving(true);
    try {
        const productsFromEdit = products.map(({ _originalId, ...rest }) =&gt; rest);
        const priceCheckResult = await checkProductPricesBeforeSaveService(productsFromEdit, user.id, tempInvoiceId || undefined);

        setProductsForNextStep(priceCheckResult.productsToSaveDirectly);

        if (priceCheckResult.priceDiscrepancies.length &gt; 0) {
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

const checkForNewProductsAndDetails = async (productsReadyForDetailCheck: Product[]) =&gt; {
    setIsSaving(true);
    if (!user?.id) {
        toast({ title: t('edit_invoice_user_not_authenticated_title'), description: t('edit_invoice_user_not_authenticated_desc'), variant: "destructive" });
        setIsSaving(false);
        return;
    }
    try {
        const currentInventory = await getProductsService(user.id);
        const inventoryMap = new Map&lt;string, Product&gt;();
        currentInventory.forEach(p =&gt; {
            if (p.id) inventoryMap.set(`id:${p.id}`, p);
            if (p.catalogNumber && p.catalogNumber !== "N/A") inventoryMap.set(`catalog:${p.catalogNumber}`, p);
            if (p.barcode) inventoryMap.set(`barcode:${p.barcode}`, p);
        });

        const newProductsNeedingDetails = productsReadyForDetailCheck.filter(p =&gt; {
             const isExistingById = p.id && !p.id.startsWith('prod-temp-') && inventoryMap.has(`id:${p.id}`);
            const isExistingByCatalog = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
            const isExistingByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);

            const isProductConsideredNew = !(isExistingById || isExistingByCatalog || isExistingByBarcode);

            const needsSalePrice = p.salePrice === undefined || p.salePrice === null;
            return isProductConsideredNew || needsSalePrice;
        });

        if (newProductsNeedingDetails.length &gt; 0) {
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


const handlePriceConfirmationComplete = (resolvedProducts: Product[] | null) =&gt; {
    setPriceDiscrepancies(null);
    if (resolvedProducts) {
        const allProductsAfterPriceCheck = productsForNextStep.map(originalProduct =&gt; {
            const resolvedVersion = resolvedProducts.find(rp =&gt; rp.id === originalProduct.id);
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


 const handleNewProductDetailsComplete = (updatedNewProductsFromDialog: Product[] | null) =&gt; {
     setPromptingForNewProductDetails(null);
     setIsBarcodePromptOpen(false);

     if (updatedNewProductsFromDialog) {
         const finalProductsToSave = productsForNextStep.map(originalProduct =&gt; {
             const updatedVersion = updatedNewProductsFromDialog.find(unp =&gt;
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


    const handleGoBack = () =&gt; {
        cleanupTemporaryDataLocal();
        router.push('/upload');
    };

   if (authLoading || (isLoading && !initialDataLoaded)) {
     return (
        &lt;div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]"&gt;
          &lt;Loader2 className="h-8 w-8 animate-spin text-primary" /&gt;
           &lt;span className="ml-2"&gt;{t('loading_data')}...&lt;/span&gt;
        &lt;/div&gt;
     );
   }

   if (!user && !authLoading) {
    return null;
   }

    if (errorLoading) {
        return (
            &lt;div className="container mx-auto p-4 md:p-8 space-y-4"&gt;
                &lt;Alert variant="destructive"&gt;
                    &lt;AlertTitle&gt;{t('edit_invoice_error_loading_title')}&lt;/AlertTitle&gt;
                    &lt;AlertDescription&gt;{errorLoading}&lt;/AlertDescription&gt;
                &lt;/Alert&gt;
                &lt;Button variant="outline" onClick={handleGoBack}&gt;
                   &lt;ArrowLeft className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_go_back_button')}
                &lt;/Button&gt;
            &lt;/div&gt;
        );
    }

    if (initialDataLoaded && documentType === 'deliveryNote' && products.length === 0 && !errorLoading && !scanProcessError) {
         return (
             &lt;div className="container mx-auto p-4 md:p-8 space-y-4"&gt;
                 &lt;Alert variant="default"&gt;
                     &lt;AlertTitle&gt;{t('edit_invoice_no_products_found_title')}&lt;/AlertTitle&gt;
                     &lt;AlertDescription&gt;
                        {t('edit_invoice_no_products_found_desc')}
                     &lt;/AlertDescription&gt;
                 &lt;/Alert&gt;
                 &lt;Card className="shadow-md scale-fade-in"&gt;
                     &lt;CardHeader&gt;
                         &lt;CardTitle className="text-xl sm:text-2xl font-semibold text-primary"&gt;{t('edit_invoice_add_manually_title')}&lt;/CardTitle&gt;
                         &lt;CardDescription&gt;
                            {t('edit_invoice_file')}: &lt;span className="font-medium"&gt;{originalFileName || t('edit_invoice_unknown_document')}&lt;/span&gt;
                         &lt;/CardDescription&gt;
                     &lt;/CardHeader&gt;
                      &lt;CardContent&gt;
                           &lt;div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3"&gt;
                             &lt;Button variant="outline" onClick={handleAddRow} className="w-full sm:w-auto"&gt;
                               &lt;PlusCircle className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_add_row_button')}
                             &lt;/Button&gt;
                             &lt;Button onClick={handleSaveChecks} disabled={isSaving || !isSupplierConfirmed || !selectedPaymentDueDate} className="bg-primary hover:bg-primary/90 w-full sm:w-auto"&gt;
                              {isSaving ? (
                                 &lt;&gt;
                                   &lt;Loader2 className="mr-2 h-4 w-4 animate-spin" /&gt; {t('saving')}...
                                 &lt;/&gt;
                              ) : (
                                 &lt;&gt;
                                   &lt;Save className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_save_changes_button')}
                                 &lt;/&gt;
                               )}
                             &lt;/Button&gt;
                         &lt;/div&gt;
                           &lt;div className="mt-6"&gt;
                               &lt;Button variant="outline" onClick={handleGoBack}&gt;
                                   &lt;ArrowLeft className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_go_back_button')}
                               &lt;/Button&gt;
                           &lt;/div&gt;
                      &lt;/CardContent&gt;
                 &lt;/Card&gt;
             &lt;/div&gt;
         );
    }

     if (scanProcessError && documentType === 'deliveryNote' && products.length === 0) {
        return (
            &lt;div className="container mx-auto p-4 md:p-8 space-y-4"&gt;
                &lt;Alert variant="destructive"&gt;
                    &lt;AlertTitle&gt;{t('edit_invoice_scan_process_error_title')}&lt;/AlertTitle&gt;
                    &lt;AlertDescription&gt;
                        {t('edit_invoice_scan_process_error_desc', { error: scanProcessError })}
                    &lt;/AlertDescription&gt;
                &lt;/Alert&gt;
                 &lt;Card className="shadow-md scale-fade-in"&gt;
                     &lt;CardHeader&gt;
                         &lt;CardTitle className="text-xl sm:text-2xl font-semibold text-primary"&gt;{t('edit_invoice_add_manually_title')}&lt;/CardTitle&gt;
                         &lt;CardDescription&gt;
                           {t('edit_invoice_file')}: &lt;span className="font-medium"&gt;{originalFileName || t('edit_invoice_unknown_document')}&lt;/span&gt;
                         &lt;/CardDescription&gt;
                     &lt;/CardHeader&gt;
                      &lt;CardContent&gt;
                           &lt;div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3"&gt;
                             &lt;Button variant="outline" onClick={handleAddRow} className="w-full sm:w-auto"&gt;
                               &lt;PlusCircle className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_add_row_button')}
                             &lt;/Button&gt;
                             &lt;Button onClick={handleSaveChecks} disabled={isSaving || products.length === 0 || !isSupplierConfirmed || !selectedPaymentDueDate} className="bg-primary hover:bg-primary/90 w-full sm:w-auto"&gt;
                              {isSaving ? (
                                 &lt;&gt;
                                   &lt;Loader2 className="mr-2 h-4 w-4 animate-spin" /&gt; {t('saving')}...
                                 &lt;/&gt;
                              ) : (
                                 &lt;&gt;
                                   &lt;Save className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_save_changes_button')}
                                 &lt;/&gt;
                               )}
                             &lt;/Button&gt;
                         &lt;/div&gt;
                           &lt;div className="mt-6"&gt;
                               &lt;Button variant="outline" onClick={handleGoBack}&gt;
                                   &lt;ArrowLeft className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_go_back_button')}
                               &lt;/Button&gt;
                           &lt;/div&gt;
                      &lt;/CardContent&gt;
                 &lt;/Card&gt;
            &lt;/div&gt;
        );
    }


  return (
    &lt;div className="container mx-auto p-4 md:p-8 space-y-6"&gt;
      &lt;Card className="shadow-md scale-fade-in"&gt;
        &lt;CardHeader&gt;
          &lt;CardTitle className="text-xl sm:text-2xl font-semibold text-primary"&gt;
            {documentType === 'invoice' ? t('edit_invoice_title_tax_invoice') : t('edit_invoice_title')}
          &lt;/CardTitle&gt;
          &lt;CardDescription&gt;
             {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
             {extractedSupplierName && ` | ${t('edit_invoice_supplier', { supplierName: extractedSupplierName })}`}
          &lt;/CardDescription&gt;
           {scanProcessError && (
             &lt;Alert variant="destructive" className="mt-2"&gt;
                &lt;AlertTitle&gt;{t('edit_invoice_scan_process_error_title')}&lt;/AlertTitle&gt;
                &lt;AlertDescription&gt;{scanProcessError}&lt;/AlertDescription&gt;
             &lt;/Alert&gt;
           )}
        &lt;/CardHeader&gt;
        &lt;CardContent&gt;
            {documentType === 'invoice' ? (
                 &lt;div className="space-y-4"&gt;
                     &lt;div&gt;
                         &lt;Label htmlFor="taxSupplierName"&gt;{t('invoice_details_supplier_label')}&lt;/Label&gt;
                         &lt;Input id="taxSupplierName" value={editableTaxInvoiceDetails.supplierName || ''} onChange={(e) =&gt; handleTaxInvoiceDetailsChange('supplierName', e.target.value)} disabled={isSaving} /&gt;
                     &lt;/div&gt;
                     &lt;div&gt;
                         &lt;Label htmlFor="taxInvoiceNumber"&gt;{t('invoice_details_invoice_number_label')}&lt;/Label&gt;
                         &lt;Input id="taxInvoiceNumber" value={editableTaxInvoiceDetails.invoiceNumber || ''} onChange={(e) =&gt; handleTaxInvoiceDetailsChange('invoiceNumber', e.target.value)} disabled={isSaving} /&gt;
                     &lt;/div&gt;
                     &lt;div&gt;
                         &lt;Label htmlFor="taxTotalAmount"&gt;{t('invoice_details_total_amount_label')}&lt;/Label&gt;
                         &lt;Input id="taxTotalAmount" type="number" value={editableTaxInvoiceDetails.totalAmount ?? ''} onChange={(e) =&gt; handleTaxInvoiceDetailsChange('totalAmount', e.target.value === '' ? undefined : parseFloat(e.target.value))} disabled={isSaving} /&gt;
                     &lt;/div&gt;
                     &lt;div&gt;
                         &lt;Label htmlFor="taxInvoiceDate"&gt;{t('invoice_details_invoice_date_label')}&lt;/Label&gt;
                         &lt;Input 
                            id="taxInvoiceDate" 
                            type="date" 
                            value={editableTaxInvoiceDetails.invoiceDate ? format(parseISO(editableTaxInvoiceDetails.invoiceDate), 'yyyy-MM-dd') : ''} 
                            onChange={(e) =&gt; handleTaxInvoiceDetailsChange('invoiceDate', e.target.value ? parseISO(e.target.value).toISOString() : undefined)} 
                            disabled={isSaving} /&gt;
                     &lt;/div&gt;
                     &lt;div&gt;
                         &lt;Label htmlFor="taxPaymentMethod"&gt;{t('invoice_details_payment_method_label')}&lt;/Label&gt;
                         &lt;Input id="taxPaymentMethod" value={editableTaxInvoiceDetails.paymentMethod || ''} onChange={(e) =&gt; handleTaxInvoiceDetailsChange('paymentMethod', e.target.value)} disabled={isSaving} /&gt;
                     &lt;/div&gt;
                 &lt;/div&gt;
            ) : (
              &lt;div className="overflow-x-auto relative"&gt;
                &lt;Table className="min-w-[600px]"&gt;
                  &lt;TableHeader&gt;
                    &lt;TableRow&gt;
                      &lt;TableHead className="px-2 sm:px-4 py-2"&gt;{t('edit_invoice_th_catalog')}&lt;/TableHead&gt;
                      &lt;TableHead className="px-2 sm:px-4 py-2"&gt;{t('edit_invoice_th_description')}&lt;/TableHead&gt;
                      &lt;TableHead className="text-right px-2 sm:px-4 py-2"&gt;{t('edit_invoice_th_qty')}&lt;/TableHead&gt;
                      &lt;TableHead className="text-right px-2 sm:px-4 py-2"&gt;{t('edit_invoice_th_unit_price', { currency_symbol: t('currency_symbol') })}&lt;/TableHead&gt;
                      &lt;TableHead className="text-right px-2 sm:px-4 py-2"&gt;{t('edit_invoice_th_line_total', { currency_symbol: t('currency_symbol') })}&lt;/TableHead&gt;
                      &lt;TableHead className="text-right px-2 sm:px-4 py-2"&gt;{t('edit_invoice_th_actions')}&lt;/TableHead&gt;
                    &lt;/TableRow&gt;
                  &lt;/TableHeader&gt;
                  &lt;TableBody&gt;
                    {products.map((product) =&gt; (
                      &lt;TableRow key={product.id}&gt;
                        &lt;TableCell className="px-2 sm:px-4 py-2"&gt;
                          &lt;Input
                            value={product.catalogNumber || ''}
                            onChange={(e) =&gt; handleInputChange(product.id, 'catalogNumber', e.target.value)}
                            className="min-w-[100px] h-9"
                            aria-label={t('edit_invoice_aria_catalog', { description: product.description || '' })}
                          /&gt;
                        &lt;/TableCell&gt;
                        &lt;TableCell className="px-2 sm:px-4 py-2"&gt;
                          &lt;Input
                            value={product.description || ''}
                            onChange={(e) =&gt; handleInputChange(product.id, 'description', e.target.value)}
                            className="min-w-[150px] sm:min-w-[200px] h-9"
                            aria-label={t('edit_invoice_aria_description', { catalogNumber: product.catalogNumber || '' })}
                          /&gt;
                        &lt;/TableCell&gt;
                        &lt;TableCell className="text-right px-2 sm:px-4 py-2"&gt;
                          &lt;Input
                            type="number"
                            value={formatInputValue(product.quantity, 'quantity')}
                            onChange={(e) =&gt; handleInputChange(product.id, 'quantity', e.target.value)}
                            className="w-20 sm:w-24 text-right h-9"
                            min="0"
                            step="any"
                            aria-label={t('edit_invoice_aria_qty', { description: product.description || '' })}
                          /&gt;
                        &lt;/TableCell&gt;
                        &lt;TableCell className="text-right px-2 sm:px-4 py-2"&gt;
                          &lt;Input
                            type="number"
                            value={formatInputValue(product.unitPrice, 'currency')}
                            onChange={(e) =&gt; handleInputChange(product.id, 'unitPrice', e.target.value)}
                            className="w-24 sm:w-28 text-right h-9"
                            step="0.01"
                            min="0"
                            aria-label={t('edit_invoice_aria_unit_price', { description: product.description || '' })}
                          /&gt;
                        &lt;/TableCell&gt;
                        &lt;TableCell className="text-right px-2 sm:px-4 py-2"&gt;
                          &lt;Input
                            type="number"
                            value={formatInputValue(product.lineTotal, 'currency')}
                            onChange={(e) =&gt; handleInputChange(product.id, 'lineTotal', e.target.value)}
                            className="w-24 sm:w-28 text-right h-9"
                            step="0.01"
                             min="0"
                             aria-label={t('edit_invoice_aria_line_total', { description: product.description || '' })}
                          /&gt;
                        &lt;/TableCell&gt;
                        &lt;TableCell className="text-right px-2 sm:px-4 py-2"&gt;
                          &lt;Button
                            variant="ghost"
                            size="icon"
                            onClick={() =&gt; handleRemoveRow(product.id)}
                            className="text-destructive hover:text-destructive/80 h-8 w-8"
                             aria-label={t('edit_invoice_aria_remove_row', { description: product.description || '' })}
                          &gt;
                            &lt;Trash2 className="h-4 w-4" /&gt;
                          &lt;/Button&gt;
                        &lt;/TableCell&gt;
                      &lt;/TableRow&gt;
                    ))}
                  &lt;/TableBody&gt;
                &lt;/Table&gt;
              &lt;/div&gt;
            )}
          &lt;div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3"&gt;
             {documentType === 'deliveryNote' && (
                &lt;Button variant="outline" onClick={handleAddRow} className="w-full sm:w-auto"&gt;
                    &lt;PlusCircle className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_add_row_button')}
                &lt;/Button&gt;
             )}
             &lt;Button 
                onClick={handleSaveChecks} 
                disabled={isSaving || (documentType === 'deliveryNote' && products.length === 0 && !scanProcessError) || !isSupplierConfirmed || !selectedPaymentDueDate} 
                className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
             &gt;
              {isSaving ? (
                 &lt;&gt;
                   &lt;Loader2 className="mr-2 h-4 w-4 animate-spin" /&gt; {t('saving')}...
                 &lt;/&gt;
              ) : (
                 &lt;&gt;
                   &lt;Save className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_save_changes_button')}
                 &lt;/&gt;
               )}
             &lt;/Button&gt;
          &lt;/div&gt;
             &lt;div className="mt-6"&gt;
                 &lt;Button variant="outline" onClick={handleGoBack}&gt;
                     &lt;ArrowLeft className="mr-2 h-4 w-4" /&gt; {t('edit_invoice_go_back_button')}
                 &lt;/Button&gt;
             &lt;/div&gt;
        &lt;/CardContent&gt;
      &lt;/Card&gt;

       {showSupplierDialog && potentialSupplierName && (
        &lt;SupplierConfirmationDialog
          potentialSupplierName={potentialSupplierName}
          existingSuppliers={existingSuppliers}
          onConfirm={handleSupplierConfirmation}
          onCancel={() =&gt; {
            setShowSupplierDialog(false);
            setIsSupplierConfirmed(true);
            setExtractedSupplierName(aiScannedSupplierName); // Use AI scanned name if user cancels dialog
            setEditableTaxInvoiceDetails(prev =&gt; ({ ...prev, supplierName: aiScannedSupplierName }));
            setShowPaymentDueDateDialog(true); 
          }}
          isOpen={showSupplierDialog}
          onOpenChange={setShowSupplierDialog}
        /&gt;
      )}

      {showPaymentDueDateDialog && isSupplierConfirmed && (
        &lt;PaymentDueDateDialog
          isOpen={showPaymentDueDateDialog}
          onOpenChange={setShowPaymentDueDateDialog}
          onConfirm={handlePaymentDueDateConfirm}
          onCancel={() =&gt; {
            setShowPaymentDueDateDialog(false);
            toast({title: t('edit_invoice_toast_payment_due_date_skipped_title'), description: t('edit_invoice_toast_payment_due_date_skipped_desc'), variant: "default"});
            setSelectedPaymentDueDate(undefined); 
            handleSaveChecks(); 
          }}
        /&gt;
      )}


      {promptingForNewProductDetails && documentType === 'deliveryNote' && (
        &lt;BarcodePromptDialog
          products={promptingForNewProductDetails}
          onComplete={handleNewProductDetailsComplete}
          isOpen={isBarcodePromptOpen}
          onOpenChange={setIsBarcodePromptOpen}
        /&gt;
      )}

      {priceDiscrepancies && documentType === 'deliveryNote' && (
        &lt;UnitPriceConfirmationDialog
          discrepancies={priceDiscrepancies}
          onComplete={handlePriceConfirmationComplete}
        /&gt;
      )}
    &lt;/div&gt;
  );
}

export default function EditInvoicePage() {
  const { t } = useTranslation();
  return (
    &lt;Suspense fallback={
        &lt;div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]"&gt;
          &lt;Loader2 className="h-8 w-8 animate-spin text-primary" /&gt;
           &lt;span className="ml-2"&gt;{t('loading_editor')}...&lt;/span&gt;
        &lt;/div&gt;
    }&gt;
      &lt;EditInvoiceContent /&gt;
    &lt;/Suspense&gt;
  );
}
