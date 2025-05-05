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
import { useAuth } from '@/context/AuthContext';

// Define the structure for edited product data, making fields potentially editable
interface EditableProduct extends Product {
  id: string; // Add a unique ID for React key prop and editing logic
}

function EditInvoiceContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth(); // Get user context

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
    }

    if (dataParam) {
      try {
        const parsedData = JSON.parse(decodeURIComponent(dataParam));
        if (parsedData && Array.isArray(parsedData.products)) {
          // Add a unique ID to each product for stable editing
          const productsWithIds = parsedData.products.map((p: Product, index: number) => ({
            ...p,
            id: `${Date.now()}-${index}`, // Simple unique ID generation
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


   // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
       toast({
         title: "Authentication Required",
         description: "Please log in to edit invoices.",
         variant: "destructive",
       });
    }
  }, [authLoading, user, router, toast]);


  const handleInputChange = (id: string, field: keyof Product, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.id === id ? { ...product, [field]: value } : product
      )
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
     if (!user) {
        toast({ title: "Authentication Error", description: "You must be logged in to save.", variant: "destructive"});
        return;
     }
     setIsSaving(true);
     try {
       // Remove the temporary 'id' field before sending to the backend
       const productsToSave: Product[] = products.map(({ id, ...rest }) => rest);
       await saveProducts(productsToSave); // Use the backend service function
       toast({
         title: "Products Saved",
         description: "Your changes have been saved successfully.",
       });
       router.push('/inventory'); // Navigate to inventory after saving
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

   if (authLoading || isLoading || !initialDataLoaded) {
     return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
     );
   }

   if (!user) {
      // Should be redirected by the effect, but this is a fallback
      return <div className="container mx-auto p-4 md:p-8"><p>Redirecting to login...</p></div>;
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
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
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
             <Button onClick={handleSave} disabled={isSaving} className="bg-primary hover:bg-primary/90">
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