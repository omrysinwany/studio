
'use client';

import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area'; // Import ScrollArea
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
    // Pass back the products as they are (some might have barcodes, some might not)
    onComplete(updatedProducts);
  };

  const handleCancel = () => {
    onComplete(null); // Indicate cancellation
  };

  // Function to skip adding barcode for a specific product
  const handleSkipProduct = (productId: string) => {
     // Set barcode to empty string or keep undefined
     // Setting to empty string makes it clear in the input field
     handleBarcodeChange(productId, '');
     console.log(`Skipping barcode entry for product ID: ${productId}`);
     // Optionally, visually indicate skipped state, though Input just becomes empty
  };


  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCancel()}>
      {/* Adjust content styling for better mobile experience */}
      {/* Added max-h and flex structure */}
      <DialogContent className="sm:max-w-md md:max-w-lg max-h-[90vh] sm:max-h-[80vh] flex flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Assign Barcodes (Optional)</DialogTitle>
          <DialogDescription>
            Assign barcodes to new products. You can scan, enter manually, or skip. Click "Confirm & Save" when done.
          </DialogDescription>
        </DialogHeader>

        {/* Wrap product list in ScrollArea */}
        <ScrollArea className="flex-grow -mx-4 sm:-mx-6 px-4 sm:px-6"> {/* Adjust padding */}
          <div className="space-y-4 py-4">
            {updatedProducts.map((product) => (
              <div key={product.id} className="space-y-2 border-b pb-4 last:border-b-0">
                <Label htmlFor={`barcode-${product.id}`} className="font-medium">
                  {product.shortName || product.description}
                </Label>
                <p className="text-xs text-muted-foreground">
                  Catalog: {product.catalogNumber || 'N/A'} | Qty: {product.quantity}
                </p>
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap"> {/* Wrap on small screens */}
                  <Input
                    id={`barcode-${product.id}`}
                    value={product.barcode || ''}
                    onChange={(e) => handleBarcodeChange(product.id, e.target.value)}
                    placeholder="Enter or scan barcode"
                    className="flex-grow min-w-[150px]" // Allow input to grow
                  />
                  <div className="flex gap-1 shrink-0"> {/* Keep buttons together */}
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleScanClick(product.id)}
                        className="h-9 w-9" // Standard icon button size
                      >
                        <Camera className="h-4 w-4" />
                        <span className="sr-only">Scan Barcode</span>
                      </Button>
                       {/* Skip Button per product */}
                       <Button
                         type="button"
                         variant="ghost"
                         size="sm"
                         onClick={() => handleSkipProduct(product.id)} // Attach handler
                         className="text-xs text-muted-foreground h-9 px-2" // Align height
                         title="Skip barcode for this item"
                       >
                         <SkipForward className="h-4 w-4 sm:mr-1" /> {/* Icon only on mobile */}
                         <span className="hidden sm:inline">Skip</span>
                       </Button>
                   </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Ensure footer is fixed at the bottom */}
        <DialogFooter className="mt-auto pt-4 border-t flex-col sm:flex-row gap-2"> {/* Flex column on mobile */}
          <Button variant="outline" onClick={handleCancel} className="w-full sm:w-auto">
            <X className="mr-2 h-4 w-4" /> Cancel Save
          </Button>
          {/* Save button allows saving even without barcodes assigned */}
          <Button onClick={handleSave} className="w-full sm:w-auto">
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


    