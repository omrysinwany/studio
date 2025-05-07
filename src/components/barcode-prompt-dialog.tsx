
'use client';

import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Camera, Save, X, CheckCircle, Percent } from 'lucide-react';
import BarcodeScanner from '@/components/barcode-scanner';
import type { Product } from '@/services/backend';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface BarcodePromptDialogProps {
  products: Product[];
  onComplete: (updatedProducts: Product[] | null) => void;
}

type SalePriceMethod = 'manual' | 'percentage';

const BarcodePromptDialog: React.FC<BarcodePromptDialogProps> = ({ products, onComplete }) => {
  const [promptedProducts, setPromptedProducts] = useState<Product[]>(
    products.map(p => ({
      ...p,
      barcode: p.barcode || '',
      salePrice: p.salePrice === undefined ? undefined : p.salePrice,
    }))
  );
  const [currentScanningProductId, setCurrentScanningProductId] = useState<string | null>(null);
  const [locallyConfirmedProducts, setLocallyConfirmedProducts] = useState<Product[]>([]);
  const [salePriceMethods, setSalePriceMethods] = useState<Record<string, SalePriceMethod>>(
    products.reduce((acc, p) => {
      acc[p.id] = 'manual';
      return acc;
    }, {} as Record<string, SalePriceMethod>)
  );
  const [profitPercentages, setProfitPercentages] = useState<Record<string, string>>(
     products.reduce((acc, p) => {
      acc[p.id] = ''; // Initialize with empty string for percentage input
      return acc;
    }, {} as Record<string, string>)
  );


  const handleInputChange = (productId: string, field: keyof Product, value: string) => {
    setPromptedProducts(prev =>
      prev.map(p => {
        if (p.id === productId) {
          if (field === 'salePrice') {
            const numericValue = parseFloat(value);
            // For manual input, allow empty to represent undefined for now, will validate on confirm
            return { ...p, [field]: value.trim() === '' ? undefined : (isNaN(numericValue) || numericValue < 0 ? undefined : numericValue) };
          }
          return { ...p, [field]: value.trim() };
        }
        return p;
      })
    );
  };

  const handleProfitPercentageChange = (productId: string, value: string) => {
    setProfitPercentages(prev => ({ ...prev, [productId]: value }));
    const percentage = parseFloat(value);
    const product = promptedProducts.find(p => p.id === productId);
    if (product && product.unitPrice && !isNaN(percentage) && percentage >= 0) {
      const calculatedSalePrice = parseFloat((product.unitPrice * (1 + percentage / 100)).toFixed(2));
      setPromptedProducts(prev =>
        prev.map(p => (p.id === productId ? { ...p, salePrice: calculatedSalePrice } : p))
      );
    } else if (product && value.trim() === '') { // Clear sale price if percentage is cleared
        setPromptedProducts(prev =>
            prev.map(p => (p.id === productId ? { ...p, salePrice: undefined } : p))
        );
    }
  };

  const handleSalePriceMethodChange = (productId: string, method: SalePriceMethod) => {
    setSalePriceMethods(prev => ({ ...prev, [productId]: method }));
    if (method === 'manual') {
      // Optionally clear percentage or reset salePrice if switching to manual
      // setProfitPercentages(prev => ({ ...prev, [productId]: '' }));
      // setPromptedProducts(prev => prev.map(p => p.id === productId ? {...p, salePrice: undefined} : p));
    } else {
        // If switching to percentage, recalculate based on current percentage if any
        const product = promptedProducts.find(p => p.id === productId);
        const percentageStr = profitPercentages[productId];
        if(product && product.unitPrice && percentageStr){
            const percentage = parseFloat(percentageStr);
             if (!isNaN(percentage) && percentage >= 0) {
                const calculatedSalePrice = parseFloat((product.unitPrice * (1 + percentage / 100)).toFixed(2));
                setPromptedProducts(prev =>
                    prev.map(p => (p.id === productId ? { ...p, salePrice: calculatedSalePrice } : p))
                );
            }
        }
    }
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

  const handleSaveAll = () => {
    const productsToValidate = [...promptedProducts];
    const productsWithMissingSalePrice = productsToValidate.filter(
      p => p.salePrice === undefined || p.salePrice === null || isNaN(Number(p.salePrice)) || Number(p.salePrice) <= 0
    );

    if (productsWithMissingSalePrice.length > 0) {
      toast({
        title: "Missing Sale Price",
        description: `Please enter a valid sale price for all remaining new products: ${productsWithMissingSalePrice.map(p=> p.shortName || p.catalogNumber).join(', ')}. Or confirm them individually.`,
        variant: "destructive",
        duration: 7000,
      });
      return;
    }
    onComplete([...locallyConfirmedProducts, ...productsToValidate]);
  };

  const handleCancel = () => {
    onComplete(null);
  };


  const handleConfirmProduct = useCallback((productId: string) => {
    const productToConfirm = promptedProducts.find(p => p.id === productId);
    if (!productToConfirm) return;

    if (productToConfirm.salePrice === undefined || productToConfirm.salePrice === null || isNaN(Number(productToConfirm.salePrice)) || Number(productToConfirm.salePrice) <= 0) {
        toast({
            title: "Missing Sale Price",
            description: `Please enter a valid sale price for "${productToConfirm.shortName || productToConfirm.description}".`,
            variant: "destructive",
        });
        return;
    }

    setLocallyConfirmedProducts(prev => [...prev, productToConfirm]);
    setPromptedProducts(prev => prev.filter(p => p.id !== productId));
    toast({
        title: "Product Confirmed",
        description: `Details for "${productToConfirm.shortName || productToConfirm.description}" confirmed.`,
        variant: "default"
    });

  }, [promptedProducts]);


  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-md md:max-w-lg max-h-[90vh] sm:max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-4 sm:p-6 border-b shrink-0">
          <DialogTitle>New Product Details</DialogTitle>
          <DialogDescription>
            Enter details for new products. Barcode is optional, Sale Price is required. Click "Confirm &amp; Save All" when done, or confirm items individually.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-grow border-b">
          <div className={cn("space-y-6 p-4 sm:p-6", promptedProducts.length === 0 && locallyConfirmedProducts.length === 0 && "flex justify-center items-center h-full")}>
             {promptedProducts.length === 0 && locallyConfirmedProducts.length === 0 && (
                <p className="text-muted-foreground text-center py-4">No new products to assign details.</p>
             )}
             {promptedProducts.length === 0 && locallyConfirmedProducts.length > 0 && (
                <p className="text-muted-foreground text-center py-4">All new products have been processed. Click "Confirm & Save All" to finish.</p>
             )}
             {promptedProducts.map((product) => (
               <div key={product.id} className="space-y-3 border-b pb-4 last:border-b-0">
                 <Label className="font-medium text-base">
                   {product.shortName || product.description}
                 </Label>
                 <p className="text-xs text-muted-foreground">
                   Catalog: {product.catalogNumber || 'N/A'} | Qty: {product.quantity} | Cost: ₪{product.unitPrice.toFixed(2)}
                 </p>
                 
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
                
                <div className="space-y-2">
                    <Label className="text-sm">Sale Price Method <span className="text-destructive">*</span></Label>
                    <RadioGroup
                        value={salePriceMethods[product.id]}
                        onValueChange={(value) => handleSalePriceMethodChange(product.id, value as SalePriceMethod)}
                        className="flex gap-4"
                    >
                        <div className="flex items-center space-x-2">
                        <RadioGroupItem value="manual" id={`manual-${product.id}`} />
                        <Label htmlFor={`manual-${product.id}`} className="text-xs font-normal">Manual Price</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                        <RadioGroupItem value="percentage" id={`percentage-${product.id}`} />
                        <Label htmlFor={`percentage-${product.id}`} className="text-xs font-normal">Profit %</Label>
                        </div>
                    </RadioGroup>
                </div>

                {salePriceMethods[product.id] === 'manual' && (
                    <div>
                        <Label htmlFor={`salePrice-${product.id}`} className="text-sm">
                            Sale Price (₪) <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative mt-1">
                            <Input
                                id={`salePrice-${product.id}`}
                                type="number"
                                value={product.salePrice === undefined ? '' : String(product.salePrice)}
                                onChange={(e) => handleInputChange(product.id, 'salePrice', e.target.value)}
                                placeholder="Enter sale price"
                                min="0.01"
                                step="0.01"
                                className="pl-3" // No icon, so pl-3 is fine
                                aria-label={`Sale price for ${product.shortName || product.description}`}
                                required
                            />
                        </div>
                    </div>
                )}

                {salePriceMethods[product.id] === 'percentage' && (
                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div>
                        <Label htmlFor={`profitPercentage-${product.id}`} className="text-sm">
                            Profit Margin (%) <span className="text-destructive">*</span>
                        </Label>
                         <div className="relative mt-1">
                            <Input
                                id={`profitPercentage-${product.id}`}
                                type="number"
                                value={profitPercentages[product.id]}
                                onChange={(e) => handleProfitPercentageChange(product.id, e.target.value)}
                                placeholder="e.g., 25"
                                min="0"
                                step="0.1"
                                className="pl-3"
                                aria-label={`Profit percentage for ${product.shortName || product.description}`}
                                required
                            />
                            <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        </div>
                    </div>
                     <div>
                        <Label className="text-sm">Calculated Sale Price (₪)</Label>
                        <Input
                            type="text"
                            value={product.salePrice === undefined ? 'N/A' : `₪${product.salePrice.toFixed(2)}`}
                            readOnly
                            disabled
                            className="mt-1 bg-muted/50 pl-3"
                            aria-label={`Calculated sale price for ${product.shortName || product.description}`}
                        />
                    </div>
                  </div>
                )}

                  <div className="flex items-center gap-2 mt-3">
                      <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => handleConfirmProduct(product.id)}
                          className="text-xs h-8 px-2 flex-1 bg-green-600 hover:bg-green-700 text-white"
                          title={`Confirm details for ${product.shortName || product.description}`}
                          aria-label={`Confirm details for ${product.shortName || product.description}`}
                          >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Confirm This Product
                      </Button>
                  </div>
               </div>
             ))}
          </div>
        </ScrollArea>

        <DialogFooter className="p-4 sm:p-6 border-t flex-col sm:flex-row gap-2 shrink-0">
          <Button variant="outline" onClick={handleCancel} className="w-full sm:w-auto">
            <X className="mr-2 h-4 w-4" /> Cancel Save Process
          </Button>
          <Button onClick={handleSaveAll} className="w-full sm:w-auto" disabled={promptedProducts.length === 0 && locallyConfirmedProducts.length === 0}>
            <Save className="mr-2 h-4 w-4" /> Confirm &amp; Save All
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

