
'use client';

import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Camera, Save, SkipForward, X, DollarSign } from 'lucide-react';
import BarcodeScanner from '@/components/barcode-scanner';
import type { Product } from '@/services/backend';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface BarcodePromptDialogProps {
  products: Product[]; // Products needing barcode assignment and potentially sale price
  onComplete: (updatedProducts: Product[] | null) => void;
}

const BarcodePromptDialog: React.FC<BarcodePromptDialogProps> = ({ products, onComplete }) => {
  const [promptedProducts, setPromptedProducts] = useState<Product[]>(
    products.map(p => ({ ...p }))
  );
  const [currentScanningProductId, setCurrentScanningProductId] = useState<string | null>(null);

  const handleInputChange = (productId: string, field: keyof Product, value: string) => {
    setPromptedProducts(prev =>
      prev.map(p => {
        if (p.id === productId) {
          if (field === 'salePrice') {
            const numericValue = parseFloat(value);
            return { ...p, [field]: isNaN(numericValue) ? undefined : numericValue };
          }
          return { ...p, [field]: value.trim() };
        }
        return p;
      })
    );
  };


  const handleScanClick = (productId: string) => {
    setCurrentScanningProductId(productId);
  };

  const handleBarcodeDetected = useCallback((barcodeValue: string) => {
    if (currentScanningProductId) {
      handleInputChange(currentScanningProductId, 'barcode', barcodeValue);
      toast({
        title: "Barcode Scanned",
        description: `Barcode ${barcodeValue} assigned.`,
      });
    }
    setCurrentScanningProductId(null);
  }, [currentScanningProductId]);

  const handleScannerClose = () => {
    setCurrentScanningProductId(null);
  };

  const handleSave = () => {
    const productsWithMissingSalePrice = promptedProducts.filter(
      p => p.salePrice === undefined || p.salePrice === null || isNaN(Number(p.salePrice)) || Number(p.salePrice) <= 0
    );

    if (productsWithMissingSalePrice.length > 0) {
      toast({
        title: "Missing Sale Price",
        description: `Please enter a valid sale price for all new products: ${productsWithMissingSalePrice.map(p=> p.shortName || p.catalogNumber).join(', ')}.`,
        variant: "destructive",
        duration: 5000,
      });
      return;
    }
    onComplete(promptedProducts);
  };

  const handleCancel = () => {
    onComplete(null);
  };

  const handleSkipProduct = useCallback((productId: string) => {
     const skippedProduct = promptedProducts.find(p => p.id === productId);
     if (skippedProduct) {
         setPromptedProducts(prev => prev.filter(p => p.id !== productId));
         toast({
             title: "Product Skipped",
             description: `Input for "${skippedProduct.shortName || skippedProduct.description || 'Product'}" skipped.`,
             variant: "default",
         });
     }
  }, [promptedProducts]);


  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-md md:max-w-lg max-h-[90vh] sm:max-h-[80vh] flex flex-col p-0 sm:p-0">
        <DialogHeader className="p-4 sm:p-6 border-b">
          <DialogTitle>New Product Details</DialogTitle>
          <DialogDescription>
            Enter details for new products. Barcode is optional, Sale Price is required. Click "Confirm &amp; Save" when done.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-grow border-b">
          <div className={cn("space-y-6 p-4 sm:p-6", promptedProducts.length === 0 && "flex justify-center items-center h-full")}>
             {promptedProducts.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No new products remaining to assign details.</p>
             ) : (
                promptedProducts.map((product) => (
                  <div key={product.id} className="space-y-3 border-b pb-4 last:border-b-0">
                    <Label className="font-medium text-base">
                      {product.shortName || product.description}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Catalog: {product.catalogNumber || 'N/A'} | Qty: {product.quantity}
                    </p>
                    
                    {/* Barcode Input */}
                    <div>
                        <Label htmlFor={`barcode-${product.id}`} className="text-sm">Barcode (Optional)</Label>
                        <div className="flex items-center gap-2 mt-1">
                        <Input
                            id={`barcode-${product.id}`}
                            value={product.barcode || ''}
                            onChange={(e) => handleInputChange(product.id, 'barcode', e.target.value)}
                            placeholder="Enter or scan barcode"
                            className="flex-grow"
                            aria-label={`Barcode for ${product.shortName || product.description}`}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => handleScanClick(product.id)}
                            className="h-9 w-9 shrink-0"
                            aria-label={`Scan barcode for ${product.shortName || product.description}`}
                        >
                            <Camera className="h-4 w-4" />
                        </Button>
                        </div>
                    </div>

                    {/* Sale Price Input */}
                    <div>
                        <Label htmlFor={`salePrice-${product.id}`} className="text-sm">
                            Sale Price (₪) <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative mt-1">
                             <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id={`salePrice-${product.id}`}
                                type="number"
                                value={product.salePrice === undefined ? '' : String(product.salePrice)}
                                onChange={(e) => handleInputChange(product.id, 'salePrice', e.target.value)}
                                placeholder="Enter sale price"
                                className="pl-7" // Padding for icon
                                min="0.01"
                                step="0.01"
                                aria-label={`Sale price for ${product.shortName || product.description}`}
                                required
                            />
                        </div>
                    </div>
                     <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSkipProduct(product.id)}
                        className="text-xs text-muted-foreground h-8 px-2 w-full justify-start mt-1"
                        title={`Skip all inputs for ${product.shortName || product.description}`}
                        aria-label={`Skip all inputs for ${product.shortName || product.description}`}
                        >
                        <SkipForward className="h-4 w-4 mr-1" />
                        Skip This Product
                    </Button>
                  </div>
                ))
             )}
          </div>
        </ScrollArea>

        <DialogFooter className="p-4 sm:p-6 border-t flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleCancel} className="w-full sm:w-auto">
            <X className="mr-2 h-4 w-4" /> Cancel Save
          </Button>
          <Button onClick={handleSave} className="w-full sm:w-auto">
            <Save className="mr-2 h-4 w-4" /> Confirm &amp; Save Products
          </Button>
        </DialogFooter>
      </DialogContent>

      {currentScanningProductId && (
        <BarcodeScanner
          onBarcodeDetected={handleBarcodeDetected}
          onClose={handleScannerClose}
        />
      )}
    </Dialog>
  );
};

export default BarcodePromptDialog;
