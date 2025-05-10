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
  originalImagePreviewUri?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'pending_payment';
}

export interface SupplierSummary {
  name: string;
  invoiceCount: number;
  totalSpent: number;
  phone?: string;
  email?: string;
}


const INVENTORY_STORAGE_KEY_BASE = 'inventoryData';
const INVOICES_STORAGE_KEY_BASE = 'invoicesData';
const POS_SETTINGS_STORAGE_KEY_BASE = 'posSettings';
const SUPPLIERS_STORAGE_KEY_BASE = 'suppliersData';


export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';


export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.7 * 1024 * 1024;
export const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.25 * 1024 * 1024;
export const MAX_SCAN_RESULTS_SIZE_BYTES = 1 * 1024 * 1024;
export const MAX_INVENTORY_ITEMS = 500;
export const MAX_INVOICE_HISTORY_ITEMS = 50;


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

// Helper to get user-specific storage key
const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(`[getStorageKey] Attempted to get storage key for base "${baseKey}" without a userId. This might lead to data collision or loss for unauthenticated users if not intended.`);
    return baseKey; // Fallback to base key, though this should be avoided for user-specific data.
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
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || (item.name ? `${keyBase}-${item.name.replace(/\s+/g, '_')}-${index}` : `${keyBase}-item-${Date.now()}-${index}`)
      }));
    }
    localStorage.setItem(storageKey, JSON.stringify([])); // Initialize if not found
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

const saveStoredData = <T>(keyBase: string, data: T, userId?: string): void => {
  if (typeof window === 'undefined') {
    console.warn('localStorage is not available. Data not saved.');
    return;
  }
  const storageKey = getStorageKey(keyBase, userId);
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.includes('exceeded the quota'))) {
      console.warn(`[saveStoredData] Quota exceeded for key ${storageKey}. Attempting to clear old temporary scan data and retry...`);
      try {
        clearOldTemporaryScanData(true, userId); // Emergency clear for current user's temp data
        localStorage.setItem(storageKey, JSON.stringify(data)); // Retry saving
        console.log(`[saveStoredData] Successfully saved data for key ${storageKey} after cleanup.`);
      } catch (retryError) {
        console.error(`[saveStoredData] Error writing ${storageKey} to localStorage even after cleanup:`, retryError);
        throw error; // Re-throw original quota error if retry fails
      }
    } else {
      console.error(`Error writing ${storageKey} to localStorage:`, error);
      throw error; // Re-throw other errors
    }
  }
};


export interface DocumentProcessingResponse {
  products: Product[];
}


export async function checkProductPricesBeforeSaveService(
    productsToCheck: Product[],
    userId?: string,
    tempId?: string,
): Promise<PriceCheckResult> {
    console.log(`[checkProductPricesBeforeSaveService] Products to check:`, productsToCheck, `(tempId: ${tempId}, userId: ${userId})`);
    await new Promise(resolve => setTimeout(resolve, 50));

    const currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY_BASE, userId);
    const productsToSaveDirectly: Product[] = [];
    const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

    productsToCheck.forEach(scannedProduct => {
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
        if (existingIndex === -1 && scannedProduct.id && !scannedProduct.id.includes('-new') && scannedProduct.id !== tempId && !scannedProduct.id.startsWith('prod-') && !scannedProduct.id.includes(String(Date.now()).slice(0,3))) {
            existingIndex = currentInventory.findIndex(p => p.id === scannedProduct.id);
        }


        if (existingIndex !== -1) {
            const existingProduct = currentInventory[existingIndex];
            const existingUnitPrice = existingProduct.unitPrice;

            if (unitPriceFromScan !== 0 && Math.abs(existingUnitPrice - unitPriceFromScan) > 0.001) {
                console.log(`[checkProductPricesBeforeSaveService] Price discrepancy found for product ID ${existingProduct.id}. Existing: ${existingUnitPrice}, New: ${unitPriceFromScan}`);
                priceDiscrepancies.push({
                    ...scannedProduct,
                    id: existingProduct.id,
                    existingUnitPrice: existingUnitPrice,
                    newUnitPrice: unitPriceFromScan,
                });
            } else {
                productsToSaveDirectly.push({
                    ...scannedProduct,
                    id: existingProduct.id,
                    unitPrice: existingUnitPrice
                });
            }
        } else {
             console.log(`[checkProductPricesBeforeSaveService] New product or no match found for: ${scannedProduct.catalogNumber || scannedProduct.description}. Will be added/processed with unit price: ${unitPriceFromScan}`);
            productsToSaveDirectly.push({
                ...scannedProduct,
                unitPrice: unitPriceFromScan
            });
        }
    });

    console.log("[checkProductPricesBeforeSaveService] Price check complete. Direct saves:", productsToSaveDirectly.length, "Discrepancies:", priceDiscrepancies.length);
    return { productsToSaveDirectly, priceDiscrepancies };
}

export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileName: string,
    userId: string, // Ensure userId is always passed and valid
    source: string = 'upload',
    tempInvoiceId?: string, // This ID links to the pending record
    imageUriForFinalRecord?: string,
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number
): Promise<{ inventoryPruned: boolean; uniqueScanIdToClear?: string }> {
    const uniqueScanIdToClear = (tempInvoiceId && userId) ? tempInvoiceId.replace(`pending-inv-${userId}_`, '') : undefined;
    console.log(`[finalizeSaveProductsService] UserID: ${userId}, TempInvoiceID: ${tempInvoiceId}, UniqueScanID to clear: ${uniqueScanIdToClear}`);
    console.log(`[finalizeSaveProductsService] Starting for: ${originalFileName} (source: ${source})`);
    console.log(`[finalizeSaveProductsService] Extracted Details: Inv#: ${extractedInvoiceNumber}, Supplier: ${finalSupplierName}, Total: ${extractedTotalAmount}`);

    await new Promise(resolve => setTimeout(resolve, 100));

    let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY_BASE, userId);
    let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY_BASE, userId);

    let calculatedInvoiceTotalAmountFromProducts = 0;
    let productsProcessedSuccessfully = true;
    let inventoryPruned = false;
    let updatedInventory = [...currentInventory];

    try {
        productsToFinalizeSave.forEach(productToSave => {
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            let unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
            const salePrice = productToSave.salePrice !== undefined ? parseFloat(String(productToSave.salePrice)) : undefined;
            let lineTotal = parseFloat(String(productToSave.lineTotal)) || 0;

            if (quantityToAdd !== 0 && unitPrice !== 0 && lineTotal === 0) {
                lineTotal = parseFloat((quantityToAdd * unitPrice).toFixed(2));
            }

            if (!isNaN(lineTotal)) {
                calculatedInvoiceTotalAmountFromProducts += lineTotal;
            }

            let existingIndex = -1;
            if (productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                existingIndex = updatedInventory.findIndex(p => p.catalogNumber === productToSave.catalogNumber);
            }
            if (existingIndex === -1 && productToSave.barcode && productToSave.barcode.trim() !== '') {
                existingIndex = updatedInventory.findIndex(p => p.barcode === productToSave.barcode);
            }
            if (existingIndex === -1 && productToSave.id && !productToSave.id.includes('-new') && !productToSave.id.startsWith('prod-') && !(productToSave.id.includes(String(Date.now()).slice(0,5)))) {
                existingIndex = updatedInventory.findIndex(p => p.id === productToSave.id);
            }

            if (existingIndex !== -1) {
                const existingProduct = updatedInventory[existingIndex];
                existingProduct.quantity += quantityToAdd;
                existingProduct.unitPrice = unitPrice; // Always update with the resolved unit price from discrepancy check
                existingProduct.description = productToSave.description || existingProduct.description;
                existingProduct.shortName = productToSave.shortName || existingProduct.shortName;
                existingProduct.barcode = productToSave.barcode || existingProduct.barcode;
                existingProduct.catalogNumber = productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A' ? productToSave.catalogNumber : existingProduct.catalogNumber;
                existingProduct.salePrice = salePrice !== undefined ? salePrice : existingProduct.salePrice;
                existingProduct.minStockLevel = productToSave.minStockLevel !== undefined ? productToSave.minStockLevel : existingProduct.minStockLevel;
                existingProduct.maxStockLevel = productToSave.maxStockLevel !== undefined ? productToSave.maxStockLevel : existingProduct.maxStockLevel;
                existingProduct.lineTotal = parseFloat((existingProduct.quantity * existingProduct.unitPrice).toFixed(2));
            } else {
                if (!productToSave.catalogNumber && !productToSave.description && !productToSave.barcode) {
                    return;
                }
                const newId = `prod-${Date.now()}-${userId ? userId.slice(0,3) : 'guest'}-${Math.random().toString(36).substring(2, 7)}`;
                updatedInventory.push({
                    ...productToSave,
                    id: newId,
                    quantity: quantityToAdd,
                    unitPrice: unitPrice,
                    salePrice: salePrice,
                    lineTotal: lineTotal,
                    catalogNumber: productToSave.catalogNumber || 'N/A',
                    description: productToSave.description || 'No Description',
                    shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                    minStockLevel: productToSave.minStockLevel,
                    maxStockLevel: productToSave.maxStockLevel,
                });
            }
        });

        if (updatedInventory.length > MAX_INVENTORY_ITEMS) {
            updatedInventory.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
            updatedInventory = updatedInventory.slice(0, MAX_INVENTORY_ITEMS);
            inventoryPruned = true;
        }
        saveStoredData(INVENTORY_STORAGE_KEY_BASE, updatedInventory, userId);
        console.log('[finalizeSaveProductsService] Successfully saved updated inventory.');

    } catch (error) {
        console.error("[finalizeSaveProductsService] Error during product processing or inventory save:", error);
        productsProcessedSuccessfully = false;
        const processingError = new Error(`Failed to process/save products: ${(error as Error).message}`);
        (processingError as any).uniqueScanIdToClear = uniqueScanIdToClear;
        throw processingError;
    }

    if (source === 'upload') {
        const finalStatus = productsProcessedSuccessfully ? 'completed' : 'error';
        const errorMessageOnProductFail = !productsProcessedSuccessfully ? 'Failed to process some products into inventory. Invoice may be incomplete.' : undefined;
        const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && !isNaN(extractedTotalAmount))
                                        ? extractedTotalAmount
                                        : parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2));
        let finalFileName = originalFileName;
        if (finalSupplierName) {
            finalFileName = finalSupplierName;
            if (extractedInvoiceNumber) {
                finalFileName += `_${extractedInvoiceNumber}`;
            }
        } else if (extractedInvoiceNumber) {
            finalFileName = `Invoice_${extractedInvoiceNumber}`;
        }

        if (!tempInvoiceId || !userId) {
            const msg = `CRITICAL: tempInvoiceId ("${tempInvoiceId}") or userId ("${userId}") is missing for source 'upload'. File: ${originalFileName}. Cannot update invoice status. Products might be saved to inventory, but invoice history will be inconsistent.`;
            console.error(`[finalizeSaveProductsService] ${msg}`);
            const criticalError = new Error("Failed to finalize invoice record: Missing temporary ID or user information. Inventory might be updated, but the document status is not. Please check manually.");
            (criticalError as any).isInvoiceSaveError = true;
            (criticalError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw criticalError;
        }

        const existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === tempInvoiceId);

        if (existingInvoiceIndex !== -1) {
            const existingRecord = currentInvoices[existingInvoiceIndex];
            currentInvoices[existingInvoiceIndex] = {
                ...existingRecord,
                fileName: finalFileName,
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber || existingRecord.invoiceNumber,
                supplier: finalSupplierName || existingRecord.supplier,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: imageUriForFinalRecord || existingRecord.originalImagePreviewUri,
                errorMessage: errorMessageOnProductFail || existingRecord.errorMessage,
                paymentStatus: existingRecord.paymentStatus || 'unpaid',
            };
            console.log(`[finalizeSaveProductsService] Successfully updated invoice record ID: ${tempInvoiceId} to status: ${finalStatus}. New FileName: ${finalFileName}`);
        } else {
            const errorMsg = `CRITICAL: Pending invoice with ID "${tempInvoiceId}" NOT found for update for user "${userId}". File: ${originalFileName}. Products were saved to inventory, but the invoice status remains inconsistent. A new record was NOT created for 'upload' source to avoid duplicates of a lost pending item.`;
            console.error(`[finalizeSaveProductsService] ${errorMsg}`);
            const findError = new Error("Failed to find the original pending invoice record for update. Document status might be incorrect. Please verify manually or contact support.");
            (findError as any).isInvoiceSaveError = true;
            (findError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw findError;
        }

        if (currentInvoices.length > MAX_INVOICE_HISTORY_ITEMS) {
            console.warn(`[finalizeSaveProductsService] Invoice history count (${currentInvoices.length}) exceeds limit (${MAX_INVOICE_HISTORY_ITEMS}). Pruning...`);
            currentInvoices.sort((a,b) => new Date(b.uploadTime as string).getTime() - new Date(a.uploadTime as string).getTime());
            currentInvoices = currentInvoices.slice(0, MAX_INVOICE_HISTORY_ITEMS);
            console.log(`[finalizeSaveProductsService] Invoice history pruned to ${currentInvoices.length} items.`);
        }

        try {
            saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
            console.log('[finalizeSaveProductsService] Successfully updated invoice history in localStorage.');
        } catch (storageError) {
            console.error("[finalizeSaveProductsService] Critical error saving updated invoices to localStorage:", storageError);
            const saveInvoiceError = new Error(`Failed to save updated invoice history: ${(storageError as Error).message}`);
            (saveInvoiceError as any).isInvoiceSaveError = true;
            (saveInvoiceError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw saveInvoiceError;
        }

    } else if (source.endsWith('_sync')) {
      console.log(`[finalizeSaveProductsService] POS Sync (${source}) completed. Inventory updated. No invoice record created for this sync type.`);
    } else {
      console.log(`[finalizeSaveProductsService] Skipping invoice history update for source: ${source}`);
    }

    return { inventoryPruned, uniqueScanIdToClear };
}


export async function getProductsService(userId?: string): Promise<Product[]> {
  console.log("[getProductsService] Called for userId:", userId);
  await new Promise(resolve => setTimeout(resolve, 50));
  const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY_BASE, userId);
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
  console.log("[getProductsService] Returning inventory for userId:", userId, "Count:", inventoryWithDefaults.length);
  return inventoryWithDefaults;
}

export async function getProductByIdService(productId: string, userId?: string): Promise<Product | null> {
   console.log(`[getProductByIdService] Called for ID: ${productId}, UserID: ${userId}`);
   await new Promise(resolve => setTimeout(resolve, 50));
   const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY_BASE, userId);
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


export async function updateProductService(productId: string, updatedData: Partial<Product>, userId?: string): Promise<void> {
  console.log(`[updateProductService] Called for ID: ${productId}, UserID: ${userId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY_BASE, userId);
  const productIndex = currentInventory.findIndex(p => p.id === productId);

  if (productIndex === -1) {
    console.error(`[updateProductService] Product with ID ${productId} not found for update.`);
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
    updatedProduct.barcode = updatedData.barcode === null ? undefined : (updatedData.barcode || currentInventory[productIndex].barcode);
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

  saveStoredData(INVENTORY_STORAGE_KEY_BASE, currentInventory, userId);
  console.log(`[updateProductService] Product ${productId} updated successfully.`);
}

export async function deleteProductService(productId: string, userId?: string): Promise<void> {
  console.log(`[deleteProductService] Called for ID: ${productId}, UserID: ${userId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY_BASE, userId);
  const initialLength = currentInventory.length;
  const updatedInventory = currentInventory.filter(p => p.id !== productId);

  if (updatedInventory.length === initialLength) {
      console.warn(`[deleteProductService] Product with ID ${productId} not found for deletion (might be already deleted).`);
  }

  saveStoredData(INVENTORY_STORAGE_KEY_BASE, updatedInventory, userId);
  console.log(`[deleteProductService] Product ${productId} deleted successfully.`);
}


export async function getInvoicesService(userId?: string): Promise<InvoiceHistoryItem[]> {
  console.log("[getInvoicesService] Called for userId:", userId);
  await new Promise(resolve => setTimeout(resolve, 50));
  const invoicesRaw = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY_BASE, userId);
  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    uploadTime: inv.uploadTime instanceof Date ? inv.uploadTime.toISOString() : new Date(inv.uploadTime).toISOString(),
    paymentStatus: inv.paymentStatus || 'unpaid',
  }));
  console.log("[getInvoicesService] Returning invoices for userId:", userId, "Count:", invoices.length);
  return invoices;
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId?: string): Promise<void> {
  console.log(`[updateInvoiceService] Called for ID: ${invoiceId}, UserID: ${userId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY_BASE, userId);
  const invoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceId);

  if (invoiceIndex === -1) {
    console.error(`[updateInvoiceService] Invoice with ID ${invoiceId} not found for update.`);
    throw new Error(`Invoice with ID ${invoiceId} not found.`);
  }

  const originalInvoice = currentInvoices[invoiceIndex];
  const finalUpdatedData: InvoiceHistoryItem = {
    ...originalInvoice,
    ...updatedData,
    id: invoiceId,
    uploadTime: originalInvoice.uploadTime,
    originalImagePreviewUri: updatedData.originalImagePreviewUri === null ? undefined : (updatedData.originalImagePreviewUri ?? originalInvoice.originalImagePreviewUri),
    status: updatedData.status || originalInvoice.status,
    paymentStatus: updatedData.paymentStatus || originalInvoice.paymentStatus || 'unpaid',
  };

  currentInvoices[invoiceIndex] = finalUpdatedData;

  saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
  console.log(`[updateInvoiceService] Invoice ${invoiceId} updated successfully.`);
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId?: string): Promise<void> {
  console.log(`[updateInvoicePaymentStatusService] Called for ID: ${invoiceId}, UserID: ${userId}, new status: ${paymentStatus}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY_BASE, userId);
  const invoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceId);

  if (invoiceIndex === -1) {
    console.error(`[updateInvoicePaymentStatusService] Invoice with ID ${invoiceId} not found for payment status update.`);
    throw new Error(`Invoice with ID ${invoiceId} not found.`);
  }

  currentInvoices[invoiceIndex].paymentStatus = paymentStatus;

  saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
  console.log(`[updateInvoicePaymentStatusService] Payment status for invoice ${invoiceId} updated to ${paymentStatus}.`);
}


export async function deleteInvoiceService(invoiceId: string, userId?: string): Promise<void> {
  console.log(`[deleteInvoiceService] Called for ID: ${invoiceId}, UserID: ${userId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY_BASE, userId);
  const initialLength = currentInvoices.length;
  const updatedInvoices = currentInvoices.filter(inv => inv.id !== invoiceId);

  if (updatedInvoices.length === initialLength && currentInvoices.some(inv => inv.id === invoiceId) ) { // Check if it actually existed
    console.warn(`[deleteInvoiceService] Invoice with ID ${invoiceId} was found but not removed. This is unexpected.`);
  } else if (updatedInvoices.length === initialLength && !currentInvoices.some(inv => inv.id === invoiceId)) {
     console.warn(`[deleteInvoiceService] Invoice with ID ${invoiceId} not found for deletion.`);
  }


  saveStoredData(INVOICES_STORAGE_KEY_BASE, updatedInvoices, userId);
  console.log(`[deleteInvoiceService] Invoice ${invoiceId} delete attempt processed. New count: ${updatedInvoices.length}`);
}


export async function clearInventoryService(userId?: string): Promise<void> {
    console.log("[clearInventoryService] Called for userId:", userId);
    await new Promise(resolve => setTimeout(resolve, 100));
    saveStoredData(INVENTORY_STORAGE_KEY_BASE, [], userId);
    console.log("[clearInventoryService] Inventory cleared from localStorage for user:", userId);
}


// --- POS Settings Management ---
export async function savePosSettingsService(systemId: string, config: PosConnectionConfig, userId?: string): Promise<void> {
    console.log(`[savePosSettingsService] Saving POS settings for ${systemId}, UserID: ${userId}`, config);
    await new Promise(resolve => setTimeout(resolve, 100));
    const settings: StoredPosSettings = { systemId, config };
    saveStoredData(POS_SETTINGS_STORAGE_KEY_BASE, settings, userId);
    console.log("[savePosSettingsService] POS settings saved to localStorage.");
}

export async function getPosSettingsService(userId?: string): Promise<StoredPosSettings | null> {
  if (typeof window === 'undefined') {
    console.warn("[getPosSettingsService] Called from server-side. Returning null as no server-side store implemented.");
    return null;
  }
  console.log("[getPosSettingsService] Retrieving POS settings for UserID:", userId);
  await new Promise(resolve => setTimeout(resolve, 50));
  const settings = getStoredObject<StoredPosSettings>(POS_SETTINGS_STORAGE_KEY_BASE, userId);
  console.log("[getPosSettingsService] Retrieved POS settings:", settings);
  return settings;
}

export async function clearPosSettingsService(userId?: string): Promise<void> {
    console.log("[clearPosSettingsService] Clearing POS settings for UserID:", userId);
    await new Promise(resolve => setTimeout(resolve, 50));
    const storageKey = getStorageKey(POS_SETTINGS_STORAGE_KEY_BASE, userId);
    if (typeof window !== 'undefined') {
        localStorage.removeItem(storageKey);
        console.log("[clearPosSettingsService] POS settings cleared from localStorage.");
    } else {
        console.warn("[clearPosSettingsService] localStorage not available. POS settings not cleared.");
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
  console.log("[registerService] Registering user:", userData.username);
  await new Promise(resolve => setTimeout(resolve, 500));
  const newUser: User = {
    id: `user-${Date.now()}-${Math.random().toString(36).substring(2,7)}`,
    username: userData.username,
    email: userData.email,
  };
  return {
    token: 'mock_register_token_' + Date.now(),
    user: newUser,
  };
}

export async function loginService(credentials: any): Promise<AuthResponse> {
  console.log("[loginService] Logging in user:", credentials.username);
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
    token: 'mock_login_token_' + Date.now(),
    user: loggedInUser,
  };
}


// --- Supplier Management ---
export async function getSupplierSummariesService(userId?: string): Promise<SupplierSummary[]> {
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
  console.log(`[createSupplierService] Creating new supplier: ${name}, UserID: ${userId}`, contactInfo);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId);

  if (suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Supplier with name "${name}" already exists.`);
  }

  const newSupplier = { name, ...contactInfo };
  suppliers.push(newSupplier);
  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);

  console.log("[createSupplierService] New supplier created and saved to localStorage.");
  return { name, invoiceCount: 0, totalSpent: 0, ...contactInfo };
}

export async function deleteSupplierService(supplierName: string, userId?: string): Promise<void> {
  console.log(`[deleteSupplierService] Deleting supplier: ${supplierName}, UserID: ${userId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId);
  const initialLength = suppliers.length;
  suppliers = suppliers.filter(s => s.name !== supplierName);

  if (suppliers.length === initialLength && initialLength > 0) {
     console.warn(`[deleteSupplierService] Supplier with name "${supplierName}" not found for deletion.`);
  }

  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);
  console.log(`[deleteSupplierService] Supplier "${supplierName}" delete attempt processed.`);
}


export async function updateSupplierContactInfoService(supplierName: string, contactInfo: { phone?: string; email?: string }, userId?: string): Promise<void> {
  console.log(`[updateSupplierContactInfoService] Updating contact info for supplier: ${supplierName}, UserID: ${userId}`, contactInfo);
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
    console.log(`[updateSupplierContactInfoService] Supplier "${supplierName}" not found for update, creating new entry.`);
    suppliers.push({ name: supplierName, ...contactInfo });
  }
  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);
  console.log("[updateSupplierContactInfoService] Supplier contact info saved to localStorage.");
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

  console.log(`[clearOldTemporaryScanData] Starting cleanup for UserID: ${userId || 'all users (if no userId provided)'}. Emergency: ${emergencyClear}`);

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
        const userSpecificDataPrefix = userId ? `${TEMP_DATA_KEY_PREFIX}${userId}_` : TEMP_DATA_KEY_PREFIX;
        const userSpecificOriginalImagePrefix = userId ? `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${userId}_` : TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX;
        const userSpecificCompressedImagePrefix = userId ? `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${userId}_` : TEMP_COMPRESSED_IMAGE_KEY_PREFIX;

        const isTempData = key.startsWith(userSpecificDataPrefix);
        const isTempOriginalImage = key.startsWith(userSpecificOriginalImagePrefix);
        const isTempCompressedImage = key.startsWith(userSpecificCompressedImagePrefix);

      if (isTempData || isTempOriginalImage || isTempCompressedImage) {
        const parts = key.split('_');
        const timestampString = parts.find(part => /^\d{13,}$/.test(part));
        if (timestampString) {
          const timestamp = parseInt(timestampString, 10);
          if (!isNaN(timestamp) && (now - timestamp > oneDay)) {
            keysToRemove.push(key);
          }
        } else if (emergencyClear) {
          console.warn(`[clearOldTemporaryScanData] Emergency: No clear timestamp found in key ${key}, but clearing due to emergency mode for UserID: ${userId || 'all users'}.`);
          keysToRemove.push(key);
        }
      }
    }
  }

  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    itemsCleared++;
    console.log(`[clearOldTemporaryScanData] Cleared old/emergency temp scan item: ${key}`);
  });

  if (itemsCleared > 0) {
    console.log(`[clearOldTemporaryScanData] Cleared ${itemsCleared} old/emergency temporary scan data items for UserID: ${userId || 'all users'}.`);
  }
}
