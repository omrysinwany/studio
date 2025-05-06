
'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, PlusCircle, Save, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { saveProducts, Product } from '@/services/backend'; // Import Product type and save function
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'; // Import Alert


// Define the structure for edited product data, making fields potentially editable
interface EditableProduct extends Product {
  id: string; // Add a unique ID for React key prop and editing logic
}

// Define prefix for temporary data keys in localStorage
const TEMP_DATA_KEY_PREFIX = 'invoTrackTempData_';

// Helper function to safely format numbers
// - decimals: Number of decimal places (default 2)
// - useGrouping: Whether to use thousand separators (default false for inputs, true for display)
const formatNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = false } = options || {}; // Default: 2 decimals, no grouping for inputs

    if (value === null || value === undefined || isNaN(value)) {
        // Return a formatted zero based on options
        return (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping, // Use grouping based on option
        });
    }

    return value.toLocaleString(undefined, { // Use browser's locale for formatting
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping, // Use grouping based on option
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


  useEffect(() => {
    const dataKey = searchParams.get('key'); // Get the key from URL params
    const nameParam = searchParams.get('fileName');
    let hasAttemptedLoad = false; // Track if we tried to load data

    if (nameParam) {
      setFileName(decodeURIComponent(nameParam));
    } else {
        setFileName('Unknown Document'); // Default filename if not provided
    }

    if (dataKey) {
        hasAttemptedLoad = true;
        let storedData = null;
        try {
            // Attempt to retrieve data from localStorage
            storedData = localStorage.getItem(dataKey);
            if (!storedData) {
                 throw new Error("Scan results not found. They might have expired or been cleared.");
            }

            // Attempt to parse the JSON data
            let parsedData;
            try {
                parsedData = JSON.parse(storedData);
            } catch (jsonParseError) {
                 console.error("Failed to parse JSON data from localStorage:", jsonParseError, "Raw data:", storedData);
                 // If parsing fails, remove the invalid item
                 localStorage.removeItem(dataKey);
                 throw new Error("Invalid JSON structure received from storage.");
            }

            // Validate the structure AFTER parsing
            if (parsedData && Array.isArray(parsedData.products)) {
              // Add a unique ID to each product for stable editing
              const productsWithIds = parsedData.products.map((p: Product, index: number) => ({
                ...p,
                id: `${Date.now()}-${index}`, // Simple unique ID generation
                // Ensure numeric fields are numbers, default to 0 if not
                quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : parseFloat(String(p.lineTotal)) || 0,
                 // Calculate unitPrice here if not provided or needs recalculation
                 unitPrice: (typeof p.quantity === 'number' && p.quantity !== 0 && typeof p.lineTotal === 'number')
                            ? parseFloat((p.lineTotal / p.quantity).toFixed(2))
                            : (typeof p.unitPrice === 'number' ? p.unitPrice : parseFloat(String(p.unitPrice)) || 0), // Fallback
              }));
              setProducts(productsWithIds);
               setErrorLoading(null); // Clear any previous error

                // DO NOT remove the localStorage item here. Keep it until saved or explicitly discarded.
                // localStorage.removeItem(dataKey); // REMOVED FROM HERE

            } else {
              console.error("Parsed data is missing 'products' array or is invalid:", parsedData);
              // Remove invalid item
              localStorage.removeItem(dataKey);
              throw new Error("Invalid data structure received after parsing.");
            }
        } catch (error: any) {
            console.error("Failed to process product data:", error);
            setErrorLoading(`Could not load the invoice data for editing. Error: ${error.message || 'Unknown error'}`);
            setProducts([]); // Clear products on error
            toast({
              title: "Error Loading Data",
              description: `Could not load the invoice data for editing. ${error.message ? `Details: ${error.message}` : ''}`,
              variant: "destructive",
            });
             // Don't remove if the error was 'not found', otherwise remove potentially invalid data key
             if (error.message && !error.message.startsWith("Scan results not found")) {
                 if (dataKey) localStorage.removeItem(dataKey);
             }
        }
    } else if (!initialDataLoaded) {
       // Only show error/redirect if it's the initial load attempt and NO key param found
       hasAttemptedLoad = true;
       setErrorLoading("No invoice data key provided in the URL.");
       setProducts([]);
       toast({
          title: "No Data Found",
          description: "No invoice data key provided for editing.",
          variant: "destructive",
        });
    }

    setIsLoading(false); // Loading finished (even if it failed)
    if (hasAttemptedLoad) {
        setInitialDataLoaded(true); // Mark initial data load attempt complete only if we tried
    }

     // General cleanup function: remove any leftover temp data on unmount or navigation (optional)
     return () => {
         // Can add specific cleanup logic here if user navigates away *before* saving
         // For now, we rely on saving to clear the specific item.
         // A more robust solution might involve clearing *all* old temp keys on app start.
     };

  // Add initialDataLoaded to dependencies to prevent re-running on subsequent renders unless specifically needed
  }, [searchParams, router, toast, initialDataLoaded]);


  const handleInputChange = (id: string, field: keyof Product, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.id === id) {
          // Convert input value to number for calculations, handle potential NaN
          let numericValue = (typeof value === 'string') ? parseFloat(value.replace(/,/g, '')) : value; // Remove commas before parsing
          if (isNaN(numericValue)) {
              numericValue = 0; // Default to 0 if parsing fails
          }

          const updatedProduct = { ...product, [field]: numericValue };

          // Ensure values used for calculation are numbers
          const quantity = updatedProduct.quantity; // Already a number
          const unitPrice = updatedProduct.unitPrice; // Already a number
          const lineTotal = updatedProduct.lineTotal; // Already a number

          // Auto-calculate lineTotal OR unitPrice based on which was changed
          if (field === 'quantity' || field === 'unitPrice') {
              // If quantity or unitPrice changes, recalculate lineTotal
               updatedProduct.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));

          } else if (field === 'lineTotal') {
              // If lineTotal changes, recalculate unitPrice (only if quantity is not zero)
               if (quantity !== 0) {
                   updatedProduct.unitPrice = parseFloat((lineTotal / quantity).toFixed(2));
               } else {
                    updatedProduct.unitPrice = 0; // Avoid division by zero, set unitPrice to 0
               }
          }

          // Ensure the field being edited is stored as a number in the state
          // This happens implicitly because we set `numericValue` above
          // updatedProduct[field] = numericValue; // No need to set again

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

  const handleSave = async () => {
     setIsSaving(true);
     const dataKey = searchParams.get('key'); // Get the key again
     try {
       // Remove the temporary 'id' field and ensure numbers are numeric before sending
       const productsToSave: Product[] = products
         .map(({ id, ...rest }) => {
             // Data in state should already be numeric due to handleInputChange logic
             const quantity = rest.quantity;
             const lineTotal = rest.lineTotal;
             // Recalculate unit price before saving for consistency
             const unitPrice = quantity !== 0 ? parseFloat((lineTotal / quantity).toFixed(2)) : rest.unitPrice; // Keep original if quantity is 0

             return {
                 ...rest,
                 quantity: quantity,
                 unitPrice: unitPrice, // Send recalculated or original unit price
                 lineTotal: lineTotal,
             };
         })
         // Optional: Filter out rows that are essentially empty
         .filter(p => p.catalogNumber || p.description);

       console.log("Attempting to save products:", productsToSave, "for file:", fileName); // Log data being sent
       await saveProducts(productsToSave, fileName); // Use the backend service function, passing fileName

        // Remove the temp data from localStorage ONLY AFTER successful save
        if (dataKey) {
            localStorage.removeItem(dataKey);
            console.log(`Removed temp data with key: ${dataKey}`);
        }

       toast({
         title: "Products Saved",
         description: "Your changes have been saved successfully.",
       });
        router.push('/inventory?refresh=true'); // Navigate to inventory and add refresh param

     } catch (error) {
       console.error("Failed to save products:", error);
       toast({
         title: "Save Failed",
         description: "Could not save the product data. Please try again.",
         variant: "destructive",
       });
        // DO NOT remove the temp data if save failed, allow user to retry
     } finally {
       setIsSaving(false);
     }
   };

    const handleGoBack = () => {
        // Optionally clear the temp data if the user explicitly navigates back *without* saving
        const dataKey = searchParams.get('key');
        if (dataKey) {
            localStorage.removeItem(dataKey);
            console.log(`Cleared temp data with key ${dataKey} on explicit back navigation.`);
        }
        router.push('/upload');
    };

   // Show loading state while initial check is happening
   if (isLoading && !initialDataLoaded) {
     return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <span className="ml-2">Loading data...</span>
        </div>
     );
   }

    // Show error message if loading failed
    if (errorLoading) {
        return (
            <div className="container mx-auto p-4 md:p-8 space-y-4">
                <Alert variant="destructive">
                    <AlertTitle>Error Loading Invoice Data</AlertTitle>
                    <AlertDescription>{errorLoading}</AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleGoBack}>
                   Go Back to Upload
                </Button>
            </div>
        );
    }

    // Show if data loaded but products array is empty
    if (initialDataLoaded && products.length === 0 && !errorLoading) {
         return (
             <div className="container mx-auto p-4 md:p-8 space-y-4">
                 <Alert variant="default">
                     <AlertTitle>No Products Found</AlertTitle>
                     <AlertDescription>
                         The scan did not detect any products, or the data was invalid. You can try adding rows manually or go back and upload again.
                     </AlertDescription>
                 </Alert>
                 {/* Allow adding rows even if none were detected */}
                 <Card className="shadow-md">
                     <CardHeader>
                         <CardTitle className="text-2xl font-semibold text-primary">Add Invoice Data Manually</CardTitle>
                         <CardDescription>
                            File: <span className="font-medium">{fileName || 'Unknown Document'}</span>
                         </CardDescription>
                     </CardHeader>
                      <CardContent>
                           <div className="mt-4 flex justify-between items-center">
                             <Button variant="outline" onClick={handleAddRow}>
                               <PlusCircle className="mr-2 h-4 w-4" /> Add Row
                             </Button>
                             <Button onClick={handleSave} disabled={isSaving || products.length === 0} className="bg-primary hover:bg-primary/90">
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
                                   Go Back to Upload
                               </Button>
                           </div>
                      </CardContent>
                 </Card>
             </div>
         );
    }


  // Render the table only if initial load is done, there's no error, and products exist
  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary">Edit Invoice Data</CardTitle>
          <CardDescription>
             Review and edit the extracted data for: <span className="font-medium">{fileName || 'Unknown Document'}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Catalog #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Unit Price (₪)</TableHead>
                  <TableHead className="text-right">Line Total (₪)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Input
                        value={product.catalogNumber}
                        onChange={(e) => handleInputChange(product.id, 'catalogNumber', e.target.value)}
                        className="min-w-[100px]"
                        aria-label={`Catalog number for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={product.description}
                        onChange={(e) => handleInputChange(product.id, 'description', e.target.value)}
                        className="min-w-[200px]"
                        aria-label={`Description for catalog number ${product.catalogNumber}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={formatInputValue(product.quantity)} // Format for input display (no commas)
                        onChange={(e) => handleInputChange(product.id, 'quantity', e.target.value)}
                        className="w-24 text-right" // Increased width
                        min="0"
                        step="0.01" // Allow decimals
                        aria-label={`Quantity for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={formatInputValue(product.unitPrice)} // Format for input display (no commas)
                        onChange={(e) => handleInputChange(product.id, 'unitPrice', e.target.value)}
                        className="w-28 text-right" // Increased width
                        step="0.01"
                        min="0"
                        aria-label={`Unit price for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={formatInputValue(product.lineTotal)} // Format for input display (no commas)
                        onChange={(e) => handleInputChange(product.id, 'lineTotal', e.target.value)}
                        className="w-28 text-right" // Increased width
                        step="0.01"
                         min="0"
                         aria-label={`Line total for ${product.description}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveRow(product.id)}
                        className="text-destructive hover:text-destructive/80"
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
          <div className="mt-4 flex justify-between items-center">
             <Button variant="outline" onClick={handleAddRow}>
               <PlusCircle className="mr-2 h-4 w-4" /> Add Row
             </Button>
             <Button onClick={handleSave} disabled={isSaving || products.length === 0} className="bg-primary hover:bg-primary/90">
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
                     Go Back to Upload
                 </Button>
             </div>
        </CardContent>
      </Card>
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
