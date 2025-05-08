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
    TEMP_COMPRESSED_IMAGE_KEY_PREFIX
} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog';
import SupplierConfirmationDialog from '@/components/supplier-confirmation-dialog';
import { useTranslation } from '@/hooks/useTranslation';


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
  const [compressedImageKey, setCompressedImageKey] = useState<string | null>(null);

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

   const cleanupTemporaryData = useCallback(() => {
    if (dataKey) {
        clearTemporaryScanData(dataKey.replace(TEMP_DATA_KEY_PREFIX, ''));
        console.log(`[EditInvoice] Triggered cleanup for scan result associated with key: ${dataKey}`);
    } else if (tempInvoiceId && tempInvoiceId.startsWith('pending-inv-')) {
        const uniqueScanId = tempInvoiceId.replace('pending-inv-', '');
        clearTemporaryScanData(uniqueScanId);
        console.log(`[EditInvoice] Triggered cleanup based on tempInvoiceId: ${tempInvoiceId}`);
    } else {
        console.log("[EditInvoice] cleanupTemporaryData called, but no dataKey or relevant tempInvoiceId found to clear.");
    }
  }, [dataKey, tempInvoiceId]);


  useEffect(() => {
    const key = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    const tempInvIdParam = searchParams.get('tempInvoiceId');
    
    setDataKey(key);
    setTempInvoiceId(tempInvIdParam);

    // Construct other keys based on the unique part of the dataKey or tempInvIdParam
    let uniquePart: string | null = null;
    if (key?.startsWith(TEMP_DATA_KEY_PREFIX)) {
        uniquePart = key.replace(TEMP_DATA_KEY_PREFIX, '');
    } else if (tempInvIdParam?.startsWith('pending-inv-')) {
        uniquePart = tempInvIdParam.replace('pending-inv-', '');
    }

    if (uniquePart) {
        setOriginalImagePreviewKey(`${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${uniquePart}`);
        setCompressedImageKey(`${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${uniquePart}`);
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
            cleanupTemporaryData(); 
            setIsLoading(false);
            setInitialDataLoaded(true);
            return;
        }

        let parsedData: ScanInvoiceOutput;
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
            id: p.id || `${Date.now()}-${index}`,
            _originalId: p.id,
            quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
            lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
             unitPrice: (typeof p.quantity === 'number' && p.quantity !== 0 && typeof p.lineTotal === 'number')
                        ? parseFloat((p.lineTotal / p.quantity).toFixed(2))
                        : (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice)) || 0),
            salePrice: p.salePrice ?? undefined,
            minStockLevel: p.minStockLevel ?? undefined,
            maxStockLevel: p.maxStockLevel ?? undefined,
          }));
          setProducts(productsWithIds);
          setExtractedInvoiceNumber(parsedData.invoiceNumber);
          setAiScannedSupplierName(parsedData.supplier); 
          setExtractedTotalAmount(parsedData.totalAmount);
          setErrorLoading(null);
          checkSupplier(parsedData.supplier);

        } else if (!parsedData.error) {
          console.error("Parsed data is missing 'products' array or is invalid:", parsedData);
          cleanupTemporaryData(); 
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
  }, [searchParams, toast, initialDataLoaded, cleanupTemporaryData, t]);


  const checkSupplier = async (scannedSupplierName?: string) => {
    if (!scannedSupplierName) {
      setIsSupplierConfirmed(true); 
      return;
    }
    try {
      const suppliers = await getSupplierSummariesService();
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
      setExtractedSupplierName(scannedSupplierName); 
      setIsSupplierConfirmed(true);
    }
  };

  const handleSupplierConfirmation = async (confirmedSupplierName: string | null, isNew: boolean = false) => {
    setShowSupplierDialog(false);
    if (confirmedSupplierName) {
      setExtractedSupplierName(confirmedSupplierName);
      if (isNew) {
        try {
          await updateSupplierContactInfoService(confirmedSupplierName, {}); 
          toast({ title: t('edit_invoice_toast_new_supplier_added_title'), description: t('edit_invoice_toast_new_supplier_added_desc', { supplierName: confirmedSupplierName }) });
        } catch (error) {
          console.error("Failed to add new supplier:", error);
          toast({ title: t('edit_invoice_toast_fail_add_supplier_title'), variant: "destructive" });
        }
      }
    } else {
      setExtractedSupplierName(aiScannedSupplierName);
    }
    setIsSupplierConfirmed(true);
  };


  const handleInputChange = (id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.id === id) {
          let numericValue: number | string | undefined = value; 
          if (['quantity', 'unitPrice', 'lineTotal', 'minStockLevel', 'maxStockLevel'].includes(field)) {
              const stringValue = String(value);
              numericValue = parseFloat(stringValue.replace(/,/g, ''));
              if (isNaN(numericValue as number)) {
                 numericValue = (field === 'minStockLevel' || field === 'maxStockLevel') ? undefined : 0;
              }
          }

          const updatedProduct = { ...product, [field]: numericValue };

          const quantity = Number(updatedProduct.quantity) || 0;
          const unitPrice = Number(updatedProduct.unitPrice) || 0;
          const lineTotal = Number(updatedProduct.lineTotal) || 0;

          if (field === 'quantity' || field === 'unitPrice') {
               updatedProduct.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
          } else if (field === 'lineTotal') {
               if (quantity !== 0) {
                   updatedProduct.unitPrice = parseFloat((lineTotal / quantity).toFixed(2));
               } else if (lineTotal !== 0) {
                    updatedProduct.unitPrice = 0; 
               } else {
                    updatedProduct.unitPrice = 0; 
               }
          }
          return updatedProduct;
        }
        return product;
      })
    );
  };


  const handleAddRow = () => {
    const newProduct: EditableProduct = {
      id: `${Date.now()}-new`,
      catalogNumber: '',
      description: '',
      quantity: 0,
      unitPrice: 0,
      salePrice: undefined,
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
      try {
          const productsForService = finalProductsToSave.map(({ _originalId, ...rest }) => rest);
          let imageUriForFinalSave: string | undefined = undefined;
          if (compressedImageKey) {
              imageUriForFinalSave = localStorage.getItem(compressedImageKey) || undefined;
              console.log(`[EditInvoice] Retrieved compressed image for final save (key: ${compressedImageKey}). Exists: ${!!imageUriForFinalSave}`);
          } else {
              console.log("[EditInvoice] No compressed image key found, no image will be passed for final save.");
          }
          
          let finalFileName = originalFileName;
          if(extractedSupplierName && extractedInvoiceNumber) {
            finalFileName = `${extractedSupplierName}_${extractedInvoiceNumber}`;
          } else if (extractedSupplierName) {
            finalFileName = extractedSupplierName;
          } else if (extractedInvoiceNumber) {
            finalFileName = `Invoice_${extractedInvoiceNumber}`;
          }
          
          console.log("Proceeding to finalize save products:", productsForService, "for final file name:", finalFileName, "tempInvoiceId:", tempInvoiceId, "with imageUri for final save:", imageUriForFinalSave ? 'Exists' : 'Does not exist');
          
          await finalizeSaveProductsService(
            productsForService, 
            finalFileName, 
            'upload', 
            tempInvoiceId || undefined, 
            imageUriForFinalSave,
            extractedInvoiceNumber,
            extractedSupplierName, 
            extractedTotalAmount
          );

          cleanupTemporaryData(); 
          console.log("[EditInvoice] All temporary localStorage keys cleared after successful save.");


          toast({
              title: t('edit_invoice_toast_products_saved_title'),
              description: t('edit_invoice_toast_products_saved_desc'),
          });
          router.push('/inventory?refresh=true');

      } catch (error) {
          console.error("Failed to finalize save products:", error);
          toast({
              title: t('edit_invoice_toast_save_failed_title'),
              description: t('edit_invoice_toast_save_failed_desc_finalize', { message: (error as Error).message || t('edit_invoice_try_again')}),
              variant: "destructive",
          });
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

    setIsSaving(true);
    try {
        const productsFromEdit = products.map(({ _originalId, ...rest }) => rest);
        const priceCheckResult = await checkProductPricesBeforeSaveService(productsFromEdit, tempInvoiceId || undefined);
        
        setProductsForNextStep(priceCheckResult.productsToSaveDirectly);

        if (priceCheckResult.priceDiscrepancies.length > 0) {
            setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
            setIsSaving(false);
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
    setIsSaving(true);
    try {
        const currentInventory = await getProductsService();
        const inventoryMap = new Map<string, Product>();
        currentInventory.forEach(p => {
            if (p.id) inventoryMap.set(`id:${p.id}`, p);
             // Also map by catalog number if it's unique enough or a primary identifier for existing items.
            if (p.catalogNumber && p.catalogNumber !== "N/A") inventoryMap.set(`catalog:${p.catalogNumber}`, p);
            if (p.barcode) inventoryMap.set(`barcode:${p.barcode}`, p);
        });

        const newProductsNeedingDetails = productsReadyForDetailCheck.filter(p => {
            // Check if the product exists by ID (if it's not a newly generated ID), catalog number, or barcode
            const isExistingById = p.id && !p.id.includes('-new') && inventoryMap.has(`id:${p.id}`);
            const isExistingByCatalog = p.catalogNumber && p.catalogNumber !== "N/A" && inventoryMap.has(`catalog:${p.catalogNumber}`);
            const isExistingByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);

            const isProductConsideredNew = !(isExistingById || isExistingByCatalog || isExistingByBarcode);
            
            // A product needs details if it's new OR if it's marked with '-new' (an explicitly added row)
            // AND it doesn't have a sale price yet (assuming sale price is mandatory for new items)
            return (isProductConsideredNew || (p.id && p.id.includes('-new'))) && (p.salePrice === undefined || p.salePrice === null);
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
        const allProductsAfterPriceCheck = productsForNextStep.map(originalProduct => {
            const resolvedVersion = resolvedProducts.find(rp => rp.id === originalProduct.id);
            return resolvedVersion ? { ...originalProduct, unitPrice: resolvedVersion.unitPrice } : originalProduct;
        });
        
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


 const handleNewProductDetailsComplete = (updatedNewProducts: Product[] | null) => {
     setPromptingForNewProductDetails(null);
     setIsBarcodePromptOpen(false); 
     if (updatedNewProducts) {
         const finalProductsToSave = productsForNextStep.map(originalProduct => {
             const updatedVersion = updatedNewProducts.find(unp => unp.id === originalProduct.id);
             if (updatedVersion) {
                 return {
                     ...originalProduct,
                     barcode: updatedVersion.barcode,
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

   if (isLoading && !initialDataLoaded) {
     return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <span className="ml-2">{t('loading_data')}...</span>
        </div>
     );
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
                  <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_unit_price')}</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">{t('edit_invoice_th_line_total')}</TableHead>
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
            setExtractedSupplierName(aiScannedSupplierName);
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
