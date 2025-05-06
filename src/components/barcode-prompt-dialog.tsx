
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
import { toast } from '@/hooks/use-toast'; // Import toast for feedback
import { cn } from '@/lib/utils'; // Import cn for conditional styling

interface BarcodePromptDialogProps {
  products: Product[]; // Products needing barcode assignment
  onComplete: (updatedProducts: Product[] | null) => void; // Callback with updated products or null if cancelled
}

const BarcodePromptDialog: React.FC<BarcodePromptDialogProps> = ({ products, onComplete }) => {
  const [promptedProducts, setPromptedProducts] = useState<Product[]>(
    // Initialize state with products passed in for the prompt
    products.map(p => ({ ...p }))
  );
  const [currentScanningProductId, setCurrentScanningProductId] = useState<string | null>(null);

  const handleBarcodeChange = (productId: string, barcode: string) => {
    setPromptedProducts(prev =>
      prev.map(p => (p.id === productId ? { ...p, barcode: barcode.trim() } : p))
    );
  };

  const handleScanClick = (productId: string) => {
    setCurrentScanningProductId(productId);
  };

  const handleBarcodeDetected = useCallback((barcodeValue: string) => {
    if (currentScanningProductId) {
      handleBarcodeChange(currentScanningProductId, barcodeValue);
      toast({
        title: "Barcode Scanned",
        description: `Barcode ${barcodeValue} assigned.`,
      });
    }
    setCurrentScanningProductId(null); // Close scanner after detection
  }, [currentScanningProductId, toast]); // Added toast dependency

  const handleScannerClose = () => {
    setCurrentScanningProductId(null);
  };

  const handleSave = () => {
    // Pass back the products that were prompted (some might have barcodes, some might not)
    onComplete(promptedProducts);
  };

  const handleCancel = () => {
    onComplete(null); // Indicate cancellation
  };

  // Function to skip adding barcode for a specific product by removing it from the prompt list
  const handleSkipProduct = useCallback((productId: string) => {
     const skippedProduct = promptedProducts.find(p => p.id === productId);
     if (skippedProduct) {
         console.log(`Skipping barcode entry for product ID: ${productId}`);
         // Correctly update the state by filtering out the skipped product
         setPromptedProducts(prev => prev.filter(p => p.id !== productId));
         toast({
             title: "Product Skipped",
             description: `Barcode assignment skipped for "${skippedProduct.shortName || skippedProduct.description || 'Product'}".`,
             variant: "default",
         });
     } else {
         console.warn(`Could not find product with ID ${productId} to skip.`);
     }
  }, [promptedProducts, toast]); // Add promptedProducts and toast to dependency array


  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-md md:max-w-lg max-h-[90vh] sm:max-h-[80vh] flex flex-col p-0 sm:p-0"> {/* Remove padding */}
        <DialogHeader className="p-4 sm:p-6 border-b"> {/* Add padding back */}
          <DialogTitle>Assign Barcodes (Optional)</DialogTitle>
          <DialogDescription>
            Assign barcodes to new products. You can scan, enter manually, or skip. Click "Confirm &amp; Save" when done.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-grow border-b"> {/* Scroll area takes remaining space */}
          <div className={cn("space-y-4 p-4 sm:p-6", promptedProducts.length === 0 && "flex justify-center items-center h-full")}> {/* Padding inside scroll area, center content if empty */}
             {promptedProducts.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No new products remaining to assign barcodes.</p>
             ) : (
                promptedProducts.map((product) => (
                  <div key={product.id} className="space-y-2 border-b pb-4 last:border-b-0">
                    <Label htmlFor={`barcode-${product.id}`} className="font-medium">
                      {product.shortName || product.description}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Catalog: {product.catalogNumber || 'N/A'} | Qty: {product.quantity}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <Input
                        id={`barcode-${product.id}`}
                        value={product.barcode || ''}
                        onChange={(e) => handleBarcodeChange(product.id, e.target.value)}
                        placeholder="Enter or scan barcode"
                        className="flex-grow min-w-[150px]"
                        aria-label={`Barcode for ${product.shortName || product.description}`}
                      />
                      <div className="flex gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => handleScanClick(product.id)}
                            className="h-9 w-9"
                            aria-label={`Scan barcode for ${product.shortName || product.description}`}
                          >
                            <Camera className="h-4 w-4" />
                          </Button>
                           {/* Skip Button per product */}
                           <Button
                             type="button"
                             variant="ghost"
                             size="sm"
                             onClick={() => handleSkipProduct(product.id)} // Attach handler
                             className="text-xs text-muted-foreground h-9 px-2"
                             title={`Skip barcode for ${product.shortName || product.description}`}
                             aria-label={`Skip barcode for ${product.shortName || product.description}`}
                           >
                             <SkipForward className="h-4 w-4 sm:mr-1" />
                             <span className="hidden sm:inline">Skip</span>
                           </Button>
                       </div>
                    </div>
                  </div>
                ))
             )}
          </div>
        </ScrollArea>

        <DialogFooter className="p-4 sm:p-6 border-t flex-col sm:flex-row gap-2"> {/* Add padding back */}
          <Button variant="outline" onClick={handleCancel} className="w-full sm:w-auto">
            <X className="mr-2 h-4 w-4" /> Cancel Save
          </Button>
          <Button onClick={handleSave} className="w-full sm:w-auto">
            <Save className="mr-2 h-4 w-4" /> Confirm &amp; Save
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
      
    