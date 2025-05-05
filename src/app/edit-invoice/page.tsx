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


// Define the structure for edited product data, making fields potentially editable
interface EditableProduct extends Product {
  id: string; // Add a unique ID for React key prop and editing logic
}

function EditInvoiceContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);


  useEffect(() => {
    setIsLoading(true);
    const dataParam = searchParams.get('data');
    const nameParam = searchParams.get('fileName');

    if (nameParam) {
      setFileName(decodeURIComponent(nameParam));
    } else {
        setFileName('Unknown Document'); // Default filename if not provided
    }

    if (dataParam) {
      try {
        const parsedData = JSON.parse(decodeURIComponent(dataParam));
        if (parsedData && Array.isArray(parsedData.products)) {
          // Add a unique ID to each product for stable editing
          const productsWithIds = parsedData.products.map((p: Product, index: number) => ({
            ...p,
            id: `${Date.now()}-${index}`, // Simple unique ID generation
            // Ensure numeric fields are numbers, default to 0 if not
            quantity: typeof p.quantity === 'number' ? p.quantity : 0,
            lineTotal: typeof p.lineTotal === 'number' ? p.lineTotal : 0,
             // Calculate unitPrice here if not provided or needs recalculation
             unitPrice: (typeof p.quantity === 'number' && p.quantity !== 0 && typeof p.lineTotal === 'number')
                        ? parseFloat((p.lineTotal / p.quantity).toFixed(2))
                        : (typeof p.unitPrice === 'number' ? p.unitPrice : 0), // Fallback to provided unitPrice or 0
          }));
          setProducts(productsWithIds);
        } else {
          throw new Error("Invalid data structure received.");
        }
      } catch (error) {
        console.error("Failed to parse product data:", error);
        toast({
          title: "Error Loading Data",
          description: "Could not load the invoice data for editing.",
          variant: "destructive",
        });
        router.push('/upload'); // Redirect back if data is invalid
      }
    } else if (!initialDataLoaded) {
       // Only show error/redirect if it's the initial load and no data found
       toast({
          title: "No Data Found",
          description: "No invoice data provided for editing.",
          variant: "destructive",
        });
       router.push('/upload');
    }
    setIsLoading(false);
    setInitialDataLoaded(true); // Mark initial data load attempt complete

  }, [searchParams, router, toast, initialDataLoaded]);


  const handleInputChange = (id: string, field: keyof Product, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.id === id) {
          const updatedProduct = { ...product, [field]: value };

          // Auto-calculate lineTotal OR unitPrice based on which was changed
          const quantity = typeof updatedProduct.quantity === 'number' ? updatedProduct.quantity : 0;
          const unitPrice = typeof updatedProduct.unitPrice === 'number' ? updatedProduct.unitPrice : 0;
          const lineTotal = typeof updatedProduct.lineTotal === 'number' ? updatedProduct.lineTotal : 0;

          if (field === 'quantity' || field === 'unitPrice') {
              if (quantity !== 0 && unitPrice !== 0) {
                 updatedProduct.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
              }
          } else if (field === 'lineTotal') {
              if (quantity !== 0 && lineTotal !== 0) {
                  updatedProduct.unitPrice = parseFloat((lineTotal / quantity).toFixed(2));
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
     try {
       // Remove the temporary 'id' field and ensure numbers are numeric before sending
       const productsToSave: Product[] = products
         .map(({ id, ...rest }) => {
             const quantity = parseFloat(String(rest.quantity)) || 0;
             const lineTotal = parseFloat(String(rest.lineTotal)) || 0;
             // Recalculate unit price before saving for consistency
             const unitPrice = quantity !== 0 ? parseFloat((lineTotal / quantity).toFixed(2)) : 0;

             return {
                 ...rest,
                 quantity: quantity,
                 unitPrice: unitPrice, // Send recalculated unit price
                 lineTotal: lineTotal,
             };
         })
         // Optional: Filter out rows that are essentially empty
         .filter(p => p.catalogNumber || p.description);

       console.log("Attempting to save products:", productsToSave, "for file:", fileName); // Log data being sent
       await saveProducts(productsToSave, fileName); // Use the backend service function, passing fileName

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
     } finally {
       setIsSaving(false);
     }
   };

   if (isLoading || !initialDataLoaded) {
     return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
     );
   }


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
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={product.description}
                        onChange={(e) => handleInputChange(product.id, 'description', e.target.value)}
                        className="min-w-[200px]"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={product.quantity}
                        onChange={(e) => handleInputChange(product.id, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-20 text-right"
                         min="0"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={product.unitPrice}
                        onChange={(e) => handleInputChange(product.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-24 text-right"
                        step="0.01"
                        min="0"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={product.lineTotal}
                        onChange={(e) => handleInputChange(product.id, 'lineTotal', parseFloat(e.target.value) || 0)}
                        className="w-24 text-right"
                        step="0.01"
                         min="0"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveRow(product.id)}
                        className="text-destructive hover:text-destructive/80"
                         aria-label="Remove row"
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
        </div>
    }>
      <EditInvoiceContent />
    </Suspense>
  );
}
