
'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Camera, Save, X, CheckCircle, Percent, PackagePlus, Trash2 } from 'lucide-react';
import BarcodeScanner from '@/components/barcode-scanner';
import type { Product } from '@/services/backend';
import { toast } from '@/hooks/use-toast';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface BarcodePromptDialogProps {
  products: Product[];
  onComplete: (updatedProducts: Product[] | null) => void;
}

type SalePriceMethod = 'manual' | 'percentage';

interface ProductInputState {
  barcode: string;
  salePrice?: number;
  salePriceMethod: SalePriceMethod;
  profitPercentage: string;
}

const BarcodePromptDialog: React.FC<BarcodePromptDialogProps> = ({
  products: initialProductsFromProps,
  onComplete,
}) => {
  // Use a state for initialProducts to handle potential updates from parent if necessary,
  // though for this dialog, it's typically a one-time pass.
  const [initialProducts, setInitialProducts] = useState<Product[]>([...initialProductsFromProps]);
  const [productsToDisplay, setProductsToDisplay] = useState<Product[]>([...initialProductsFromProps]);
  const [productInputStates, setProductInputStates] = useState<Record<string, ProductInputState>>(
    initialProductsFromProps.reduce((acc, p) => {
      acc[p.id] = {
        barcode: p.barcode || '',
        salePrice: p.salePrice,
        salePriceMethod: p.salePrice !== undefined ? 'manual' : 'percentage',
        profitPercentage: '',
      };
      return acc;
    }, {} as Record<string, ProductInputState>)
  );
  const [skippedProductIds, setSkippedProductIds] = useState<Set<string>>(new Set());
  const [currentScanningProductId, setCurrentScanningProductId] = useState<string | null>(null);

  const handleInputChange = useCallback((productId: string, field: keyof ProductInputState, value: string | number | SalePriceMethod) => {
    setProductInputStates(prevStates => {
      const product = productsToDisplay.find(p => p.id === productId) || initialProducts.find(p => p.id === productId);
      if (!product) return prevStates;

      const currentState = { ...prevStates[productId] };

      if (field === 'salePrice') {
        const numericValue = parseFloat(String(value));
        currentState.salePrice = String(value).trim() === '' ? undefined : (isNaN(numericValue) || numericValue <= 0 ? undefined : numericValue);
      } else if (field === 'barcode' || field === 'profitPercentage') {
        currentState[field as 'barcode' | 'profitPercentage'] = String(value);
      } else if (field === 'salePriceMethod') {
        currentState.salePriceMethod = value as SalePriceMethod;
      }

      // Auto-calculate sale price if method is percentage
      if (currentState.salePriceMethod === 'percentage') {
        const percentageStr = currentState.profitPercentage;
        if (product.unitPrice && percentageStr) {
          const percentage = parseFloat(percentageStr);
          if (!isNaN(percentage) && percentage >= 0) {
            currentState.salePrice = parseFloat((product.unitPrice * (1 + percentage / 100)).toFixed(2));
          } else if (percentageStr.trim() === '') {
            currentState.salePrice = undefined; // Clear sale price if percentage is cleared
          }
        } else {
          currentState.salePrice = undefined; // Clear if no unit price or percentage
        }
      }
      return { ...prevStates, [productId]: currentState };
    });
  }, [productsToDisplay, initialProducts]);


  const handleSalePriceMethodChange = useCallback((productId: string, method: SalePriceMethod) => {
    handleInputChange(productId, 'salePriceMethod', method);
  }, [handleInputChange]);


  const handleScanClick = (productId: string) => setCurrentScanningProductId(productId);
  const handleScannerClose = () => setCurrentScanningProductId(null);

  const handleBarcodeDetected = useCallback((barcodeValue: string) => {
    if (currentScanningProductId) {
      handleInputChange(currentScanningProductId, 'barcode', barcodeValue);
      toast({ title: 'Barcode Scanned', description: `Barcode ${barcodeValue} assigned.` });
    }
    setCurrentScanningProductId(null);
  }, [currentScanningProductId, handleInputChange]);


  const validateProductInputs = (productId: string): boolean => {
    const state = productInputStates[productId];
    const product = initialProducts.find(p => p.id === productId);

    if (!state || !product) return false; // Should not happen

    if (state.salePrice === undefined || state.salePrice === null || isNaN(Number(state.salePrice)) || Number(state.salePrice) <= 0) {
      toast({
        title: 'Missing or Invalid Sale Price',
        description: `Please enter a valid, positive sale price for "${product.shortName || product.description}".`,
        variant: 'destructive',
      });
      return false;
    }
    return true;
  };

  const handleConfirmAndRemoveProduct = useCallback((productId: string) => {
    if (!validateProductInputs(productId)) return;

    setProductsToDisplay(prev => prev.filter(p => p.id !== productId));
    const product = initialProducts.find(p => p.id === productId);
    toast({
      title: 'Details Set',
      description: `Details for "${product?.shortName || product?.description}" are ready.`,
    });
  }, [productInputStates, initialProducts]);


  const handleSkipProduct = useCallback((productId: string) => {
    setSkippedProductIds(prev => new Set(prev).add(productId));
    setProductsToDisplay(prev => prev.filter(p => p.id !== productId));
    const product = initialProducts.find(p => p.id === productId);
    toast({
      title: 'Product Skipped',
      description: `"${product?.shortName || product?.description}" will not be added with new details.`,
    });
  }, [initialProducts]);


  const handleSaveAllAndContinue = () => {
    // Validate any remaining products in the display list
    for (const product of productsToDisplay) {
      if (!validateProductInputs(product.id)) {
        toast({
          title: 'Incomplete Details',
          description: `Please ensure all remaining products (like "${product.shortName || product.description}") have a valid sale price, or confirm each one individually.`,
          variant: 'destructive',
          duration: 7000,
        });
        return; // Stop if any displayed product is invalid
      }
    }

    // Construct the final list of products to return
    const productsToReturn: Product[] = initialProducts
      .filter(p => !skippedProductIds.has(p.id)) // Exclude skipped products
      .map(p => {
        const inputs = productInputStates[p.id];
        return {
          ...p,
          barcode: inputs.barcode || undefined,
          salePrice: inputs.salePrice,
        };
      });

    onComplete(productsToReturn);
  };

  const handleCancel = () => onComplete(null);

  const processedCount = initialProducts.length - productsToDisplay.length - skippedProductIds.size;
  const remainingToProcessCount = productsToDisplay.length;


  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="max-w-xl w-[95vw] sm:max-w-2xl md:max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-4 sm:p-6 border-b shrink-0">
          <DialogTitle className="flex items-center text-lg sm:text-xl">
            <PackagePlus className="mr-2 h-5 w-5 text-primary" />
            Assign Details to New Products
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            For each new product, provide a sale price. Barcode is optional. Confirm or skip each item.
            {productsToDisplay.length > 0 ? ` (${productsToDisplay.length} remaining to review).` : ' All products reviewed.'}
          </DialogDescription>
        </DialogHeader>

        {productsToDisplay.length === 0 ? (
          <div className="flex-grow flex flex-col items-center justify-center p-6 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
            <p className="text-lg font-medium">All new products reviewed!</p>
            <p className="text-sm text-muted-foreground">
              Click "Save All & Continue" to finalize.
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-grow border-b flex-shrink min-h-0">
            <div className="p-3 sm:p-4 space-y-4">
              {productsToDisplay.map((product) => {
                const state = productInputStates[product.id];
                if (!state) return null; // Should ideally not happen

                return (
                  <Card key={product.id} className="bg-card shadow-sm">
                    <CardHeader className="p-3 sm:p-4 pb-2 sm:pb-3">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-grow">
                          <CardTitle className="text-base sm:text-lg font-semibold leading-tight">
                            {product.shortName || product.description}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Catalog: {product.catalogNumber || 'N/A'} | Qty:{' '}
                            {product.quantity} | Cost:{' '}
                            {product.unitPrice !== undefined ? `₪${product.unitPrice.toFixed(2)}` : 'N/A'}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleSkipProduct(product.id)}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                          aria-label={`Skip product ${product.shortName || product.description}`}
                          title="Skip this product"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
                      <Separator className="my-2" />
                      <div>
                        <Label htmlFor={`barcode-${product.id}`} className="text-xs sm:text-sm font-medium">
                          Barcode (Optional)
                        </Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            id={`barcode-${product.id}`}
                            value={state.barcode}
                            onChange={(e) => handleInputChange(product.id, 'barcode', e.target.value)}
                            placeholder="Enter or scan barcode"
                            className="h-9 text-sm"
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

                      <div className="space-y-1">
                        <Label className="text-xs sm:text-sm font-medium">Sale Price Method <span className="text-destructive">*</span></Label>
                        <RadioGroup
                          value={state.salePriceMethod}
                          onValueChange={(value) => handleSalePriceMethodChange(product.id, value as SalePriceMethod)}
                          className="flex gap-3 sm:gap-4 pt-1"
                        >
                          <div className="flex items-center space-x-1.5">
                            <RadioGroupItem value="manual" id={`manual-${product.id}`} />
                            <Label htmlFor={`manual-${product.id}`} className="text-xs sm:text-sm font-normal cursor-pointer">Manual Entry</Label>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <RadioGroupItem value="percentage" id={`percentage-${product.id}`} />
                            <Label htmlFor={`percentage-${product.id}`} className="text-xs sm:text-sm font-normal cursor-pointer">Profit %</Label>
                          </div>
                        </RadioGroup>
                      </div>

                      {state.salePriceMethod === 'manual' && (
                        <div>
                          <Label htmlFor={`salePrice-${product.id}`} className="text-xs sm:text-sm font-medium">
                            Sale Price (₪) <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id={`salePrice-${product.id}`}
                            type="number"
                            value={state.salePrice === undefined ? '' : String(state.salePrice)}
                            onChange={(e) => handleInputChange(product.id, 'salePrice', e.target.value)}
                            placeholder="e.g. 25.99"
                            min="0.01"
                            step="0.01"
                            className="h-9 text-sm mt-1"
                            aria-label={`Sale price for ${product.shortName || product.description}`}
                            required
                          />
                        </div>
                      )}

                      {state.salePriceMethod === 'percentage' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 items-end">
                          <div>
                            <Label htmlFor={`profitPercentage-${product.id}`} className="text-xs sm:text-sm font-medium">
                              Profit Margin (%) <span className="text-destructive">*</span>
                            </Label>
                            <div className="relative mt-1">
                              <Input
                                id={`profitPercentage-${product.id}`}
                                type="number"
                                value={state.profitPercentage}
                                onChange={(e) => handleInputChange(product.id, 'profitPercentage', e.target.value)}
                                placeholder="e.g., 25"
                                min="0"
                                step="0.1"
                                className="h-9 text-sm pl-3 pr-7"
                                aria-label={`Profit percentage for ${product.shortName || product.description}`}
                                required
                              />
                              <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs sm:text-sm font-medium">Calculated Sale Price</Label>
                            <Input
                              type="text"
                              value={state.salePrice === undefined ? 'N/A' : `₪${state.salePrice.toFixed(2)}`}
                              readOnly
                              disabled
                              className="h-9 text-sm mt-1 bg-muted/50"
                              aria-label={`Calculated sale price for ${product.shortName || product.description}`}
                            />
                          </div>
                        </div>
                      )}
                      <div className="pt-2">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => handleConfirmAndRemoveProduct(product.id)}
                          className="w-full text-xs sm:text-sm h-9 bg-primary hover:bg-primary/90"
                        >
                          <CheckCircle className="mr-1.5 h-4 w-4" />
                          Confirm Details for This Product
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="p-3 sm:p-4 border-t flex flex-col sm:flex-row gap-2 shrink-0">
          <Button variant="outline" onClick={handleCancel} className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
            <X className="mr-1.5 h-4 w-4" /> Cancel Save Process
          </Button>
          <Button
            onClick={handleSaveAllAndContinue}
            className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10 bg-accent hover:bg-accent/90"
            // Disable if there are products to display but something is invalid (this is handled inside the function now)
            // Or if there are no initial products (nothing to save).
            disabled={initialProducts.length === 0 && productsToDisplay.length === 0}
          >
            <Save className="mr-1.5 h-4 w-4" />
             Save All & Continue
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
