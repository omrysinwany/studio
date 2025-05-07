
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { ArrowLeft, Package, Tag, Hash, Layers, Calendar, Loader2, AlertTriangle, Save, X, DollarSign, Trash2, Pencil, Barcode, Camera, TrendingUp, TrendingDown } from 'lucide-react'; // Added TrendingUp, TrendingDown
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { getProductByIdService, updateProductService, deleteProductService, Product } from '@/services/backend'; // Import deleteProduct
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
} from "@/components/ui/alert-dialog";
import { cn } from '@/lib/utils';
import BarcodeScanner from '@/components/barcode-scanner';


// Helper function to safely format numbers for display
const formatDisplayNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = true } = options || {};

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

// Helper function for input values (no grouping, fixed decimals for currency, or integer for quantity)
const formatInputValue = (value: number | undefined | null, fieldType: 'currency' | 'quantity' | 'stockLevel'): string => {
    if (value === null || value === undefined || isNaN(value)) {
        if (fieldType === 'stockLevel' && value === null) return ''; // Allow empty for stock levels
        return fieldType === 'currency' ? '0.00' : '0';
    }
    // Use toFixed for consistent decimal places, but parse as float first to handle potential strings
    if (fieldType === 'currency') {
      return parseFloat(String(value)).toFixed(2);
    }
     // For quantity and stockLevel, ensure integer, unless stockLevel is explicitly null/empty
    return parseInt(String(value), 10).toString();
};

// Helper function to format quantity as integer for display (with grouping)
const formatIntegerQuantity = (
    value: number | undefined | null
): string => {
    return formatDisplayNumber(value, { decimals: 0, useGrouping: true });
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [editedProduct, setEditedProduct] = useState<Partial<Product>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productId = params.productId as string;

   const loadProduct = useCallback(async () => {
    if (!productId) return;

    setIsLoading(true);
    setError(null);
    try {
      const data = await getProductByIdService(productId);
      if (data) {
        setProduct(data);
        setEditedProduct({ ...data });
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

  const handleInputChange = (field: keyof Product, value: string | number) => {
    setEditedProduct(prev => {
      let numericValue: number | string | null = value; // Allow null for stock levels
      if (field === 'quantity' || field === 'unitPrice' || field === 'lineTotal' || field === 'minStockLevel' || field === 'maxStockLevel') {
          const stringValue = String(value);
          if (stringValue.trim() === '' && (field === 'minStockLevel' || field === 'maxStockLevel')) {
              numericValue = null; // Set to null if empty for stock levels
          } else {
            numericValue = parseFloat(stringValue.replace(/,/g, ''));
            if (isNaN(numericValue as number)) {
               numericValue = (field === 'minStockLevel' || field === 'maxStockLevel') ? null : 0;
            }
          }
      }

      const updated = { ...prev, [field]: numericValue === null ? undefined : numericValue };


      if (field === 'quantity' || field === 'unitPrice') {
          const quantity = Number(updated.quantity) || 0;
          const unitPrice = Number(updated.unitPrice) || 0;
          updated.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
      }

      return updated;
    });
  };

  const handleSave = async () => {
    if (!product || !product.id) return;
    setIsSaving(true);
    try {
      const productToSave: Partial<Product> = {
        catalogNumber: editedProduct.catalogNumber || product.catalogNumber,
        description: editedProduct.description || product.description,
        shortName: editedProduct.shortName || product.shortName,
        barcode: editedProduct.barcode || undefined,
        quantity: Number(editedProduct.quantity) ?? product.quantity,
        unitPrice: Number(editedProduct.unitPrice) ?? product.unitPrice,
        lineTotal: parseFloat(((Number(editedProduct.quantity) ?? product.quantity) * (Number(editedProduct.unitPrice) ?? product.unitPrice)).toFixed(2)),
        minStockLevel: editedProduct.minStockLevel === null ? undefined : (Number(editedProduct.minStockLevel) ?? product.minStockLevel),
        maxStockLevel: editedProduct.maxStockLevel === null ? undefined : (Number(editedProduct.maxStockLevel) ?? product.maxStockLevel),
      };

      await updateProductService(product.id, productToSave);
      toast({
        title: "Product Updated",
        description: "Changes saved successfully.",
      });
      setIsEditing(false);
      await loadProduct();
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

   const handleDelete = async () => {
    if (!product || !product.id) return;
    setIsDeleting(true);
    try {
      await deleteProductService(product.id);
      toast({
        title: "Product Deleted",
        description: `Product "${product.shortName || product.description}" has been deleted.`,
      });
      router.push('/inventory?refresh=true');
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

  const handleEdit = () => {
    if (product) {
        setEditedProduct({ ...product });
        setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    if (product) {
        setEditedProduct({ ...product });
        setIsEditing(false);
        toast({
            title: "Edit Cancelled",
            description: "Your changes were not saved.",
            variant: "default",
        });
    }
  };

   const handleBack = () => {
      router.back();
   };

   const handleScanBarcode = () => {
       setIsScanning(true);
   };

   const handleBarcodeDetected = (barcodeValue: string) => {
       handleInputChange('barcode', barcodeValue);
       setIsScanning(false);
       toast({
           title: "Barcode Scanned",
           description: `Barcode set to: ${barcodeValue}`,
       });
   };


   const renderViewItem = (icon: React.ElementType, label: string, value: string | number | undefined | null, isCurrency: boolean = false, isQuantity: boolean = false, isBarcode: boolean = false, isStockLevel: boolean = false) => {
     const IconComponent = icon;
     let displayValue: string | React.ReactNode = '-';

     if (value !== null && value !== undefined) {
        if (typeof value === 'number') {
            if (isCurrency) displayValue = `₪${formatDisplayNumber(value, { decimals: 2, useGrouping: true })}`;
            else if (isQuantity || isStockLevel) displayValue = formatIntegerQuantity(value);
            else displayValue = formatDisplayNumber(value, { decimals: 2, useGrouping: true });
        } else {
            displayValue = value || (isBarcode ? 'Not set' : '-');
        }
     } else {
        displayValue = (isBarcode || isStockLevel) ? 'Not set' : '-';
     }


     return (
       <div className="flex items-start space-x-3 py-2">
         <IconComponent className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
         <div className="flex-grow">
           <p className="text-sm font-medium text-muted-foreground">{label}</p>
           <p className="text-base font-semibold">{displayValue}</p>
         </div>
       </div>
     );
   };

    const renderEditItem = (icon: React.ElementType, label: string, value: string | number | undefined | null, fieldKey: keyof Product, isCurrency: boolean = false, isQuantity: boolean = false, isBarcode: boolean = false, isStockLevel: boolean = false) => {
        const IconComponent = icon;
        const inputType =
          fieldKey === 'quantity' || fieldKey === 'unitPrice' || fieldKey === 'lineTotal' || fieldKey === 'minStockLevel' || fieldKey === 'maxStockLevel'
            ? 'number'
            : 'text';

         const inputValue =
           inputType === 'number'
             ? formatInputValue(value as number | undefined | null, isCurrency ? 'currency' : (isStockLevel ? 'stockLevel' : 'quantity'))
             : (value as string) || '';


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
                    className="mt-1 h-9 flex-grow"
                    step={inputType === 'number' ? (isCurrency ? '0.01' : '1') : undefined}
                    min={inputType === 'number' ? '0' : undefined}
                    disabled={fieldKey === 'lineTotal' || isSaving || isDeleting}
                    placeholder={isStockLevel ? "Optional" : ""}
                  />
                  {isBarcode && (
                    <Button
                        type="button"
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
       <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
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
                               This action cannot be undone. This will permanently delete the product "{product.shortName || product.description}".
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

      <Card className="shadow-lg scale-fade-in">
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

           {product.quantity <= (product.minStockLevel || 10) && product.quantity > 0 && !isEditing && (
                <span className={`mt-2 inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200`}>
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    Low Stock
                </span>
            )}
            {product.quantity === 0 && !isEditing && (
                 <span className={`mt-2 inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`}>
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    Out of Stock
                </span>
            )}
             {product.maxStockLevel !== undefined && product.quantity > product.maxStockLevel && !isEditing && (
                <span className={`mt-2 inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200`}>
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    Over Stock
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
                    {renderEditItem(TrendingDown, "Min Stock Level", editedProduct.minStockLevel, 'minStockLevel', false, false, false, true)}
                    {renderEditItem(TrendingUp, "Max Stock Level", editedProduct.maxStockLevel, 'maxStockLevel', false, false, false, true)}
                 </>
             ) : (
                 <>
                    {renderViewItem(Barcode, "Barcode", product.barcode, false, false, true)}
                    {renderViewItem(Layers, "Quantity", product.quantity, false, true)}
                    {renderViewItem(Tag, "Unit Price", product.unitPrice, true)}
                    {renderViewItem(DollarSign, "Line Total", product.lineTotal, true)}
                    {renderViewItem(TrendingDown, "Min Stock Level", product.minStockLevel, false, false, false, true)}
                    {renderViewItem(TrendingUp, "Max Stock Level", product.maxStockLevel, false, false, false, true)}
                 </>
             )}
          </div>
        </CardContent>
      </Card>

      {isScanning && (
        <BarcodeScanner
          onBarcodeDetected={handleBarcodeDetected}
          onClose={() => setIsScanning(false)}
        />
      )}
    </div>
  );
}
