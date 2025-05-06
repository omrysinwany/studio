
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { ArrowLeft, Package, Tag, Hash, Layers, Calendar, Loader2, AlertTriangle, Save, X, DollarSign, Trash2, Pencil, Barcode, Camera } from 'lucide-react'; // Added Pencil, X, Barcode, Camera
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { getProductById, updateProduct, deleteProduct, Product } from '@/services/backend'; // Import deleteProduct
import { Input } from '@/components/ui/input'; // Import Input for editing
import { Label } from '@/components/ui/label'; // Import Label for editing
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"; // Import AlertDialog
import { cn } from '@/lib/utils'; // Import cn
import BarcodeScanner from '@/components/barcode-scanner'; // Import BarcodeScanner component


// Helper function to safely format numbers for display
const formatDisplayNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = true } = options || {}; // Default: 2 decimals, WITH grouping

    if (value === null || value === undefined || isNaN(value)) {
        return (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
        });
    }

    return value.toLocaleString(undefined, { // Use browser's locale for formatting
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping,
    });
};

// Helper function for input values (no grouping, fixed decimals)
const formatInputValue = (value: number | undefined | null): string => {
    if (value === null || value === undefined || isNaN(value)) {
        return '0.00';
    }
    // Use toFixed for consistent decimal places, but parse as float first to handle potential strings
    return parseFloat(String(value)).toFixed(2);
};

// Helper function to format quantity as integer for display (with grouping)
const formatIntegerQuantity = (
    value: number | undefined | null
): string => {
    return formatDisplayNumber(value, { decimals: 0, useGrouping: true }); // Use 0 decimals and grouping
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [editedProduct, setEditedProduct] = useState<Partial<Product>>({}); // State for edited values
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false); // Default to view mode
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false); // State for delete operation
  const [isScanning, setIsScanning] = useState(false); // State for barcode scanning modal
  const [error, setError] = useState<string | null>(null);

  const productId = params.productId as string;

   // Fetch product details
   const loadProduct = useCallback(async () => {
    if (!productId) return;

    setIsLoading(true);
    setError(null);
    try {
      const data = await getProductById(productId);
      if (data) {
        setProduct(data);
        setEditedProduct({ ...data }); // Initialize edited state for potential editing later
      } else {
        setError("Product not found.");
         toast({
           title: "Error",
           description: "Could not find the specified product.",
           variant: "destructive",
         });
      }
    } catch (err) {
      console.error("Failed to fetch product details:", err);
      setError("Failed to load product details. Please try again.");
      toast({
        title: "Error",
        description: "An error occurred while loading product details.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [productId, toast]);


  useEffect(() => {
     loadProduct();
  }, [loadProduct]);

    // Handle input changes during editing
  const handleInputChange = (field: keyof Product, value: string | number) => {
    setEditedProduct(prev => {
      let numericValue: number | string = value; // Keep as string for non-numeric fields initially
      if (field === 'quantity' || field === 'unitPrice' || field === 'lineTotal') {
          // Ensure value is treated as string before replacing commas
          const stringValue = String(value);
          numericValue = (typeof value === 'string' || typeof value === 'number') ? parseFloat(stringValue.replace(/,/g, '')) : value;
          if (isNaN(numericValue)) {
             numericValue = 0;
          }
      }


      const updated = { ...prev, [field]: numericValue };

      // Recalculate lineTotal if quantity or unitPrice changes
      if (field === 'quantity' || field === 'unitPrice') {
          const quantity = Number(updated.quantity) || 0;
          const unitPrice = Number(updated.unitPrice) || 0;
          updated.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
      }
      // Note: We don't auto-calculate unitPrice from lineTotal/quantity here,
      // user should adjust unitPrice if lineTotal is changed.

      return updated;
    });
  };

  // Handle saving changes
  const handleSave = async () => {
    if (!product || !product.id) return;
    setIsSaving(true);
    try {
      const productToSave: Partial<Product> = {
        catalogNumber: editedProduct.catalogNumber || product.catalogNumber,
        description: editedProduct.description || product.description,
        shortName: editedProduct.shortName || product.shortName, // Include shortName
        barcode: editedProduct.barcode || undefined, // Include barcode, ensure it's undefined if empty
        quantity: Number(editedProduct.quantity) ?? product.quantity,
        unitPrice: Number(editedProduct.unitPrice) ?? product.unitPrice,
        // Ensure lineTotal is recalculated based on potentially edited quantity/unitPrice
        lineTotal: parseFloat(((Number(editedProduct.quantity) ?? product.quantity) * (Number(editedProduct.unitPrice) ?? product.unitPrice)).toFixed(2))
      };

      await updateProduct(product.id, productToSave); // Call backend update function
      toast({
        title: "Product Updated",
        description: "Changes saved successfully.",
      });
      setIsEditing(false); // Switch back to view mode after saving
      await loadProduct(); // Reload product data to show saved values
    } catch (err) {
      console.error("Failed to save product:", err);
      toast({
        title: "Save Failed",
        description: "Could not save product changes.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

   // Handle Deleting Product
   const handleDelete = async () => {
    if (!product || !product.id) return;
    setIsDeleting(true);
    try {
      await deleteProduct(product.id); // Call backend delete function
      toast({
        title: "Product Deleted",
        description: `Product "${product.description}" has been deleted.`,
      });
      router.push('/inventory?refresh=true'); // Go back to inventory list after delete
    } catch (err) {
      console.error("Failed to delete product:", err);
      toast({
        title: "Delete Failed",
        description: "Could not delete the product.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle entering edit mode
  const handleEdit = () => {
    if (product) {
        setEditedProduct({ ...product }); // Initialize editor with current product data
        setIsEditing(true);
    }
  };

  // Handle cancelling edit mode
  const handleCancelEdit = () => {
    if (product) {
        setEditedProduct({ ...product }); // Reset edited state to original product data
        setIsEditing(false);
        toast({
            title: "Edit Cancelled",
            description: "Your changes were not saved.",
            variant: "default",
        });
    }
  };

  // Handle Back button click
   const handleBack = () => {
      router.back(); // Go back to the previous page (inventory list)
   };

   // Handle opening the barcode scanner modal
   const handleScanBarcode = () => {
       setIsScanning(true);
   };

   // Handle barcode detection from the scanner component
   const handleBarcodeDetected = (barcodeValue: string) => {
       handleInputChange('barcode', barcodeValue); // Update the editedProduct state
       setIsScanning(false); // Close the scanner modal
       toast({
           title: "Barcode Scanned",
           description: `Barcode set to: ${barcodeValue}`,
       });
   };


   // Render individual detail item in VIEW mode
   const renderViewItem = (icon: React.ElementType, label: string, value: string | number | undefined, isCurrency: boolean = false, isQuantity: boolean = false, isBarcode: boolean = false) => {
     const IconComponent = icon;
     const displayValue = typeof value === 'number'
       ? (isCurrency
             ? `₪${formatDisplayNumber(value, { decimals: 2, useGrouping: true })}`
             : (isQuantity
                  ? formatIntegerQuantity(value) // Use integer formatter for quantity
                  : formatDisplayNumber(value, { decimals: 2, useGrouping: true })) // Default number formatting
         )
       : (value || (isBarcode ? 'Not set' : '-')); // Show 'Not set' for empty barcode, '-' otherwise

     return (
       <div className="flex items-start space-x-3 py-2"> {/* Changed items-center to items-start */}
         <IconComponent className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" /> {/* Added mt-1 */}
         <div className="flex-grow"> {/* Added flex-grow */}
           <p className="text-sm font-medium text-muted-foreground">{label}</p>
           <p className="text-base font-semibold">{displayValue}</p>
         </div>
       </div>
     );
   };

    // Render individual detail item in EDIT mode
    const renderEditItem = (icon: React.ElementType, label: string, value: string | number | undefined, fieldKey: keyof Product, isCurrency: boolean = false, isQuantity: boolean = false, isBarcode: boolean = false) => {
        const IconComponent = icon;
        const inputType =
          fieldKey === 'quantity' || fieldKey === 'unitPrice' || fieldKey === 'lineTotal'
            ? 'number'
            : 'text';
         // Use formatInputValue for numbers, otherwise use the value directly or empty string
         const inputValue =
           inputType === 'number'
             ? formatInputValue(value as number | undefined)
             : value || '';

        return (
          <div className="flex items-start space-x-3 py-2">
            <IconComponent className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
            <div className="flex-grow">
              <Label htmlFor={fieldKey} className="text-sm font-medium text-muted-foreground">{label}</Label>
              <div className="flex items-center gap-2">
                <Input
                    id={fieldKey}
                    type={inputType}
                    value={inputValue}
                    onChange={(e) => handleInputChange(fieldKey, e.target.value)}
                    className="mt-1 h-9 flex-grow" // Use flex-grow
                    step={inputType === 'number' ? (isQuantity ? '1' : '0.01') : undefined} // Integer step for quantity
                    min={inputType === 'number' ? '0' : undefined}
                    // Disable lineTotal input as it's calculated
                    disabled={fieldKey === 'lineTotal' || isSaving || isDeleting}
                  />
                  {isBarcode && (
                    <Button
                        type="button" // Important: prevent form submission if wrapped in form
                        variant="outline"
                        size="icon"
                        className="mt-1 h-9 w-9 flex-shrink-0"
                        onClick={handleScanBarcode}
                        disabled={isSaving || isDeleting}
                        aria-label="Scan Barcode"
                    >
                        <Camera className="h-4 w-4" />
                    </Button>
                  )}
                </div>
            </div>
          </div>
        );
      };


  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 md:p-8 text-center">
         <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <p className="text-xl text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
        </Button>
      </div>
    );
  }

  if (!product) {
     return (
       <div className="container mx-auto p-4 md:p-8 text-center">
         <p>Product not found.</p>
         <Button variant="outline" onClick={handleBack} className="mt-4">
           <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
         </Button>
       </div>
     );
   }


  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        {/* Back, Edit/Save, Cancel, Delete Buttons */}
       <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
         {/* Go Back button */}
         <Button variant="outline" onClick={handleBack} disabled={isSaving || isDeleting}>
           <ArrowLeft className="mr-2 h-4 w-4" /> Back
         </Button>
         <div className="flex gap-2">
             {isEditing ? (
                 <>
                     <Button variant="outline" onClick={handleCancelEdit} disabled={isSaving || isDeleting}>
                         <X className="mr-2 h-4 w-4" /> Cancel
                     </Button>
                     <Button onClick={handleSave} disabled={isSaving || isDeleting}>
                         {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                         Save Changes
                     </Button>
                 </>
             ) : (
                 <>
                     {/* Delete Button - Only show in View mode */}
                      <AlertDialog>
                         <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={isDeleting}>
                                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                Delete
                            </Button>
                         </AlertDialogTrigger>
                         <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                               This action cannot be undone. This will permanently delete the product "{product.description}".
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>
                               {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                               Yes, Delete Product
                            </AlertDialogAction>
                            </AlertDialogFooter>
                         </AlertDialogContent>
                      </AlertDialog>

                     <Button onClick={handleEdit}>
                         <Pencil className="mr-2 h-4 w-4" /> Edit
                     </Button>
                 </>
             )}
        </div>
       </div>

      <Card className="shadow-lg">
        <CardHeader>
           {isEditing ? (
             <>
                <Label htmlFor="shortName" className="text-sm font-medium text-muted-foreground">Product Name</Label>
                <Input
                    id="shortName"
                    value={editedProduct.shortName || ''}
                    onChange={(e) => handleInputChange('shortName', e.target.value)}
                    className="text-2xl sm:text-3xl font-bold h-auto p-0 border-0 shadow-none focus-visible:ring-0"
                    disabled={isSaving || isDeleting}
                    />
                <Label htmlFor="description" className="text-sm font-medium text-muted-foreground pt-2">Full Description</Label>
                <Input
                    id="description"
                    value={editedProduct.description || ''}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    className="text-sm h-auto p-0 border-0 shadow-none focus-visible:ring-0 text-muted-foreground"
                    disabled={isSaving || isDeleting}
                  />
                 <Label htmlFor="catalogNumber" className="text-sm font-medium text-muted-foreground pt-2">Catalog Number</Label>
                 <Input
                    id="catalogNumber"
                    value={editedProduct.catalogNumber || ''}
                    onChange={(e) => handleInputChange('catalogNumber', e.target.value)}
                    className="text-sm h-auto p-0 border-0 shadow-none focus-visible:ring-0 text-muted-foreground"
                    disabled={isSaving || isDeleting}
                  />
              </>
           ) : (
               <>
                 <CardTitle className="text-2xl sm:text-3xl font-bold text-primary">{product.shortName || product.description}</CardTitle>
                 <CardDescription className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground"/>
                    {product.catalogNumber}
                 </CardDescription>
                  {product.shortName && product.description !== product.shortName && (
                     <p className="text-sm text-muted-foreground mt-1">{product.description}</p>
                  )}
               </>
           )}

           {product.quantity <= 10 && !isEditing && ( // Show low stock badge only in view mode
                <span className={`mt-2 inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium ${
                    product.quantity === 0 ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                }`}>
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    {product.quantity === 0 ? 'Out of Stock' : 'Low Stock'}
                </span>
            )}
        </CardHeader>
        <CardContent className="space-y-1 sm:space-y-2">
           <Separator className="my-4" />

           <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">
             {isEditing ? (
                 <>
                    {renderEditItem(Barcode, "Barcode", editedProduct.barcode, 'barcode', false, false, true)}
                    {renderEditItem(Layers, "Quantity", editedProduct.quantity, 'quantity', false, true)}
                    {renderEditItem(Tag, "Unit Price", editedProduct.unitPrice, 'unitPrice', true)}
                    {renderEditItem(DollarSign, "Line Total", editedProduct.lineTotal, 'lineTotal', true)}
                 </>
             ) : (
                 <>
                    {renderViewItem(Barcode, "Barcode", product.barcode, false, false, true)}
                    {renderViewItem(Layers, "Quantity", product.quantity, false, true)}
                    {renderViewItem(Tag, "Unit Price", product.unitPrice, true)}
                    {renderViewItem(DollarSign, "Line Total", product.lineTotal, true)}
                 </>
             )}
             {/* Add other fields as needed, adapting for view/edit mode */}
          </div>
        </CardContent>
      </Card>

      {/* Barcode Scanner Modal */}
      {isScanning && (
        <BarcodeScanner
          onBarcodeDetected={handleBarcodeDetected}
          onClose={() => setIsScanning(false)}
        />
      )}
    </div>
  );
}
