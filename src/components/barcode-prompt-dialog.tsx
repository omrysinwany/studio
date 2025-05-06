'use client';

import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Camera, Save, SkipForward, X } from 'lucide-react';
import BarcodeScanner from '@/components/barcode-scanner'; // Import the scanner component
import type { Product } from '@/services/backend'; // Import Product type

interface BarcodePromptDialogProps {
  products: Product[]; // Products needing barcode assignment
  onComplete: (updatedProducts: Product[] | null) => void; // Callback with updated products or null if cancelled
}

const BarcodePromptDialog: React.FC<BarcodePromptDialogProps> = ({ products, onComplete }) => {
  const [updatedProducts, setUpdatedProducts] = useState<Product[]>(
    // Initialize state with products passed in
    products.map(p => ({ ...p }))
  );
  const [currentScanningProductId, setCurrentScanningProductId] = useState<string | null>(null);

  const handleBarcodeChange = (productId: string, barcode: string) => {
    setUpdatedProducts(prev =>
      prev.map(p => (p.id === productId ? { ...p, barcode: barcode.trim() } : p))
    );
  };

  const handleScanClick = (productId: string) => {
    setCurrentScanningProductId(productId);
  };

  const handleBarcodeDetected = useCallback((barcodeValue: string) => {
    if (currentScanningProductId) {
      handleBarcodeChange(currentScanningProductId, barcodeValue);
    }
    setCurrentScanningProductId(null); // Close scanner after detection
  }, [currentScanningProductId]);

  const handleScannerClose = () => {
    setCurrentScanningProductId(null);
  };

  const handleSave = () => {
    onComplete(updatedProducts);
  };

  const handleCancel = () => {
    onComplete(null); // Indicate cancellation
  };

  // Optional: Handle skipping a single product
  const handleSkipProduct = (productId: string) => {
     // Mark the product somehow if needed (e.g., set barcode to empty string explicitly),
     // or simply proceed without a barcode for this one.
     // For simplicity, let's just keep the barcode undefined/empty.
     // You might want to filter this out before calling onComplete if skipped products shouldn't be saved.
     console.log(`Skipping barcode entry for product ID: ${productId}`);
     // For now, we just move on. The save function will handle products without barcodes.
     // If you need specific "skip" logic, implement it here.
  };


  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-md md:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Assign Barcodes to New Products</DialogTitle>
          <DialogDescription>
            Some new products were found without barcodes. Please assign them below, or skip.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-grow pr-6 -mr-6"> {/* Add padding for scrollbar */}
          <div className="space-y-4 py-4">
            {updatedProducts.map((product) => (
              <div key={product.id} className="space-y-2 border-b pb-4 last:border-b-0">
                <Label htmlFor={`barcode-${product.id}`} className="font-medium">
                  {product.shortName || product.description}
                </Label>
                <p className="text-xs text-muted-foreground">
                  Catalog: {product.catalogNumber || 'N/A'} | Qty: {product.quantity}
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    id={`barcode-${product.id}`}
                    value={product.barcode || ''}
                    onChange={(e) => handleBarcodeChange(product.id, e.target.value)}
                    placeholder="Enter or scan barcode"
                    className="flex-grow"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => handleScanClick(product.id)}
                    className="shrink-0"
                  >
                    <Camera className="h-4 w-4" />
                    <span className="sr-only">Scan Barcode</span>
                  </Button>
                   {/* Optional Skip Button per product */}
                   {/* <Button
                     type="button"
                     variant="ghost"
                     size="sm"
                     onClick={() => handleSkipProduct(product.id)}
                     className="text-xs text-muted-foreground"
                   >
                     Skip
                   </Button> */}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-auto pt-4 border-t">
          <Button variant="outline" onClick={handleCancel}>
            <X className="mr-2 h-4 w-4" /> Cancel Save
          </Button>
          <Button onClick={handleSave}>
            <Save className="mr-2 h-4 w-4" /> Confirm & Save All
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Render the scanner modal conditionally */}
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
