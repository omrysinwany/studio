
// src/services/backend.ts
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
  imageUrl?: string;
  _originalId?: string;
}

export interface InvoiceHistoryItem {
  id: string;
  fileName: string;
  uploadTime: string; 
  status: 'pending' | 'processing' | 'completed' | 'error';
  documentType: 'deliveryNote' | 'invoice';
  invoiceNumber?: string;
  supplier?: string;
  totalAmount?: number;
  errorMessage?: string;
  originalImagePreviewUri?: string;
  compressedImageForFinalRecordUri?: string;
  paymentReceiptImageUri?: string;
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentDueDate?: string; 
  invoiceDate?: string; 
  paymentMethod?: string;
}

export interface SupplierSummary {
  name: string;
  invoiceCount: number;
  totalSpent: number;
  phone?: string;
  email?: string;
  paymentTerms?: string; 
  lastActivityDate?: string; 
}

export interface AccountantSettings {
  name?: string;
  email?: string;
  phone?: string;
}

export interface UserSettings {
  reminderDaysBefore?: number;
}

export interface OtherExpense { 
  id: string;
  category: string;
  _internalCategoryKey?: string;
  description: string;
  amount: number;
  date: string;
}


export const INVENTORY_STORAGE_KEY_BASE = 'invoTrack_inventory';
export const INVOICES_STORAGE_KEY_BASE = 'invoTrack_invoices';
export const POS_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_posSettings';
export const SUPPLIERS_STORAGE_KEY_BASE = 'invoTrack_suppliers';
export const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_accountantSettings';
export const USER_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_userSettings'; 
export const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses'; 


export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';


export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.4 * 1024 * 1024;
export const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.15 * 1024 * 1024;
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.5 * 1024 * 1024;
export const MAX_INVENTORY_ITEMS = 1000;
export const MAX_INVOICE_HISTORY_ITEMS = 200; 


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

export const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(`[getStorageKey] Attempted to get storage key for base "${baseKey}" without a userId. This might lead to shared data or errors.`);
    return `${baseKey}_SHARED_OR_ERROR`;
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
          id: item.id || (item.name ? `${keyBase}-item-${item.name.replace(/\s+/g, '_')}-${index}` : `${keyBase}-item-${Date.now()}-${index}-${Math.random().toString(36).substring(2,7)}`)
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
  if (!userId) {
    console.error(`[saveStoredData Backend] UserID is missing for key base "${keyBase}". Data not saved to prevent unauthenticated access or data mismatch.`);
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
        throw retryError;
      }
    } else {
      throw error; 
    }
  }
};


export async function checkProductPricesBeforeSaveService(
    productsToCheck: Product[],
    userId?: string,
): Promise<PriceCheckResult> {
    await new Promise(resolve => setTimeout(resolve, 50));
     if (!userId) {
      console.error("checkProductPricesBeforeSaveService: User ID is missing.");
      throw new Error("User authentication is required to check product prices.");
    }

    const currentInventory = await getProductsService(userId);
    const productsToSaveDirectly: Product[] = [];
    const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

    for (const scannedProduct of productsToCheck) {
        const quantityFromScan = parseFloat(String(scannedProduct.quantity)) || 0;
        const lineTotalFromScan = parseFloat(String(scannedProduct.lineTotal)) || 0;
        let unitPriceFromScan = parseFloat(String(scannedProduct.unitPrice)) || 0;

        if (quantityFromScan !== 0 && lineTotalFromScan !== 0) {
            const calculatedUnitPrice = parseFloat((lineTotalFromScan / quantityFromScan).toFixed(2));
            if (Math.abs(calculatedUnitPrice - unitPriceFromScan) > 0.01 || unitPriceFromScan === 0) {
                 unitPriceFromScan = calculatedUnitPrice;
                 console.log(`[PriceCheck] For ${scannedProduct.catalogNumber}, unit price adjusted from ${scannedProduct.unitPrice} to ${unitPriceFromScan} based on total/qty.`);
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
                    minStockLevel: scannedProduct.minStockLevel ?? existingProduct.minStockLevel,
                    maxStockLevel: scannedProduct.maxStockLevel ?? existingProduct.maxStockLevel,
                    imageUrl: scannedProduct.imageUrl ?? existingProduct.imageUrl,
                });
            } else {
                productsToSaveDirectly.push({
                    ...scannedProduct,
                    id: existingProduct.id, 
                    unitPrice: existingUnitPrice, 
                    salePrice: scannedProduct.salePrice ?? existingProduct.salePrice,
                    minStockLevel: scannedProduct.minStockLevel ?? existingProduct.minStockLevel,
                    maxStockLevel: scannedProduct.maxStockLevel ?? existingProduct.maxStockLevel,
                    imageUrl: scannedProduct.imageUrl ?? existingProduct.imageUrl,
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
    originalFileNameFromUpload: string, 
    documentType: 'deliveryNote' | 'invoice',
    userId?: string,
    tempInvoiceId?: string,
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number,
    paymentDueDate?: string,
    invoiceDate?: string,
    paymentMethod?: string,
    originalImagePreviewUriToSave?: string,
    compressedImageForFinalRecordUriToSave?: string
): Promise<{
  inventoryPruned: boolean;
  uniqueScanIdToClear?: string;
  finalInvoiceRecord?: InvoiceHistoryItem;
  savedProductsWithFinalIds?: Product[];
}> {

    const uniqueScanIdToClear = (tempInvoiceId && userId) ? tempInvoiceId.replace(`pending-inv-${userId}_`, '') : undefined;
    let finalInvoiceRecord: InvoiceHistoryItem | undefined = undefined;
    const processedProductsForReturn: Product[] = [];


    if (!userId) {
      const authError = new Error("User authentication is required to save products and invoice history.");
      if(uniqueScanIdToClear) (authError as any).uniqueScanIdToClear = uniqueScanIdToClear;
      throw authError;
    }

    await new Promise(resolve => setTimeout(resolve, 50)); 

    let currentInventory = await getProductsService(userId);
    let currentInvoices = await getInvoicesService(userId);


    let calculatedInvoiceTotalAmountFromProducts = 0;
    let productsProcessedSuccessfully = true;
    let inventoryPruned = false;
    let updatedInventory = [...currentInventory];

    try {
        if (productsToFinalizeSave.length === 0 && documentType === 'deliveryNote') {
           console.warn("[Backend - finalizeSave] No products to finalize for this delivery note, but proceeding to update/create invoice history.");
        }

        productsToFinalizeSave.forEach((productToSave) => {
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            let unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
            const salePrice = productToSave.salePrice !== undefined && !isNaN(parseFloat(String(productToSave.salePrice))) ? parseFloat(String(productToSave.salePrice)) : undefined;
            let lineTotal = parseFloat(String(productToSave.lineTotal)) || 0;

            if (quantityToAdd !== 0 && lineTotal !== 0) {
                const calculatedUnitPrice = parseFloat((lineTotal / quantityToAdd).toFixed(2));
                 if (unitPrice === 0 || Math.abs(calculatedUnitPrice - unitPrice) > 0.01 ) {
                    console.log(`[finalizeSaveProductsService] For product ${productToSave.catalogNumber || productToSave.description}, unit price was ${unitPrice}, recalculated to ${calculatedUnitPrice} based on total/qty.`);
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
                 if (documentType === 'deliveryNote') { 
                    existingProduct.quantity = (existingProduct.quantity || 0) + quantityToAdd;
                 } else if (documentType === 'invoice' && tempInvoiceId?.includes('_sync')) {
                    existingProduct.quantity = quantityToAdd;
                 }
                existingProduct.unitPrice = (unitPrice && unitPrice > 0 && Math.abs(unitPrice - existingProduct.unitPrice) > 0.001) ? unitPrice : existingProduct.unitPrice;
                existingProduct.description = productToSave.description || existingProduct.description;
                existingProduct.shortName = productToSave.shortName || existingProduct.shortName;
                existingProduct.barcode = productToSave.barcode === null ? undefined : (productToSave.barcode ?? existingProduct.barcode);
                existingProduct.catalogNumber = productToSave.catalogNumber || existingProduct.catalogNumber;
                existingProduct.salePrice = salePrice ?? existingProduct.salePrice;
                existingProduct.minStockLevel = productToSave.minStockLevel ?? existingProduct.minStockLevel;
                existingProduct.maxStockLevel = productToSave.maxStockLevel ?? existingProduct.maxStockLevel;
                existingProduct.imageUrl = productToSave.imageUrl ?? existingProduct.imageUrl;
                existingProduct.lineTotal = parseFloat(((existingProduct.quantity || 0) * existingProduct.unitPrice).toFixed(2));
                processedProductsForReturn.push({...existingProduct});
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
                    imageUrl: productToSave.imageUrl,
                };
                updatedInventory.push(newProductEntry);
                processedProductsForReturn.push({...newProductEntry});
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

    if (documentType && userId) {
        const finalStatus = productsProcessedSuccessfully ? 'completed' : 'error';
        const errorMessageOnProductFail = !productsProcessedSuccessfully ? 'Failed to process some products into inventory. Invoice may be incomplete.' : (productsToFinalizeSave.length === 0 && !extractedTotalAmount && documentType === 'deliveryNote' ? 'No products found in scan and no total amount provided.' : undefined);

        const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && !isNaN(extractedTotalAmount))
                                        ? extractedTotalAmount
                                        : parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2));

        let finalGeneratedFileName = originalFileNameFromUpload; 
        if (finalSupplierName && finalSupplierName.trim() !== '') {
            finalGeneratedFileName = finalSupplierName.trim();
            if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
                finalGeneratedFileName += `_${extractedInvoiceNumber.trim()}`;
            }
        } else if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
            finalGeneratedFileName = `Invoice_${extractedInvoiceNumber.trim()}`;
        }


        if (!tempInvoiceId) {
            const msg = `CRITICAL: tempInvoiceId is missing for source 'upload', UserID: ${userId}. File: ${originalFileNameFromUpload}. Cannot update/create invoice status.`;
            console.error(`[finalizeSaveProductsService] ${msg}`);
            const criticalError = new Error("Failed to finalize invoice record: Missing temporary ID. Inventory might be updated, but the document status is not. Please check manually.");
            (criticalError as any).isInvoiceSaveError = true;
            if(uniqueScanIdToClear) (criticalError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw criticalError;
        }

        const existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === tempInvoiceId);


        if (existingInvoiceIndex !== -1) {
            const existingRecord = currentInvoices[existingInvoiceIndex];
            currentInvoices[existingInvoiceIndex] = {
                ...existingRecord,
                fileName: finalGeneratedFileName, 
                status: finalStatus,
                documentType: documentType,
                invoiceNumber: extractedInvoiceNumber || existingRecord.invoiceNumber,
                supplier: finalSupplierName || existingRecord.supplier,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: originalImagePreviewUriToSave || existingRecord.originalImagePreviewUri,
                compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave || existingRecord.compressedImageForFinalRecordUri,
                errorMessage: errorMessageOnProductFail || existingRecord.errorMessage, 
                paymentStatus: existingRecord.paymentStatus || 'unpaid',
                paymentDueDate: paymentDueDate, 
                paymentReceiptImageUri: existingRecord.paymentReceiptImageUri,
                invoiceDate: invoiceDate, 
                paymentMethod: paymentMethod, 
            };
            finalInvoiceRecord = currentInvoices[existingInvoiceIndex];
            console.log(`[finalizeSaveProductsService] Updated existing invoice record ID: ${tempInvoiceId}`, currentInvoices[existingInvoiceIndex]);
        } else {
            const newInvoiceId = `inv-${Date.now()}-${userId.slice(0,3)}-${Math.random().toString(36).substring(2,9)}`;
            const newInvoiceRecordData: InvoiceHistoryItem = {
                id: newInvoiceId,
                fileName: finalGeneratedFileName,
                uploadTime: new Date().toISOString(),
                status: finalStatus,
                documentType: documentType,
                invoiceNumber: extractedInvoiceNumber,
                supplier: finalSupplierName,
                totalAmount: finalInvoiceTotalAmount,
                originalImagePreviewUri: originalImagePreviewUriToSave,
                compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave,
                errorMessage: errorMessageOnProductFail || "Pending record was missing, created as new.",
                paymentStatus: 'unpaid',
                paymentDueDate: paymentDueDate, 
                paymentReceiptImageUri: undefined,
                invoiceDate: invoiceDate, 
                paymentMethod: paymentMethod, 
            };
            currentInvoices.push(newInvoiceRecordData);
            finalInvoiceRecord = newInvoiceRecordData;
            console.log(`[finalizeSaveProductsService] Created new invoice record ID: ${newInvoiceId} (pending record not found for ${tempInvoiceId})`, newInvoiceRecordData);
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
            (saveError as any).updatedBySaveProducts = true; 
             if(uniqueScanIdToClear) (saveError as any).uniqueScanIdToClear = uniqueScanIdToClear;
            throw saveError;
        }

    } else if (tempInvoiceId?.includes('_sync')) {
         console.log(`[Backend - finalizeSave] POS Sync source detected. Inventory updated. No invoice history record created/updated for this sync.`);
    } else {
         console.log(`[Backend - finalizeSave] Unknown source or missing documentType/userId. Inventory updated. No invoice history record created/updated.`);
    }

     if (uniqueScanIdToClear && userId) {
        clearTemporaryScanData(uniqueScanIdToClear, userId);
    } else {
         console.warn(`[Backend - finalizeSave] Could not clear temporary scan data. uniqueScanId: ${uniqueScanIdToClear}, userId: ${userId}`);
    }

    return { inventoryPruned, uniqueScanIdToClear, finalInvoiceRecord, savedProductsWithFinalIds: processedProductsForReturn };
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
        imageUrl: item.imageUrl ?? undefined,
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

    productAfterUpdateAttempt.imageUrl = updatedData.imageUrl === null ? undefined : (updatedData.imageUrl ?? existingProduct.imageUrl);


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
    uploadTime: inv.uploadTime, 
    paymentStatus: inv.paymentStatus || 'unpaid',
    documentType: inv.documentType || 'deliveryNote', 
    paymentReceiptImageUri: inv.paymentReceiptImageUri || undefined,
    originalImagePreviewUri: inv.originalImagePreviewUri || undefined,
    compressedImageForFinalRecordUri: inv.compressedImageForFinalRecordUri || undefined,
    invoiceDate: inv.invoiceDate,
    paymentMethod: inv.paymentMethod
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
    documentType: updatedData.documentType || originalInvoice.documentType,
    originalImagePreviewUri: updatedData.originalImagePreviewUri === null ? undefined : (updatedData.originalImagePreviewUri ?? originalInvoice.originalImagePreviewUri),
    compressedImageForFinalRecordUri: updatedData.compressedImageForFinalRecordUri === null ? undefined : (updatedData.compressedImageForFinalRecordUri ?? originalInvoice.compressedImageForFinalRecordUri),
    status: originalInvoice.status, 
    paymentStatus: updatedData.paymentStatus || originalInvoice.paymentStatus || 'unpaid',
    paymentReceiptImageUri: updatedData.paymentReceiptImageUri === null ? undefined : (updatedData.paymentReceiptImageUri ?? originalInvoice.paymentReceiptImageUri),
    invoiceDate: updatedData.invoiceDate, 
    paymentMethod: updatedData.paymentMethod,
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

// Mock services for login and register
export async function registerService(userData: any): Promise<AuthResponse> {
  console.log("Mock registerService called with:", userData);
  await new Promise(resolve => setTimeout(resolve, 500)); 
  if (!userData.username || !userData.email || !userData.password) {
    throw new Error("Username, email, and password are required for registration.");
  }
  const newUser: User = {
    id: `user-${Date.now()}-${Math.random().toString(36).substring(2,7)}`,
    username: userData.username,
    email: userData.email,
  };
  console.log("Mock user registered:", newUser);
  return {
    token: 'mock_register_token_' + newUser.id, 
    user: newUser,
  };
}

export async function loginService(credentials: any): Promise<AuthResponse> {
  console.log("Mock loginService called with:", credentials);
  await new Promise(resolve => setTimeout(resolve, 500)); 
  if (!credentials.username || !credentials.password) {
    throw new Error("Username and password are required.");
  }
  const loggedInUser: User = {
     id: `user-mock-${credentials.username.toLowerCase().replace(/\s+/g, '')}`, 
    username: credentials.username,
    email: `${credentials.username.toLowerCase().replace(/\s+/g, '')}@example.com`,
  };
  console.log("Mock user logged in:", loggedInUser);
  return {
    token: 'mock_login_token_' + loggedInUser.id, 
    user: loggedInUser,
  };
}


// --- Supplier Management ---
export async function getSupplierSummariesService(userId?: string): Promise<SupplierSummary[]> {
  if (!userId) {
    console.warn("[getSupplierSummariesService] No user ID provided. Returning empty array.");
    return [];
  }
  const invoices = await getInvoicesService(userId);
  const storedSuppliers = getStoredData<{ name: string; phone?: string; email?: string, paymentTerms?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);

  const supplierMap = new Map<string, SupplierSummary>();

  storedSuppliers.forEach(s => {
    if (s && s.name) { 
      supplierMap.set(s.name, {
        name: s.name,
        invoiceCount: 0,
        totalSpent: 0,
        phone: s.phone || undefined,
        email: s.email || undefined,
        paymentTerms: s.paymentTerms || undefined,
        lastActivityDate: undefined 
      });
    }
  });

  invoices.forEach(invoice => {
    if (invoice.supplier && invoice.status === 'completed') { 
      let summary = supplierMap.get(invoice.supplier);
      if (!summary) {
        summary = {
          name: invoice.supplier,
          invoiceCount: 0,
          totalSpent: 0,
          phone: undefined,
          email: undefined,
          paymentTerms: undefined,
          lastActivityDate: undefined
        };
        supplierMap.set(invoice.supplier, summary);
      }
      summary.invoiceCount += 1;
      summary.totalSpent += (invoice.totalAmount || 0);

      if (!summary.lastActivityDate || new Date(invoice.uploadTime as string) > new Date(summary.lastActivityDate)) {
        summary.lastActivityDate = invoice.uploadTime as string;
      }
    }
  });

  return Array.from(supplierMap.values()).sort((a, b) => {
    if (a.lastActivityDate && b.lastActivityDate) {
      return new Date(b.lastActivityDate).getTime() - new Date(a.lastActivityDate).getTime();
    } else if (a.lastActivityDate) {
      return -1; 
    } else if (b.lastActivityDate) {
      return 1; 
    }
    return a.name.localeCompare(b.name); 
  });
}


export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId?: string): Promise<SupplierSummary> {
  if (!userId) {
    throw new Error("User authentication is required to create suppliers.");
  }
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string, paymentTerms?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);

  if (suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Supplier with name "${name}" already exists.`);
  }

  const newSupplierData = { name, phone: contactInfo.phone, email: contactInfo.email, paymentTerms: contactInfo.paymentTerms };
  suppliers.push(newSupplierData);
  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);

  return { name, invoiceCount: 0, totalSpent: 0, ...contactInfo, lastActivityDate: undefined };
}

export async function deleteSupplierService(supplierName: string, userId?: string): Promise<void> {
  if (!userId) {
    console.error(`[deleteSupplierService] UserID is required to delete supplier ${supplierName}. Aborting.`);
    throw new Error("User authentication is required to delete suppliers.");
  }
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []); 
  const initialLength = suppliers.length;
  const updatedSuppliers = suppliers.filter(s => s.name !== supplierName);

  if (updatedSuppliers.length === initialLength) {
     if (!suppliers.some(s => s.name === supplierName)) {
        console.warn(`[deleteSupplierService] Supplier "${supplierName}" not found for user ${userId}. No deletion occurred.`);
        return; 
     } else {
        console.error(`[deleteSupplierService] CRITICAL: Supplier "${supplierName}" was found but filter failed for user ${userId}.`);
        throw new Error(`Failed to delete supplier "${supplierName}" due to an internal filtering error.`);
     }
  }

  const success = saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, updatedSuppliers, userId); 
  if (!success) { 
    console.error(`[deleteSupplierService] Failed to save updated supplier list for user ${userId} after attempting to delete "${supplierName}".`);
  }
}


export async function updateSupplierContactInfoService(supplierName: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId?: string): Promise<void> {
  if (!userId) {
    throw new Error("User authentication is required to update suppliers.");
  }
  await new Promise(resolve => setTimeout(resolve, 100));

  let suppliers = getStoredData<{ name: string; phone?: string; email?: string, paymentTerms?: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);
  const supplierIndex = suppliers.findIndex(s => s.name === supplierName);

  if (supplierIndex !== -1) {
    suppliers[supplierIndex] = {
      ...suppliers[supplierIndex],
      phone: contactInfo.phone,
      email: contactInfo.email,
      paymentTerms: contactInfo.paymentTerms,
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

// --- User Settings Management (for reminder preferences) ---
export async function saveUserSettingsService(settings: UserSettings, userId?: string): Promise<void> {
    if (!userId) {
        console.error("[saveUserSettingsService] UserID is required. Aborting.");
        throw new Error("User authentication is required to save user settings.");
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    saveStoredData(USER_SETTINGS_STORAGE_KEY_BASE, settings, userId);
}

export async function getUserSettingsService(userId?: string): Promise<UserSettings | null> {
    if (typeof window === 'undefined') return null;
    if (!userId) {
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    return getStoredObject<UserSettings>(USER_SETTINGS_STORAGE_KEY_BASE, userId);
}


export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined') {
      console.log(`[clearTemporaryScanData] Aborted: localStorage not available (likely server-side).`);
      return;
    }
    if (!uniqueScanId || !userId) {
        console.warn(`[clearTemporaryScanData] Aborted: Missing uniqueScanId or userId. (uniqueScanId: ${uniqueScanId}, userId: ${userId})`);
        return;
    }

    const dataKey = `${TEMP_DATA_KEY_PREFIX}${userId}_${uniqueScanId}`;
    const originalImageKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${userId}_${uniqueScanId}`;
    const compressedImageKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${userId}_${uniqueScanId}`;

    console.log(`[clearTemporaryScanData] Attempting to remove keys: ${dataKey}, ${originalImageKey}, ${compressedImageKey}`);
    try {
      localStorage.removeItem(dataKey);
      localStorage.removeItem(originalImageKey);
      localStorage.removeItem(compressedImageKey);
      console.log(`[clearTemporaryScanData] Keys removed for UserID: ${userId}, UniqueScanID: ${uniqueScanId}`);
    } catch (error) {
        console.error(`[clearTemporaryScanData] Error removing keys from localStorage for UserID: ${userId}, UniqueScanID: ${uniqueScanId}`, error);
    }
}


export function clearOldTemporaryScanData(emergencyClear: boolean = false, userIdToClear?: string) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day
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


            if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) {
              keysToRemove.push(key);
            } else if (!timestamp && emergencyClear) {
              if (userIdToClear || !key.includes('_SHARED_OR_ERROR_')) {
                 console.warn(`[clearOldTemporaryScanData Emergency] No clear timestamp in key "${key}", but clearing due to emergency mode for user: ${userIdToClear || 'all users'}.`);
                 keysToRemove.push(key);
              }
            }
        }
    }
  }

  keysToRemove.forEach(key => {
    try {
      localStorage.removeItem(key);
      itemsCleared++;
    } catch (e) {
      console.error(`Error removing key ${key} during cleanup:`, e);
    }
  });

  if (itemsCleared > 0) {
    console.log(`[clearOldTemporaryScanData] Cleared ${itemsCleared} old/emergency temporary scan data items (Targeted user: ${userIdToClear || 'All Users'}).`);
  }
}
