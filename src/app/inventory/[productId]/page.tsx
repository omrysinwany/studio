'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Package, Tag, Hash, Layers, Calendar, Loader2, AlertTriangle } from 'lucide-react'; // Removed DollarSign
// Removed useAuth import
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { getProductById, Product } from '@/services/backend'; // Import specific product fetch and getProductById


// Mock Product Data Interface (should match inventory page) - Using Product from backend now
// interface InventoryProduct {
//   id: string;
//   name: string;
//   catalogNumber: string;
//   quantity: number;
//   unitPrice: number; // Effective unit price
//   category?: string;
//   lastUpdated: string;
//   // Add more potential fields if needed
//   description?: string;
//   supplier?: string;
//   location?: string;
//   lineTotal?: number;
// }

// Mock fetching function - Replace with actual API call - Now using getProductById
// const fetchProductDetails = async (productId: string, token: string | null): Promise<Product | null> => {
//    // TODO: Replace with actual API call
//    // const response = await fetch(`/api/inventory/${productId}`, { headers: { 'Authorization': `Bearer ${token}` }});
//    // if (!response.ok) return null;
//    // return await response.json();
//
//    console.log(`Fetching product with ID: ${productId}`);
//    await new Promise(resolve => setTimeout(resolve, 700)); // Simulate API delay
//
//    // Find product in mock data (for demonstration) - Removed
//
//    return null; // Return null if not found
// };

// Mock data used by the mock fetch function (should match inventory page) - Removed

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  // Removed user, token, authLoading from useAuth
  const { toast } = useToast();
  const [product, setProduct] = useState<Product | null>(null); // Use backend Product type
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const productId = params.productId as string;

   // Fetch product details
  useEffect(() => {
    const loadProduct = async () => {
       if (!productId) return; // Removed user check

      setIsLoading(true);
      setError(null);
      try {
        // Passing null for token as it's not needed without auth
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

     loadProduct(); // Load product directly
     // Removed authLoading and user dependencies
  }, [productId, toast]);


    // Removed useEffect for auth redirection

  const renderDetailItem = (icon: React.ElementType, label: string, value: string | number | undefined, isCurrency: boolean = false) => {
    if (value === undefined || value === null || value === '') return null;
    const IconComponent = icon;
    const displayValue = isCurrency && typeof value === 'number'
      ? `₪${value.toFixed(2)}`
      : value;
    return (
      <div className="flex items-start space-x-3">
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
       return new Date(dateString).toLocaleString(); // Show date and time
     } catch (e) {
       return 'Invalid Date';
     }
   };


  if (isLoading) { // Removed authLoading check
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

   // Removed !user check

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
     // This case might occur briefly or if fetch returns null unexpectedly after loading
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
    <div className="container mx-auto p-4 md:p-8 space-y-6">
       <Button variant="outline" onClick={() => router.back()} className="mb-4">
         <ArrowLeft className="mr-2 h-4 w-4" /> Back to Inventory
       </Button>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-primary flex items-center">
             <Package className="mr-3 h-8 w-8" /> {product.description} {/* Use description */}
          </CardTitle>
          <CardDescription>Detailed information for catalog #{product.catalogNumber}</CardDescription>
           {product.quantity <= 10 && (
                <span className={`mt-2 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    product.quantity === 0 ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                }`}>
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    {product.quantity === 0 ? 'Out of Stock' : 'Low Stock'}
                </span>
            )}
        </CardHeader>
        <CardContent className="space-y-6">
           {/* Removed extra description section as it's the title now */}
           {/* {product.description && ( ... )} */}

           <Separator />

           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {renderDetailItem(Hash, "Catalog Number", product.catalogNumber)}
             {renderDetailItem(Layers, "Quantity", product.quantity)}
             {renderDetailItem(Tag, "Unit Price", product.unitPrice, true)} {/* Use Tag and set isCurrency */}
             {renderDetailItem(Tag, "Line Total", product.lineTotal, true)} {/* Use Tag and set isCurrency */}
             {/* {renderDetailItem(Tag, "Category", product.category)} */}
             {/* {renderDetailItem(Tag, "Supplier", product.supplier)} */}
             {/* {renderDetailItem(Tag, "Location", product.location)} */}
             {/* {renderDetailItem(Calendar, "Last Updated", formatDate(product.lastUpdated))} */}
          </div>

           {/* Optional Actions */}
           {/* <Separator />
           <div className="flex gap-2">
              <Button>Edit Product</Button>
              <Button variant="destructive">Delete Product</Button>
           </div> */}

        </CardContent>
      </Card>
    </div>
  );
}
