'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, PlusCircle, Save, Loader2, ArrowLeft } from 'lucide-react';
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
} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog';
import SupplierConfirmationDialog from '@/components/supplier-confirmation-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';


interface EditableProduct extends Product {
  _originalId?: string;
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
  const { t } = useTranslation();

  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [errorLoading, setErrorLoading] = useState<string | null>(null);
  const [scanProcessError, setScanProcessError] = useState<string | null>(null);

  const [dataKey, setDataKey] = useState<string | null>(null);
  const [tempInvoiceId, setTempInvoiceId] = useState<string | null>(null);
  const [originalImagePreviewKey, setOriginalImagePreviewKey] = useState<string | null>(null);
  const [compressedImageKeyFromParam, setCompressedImageKeyFromParam] = useState<string | null>(null);


  const [extractedInvoiceNumber, setExtractedInvoiceNumber] = useState<string | undefined>(undefined);
  const [extractedSupplierName, setExtractedSupplierName] = useState<string | undefined>(undefined);
  const [extractedTotalAmount, setExtractedTotalAmount] = useState<number | undefined>(undefined);


  const [promptingForNewProductDetails, setPromptingForNewProductDetails] = useState<Product[] | null>(null);
  const [isBarcodePromptOpen, setIsBarcodePromptOpen] = useState(false);
  const [priceDiscrepancies, setPriceDiscrepancies] = useState<ProductPriceDiscrepancy[] | null>(null);

  const [productsForNextStep, setProductsForNextStep] = useState<Product[]>([]);

  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [potentialSupplierName, setPotentialSupplierName] = useState<string | undefined>(undefined);
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [isSupplierConfirmed, setIsSupplierConfirmed] = useState(false);
  const [aiScannedSupplierName, setAiScannedSupplierName] = useState<string | undefined>(undefined);


  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);


   const cleanupTemporaryDataLocal = useCallback(() => {
    if (!user?.id) {
        console.warn("[EditInvoice] cleanupTemporaryDataLocal called, but user ID is missing. Cannot reliably clear data.");
        return;
    }
    let uniqueIdToClear: string | null = null;
    if (dataKey?.startsWith(TEMP_DATA_KEY_PREFIX)) {
        // Extract the part after TEMP_DATA_KEY_PREFIX and user.id_
        const prefix = `${TEMP_DATA_KEY_PREFIX}${user.id}_`;
        if (dataKey.startsWith(prefix)) {
            uniqueIdToClear = dataKey.substring(prefix.length);
        }
    } else if (tempInvoiceId?.startsWith('pending-inv-')) {
        // Extract the part after pending-inv-user.id_
        const prefix = `pending-inv-${user.id}_`;
        if (tempInvoiceId.startsWith(prefix)) {
            uniqueIdToClear = tempInvoiceId.substring(prefix.length);
        }
    }


    if (uniqueIdToClear) {
        clearTemporaryScanData(uniqueIdToClear, user.id); // Pass user.id
        console.log(`[EditInvoice] Triggered cleanup for scan result associated with UserID: ${user.id}, Unique ID: ${uniqueIdToClear}`);
    } else {
        console.log("[EditInvoice] cleanupTemporaryDataLocal called, but no dataKey or relevant tempInvoiceId found to clear for the current user.");
    }
  }, [dataKey, tempInvoiceId, user?.id]);


  useEffect(() => {
    if (!user) return; 
    const key = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    const tempInvIdParam = searchParams.get('tempInvoiceId');
    const compressedKeyParam = searchParams.get('compressedImageKey');

    setDataKey(key);
    setTempInvoiceId(tempInvIdParam);
    setCompressedImageKeyFromParam(compressedKeyParam);

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

        let parsedData: ScanInvoiceOutput;
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
             setIsLoading(false);
             setInitialDataLoaded(true);
            return;
        }

        if (parsedData.error) {
            setScanProcessError(parsedData.error);
        }


        if (parsedData && Array.isArray(parsedData.products)) {
          const productsWithIds = parsedData.products.map((p: Product, index: number) => ({
            ...p,
            id: p.id || `prod-temp-${Date.now()}-${index}`, // Ensure a temporary ID
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
          setExtractedInvoiceNumber(parsedData.invoiceNumber);
          setAiScannedSupplierName(parsedData.supplier);
          setExtractedTotalAmount(parsedData.totalAmount);
          setErrorLoading(null);
          checkSupplier(parsedData.supplier, user.id);

        } else if (!parsedData.error) {
          console.error("Parsed data is missing 'products' array or is invalid:", parsedData);
          cleanupTemporaryDataLocal();
           setErrorLoading(t('edit_invoice_error_invalid_structure_parsed'));
           toast({
               title: t('edit_invoice_toast_error_loading_title'),
               description: t('edit_invoice_toast_error_loading_desc_invalid_structure'),
               variant: "destructive",
           });
          setProducts([]);
        }
    } else if (!initialDataLoaded) {
       hasAttemptedLoad = true;
       setErrorLoading(t('edit_invoice_error_no_key'));
       setProducts([]);
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


  const checkSupplier = async (scannedSupplierName?: string, currentUserId?: string) => {
    if (!scannedSupplierName || !currentUserId) {
      setIsSupplierConfirmed(true);
      return;
    }
    try {
      const suppliers = await getSupplierSummariesService(currentUserId); // Pass userId
      setExistingSuppliers(suppliers);
      const isExisting = suppliers.some(s => s.name.toLowerCase() === scannedSupplierName.toLowerCase());
      if (isExisting) {
        setExtractedSupplierName(scannedSupplierName);
        setIsSupplierConfirmed(true);
      } else {
        setPotentialSupplierName(scannedSupplierName);
        setShowSupplierDialog(true);
      }
    } catch (error) {
      console.error("Error fetching existing suppliers:", error);
      toast({ title: t('edit_invoice_toast_error_fetching_suppliers'), variant: "destructive" });
      setExtractedSupplierName(scannedSupplierName); // Fallback to AI scanned name
      setIsSupplierConfirmed(true);
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
      if (isNew) {
        try {
          await updateSupplierContactInfoService(confirmedSupplierName, {}, user.id); // Pass userId
          toast({ title: t('edit_invoice_toast_new_supplier_added_title'), description: t('edit_invoice_toast_new_supplier_added_desc', { supplierName: confirmedSupplierName }) });
        } catch (error) {
          console.error("Failed to add new supplier:", error);
          toast({ title: t('edit_invoice_toast_fail_add_supplier_title'), variant: "destructive" });
        }
      }
    } else {
      // User cancelled or closed dialog without confirming new/existing, use AI scanned one
      setExtractedSupplierName(aiScannedSupplierName);
    }
    setIsSupplierConfirmed(true); // Always confirm after dialog interaction
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
                updatedProduct.unitPrice = (currentLineTotal === 0) ? 0 : currentUnitPrice; // If total is 0, unit price is 0, else keep current (could be manually set)
            }
          }


          // Ensure unitPrice is correctly derived if total and quantity are present, unless unitPrice was just edited
          if (currentQuantity > 0 && currentLineTotal !== 0) {
            const derivedUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
            if (Math.abs(derivedUnitPrice - currentUnitPrice) > 0.001 && field !== 'unitPrice') {
                 updatedProduct.unitPrice = derivedUnitPrice;
            }
          } else if (currentQuantity === 0 && currentLineTotal === 0) {
            updatedProduct.unitPrice = 0; // If both are zero, unit price is zero
          }


          return updatedProduct;
        }
        return p;
      })
    );
  };


  const handleAddRow = () => {
    const newProduct: EditableProduct = {
      id: `prod-temp-${Date.now()}-new`, // Ensure new products have a distinct temporary ID format
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
      if (!user?.id) {
          toast({ title: "User not authenticated", description: "Cannot save products.", variant: "destructive" });
          setIsSaving(false);
          return;
      }
      try {
          console.log("[EditInvoice] Proceeding with final save. Products:", JSON.stringify(finalProductsToSave.slice(0,2))); // Log first 2 products

          const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => rest);

          let finalFileName = originalFileName;
          if(extractedSupplierName && extractedInvoiceNumber) {
            finalFileName = `${extractedSupplierName}_${extractedInvoiceNumber}`;
          } else if (extractedSupplierName) {
            finalFileName = extractedSupplierName;
          } else if (extractedInvoiceNumber) {
            finalFileName = `Invoice_${extractedInvoiceNumber}`;
          }
          
          console.log(`[EditInvoice] Finalizing save for file: ${finalFileName}, tempInvoiceId: ${tempInvoiceId}, UserID: ${user.id}`);

          await finalizeSaveProductsService(
            productsForService,
            finalFileName,
            'upload', // source
            user.id,  // Pass userId
            tempInvoiceId || undefined,
            extractedInvoiceNumber,
            extractedSupplierName,
            extractedTotalAmount
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
                description: t('upload_toast_storage_full_desc_finalize'),
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


 const handleSave = async () => {
    if (!isSupplierConfirmed) {
        setShowSupplierDialog(true);
        toast({ title: t('edit_invoice_toast_supplier_not_confirmed_title'), description: t('edit_invoice_toast_supplier_not_confirmed_desc'), variant: "default" });
        return;
    }
    if (!user?.id) {
        toast({ title: "User not authenticated", description: "Cannot proceed with saving.", variant: "destructive" });
        return;
    }

    setIsSaving(true);
    try {
        const productsFromEdit = products.map(({ _originalId, ...rest }) => rest);
        const priceCheckResult = await checkProductPricesBeforeSaveService(productsFromEdit, user.id, tempInvoiceId || undefined); // Pass userId

        setProductsForNextStep(priceCheckResult.productsToSaveDirectly);

        if (priceCheckResult.priceDiscrepancies.length > 0) {
            setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
            setIsSaving(false); // Allow user to resolve discrepancies
        } else {
            await checkForNewProductsAndDetails(priceCheckResult.productsToSaveDirectly);
        }
    } catch (error) {
        console.error("Error during initial save checks:", error);
        toast({
            title: t('edit_invoice_toast_error_preparing_save_title'),
            description: t('edit_invoice_toast_error_preparing_save_desc', { message: (error as Error).message}),
            variant: "destructive",
        });
        setIsSaving(false);
    }
};

const checkForNewProductsAndDetails = async (productsReadyForDetailCheck: Product[]) => {
    setIsSaving(true); // Keep isSaving true
    if (!user?.id) {
        toast({ title: "User not authenticated", description: "Cannot check for new products.", variant: "destructive" });
        setIsSaving(false);
        return;
    }
    try {
        const currentInventory = await getProductsService(user.id); // Pass userId
        const inventoryMap = new Map<string, Product>();
        currentInventory.forEach(p => {
            if (p.id) inventoryMap.set(`id:${p.id}`, p);
            if (p.catalogNumber && p.catalogNumber !== "N/A") inventoryMap.set(`catalog:${p.catalogNumber}`, p);
            if (p.barcode) inventoryMap.set(`barcode:${p.barcode}`, p);
        });

        const newProductsNeedingDetails = productsReadyForDetailCheck.filter(p => {
             const isExistingById = p.id && !p.id.startsWith('prod-temp-') && inventoryMap.has(`id:${p.id}`); // Check if it's not a temporary ID
            const isExistingByCatalog = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
            const isExistingByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);

            const isProductConsideredNew = !(isExistingById || isExistingByCatalog || isExistingByBarcode);

            const needsSalePrice = p.salePrice === undefined || p.salePrice === null;
            return isProductConsideredNew || needsSalePrice;
        });

        if (newProductsNeedingDetails.length > 0) {
            setProductsForNextStep(productsReadyForDetailCheck); // Keep the full list for the final save
            setPromptingForNewProductDetails(newProductsNeedingDetails); // Only show new/missing sale price items in dialog
            setIsBarcodePromptOpen(true);
            setIsSaving(false); // Allow user to interact with the dialog
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
    setPriceDiscrepancies(null); // Close price dialog
    if (resolvedProducts) {
        // Update the productsForNextStep with the confirmed prices
        const allProductsAfterPriceCheck = productsForNextStep.map(originalProduct => {
            const resolvedVersion = resolvedProducts.find(rp => rp.id === originalProduct.id);
            return resolvedVersion ? { ...originalProduct, unitPrice: resolvedVersion.unitPrice } : originalProduct;
        });
        setProductsForNextStep(allProductsAfterPriceCheck); // Update the state with resolved prices
        checkForNewProductsAndDetails(allProductsAfterPriceCheck); // Proceed to next check
    } else {
        // User cancelled price confirmation
        toast({
            title: t('edit_invoice_toast_save_cancelled_title'),
            description: t('edit_invoice_toast_save_cancelled_desc_price'),
            variant: "default",
        });
        setIsSaving(false); // Reset saving state
    }
};


 const handleNewProductDetailsComplete = (updatedNewProductsFromDialog: Product[] | null) => {
     setPromptingForNewProductDetails(null); // Close barcode/details dialog
     setIsBarcodePromptOpen(false);

     if (updatedNewProductsFromDialog) {
         // Merge the updates from the dialog (barcode, salePrice) into the productsForNextStep list
         const finalProductsToSave = productsForNextStep.map(originalProduct => {
             const updatedVersion = updatedNewProductsFromDialog.find(unp => 
                 // Match by temp ID if originalProduct has one, or by catalogNumber as fallback
                 (originalProduct.id.startsWith('prod-temp-') && unp.id === originalProduct.id) || 
                 (!originalProduct.id.startsWith('prod-temp-') && unp.catalogNumber === originalProduct.catalogNumber)
             );
             if (updatedVersion) {
                 return {
                     ...originalProduct,
                     barcode: updatedVersion.barcode || originalProduct.barcode, // Keep original if dialog didn't provide
                     salePrice: updatedVersion.salePrice, // This should be set from the dialog
                 };
             }
             return originalProduct;
         });
         console.log("[EditInvoice] Products ready for final save after details dialog:", JSON.stringify(finalProductsToSave.slice(0,2)));
         proceedWithFinalSave(finalProductsToSave);
     } else {
         // User cancelled the new product details dialog
         toast({
             title: t('edit_invoice_toast_save_incomplete_title'),
             description: t('edit_invoice_toast_save_incomplete_desc_details'),
             variant: "default",
         });
          setIsSaving(false); // Reset saving state
     }
 };


    const handleGoBack = () => {
        cleanupTemporaryDataLocal();
        router.push('/upload');
    };

   if (authLoading || (isLoading && !initialDataLoaded)) {
     return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <span className="ml-2">{t('loading_data')}...</span>
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

    if (initialDataLoaded && products.length === 0 && !errorLoading && !scanProcessError) {
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
                             <Button onClick={handleSave} disabled={isSaving || !isSupplierConfirmed} className="bg-primary hover:bg-primary/90 w-full sm:w-auto"> {/* Allow save even if products empty for manual add */}
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

     if (scanProcessError) {
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
                             <Button onClick={handleSave} disabled={isSaving || products.length === 0 || !isSupplierConfirmed} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
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


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md scale-fade-in">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary">{t('edit_invoice_title')}</CardTitle>
          <CardDescription>
             {t('edit_invoice_description_file', { fileName: originalFileName || t('edit_invoice_unknown_document') })}
             {extractedSupplierName && ` | ${t('edit_invoice_supplier', { supplierName: extractedSupplierName })}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto relative">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 sm:px-4 py-2">{t('edit_invoice_th_catalog')}</TableHead>
                  <TableHead className="px-2 sm:px-4 py-2">{t('edit_invoice_th_description')}</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_qty')}</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_unit_price', { currency_symbol: t('currency_symbol') })}</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_line_total', { currency_symbol: t('currency_symbol') })}</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
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
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
             <Button variant="outline" onClick={handleAddRow} className="w-full sm:w-auto">
               <PlusCircle className="mr-2 h-4 w-4" /> {t('edit_invoice_add_row_button')}
             </Button>
             <Button onClick={handleSave} disabled={isSaving || products.length === 0 || !isSupplierConfirmed} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
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

       {showSupplierDialog && potentialSupplierName && (
        <SupplierConfirmationDialog
          potentialSupplierName={potentialSupplierName}
          existingSuppliers={existingSuppliers}
          onConfirm={handleSupplierConfirmation}
          onCancel={() => {
            setShowSupplierDialog(false);
            setIsSupplierConfirmed(true); 
            setExtractedSupplierName(aiScannedSupplierName); // Fallback to AI if cancelled
          }}
          isOpen={showSupplierDialog}
          onOpenChange={setShowSupplierDialog}
        />
      )}

      {promptingForNewProductDetails && (
        <BarcodePromptDialog
          products={promptingForNewProductDetails}
          onComplete={handleNewProductDetailsComplete}
          isOpen={isBarcodePromptOpen}
          onOpenChange={setIsBarcodePromptOpen}
        />
      )}

      {priceDiscrepancies && (
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