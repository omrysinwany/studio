'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, PlusCircle, Save, Loader2, ArrowLeft } from 'lucide-react'; // Removed Barcode icon
import { useToast } from '@/hooks/use-toast';
import { saveProducts, Product, getProductsService } from '@/services/backend'; // Import Product type, save function, and getProductsService
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'; // Import Alert
import BarcodePromptDialog from '@/components/barcode-prompt-dialog'; // Import the new dialog component

// Define the structure for edited product data, making fields potentially editable
interface EditableProduct extends Product {
  _originalId?: string; // Track original ID if fetched from storage
  _isNewForPrompt?: boolean; // Flag for barcode prompting
}

// Define prefix for temporary data keys in localStorage
const TEMP_DATA_KEY_PREFIX = 'invoTrackTempData_';

// Helper function to safely format numbers
const formatNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = false } = options || {}; // Default: 2 decimals, no grouping for inputs

    if (value === null || value === undefined || isNaN(value)) {
        return (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
        });
    }

    return value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping,
    });
};

// Function specifically for Input value prop - avoids commas but keeps decimals
const formatInputValue = (value: number | undefined | null): string => {
     if (value === null || value === undefined || isNaN(value)) {
        return '0.00';
    }
    return value.toFixed(2); // Use toFixed(2) for input value to ensure 2 decimals without commas
}


function EditInvoiceContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true); // Start true
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [errorLoading, setErrorLoading] = useState<string | null>(null); // State for loading errors
  const [dataKey, setDataKey] = useState<string | null>(null); // Store data key in state

  // State for barcode prompt
  const [promptingForBarcodes, setPromptingForBarcodes] = useState<EditableProduct[] | null>(null);


  useEffect(() => {
    const key = searchParams.get('key');
    const nameParam = searchParams.get('fileName');
    setDataKey(key); // Store key in state

    let hasAttemptedLoad = false; // Track if we tried to load data

    if (nameParam) {
      setFileName(decodeURIComponent(nameParam));
    } else {
        setFileName('Unknown Document'); // Default filename if not provided
    }

    if (key) {
        hasAttemptedLoad = true;
        let storedData = null;
        try {
            storedData = localStorage.getItem(key);
            if (!storedData) {
                 throw new Error("Scan results not found. They might have expired or been cleared.");
            }

            let parsedData;
            try {
                parsedData = JSON.parse(storedData);
            } catch (jsonParseError) {
                 console.error("Failed to parse JSON data from localStorage:", jsonParseError, "Raw data:", storedData);
                 localStorage.removeItem(key); // Clear invalid data
                 throw new Error("Invalid JSON structure received from storage.");
            }

            if (parsedData && Array.isArray(parsedData.products)) {
              const productsWithIds = parsedData.products.map((p: Product, index: number) => ({
                ...p,
                id: p.id || `${Date.now()}-${index}`, // Ensure ID exists, use original if present
                _originalId: p.id, // Store original ID for comparison later
                quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
                 unitPrice: (typeof p.quantity === 'number' && p.quantity !== 0 && typeof p.lineTotal === 'number')
                            ? parseFloat((p.lineTotal / p.quantity).toFixed(2))
                            : (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice)) || 0),
              }));
              setProducts(productsWithIds);
               setErrorLoading(null);

            } else {
              console.error("Parsed data is missing 'products' array or is invalid:", parsedData);
              localStorage.removeItem(key); // Clear invalid data
              throw new Error("Invalid data structure received after parsing.");
            }
        } catch (error: any) {
            console.error("Failed to process product data:", error);
            setErrorLoading(`Could not load the invoice data for editing. Error: ${error.message || 'Unknown error'}`);
            setProducts([]);
            toast({
              title: "Error Loading Data",
              description: `Could not load the invoice data for editing. ${error.message ? `Details: ${error.message}` : ''}`,
              variant: "destructive",
            });
             if (key) localStorage.removeItem(key); // Clear data on any processing error except 'not found'
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

     return () => {
         // Optional: Cleanup logic if needed
         // If navigating away *without saving*, clear the temp data
         // Note: This might clear data if user refreshes, consider if this is desired.
         // if (dataKey && !isSaving) { // Avoid clearing if save is in progress
         //     localStorage.removeItem(dataKey);
         // }
     };

  }, [searchParams, router, toast, initialDataLoaded]); // Removed isSaving from dependencies


  const handleInputChange = (id: string, field: keyof Product, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.id === id) {
          let numericValue: number | string = value; // Keep as string for non-numeric fields initially
          if (field === 'quantity' || field === 'unitPrice' || field === 'lineTotal') {
              const stringValue = String(value);
              numericValue = parseFloat(stringValue.replace(/,/g, '')); // Remove commas before parsing
              if (isNaN(numericValue)) {
                 numericValue = 0;
              }
          }


          const updatedProduct = { ...product, [field]: numericValue };

          const quantity = updatedProduct.quantity || 0; // Ensure quantity is a number for calculation
          const unitPrice = updatedProduct.unitPrice || 0; // Ensure unitPrice is a number for calculation
          const lineTotal = updatedProduct.lineTotal || 0; // Ensure lineTotal is a number for calculation


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
      barcode: undefined, // Start with undefined barcode
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


  // Function to proceed with the actual saving after barcode prompt (if needed)
  const proceedWithSave = async (finalProductsToSave: Product[]) => {
      setIsSaving(true); // Set saving state here
      try {
          console.log("Proceeding to save final products:", finalProductsToSave, "for file:", fileName);
          await saveProducts(finalProductsToSave, fileName, 'upload');

          if (dataKey) {
              localStorage.removeItem(dataKey);
              console.log(`Removed temp data with key: ${dataKey}`);
          }

          toast({
              title: "Products Saved",
              description: "Your changes have been saved successfully.",
          });
          router.push('/inventory?refresh=true');

      } catch (error) {
          console.error("Failed to save products:", error);
          toast({
              title: "Save Failed",
              description: "Could not save the product data. Please try again.",
              variant: "destructive",
          });
      } finally {
          setIsSaving(false); // Clear saving state here
      }
  };


  // Main save handler - checks for new products first
  const handleSave = async () => {
     setIsSaving(true); // Indicate checking process starts

     try {
         const currentInventory = await getProductsService();
         const inventoryMap = new Map<string, Product>();
         currentInventory.forEach(p => {
             if (p.barcode) inventoryMap.set(`barcode:${p.barcode}`, p);
             if (p.id) inventoryMap.set(`id:${p.id}`, p);
             if (p.catalogNumber && p.catalogNumber !== 'N/A') inventoryMap.set(`catalog:${p.catalogNumber}`, p);
         });

         const productsFromEdit = products.map(({ _originalId, _isNewForPrompt, ...rest }) => rest); // Clean up internal flags

         const newProductsWithoutBarcode = productsFromEdit.filter(p => {
             // Check if exists in inventory by barcode, id, or catalog number
             const existsByBarcode = p.barcode && inventoryMap.has(`barcode:${p.barcode}`);
             const existsById = p.id && inventoryMap.has(`id:${p.id}`);
             const existsByCatalog = p.catalogNumber && p.catalogNumber !== 'N/A' && inventoryMap.has(`catalog:${p.catalogNumber}`);

             // It's "new" if it doesn't exist by any identifier AND doesn't have a barcode entered during edit
             return !existsByBarcode && !existsById && !existsByCatalog && !p.barcode;
         }).map(p => ({ ...p, _isNewForPrompt: true })); // Mark for prompting


         if (newProductsWithoutBarcode.length > 0) {
             console.log("New products without barcode found:", newProductsWithoutBarcode);
             setPromptingForBarcodes(newProductsWithoutBarcode); // Trigger the dialog
             setIsSaving(false); // Stop "saving" state, wait for prompt result
         } else {
             // No new products needing barcodes, proceed directly to save
             console.log("No new products require barcode prompt. Proceeding to save.");
             await proceedWithSave(productsFromEdit); // Pass the cleaned products
         }

     } catch (error) {
         console.error("Error checking inventory before save:", error);
         toast({
             title: "Error Preparing Save",
             description: "Could not check inventory to identify new products. Please try again.",
             variant: "destructive",
         });
         setIsSaving(false); // Reset saving state on error
     }
 };

 // Callback for when the barcode prompt dialog is closed/completed
 const handleBarcodePromptComplete = (updatedProducts: Product[] | null) => {
     if (updatedProducts) {
         // User provided barcodes (or skipped some), merge updates and proceed to save
         console.log("Barcode prompt completed. Updated products:", updatedProducts);
         // Merge the updates from the dialog back into the main products state
         const finalProducts = products.map(p => {
             const updatedVersion = updatedProducts.find(up => up.id === p.id);
             // If an updated version exists (meaning it was in the dialog), use its barcode
             // Otherwise, keep the original product (it might have had a barcode already or wasn't new)
             return updatedVersion ? { ...p, barcode: updatedVersion.barcode, _isNewForPrompt: false } : p;
         });

          setProducts(finalProducts); // Update state locally

         // Prepare for final save (remove internal flags)
         const productsToSave = finalProducts.map(({ _originalId, _isNewForPrompt, ...rest }) => rest);
         proceedWithSave(productsToSave);
     } else {
         // User cancelled the prompt
         console.log("Barcode prompt cancelled.");
         toast({
             title: "Save Cancelled",
             description: "Barcode entry was cancelled. No changes were saved.",
             variant: "default",
         });
     }
     setPromptingForBarcodes(null); // Close the dialog state
 };


    const handleGoBack = () => {
        if (dataKey) {
            localStorage.removeItem(dataKey);
            console.log(`Cleared temp data with key ${dataKey} on explicit back navigation.`);
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

    if (initialDataLoaded && products.length === 0 && !errorLoading) {
         return (
             <div className="container mx-auto p-4 md:p-8 space-y-4">
                 <Alert variant="default">
                     <AlertTitle>No Products Found</AlertTitle>
                     <AlertDescription>
                         The scan did not detect any products, or the data was invalid. You can try adding rows manually or go back and upload again.
                     </AlertDescription>
                 </Alert>
                 <Card className="shadow-md">
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
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary">Edit Invoice Data</CardTitle>
          <CardDescription>
             Review and edit the extracted data for: <span className="font-medium">{fileName || 'Unknown Document'}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto"> {/* Make table scrollable */}
            <Table className="min-w-[600px]"> {/* Adjusted min-width */}
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 sm:px-4 py-2">Catalog #</TableHead>
                  <TableHead className="px-2 sm:px-4 py-2">Description</TableHead>
                  {/* Removed Barcode column header */}
                  <TableHead className="text-right px-2 sm:px-4 py-2">Qty</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Unit Price (₪)</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Line Total (₪)</TableHead>
                  <TableHead className="text-right px-2 sm:px-4 py-2">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="px-2 sm:px-4 py-2">
                      <Input
                        value={product.catalogNumber || ''} // Handle potential null/undefined
                        onChange={(e) => handleInputChange(product.id, 'catalogNumber', e.target.value)}
                        className="min-w-[100px] h-9" // Adjust height
                        aria-label={`Catalog number for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell className="px-2 sm:px-4 py-2">
                      <Input
                        value={product.description || ''}
                        onChange={(e) => handleInputChange(product.id, 'description', e.target.value)}
                        className="min-w-[150px] sm:min-w-[200px] h-9" // Adjust height
                        aria-label={`Description for catalog number ${product.catalogNumber}`}
                      />
                    </TableCell>
                    {/* Removed Barcode input cell */}
                    <TableCell className="text-right px-2 sm:px-4 py-2">
                      <Input
                        type="number"
                        value={formatInputValue(product.quantity)}
                        onChange={(e) => handleInputChange(product.id, 'quantity', e.target.value)}
                        className="w-20 sm:w-24 text-right h-9" // Adjust height and width
                        min="0"
                        step="any" // Allow decimals for quantity if needed, or "1" for integers
                        aria-label={`Quantity for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell className="text-right px-2 sm:px-4 py-2">
                      <Input
                        type="number"
                        value={formatInputValue(product.unitPrice)}
                        onChange={(e) => handleInputChange(product.id, 'unitPrice', e.target.value)}
                        className="w-24 sm:w-28 text-right h-9" // Adjust height and width
                        step="0.01"
                        min="0"
                        aria-label={`Unit price for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell className="text-right px-2 sm:px-4 py-2">
                      <Input
                        type="number"
                        value={formatInputValue(product.lineTotal)}
                        onChange={(e) => handleInputChange(product.id, 'lineTotal', e.target.value)}
                        className="w-24 sm:w-28 text-right h-9" // Adjust height and width
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
                        className="text-destructive hover:text-destructive/80 h-8 w-8" // Adjust size
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
          <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3"> {/* Stack buttons on mobile */}
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

      {/* Barcode Prompt Dialog */}
      {promptingForBarcodes && (
        <BarcodePromptDialog
          products={promptingForBarcodes}
          onComplete={handleBarcodePromptComplete}
        />
      )}
    </div>
  );
}


// Wrap the component with Suspense for useSearchParams
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
