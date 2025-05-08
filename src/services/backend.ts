
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
  invoiceDataUri?: string; // Potentially large, for immediate display after scan
  originalImagePreviewUri?: string; // Smaller, for list views and long-term storage
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
const SUPPLIERS_STORAGE_KEY = 'mockSuppliersData';

// Keys for temporary data related to a single scan session
export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_'; // For ScanInvoiceOutput
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_'; // For higher-res preview on edit page
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_'; // For smaller image to be saved with final invoice


// Constants for localStorage limits and pruning
export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.8 * 1024 * 1024; // 0.8MB for edit page preview
export const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.3 * 1024 * 1024; // 0.3MB for final invoice record storage
export const MAX_SCAN_RESULTS_SIZE_BYTES = 1 * 1024 * 1024; // 1MB for raw scan output
export const MAX_INVOICE_HISTORY_ITEMS = 50; // Keep recent 50 invoices
export const MAX_INVENTORY_ITEMS_STORAGE = 500; // Max number of inventory items


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


const getStoredData = <T extends {id?: string; name?: string}>(key: string, initialDataIfKeyMissing: T[] = []): T[] => {
  if (typeof window === 'undefined') {
    return [...initialDataIfKeyMissing];
  }
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsedData = JSON.parse(stored) as T[];
      // Ensure all items have an ID, crucial for map keys and React lists
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || (item.name ? `${key}-${item.name.replace(/\s+/g, '_')}-${index}` : `${key}-item-${Date.now()}-${index}`)
      }));
    }
    // If key doesn't exist, initialize it with initialDataIfKeyMissing
    // saveStoredData(key, initialDataIfKeyMissing); // Avoid recursion by not calling saveStoredData here directly
    localStorage.setItem(key, JSON.stringify(initialDataIfKeyMissing));
    return [...initialDataIfKeyMissing];
  } catch (error) {
    console.error(`Error reading ${key} from localStorage:`, error);
    return [...initialDataIfKeyMissing]; // Return initial data on error to prevent crashes
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
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.includes('exceeded the quota'))) {
      console.warn(`[saveStoredData] Quota exceeded for key ${key}. Attempting to clear old data and retry...`);
      try {
        clearOldTemporaryScanData(true); // Pass true to indicate an emergency clear
        localStorage.setItem(key, JSON.stringify(data)); // Retry saving
        console.log(`[saveStoredData] Successfully saved data for key ${key} after cleanup.`);
      } catch (retryError) {
        console.error(`[saveStoredData] Error writing ${key} to localStorage even after cleanup:`, retryError);
        throw error; // Re-throw the original quota error
      }
    } else {
      console.error(`Error writing ${key} to localStorage:`, error);
      throw error;
    }
  }
};


export interface DocumentProcessingResponse {
  products: Product[];
}


export async function checkProductPricesBeforeSaveService(
    productsToCheck: Product[],
    tempId?: string
): Promise<PriceCheckResult> {
    console.log(`Checking product prices before save. Products to check:`, productsToCheck, `(tempId: ${tempId})`);
    await new Promise(resolve => setTimeout(resolve, 50));

    const currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY);
    const productsToSaveDirectly: Product[] = [];
    const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

    productsToCheck.forEach(scannedProduct => {
        const quantityFromScan = parseFloat(String(scannedProduct.quantity)) || 0;
        const lineTotalFromScan = parseFloat(String(scannedProduct.lineTotal)) || 0;
        let unitPriceFromScan = parseFloat(String(scannedProduct.unitPrice)) || 0;

        // If unitPrice was 0 but total and quantity are not, calculate it.
        // This is important if the AI only extracted total and quantity.
        if (unitPriceFromScan === 0 && quantityFromScan !== 0 && lineTotalFromScan !== 0) {
            unitPriceFromScan = parseFloat((lineTotalFromScan / quantityFromScan).toFixed(2));
        }

        let existingIndex = -1;
        // Prioritize matching by ID if it's not a new product ID or the temporary ID
        if (scannedProduct.id && !scannedProduct.id.includes('-new') && scannedProduct.id !== tempId) {
            existingIndex = currentInventory.findIndex(p => p.id === scannedProduct.id);
        }
        // If not found by ID, try barcode
        if (existingIndex === -1 && scannedProduct.barcode && scannedProduct.barcode.trim() !== '') {
            existingIndex = currentInventory.findIndex(p => p.barcode === scannedProduct.barcode);
        }
        // If still not found, try catalog number
        if (existingIndex === -1 && scannedProduct.catalogNumber && scannedProduct.catalogNumber !== 'N/A') {
            existingIndex = currentInventory.findIndex(p => p.catalogNumber === scannedProduct.catalogNumber);
        }


        if (existingIndex !== -1) {
            const existingProduct = currentInventory[existingIndex];
            const existingUnitPrice = existingProduct.unitPrice;

            // Check for discrepancy only if the new unit price is valid (not 0)
            if (unitPriceFromScan !== 0 && Math.abs(existingUnitPrice - unitPriceFromScan) > 0.001) { // Use a small epsilon for float comparison
                console.log(`Price discrepancy found for product ID ${existingProduct.id}. Existing: ${existingUnitPrice}, New: ${unitPriceFromScan}`);
                priceDiscrepancies.push({
                    ...scannedProduct, // Pass the full scanned product data
                    id: existingProduct.id, // Ensure we use the existing product's ID
                    existingUnitPrice: existingUnitPrice,
                    newUnitPrice: unitPriceFromScan,
                });
            } else {
                // No discrepancy, or new price is 0 (invalid), so use existing price.
                // Ensure other details from scannedProduct are considered for update if they are more recent/accurate
                productsToSaveDirectly.push({
                    ...scannedProduct,
                    id: existingProduct.id, // Ensure we use the existing product's ID
                    unitPrice: existingUnitPrice // Keep existing unit price if no valid new price or no discrepancy
                });
            }
        } else {
            // New product, use the unit price from scan (or calculated from total/qty)
            productsToSaveDirectly.push({
                ...scannedProduct,
                unitPrice: unitPriceFromScan
            });
        }
    });

    console.log("Price check complete. Direct saves:", productsToSaveDirectly, "Discrepancies:", priceDiscrepancies);
    return { productsToSaveDirectly, priceDiscrepancies };
}


export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileName: string,
    source: string = 'upload',
    tempInvoiceId?: string,
    imageUriForFinalRecord?: string,
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number
): Promise<{ inventoryPruned: boolean }> {
    console.log(`Finalizing save for products related to: ${originalFileName} (source: ${source}, tempInvoiceId: ${tempInvoiceId}) Final Image URI to save: ${imageUriForFinalRecord ? 'Exists' : 'Does not exist'}`, productsToFinalizeSave);
    console.log(`Extracted Invoice Details: Number=${extractedInvoiceNumber}, Supplier=${finalSupplierName}, Total=${extractedTotalAmount}`);
    await new Promise(resolve => setTimeout(resolve, 100));

    let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY);
    let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY);

    let calculatedInvoiceTotalAmountFromProducts = 0;
    let productsProcessedSuccessfully = true;
    let inventoryPruned = false;

    try {
        let updatedInventory = [...currentInventory];

        productsToFinalizeSave.forEach(productToSave => {
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            const unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
            const salePrice = productToSave.salePrice !== undefined ? parseFloat(String(productToSave.salePrice)) : undefined;
            const lineTotal = parseFloat((quantityToAdd * unitPrice).toFixed(2));

            if (!isNaN(lineTotal)) {
                calculatedInvoiceTotalAmountFromProducts += lineTotal;
            } else {
                console.warn(`Invalid lineTotal for product: ${productToSave.id || productToSave.catalogNumber}. Skipping for invoice total.`);
            }

            let existingIndex = -1;
            if (productToSave.id && !productToSave.id.includes('-new') && productToSave.id !== tempInvoiceId) {
                existingIndex = updatedInventory.findIndex(p => p.id === productToSave.id);
            }
            if (existingIndex === -1 && productToSave.barcode && productToSave.barcode.trim() !== '') {
                existingIndex = updatedInventory.findIndex(p => p.barcode === productToSave.barcode);
            }
            if (existingIndex === -1 && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                existingIndex = updatedInventory.findIndex(p => p.catalogNumber === productToSave.catalogNumber);
            }

            if (existingIndex !== -1) {
                const existingProduct = updatedInventory[existingIndex];
                existingProduct.quantity += quantityToAdd;
                existingProduct.unitPrice = unitPrice !== 0 ? unitPrice : existingProduct.unitPrice; // Use new price if valid
                existingProduct.description = productToSave.description || existingProduct.description;
                existingProduct.shortName = productToSave.shortName || existingProduct.shortName;
                existingProduct.barcode = productToSave.barcode || existingProduct.barcode;
                existingProduct.catalogNumber = productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A' ? productToSave.catalogNumber : existingProduct.catalogNumber;
                existingProduct.salePrice = salePrice !== undefined ? salePrice : existingProduct.salePrice;
                existingProduct.minStockLevel = productToSave.minStockLevel !== undefined ? productToSave.minStockLevel : existingProduct.minStockLevel;
                existingProduct.maxStockLevel = productToSave.maxStockLevel !== undefined ? productToSave.maxStockLevel : existingProduct.maxStockLevel;
                existingProduct.lineTotal = parseFloat((existingProduct.quantity * existingProduct.unitPrice).toFixed(2));
                console.log(`Updated existing product ID ${existingProduct.id}: Qty=${existingProduct.quantity}, UnitPrice=${existingProduct.unitPrice}, SalePrice=${existingProduct.salePrice}, LineTotal=${existingProduct.lineTotal}`);
            } else {
                if (!productToSave.catalogNumber && !productToSave.description && !productToSave.barcode) {
                    console.log("Skipping adding product with no identifier (catalog, description, or barcode):", productToSave);
                    return;
                }
                const newId = (productToSave.id && !productToSave.id.includes('-new') && productToSave.id !== tempInvoiceId)
                    ? productToSave.id
                    : `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

                const productToAdd: Product = {
                    ...productToSave,
                    id: newId,
                    quantity: quantityToAdd,
                    unitPrice: unitPrice,
                    salePrice: salePrice,
                    lineTotal: lineTotal,
                    catalogNumber: productToSave.catalogNumber || 'N/A',
                    description: productToSave.description || 'No Description',
                    shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                };
                updatedInventory.push(productToAdd);
                console.log(`Added new product with ID ${newId}:`, productToAdd);
            }
        });

        // Prune inventory if it exceeds max items before attempting to save
        if (updatedInventory.length > MAX_INVENTORY_ITEMS_STORAGE) {
            console.warn(`[finalizeSaveProductsService] Inventory count (${updatedInventory.length}) exceeds limit (${MAX_INVENTORY_ITEMS_STORAGE}). Pruning...`);
            // Sort by quantity (desc) and keep top N - this was the existing strategy in clearOldTemporaryScanData
            updatedInventory.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
            updatedInventory = updatedInventory.slice(0, MAX_INVENTORY_ITEMS_STORAGE);
            inventoryPruned = true; // Set flag
            console.log(`[finalizeSaveProductsService] Inventory pruned to ${updatedInventory.length} items.`);
        }

        saveStoredData(INVENTORY_STORAGE_KEY, updatedInventory);
        console.log('Updated localStorage inventory:', updatedInventory);

    } catch (error) {
        console.error("Error processing products for inventory:", error);
        productsProcessedSuccessfully = false;
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            throw error; // Re-throw to be caught by the component
        }
    }

    if (source === 'upload') {
        const finalStatus = productsProcessedSuccessfully ? 'completed' : 'error';
        const errorMessage = productsProcessedSuccessfully ? undefined : 'Failed to process some products into inventory.';

        const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && !isNaN(extractedTotalAmount))
                                        ? extractedTotalAmount
                                        : parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2));

        let invoiceIdToUse: string;
        let existingInvoiceIndex = -1;

        let finalFileName = originalFileName;
        if (finalSupplierName) {
            finalFileName = finalSupplierName;
            if (extractedInvoiceNumber) {
                finalFileName += `_${extractedInvoiceNumber}`;
            }
        } else if (extractedInvoiceNumber) {
            finalFileName = `Invoice_${extractedInvoiceNumber}`;
        }


        if (tempInvoiceId) {
            existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === tempInvoiceId);
        }


        if (existingInvoiceIndex !== -1 && tempInvoiceId) {
            invoiceIdToUse = tempInvoiceId;
            const existingRecord = currentInvoices[existingInvoiceIndex];
            currentInvoices[existingInvoiceIndex] = {
                ...existingRecord,
                fileName: finalFileName,
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber || existingRecord.invoiceNumber,
                supplier: finalSupplierName || existingRecord.supplier,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: imageUriForFinalRecord || existingRecord.originalImagePreviewUri,
                errorMessage: errorMessage,
            };
            console.log(`Updated invoice record ID: ${invoiceIdToUse} with final data. New FileName: ${finalFileName}`);
        } else {
            invoiceIdToUse = tempInvoiceId || `inv-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
            console.warn(`Creating new invoice record as tempInvoiceId "${tempInvoiceId}" was not found or not provided for update. New ID: ${invoiceIdToUse}`);
            const newInvoiceRecord: InvoiceHistoryItem = {
                id: invoiceIdToUse,
                fileName: finalFileName,
                uploadTime: new Date().toISOString(),
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber,
                supplier: finalSupplierName,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: imageUriForFinalRecord,
                errorMessage: errorMessage,
            };
            currentInvoices = [newInvoiceRecord, ...currentInvoices];
            console.log(`Created new invoice record ID: ${invoiceIdToUse} with final data. FileName: ${finalFileName}`);
        }

        try {
            saveStoredData(INVOICES_STORAGE_KEY, currentInvoices);
            console.log('Updated localStorage invoices:', currentInvoices);
        } catch (storageError) {
            console.error("Critical error saving invoices to localStorage:", storageError);
            const saveError = new Error(`Failed to save invoice history: ${(storageError as Error).message}`);
            (saveError as any).updatedBySaveProducts = true;
            throw saveError; // Re-throw to be caught by the component
        }

        if (!productsProcessedSuccessfully) {
            console.warn("[Backend - finalizeSaveProductsService] Product processing error occurred, invoice status set to 'error'.");
        }
    } else if (source.endsWith('_sync')) {
      console.log(`POS Sync (${source}) completed. Inventory updated. No invoice record created for this sync type.`);
    } else {
      console.log(`Skipping invoice history update for source: ${source}`);
    }
    return { inventoryPruned };
}


export async function getProductsService(): Promise<Product[]> {
  console.log("getProductsService called");
  await new Promise(resolve => setTimeout(resolve, 50));
  const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY);
  const inventoryWithDefaults = inventory.map(item => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const description = item.description || 'No Description';
      return {
        ...item,
        id: item.id || `prod-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        description: description,
        shortName: item.shortName || description.split(' ').slice(0, 3).join(' '),
        lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
        barcode: item.barcode || undefined,
        salePrice: item.salePrice ?? undefined,
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
   const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY);
   const product = inventory.find(p => p.id === productId);
   if (product) {
        const quantity = Number(product.quantity) || 0;
        const unitPrice = Number(product.unitPrice) || 0;
        const description = product.description || 'No Description';
        return {
           ...product,
           id: product.id || productId,
           description: description,
           shortName: product.shortName || description.split(' ').slice(0, 3).join(' '),
           lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
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

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY);
  const productIndex = currentInventory.findIndex(p => p.id === productId);

  if (productIndex === -1) {
    console.error(`Product with ID ${productId} not found for update.`);
    throw new Error(`Product with ID ${productId} not found.`);
  }

  const updatedProduct = {
    ...currentInventory[productIndex],
    ...updatedData,
    id: productId,
  };

   if (updatedData.quantity !== undefined || updatedData.unitPrice !== undefined) {
       const quantity = Number(updatedProduct.quantity) || 0;
       const unitPrice = Number(updatedProduct.unitPrice) || 0;
       updatedProduct.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
   }
    if (!updatedProduct.shortName) {
         const description = updatedProduct.description || 'No Description';
         updatedProduct.shortName = description.split(' ').slice(0, 3).join(' ');
    }
    updatedProduct.barcode = updatedProduct.barcode || undefined;
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

export async function deleteProductService(productId: string): Promise<void> {
  console.log(`deleteProductService called for ID: ${productId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY);
  const initialLength = currentInventory.length;
  const updatedInventory = currentInventory.filter(p => p.id !== productId);

  if (updatedInventory.length === initialLength) {
      console.warn(`Product with ID ${productId} not found for deletion (might be already deleted).`);
  }

  saveStoredData(INVENTORY_STORAGE_KEY, updatedInventory);
  console.log(`Product ${productId} deleted successfully.`);
}


export async function getInvoicesService(): Promise<InvoiceHistoryItem[]> {
  console.log("getInvoicesService called");
  await new Promise(resolve => setTimeout(resolve, 50));
  const invoicesRaw = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY);
  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    uploadTime: new Date(inv.uploadTime) // Ensure uploadTime is a Date object
  }));
  console.log("Returning invoices from localStorage:", invoices);
  return invoices;
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>): Promise<void> {
  console.log(`updateInvoiceService called for ID: ${invoiceId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY);
  const invoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceId);

  if (invoiceIndex === -1) {
    console.error(`Invoice with ID ${invoiceId} not found for update.`);
    throw new Error(`Invoice with ID ${invoiceId} not found.`);
  }

  const originalInvoice = currentInvoices[invoiceIndex];
  const finalUpdatedData: InvoiceHistoryItem = {
    ...originalInvoice,
    ...updatedData,
    id: invoiceId, // Ensure ID is not changed
    uploadTime: originalInvoice.uploadTime, // Keep original upload time
    // Retain existing invoiceDataUri (original scan) and originalImagePreviewUri (smaller preview)
    // if not explicitly changed or set to null by updatedData
    invoiceDataUri: updatedData.invoiceDataUri === null ? undefined : (updatedData.invoiceDataUri ?? originalInvoice.invoiceDataUri),
    originalImagePreviewUri: updatedData.originalImagePreviewUri === null ? undefined : (updatedData.originalImagePreviewUri ?? originalInvoice.originalImagePreviewUri),
    status: updatedData.status || originalInvoice.status, // Keep original status if not provided
  };

  currentInvoices[invoiceIndex] = finalUpdatedData;

  saveStoredData(INVOICES_STORAGE_KEY, currentInvoices);
  console.log(`Invoice ${invoiceId} updated successfully.`);
}


export async function deleteInvoiceService(invoiceId: string): Promise<void> {
  console.log(`deleteInvoiceService called for ID: ${invoiceId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY);
  const initialLength = currentInvoices.length;
  const updatedInvoices = currentInvoices.filter(inv => inv.id !== invoiceId);

  if (updatedInvoices.length === initialLength) {
    console.warn(`Invoice with ID ${invoiceId} not found for deletion (might be already deleted).`);
  }

  saveStoredData(INVOICES_STORAGE_KEY, updatedInvoices);
  console.log(`Invoice ${invoiceId} deleted successfully.`);
}


export async function clearInventoryService(): Promise<void> {
    console.log("clearInventoryService called");
    await new Promise(resolve => setTimeout(resolve, 100));
    saveStoredData(INVENTORY_STORAGE_KEY, []);
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

export async function registerService(userData: any): Promise<AuthResponse> {
  console.log("Registering user:", userData.username);
  await new Promise(resolve => setTimeout(resolve, 500));
  const newUser: User = {
    id: `user-${Date.now()}`,
    username: userData.username,
    email: userData.email,
  };
  return {
    token: 'mock_register_token_' + Date.now(),
    user: newUser,
  };
}

export async function loginService(credentials: any): Promise<AuthResponse> {
  console.log("Logging in user:", credentials.username);
  await new Promise(resolve => setTimeout(resolve, 500));
  if (!credentials.username || !credentials.password) {
    throw new Error("Username and password are required.");
  }
  const loggedInUser: User = {
    id: 'user-mock-123',
    username: credentials.username,
    email: `${credentials.username}@example.com`,
  };
  return {
    token: 'mock_login_token_' + Date.now(),
    user: loggedInUser,
  };
}


// --- Supplier Management ---
export async function getSupplierSummariesService(): Promise<SupplierSummary[]> {
  const invoices = await getInvoicesService();
  // Ensure initialDataIfKeyMissing is an empty array for suppliers
  const storedSuppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY, []);

  const supplierMap = new Map<string, SupplierSummary>();

  // Initialize map with suppliers from storage, even if they have no invoices yet
  storedSuppliers.forEach(s => {
    supplierMap.set(s.name, {
      name: s.name,
      invoiceCount: 0,
      totalSpent: 0,
      phone: s.phone,
      email: s.email
    });
  });

  // Aggregate invoice data
  invoices.forEach(invoice => {
    if (invoice.supplier && invoice.status === 'completed') {
      const existingSupplierSummary = supplierMap.get(invoice.supplier);
      if (existingSupplierSummary) {
        existingSupplierSummary.invoiceCount += 1;
        existingSupplierSummary.totalSpent += (invoice.totalAmount || 0);
      } else {
        // This case should ideally not happen if all suppliers are pre-loaded or created first.
        // However, as a fallback, create a new entry.
        supplierMap.set(invoice.supplier, {
          name: invoice.supplier,
          invoiceCount: 1,
          totalSpent: invoice.totalAmount || 0,
          phone: undefined, // No contact info if only found through invoices
          email: undefined
        });
      }
    }
  });

  return Array.from(supplierMap.values()).sort((a,b) => b.totalSpent - a.totalSpent);
}


export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string }): Promise<SupplierSummary> {
  console.log(`Creating new supplier: ${name}`, contactInfo);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY, []);

  if (suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Supplier with name "${name}" already exists.`);
  }

  const newSupplier = { name, ...contactInfo };
  suppliers.push(newSupplier);
  saveStoredData(SUPPLIERS_STORAGE_KEY, suppliers);

  console.log("New supplier created and saved to localStorage.");
  // Return the structure expected by SupplierSummary
  return { name, invoiceCount: 0, totalSpent: 0, ...contactInfo };
}

export async function deleteSupplierService(supplierName: string): Promise<void> {
  console.log(`Deleting supplier: ${supplierName}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY, []);
  const initialLength = suppliers.length;
  suppliers = suppliers.filter(s => s.name !== supplierName);

  if (suppliers.length === initialLength && initialLength > 0) {
     console.warn(`Supplier with name "${supplierName}" not found for deletion (might be already deleted).`);
     // Not throwing an error to allow UI to proceed smoothly if user tries to delete non-existent.
  }

  saveStoredData(SUPPLIERS_STORAGE_KEY, suppliers);
  console.log(`Supplier "${supplierName}" deleted from localStorage.`);
}


export async function updateSupplierContactInfoService(supplierName: string, contactInfo: { phone?: string; email?: string }): Promise<void> {
  console.log(`Updating contact info for supplier: ${supplierName}`, contactInfo);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY, []);
  const supplierIndex = suppliers.findIndex(s => s.name === supplierName);

  if (supplierIndex !== -1) {
    // Ensure only phone and email are updated, preserving other potential fields if any
    suppliers[supplierIndex] = {
      ...suppliers[supplierIndex],
      phone: contactInfo.phone,
      email: contactInfo.email,
      name: supplierName // Ensure name isn't accidentally changed if it was part of contactInfo
    };
  } else {
    // If supplier doesn't exist, create a new one
    console.log(`Supplier "${supplierName}" not found for update, creating new entry.`);
    suppliers.push({ name: supplierName, ...contactInfo });
  }
  saveStoredData(SUPPLIERS_STORAGE_KEY, suppliers);
  console.log("Supplier contact info saved to localStorage.");
}

/**
 * Clears temporary scan data for a specific scan session.
 * @param uniqueScanId The unique identifier for the scan session.
 */
export function clearTemporaryScanData(uniqueScanId: string) {
    if (typeof window === 'undefined') return;

    const dataKey = `${TEMP_DATA_KEY_PREFIX}${uniqueScanId}`;
    const originalImageKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${uniqueScanId}`;
    const compressedImageKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${uniqueScanId}`;

    console.log(`[LocalStorageCleanup] Clearing temporary data for uniqueScanId: ${uniqueScanId}`);

    localStorage.removeItem(dataKey);
    console.log(`[LocalStorageCleanup] Attempted to clear scan result: ${dataKey}`);

    localStorage.removeItem(originalImageKey);
    console.log(`[LocalStorageCleanup] Attempted to clear original image preview: ${originalImageKey}`);

    localStorage.removeItem(compressedImageKey);
    console.log(`[LocalStorageCleanup] Attempted to clear compressed image: ${compressedImageKey}`);
}


/**
 * Clears old temporary scan data and prunes main data stores if they exceed limits.
 * @param emergencyClear If true, attempts more aggressive clearing of temporary files.
 */
export function clearOldTemporaryScanData(emergencyClear: boolean = false) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000; // Milliseconds in a day
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  console.log(`[LocalStorageCleanup] Starting cleanup. Emergency mode: ${emergencyClear}`);

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(TEMP_DATA_KEY_PREFIX) || key.startsWith(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX) || key.startsWith(TEMP_COMPRESSED_IMAGE_KEY_PREFIX))) {
      const parts = key.split('_');
      // Find the part that looks like a timestamp (at least 13 digits)
      const timestampString = parts.find(part => /^\d{13,}$/.test(part));
      if (timestampString) {
        const timestamp = parseInt(timestampString, 10);
        if (!isNaN(timestamp) && (now - timestamp > oneDay)) { // Older than one day
          keysToRemove.push(key);
        }
      } else if (emergencyClear) { // If no timestamp and it's an emergency, consider removing
        keysToRemove.push(key);
      }
    }
  }

  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    itemsCleared++;
    console.log(`[LocalStorageCleanup] Cleared old/emergency temp scan item: ${key}`);
  });

  if (itemsCleared > 0) {
    console.log(`[LocalStorageCleanup] Cleared ${itemsCleared} old/emergency temporary scan data items.`);
  }

  // Prune main invoice history
  try {
    let currentInvoices: InvoiceHistoryItem[] = JSON.parse(localStorage.getItem(INVOICES_STORAGE_KEY) || '[]');
    if (currentInvoices.length > MAX_INVOICE_HISTORY_ITEMS) {
      // Sort by uploadTime descending to keep the most recent ones
      currentInvoices.sort((a,b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());
      const prunedInvoices = currentInvoices.slice(0, MAX_INVOICE_HISTORY_ITEMS);
      localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(prunedInvoices));
      console.log(`[LocalStorageCleanup] Pruned main invoice history to ${MAX_INVOICE_HISTORY_ITEMS} items.`);
    }
  } catch (e) {
    console.error("[LocalStorageCleanup] Error pruning main invoice history:", e);
  }

  // Prune inventory if it exceeds limit
  try {
    let currentInventory: Product[] = JSON.parse(localStorage.getItem(INVENTORY_STORAGE_KEY) || '[]');
    if (currentInventory.length > MAX_INVENTORY_ITEMS_STORAGE) {
      // Simple pruning: sort by quantity (descending) and keep the top N.
      // A more sophisticated strategy might be needed for real-world scenarios (e.g., last updated date)
      currentInventory.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
      const prunedInventory = currentInventory.slice(0, MAX_INVENTORY_ITEMS_STORAGE);
      localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(prunedInventory));
      console.log(`[LocalStorageCleanup] Pruned inventory to ${MAX_INVENTORY_ITEMS_STORAGE} items.`);
    }
  } catch (e) {
    console.error("[LocalStorageCleanup] Error pruning inventory:", e);
  }
}
