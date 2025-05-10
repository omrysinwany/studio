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
  compressedImageForFinalRecordUri?: string; // For storing with the final record
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
export const INVOICES_STORAGE_KEY_BASE = 'invoicesData'; // Export this constant
const POS_SETTINGS_STORAGE_KEY_BASE = 'posSettings';
const SUPPLIERS_STORAGE_KEY_BASE = 'suppliersData';


export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';


export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.7 * 1024 * 1024; 
export const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.25 * 1024 * 1024; 
export const MAX_SCAN_RESULTS_SIZE_BYTES = 1 * 1024 * 1024;
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
    console.warn(`[getStorageKey Backend] Attempted to get storage key for base "${baseKey}" without a userId.`);
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
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || (item.name ? `${keyBase}-${item.name.replace(/\s+/g, '_')}-${index}` : `${keyBase}-item-${Date.now()}-${index}`)
      }));
    }
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

const saveStoredData = (keyBase: string, data: any, userId?: string): void => {
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
        clearOldTemporaryScanData(true, userId); 
        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log(`[saveStoredData] Successfully saved data for key ${storageKey} after cleanup.`);
      } catch (retryError) {
        console.error(`[saveStoredData] Error writing ${storageKey} to localStorage even after cleanup:`, retryError);
        throw error; 
      }
    } else {
      console.error(`Error writing ${storageKey} to localStorage:`, error);
      throw error; 
    }
  }
};


export async function checkProductPricesBeforeSaveService(
    productsToCheck: Product[],
    userId?: string,
    tempId?: string,
): Promise<PriceCheckResult> {
    console.log(`[checkProductPricesBeforeSaveService] Products to check:`, productsToCheck, `(tempId: ${tempId}, userId: ${userId})`);
    await new Promise(resolve => setTimeout(resolve, 50));

    const currentInventory = getProductsService(userId); 
    const productsToSaveDirectly: Product[] = [];
    const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

    for (const scannedProduct of productsToCheck) {
        const inventory = await currentInventory; 
        const quantityFromScan = parseFloat(String(scannedProduct.quantity)) || 0;
        const lineTotalFromScan = parseFloat(String(scannedProduct.lineTotal)) || 0;
        let unitPriceFromScan = parseFloat(String(scannedProduct.unitPrice)) || 0;

        if (unitPriceFromScan === 0 && quantityFromScan !== 0 && lineTotalFromScan !== 0) {
            unitPriceFromScan = parseFloat((lineTotalFromScan / quantityFromScan).toFixed(2));
        }

        let existingIndex = -1;
        if (scannedProduct.catalogNumber && scannedProduct.catalogNumber !== 'N/A') {
            existingIndex = inventory.findIndex(p => p.catalogNumber === scannedProduct.catalogNumber);
        }
        if (existingIndex === -1 && scannedProduct.barcode && scannedProduct.barcode.trim() !== '') {
            existingIndex = inventory.findIndex(p => p.barcode === scannedProduct.barcode);
        }
        if (existingIndex === -1 && scannedProduct.id && !scannedProduct.id.includes('-new') && scannedProduct.id !== tempId && !scannedProduct.id.startsWith('prod-') && !scannedProduct.id.includes(String(Date.now()).slice(0,3))) {
            existingIndex = inventory.findIndex(p => p.id === scannedProduct.id);
        }


        if (existingIndex !== -1) {
            const existingProduct = inventory[existingIndex];
            const existingUnitPrice = existingProduct.unitPrice;

            if (unitPriceFromScan !== 0 && Math.abs(existingUnitPrice - unitPriceFromScan) > 0.001) {
                console.log(`[checkProductPricesBeforeSaveService] Price discrepancy found for product ID ${existingProduct.id}. Existing: ${existingUnitPrice}, New: ${unitPriceFromScan}`);
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
                    unitPrice: existingUnitPrice, 
                    salePrice: scannedProduct.salePrice ?? existingProduct.salePrice,
                });
            }
        } else {
             console.log(`[checkProductPricesBeforeSaveService] New product or no match found for: ${scannedProduct.catalogNumber || scannedProduct.description}. Will be added/processed with unit price: ${unitPriceFromScan}`);
            productsToSaveDirectly.push({
                ...scannedProduct,
                unitPrice: unitPriceFromScan,
            });
        }
    }

    console.log("[checkProductPricesBeforeSaveService] Price check complete. Direct saves:", productsToSaveDirectly.length, "Discrepancies:", priceDiscrepancies.length);
    return { productsToSaveDirectly, priceDiscrepancies };
}

export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileName: string,
    userId: string,
    source: string = 'upload',
    tempInvoiceId?: string,
    originalImagePreviewUri?: string, // URI for preview on edit page (might be larger)
    compressedImageForFinalRecordUri?: string, // URI for the image to be stored with the invoice (smaller)
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number
): Promise<{ inventoryPruned: boolean; uniqueScanIdToClear?: string }> {
    const uniqueScanIdToClear = (tempInvoiceId && userId) ? tempInvoiceId.replace(`pending-inv-${userId}_`, '') : undefined;
    console.log(`[finalizeSaveProductsService] UserID: ${userId}, TempInvoiceID: ${tempInvoiceId}, UniqueScanID to clear: ${uniqueScanIdToClear}`);
    console.log(`[finalizeSaveProductsService] Starting for: ${originalFileName} (source: ${source})`);
    console.log(`[finalizeSaveProductsService] Extracted Details: Inv#: ${extractedInvoiceNumber}, Supplier: ${finalSupplierName}, Total: ${extractedTotalAmount}`);
    console.log(`[finalizeSaveProductsService] Original Image Preview URI (for edit): ${originalImagePreviewUri ? 'Exists' : 'Missing'}`);
    console.log(`[finalizeSaveProductsService] Compressed Image URI (for final record): ${compressedImageForFinalRecordUri ? 'Exists' : 'Missing'}`);

    await new Promise(resolve => setTimeout(resolve, 100));

    let currentInventory = await getProductsService(userId);
    let currentInvoices = await getInvoicesService(userId);

    let calculatedInvoiceTotalAmountFromProducts = 0;
    let productsProcessedSuccessfully = true;
    let inventoryPruned = false;
    let updatedInventory = [...currentInventory];

    try {
        productsToFinalizeSave.forEach(productToSave => {
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            let unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
            const salePrice = productToSave.salePrice !== undefined && !isNaN(parseFloat(String(productToSave.salePrice))) ? parseFloat(String(productToSave.salePrice)) : undefined;
            let lineTotal = parseFloat(String(productToSave.lineTotal)) || 0;

            if (quantityToAdd !== 0 && unitPrice !== 0 && lineTotal === 0) { 
                lineTotal = parseFloat((quantityToAdd * unitPrice).toFixed(2));
            } else if (quantityToAdd !== 0 && lineTotal !== 0 && unitPrice === 0) {
                unitPrice = parseFloat((lineTotal / quantityToAdd).toFixed(2));
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
            if (existingIndex === -1 && productToSave.id && !productToSave.id.includes('-new') && !productToSave.id.startsWith('prod-') && !productToSave.id.includes(String(Date.now()).slice(0,3))) {
                existingIndex = updatedInventory.findIndex(p => p.id === productToSave.id);
            }


            if (existingIndex !== -1) {
                const existingProduct = updatedInventory[existingIndex];
                existingProduct.quantity += quantityToAdd;
                existingProduct.unitPrice = unitPrice; // Always update with the (potentially confirmed) unit price
                existingProduct.description = productToSave.description || existingProduct.description;
                existingProduct.shortName = productToSave.shortName || existingProduct.shortName;
                existingProduct.barcode = productToSave.barcode || existingProduct.barcode;
                existingProduct.catalogNumber = productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A' ? productToSave.catalogNumber : existingProduct.catalogNumber;
                existingProduct.salePrice = salePrice !== undefined ? salePrice : existingProduct.salePrice;
                existingProduct.minStockLevel = productToSave.minStockLevel !== undefined ? productToSave.minStockLevel : existingProduct.minStockLevel;
                existingProduct.maxStockLevel = productToSave.maxStockLevel !== undefined ? productToSave.maxStockLevel : existingProduct.maxStockLevel;
                existingProduct.lineTotal = parseFloat((existingProduct.quantity * existingProduct.unitPrice).toFixed(2));
                console.log(`[finalizeSaveProductsService] Updated existing product ID ${existingProduct.id}: Qty=${existingProduct.quantity}, UnitPrice=${existingProduct.unitPrice}, SalePrice=${existingProduct.salePrice}`);
            } else {
                if (!productToSave.catalogNumber && !productToSave.description && !productToSave.barcode) {
                     console.warn("[finalizeSaveProductsService] Skipping adding product with no identifier:", productToSave);
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
                 console.log(`[finalizeSaveProductsService] Added new product with ID ${newId}`);
            }
        });

        if (updatedInventory.length > MAX_INVENTORY_ITEMS) {
            updatedInventory.sort((a, b) => (b.quantity || 0) - (a.quantity || 0)); 
            updatedInventory = updatedInventory.slice(0, MAX_INVENTORY_ITEMS);
            inventoryPruned = true;
             console.warn(`[finalizeSaveProductsService] Inventory pruned to ${MAX_INVENTORY_ITEMS} items.`);
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
        
        let finalGeneratedFileName = originalFileName;
        if (finalSupplierName && finalSupplierName.trim() !== '') {
            finalGeneratedFileName = finalSupplierName.trim();
            if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
                finalGeneratedFileName += `_${extractedInvoiceNumber.trim()}`;
            }
        } else if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
            finalGeneratedFileName = `Invoice_${extractedInvoiceNumber.trim()}`;
        }


        if (!tempInvoiceId || !userId) {
            const msg = `CRITICAL: tempInvoiceId ("${tempInvoiceId}") or userId ("${userId}") is missing for source 'upload'. File: ${originalFileName}. Cannot update/create invoice status. Products might be saved to inventory, but invoice history will be inconsistent.`;
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
                fileName: finalGeneratedFileName,
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber || existingRecord.invoiceNumber,
                supplier: finalSupplierName || existingRecord.supplier,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: originalImagePreviewUri, // The image to show on the details/edit page
                compressedImageForFinalRecordUri: compressedImageForFinalRecordUri, // The image to save with the invoice record itself
                errorMessage: errorMessageOnProductFail || existingRecord.errorMessage, 
                paymentStatus: existingRecord.paymentStatus || 'unpaid',
            };
            console.log(`[finalizeSaveProductsService] Successfully updated invoice record ID: ${tempInvoiceId} to status: ${finalStatus}. New FileName: ${finalGeneratedFileName}, Original Preview ${originalImagePreviewUri ? "present" : "missing"}, Compressed Final ${compressedImageForFinalRecordUri ? "present" : "missing"}`);
        } else {
            console.warn(`[finalizeSaveProductsService] Pending invoice with ID "${tempInvoiceId}" NOT found for user "${userId}". File: ${originalFileName}. Creating a new invoice record as a fallback, but this indicates a potential issue in the pending record creation/retention.`);
            const newInvoiceId = `inv-${Date.now()}-${userId.slice(0,3)}-fallback`; 
            const newInvoiceRecord: InvoiceHistoryItem = {
                id: newInvoiceId,
                fileName: finalGeneratedFileName,
                uploadTime: new Date().toISOString(), 
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber,
                supplier: finalSupplierName,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: originalImagePreviewUri,
                compressedImageForFinalRecordUri: compressedImageForFinalRecordUri,
                errorMessage: errorMessageOnProductFail || "Pending record was missing, created as new.",
                paymentStatus: 'unpaid',
            };
            currentInvoices.push(newInvoiceRecord);
             console.log(`[finalizeSaveProductsService] Created NEW fallback invoice record ID: ${newInvoiceId} with status: ${finalStatus}.`);
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
            const saveInvoiceError = new Error(`Failed to save invoice history: ${(storageError as Error).message}`);
            (saveInvoiceError as any).isInvoiceSaveError = true;
            (saveInvoiceError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw saveInvoiceError;
        }

    } else if (source.endsWith('_sync')) {
      console.log(`[finalizeSaveProductsService] POS Sync (${source}) completed. Inventory updated. No invoice record created for this sync type.`);
    } else {
      console.log(`[finalizeSaveProductsService] Skipping invoice history update for source: ${source}`);
    }
     // Clear temporary data for this scan AFTER successful finalization.
     if (uniqueScanIdToClear && userId) {
        clearTemporaryScanData(uniqueScanIdToClear, userId);
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
        id: item.id || `prod-get-${Date.now()}-${userId ? userId.slice(0,3) : 'guest'}-${Math.random().toString(36).substring(2, 9)}`,
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
   const inventory = await getProductsService(userId); 
   const product = inventory.find(p => p.id === productId);
   return product || null; 
}


export async function updateProductService(productId: string, updatedData: Partial<Product>, userId?: string): Promise<void> {
  console.log(`[updateProductService] Called for ID: ${productId}, UserID: ${userId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = await getProductsService(userId); 
  const productIndex = currentInventory.findIndex(p => p.id === productId);

  if (productIndex === -1) {
    console.error(`[updateProductService] Product with ID ${productId} not found for update.`);
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
  console.log(`[updateProductService] Product ${productId} updated successfully.`);
}

export async function deleteProductService(productId: string, userId?: string): Promise<void> {
  console.log(`[deleteProductService] Called for ID: ${productId}, UserID: ${userId}`);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = await getProductsService(userId);
  const initialLength = currentInventory.length;
  const updatedInventory = currentInventory.filter(p => p.id !== productId);

  if (updatedInventory.length === initialLength && currentInventory.some(p => p.id === productId) ) { 
    console.warn(`[deleteProductService] Product with ID ${productId} was found but not removed. This is unexpected.`);
  } else if (updatedInventory.length === initialLength && !currentInventory.some(p => p.id === productId)){
     console.warn(`[deleteProductService] Product with ID ${productId} not found for deletion.`);
  }

  saveStoredData(INVENTORY_STORAGE_KEY_BASE, updatedInventory, userId);
  console.log(`[deleteProductService] Product ${productId} delete attempt processed. New count: ${updatedInventory.length}`);
}


export async function getInvoicesService(userId?: string): Promise<InvoiceHistoryItem[]> {
  console.log("[getInvoicesService] Called for userId:", userId);
  await new Promise(resolve => setTimeout(resolve, 50));
  const invoicesRaw = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY_BASE, userId);
  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${userId ? userId.slice(0,3) : 'guest'}-${Math.random().toString(36).substring(2, 9)}`,
    uploadTime: inv.uploadTime instanceof Date ? inv.uploadTime.toISOString() : new Date(inv.uploadTime).toISOString(),
    paymentStatus: inv.paymentStatus || 'unpaid',
  }));
  console.log("[getInvoicesService] Returning invoices for userId:", userId, "Count:", invoices.length);
  return invoices;
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId?: string): Promise<void> {
  console.log(`[updateInvoiceService] Called for ID: ${invoiceId}, UserID: ${userId}`, updatedData);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = await getInvoicesService(userId);
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
    compressedImageForFinalRecordUri: updatedData.compressedImageForFinalRecordUri === null ? undefined : (updatedData.compressedImageForFinalRecordUri ?? originalInvoice.compressedImageForFinalRecordUri),
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

  let currentInvoices = await getInvoicesService(userId);
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

  let currentInvoices = await getInvoicesService(userId);
  const initialLength = currentInvoices.length;
  const updatedInvoices = currentInvoices.filter(inv => inv.id !== invoiceId);

  if (updatedInvoices.length === initialLength && currentInvoices.some(inv => inv.id === invoiceId) ) { 
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

// Using mock authentication for now
export async function registerService(userData: any): Promise<AuthResponse> {
  console.log("[registerService] Registering user (mock):", userData.username);
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
  console.log("[loginService] Logging in user (mock):", credentials.username);
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

  const newSupplierData = { name, ...contactInfo };
  suppliers.push(newSupplierData);
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

  if (suppliers.length === initialLength && initialLength > 0 && !suppliers.some(s => s.name === supplierName) ) {
     console.warn(`[deleteSupplierService] Supplier with name "${supplierName}" not found for deletion or was already deleted.`);
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