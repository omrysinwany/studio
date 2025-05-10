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
  originalImagePreviewUri?: string; // For display on edit/details page
  compressedImageForFinalRecordUri?: string; // For storage with final invoice record
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
}

export interface SupplierSummary {
  name: string;
  invoiceCount: number;
  totalSpent: number;
  phone?: string;
  email?: string;
}


const INVENTORY_STORAGE_KEY_BASE = 'inventoryData';
export const INVOICES_STORAGE_KEY_BASE = 'invoicesData';
const POS_SETTINGS_STORAGE_KEY_BASE = 'posSettings';
const SUPPLIERS_STORAGE_KEY_BASE = 'suppliersData';


export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';


export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.7 * 1024 * 1024; // 0.7MB
export const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.25 * 1024 * 1024; // 0.25MB
export const MAX_SCAN_RESULTS_SIZE_BYTES = 1 * 1024 * 1024; // 1MB For the JSON data
export const MAX_INVENTORY_ITEMS = 1000;
export const MAX_INVOICE_HISTORY_ITEMS = 100;


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

const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(`[getStorageKey Backend] Attempted to get storage key for base "${baseKey}" without a userId. This will use a generic key.`);
    return baseKey;
  }
  return `${baseKey}_${userId}`;
};


const getStoredData = <T extends {id?: string; name?: string}>(keyBase: string, userId?: string): T[] => {
  if (typeof window === 'undefined') return [];
  const storageKey = getStorageKey(keyBase, userId);
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsedData = JSON.parse(stored) as T[];
      // Ensure IDs for items loaded from storage
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || (item.name ? `${keyBase}-${item.name.replace(/\s+/g, '_')}-${index}` : `${keyBase}-item-${Date.now()}-${index}`)
      }));
    }
    // If no data, initialize with empty array to avoid issues later
    localStorage.setItem(storageKey, JSON.stringify([])); 
    return [];
  } catch (error) {
    console.error(`Error reading ${storageKey} from localStorage:`, error);
    return [];
  }
};

const getStoredObject = <T>(keyBase: string, userId?: string, initialData?: T): T | null => {
    if (typeof window === 'undefined') return initialData ?? null;
    const storageKey = getStorageKey(keyBase, userId);
    try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
            return JSON.parse(stored);
        } else if (initialData !== undefined) {
            localStorage.setItem(storageKey, JSON.stringify(initialData));
            return initialData;
        }
        return null;
    } catch (error) {
        console.error(`Error reading object ${storageKey} from localStorage:`, error);
        return initialData ?? null;
    }
};

const saveStoredData = (keyBase: string, data: any, userId?: string): boolean => {
  if (typeof window === 'undefined') {
    console.warn(`[saveStoredData Backend] localStorage is not available. Data for key base "${keyBase}" not saved.`);
    return false;
  }
  const storageKey = getStorageKey(keyBase, userId);
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
    console.log(`[saveStoredData Backend] Successfully saved data for key: ${storageKey}`);
    return true;
  } catch (error) {
    console.error(`[saveStoredData Backend] Error writing to localStorage for key ${storageKey}:`, error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.includes('exceeded the quota'))) {
      console.warn(`[saveStoredData Backend] Quota exceeded for key ${storageKey}. Attempting to clear old temporary scan data and retry...`);
      try {
        clearOldTemporaryScanData(true, userId); 
        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log(`[saveStoredData Backend] Successfully saved data for key ${storageKey} after cleanup.`);
        return true;
      } catch (retryError) {
        console.error(`[saveStoredData Backend] Error writing ${storageKey} to localStorage even after cleanup:`, retryError);
        throw error; 
      }
    } else {
      throw error; 
    }
  }
};


export async function checkProductPricesBeforeSaveService(
    productsToCheck: Product[],
    userId?: string, 
    tempId?: string,
): Promise<PriceCheckResult> {
    console.log(`[checkProductPricesBeforeSaveService] Products to check: ${productsToCheck.length}, UserID: ${userId}, TempID: ${tempId}`);
    await new Promise(resolve => setTimeout(resolve, 50));

    const currentInventory = await getProductsService(userId); // Pass userId
    const productsToSaveDirectly: Product[] = [];
    const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

    for (const scannedProduct of productsToCheck) {
        const quantityFromScan = parseFloat(String(scannedProduct.quantity)) || 0;
        const lineTotalFromScan = parseFloat(String(scannedProduct.lineTotal)) || 0;
        let unitPriceFromScan = parseFloat(String(scannedProduct.unitPrice)) || 0;

        if (unitPriceFromScan === 0 && quantityFromScan !== 0 && lineTotalFromScan !== 0) {
            unitPriceFromScan = parseFloat((lineTotalFromScan / quantityFromScan).toFixed(2));
        }

        let existingIndex = -1;
        if (scannedProduct.catalogNumber && scannedProduct.catalogNumber !== 'N/A') {
            existingIndex = currentInventory.findIndex(p => p.catalogNumber === scannedProduct.catalogNumber);
        }
        if (existingIndex === -1 && scannedProduct.barcode && scannedProduct.barcode.trim() !== '') {
            existingIndex = currentInventory.findIndex(p => p.barcode === scannedProduct.barcode);
        }
        // More robust ID check, ensure it's not a temporary ID before matching by ID
        if (existingIndex === -1 && scannedProduct.id && !scannedProduct.id.startsWith('prod-temp-') && !scannedProduct.id.includes('-new')) {
            existingIndex = currentInventory.findIndex(p => p.id === scannedProduct.id);
        }


        if (existingIndex !== -1) {
            const existingProduct = currentInventory[existingIndex];
            const existingUnitPrice = existingProduct.unitPrice;

            if (unitPriceFromScan !== 0 && Math.abs(existingUnitPrice - unitPriceFromScan) > 0.001) {
                console.log(`[checkProductPricesBeforeSaveService] Price discrepancy for product ID ${existingProduct.id}. Existing: ${existingUnitPrice}, New: ${unitPriceFromScan}`);
                priceDiscrepancies.push({
                    ...scannedProduct,
                    id: existingProduct.id, 
                    existingUnitPrice: existingUnitPrice,
                    newUnitPrice: unitPriceFromScan,
                    salePrice: scannedProduct.salePrice ?? existingProduct.salePrice, 
                });
            } else {
                productsToSaveDirectly.push({
                    ...scannedProduct,
                    id: existingProduct.id, 
                    unitPrice: existingUnitPrice, // Keep existing unit price if no discrepancy or new price is 0
                    salePrice: scannedProduct.salePrice ?? existingProduct.salePrice,
                });
            }
        } else {
             console.log(`[checkProductPricesBeforeSaveService] New product: ${scannedProduct.catalogNumber || scannedProduct.description}. Unit price: ${unitPriceFromScan}`);
            productsToSaveDirectly.push({
                ...scannedProduct,
                unitPrice: unitPriceFromScan,
            });
        }
    }
    return { productsToSaveDirectly, priceDiscrepancies };
}

export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileName: string,
    source: string = 'upload',
    userId?: string,
    tempInvoiceId?: string,
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number
): Promise<{ inventoryPruned: boolean; uniqueScanIdToClear?: string }> {
    
    const uniqueScanIdToClear = (tempInvoiceId && userId) ? tempInvoiceId.replace(`pending-inv-${userId}_`, '') : undefined;

    console.log(`[finalizeSaveProductsService] START. UserID: "${userId}", TempInvoiceID: "${tempInvoiceId}", Source: "${source}", File: "${originalFileName}"`);
    console.log(`[finalizeSaveProductsService] Received productsToFinalizeSave (count: ${productsToFinalizeSave.length}):`, JSON.stringify(productsToFinalizeSave.slice(0, 2), null, 2)); // Log first 2 products for brevity
    
    if ((source === 'upload' || source.endsWith('_sync')) && !userId) {
      console.error("[finalizeSaveProductsService] UserID is required for this operation but was not provided.");
      const authError = new Error("User authentication is required to save products and invoice history.");
      (authError as any).uniqueScanIdToClear = uniqueScanIdToClear;
      throw authError;
    }

    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async operation

    let currentInventory = await getProductsService(userId);
    let currentInvoices = await getInvoicesService(userId);
    console.log(`[finalizeSaveProductsService] Initial inventory count for user ${userId}: ${currentInventory.length}`);


    let calculatedInvoiceTotalAmountFromProducts = 0;
    let productsProcessedSuccessfully = true;
    let inventoryPruned = false;
    let updatedInventory = [...currentInventory]; // Make a mutable copy

    try {
        if (productsToFinalizeSave.length === 0 && source === 'upload') {
            console.warn("[finalizeSaveProductsService] No products in productsToFinalizeSave for 'upload' source. Inventory will not be changed.");
        }

        productsToFinalizeSave.forEach((productToSave, index) => {
            console.log(`[finalizeSaveProductsService] Processing product ${index + 1}/${productsToFinalizeSave.length}:`, JSON.stringify(productToSave, null, 2));
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            let unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
            const salePrice = productToSave.salePrice !== undefined && !isNaN(parseFloat(String(productToSave.salePrice))) ? parseFloat(String(productToSave.salePrice)) : undefined;
            let lineTotal = parseFloat(String(productToSave.lineTotal)) || 0;

            // Recalculate unitPrice or lineTotal if one is missing but others are present
            if (quantityToAdd !== 0 && unitPrice !== 0 && lineTotal === 0) { 
                lineTotal = parseFloat((quantityToAdd * unitPrice).toFixed(2));
                 console.log(`[finalizeSaveProductsService] Product ${productToSave.id || productToSave.catalogNumber}: Calculated lineTotal: ${lineTotal}`);
            } else if (quantityToAdd !== 0 && lineTotal !== 0 && unitPrice === 0) {
                unitPrice = parseFloat((lineTotal / quantityToAdd).toFixed(2));
                console.log(`[finalizeSaveProductsService] Product ${productToSave.id || productToSave.catalogNumber}: Calculated unitPrice: ${unitPrice}`);
            }

            if (!isNaN(lineTotal)) {
                calculatedInvoiceTotalAmountFromProducts += lineTotal;
            }

            let existingIndex = -1;
            // Prioritize matching by actual ID if available (e.g., from POS sync where ID is stable, or if product was previously saved)
            if (productToSave.id && !productToSave.id.startsWith('prod-temp-') && !productToSave.id.includes('-new')) {
                 existingIndex = updatedInventory.findIndex(p => p.id === productToSave.id);
                 if(existingIndex !== -1) console.log(`[finalizeSaveProductsService] Matched by ID: ${productToSave.id}`);
            }
            if (existingIndex === -1 && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                existingIndex = updatedInventory.findIndex(p => p.catalogNumber === productToSave.catalogNumber);
                 if(existingIndex !== -1) console.log(`[finalizeSaveProductsService] Matched by CatalogNumber: ${productToSave.catalogNumber}`);
            }
            if (existingIndex === -1 && productToSave.barcode && productToSave.barcode.trim() !== '') {
                existingIndex = updatedInventory.findIndex(p => p.barcode === productToSave.barcode);
                if(existingIndex !== -1) console.log(`[finalizeSaveProductsService] Matched by Barcode: ${productToSave.barcode}`);
            }


            if (existingIndex !== -1) {
                const existingProduct = updatedInventory[existingIndex];
                console.log(`[finalizeSaveProductsService] Updating existing product ID ${existingProduct.id}. Current Qty: ${existingProduct.quantity}, Qty to Add: ${quantityToAdd}, New UnitPrice: ${unitPrice}`);
                
                // Preserve existing data unless explicitly overridden by productToSave
                existingProduct.quantity += quantityToAdd; // Add to existing quantity
                existingProduct.unitPrice = unitPrice; // Always update with the price from the invoice (could be from discrepancy resolution)
                existingProduct.description = productToSave.description || existingProduct.description;
                existingProduct.shortName = productToSave.shortName || existingProduct.shortName;
                existingProduct.barcode = productToSave.barcode || existingProduct.barcode; // Keep existing if new is empty
                existingProduct.catalogNumber = (productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') ? productToSave.catalogNumber : existingProduct.catalogNumber;
                existingProduct.salePrice = salePrice !== undefined ? salePrice : existingProduct.salePrice;
                existingProduct.minStockLevel = productToSave.minStockLevel !== undefined ? productToSave.minStockLevel : existingProduct.minStockLevel;
                existingProduct.maxStockLevel = productToSave.maxStockLevel !== undefined ? productToSave.maxStockLevel : existingProduct.maxStockLevel;
                existingProduct.lineTotal = parseFloat((existingProduct.quantity * existingProduct.unitPrice).toFixed(2)); // Recalculate based on total quantity and current unit price
                console.log(`[finalizeSaveProductsService] Product ${existingProduct.id} updated. New Qty: ${existingProduct.quantity}, New LineTotal: ${existingProduct.lineTotal}`);
            } else {
                // Product is new, add it to inventory
                if (!productToSave.catalogNumber && !productToSave.description && !productToSave.barcode) {
                     console.warn("[finalizeSaveProductsService] Skipping adding product with no identifier:", productToSave);
                    return; // Skip this product if it has no identifiers
                }
                const newId = `prod-${Date.now()}-${userId ? userId.slice(0,3) : 'guest'}-${Math.random().toString(36).substring(2, 7)}`;
                const newProductEntry: Product = {
                    ...productToSave, // spread productToSave first to get all its properties
                    id: newId, // then override id
                    quantity: quantityToAdd,
                    unitPrice: unitPrice,
                    salePrice: salePrice,
                    lineTotal: lineTotal, // Use calculated/provided lineTotal for a new product
                    catalogNumber: productToSave.catalogNumber || 'N/A',
                    description: productToSave.description || 'No Description',
                    shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                    minStockLevel: productToSave.minStockLevel,
                    maxStockLevel: productToSave.maxStockLevel,
                };
                updatedInventory.push(newProductEntry);
                 console.log(`[finalizeSaveProductsService] Added NEW product with ID ${newId}:`, JSON.stringify(newProductEntry, null, 2));
            }
        });

        console.log(`[finalizeSaveProductsService] Inventory count after processing for user ${userId}: ${updatedInventory.length}`);
        console.log(`[finalizeSaveProductsService] Updated inventory content (first 2 items):`, JSON.stringify(updatedInventory.slice(0,2), null, 2));
        
        if (updatedInventory.length > MAX_INVENTORY_ITEMS) {
            // Optional: sort by a meaningful field before slicing if needed
            updatedInventory.sort((a, b) => (b.quantity || 0) - (a.quantity || 0)); // Example: keep most stocked items
            updatedInventory = updatedInventory.slice(0, MAX_INVENTORY_ITEMS);
            inventoryPruned = true;
             console.warn(`[finalizeSaveProductsService] Inventory pruned to ${MAX_INVENTORY_ITEMS} items for user ${userId}.`);
        }

        const inventorySaveSuccess = saveStoredData(INVENTORY_STORAGE_KEY_BASE, updatedInventory, userId);
        if (!inventorySaveSuccess) {
            productsProcessedSuccessfully = false;
            console.error(`[finalizeSaveProductsService] FAILED to save updated inventory for user ${userId}.`);
            const inventorySaveError = new Error("Failed to save updated inventory data to storage.");
            (inventorySaveError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw inventorySaveError;
        }
        console.log(`[finalizeSaveProductsService] Successfully saved updated inventory for user ${userId}. Final count: ${updatedInventory.length}`);

    } catch (error) {
        console.error(`[finalizeSaveProductsService] Error during product processing or inventory save for user ${userId}:`, error);
        productsProcessedSuccessfully = false; // Mark as failed if any error occurs in the try block
        // Ensure uniqueScanIdToClear is attached to the error object before re-throwing
        const processingError = error instanceof Error ? error : new Error(`Failed to process/save products: Unknown error`);
        if (!(processingError as any).uniqueScanIdToClear) { // Check if it's already set
            (processingError as any).uniqueScanIdToClear = uniqueScanIdToClear;
        }
        throw processingError;
    }

    // Handle invoice record saving only if the source is 'upload' and userId is present
    if (source === 'upload' && userId) { // Ensure userId is present for invoice operations
        // Determine final status based on product processing success and if any products were expected
        const finalStatus = productsToFinalizeSave.length === 0 && !extractedTotalAmount ? 'error' : (productsProcessedSuccessfully ? 'completed' : 'error');
        const errorMessageOnProductFail = !productsProcessedSuccessfully ? 'Failed to process some products into inventory. Invoice may be incomplete.' : (productsToFinalizeSave.length === 0 && !extractedTotalAmount ? 'No products found in scan and no total amount provided.' : undefined);
        
        const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && !isNaN(extractedTotalAmount))
                                        ? extractedTotalAmount
                                        : parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2));
        
        let finalGeneratedFileName = originalFileName;
        if (finalSupplierName && finalSupplierName.trim() !== '') {
            finalGeneratedFileName = finalSupplierName.trim();
            if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
                finalGeneratedFileName += `_${extractedInvoiceNumber.trim()}`;
            }
        } else if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
            finalGeneratedFileName = `Invoice_${extractedInvoiceNumber.trim()}`;
        }


        if (!tempInvoiceId) { // tempInvoiceId should always be present for 'upload' source if userId is.
            const msg = `CRITICAL: tempInvoiceId is missing for source 'upload', UserID: ${userId}. File: ${originalFileName}. Cannot update/create invoice status.`;
            console.error(`[finalizeSaveProductsService] ${msg}`);
            // This scenario is critical, potentially indicating a flaw in how tempInvoiceId is passed.
            // We still attempt to clear data if possible, but this needs investigation.
            const criticalError = new Error("Failed to finalize invoice record: Missing temporary ID. Inventory might be updated, but the document status is not. Please check manually.");
            (criticalError as any).isInvoiceSaveError = true;
            (criticalError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw criticalError;
        }

        const existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === tempInvoiceId);
        // Retrieve URIs from localStorage using the uniqueScanIdToClear
        const imagePreviewUri = uniqueScanIdToClear ? (localStorage.getItem(`${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${userId}_${uniqueScanIdToClear}`) || undefined) : undefined;
        const compressedImageUri = uniqueScanIdToClear ? (localStorage.getItem(`${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${userId}_${uniqueScanIdToClear}`) || undefined) : undefined;


        if (existingInvoiceIndex !== -1) {
            const existingRecord = currentInvoices[existingInvoiceIndex];
            currentInvoices[existingInvoiceIndex] = {
                ...existingRecord,
                fileName: finalGeneratedFileName, // Update with potentially new name
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber || existingRecord.invoiceNumber,
                supplier: finalSupplierName || existingRecord.supplier,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: imagePreviewUri, // Use retrieved or existing
                compressedImageForFinalRecordUri: compressedImageUri, // Use retrieved or existing
                errorMessage: errorMessageOnProductFail || existingRecord.errorMessage, // Prioritize new error message
                paymentStatus: existingRecord.paymentStatus || 'unpaid', // Ensure paymentStatus is preserved or defaulted
            };
            console.log(`[finalizeSaveProductsService] Updated invoice record ID: ${tempInvoiceId} to status: ${finalStatus} for user ${userId}.`);
        } else {
            // This case might happen if the pending record wasn't created due to an earlier error (e.g., quota)
            console.warn(`[finalizeSaveProductsService] Pending invoice with ID "${tempInvoiceId}" NOT found for user "${userId}". File: ${originalFileName}. Creating a new invoice record. This may indicate an earlier issue.`);
            const newInvoiceId = `inv-${Date.now()}-${userId.slice(0,3)}-fallback`; // Ensure a unique ID
            const newInvoiceRecord: InvoiceHistoryItem = {
                id: newInvoiceId,
                fileName: finalGeneratedFileName,
                uploadTime: new Date().toISOString(), // Use current time for new record
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber,
                supplier: finalSupplierName,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: imagePreviewUri,
                compressedImageForFinalRecordUri: compressedImageUri,
                errorMessage: errorMessageOnProductFail || "Pending record was missing, created as new.",
                paymentStatus: 'unpaid',
            };
            currentInvoices.push(newInvoiceRecord);
             console.log(`[finalizeSaveProductsService] Created NEW fallback invoice record ID: ${newInvoiceId} with status: ${finalStatus} for user ${userId}.`);
        }

        // Prune invoice history if it exceeds the limit
        if (currentInvoices.length > MAX_INVOICE_HISTORY_ITEMS) {
            console.warn(`[finalizeSaveProductsService] Invoice history count (${currentInvoices.length}) exceeds limit (${MAX_INVOICE_HISTORY_ITEMS}) for user ${userId}. Pruning...`);
            currentInvoices.sort((a,b) => new Date(b.uploadTime as string).getTime() - new Date(a.uploadTime as string).getTime()); // Sort by most recent first
            currentInvoices = currentInvoices.slice(0, MAX_INVOICE_HISTORY_ITEMS);
        }

        try {
            const invoiceSaveSuccess = saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
            if(!invoiceSaveSuccess) {
                // If invoice save fails, it's a critical issue. The inventory might have saved.
                throw new Error("Failed to save updated invoice history to storage.");
            }
            console.log(`[finalizeSaveProductsService] Successfully updated invoice history for user ${userId}.`);
        } catch (storageError) {
            console.error(`[finalizeSaveProductsService] Critical error saving updated invoices to localStorage for user ${userId}:`, storageError);
            // Attach uniqueScanIdToClear to the error so the caller can attempt cleanup
            const saveInvoiceError = new Error(`Failed to save invoice history: ${(storageError as Error).message}`);
            (saveInvoiceError as any).isInvoiceSaveError = true; // Custom flag
            (saveInvoiceError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw saveInvoiceError;
        }

    } else if (source.endsWith('_sync')) {
      console.log(`[finalizeSaveProductsService] POS Sync (${source}) completed for user ${userId}. Inventory updated. No invoice record created for this sync type.`);
    } else {
      console.log(`[finalizeSaveProductsService] Skipping invoice history update for source: ${source} (UserID: ${userId})`);
    }
    
    // Clear temporary data associated with this scan, regardless of intermediate success/failure, if uniqueScanIdToClear is available
     if (uniqueScanIdToClear && userId) {
        console.log(`[finalizeSaveProductsService] About to call clearTemporaryScanData for UserID: ${userId}, UniqueScanID: ${uniqueScanIdToClear}`);
        clearTemporaryScanData(uniqueScanIdToClear, userId); // This now uses userId too
    } else {
        console.warn(`[finalizeSaveProductsService] Not calling clearTemporaryScanData. uniqueScanIdToClear: ${uniqueScanIdToClear}, userId: ${userId}`);
    }

    console.log(`[finalizeSaveProductsService] END. InventoryPruned: ${inventoryPruned}, UniqueScanIdToClear: ${uniqueScanIdToClear}`);
    return { inventoryPruned, uniqueScanIdToClear };
}


export async function getProductsService(userId?: string): Promise<Product[]> { 
  if (!userId) {
    console.warn("[getProductsService] Called without userId. Returning empty inventory. Ensure userId is passed for user-specific data.");
    return [];
  }
  // console.log("[getProductsService] Called for userId:", userId);
  await new Promise(resolve => setTimeout(resolve, 50));
  const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY_BASE, userId);
  const inventoryWithDefaults = inventory.map(item => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const description = item.description || 'No Description';
      return {
        ...item,
        id: item.id || `prod-get-${Date.now()}-${userId.slice(0,3)}-${Math.random().toString(36).substring(2, 9)}`,
        description: description,
        shortName: item.shortName || description.split(' ').slice(0, 3).join(' '),
        lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
        barcode: item.barcode || undefined,
        salePrice: item.salePrice ?? undefined,
        minStockLevel: item.minStockLevel ?? undefined,
        maxStockLevel: item.maxStockLevel ?? undefined,
      };
  });
  // console.log(`[getProductsService] Returning inventory for user ${userId}. Count: ${inventoryWithDefaults.length}`);
  return inventoryWithDefaults;
}

export async function getProductByIdService(productId: string, userId?: string): Promise<Product | null> {
   if (!userId) {
    console.warn(`[getProductByIdService] Called for ID: ${productId} without userId. Cannot retrieve product.`);
    return null;
   }
   // console.log(`[getProductByIdService] Called for ID: ${productId}, UserID: ${userId}`);
   await new Promise(resolve => setTimeout(resolve, 50));
   const inventory = await getProductsService(userId); 
   const product = inventory.find(p => p.id === productId);
   return product || null; 
}


export async function updateProductService(productId: string, updatedData: Partial<Product>, userId?: string): Promise<void> {
  if (!userId) {
    console.error(`[updateProductService] UserID is required to update product ${productId}. Aborting.`);
    throw new Error("User authentication is required to update products.");
  }
  // console.log(`[updateProductService] Called for ID: ${productId}, UserID: ${userId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = await getProductsService(userId); 
  const productIndex = currentInventory.findIndex(p => p.id === productId);

  if (productIndex === -1) {
    console.error(`[updateProductService] Product with ID ${productId} not found for user ${userId}.`);
    throw new Error(`Product with ID ${productId} not found.`);
  }

  const existingProduct = currentInventory[productIndex];
  const productAfterUpdateAttempt: Product = { 
    ...existingProduct, 
    ...updatedData,     
    id: productId,      
  };

   if (updatedData.quantity !== undefined || updatedData.unitPrice !== undefined) {
       const quantity = Number(productAfterUpdateAttempt.quantity) || 0;
       const unitPrice = Number(productAfterUpdateAttempt.unitPrice) || 0;
       productAfterUpdateAttempt.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
   }
    if (!productAfterUpdateAttempt.shortName) {
         const description = productAfterUpdateAttempt.description || 'No Description';
         productAfterUpdateAttempt.shortName = description.split(' ').slice(0, 3).join(' ');
    }
    productAfterUpdateAttempt.barcode = updatedData.barcode === null ? undefined : (updatedData.barcode ?? existingProduct.barcode);
    
    productAfterUpdateAttempt.salePrice = updatedData.salePrice === null || updatedData.salePrice === undefined
                              ? undefined
                              : (Number.isFinite(Number(updatedData.salePrice)) ? Number(updatedData.salePrice) : existingProduct.salePrice);

    productAfterUpdateAttempt.minStockLevel = updatedData.minStockLevel === null || updatedData.minStockLevel === undefined
                                  ? undefined
                                  : (Number.isFinite(Number(updatedData.minStockLevel)) ? Number(updatedData.minStockLevel) : existingProduct.minStockLevel);

    productAfterUpdateAttempt.maxStockLevel = updatedData.maxStockLevel === null || updatedData.maxStockLevel === undefined
                                  ? undefined
                                  : (Number.isFinite(Number(updatedData.maxStockLevel)) ? Number(updatedData.maxStockLevel) : existingProduct.maxStockLevel);


  currentInventory[productIndex] = productAfterUpdateAttempt;

  saveStoredData(INVENTORY_STORAGE_KEY_BASE, currentInventory, userId);
  // console.log(`[updateProductService] Product ${productId} updated successfully for user ${userId}.`);
}

export async function deleteProductService(productId: string, userId?: string): Promise<void> {
  if (!userId) {
    console.error(`[deleteProductService] UserID is required to delete product ${productId}. Aborting.`);
    throw new Error("User authentication is required to delete products.");
  }
  // console.log(`[deleteProductService] Called for ID: ${productId}, UserID: ${userId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = await getProductsService(userId);
  const initialLength = currentInventory.length;
  const updatedInventory = currentInventory.filter(p => p.id !== productId);

  if (updatedInventory.length === initialLength && currentInventory.some(p => p.id === productId) ) { 
    console.warn(`[deleteProductService] Product with ID ${productId} was found but not removed for user ${userId}. This is unexpected.`);
  } else if (updatedInventory.length === initialLength && !currentInventory.some(p => p.id === productId)){
     console.warn(`[deleteProductService] Product with ID ${productId} not found for deletion for user ${userId}.`);
  }

  saveStoredData(INVENTORY_STORAGE_KEY_BASE, updatedInventory, userId);
  // console.log(`[deleteProductService] Product ${productId} delete attempt processed for user ${userId}. New count: ${updatedInventory.length}`);
}


export async function getInvoicesService(userId?: string): Promise<InvoiceHistoryItem[]> {
  if (!userId) {
    console.warn("[getInvoicesService] Called without userId. Returning empty invoice list. Ensure userId is passed for user-specific data.");
    return [];
  }
  // console.log("[getInvoicesService] Called for userId:", userId);
  await new Promise(resolve => setTimeout(resolve, 50));
  const invoicesRaw = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY_BASE, userId);
  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${userId.slice(0,3)}-${Math.random().toString(36).substring(2, 9)}`,
    uploadTime: inv.uploadTime instanceof Date ? inv.uploadTime.toISOString() : new Date(inv.uploadTime).toISOString(),
    paymentStatus: inv.paymentStatus || 'unpaid', // Default to unpaid if not set
  }));
  // console.log(`[getInvoicesService] Returning invoices for user ${userId}. Count: ${invoices.length}`);
  return invoices;
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId?: string): Promise<void> {
  if (!userId) {
    console.error(`[updateInvoiceService] UserID is required to update invoice ${invoiceId}. Aborting.`);
    throw new Error("User authentication is required to update invoices.");
  }
  // console.log(`[updateInvoiceService] Called for ID: ${invoiceId}, UserID: ${userId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = await getInvoicesService(userId);
  const invoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceId);

  if (invoiceIndex === -1) {
    console.error(`[updateInvoiceService] Invoice with ID ${invoiceId} not found for user ${userId}.`);
    throw new Error(`Invoice with ID ${invoiceId} not found.`);
  }

  const originalInvoice = currentInvoices[invoiceIndex];
  const finalUpdatedData: InvoiceHistoryItem = {
    ...originalInvoice,
    ...updatedData,
    id: invoiceId, 
    uploadTime: originalInvoice.uploadTime, // Keep original upload time
    // Ensure URIs are handled correctly: null means delete, undefined means keep, string means update
    originalImagePreviewUri: updatedData.originalImagePreviewUri === null ? undefined : (updatedData.originalImagePreviewUri ?? originalInvoice.originalImagePreviewUri),
    compressedImageForFinalRecordUri: updatedData.compressedImageForFinalRecordUri === null ? undefined : (updatedData.compressedImageForFinalRecordUri ?? originalInvoice.compressedImageForFinalRecordUri),
    status: updatedData.status || originalInvoice.status, // Keep original status if not provided
    paymentStatus: updatedData.paymentStatus || originalInvoice.paymentStatus || 'unpaid',
  };

  currentInvoices[invoiceIndex] = finalUpdatedData;

  saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
  // console.log(`[updateInvoiceService] Invoice ${invoiceId} updated successfully for user ${userId}.`);
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId?: string): Promise<void> {
  if (!userId) {
    console.error(`[updateInvoicePaymentStatusService] UserID is required to update payment status for invoice ${invoiceId}. Aborting.`);
    throw new Error("User authentication is required to update payment status.");
  }
  // console.log(`[updateInvoicePaymentStatusService] Called for ID: ${invoiceId}, UserID: ${userId}, new status: ${paymentStatus}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = await getInvoicesService(userId);
  const invoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceId);

  if (invoiceIndex === -1) {
    console.error(`[updateInvoicePaymentStatusService] Invoice with ID ${invoiceId} not found for user ${userId}.`);
    throw new Error(`Invoice with ID ${invoiceId} not found.`);
  }

  currentInvoices[invoiceIndex].paymentStatus = paymentStatus;

  saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
  // console.log(`[updateInvoicePaymentStatusService] Payment status for invoice ${invoiceId} updated to ${paymentStatus} for user ${userId}.`);
}


export async function deleteInvoiceService(invoiceId: string, userId?: string): Promise<void> {
  if (!userId) {
    console.error(`[deleteInvoiceService] UserID is required to delete invoice ${invoiceId}. Aborting.`);
    throw new Error("User authentication is required to delete invoices.");
  }
  // console.log(`[deleteInvoiceService] Called for ID: ${invoiceId}, UserID: ${userId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = await getInvoicesService(userId);
  const initialLength = currentInvoices.length;
  const updatedInvoices = currentInvoices.filter(inv => inv.id !== invoiceId);

  if (updatedInvoices.length === initialLength && currentInvoices.some(inv => inv.id === invoiceId) ) { 
    console.warn(`[deleteInvoiceService] Invoice with ID ${invoiceId} was found but not removed for user ${userId}.`);
  } else if (updatedInvoices.length === initialLength && !currentInvoices.some(inv => inv.id === invoiceId)) {
     console.warn(`[deleteInvoiceService] Invoice with ID ${invoiceId} not found for deletion for user ${userId}.`);
  }

  saveStoredData(INVOICES_STORAGE_KEY_BASE, updatedInvoices, userId);
  // console.log(`[deleteInvoiceService] Invoice ${invoiceId} delete attempt processed for user ${userId}. New count: ${updatedInvoices.length}`);
}


export async function clearInventoryService(userId?: string): Promise<void> {
    if (!userId) {
        console.error("[clearInventoryService] UserID is required to clear inventory. Aborting.");
        throw new Error("User authentication is required to clear inventory.");
    }
    // console.log("[clearInventoryService] Called for userId:", userId);
    await new Promise(resolve => setTimeout(resolve, 100));
    saveStoredData(INVENTORY_STORAGE_KEY_BASE, [], userId);
    // console.log("[clearInventoryService] Inventory cleared from localStorage for user:", userId);
}


// --- POS Settings Management ---
export async function savePosSettingsService(systemId: string, config: PosConnectionConfig, userId?: string): Promise<void> {
    if (!userId) {
        console.error("[savePosSettingsService] UserID is required to save POS settings. Aborting.");
        throw new Error("User authentication is required to save POS settings.");
    }
    // console.log(`[savePosSettingsService] Saving POS settings for ${systemId}, UserID: ${userId}`, config);
    await new Promise(resolve => setTimeout(resolve, 100));
    const settings: StoredPosSettings = { systemId, config };
    saveStoredData(POS_SETTINGS_STORAGE_KEY_BASE, settings, userId);
}

export async function getPosSettingsService(userId?: string): Promise<StoredPosSettings | null> {
  if (typeof window === 'undefined') {
    // console.warn("[getPosSettingsService] Called from server-side or without window. Returning null.");
    return null;
  }
  if (!userId) {
    console.warn("[getPosSettingsService] Called without userId. Returning null as POS settings are user-specific.");
    return null;
  }
  // console.log("[getPosSettingsService] Retrieving POS settings for UserID:", userId);
  await new Promise(resolve => setTimeout(resolve, 50));
  return getStoredObject<StoredPosSettings>(POS_SETTINGS_STORAGE_KEY_BASE, userId);
}

export async function clearPosSettingsService(userId?: string): Promise<void> {
    if (typeof window === 'undefined') {
        // console.warn("[clearPosSettingsService] localStorage not available. POS settings not cleared.");
        return;
    }
    if (!userId) {
        console.error("[clearPosSettingsService] UserID is required to clear POS settings. Aborting.");
        throw new Error("User authentication is required to clear POS settings.");
    }
    // console.log("[clearPosSettingsService] Clearing POS settings for UserID:", userId);
    await new Promise(resolve => setTimeout(resolve, 50));
    const storageKey = getStorageKey(POS_SETTINGS_STORAGE_KEY_BASE, userId);
    localStorage.removeItem(storageKey);
}


// --- User Authentication ---
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
  // console.log("[registerService] Registering user (mock):", userData.username);
  await new Promise(resolve => setTimeout(resolve, 500));
  if (!userData.username || !userData.email || !userData.password) {
    throw new Error("Username, email, and password are required for registration.");
  }
  const newUser: User = {
    id: `user-${Date.now()}-${Math.random().toString(36).substring(2,7)}`,
    username: userData.username,
    email: userData.email,
  };
  return {
    token: 'mock_register_token_' + newUser.id,
    user: newUser,
  };
}

export async function loginService(credentials: any): Promise<AuthResponse> {
  // console.log("[loginService] Logging in user (mock):", credentials.username);
  await new Promise(resolve => setTimeout(resolve, 500));
  if (!credentials.username || !credentials.password) {
    throw new Error("Username and password are required.");
  }
  const loggedInUser: User = {
     id: `user-mock-${credentials.username.toLowerCase().replace(/\s+/g, '')}`,
    username: credentials.username,
    email: `${credentials.username.toLowerCase().replace(/\s+/g, '')}@example.com`,
  };
  return {
    token: 'mock_login_token_' + loggedInUser.id,
    user: loggedInUser,
  };
}


// --- Supplier Management ---
export async function getSupplierSummariesService(userId?: string): Promise<SupplierSummary[]> {
  if (!userId) {
    // console.warn("[getSupplierSummariesService] Called without userId. Returning empty list.");
    return [];
  }
  const invoices = await getInvoicesService(userId);
  const storedSuppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId);

  const supplierMap = new Map<string, SupplierSummary>();

  storedSuppliers.forEach(s => {
    if (s && s.name) { 
      supplierMap.set(s.name, {
        name: s.name,
        invoiceCount: 0,
        totalSpent: 0,
        phone: s.phone,
        email: s.email
      });
    }
  });

  invoices.forEach(invoice => {
    if (invoice.supplier && invoice.status === 'completed') { 
      const existingSupplierSummary = supplierMap.get(invoice.supplier);
      if (existingSupplierSummary) {
        existingSupplierSummary.invoiceCount += 1;
        existingSupplierSummary.totalSpent += (invoice.totalAmount || 0);
      } else {
        supplierMap.set(invoice.supplier, {
          name: invoice.supplier,
          invoiceCount: 1,
          totalSpent: invoice.totalAmount || 0,
          phone: undefined, 
          email: undefined
        });
      }
    }
  });

  return Array.from(supplierMap.values()).sort((a,b) => b.totalSpent - a.totalSpent);
}


export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string }, userId?: string): Promise<SupplierSummary> {
  if (!userId) {
    // console.error("[createSupplierService] UserID is required to create a supplier. Aborting.");
    throw new Error("User authentication is required to create suppliers.");
  }
  // console.log(`[createSupplierService] Creating new supplier: ${name}, UserID: ${userId}`, contactInfo);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId);

  if (suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Supplier with name "${name}" already exists.`);
  }

  const newSupplierData = { name, ...contactInfo };
  suppliers.push(newSupplierData);
  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);

  return { name, invoiceCount: 0, totalSpent: 0, ...contactInfo };
}

export async function deleteSupplierService(supplierName: string, userId?: string): Promise<void> {
  if (!userId) {
    // console.error(`[deleteSupplierService] UserID is required to delete supplier ${supplierName}. Aborting.`);
    throw new Error("User authentication is required to delete suppliers.");
  }
  // console.log(`[deleteSupplierService] Deleting supplier: ${supplierName}, UserID: ${userId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId);
  const initialLength = suppliers.length;
  suppliers = suppliers.filter(s => s.name !== supplierName);

  if (suppliers.length === initialLength && initialLength > 0 && !suppliers.some(s => s.name === supplierName) ) {
     console.warn(`[deleteSupplierService] Supplier with name "${supplierName}" not found for deletion or was already deleted for user ${userId}.`);
  }

  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);
}


export async function updateSupplierContactInfoService(supplierName: string, contactInfo: { phone?: string; email?: string }, userId?: string): Promise<void> {
  if (!userId) {
    // console.error(`[updateSupplierContactInfoService] UserID is required to update supplier ${supplierName}. Aborting.`);
    throw new Error("User authentication is required to update suppliers.");
  }
  // console.log(`[updateSupplierContactInfoService] Updating contact info for supplier: ${supplierName}, UserID: ${userId}`, contactInfo);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId);
  const supplierIndex = suppliers.findIndex(s => s.name === supplierName);

  if (supplierIndex !== -1) {
    suppliers[supplierIndex] = {
      ...suppliers[supplierIndex], 
      phone: contactInfo.phone,   
      email: contactInfo.email,   
      name: supplierName 
    };
  } else {
    // console.log(`[updateSupplierContactInfoService] Supplier "${supplierName}" not found for user ${userId}, creating new entry.`);
    suppliers.push({ name: supplierName, ...contactInfo });
  }
  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);
}

export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined') return;
    if (!uniqueScanId || !userId) { 
        console.warn("[clearTemporaryScanData] Called without a uniqueScanId or userId. No specific temporary data will be cleared.");
        return;
    }

    const dataKey = `${TEMP_DATA_KEY_PREFIX}${userId}_${uniqueScanId}`;
    const originalImageKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${userId}_${uniqueScanId}`;
    const compressedImageKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${userId}_${uniqueScanId}`;

    console.log(`[clearTemporaryScanData] Clearing temporary data for UserID: ${userId}, UniqueScanID: ${uniqueScanId}`);

    localStorage.removeItem(dataKey);
    console.log(`[clearTemporaryScanData] Attempted to clear scan result: ${dataKey}`);

    localStorage.removeItem(originalImageKey);
    console.log(`[clearTemporaryScanData] Attempted to clear original image preview: ${originalImageKey}`);

    localStorage.removeItem(compressedImageKey);
    console.log(`[clearTemporaryScanData] Attempted to clear compressed image: ${compressedImageKey}`);
}


export function clearOldTemporaryScanData(emergencyClear: boolean = false, userId?: string) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000; 
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  // console.log(`[clearOldTemporaryScanData] Starting cleanup. UserID specified: ${userId || 'No (checking all temp keys)'}. Emergency: ${emergencyClear}`);

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
        const belongsToUser = userId ? key.includes(`_${userId}_`) : true;

        if (belongsToUser && (key.startsWith(TEMP_DATA_KEY_PREFIX) || key.startsWith(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX) || key.startsWith(TEMP_COMPRESSED_IMAGE_KEY_PREFIX))) {
            const parts = key.split('_'); 
            const timestampString = parts.find(part => /^\d{13,}$/.test(part)); 
            
            if (timestampString) {
              const timestamp = parseInt(timestampString, 10);
              if (!isNaN(timestamp) && (now - timestamp > oneDay)) { 
                keysToRemove.push(key);
              }
            } else if (emergencyClear) { 
              console.warn(`[clearOldTemporaryScanData] Emergency: No clear timestamp found in key ${key}, but clearing due to emergency mode.`);
              keysToRemove.push(key);
            }
        }
    }
  }

  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    itemsCleared++;
    // console.log(`[clearOldTemporaryScanData] Cleared old/emergency temp item: ${key}`);
  });

  if (itemsCleared > 0) {
    // console.log(`[clearOldTemporaryScanData] Cleared ${itemsCleared} old/emergency temporary scan data items (specific user: ${userId || 'N/A'}).`);
  } else {
    // console.log(`[clearOldTemporaryScanData] No old/emergency temporary scan data found to clear (specific user: ${userId || 'N/A'}).`);
  }
}