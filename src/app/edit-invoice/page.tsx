
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
} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog';
import { cn } from '@/lib/utils';

interface EditableProduct extends Product {
  _originalId?: string;
  _isNewForPrompt?: boolean;
}

const formatInputValue = (value: number | undefined | null, fieldType: 'currency' | 'quantity' | 'stockLevel'): string => {
     if (value === null || value === undefined || isNaN(value)) {
        if (fieldType === 'stockLevel') return '';
        return fieldType === 'currency' ? '0.00' : '0';
    }
    if (fieldType === 'currency') {
      return parseFloat(String(value)).toFixed(2);
    }
    return parseInt(String(value), 10).toString();
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

  const [promptingForBarcodes, setPromptingForBarcodes] = useState<EditableProduct[] | null>(null);
  const [priceDiscrepancies, setPriceDiscrepancies] = useState<ProductPriceDiscrepancy[] | null>(null);
  const [productsToSaveDirectly, setProductsToSaveDirectly] = useState<Product[]>([]);


  useEffect(() => {
    const key = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    const tempInvIdParam = searchParams.get('tempInvoiceId');

    setDataKey(key);
    setTempInvoiceId(tempInvIdParam);

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
            minStockLevel: p.minStockLevel ?? undefined,
            maxStockLevel: p.maxStockLevel ?? undefined,
          }));
          setProducts(productsWithIds);
           setErrorLoading(null);

        } else if (!parsedData.error) {
          console.error("Parsed data is missing 'products' array or is invalid:", parsedData);
          if (key) localStorage.removeItem(key);
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


  const handleInputChange = (id: string, field: keyof Product, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.id === id) {
          let numericValue: number | string | undefined = value;
          if (field === 'quantity' || field === 'unitPrice' || field === 'lineTotal' || field === 'minStockLevel' || field === 'maxStockLevel') {
              const stringValue = String(value);
              if (stringValue.trim() === '' && (field === 'minStockLevel' || field === 'maxStockLevel')) {
                  numericValue = undefined;
              } else {
                numericValue = parseFloat(stringValue.replace(/,/g, ''));
                if (isNaN(numericValue as number)) {
                   numericValue = (field === 'minStockLevel' || field === 'maxStockLevel') ? undefined : 0;
                }
              }
          }


          const updatedProduct = { ...product, [field]: numericValue };

          const quantity = updatedProduct.quantity || 0;
          const unitPrice = updatedProduct.unitPrice || 0;
          const lineTotal = updatedProduct.lineTotal || 0;


          if (field === 'quantity' || field === 'unitPrice') {
               updatedProduct.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
          } else if (field === 'lineTotal') {
               if (quantity !== 0) {
                   updatedProduct.unitPrice = parseFloat((lineTotal / quantity).toFixed(2));
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
          console.log("Proceeding to finalize save products:", finalProductsToSave, "for file:", fileName, "tempInvoiceId:", tempInvoiceId);
          // The invoiceDataUri is now directly included in the tempInvoiceId record, so it's not passed here.
          await finalizeSaveProductsService(finalProductsToSave, fileName, 'upload', tempInvoiceId || undefined);

          if (dataKey) {
              localStorage.removeItem(dataKey);
              console.log(`Removed temp scan data with key: ${dataKey}`);
          }
          // Image URI in temp store is implicitly handled by finalizeSaveProductsService if it needs it.

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
    setIsSaving(true);
    try {
        const productsFromEdit = products.map(({ _originalId, _isNewForPrompt, ...rest }) => rest);
        const priceCheckResult = await checkProductPricesBeforeSaveService(productsFromEdit, tempInvoiceId || undefined);


        setProductsToSaveDirectly(priceCheckResult.productsToSaveDirectly);

        if (priceCheckResult.priceDiscrepancies.length > 0) {
            setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
            setIsSaving(false);
        } else {
            await checkForBarcodesAndSave(priceCheckResult.productsToSaveDirectly);
        }
    } catch (error) {
        console.error("Error during initial save checks (price/barcode):", error);
        toast({
            title: "Error Preparing Save",
            description: "Could not prepare data for saving. Please try again.",
            variant: "destructive",
        });
        setIsSaving(false);
    }
};

const checkForBarcodesAndSave = async (productsForBarcodeCheck: Product[]) => {
    try {
        const currentInventory = await getProductsService();
        const inventoryMap = new Map<string, Product>();
        currentInventory.forEach(p => {
            if (p.barcode) inventoryMap.set(`barcode:${p.barcode}`, p);
            if (p.id) inventoryMap.set(`id:${p.id}`, p);
            if (p.catalogNumber && p.catalogNumber !== 'N/A') inventoryMap.set(`catalog:${p.catalogNumber}`, p);
        });

        const newProductsWithoutBarcode = productsForBarcodeCheck.filter(p => {
            const existsByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);
            const isExistingProduct = p.id && inventoryMap.has(`id:${p.id}`);
            const existsByCatalog = p.catalogNumber && p.catalogNumber !== 'N/A' && inventoryMap.has(`catalog:${p.catalogNumber}`);
            return !isExistingProduct && !existsByBarcode && !existsByCatalog && !p.barcode;
        }).map(p => ({ ...p, _isNewForPrompt: true }));


        if (newProductsWithoutBarcode.length > 0) {
            setPromptingForBarcodes(newProductsWithoutBarcode);
            setProductsToSaveDirectly(productsForBarcodeCheck);
            setIsSaving(false);
        } else {
            await proceedWithFinalSave(productsForBarcodeCheck);
        }
    } catch (error) {
        console.error("Error checking inventory for barcode prompt:", error);
        toast({
            title: "Error Preparing Barcodes",
            description: "Could not check for new products needing barcodes.",
            variant: "destructive",
        });
        setIsSaving(false);
    }
};


const handlePriceConfirmationComplete = (resolvedProducts: Product[] | null) => {
    if (resolvedProducts) {
        const allProductsReadyForBarcodeCheck = [...productsToSaveDirectly.filter(p => !resolvedProducts.find(rp => rp.id === p.id)), ...resolvedProducts];
        checkForBarcodesAndSave(allProductsReadyForBarcodeCheck);
    } else {
        toast({
            title: "Save Cancelled",
            description: "Price confirmation was cancelled. No changes were saved.",
            variant: "default",
        });
    }
    setPriceDiscrepancies(null);
};


 const handleBarcodePromptComplete = (updatedProductsFromPrompt: Product[] | null) => {
     if (updatedProductsFromPrompt) {
         console.log("Barcode prompt completed. Updated products from prompt:", updatedProductsFromPrompt);
         const finalProductsWithBarcodes = productsToSaveDirectly.map(originalProduct => {
             const productFromBarcodePrompt = updatedProductsFromPrompt.find(up => up.id === originalProduct.id);
             if (productFromBarcodePrompt) {
                 return { ...originalProduct, barcode: productFromBarcodePrompt.barcode, _isNewForPrompt: false };
             }
             return { ...originalProduct, _isNewForPrompt: false };
         }).map(({ _originalId, _isNewForPrompt, ...rest }) => rest);


         setProducts(finalProductsWithBarcodes);
         proceedWithFinalSave(finalProductsWithBarcodes);
     } else {
         console.log("Barcode prompt cancelled.");
         toast({
             title: "Save Cancelled",
             description: "Barcode entry was cancelled. No changes were saved.",
             variant: "default",
         });
     }
     setPromptingForBarcodes(null);
 };


    const handleGoBack = () => {
        if (dataKey) {
            localStorage.removeItem(dataKey);
            console.log(`Cleared temp scan data with key ${dataKey} on explicit back navigation.`);
        }
        // The imageUriKey is removed when finalizeSaveProductsService is called or if initial load fails.
        // Here, we are just going back without saving, so related temp data should be cleared.
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
                             <Button onClick={handleSave} disabled={isSaving || products.length === 0} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
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
                             <Button onClick={handleSave} disabled={isSaving || products.length === 0} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
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
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Wrap table in div for overflow */}
          <div className="overflow-x-auto relative">
            <Table className="min-w-[600px]"> {/* Adjusted min-width */}
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 sm:px-4 py-2">Catalog #</TableHead>
                  <TableHead className="px-2 sm:px-4 py-2">Description</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Qty</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Unit Price (₪)</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Line Total (₪)</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Min Stock</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Max Stock</TableHead>
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
                        value={formatInputValue(product.lineTotal, 'currency')}
                        onChange={(e) => handleInputChange(product.id, 'lineTotal', e.target.value)}
                        className="w-24 sm:w-28 text-right h-9"
                        step="0.01"
                         min="0"
                         aria-label={`Line total for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell className="text-right px-2 sm:px-4 py-2">
                      <Input
                        type="number"
                        value={formatInputValue(product.minStockLevel, 'stockLevel')}
                        onChange={(e) => handleInputChange(product.id, 'minStockLevel', e.target.value)}
                        className="w-20 sm:w-24 text-right h-9"
                        min="0"
                        step="1"
                        placeholder="Optional"
                        aria-label={`Min stock for ${product.description}`}
                      />
                    </TableCell>
                     <TableCell className="text-right px-2 sm:px-4 py-2">
                      <Input
                        type="number"
                        value={formatInputValue(product.maxStockLevel, 'stockLevel')}
                        onChange={(e) => handleInputChange(product.id, 'maxStockLevel', e.target.value)}
                        className="w-20 sm:w-24 text-right h-9"
                        min="0"
                        step="1"
                        placeholder="Optional"
                        aria-label={`Max stock for ${product.description}`}
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
             <Button onClick={handleSave} disabled={isSaving || products.length === 0} className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
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

      {promptingForBarcodes && (
        <BarcodePromptDialog
          products={promptingForBarcodes}
          onComplete={handleBarcodePromptComplete}
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
