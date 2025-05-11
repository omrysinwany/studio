
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
  compressedImageForFinalRecordUri?: string;
  paymentReceiptImageUri?: string;
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentDueDate?: string | Date;
}

export interface SupplierSummary {
  name: string;
  invoiceCount: number;
  totalSpent: number;
  phone?: string;
  email?: string;
}

export interface AccountantSettings {
  name?: string;
  email?: string;
  phone?: string;
}


const INVENTORY_STORAGE_KEY_BASE = 'inventoryData';
export const INVOICES_STORAGE_KEY_BASE = 'invoicesData';
const POS_SETTINGS_STORAGE_KEY_BASE = 'posSettings';
export const SUPPLIERS_STORAGE_KEY_BASE = 'suppliersData'; // Export this
const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'accountantSettings';


export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';


export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.7 * 1024 * 1024; // 0.7MB
export const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.25 * 1024 * 1024; // 0.25MB
export const MAX_SCAN_RESULTS_SIZE_BYTES = 1 * 1024 * 1024; // 1MB for scan results JSON
export const MAX_INVENTORY_ITEMS = 1000;
export const MAX_INVOICE_HISTORY_ITEMS = 25;


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
    // console.warn(`[getStorageKey Backend] No userId provided for baseKey "${baseKey}". Using generic key.`);
    return baseKey;
  }
  return `${baseKey}_${userId}`;
};


export const getStoredData = <T extends {id?: string; name?: string}>(keyBase: string, userId?: string, defaultDataIfNoUserOrError: T[] = []): T[] => {
  if (typeof window === 'undefined') return defaultDataIfNoUserOrError;

  const storageKey = getStorageKey(keyBase, userId);
  
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsedData = JSON.parse(stored) as T[];
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || (item.name ? `${keyBase}-item-${item.name.replace(/\s+/g, '_')}-${index}` : `${keyBase}-item-${Date.now()}-${index}`)
      }));
    }
    return defaultDataIfNoUserOrError;
  } catch (error) {
    console.error(`Error reading ${storageKey} from localStorage:`, error);
    return defaultDataIfNoUserOrError; 
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
    return true;
  } catch (error: any) {
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
    await new Promise(resolve => setTimeout(resolve, 50));

    const currentInventory = await getProductsService(userId);
    const productsToSaveDirectly: Product[] = [];
    const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

    for (const scannedProduct of productsToCheck) {
        const quantityFromScan = parseFloat(String(scannedProduct.quantity)) || 0;
        const lineTotalFromScan = parseFloat(String(scannedProduct.lineTotal)) || 0;
        let unitPriceFromScan = parseFloat(String(scannedProduct.unitPrice)) || 0;

        if (quantityFromScan !== 0) {
            const calculatedUnitPrice = parseFloat((lineTotalFromScan / quantityFromScan).toFixed(2));
            if (Math.abs(calculatedUnitPrice - unitPriceFromScan) > 0.01 || unitPriceFromScan === 0) {
                 unitPriceFromScan = calculatedUnitPrice;
            }
        }


        let existingIndex = -1;
        if (scannedProduct.catalogNumber && scannedProduct.catalogNumber !== 'N/A') {
            existingIndex = currentInventory.findIndex(p => p.catalogNumber === scannedProduct.catalogNumber);
        }
        if (existingIndex === -1 && scannedProduct.barcode && scannedProduct.barcode.trim() !== '') {
            existingIndex = currentInventory.findIndex(p => p.barcode === scannedProduct.barcode);
        }
        if (existingIndex === -1 && scannedProduct.id && !scannedProduct.id.startsWith('prod-temp-') && !scannedProduct.id.includes('-new')) {
            existingIndex = currentInventory.findIndex(p => p.id === scannedProduct.id);
        }


        if (existingIndex !== -1) {
            const existingProduct = currentInventory[existingIndex];
            const existingUnitPrice = existingProduct.unitPrice;

            if (unitPriceFromScan !== 0 && Math.abs(existingUnitPrice - unitPriceFromScan) > 0.001) {
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
    extractedTotalAmount?: number,
    paymentDueDate?: string | Date
): Promise<{ inventoryPruned: boolean; uniqueScanIdToClear?: string; finalInvoiceId?: string }> {

    const uniqueScanIdToClear = (tempInvoiceId && userId) ? tempInvoiceId.replace(`pending-inv-${userId}_`, '') : undefined;
    let finalInvoiceIdForReturn = tempInvoiceId;


    if ((source === 'upload' || source.endsWith('_sync')) && !userId) {
      const authError = new Error("User authentication is required to save products and invoice history.");
      if(uniqueScanIdToClear) (authError as any).uniqueScanIdToClear = uniqueScanIdToClear;
      throw authError;
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    let currentInventory = await getProductsService(userId);
    let currentInvoices = await getInvoicesService(userId);


    let calculatedInvoiceTotalAmountFromProducts = 0;
    let productsProcessedSuccessfully = true;
    let inventoryPruned = false;
    let updatedInventory = [...currentInventory];

    try {
        if (productsToFinalizeSave.length === 0 && source === 'upload') {
           console.warn("[Backend - finalizeSave] No products to finalize, but proceeding to update invoice history.");
        }

        productsToFinalizeSave.forEach((productToSave) => {
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            let unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
            const salePrice = productToSave.salePrice !== undefined && !isNaN(parseFloat(String(productToSave.salePrice))) ? parseFloat(String(productToSave.salePrice)) : undefined;
            let lineTotal = parseFloat(String(productToSave.lineTotal)) || 0;

            if (quantityToAdd !== 0) {
                const calculatedUnitPrice = parseFloat((lineTotal / quantityToAdd).toFixed(2));
                if (Math.abs(calculatedUnitPrice - unitPrice) > 0.01 || unitPrice === 0) {
                    unitPrice = calculatedUnitPrice;
                }
            }


            if (!isNaN(lineTotal)) {
                calculatedInvoiceTotalAmountFromProducts += lineTotal;
            }

            let existingIndex = -1;
            if (productToSave.id && !productToSave.id.startsWith('prod-temp-') && !productToSave.id.includes('-new')) {
                 existingIndex = updatedInventory.findIndex(p => p.id === productToSave.id);
            }
            if (existingIndex === -1 && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                existingIndex = updatedInventory.findIndex(p => p.catalogNumber === productToSave.catalogNumber);
            }
            if (existingIndex === -1 && productToSave.barcode && productToSave.barcode.trim() !== '') {
                existingIndex = updatedInventory.findIndex(p => p.barcode === productToSave.barcode);
            }


            if (existingIndex !== -1) {
                const existingProduct = updatedInventory[existingIndex];
                 if (source === 'upload' && !source.endsWith('_sync')) { 
                    existingProduct.quantity += quantityToAdd;
                 } else if (source.endsWith('_sync')) { 
                    existingProduct.quantity = quantityToAdd;
                 }
                existingProduct.unitPrice = existingProduct.unitPrice; // Keep existing unit price
                existingProduct.description = existingProduct.description; // Keep existing description
                existingProduct.shortName = existingProduct.shortName; // Keep existing short name
                existingProduct.barcode = existingProduct.barcode; // Keep existing barcode
                existingProduct.catalogNumber = existingProduct.catalogNumber; // Keep existing catalog number
                existingProduct.salePrice = existingProduct.salePrice; // Keep existing sale price
                existingProduct.minStockLevel = existingProduct.minStockLevel; // Keep existing min stock
                existingProduct.maxStockLevel = existingProduct.maxStockLevel; // Keep existing max stock

                existingProduct.lineTotal = parseFloat((existingProduct.quantity * existingProduct.unitPrice).toFixed(2));
            } else {
                if (!productToSave.catalogNumber && !productToSave.description && !productToSave.barcode) {
                    console.warn("[Backend finalizeSave] Skipping adding product with no identifier:", productToSave);
                    return;
                }
                const newId = `prod-${Date.now()}-${userId ? userId.slice(0,3) : 'guest'}-${Math.random().toString(36).substring(2, 7)}`;
                const newProductEntry: Product = {
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
                };
                updatedInventory.push(newProductEntry);
            }
        });


        if (updatedInventory.length > MAX_INVENTORY_ITEMS) {
            updatedInventory.sort((a, b) => (b.quantity || 0) - (a.quantity || 0)); 
            updatedInventory = updatedInventory.slice(0, MAX_INVENTORY_ITEMS);
            inventoryPruned = true;
             console.warn(`[Backend - finalizeSave] Inventory pruned to ${MAX_INVENTORY_ITEMS} items.`);
        }

        const inventorySaveSuccess = saveStoredData(INVENTORY_STORAGE_KEY_BASE, updatedInventory, userId);
        if (!inventorySaveSuccess) {
            productsProcessedSuccessfully = false;
            const inventorySaveError = new Error("Failed to save updated inventory data to storage.");
            if(uniqueScanIdToClear) (inventorySaveError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw inventorySaveError;
        }

    } catch (error) {
        productsProcessedSuccessfully = false;
        console.error("[Backend - finalizeSave] Error during product processing/saving:", error);
        const processingError = error instanceof Error ? error : new Error(`Failed to process/save products: Unknown error`);
        if (uniqueScanIdToClear && !(processingError as any).uniqueScanIdToClear) {
            (processingError as any).uniqueScanIdToClear = uniqueScanIdToClear;
        }
        throw processingError;
    }

    if (source === 'upload' && userId) {
        const finalStatus = productsProcessedSuccessfully ? 'completed' : 'error';
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


        if (!tempInvoiceId) {
            const msg = `CRITICAL: tempInvoiceId is missing for source 'upload', UserID: ${userId}. File: ${originalFileName}. Cannot update/create invoice status.`;
            console.error(`[finalizeSaveProductsService] ${msg}`);
            const criticalError = new Error("Failed to finalize invoice record: Missing temporary ID. Inventory might be updated, but the document status is not. Please check manually.");
            (criticalError as any).isInvoiceSaveError = true;
            if(uniqueScanIdToClear) (criticalError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw criticalError;
        }

        const existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === tempInvoiceId);
        let imagePreviewUri: string | undefined = undefined;
        let compressedImageUri: string | undefined = undefined;

        if(uniqueScanIdToClear && userId) {
          imagePreviewUri = localStorage.getItem(`${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${userId}_${uniqueScanIdToClear}`) || undefined;
          compressedImageUri = localStorage.getItem(`${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${userId}_${uniqueScanIdToClear}`) || undefined;
        }


        if (existingInvoiceIndex !== -1) {
            const existingRecord = currentInvoices[existingInvoiceIndex];
            currentInvoices[existingInvoiceIndex] = {
                ...existingRecord,
                fileName: finalGeneratedFileName,
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber || existingRecord.invoiceNumber,
                supplier: finalSupplierName || existingRecord.supplier,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: imagePreviewUri, 
                compressedImageForFinalRecordUri: compressedImageUri, 
                errorMessage: errorMessageOnProductFail || existingRecord.errorMessage,
                paymentStatus: existingRecord.paymentStatus || 'unpaid',
                paymentDueDate: paymentDueDate instanceof Date ? paymentDueDate.toISOString() : paymentDueDate,
                paymentReceiptImageUri: existingRecord.paymentReceiptImageUri,
            };
            finalInvoiceIdForReturn = tempInvoiceId;
        } else {
            const newInvoiceId = `inv-${Date.now()}-${userId.slice(0,3)}-fallback`;
            const newInvoiceRecord: InvoiceHistoryItem = {
                id: newInvoiceId,
                fileName: finalGeneratedFileName,
                uploadTime: new Date().toISOString(),
                status: finalStatus,
                invoiceNumber: extractedInvoiceNumber,
                supplier: finalSupplierName,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: imagePreviewUri,
                compressedImageForFinalRecordUri: compressedImageUri,
                errorMessage: errorMessageOnProductFail || "Pending record was missing, created as new.",
                paymentStatus: 'unpaid',
                paymentDueDate: paymentDueDate instanceof Date ? paymentDueDate.toISOString() : paymentDueDate,
                paymentReceiptImageUri: undefined, 
            };
            currentInvoices.push(newInvoiceRecord);
            finalInvoiceIdForReturn = newInvoiceId;
        }

        if (currentInvoices.length > MAX_INVOICE_HISTORY_ITEMS) {
            currentInvoices.sort((a,b) => new Date(b.uploadTime as string).getTime() - new Date(a.uploadTime as string).getTime());
            currentInvoices = currentInvoices.slice(0, MAX_INVOICE_HISTORY_ITEMS);
            console.warn(`[Backend - finalizeSave] Invoice history pruned to ${MAX_INVOICE_HISTORY_ITEMS} items.`);
        }

        try {
            const invoiceSaveSuccess = saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
            if(!invoiceSaveSuccess) {
                throw new Error("Failed to save updated invoice history to storage.");
            }
        } catch (storageError) {
            console.error(`Critical error saving invoices to localStorage for user ${userId}:`, storageError);
            const saveError = new Error(`Failed to save invoice history: ${(storageError as Error).message}`);
            (saveError as any).isInvoiceSaveError = true;
             if(uniqueScanIdToClear) (saveError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw saveError; 
        }

    } else if (source.endsWith('_sync')) {
         console.log(`[Backend - finalizeSave] POS Sync source detected (${source}). Inventory updated. No invoice history record created/updated for this sync.`);
    } else {
         console.log(`[Backend - finalizeSave] Unknown source (${source}). Inventory updated. No invoice history record created/updated.`);
    }

     if (uniqueScanIdToClear && userId) {
        clearTemporaryScanData(uniqueScanIdToClear, userId);
    } else {
         console.warn(`[Backend - finalizeSave] Could not clear temporary scan data. uniqueScanId: ${uniqueScanIdToClear}, userId: ${userId}`);
    }

    return { inventoryPruned, uniqueScanIdToClear, finalInvoiceId: finalInvoiceIdForReturn };
}


export async function getProductsService(userId?: string): Promise<Product[]> {
  if (!userId) {
    return [];
  }
  await new Promise(resolve => setTimeout(resolve, 50)); 
  const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY_BASE, userId, []);

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
  return inventoryWithDefaults;
}

export async function getProductByIdService(productId: string, userId?: string): Promise<Product | null> {
   if (!userId) {
    return null;
   }
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
}

export async function deleteProductService(productId: string, userId?: string): Promise<void> {
  if (!userId) {
    console.error(`[deleteProductService] UserID is required to delete product ${productId}. Aborting.`);
    throw new Error("User authentication is required to delete products.");
  }
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = await getProductsService(userId);
  const initialLength = currentInventory.length;
  const updatedInventory = currentInventory.filter(p => p.id !== productId);

  if (updatedInventory.length === initialLength && currentInventory.some(p => p.id === productId) ) { 
     console.warn(`[deleteProductService] Product with ID ${productId} was found but not removed by filter for user ${userId}. This is unexpected.`);
  } else if (updatedInventory.length === initialLength && !currentInventory.some(p => p.id === productId)){
     console.warn(`[deleteProductService] Product with ID ${productId} not found for user ${userId}. No deletion occurred.`);
  }

  saveStoredData(INVENTORY_STORAGE_KEY_BASE, updatedInventory, userId);
}


export async function getInvoicesService(userId?: string): Promise<InvoiceHistoryItem[]> {
  if (!userId) {
    return [];
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  const invoicesRaw = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY_BASE, userId, []);

  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${userId.slice(0,3)}-${Math.random().toString(36).substring(2, 9)}`,
    uploadTime: inv.uploadTime instanceof Date ? inv.uploadTime.toISOString() : new Date(inv.uploadTime).toISOString(),
    paymentStatus: inv.paymentStatus || 'unpaid',
    paymentReceiptImageUri: inv.paymentReceiptImageUri || undefined,
    originalImagePreviewUri: inv.originalImagePreviewUri || undefined,
    compressedImageForFinalRecordUri: inv.compressedImageForFinalRecordUri || undefined,
  }));
  return invoices;
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId?: string): Promise<void> {
  if (!userId) {
    console.error(`[updateInvoiceService] UserID is required to update invoice ${invoiceId}. Aborting.`);
    throw new Error("User authentication is required to update invoices.");
  }
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
    uploadTime: originalInvoice.uploadTime, 
    originalImagePreviewUri: updatedData.originalImagePreviewUri === null ? undefined : (updatedData.originalImagePreviewUri ?? originalInvoice.originalImagePreviewUri),
    compressedImageForFinalRecordUri: updatedData.compressedImageForFinalRecordUri === null ? undefined : (updatedData.compressedImageForFinalRecordUri ?? originalInvoice.compressedImageForFinalRecordUri),
    status: originalInvoice.status, 
    paymentStatus: updatedData.paymentStatus || originalInvoice.paymentStatus || 'unpaid',
    paymentReceiptImageUri: updatedData.paymentReceiptImageUri === null ? undefined : (updatedData.paymentReceiptImageUri ?? originalInvoice.paymentReceiptImageUri),
  };

  currentInvoices[invoiceIndex] = finalUpdatedData;

  saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId?: string, paymentReceiptImageUri?: string): Promise<void> {
  if (!userId) {
    console.error(`[updateInvoicePaymentStatusService] UserID is required to update payment status for invoice ${invoiceId}. Aborting.`);
    throw new Error("User authentication is required to update payment status.");
  }
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = await getInvoicesService(userId);
  const invoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceId);

  if (invoiceIndex === -1) {
    console.error(`[updateInvoicePaymentStatusService] Invoice with ID ${invoiceId} not found for user ${userId}.`);
    throw new Error(`Invoice with ID ${invoiceId} not found.`);
  }

  currentInvoices[invoiceIndex].paymentStatus = paymentStatus;
  if (paymentStatus === 'paid' && paymentReceiptImageUri) {
    currentInvoices[invoiceIndex].paymentReceiptImageUri = paymentReceiptImageUri;
  } else if (paymentStatus !== 'paid') {
    currentInvoices[invoiceIndex].paymentReceiptImageUri = undefined; 
  }


  saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
}


export async function deleteInvoiceService(invoiceId: string, userId?: string): Promise<void> {
  if (!userId) {
    console.error(`[deleteInvoiceService] UserID is required to delete invoice ${invoiceId}. Aborting.`);
    throw new Error("User authentication is required to delete invoices.");
  }
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInvoices = await getInvoicesService(userId);
  const initialLength = currentInvoices.length;
  const updatedInvoices = currentInvoices.filter(inv => inv.id !== invoiceId);

  if (updatedInvoices.length === initialLength && currentInvoices.some(inv => inv.id === invoiceId) ) { 
     console.warn(`[deleteInvoiceService] Invoice with ID ${invoiceId} was found but not removed by filter for user ${userId}. This is unexpected.`);
  } else if (updatedInvoices.length === initialLength && !currentInvoices.some(inv => inv.id === invoiceId)) {
     console.warn(`[deleteInvoiceService] Invoice with ID ${invoiceId} not found for user ${userId}. No deletion occurred.`);
  }

  saveStoredData(INVOICES_STORAGE_KEY_BASE, updatedInvoices, userId);
}


export async function clearInventoryService(userId?: string): Promise<void> {
    if (!userId) {
        console.error("[clearInventoryService] UserID is required to clear inventory. Aborting.");
        throw new Error("User authentication is required to clear inventory.");
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    saveStoredData(INVENTORY_STORAGE_KEY_BASE, [], userId);
}


// --- POS Settings Management ---
export async function savePosSettingsService(systemId: string, config: PosConnectionConfig, userId?: string): Promise<void> {
    if (!userId) {
        console.error("[savePosSettingsService] UserID is required to save POS settings. Aborting.");
        throw new Error("User authentication is required to save POS settings.");
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    const settings: StoredPosSettings = { systemId, config };
    saveStoredData(POS_SETTINGS_STORAGE_KEY_BASE, settings, userId);
}

// Helper to get a generic object from localStorage (used by getPosSettings and getAccountantSettings)
const getStoredObject = <T>(keyBase: string, userId?: string): T | null => {
  if (typeof window === 'undefined') return null;
  const storageKey = getStorageKey(keyBase, userId);
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) as T : null;
  } catch (error) {
    console.error(`Error reading ${storageKey} from localStorage:`, error);
    return null;
  }
};


export async function getPosSettingsService(userId?: string): Promise<StoredPosSettings | null> {
  if (typeof window === 'undefined') { 
    return null;
  }
  if (!userId) {
    // console.warn("[getPosSettingsService] No userId provided, returning null.");
    return null;
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  return getStoredObject<StoredPosSettings>(POS_SETTINGS_STORAGE_KEY_BASE, userId);
}

export async function clearPosSettingsService(userId?: string): Promise<void> {
    if (typeof window === 'undefined') { 
        return;
    }
    if (!userId) {
        console.error("[clearPosSettingsService] UserID is required to clear POS settings. Aborting.");
        throw new Error("User authentication is required to clear POS settings.");
    }
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
    return [];
  }
  const invoices = await getInvoicesService(userId);
  const storedSuppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);

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
    throw new Error("User authentication is required to create suppliers.");
  }
  await new Promise(resolve => setTimeout(resolve, 100)); 

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);

  if (suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Supplier with name "${name}" already exists.`);
  }

  const newSupplierData = { name, phone: contactInfo.phone, email: contactInfo.email };
  suppliers.push(newSupplierData);
  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);

  return { name, invoiceCount: 0, totalSpent: 0, ...contactInfo };
}

export async function deleteSupplierService(supplierName: string, userId?: string): Promise<void> {
  if (!userId) {
    throw new Error("User authentication is required to delete suppliers.");
  }
  const storageKey = getStorageKey(SUPPLIERS_STORAGE_KEY_BASE, userId);
  
  await new Promise(resolve => setTimeout(resolve, 100)); 

  let suppliers: Array<{ name: string; phone?: string; email?: string }> = [];
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      suppliers = JSON.parse(stored);
    }
  } catch (e) {
    console.error(`Error reading suppliers from localStorage key ${storageKey}:`, e);
    return;
  }

  const initialLength = suppliers.length;
  const updatedSuppliers = suppliers.filter(s => s.name !== supplierName);

  if (updatedSuppliers.length === initialLength) {
    if (suppliers.some(s => s.name === supplierName)) {
      console.error(`[deleteSupplierService] CRITICAL: Supplier "${supplierName}" was in the list for user ${userId} but filter did not remove it. Key: ${storageKey}.`);
    } else {
      // No need to throw an error if the supplier wasn't found, just means there's nothing to delete.
      // console.warn(`[deleteSupplierService] Supplier "${supplierName}" not found in the list for user ${userId} (key: ${storageKey}). No deletion occurred.`);
    }
  }
  
  const success = saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, updatedSuppliers, userId);
  if (!success) {
    console.error(`[deleteSupplierService] Failed to save updated supplier list for user ${userId} to key "${storageKey}" after attempting to delete "${supplierName}".`);
  }
}


export async function updateSupplierContactInfoService(supplierName: string, contactInfo: { phone?: string; email?: string }, userId?: string): Promise<void> {
  if (!userId) {
    throw new Error("User authentication is required to update suppliers.");
  }
  await new Promise(resolve => setTimeout(resolve, 100)); 

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);
  const supplierIndex = suppliers.findIndex(s => s.name === supplierName);

  if (supplierIndex !== -1) {
    suppliers[supplierIndex] = {
      ...suppliers[supplierIndex], 
      phone: contactInfo.phone,    
      email: contactInfo.email,    
      name: supplierName          
    };
  } else {
    console.warn(`[updateSupplierContactInfoService] Supplier "${supplierName}" not found for user ${userId}. Creating new entry.`);
    suppliers.push({ name: supplierName, ...contactInfo });
  }
  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);
}

// --- Accountant Settings Management ---
export async function saveAccountantSettingsService(settings: AccountantSettings, userId?: string): Promise<void> {
    if (!userId) {
        console.error("[saveAccountantSettingsService] UserID is required. Aborting.");
        throw new Error("User authentication is required to save accountant settings.");
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    saveStoredData(ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE, settings, userId);
}

export async function getAccountantSettingsService(userId?: string): Promise<AccountantSettings | null> {
    if (typeof window === 'undefined') return null;
    if (!userId) {
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    return getStoredObject<AccountantSettings>(ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE, userId);
}


export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined' || !uniqueScanId || !userId) {
        console.warn(`[clearTemporaryScanData] Cannot clear. Window: ${typeof window !== 'undefined'}, uniqueScanId: ${uniqueScanId}, userId: ${userId}`);
        return;
    }

    const dataKey = `${TEMP_DATA_KEY_PREFIX}${userId}_${uniqueScanId}`;
    const originalImageKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${userId}_${uniqueScanId}`;
    const compressedImageKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${userId}_${uniqueScanId}`;

    console.log(`[clearTemporaryScanData] Attempting to remove: ${dataKey}, ${originalImageKey}, ${compressedImageKey}`);
    localStorage.removeItem(dataKey);
    localStorage.removeItem(originalImageKey);
    localStorage.removeItem(compressedImageKey);
    console.log(`[clearTemporaryScanData] Finished removing temporary data for UserID: ${userId}, UniqueScanID: ${uniqueScanId}`);
}


export function clearOldTemporaryScanData(emergencyClear: boolean = false, userIdToClear?: string) {
  if (typeof window === 'undefined') return; 
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000; 
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
        const isTempDataKey = key.startsWith(TEMP_DATA_KEY_PREFIX);
        const isTempOriginalImageKey = key.startsWith(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX);
        const isTempCompressedImageKey = key.startsWith(TEMP_COMPRESSED_IMAGE_KEY_PREFIX);

        if (isTempDataKey || isTempOriginalImageKey || isTempCompressedImageKey) {
            if (userIdToClear && !key.includes(`_${userIdToClear}_`)) {
                continue; 
            }

            const parts = key.split('_');
            let timestamp: number | null = null;
            const timestampString = parts.find(part => /^\d{13,}$/.test(part));
            if (timestampString) {
              timestamp = parseInt(timestampString, 10);
            }
            
            if (timestamp && !isNaN(timestamp) && (now - timestamp > oneDay)) {
              keysToRemove.push(key);
            } else if (!timestamp && emergencyClear) {
              console.warn(`[clearOldTemporaryScanData Emergency] No clear timestamp in key "${key}", but clearing due to emergency mode.`);
              keysToRemove.push(key);
            }
        }
    }
  }

  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    itemsCleared++;
  });

  if (itemsCleared > 0) {
    console.log(`[clearOldTemporaryScanData] Cleared ${itemsCleared} old/emergency temporary scan data items (Targeted user: ${userIdToClear || 'All Users'}).`);
  }
}
