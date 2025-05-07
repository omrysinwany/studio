'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, PlusCircle, Save, Loader2, ArrowLeft, DollarSign } from 'lucide-react';
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
} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog';
import SupplierConfirmationDialog from '@/components/supplier-confirmation-dialog';


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

  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [fileName, setFileName] = useState<string>('');
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


  useEffect(() => {
    const key = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    const tempInvIdParam = searchParams.get('tempInvoiceId');
    const originalPreviewKeyParam = searchParams.get('originalImagePreviewKey');
    const compressedKeyParam = searchParams.get('compressedImageKey');

    setDataKey(key);
    setTempInvoiceId(tempInvIdParam);
    setOriginalImagePreviewKey(originalPreviewKeyParam);
    setCompressedImageKey(compressedKeyParam);

    let hasAttemptedLoad = false;

    if (nameParam) {
      setFileName(decodeURIComponent(nameParam));
    } else {
        setFileName('Unknown Document');
    }

    if (key) {
        hasAttemptedLoad = true;
        const storedData = localStorage.getItem(key);

        if (!storedData) {
            setErrorLoading("Scan results not found. They might have expired or been cleared.");
            setProducts([]);
            toast({
              title: "Error Loading Data",
              description: "Could not load the invoice data for editing. Scan results not found or expired.",
              variant: "destructive",
            });
            if (key) localStorage.removeItem(key); 
            if (originalPreviewKeyParam) localStorage.removeItem(originalPreviewKeyParam);
            if (compressedKeyParam) localStorage.removeItem(compressedKeyParam);
            setIsLoading(false);
            setInitialDataLoaded(true);
            return;
        }

        let parsedData: ScanInvoiceOutput;
        try {
            parsedData = JSON.parse(storedData);
        } catch (jsonParseError) {
             console.error("Failed to parse JSON data from localStorage:", jsonParseError, "Raw data:", storedData);
             if (key) localStorage.removeItem(key);
             if (originalPreviewKeyParam) localStorage.removeItem(originalPreviewKeyParam);
             if (compressedKeyParam) localStorage.removeItem(compressedKeyParam);
             setErrorLoading("Invalid JSON structure received from storage.");
              toast({
                  title: "Error Loading Data",
                  description: "Could not load the invoice data for editing. Invalid data format.",
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
          if (key) localStorage.removeItem(key);
          if (originalPreviewKeyParam) localStorage.removeItem(originalPreviewKeyParam);
          if (compressedKeyParam) localStorage.removeItem(compressedKeyParam);
           setErrorLoading("Invalid data structure received after parsing.");
           toast({
               title: "Error Loading Data",
               description: "Could not load the invoice data for editing. Invalid data structure.",
               variant: "destructive",
           });
          setProducts([]);
        }
    } else if (!initialDataLoaded) {
       hasAttemptedLoad = true;
       setErrorLoading("No invoice data key provided in the URL.");
       setProducts([]);
       toast({
          title: "No Data Found",
          description: "No invoice data key provided for editing.",
          variant: "destructive",
        });
    }

    setIsLoading(false);
    if (hasAttemptedLoad) {
        setInitialDataLoaded(true);
    }
  }, [searchParams, toast, initialDataLoaded]);


  const checkSupplier = async (scannedSupplierName?: string) => {
    if (!scannedSupplierName) {
      setIsSupplierConfirmed(true); // No supplier name from AI, proceed
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
      toast({ title: "Error fetching suppliers", variant: "destructive" });
      // In case of error, let user proceed or handle as appropriate
      setExtractedSupplierName(scannedSupplierName); // Use scanned name if fetch fails
      setIsSupplierConfirmed(true);
    }
  };

  const handleSupplierConfirmation = async (confirmedSupplierName: string | null, isNew: boolean = false) => {
    setShowSupplierDialog(false);
    if (confirmedSupplierName) {
      setExtractedSupplierName(confirmedSupplierName);
      if (isNew) {
        try {
          // Add to backend if it's a new supplier
          await updateSupplierContactInfoService(confirmedSupplierName, {}); 
          toast({ title: "New Supplier Added", description: `${confirmedSupplierName} has been added to your supplier list.` });
        } catch (error) {
          console.error("Failed to add new supplier:", error);
          toast({ title: "Failed to Add Supplier", variant: "destructive" });
        }
      }
    } else {
      // User cancelled or didn't confirm, use original scanned name or let it be undefined
      setExtractedSupplierName(aiScannedSupplierName);
    }
    setIsSupplierConfirmed(true);
  };


  const handleInputChange = (id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.id === id) {
          let numericValue: number | string | undefined = value; 
          if (['quantity', 'unitPrice', 'salePrice', 'lineTotal', 'minStockLevel', 'maxStockLevel'].includes(field)) {
              const stringValue = String(value);
              if (stringValue.trim() === '' && ['salePrice', 'minStockLevel', 'maxStockLevel'].includes(field)) {
                  numericValue = undefined;
              } else {
                numericValue = parseFloat(stringValue.replace(/,/g, ''));
                if (isNaN(numericValue as number)) {
                   numericValue = ['salePrice', 'minStockLevel', 'maxStockLevel'].includes(field) ? undefined : 0;
                }
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
        title: "Row Removed",
        description: "Product row has been removed.",
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
          
          console.log("Proceeding to finalize save products:", productsForService, "for file:", fileName, "tempInvoiceId:", tempInvoiceId, "with imageUri for final save:", imageUriForFinalSave ? 'Exists' : 'Does not exist');
          
          await finalizeSaveProductsService(
            productsForService, 
            fileName, 
            'upload', 
            tempInvoiceId || undefined, 
            imageUriForFinalSave,
            extractedInvoiceNumber,
            extractedSupplierName, // Pass the confirmed/final supplier name
            extractedTotalAmount
          );

          if (dataKey) localStorage.removeItem(dataKey);
          if (originalImagePreviewKey) localStorage.removeItem(originalImagePreviewKey);
          if (compressedImageKey) localStorage.removeItem(compressedImageKey);
          console.log("[EditInvoice] All temporary localStorage keys cleared after successful save.");


          toast({
              title: "Products Saved",
              description: "Your changes have been saved successfully.",
          });
          router.push('/inventory?refresh=true');

      } catch (error) {
          console.error("Failed to finalize save products:", error);
          toast({
              title: "Save Failed",
              description: `Could not save the product data after all checks. ${ (error as Error).message || 'Please try again.'}`,
              variant: "destructive",
          });
      } finally {
          setIsSaving(false);
      }
  };


 const handleSave = async () => {
    if (!isSupplierConfirmed) {
        setShowSupplierDialog(true); // Re-open if not confirmed (e.g., user closed it without choice)
        toast({ title: "Supplier Not Confirmed", description: "Please confirm the supplier before saving.", variant: "default" });
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
            title: "Error Preparing Save",
            description: `Could not prepare data for saving: ${(error as Error).message}. Please try again.`,
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
        });

        const newProductsNeedingDetails = productsReadyForDetailCheck.filter(p => {
            const isExistingProduct = p.id && inventoryMap.has(`id:${p.id}`);
            return !isExistingProduct || (p.id && p.id.includes('-new'));
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
            title: "Error Preparing New Product Details",
            description: "Could not check for new products needing details.",
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
            title: "Save Cancelled",
            description: "Price confirmation was cancelled. No changes were saved.",
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
             title: "Save Process Incomplete",
             description: "New product detail entry was cancelled. Changes were not fully saved.",
             variant: "default",
         });
          setIsSaving(false);
     }
 };


    const handleGoBack = () => {
        if (dataKey) localStorage.removeItem(dataKey);
        if (originalImagePreviewKey) localStorage.removeItem(originalImagePreviewKey);
        if (compressedImageKey) localStorage.removeItem(compressedImageKey);
        router.push('/upload');
    };

   if (isLoading && !initialDataLoaded) {
     return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <span className="ml-2">Loading data...</span>
        </div>
     );
   }

    if (errorLoading) {
        return (
            <div className="container mx-auto p-4 md:p-8 space-y-4">
                <Alert variant="destructive">
                    <AlertTitle>Error Loading Invoice Data</AlertTitle>
                    <AlertDescription>{errorLoading}</AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleGoBack}>
                   <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Upload
                </Button>
            </div>
        );
    }

    if (initialDataLoaded && products.length === 0 && !errorLoading && !scanProcessError) {
         return (
             <div className="container mx-auto p-4 md:p-8 space-y-4">
                 <Alert variant="default">
                     <AlertTitle>No Products Found</AlertTitle>
                     <AlertDescription>
                        The scan did not detect any products, or the data was invalid. You can try adding rows manually or go back and upload again.
                     </AlertDescription>
                 </Alert>
                 <Card className="shadow-md scale-fade-in">
                     <CardHeader>
                         <CardTitle className="text-xl sm:text-2xl font-semibold text-primary">Add Invoice Data Manually</CardTitle>
                         <CardDescription>
                            File: <span className="font-medium">{fileName || 'Unknown Document'}</span>
                         </CardDescription>
                     </CardHeader>
                      <CardContent>
                           <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                             <Button variant="outline" onClick={handleAddRow} className="w-full sm:w-auto">
                               <PlusCircle className="mr-2 h-4 w-4" /> Add Row
                             </Button>
                             <Button onClick={handleSave} disabled={isSaving || products.length === 0 || !isSupplierConfirmed} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
                              {isSaving ? (
                                 <>
                                   <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                                 </>
                              ) : (
                                 <>
                                   <Save className="mr-2 h-4 w-4" /> Save Changes
                                 </>
                               )}
                             </Button>
                         </div>
                           <div className="mt-6">
                               <Button variant="outline" onClick={handleGoBack}>
                                   <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Upload
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
                    <AlertTitle>Scan Process Error</AlertTitle>
                    <AlertDescription>
                        {`The document scan encountered an issue: ${scanProcessError}. You can try adding rows manually or go back and upload again.`}
                    </AlertDescription>
                </Alert>
                 <Card className="shadow-md scale-fade-in">
                     <CardHeader>
                         <CardTitle className="text-xl sm:text-2xl font-semibold text-primary">Add Invoice Data Manually</CardTitle>
                         <CardDescription>
                            File: <span className="font-medium">{fileName || 'Unknown Document'}</span>
                         </CardDescription>
                     </CardHeader>
                      <CardContent>
                           <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                             <Button variant="outline" onClick={handleAddRow} className="w-full sm:w-auto">
                               <PlusCircle className="mr-2 h-4 w-4" /> Add Row
                             </Button>
                             <Button onClick={handleSave} disabled={isSaving || products.length === 0 || !isSupplierConfirmed} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
                              {isSaving ? (
                                 <>
                                   <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                                 </>
                              ) : (
                                 <>
                                   <Save className="mr-2 h-4 w-4" /> Save Changes
                                 </>
                               )}
                             </Button>
                         </div>
                           <div className="mt-6">
                               <Button variant="outline" onClick={handleGoBack}>
                                   <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Upload
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
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary">Edit Invoice Data</CardTitle>
          <CardDescription>
             Review and edit the extracted data for: <span className="font-medium">{fileName || 'Unknown Document'}</span>
             {extractedSupplierName && ` | Supplier: ${extractedSupplierName}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto relative">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 sm:px-4 py-2">Catalog #</TableHead>
                  <TableHead className="px-2 sm:px-4 py-2">Description</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Qty</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Unit Price (₪)</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Sale Price (₪)</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Line Total (₪)</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Actions</TableHead>
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
                        aria-label={`Catalog number for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell className="px-2 sm:px-4 py-2">
                      <Input
                        value={product.description || ''}
                        onChange={(e) => handleInputChange(product.id, 'description', e.target.value)}
                        className="min-w-[150px] sm:min-w-[200px] h-9"
                        aria-label={`Description for catalog number ${product.catalogNumber}`}
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
                        aria-label={`Quantity for ${product.description}`}
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
                        aria-label={`Unit price for ${product.description}`}
                      />
                    </TableCell>
                     <TableCell className="text-right px-2 sm:px-4 py-2">
                        <Input
                            type="number"
                            value={formatInputValue(product.salePrice, 'currency')}
                            onChange={(e) => handleInputChange(product.id, 'salePrice', e.target.value)}
                            className="w-24 sm:w-28 text-right h-9"
                            step="0.01"
                            min="0"
                            placeholder="Optional"
                            aria-label={`Sale price for ${product.description}`}
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
                         aria-label={`Line total for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell className="text-right px-2 sm:px-4 py-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveRow(product.id)}
                        className="text-destructive hover:text-destructive/80 h-8 w-8"
                         aria-label={`Remove row for ${product.description}`}
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
               <PlusCircle className="mr-2 h-4 w-4" /> Add Row
             </Button>
             <Button onClick={handleSave} disabled={isSaving || products.length === 0 || !isSupplierConfirmed} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
              {isSaving ? (
                 <>
                   <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                 </>
              ) : (
                 <>
                   <Save className="mr-2 h-4 w-4" /> Save Changes
                 </>
               )}
             </Button>
          </div>
             <div className="mt-6">
                 <Button variant="outline" onClick={handleGoBack}>
                     <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Upload
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
            setIsSupplierConfirmed(true); // Assume user wants to proceed with original or no supplier
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
  return (
    <Suspense fallback={
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <span className="ml-2">Loading editor...</span>
        </div>
    }>
      <EditInvoiceContent />
    </Suspense>
  );
}
