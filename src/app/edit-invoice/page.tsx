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
} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog';


interface EditableProduct extends Product {
  _originalId?: string; // To track original ID if it changes (e.g. for new items)
  // _isNewForPrompt?: boolean; // Not needed with the new dialog logic
}

// Helper to format numbers for input fields
const formatInputValue = (value: number | undefined | null, fieldType: 'currency' | 'quantity' | 'stockLevel'): string => {
     // For optional fields like salePrice, minStock, maxStock, allow empty string if value is undefined/null
     if ((fieldType === 'currency' || fieldType === 'stockLevel') && (value === undefined || value === null)) {
        return '';
    }
    if (value === null || value === undefined || isNaN(value)) {
        return fieldType === 'currency' ? '0.00' : '0';
    }
    if (fieldType === 'currency') {
      return parseFloat(String(value)).toFixed(2);
    }
    // For quantity, ensure it's an integer for display, but allow float for calculation if needed
    return String(value); // Allow floats for quantity input, parse on change
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

  const [promptingForNewProductDetails, setPromptingForNewProductDetails] = useState<Product[] | null>(null);
  const [priceDiscrepancies, setPriceDiscrepancies] = useState<ProductPriceDiscrepancy[] | null>(null);
  
  // This state will hold products that have passed price checks and are ready for barcode/sale price prompt OR final save.
  const [productsForNextStep, setProductsForNextStep] = useState<Product[]>([]);


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
            salePrice: p.salePrice ?? undefined,
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


  const handleInputChange = (id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.id === id) {
          let numericValue: number | string | undefined = value;
          // Handle numeric fields allowing undefined/null for optional ones like salePrice, minStockLevel, maxStockLevel
          if (['quantity', 'unitPrice', 'salePrice', 'lineTotal', 'minStockLevel', 'maxStockLevel'].includes(field)) {
              const stringValue = String(value);
              if (stringValue.trim() === '' && ['salePrice', 'minStockLevel', 'maxStockLevel'].includes(field)) {
                  numericValue = undefined; // Set to undefined for empty optional fields
              } else {
                numericValue = parseFloat(stringValue.replace(/,/g, ''));
                if (isNaN(numericValue as number)) {
                   numericValue = ['salePrice', 'minStockLevel', 'maxStockLevel'].includes(field) ? undefined : 0;
                }
              }
          }

          const updatedProduct = { ...product, [field]: numericValue };

          // Recalculate lineTotal or unitPrice if relevant fields change
          const quantity = Number(updatedProduct.quantity) || 0;
          const unitPrice = Number(updatedProduct.unitPrice) || 0;
          const lineTotal = Number(updatedProduct.lineTotal) || 0;

          if (field === 'quantity' || field === 'unitPrice') {
               updatedProduct.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
          } else if (field === 'lineTotal') {
               if (quantity !== 0) {
                   updatedProduct.unitPrice = parseFloat((lineTotal / quantity).toFixed(2));
               } else if (lineTotal !== 0) { // If quantity is 0 but line total is not, something is off, but avoid NaN for unitPrice
                    updatedProduct.unitPrice = 0; // Or handle as an error/warning
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
          console.log("Proceeding to finalize save products:", productsForService, "for file:", fileName, "tempInvoiceId:", tempInvoiceId);
          
          await finalizeSaveProductsService(productsForService, fileName, 'upload', tempInvoiceId || undefined);

          if (dataKey) {
              localStorage.removeItem(dataKey);
              console.log(`Removed temp scan data with key: ${dataKey}`);
          }
          // Also remove imageUriKey if it exists
          const imageUriKey = searchParams.get('imageUriKey');
          if (imageUriKey) {
            localStorage.removeItem(imageUriKey);
            console.log(`Removed temp image URI with key: ${imageUriKey}`);
          }


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
        const productsFromEdit = products.map(({ _originalId, ...rest }) => rest);
        console.log("Products passed to checkProductPricesBeforeSaveService:", productsFromEdit);
        const priceCheckResult = await checkProductPricesBeforeSaveService(productsFromEdit, tempInvoiceId || undefined);
        console.log("Price check result:", priceCheckResult);

        setProductsForNextStep(priceCheckResult.productsToSaveDirectly); // Store products that passed price check or are new

        if (priceCheckResult.priceDiscrepancies.length > 0) {
            setPriceDiscrepancies(priceCheckResult.priceDiscrepancies);
            setIsSaving(false); // Stop saving process to show confirmation dialog
        } else {
            // No price discrepancies, proceed to check for new product details
            await checkForNewProductsAndDetails(priceCheckResult.productsToSaveDirectly);
        }
    } catch (error) {
        console.error("Error during initial save checks (price/barcode/salePrice):", error);
        toast({
            title: "Error Preparing Save",
            description: `Could not prepare data for saving: ${(error as Error).message}. Please try again.`,
            variant: "destructive",
        });
        setIsSaving(false);
    }
};

// This function is called after price discrepancies are resolved (if any), or directly if none.
// It takes products that have passed price checks (or are new/unchanged) and checks for new items needing details.
const checkForNewProductsAndDetails = async (productsReadyForDetailCheck: Product[]) => {
    setIsSaving(true); // Resume saving state if it was paused
    try {
        const currentInventory = await getProductsService();
        const inventoryMap = new Map<string, Product>();
        currentInventory.forEach(p => {
            if (p.id) inventoryMap.set(`id:${p.id}`, p);
        });

        const newProductsNeedingDetails = productsReadyForDetailCheck.filter(p => {
            const isExistingProduct = p.id && inventoryMap.has(`id:${p.id}`);
            // Product is new if it's not existing OR if its id suggests it's a new row from the edit page
            return !isExistingProduct || (p.id && p.id.includes('-new'));
        });

        if (newProductsNeedingDetails.length > 0) {
            console.log("New products needing details:", newProductsNeedingDetails);
            setProductsForNextStep(productsReadyForDetailCheck); // Keep all products ready for the next step
            setPromptingForNewProductDetails(newProductsNeedingDetails);
            setIsSaving(false); // Pause saving to show the new product details dialog
        } else {
            // No new products needing details, proceed to final save
            console.log("No new products, proceeding to final save with:", productsReadyForDetailCheck);
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
    setPriceDiscrepancies(null); // Close price confirmation dialog
    if (resolvedProducts) {
        // Products that were in discrepancy now have their unitPrice resolved.
        // Merge them back with products that had no discrepancy.
        const allProductsAfterPriceCheck = productsForNextStep.map(originalProduct => {
            const resolvedVersion = resolvedProducts.find(rp => rp.id === originalProduct.id);
            return resolvedVersion ? { ...originalProduct, unitPrice: resolvedVersion.unitPrice } : originalProduct;
        });
        
        console.log("Products after price confirmation, ready for detail check:", allProductsAfterPriceCheck);
        checkForNewProductsAndDetails(allProductsAfterPriceCheck);
    } else {
        // User cancelled price confirmation
        toast({
            title: "Save Cancelled",
            description: "Price confirmation was cancelled. No changes were saved.",
            variant: "default",
        });
        setIsSaving(false); // Ensure saving is stopped
    }
};


 const handleNewProductDetailsComplete = (updatedNewProducts: Product[] | null) => {
     setPromptingForNewProductDetails(null); // Close the new product details dialog
     if (updatedNewProducts) {
         // updatedNewProducts contains ONLY the new products, now with barcode/salePrice.
         // We need to merge these updates back into the full list of products that were ready for this step.
         const finalProductsToSave = productsForNextStep.map(originalProduct => {
             const updatedVersion = updatedNewProducts.find(unp => unp.id === originalProduct.id);
             if (updatedVersion) { // If this was one of the new products
                 return {
                     ...originalProduct, // Keep original quantity, unitPrice (which was already checked/resolved)
                     barcode: updatedVersion.barcode,
                     salePrice: updatedVersion.salePrice,
                 };
             }
             return originalProduct; // This was an existing product, not needing new details
         });

         console.log("Final products to save after new product details prompt:", finalProductsToSave);
         proceedWithFinalSave(finalProductsToSave);
     } else {
         // User cancelled the new product details prompt
         console.log("New product detail entry was cancelled.");
         toast({
             title: "Save Process Incomplete",
             description: "New product detail entry was cancelled. Changes were not fully saved.",
             variant: "default",
         });
          setIsSaving(false); // Ensure saving is stopped
     }
 };


    const handleGoBack = () => {
        if (dataKey) {
            localStorage.removeItem(dataKey);
            console.log(`Cleared temp scan data with key ${dataKey} on explicit back navigation.`);
        }
        const imageUriKey = searchParams.get('imageUriKey');
        if (imageUriKey) {
          localStorage.removeItem(imageUriKey);
          console.log(`Cleared temp image URI with key: ${imageUriKey}`);
        }
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
                  <TableHead className="text-right px-2 sm:px-4 py-2">Sale Price (₪)</TableHead>
                  {/* <TableHead className="text-right px-2 sm:px-4 py-2">Min Stock</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Max Stock</TableHead> */}
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
                        step="any" // Allow decimals for quantity if needed, or "1" for integers
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
                    {/* <TableCell className="text-right px-2 sm:px-4 py-2">
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
                    </TableCell> */}
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

      {promptingForNewProductDetails && (
        <BarcodePromptDialog
          products={promptingForNewProductDetails}
          onComplete={handleNewProductDetailsComplete}
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