'use client';

import type { PosConnectionConfig } from './pos-integration/pos-adapter.interface';

export interface Product {
  id: string;
  catalogNumber: string;
  description: string;
  shortName?: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  salePrice?: number; 
  lineTotal: number;
  minStockLevel?: number;
  maxStockLevel?: number;
}

export interface InvoiceHistoryItem {
  id: string;
  fileName: string;
  uploadTime: Date | string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  invoiceNumber?: string;
  supplier?: string;
  totalAmount?: number;
  errorMessage?: string;
  invoiceDataUri?: string; // Added for displaying invoice image
}

// New interface for supplier summary data
export interface SupplierSummary {
  name: string;
  invoiceCount: number;
  totalSpent: number;
  // Placeholder for future contact info.
  // For now, we only have supplier name from invoices.
  // contactPerson?: string;
  // phone?: string;
  // email?: string;
}


const INVENTORY_STORAGE_KEY = 'mockInventoryData';
const INVOICES_STORAGE_KEY = 'mockInvoicesData';
const POS_SETTINGS_STORAGE_KEY = 'mockPosSettings';

const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';


const initialMockInventory: Product[] = [
   { id: 'prod1', catalogNumber: '12345', barcode: '7290012345011', description: 'Sample Product 1 (Mock)', shortName: 'Sample 1', quantity: 10, unitPrice: 9.99, salePrice: 12.99, lineTotal: 99.90, minStockLevel: 5, maxStockLevel: 20 },
   { id: 'prod2', catalogNumber: '67890', barcode: '7290067890012', description: 'Sample Product 2 (Mock)', shortName: 'Sample 2', quantity: 5, unitPrice: 19.99, salePrice: 24.99, lineTotal: 99.95, minStockLevel: 2, maxStockLevel: 10 },
   { id: 'prod3', catalogNumber: 'ABCDE', barcode: '72900ABCDE013', description: 'Another Mock Item', shortName: 'Another Mock', quantity: 25, unitPrice: 1.50, salePrice: 2.00, lineTotal: 37.50, minStockLevel: 10, maxStockLevel: 50 },
   { id: 'prod4', catalogNumber: 'LOW01', barcode: '72900LOW01014', description: 'Low Stock Mock', shortName: 'Low Stock', quantity: 8, unitPrice: 5.00, salePrice: 7.50, lineTotal: 40.00, minStockLevel: 10, maxStockLevel: 15 },
   { id: 'prod5', catalogNumber: 'OUT01', barcode: '72900OUT01015', description: 'Out of Stock Mock', shortName: 'Out Stock', quantity: 0, unitPrice: 12.00, salePrice: 15.00, lineTotal: 0.00, minStockLevel: 5, maxStockLevel: 10 },
];

const initialMockInvoices: InvoiceHistoryItem[] = [
  { id: 'inv1', fileName: 'invoice_acme_corp.pdf', uploadTime: new Date(Date.now() - 86400000 * 1).toISOString(), status: 'completed', invoiceNumber: 'INV-1001', supplier: 'Acme Corp', totalAmount: 1250.75, invoiceDataUri: 'https://picsum.photos/600/800?random=1' },
  { id: 'inv2', fileName: 'delivery_note_beta_inc.jpg', uploadTime: new Date(Date.now() - 86400000 * 3).toISOString(), status: 'completed', invoiceNumber: 'DN-0523', supplier: 'Beta Inc', totalAmount: 800.00, invoiceDataUri: 'https://picsum.photos/600/800?random=2' },
  { id: 'inv3', fileName: 'receipt_gamma_ltd.png', uploadTime: new Date(Date.now() - 86400000 * 5).toISOString(), status: 'error', errorMessage: 'Failed to extract totals', invoiceDataUri: 'https://picsum.photos/600/800?random=3' },
];

interface StoredPosSettings {
    systemId: string;
    config: PosConnectionConfig;
}


export interface ProductPriceDiscrepancy extends Product {
  existingUnitPrice: number;
  newUnitPrice: number;
}

export interface PriceCheckResult {
  productsToSaveDirectly: Product[];
  priceDiscrepancies: ProductPriceDiscrepancy[];
}


const getStoredData = <T extends {id?: string}>(key: string, initialData?: T[]): T[] => {
  if (typeof window === 'undefined') {
    return initialData || [];
  }
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsedData = JSON.parse(stored) as T[];
      // Ensure IDs for items that might not have one
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || `${key}-${Date.now()}-${index}` // Generate ID if missing
      }));
    } else if (initialData) {
       // Ensure IDs for initial data as well
       const dataWithIds = initialData.map((item, index) => ({
            ...item,
            id: item.id || `${key}-initial-${Date.now()}-${index}`
       }));
      localStorage.setItem(key, JSON.stringify(dataWithIds));
      return dataWithIds;
    }
    return [];
  } catch (error) {
    console.error(`Error reading ${key} from localStorage:`, error);
    return initialData || [];
  }
};

const getStoredObject = <T>(key: string, initialData?: T): T | null => {
    if (typeof window === 'undefined') {
        return initialData ?? null;
    }
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            return JSON.parse(stored);
        } else if (initialData) {
            localStorage.setItem(key, JSON.stringify(initialData));
            return initialData;
        }
        return null;
    } catch (error) {
        console.error(`Error reading object ${key} from localStorage:`, error);
        return initialData ?? null;
    }
};

const saveStoredData = <T>(key: string, data: T): void => {
  if (typeof window === 'undefined') {
    console.warn('localStorage is not available. Data not saved.');
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error(`Error writing ${key} to localStorage:`, error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.includes('exceeded the quota'))) {
        // Propagate the error so the caller can handle it (e.g., show a toast to the user)
        throw error; 
    }
  }
};


export interface DocumentProcessingResponse {
  products: Product[];
}


export async function checkProductPricesBeforeSaveService(
    productsToCheck: Product[],
    tempId?: string // This tempId seems related to invoice ID, not product ID
): Promise<PriceCheckResult> {
    console.log(`Checking product prices before save. Products to check:`, productsToCheck, `(tempId: ${tempId})`);
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate async operation

    const currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
    const productsToSaveDirectly: Product[] = [];
    const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

    productsToCheck.forEach(scannedProduct => {
        // Ensure numeric values for calculation
        const quantityFromScan = parseFloat(String(scannedProduct.quantity)) || 0;
        const lineTotalFromScan = parseFloat(String(scannedProduct.lineTotal)) || 0;
        let unitPriceFromScan = parseFloat(String(scannedProduct.unitPrice)) || 0;

        // Recalculate unit price if it's 0 but quantity and line total are present
        if (unitPriceFromScan === 0 && quantityFromScan !== 0 && lineTotalFromScan !== 0) {
            unitPriceFromScan = parseFloat((lineTotalFromScan / quantityFromScan).toFixed(2));
        }

        // Try to find existing product by barcode, then by ID (if not new), then by catalog number
        let existingIndex = -1;
        if (scannedProduct.barcode && scannedProduct.barcode.trim() !== '') {
            existingIndex = currentInventory.findIndex(p => p.barcode === scannedProduct.barcode);
        }
        if (existingIndex === -1 && scannedProduct.id && !scannedProduct.id.includes('-new') && scannedProduct.id !== tempId) { // tempId comparison seems incorrect for product matching
            existingIndex = currentInventory.findIndex(p => p.id === scannedProduct.id);
        }
        if (existingIndex === -1 && scannedProduct.catalogNumber && scannedProduct.catalogNumber !== 'N/A') {
            existingIndex = currentInventory.findIndex(p => p.catalogNumber === scannedProduct.catalogNumber);
        }


        if (existingIndex !== -1) {
            const existingProduct = currentInventory[existingIndex];
            const existingUnitPrice = existingProduct.unitPrice; // This is the current cost price

            // Compare the scanned unit price (which is a cost price from invoice) with existing cost price
            if (unitPriceFromScan !== 0 && Math.abs(existingUnitPrice - unitPriceFromScan) > 0.001) { // Use a small epsilon for float comparison
                console.log(`Price discrepancy found for product ID ${existingProduct.id}. Existing: ${existingUnitPrice}, New: ${unitPriceFromScan}`);
                priceDiscrepancies.push({
                    ...scannedProduct, // Pass all details from the scanned product
                    id: existingProduct.id, // Crucially, use the ID of the *existing* product
                    existingUnitPrice: existingUnitPrice,
                    newUnitPrice: unitPriceFromScan,
                });
            } else {
                // No significant price change, or scanned price is 0 (so we keep old)
                productsToSaveDirectly.push({
                    ...scannedProduct, // Pass all details from the scanned product
                    id: existingProduct.id, // Use existing product ID
                    unitPrice: existingUnitPrice // Keep the existing unit price
                });
            }
        } else {
            // New product, save directly (price will be what was scanned/calculated)
            productsToSaveDirectly.push(scannedProduct);
        }
    });

    console.log("Price check complete. Direct saves:", productsToSaveDirectly, "Discrepancies:", priceDiscrepancies);
    return { productsToSaveDirectly, priceDiscrepancies };
}


export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    fileName: string,
    source: string = 'upload', // e.g., 'upload', 'caspit_sync', 'hashavshevet_sync'
    tempInvoiceId?: string, // This ID is for the *invoice record*, not product ID
    invoiceDataUriToSave?: string,
    extractedInvoiceNumber?: string,
    extractedSupplierName?: string,
    extractedTotalAmount?: number
): Promise<void> {
    console.log(`Finalizing save for products: ${fileName} (source: ${source}, tempInvoiceId: ${tempInvoiceId}) Image URI to save: ${invoiceDataUriToSave ? 'Exists' : 'Does not exist'}`, productsToFinalizeSave);
    console.log(`Extracted Invoice Details: Number=${extractedInvoiceNumber}, Supplier=${extractedSupplierName}, Total=${extractedTotalAmount}`);
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async operation

    let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
    let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);

    let calculatedInvoiceTotalAmountFromProducts = 0;
    let productsProcessedSuccessfully = true;
    
    try {
        const updatedInventory = [...currentInventory];

        productsToFinalizeSave.forEach(productToSave => {
            // Ensure numeric values for calculation
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            const unitPrice = parseFloat(String(productToSave.unitPrice)) || 0; // This is the confirmed unit (cost) price
            const salePrice = productToSave.salePrice !== undefined ? parseFloat(String(productToSave.salePrice)) : undefined;
            const lineTotal = parseFloat((quantityToAdd * unitPrice).toFixed(2)); // Recalculate line total based on confirmed unit price and quantity

            if (!isNaN(lineTotal)) {
                calculatedInvoiceTotalAmountFromProducts += lineTotal;
            } else {
                console.warn(`Invalid lineTotal for product: ${productToSave.id || productToSave.catalogNumber}. Skipping for invoice total.`);
            }

            // --- Product Matching Logic ---
            // 1. Use existing ID if provided and valid (not a '-new' placeholder)
            // 2. Fallback to barcode if ID isn't a match
            // 3. Fallback to catalog number if barcode isn't a match
            let existingIndex = -1;
            if (productToSave.id && !productToSave.id.includes('-new') && productToSave.id !== tempInvoiceId) { // tempInvoiceId check might be redundant for product ID
                existingIndex = updatedInventory.findIndex(p => p.id === productToSave.id);
            }
            // If not found by specific ID, try barcode (especially for products from sync or if ID was a placeholder)
            if (existingIndex === -1 && productToSave.barcode && productToSave.barcode.trim() !== '') {
                existingIndex = updatedInventory.findIndex(p => p.barcode === productToSave.barcode);
            }
            // If still not found, try catalog number
            if (existingIndex === -1 && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                existingIndex = updatedInventory.findIndex(p => p.catalogNumber === productToSave.catalogNumber);
            }

            if (existingIndex !== -1) {
                // Product exists, update it
                const existingProduct = updatedInventory[existingIndex];
                existingProduct.quantity += quantityToAdd;
                // Use the unitPrice from productToSave, as this is the confirmed/chosen cost price
                existingProduct.unitPrice = unitPrice; 
                existingProduct.lineTotal = parseFloat((existingProduct.quantity * existingProduct.unitPrice).toFixed(2)); // Recalculate lineTotal
                
                // Update other details if they were provided in productToSave
                existingProduct.description = productToSave.description || existingProduct.description;
                existingProduct.shortName = productToSave.shortName || existingProduct.shortName;
                existingProduct.catalogNumber = productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A' ? productToSave.catalogNumber : existingProduct.catalogNumber;
                existingProduct.barcode = productToSave.barcode || existingProduct.barcode;
                existingProduct.salePrice = salePrice !== undefined ? salePrice : existingProduct.salePrice;
                existingProduct.minStockLevel = productToSave.minStockLevel ?? existingProduct.minStockLevel;
                existingProduct.maxStockLevel = productToSave.maxStockLevel ?? existingProduct.maxStockLevel;

                console.log(`Updated existing product ID ${existingProduct.id}: Qty=${existingProduct.quantity}, UnitPrice=${existingProduct.unitPrice}, SalePrice=${existingProduct.salePrice}, LineTotal=${existingProduct.lineTotal}`);
            } else {
                // New product
                if (!productToSave.catalogNumber && !productToSave.description && !productToSave.barcode) {
                    console.log("Skipping adding product with no identifier (catalog, description, or barcode):", productToSave);
                    return; // Skip if no reliable identifier
                }
                const newId = (productToSave.id && !productToSave.id.includes('-new') && productToSave.id !== tempInvoiceId) // tempInvoiceId check might be redundant
                    ? productToSave.id
                    : `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

                const productToAdd: Product = {
                    ...productToSave, // spread first to get all potential fields
                    id: newId,
                    quantity: quantityToAdd,
                    unitPrice: unitPrice, // Confirmed unit price
                    salePrice: salePrice, // Confirmed sale price
                    lineTotal: lineTotal, // Recalculated line total
                    catalogNumber: productToSave.catalogNumber || 'N/A',
                    description: productToSave.description || 'No Description',
                    barcode: productToSave.barcode, // May be undefined if skipped
                    shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                    minStockLevel: productToSave.minStockLevel, // Keep if provided
                    maxStockLevel: productToSave.maxStockLevel, // Keep if provided
                };
                updatedInventory.push(productToAdd);
                console.log(`Added new product with ID ${newId}:`, productToAdd);
            }
        });
        saveStoredData(INVENTORY_STORAGE_KEY, updatedInventory);
        console.log('Updated localStorage inventory:', updatedInventory);

    } catch (error) {
        console.error("Error processing products for inventory:", error);
        productsProcessedSuccessfully = false;
        // Do not throw here, let the invoice part handle status
    }

    // Handle Invoice Record (Only if source is 'upload')
    if (source === 'upload') {
        const finalStatus = productsProcessedSuccessfully ? 'completed' : 'error';
        const errorMessage = productsProcessedSuccessfully ? undefined : 'Failed to process some products into inventory.';
        
        // Use the extracted total amount if available and valid, otherwise fallback to sum of product lines
        const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && !isNaN(extractedTotalAmount))
                                        ? extractedTotalAmount 
                                        : parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2));

        let invoiceIdToUse: string;
        let existingInvoiceIndex = -1;

        if (tempInvoiceId) {
            existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === tempInvoiceId);
        }

        if (existingInvoiceIndex !== -1 && tempInvoiceId) {
            // Update existing PENDING record
            invoiceIdToUse = tempInvoiceId;
            const existingRecord = currentInvoices[existingInvoiceIndex];
            currentInvoices[existingInvoiceIndex] = {
                ...existingRecord,
                fileName: fileName, // Can update if name changed
                uploadTime: new Date().toISOString(), // Update to final processing time
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber || existingRecord.invoiceNumber, // Use extracted if available
                supplier: extractedSupplierName || existingRecord.supplier, // Use extracted if available
                totalAmount: finalInvoiceTotalAmount, // Use determined total
                invoiceDataUri: invoiceDataUriToSave, // Save the compressed image URI
                errorMessage: errorMessage,
            };
            console.log(`Updated invoice record ID: ${invoiceIdToUse} with final data.`);
        } else {
            // This case should ideally not happen if a PENDING record was created.
            // But as a fallback, create a new record.
            invoiceIdToUse = tempInvoiceId || `inv-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
            console.warn(`Creating new invoice record as tempInvoiceId "${tempInvoiceId}" was not found or not provided for update. New ID: ${invoiceIdToUse}`);
            const newInvoiceRecord: InvoiceHistoryItem = {
                id: invoiceIdToUse,
                fileName: fileName,
                uploadTime: new Date().toISOString(),
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber,
                supplier: extractedSupplierName,
                totalAmount: finalInvoiceTotalAmount,
                invoiceDataUri: invoiceDataUriToSave, // Save the compressed image URI
                errorMessage: errorMessage,
            };
            currentInvoices = [newInvoiceRecord, ...currentInvoices]; // Add to the beginning
            console.log(`Created new invoice record ID: ${invoiceIdToUse} with final data.`);
        }
        
        try {
            saveStoredData(INVOICES_STORAGE_KEY, currentInvoices);
            console.log('Updated localStorage invoices:', currentInvoices);
        } catch (storageError) {
            console.error("Critical error saving invoices to localStorage:", storageError);
            // This is a critical failure if invoice history can't be saved.
            // We might want to re-throw to indicate the overall operation had issues.
            const saveError = new Error(`Failed to save invoice history: ${(storageError as Error).message}`);
            (saveError as any).updatedBySaveProducts = true; // Custom flag if needed
            throw saveError;
        }

        if (!productsProcessedSuccessfully) {
            console.warn("[Backend - finalizeSaveProductsService] Product processing error occurred, invoice status set to 'error'.");
        }
    } else if (source.endsWith('_sync')) { // Handle POS sync sources specifically
      console.log(`POS Sync (${source}) completed. Inventory updated. No invoice record created for this sync type.`);
    } else {
      // Other sources might not need invoice history updates
      console.log(`Skipping invoice history update for source: ${source}`);
    }

    // Cleanup temporary localStorage items related to this specific scan attempt
    // This should be done regardless of success/failure of product processing if an invoice was involved.
    if (source === 'upload' && tempInvoiceId) {
        const scanIdFromTemp = tempInvoiceId.replace('pending-inv-', '');
        const dataKey = `${TEMP_DATA_KEY_PREFIX}${scanIdFromTemp}`;
        const originalPreviewKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${scanIdFromTemp}`;
        const compressedKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${scanIdFromTemp}`;

        localStorage.removeItem(dataKey);
        localStorage.removeItem(originalPreviewKey);
        localStorage.removeItem(compressedKey);
        console.log(`[Backend - finalizeSaveProductsService] Cleared temporary localStorage data for scan ID: ${scanIdFromTemp}`);
    }
}


export async function getProductsService(): Promise<Product[]> {
  console.log("getProductsService called");
  await new Promise(resolve => setTimeout(resolve, 50));
  const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  // Enrich product data with defaults or calculations if needed
  const inventoryWithDefaults = inventory.map(item => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const description = item.description || 'No Description';
      return {
        ...item,
        id: item.id || `prod-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, // Ensure ID
        description: description,
        shortName: item.shortName || description.split(' ').slice(0, 3).join(' '),
        lineTotal: parseFloat((quantity * unitPrice).toFixed(2)), // Recalculate for consistency
        barcode: item.barcode || undefined,
        salePrice: item.salePrice ?? undefined, // Use nullish coalescing for optional fields
        minStockLevel: item.minStockLevel ?? undefined,
        maxStockLevel: item.maxStockLevel ?? undefined,
      };
  });
  console.log("Returning inventory with recalculated totals, shortNames, and stock levels:", inventoryWithDefaults);
  return inventoryWithDefaults;
}

export async function getProductByIdService(productId: string): Promise<Product | null> {
   console.log(`getProductByIdService called for ID: ${productId}`);
   await new Promise(resolve => setTimeout(resolve, 50));
   const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
   const product = inventory.find(p => p.id === productId);
   if (product) {
        // Enrich product data with defaults or calculations
        const quantity = Number(product.quantity) || 0;
        const unitPrice = Number(product.unitPrice) || 0;
        const description = product.description || 'No Description';
        return {
           ...product,
           id: product.id || productId, // Ensure ID
           description: description,
           shortName: product.shortName || description.split(' ').slice(0, 3).join(' '),
           lineTotal: parseFloat((quantity * unitPrice).toFixed(2)), // Recalculate
           barcode: product.barcode || undefined,
           salePrice: product.salePrice ?? undefined,
           minStockLevel: product.minStockLevel ?? undefined,
           maxStockLevel: product.maxStockLevel ?? undefined,
        };
   }
   return null;
}


export async function updateProductService(productId: string, updatedData: Partial<Product>): Promise<void> {
  console.log(`updateProductService called for ID: ${productId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  const productIndex = currentInventory.findIndex(p => p.id === productId);

  if (productIndex === -1) {
    console.error(`Product with ID ${productId} not found for update.`);
    throw new Error(`Product with ID ${productId} not found.`);
  }

  // Create the updated product object, ensuring ID is maintained
  const updatedProduct = {
    ...currentInventory[productIndex],
    ...updatedData,
    id: productId, // Ensure the original ID is preserved
  };

  // Recalculate lineTotal if quantity or unitPrice changed
   if (updatedData.quantity !== undefined || updatedData.unitPrice !== undefined) {
       const quantity = Number(updatedProduct.quantity) || 0;
       const unitPrice = Number(updatedProduct.unitPrice) || 0;
       updatedProduct.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
   }
    // Ensure shortName, barcode, salePrice, minStockLevel, maxStockLevel have sensible defaults
    if (!updatedProduct.shortName) {
         const description = updatedProduct.description || 'No Description';
         updatedProduct.shortName = description.split(' ').slice(0, 3).join(' ');
    }
    updatedProduct.barcode = updatedProduct.barcode || undefined;
    // Handle optional fields: if explicitly set to null/undefined in updatedData, use undefined, otherwise keep existing or new value
    updatedProduct.salePrice = updatedData.salePrice === null || updatedData.salePrice === undefined 
                              ? undefined 
                              : (Number.is.Finite(updatedData.salePrice) ? Number(updatedData.salePrice) : currentInventory[productIndex].salePrice);
    
    updatedProduct.minStockLevel = updatedData.minStockLevel === null || updatedData.minStockLevel === undefined
                                  ? undefined
                                  : (Number.is.Finite(updatedData.minStockLevel) ? Number(updatedData.minStockLevel) : currentInventory[productIndex].minStockLevel);
    
    updatedProduct.maxStockLevel = updatedData.maxStockLevel === null || updatedData.maxStockLevel === undefined
                                  ? undefined
                                  : (Number.is.Finite(updatedData.maxStockLevel) ? Number(updatedData.maxStockLevel) : currentInventory[productIndex].maxStockLevel);


  currentInventory[productIndex] = updatedProduct;

  saveStoredData(INVENTORY_STORAGE_KEY, currentInventory);
  console.log(`Product ${productId} updated successfully.`);
}

export async function deleteProductService(productId: string): Promise<void> {
  console.log(`deleteProductService called for ID: ${productId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  const initialLength = currentInventory.length;
  const updatedInventory = currentInventory.filter(p => p.id !== productId);

  if (updatedInventory.length === initialLength) {
      console.error(`Product with ID ${productId} not found for deletion.`);
      throw new Error(`Product with ID ${productId} not found.`);
  }

  saveStoredData(INVENTORY_STORAGE_KEY, updatedInventory);
  console.log(`Product ${productId} deleted successfully.`);
}


export async function getInvoicesService(): Promise<InvoiceHistoryItem[]> {
  console.log("getInvoicesService called");
  await new Promise(resolve => setTimeout(resolve, 50));
  const invoicesRaw = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);
  // Ensure IDs and convert date strings to Date objects for consistency
  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, // Ensure ID
    uploadTime: new Date(inv.uploadTime) // Convert to Date object
  }));
  console.log("Returning invoices from localStorage:", invoices);
  return invoices;
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>): Promise<void> {
  console.log(`updateInvoiceService called for ID: ${invoiceId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);
  const invoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceId);

  if (invoiceIndex === -1) {
    console.error(`Invoice with ID ${invoiceId} not found for update.`);
    throw new Error(`Invoice with ID ${invoiceId} not found.`);
  }

  const originalInvoice = currentInvoices[invoiceIndex];
  // Construct the final updated data, ensuring critical fields like ID and original uploadTime are preserved if not explicitly changed.
  const finalUpdatedData: InvoiceHistoryItem = {
    ...originalInvoice,
    ...updatedData,
    id: invoiceId, // Ensure original ID is kept
    uploadTime: originalInvoice.uploadTime, // Keep original upload time, unless `updatedData` explicitly changes it (which it shouldn't for edits)
    // Handle invoiceDataUri: if updatedData has null, set to undefined. If updatedData has a new URI, use it. Otherwise, keep original.
    invoiceDataUri: updatedData.invoiceDataUri === null ? undefined : (updatedData.invoiceDataUri ?? originalInvoice.invoiceDataUri),
    status: updatedData.status || originalInvoice.status, // Keep original status if not in updatedData
  };

  currentInvoices[invoiceIndex] = finalUpdatedData;

  saveStoredData(INVOICES_STORAGE_KEY, currentInvoices);
  console.log(`Invoice ${invoiceId} updated successfully.`);
}


export async function deleteInvoiceService(invoiceId: string): Promise<void> {
  console.log(`deleteInvoiceService called for ID: ${invoiceId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);
  const initialLength = currentInvoices.length;
  const updatedInvoices = currentInvoices.filter(inv => inv.id !== invoiceId);

  if (updatedInvoices.length === initialLength) {
    console.error(`Invoice with ID ${invoiceId} not found for deletion.`);
    throw new Error(`Invoice with ID ${invoiceId} not found.`);
  }

  saveStoredData(INVOICES_STORAGE_KEY, updatedInvoices);
  console.log(`Invoice ${invoiceId} deleted successfully.`);
}


export async function clearInventoryService(): Promise<void> {
    console.log("clearInventoryService called");
    await new Promise(resolve => setTimeout(resolve, 100));
    saveStoredData(INVENTORY_STORAGE_KEY, []); // Save an empty array
    console.log("Inventory cleared from localStorage.");
}


// --- POS Settings Management ---
export async function savePosSettingsService(systemId: string, config: PosConnectionConfig): Promise<void> {
    console.log(`[Backend] Saving POS settings for ${systemId}`, config);
    await new Promise(resolve => setTimeout(resolve, 100));
    const settings: StoredPosSettings = { systemId, config };
    saveStoredData(POS_SETTINGS_STORAGE_KEY, settings);
    console.log("[Backend] POS settings saved to localStorage.");
}

export async function getPosSettingsService(): Promise<StoredPosSettings | null> {
  if (typeof window === 'undefined') {
    // This function is client-side only, so handle server-side call appropriately
    console.warn("[Backend] getPosSettingsService called from server-side. Returning null.");
    return null;
  }
  console.log("[Backend] Retrieving POS settings (client-side).");
  await new Promise(resolve => setTimeout(resolve, 50));
  const settings = getStoredObject<StoredPosSettings>(POS_SETTINGS_STORAGE_KEY);
  console.log("[Backend] Retrieved POS settings (client-side):", settings);
  return settings;
}

export async function clearPosSettingsService(): Promise<void> {
    console.log("[Backend] Clearing POS settings.");
    await new Promise(resolve => setTimeout(resolve, 50));
    if (typeof window !== 'undefined') {
        localStorage.removeItem(POS_SETTINGS_STORAGE_KEY);
        console.log("[Backend] POS settings cleared from localStorage.");
    } else {
        console.warn("[Backend] localStorage not available. POS settings not cleared.");
    }
}


// --- User Authentication (Mock) ---
export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export async function registerService(userData: any): Promise<AuthResponse> {
  console.log("Registering user:", userData.username);
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API call
  const newUser: User = {
    id: `user-${Date.now()}`,
    username: userData.username,
    email: userData.email,
  };
  // In a real app, you would save the user to a database here.
  // For mock, we just return success.
  return {
    token: 'mock_register_token_' + Date.now(),
    user: newUser,
  };
}

export async function loginService(credentials: any): Promise<AuthResponse> {
  console.log("Logging in user:", credentials.username);
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API call
  // In a real app, you would verify credentials against a database.
  // For mock, we assume success if username is provided.
  if (!credentials.username || !credentials.password) {
    throw new Error("Username and password are required.");
  }
  const loggedInUser: User = {
    id: 'user-mock-123', // Static ID for mock
    username: credentials.username,
    email: `${credentials.username}@example.com`, // Mock email
  };
  return {
    token: 'mock_login_token_' + Date.now(),
    user: loggedInUser,
  };
}


// Function to get supplier summaries derived from invoices
export async function getSupplierSummariesService(): Promise<SupplierSummary[]> {
  const invoices = await getInvoicesService();
  const supplierMap = new Map<string, { count: number, total: number }>();

  invoices.forEach(invoice => {
    if (invoice.supplier && invoice.status === 'completed') {
      const existing = supplierMap.get(invoice.supplier);
      if (existing) {
        existing.count += 1;
        existing.total += (invoice.totalAmount || 0);
      } else {
        supplierMap.set(invoice.supplier, { count: 1, total: (invoice.totalAmount || 0) });
      }
    }
  });

  const summaries: SupplierSummary[] = [];
  supplierMap.forEach((data, name) => {
    summaries.push({
      name,
      invoiceCount: data.count,
      totalSpent: data.total,
    });
  });

  return summaries.sort((a,b) => b.totalSpent - a.totalSpent); // Sort by total spent desc
}