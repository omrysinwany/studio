
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
  invoiceDataUri?: string;
}

export interface SupplierSummary {
  name: string;
  invoiceCount: number;
  totalSpent: number;
  phone?: string; 
  email?: string; 
}


const INVENTORY_STORAGE_KEY = 'mockInventoryData';
const INVOICES_STORAGE_KEY = 'mockInvoicesData';
const POS_SETTINGS_STORAGE_KEY = 'mockPosSettings';
const SUPPLIERS_STORAGE_KEY = 'mockSuppliersData'; // For storing supplier contact info

const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';


// Constants for localStorage limits
const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.5 * 1024 * 1024; // 0.5MB
const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.25 * 1024 * 1024; // 0.25MB
const MAX_SCAN_RESULTS_SIZE_BYTES = 2 * 1024 * 1024; // 2MB


const initialMockInventory: Product[] = [];

const initialMockInvoices: InvoiceHistoryItem[] = [];

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


const getStoredData = <T extends {id?: string; name?: string}>(key: string, initialData?: T[]): T[] => {
  if (typeof window === 'undefined') {
    return initialData || [];
  }
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsedData = JSON.parse(stored) as T[];
      // Ensure each item has an ID. If not, generate one. This helps with list rendering keys.
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || `${key}-${Date.now()}-${index}` // Generate ID if missing
      }));
    } else if (initialData) {
       // If no stored data, use initialData and ensure IDs are present
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
        // Propagate the error so the calling function can handle it (e.g., by showing a toast)
        throw error; 
    }
  }
};


export interface DocumentProcessingResponse {
  products: Product[];
}


export async function checkProductPricesBeforeSaveService(
    productsToCheck: Product[],
    tempId?: string // tempId for the current invoice being processed
): Promise<PriceCheckResult> {
    console.log(`Checking product prices before save. Products to check:`, productsToCheck, `(tempId: ${tempId})`);
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate async operation

    const currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
    const productsToSaveDirectly: Product[] = [];
    const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

    productsToCheck.forEach(scannedProduct => {
        const quantityFromScan = parseFloat(String(scannedProduct.quantity)) || 0;
        const lineTotalFromScan = parseFloat(String(scannedProduct.lineTotal)) || 0;
        let unitPriceFromScan = parseFloat(String(scannedProduct.unitPrice)) || 0;

        // Calculate unitPrice from lineTotal and quantity if unitPrice is zero or missing
        if (unitPriceFromScan === 0 && quantityFromScan !== 0 && lineTotalFromScan !== 0) {
            unitPriceFromScan = parseFloat((lineTotalFromScan / quantityFromScan).toFixed(2));
        }

        // Try to find an existing product in inventory
        let existingIndex = -1;
        // Prioritize matching by a stable ID if available from the scan (and not a temporary new ID)
        if (scannedProduct.id && !scannedProduct.id.includes('-new') && scannedProduct.id !== tempId) { 
            existingIndex = currentInventory.findIndex(p => p.id === scannedProduct.id);
        }
        // Then by barcode
        if (existingIndex === -1 && scannedProduct.barcode && scannedProduct.barcode.trim() !== '') {
            existingIndex = currentInventory.findIndex(p => p.barcode === scannedProduct.barcode);
        }
        // Then by catalog number
        if (existingIndex === -1 && scannedProduct.catalogNumber && scannedProduct.catalogNumber !== 'N/A') {
            existingIndex = currentInventory.findIndex(p => p.catalogNumber === scannedProduct.catalogNumber);
        }


        if (existingIndex !== -1) {
            const existingProduct = currentInventory[existingIndex];
            const existingUnitPrice = existingProduct.unitPrice; // Assuming this is the cost price

            // Check if the new unit price is different from the existing one
            if (unitPriceFromScan !== 0 && Math.abs(existingUnitPrice - unitPriceFromScan) > 0.001) { // Use a small epsilon for float comparison
                console.log(`Price discrepancy found for product ID ${existingProduct.id}. Existing: ${existingUnitPrice}, New: ${unitPriceFromScan}`);
                priceDiscrepancies.push({
                    ...scannedProduct, // Keep all scanned details (like quantity, barcode, etc.)
                    id: existingProduct.id, // Use the ID of the existing product for updating
                    existingUnitPrice: existingUnitPrice,
                    newUnitPrice: unitPriceFromScan,
                });
            } else {
                // No significant price difference, or new price is 0 (keep existing)
                productsToSaveDirectly.push({
                    ...scannedProduct, // Keep all scanned details
                    id: existingProduct.id, // Use the ID of the existing product
                    unitPrice: existingUnitPrice // Ensure we are using the confirmed/existing unit price
                });
            }
        } else {
            // Product not found in inventory, add to save directly (new product)
            productsToSaveDirectly.push(scannedProduct);
        }
    });

    console.log("Price check complete. Direct saves:", productsToSaveDirectly, "Discrepancies:", priceDiscrepancies);
    return { productsToSaveDirectly, priceDiscrepancies };
}


// Service to finalize saving products to inventory and update/create invoice history
export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    fileName: string,
    source: string = 'upload', // Source of the products (e.g., 'upload', 'caspit_sync')
    tempInvoiceId?: string, // Temporary ID for the invoice being processed
    invoiceDataUriToSave?: string,
    extractedInvoiceNumber?: string,
    finalSupplierName?: string, // Supplier name confirmed by user or from AI
    extractedTotalAmount?: number
): Promise<void> {
    console.log(`Finalizing save for products: ${fileName} (source: ${source}, tempInvoiceId: ${tempInvoiceId}) Image URI to save: ${invoiceDataUriToSave ? 'Exists' : 'Does not exist'}`, productsToFinalizeSave);
    console.log(`Extracted Invoice Details: Number=${extractedInvoiceNumber}, Supplier=${finalSupplierName}, Total=${extractedTotalAmount}`);
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async operation

    let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
    let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);

    let calculatedInvoiceTotalAmountFromProducts = 0;
    let productsProcessedSuccessfully = true;
    
    try {
        const updatedInventory = [...currentInventory]; // Create a mutable copy

        productsToFinalizeSave.forEach(productToSave => {
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            const unitPrice = parseFloat(String(productToSave.unitPrice)) || 0; // This should be the resolved unit price
            const salePrice = productToSave.salePrice !== undefined ? parseFloat(String(productToSave.salePrice)) : undefined;
            const lineTotal = parseFloat((quantityToAdd * unitPrice).toFixed(2)); // Recalculate based on resolved unit price

            if (!isNaN(lineTotal)) {
                calculatedInvoiceTotalAmountFromProducts += lineTotal;
            } else {
                console.warn(`Invalid lineTotal for product: ${productToSave.id || productToSave.catalogNumber}. Skipping for invoice total.`);
            }

            let existingIndex = -1;
            // Prioritize matching by a stable ID if available
            if (productToSave.id && !productToSave.id.includes('-new') && productToSave.id !== tempInvoiceId) { 
                existingIndex = updatedInventory.findIndex(p => p.id === productToSave.id);
            }
            // Then by barcode
            if (existingIndex === -1 && productToSave.barcode && productToSave.barcode.trim() !== '') {
                existingIndex = updatedInventory.findIndex(p => p.barcode === productToSave.barcode);
            }
            // Then by catalog number
            if (existingIndex === -1 && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                existingIndex = updatedInventory.findIndex(p => p.catalogNumber === productToSave.catalogNumber);
            }

            if (existingIndex !== -1) {
                // Product exists: Update quantity, keep original details unless explicitly overridden
                const existingProduct = updatedInventory[existingIndex];
                existingProduct.quantity += quantityToAdd;
                // Unit price should already be resolved (either kept old or updated new) before this function
                // Ensure we don't accidentally revert it if `productToSave.unitPrice` was 0
                existingProduct.unitPrice = unitPrice || existingProduct.unitPrice; 
                
                // Update other fields only if provided in productToSave and are different
                existingProduct.description = productToSave.description || existingProduct.description;
                existingProduct.shortName = productToSave.shortName || existingProduct.shortName;
                existingProduct.barcode = productToSave.barcode || existingProduct.barcode; // Update barcode if a new one is provided
                existingProduct.catalogNumber = productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A' ? productToSave.catalogNumber : existingProduct.catalogNumber;
                existingProduct.salePrice = salePrice !== undefined ? salePrice : existingProduct.salePrice;
                existingProduct.minStockLevel = productToSave.minStockLevel !== undefined ? productToSave.minStockLevel : existingProduct.minStockLevel;
                existingProduct.maxStockLevel = productToSave.maxStockLevel !== undefined ? productToSave.maxStockLevel : existingProduct.maxStockLevel;

                // Recalculate lineTotal based on (potentially new) quantity and (resolved) unitPrice
                existingProduct.lineTotal = parseFloat((existingProduct.quantity * existingProduct.unitPrice).toFixed(2));

                console.log(`Updated existing product ID ${existingProduct.id}: Qty=${existingProduct.quantity}, UnitPrice=${existingProduct.unitPrice}, SalePrice=${existingProduct.salePrice}, LineTotal=${existingProduct.lineTotal}`);
            } else {
                // Product does not exist: Add as new
                // Ensure it has at least one identifier
                if (!productToSave.catalogNumber && !productToSave.description && !productToSave.barcode) {
                    console.log("Skipping adding product with no identifier (catalog, description, or barcode):", productToSave);
                    return; // continue to next product in forEach
                }
                const newId = (productToSave.id && !productToSave.id.includes('-new') && productToSave.id !== tempInvoiceId) 
                    ? productToSave.id
                    : `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

                const productToAdd: Product = {
                    ...productToSave, // Take all properties from productToSave (which should have barcode, salePrice etc.)
                    id: newId,
                    quantity: quantityToAdd,
                    unitPrice: unitPrice, // This is the resolved unit price
                    salePrice: salePrice, // This is the sale price from barcode prompt
                    lineTotal: lineTotal, // Recalculated based on resolved unit price
                    catalogNumber: productToSave.catalogNumber || 'N/A',
                    description: productToSave.description || 'No Description',
                    // barcode: productToSave.barcode, // Already in productToSave
                    shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                    // minStockLevel: productToSave.minStockLevel, // Already in productToSave
                    // maxStockLevel: productToSave.maxStockLevel, // Already in productToSave
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
        // Do not re-throw here, let the invoice saving part handle the status
    }

    // Update or create invoice history record, only if source is 'upload'
    if (source === 'upload') {
        const finalStatus = productsProcessedSuccessfully ? 'completed' : 'error';
        const errorMessage = productsProcessedSuccessfully ? undefined : 'Failed to process some products into inventory.';
        
        // Use extractedTotalAmount if available and valid, otherwise fallback to calculated sum
        const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && !isNaN(extractedTotalAmount))
                                        ? extractedTotalAmount 
                                        : parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2));

        let invoiceIdToUse: string;
        let existingInvoiceIndex = -1;

        // Try to find the pending invoice record by tempInvoiceId
        if (tempInvoiceId) {
            existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === tempInvoiceId);
        }

        if (existingInvoiceIndex !== -1 && tempInvoiceId) {
            // Update the existing PENDING invoice record
            invoiceIdToUse = tempInvoiceId;
            const existingRecord = currentInvoices[existingInvoiceIndex];
            currentInvoices[existingInvoiceIndex] = {
                ...existingRecord, // Keep original uploadTime and potentially other details
                fileName: fileName, // Update fileName in case it was generic before
                // uploadTime: new Date().toISOString(), // Keep original upload time for pending record
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber || existingRecord.invoiceNumber, // Use extracted if available
                supplier: finalSupplierName || existingRecord.supplier, // Use confirmed/final supplier name
                totalAmount: finalInvoiceTotalAmount, // Use final total amount
                invoiceDataUri: invoiceDataUriToSave, // Save the compressed image URI intended for final storage
                errorMessage: errorMessage,
            };
            console.log(`Updated invoice record ID: ${invoiceIdToUse} with final data.`);
        } else {
            // If no PENDING record found by tempInvoiceId (or tempInvoiceId was not provided), create a new one
            // This case should ideally not happen if a PENDING record was created at upload start
            invoiceIdToUse = tempInvoiceId || `inv-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
            console.warn(`Creating new invoice record as tempInvoiceId "${tempInvoiceId}" was not found or not provided for update. New ID: ${invoiceIdToUse}`);
            const newInvoiceRecord: InvoiceHistoryItem = {
                id: invoiceIdToUse,
                fileName: fileName,
                uploadTime: new Date().toISOString(), // New upload time for a new record
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber,
                supplier: finalSupplierName,
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
            // This is a critical failure if we can't even update the invoice status.
            // The inventory might be updated, but the invoice record isn't.
            // Re-throw a specific error to be caught by the caller.
            const saveError = new Error(`Failed to save invoice history: ${(storageError as Error).message}`);
            (saveError as any).updatedBySaveProducts = true; // Custom property to identify the source
            throw saveError;
        }

        if (!productsProcessedSuccessfully) {
            console.warn("[Backend - finalizeSaveProductsService] Product processing error occurred, invoice status set to 'error'.");
        }
    } else if (source.endsWith('_sync')) { // Handle POS sync
      console.log(`POS Sync (${source}) completed. Inventory updated. No invoice record created for this sync type.`);
    } else {
      // For other sources, or if source isn't 'upload'
      console.log(`Skipping invoice history update for source: ${source}`);
    }
}


// Service to get all products from inventory
export async function getProductsService(): Promise<Product[]> {
  console.log("getProductsService called");
  await new Promise(resolve => setTimeout(resolve, 50)); // Simulate async
  const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  // Ensure all products have derived/calculated fields like lineTotal and shortName
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
        salePrice: item.salePrice ?? undefined, // Ensure it's either number or undefined
        minStockLevel: item.minStockLevel ?? undefined,
        maxStockLevel: item.maxStockLevel ?? undefined,
      };
  });
  console.log("Returning inventory with recalculated totals, shortNames, and stock levels:", inventoryWithDefaults);
  return inventoryWithDefaults;
}

// Service to get a single product by ID
export async function getProductByIdService(productId: string): Promise<Product | null> {
   console.log(`getProductByIdService called for ID: ${productId}`);
   await new Promise(resolve => setTimeout(resolve, 50)); // Simulate async
   const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
   const product = inventory.find(p => p.id === productId);
   if (product) {
        // Ensure derived fields are consistent
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


// Service to update an existing product
export async function updateProductService(productId: string, updatedData: Partial<Product>): Promise<void> {
  console.log(`updateProductService called for ID: ${productId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  const productIndex = currentInventory.findIndex(p => p.id === productId);

  if (productIndex === -1) {
    console.error(`Product with ID ${productId} not found for update.`);
    throw new Error(`Product with ID ${productId} not found.`);
  }

  // Merge existing product with updated data
  const updatedProduct = {
    ...currentInventory[productIndex],
    ...updatedData,
    id: productId, // Ensure ID is not changed
  };

  // Recalculate lineTotal if quantity or unitPrice changed
   if (updatedData.quantity !== undefined || updatedData.unitPrice !== undefined) {
       const quantity = Number(updatedProduct.quantity) || 0;
       const unitPrice = Number(updatedProduct.unitPrice) || 0;
       updatedProduct.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
   }
    // Ensure shortName exists
    if (!updatedProduct.shortName) {
         const description = updatedProduct.description || 'No Description';
         updatedProduct.shortName = description.split(' ').slice(0, 3).join(' ');
    }
    // Ensure barcode is either a string or undefined
    updatedProduct.barcode = updatedProduct.barcode || undefined;
    // Ensure salePrice, minStockLevel, maxStockLevel are numbers or undefined
    updatedProduct.salePrice = updatedData.salePrice === null || updatedData.salePrice === undefined 
                              ? undefined 
                              : (Number.isFinite(Number(updatedData.salePrice)) ? Number(updatedData.salePrice) : currentInventory[productIndex].salePrice);
    
    updatedProduct.minStockLevel = updatedData.minStockLevel === null || updatedData.minStockLevel === undefined
                                  ? undefined
                                  : (Number.isFinite(Number(updatedData.minStockLevel)) ? Number(updatedData.minStockLevel) : currentInventory[productIndex].minStockLevel);
    
    updatedProduct.maxStockLevel = updatedData.maxStockLevel === null || updatedData.maxStockLevel === undefined
                                  ? undefined
                                  : (Number.isFinite(Number(updatedData.maxStockLevel)) ? Number(updatedData.maxStockLevel) : currentInventory[productIndex].maxStockLevel);


  currentInventory[productIndex] = updatedProduct;

  saveStoredData(INVENTORY_STORAGE_KEY, currentInventory);
  console.log(`Product ${productId} updated successfully.`);
}

// Service to delete a product
export async function deleteProductService(productId: string): Promise<void> {
  console.log(`deleteProductService called for ID: ${productId}`);
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  const initialLength = currentInventory.length;
  const updatedInventory = currentInventory.filter(p => p.id !== productId);

  if (updatedInventory.length === initialLength) {
      // Product not found, but we don't want to throw an error if it's already deleted
      console.warn(`Product with ID ${productId} not found for deletion (might be already deleted).`);
      // throw new Error(`Product with ID ${productId} not found.`);
  }

  saveStoredData(INVENTORY_STORAGE_KEY, updatedInventory);
  console.log(`Product ${productId} deleted successfully.`);
}


// Service to get invoice history
export async function getInvoicesService(): Promise<InvoiceHistoryItem[]> {
  console.log("getInvoicesService called");
  await new Promise(resolve => setTimeout(resolve, 50)); // Simulate async
  const invoicesRaw = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);
  // Ensure dates are Date objects and IDs are present
  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, // Ensure ID
    uploadTime: new Date(inv.uploadTime) // Convert to Date object
  }));
  console.log("Returning invoices from localStorage:", invoices);
  return invoices;
}

// Service to update an existing invoice's metadata (not its products)
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
  // Create the updated invoice, ensuring we don't overwrite critical original fields unintentionally
  const finalUpdatedData: InvoiceHistoryItem = {
    ...originalInvoice, // Start with all original data
    ...updatedData,     // Apply updates
    id: invoiceId,      // Ensure ID remains the same
    uploadTime: originalInvoice.uploadTime, // Keep original upload time
    // Handle invoiceDataUri carefully: if updatedData.invoiceDataUri is null, it means clear it (set to undefined)
    invoiceDataUri: updatedData.invoiceDataUri === null ? undefined : (updatedData.invoiceDataUri ?? originalInvoice.invoiceDataUri),
    status: updatedData.status || originalInvoice.status, // Keep original status if not provided in update
  };

  currentInvoices[invoiceIndex] = finalUpdatedData;

  saveStoredData(INVOICES_STORAGE_KEY, currentInvoices);
  console.log(`Invoice ${invoiceId} updated successfully.`);
}


// Service to delete an invoice history item
export async function deleteInvoiceService(invoiceId: string): Promise<void> {
  console.log(`deleteInvoiceService called for ID: ${invoiceId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);
  const initialLength = currentInvoices.length;
  const updatedInvoices = currentInvoices.filter(inv => inv.id !== invoiceId);

  if (updatedInvoices.length === initialLength) {
    // Invoice not found, but we don't want to throw an error if it's already deleted
    console.warn(`Invoice with ID ${invoiceId} not found for deletion (might be already deleted).`);
    // throw new Error(`Invoice with ID ${invoiceId} not found.`);
  }

  saveStoredData(INVOICES_STORAGE_KEY, updatedInvoices);
  console.log(`Invoice ${invoiceId} deleted successfully.`);
}


// Service to clear the entire inventory
export async function clearInventoryService(): Promise<void> {
    console.log("clearInventoryService called");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async
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
  // This function can now be called from server components/actions too, as it doesn't directly use localStorage.
  // The actual localStorage access is encapsulated in getStoredObject.
  if (typeof window === 'undefined') {
    // For server-side, we assume it's a fresh start or settings are managed differently.
    // Or, if you had a server-side settings store, you'd fetch from there.
    console.warn("[Backend] getPosSettingsService called from server-side. Returning null as no server-side store implemented.");
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

// Mock registration service
export async function registerService(userData: any): Promise<AuthResponse> {
  console.log("Registering user:", userData.username);
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API call
  // In a real app, you'd hash the password and save the user to a database.
  const newUser: User = {
    id: `user-${Date.now()}`,
    username: userData.username,
    email: userData.email,
    // password: userData.password, // NEVER store plain passwords
  };
  // For mock, just return a success response
  return {
    token: 'mock_register_token_' + Date.now(),
    user: newUser,
  };
}

// Mock login service
export async function loginService(credentials: any): Promise<AuthResponse> {
  console.log("Logging in user:", credentials.username);
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API call
  // In a real app, you'd check credentials against a database.
  if (!credentials.username || !credentials.password) {
    throw new Error("Username and password are required.");
  }
  // Mock successful login for any non-empty credentials
  const loggedInUser: User = {
    id: 'user-mock-123', // Consistent mock ID for simplicity
    username: credentials.username,
    email: `${credentials.username}@example.com`, // Mock email
  };
  return {
    token: 'mock_login_token_' + Date.now(),
    user: loggedInUser,
  };
}


// --- Supplier Management ---

// Function to get supplier summaries derived from invoices and stored contact info
export async function getSupplierSummariesService(): Promise<SupplierSummary[]> {
  const invoices = await getInvoicesService();
  const storedSuppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY, []);
  
  const supplierMap = new Map<string, { count: number, total: number, phone?: string, email?: string }>();

  // Initialize map with stored supplier contact info
  storedSuppliers.forEach(s => {
    supplierMap.set(s.name, { count: 0, total: 0, phone: s.phone, email: s.email });
  });

  // Aggregate invoice data
  invoices.forEach(invoice => {
    if (invoice.supplier && invoice.status === 'completed') { // Only count completed invoices for spending
      const existing = supplierMap.get(invoice.supplier);
      if (existing) {
        existing.count += 1;
        existing.total += (invoice.totalAmount || 0);
      } else {
        // Supplier from invoice not in storedSuppliers, add them (without contact initially)
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
      phone: data.phone,
      email: data.email,
    });
  });

  return summaries.sort((a,b) => b.totalSpent - a.totalSpent); // Sort by total spent descending
}

// Create a new supplier
export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string }): Promise<SupplierSummary> {
  console.log(`Creating new supplier: ${name}`, contactInfo);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY, []);
  
  // Check if supplier already exists (case-insensitive)
  if (suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Supplier with name "${name}" already exists.`);
  }

  const newSupplier = { name, ...contactInfo };
  suppliers.push(newSupplier);
  saveStoredData(SUPPLIERS_STORAGE_KEY, suppliers);

  console.log("New supplier created and saved to localStorage.");
  // Return the newly created supplier summary
  return { name, invoiceCount: 0, totalSpent: 0, ...contactInfo };
}

// Delete a supplier
export async function deleteSupplierService(supplierName: string): Promise<void> {
  console.log(`Deleting supplier: ${supplierName}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY, []);
  const initialLength = suppliers.length;
  suppliers = suppliers.filter(s => s.name !== supplierName);

  if (suppliers.length === initialLength) {
    // Supplier not found, but we don't want to throw an error if it's already deleted
    console.warn(`Supplier with name "${supplierName}" not found for deletion (might be already deleted).`);
  }

  saveStoredData(SUPPLIERS_STORAGE_KEY, suppliers);
  console.log(`Supplier "${supplierName}" deleted from localStorage.`);
  // Note: This does not remove invoices associated with the supplier.
  // A more robust solution might archive the supplier or reassign invoices.
}


// Update supplier's contact information, or add new supplier if not found by name
export async function updateSupplierContactInfoService(supplierName: string, contactInfo: { phone?: string; email?: string }): Promise<void> {
  console.log(`Updating contact info for supplier: ${supplierName}`, contactInfo);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY, []);
  const supplierIndex = suppliers.findIndex(s => s.name === supplierName);

  if (supplierIndex !== -1) {
    // Update existing supplier's contact info
    suppliers[supplierIndex] = { ...suppliers[supplierIndex], ...contactInfo, name: supplierName }; // Ensure name is preserved
  } else {
    // If supplier by that name doesn't exist, add them as a new supplier
    // This path might be hit if a supplier was only identified from an invoice and not explicitly created
    console.log(`Supplier "${supplierName}" not found for update, creating new entry.`);
    suppliers.push({ name: supplierName, ...contactInfo });
  }
  saveStoredData(SUPPLIERS_STORAGE_KEY, suppliers);
  console.log("Supplier contact info saved to localStorage.");
}

// Function to clear specific temporary localStorage items related to a scan
export function clearTemporaryScanData(dataKey: string, originalImageKey?: string, compressedImageKey?: string) {
    if (typeof window === 'undefined') return;
    console.log(`[LocalStorageCleanup] Clearing temporary data for key: ${dataKey}`);
    localStorage.removeItem(dataKey);
    if (originalImageKey) {
        localStorage.removeItem(originalImageKey);
        console.log(`[LocalStorageCleanup] Cleared original image preview: ${originalImageKey}`);
    }
    if (compressedImageKey) {
        localStorage.removeItem(compressedImageKey);
        console.log(`[LocalStorageCleanup] Cleared compressed image: ${compressedImageKey}`);
    }
}

// Function to clear old temporary localStorage items
export function clearOldTemporaryScanData() {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000; // Milliseconds in a day
  let itemsCleared = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(TEMP_DATA_KEY_PREFIX) || key.startsWith(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX) || key.startsWith(TEMP_COMPRESSED_IMAGE_KEY_PREFIX))) {
      // Extract timestamp from the key if possible (assuming format like 'prefix_timestamp_filename')
      const parts = key.split('_'); // Assuming format like 'prefix_timestamp_filename'
      if (parts.length > 1) {
        const timestampString = parts.find(part => /^\d+$/.test(part) && part.length === 13); // Find a 13-digit timestamp
        if (timestampString) {
          const timestamp = parseInt(timestampString, 10);
          if (!isNaN(timestamp) && (now - timestamp > oneDay)) { // Clear items older than 1 day
            localStorage.removeItem(key);
            itemsCleared++;
            console.log(`[LocalStorageCleanup] Auto-cleared old item: ${key}`);
          }
        } else {
            // If key doesn't match expected format, consider clearing it if it's very old or based on other criteria
            // For now, we'll only clear keys with identifiable timestamps.
            // Potentially, add a fallback to clear items that are just very old regardless of format.
        }
      }
    }
  }
  if (itemsCleared > 0) {
    console.log(`[LocalStorageCleanup] Auto-cleared ${itemsCleared} old temporary scan data items.`);
  }

  // Also, consider pruning the main invoice history if it gets too large
  // to prevent overall localStorage quota issues.
  try {
    let currentInvoices: InvoiceHistoryItem[] = JSON.parse(localStorage.getItem(INVOICES_STORAGE_KEY) || '[]');
    const MAX_INVOICE_HISTORY_ITEMS = 50; // Example: keep only the last 50 invoices
    if (currentInvoices.length > MAX_INVOICE_HISTORY_ITEMS) { 
      currentInvoices.sort((a,b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());
      const prunedInvoices = currentInvoices.slice(0, MAX_INVOICE_HISTORY_ITEMS);
      localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(prunedInvoices));
      console.log(`[LocalStorageCleanup] Pruned main invoice history to ${MAX_INVOICE_HISTORY_ITEMS} items.`);
    }
  } catch (e) {
    console.error("[LocalStorageCleanup] Error pruning main invoice history:", e);
  }
}
