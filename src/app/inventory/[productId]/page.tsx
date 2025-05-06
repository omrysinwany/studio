'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Package, Tag, Hash, Layers, Calendar, Loader2, AlertTriangle, Edit, Save, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { getProductById, updateProduct, Product } from '@/services/backend'; // Import updateProduct
import { Input } from '@/components/ui/input'; // Import Input for editing
import { Label } from '@/components/ui/label'; // Import Label for editing


// Helper function to safely format numbers for display
const formatDisplayNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = false } = options || {};

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

// Helper function for input values (no grouping, fixed decimals)
const formatInputValue = (value: number | undefined | null): string => {
    if (value === null || value === undefined || isNaN(value)) {
        return '0.00';
    }
    return value.toFixed(2); // Use toFixed for consistent decimal places
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [editedProduct, setEditedProduct] = useState<Partial<Product>>({}); // State for edited values
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false); // State to toggle edit mode
  const [isSaving, setIsSaving] = useState(false);
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
        setEditedProduct({ ...data }); // Initialize edited state
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
      let numericValue = (typeof value === 'string') ? parseFloat(value.replace(/,/g, '')) : value;
      if (isNaN(numericValue) && (field === 'quantity' || field === 'unitPrice' || field === 'lineTotal')) {
        numericValue = 0;
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
      setIsEditing(false); // Exit edit mode
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

  // Handle cancelling edit mode
  const handleCancel = () => {
    setEditedProduct({ ...product }); // Reset edited state to original product data
    setIsEditing(false);
  };


  const renderDetailItem = (icon: React.ElementType, label: string, value: string | number | undefined, fieldKey: keyof Product, isCurrency: boolean = false, isQuantity: boolean = false) => {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
    const IconComponent = icon;

    const displayValue = typeof value === 'number'
      ? (isCurrency
            ? `₪${formatDisplayNumber(value, { decimals: 2, useGrouping: true })}` // Currency with grouping
            : (isQuantity
                 ? formatDisplayNumber(value, { decimals: 0, useGrouping: true }) // Quantity as integer with grouping
                 : formatDisplayNumber(value, { decimals: 2, useGrouping: true })) // Other numbers with grouping
        )
      : value;


    return (
      <div className="flex items-start space-x-3 py-2">
        <IconComponent className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
        <div className="flex-grow">
          <Label htmlFor={isEditing ? fieldKey : undefined} className="text-sm font-medium text-muted-foreground">{label}</Label>
          {isEditing && (fieldKey === 'catalogNumber' || fieldKey === 'description' || fieldKey === 'quantity' || fieldKey === 'unitPrice') ? (
            <Input
              id={fieldKey}
              type={fieldKey === 'quantity' || fieldKey === 'unitPrice' ? 'number' : 'text'}
              value={fieldKey === 'quantity' || fieldKey === 'unitPrice'
                        ? formatInputValue(editedProduct[fieldKey] as number | undefined)
                        : editedProduct[fieldKey] || ''}
              onChange={(e) => handleInputChange(fieldKey, e.target.value)}
              className="mt-1 h-9"
              step={fieldKey === 'quantity' || fieldKey === 'unitPrice' ? '0.01' : undefined}
              min={fieldKey === 'quantity' || fieldKey === 'unitPrice' ? '0' : undefined}
            />
          ) : (
            <p className="text-base mt-0.5">{displayValue}</p>
          )}
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
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
        </Button>
      </div>
    );
  }

  if (!product) {
     return (
       <div className="container mx-auto p-4 md:p-8 text-center">
         <p>Product not found.</p>
         <Button variant="outline" onClick={() => router.back()} className="mt-4">
           <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
         </Button>
       </div>
     );
   }


  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        {/* Back and Edit/Save Buttons */}
       <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
         <Button variant="outline" onClick={() => !isEditing && router.back()} disabled={isEditing}>
           <ArrowLeft className="mr-2 h-4 w-4" /> Back to Inventory
         </Button>
         {isEditing ? (
            <div className="flex gap-2">
                <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                   <X className="mr-2 h-4 w-4" /> Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Changes
                </Button>
            </div>
         ) : (
            <Button variant="secondary" onClick={() => setIsEditing(true)}>
              <Edit className="mr-2 h-4 w-4" /> Edit Product
            </Button>
         )}
       </div>

      <Card className="shadow-lg">
        <CardHeader>
           {isEditing ? (
              <>
                <Label htmlFor="description" className="text-sm font-medium text-muted-foreground">Product Description</Label>
                <Input
                    id="description"
                    value={editedProduct.description || ''}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    className="text-2xl sm:text-3xl font-bold h-auto p-0 border-0 shadow-none focus-visible:ring-0"
                    />
                 <Label htmlFor="catalogNumber" className="text-sm font-medium text-muted-foreground pt-2">Catalog Number</Label>
                 <Input
                    id="catalogNumber"
                    value={editedProduct.catalogNumber || ''}
                    onChange={(e) => handleInputChange('catalogNumber', e.target.value)}
                    className="text-sm h-auto p-0 border-0 shadow-none focus-visible:ring-0 text-muted-foreground"
                  />
              </>
           ) : (
             <>
               <CardTitle className="text-2xl sm:text-3xl font-bold text-primary flex items-center">
                 <Package className="mr-3 h-6 sm:h-8 w-6 sm:w-8 flex-shrink-0" /> <span className='truncate'>{product.description}</span>
               </CardTitle>
               <CardDescription>Detailed information for catalog #{product.catalogNumber}</CardDescription>
             </>
           )}
           {product.quantity <= 10 && !isEditing && (
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
             {/* Show Catalog # only in view mode if header editing handles it */}
             {!isEditing && renderDetailItem(Hash, "Catalog Number", product.catalogNumber, 'catalogNumber')}
             {renderDetailItem(Layers, "Quantity", isEditing ? editedProduct.quantity : product.quantity, 'quantity', false, true)}
             {renderDetailItem(Tag, "Unit Price", isEditing ? editedProduct.unitPrice : product.unitPrice, 'unitPrice', true)}
             {/* Line Total is calculated, maybe don't make it editable directly */}
             {renderDetailItem(DollarSign, "Line Total", isEditing ? editedProduct.lineTotal : product.lineTotal, 'lineTotal', true)}
             {/* Add other fields as needed */}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
