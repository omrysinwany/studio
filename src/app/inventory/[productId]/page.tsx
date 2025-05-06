
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Package, Tag, Hash, Layers, Calendar, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { getProductById, Product } from '@/services/backend'; // Import specific product fetch and getProductById


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


export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [product, setProduct] = useState<Product | null>(null); // Use backend Product type
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const productId = params.productId as string;

   // Fetch product details
  useEffect(() => {
    const loadProduct = async () => {
       if (!productId) return;

      setIsLoading(true);
      setError(null);
      try {
        const data = await getProductById(productId); // Use backend service
        if (data) {
          setProduct(data);
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
    };

     loadProduct();
  }, [productId, toast]);


  const renderDetailItem = (icon: React.ElementType, label: string, value: string | number | undefined, isCurrency: boolean = false) => {
    if (value === undefined || value === null || value === '') return null;
    const IconComponent = icon;
    const displayValue = typeof value === 'number'
      ? (isCurrency
            ? `₪${formatNumber(value, { decimals: 2, useGrouping: true })}` // Currency with grouping
            : formatNumber(value, { decimals: 2, useGrouping: true })) // Quantity with grouping
      : value;
    return (
      <div className="flex items-start space-x-3 py-2"> {/* Add padding */}
        <IconComponent className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-base">{displayValue}</p>
        </div>
      </div>
    );
  };

   // Format date for display
   const formatDate = (dateString: string | undefined) => {
     if (!dateString) return 'N/A';
     try {
       return new Date(dateString).toLocaleString();
     } catch (e) {
       return 'Invalid Date';
     }
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
       <Button variant="outline" onClick={() => router.back()} className="mb-4">
         <ArrowLeft className="mr-2 h-4 w-4" /> Back to Inventory
       </Button>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl sm:text-3xl font-bold text-primary flex items-center">
             <Package className="mr-3 h-6 sm:h-8 w-6 sm:w-8" /> {product.description}
          </CardTitle>
          <CardDescription>Detailed information for catalog #{product.catalogNumber}</CardDescription>
           {product.quantity <= 10 && (
                <span className={`mt-2 inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium ${
                    product.quantity === 0 ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                }`}>
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    {product.quantity === 0 ? 'Out of Stock' : 'Low Stock'}
                </span>
            )}
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-6">
           <Separator />

           <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0 sm:gap-y-4"> {/* Adjust gap */}
             {renderDetailItem(Hash, "Catalog Number", product.catalogNumber)}
             {renderDetailItem(Layers, "Quantity", product.quantity)}
             {renderDetailItem(Tag, "Unit Price", product.unitPrice, true)}
             {renderDetailItem(Tag, "Line Total", product.lineTotal, true)}
             {/* {renderDetailItem(Calendar, "Last Updated", formatDate(product.lastUpdated))} */}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
