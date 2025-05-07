
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

const INVENTORY_STORAGE_KEY = 'mockInventoryData';
const INVOICES_STORAGE_KEY = 'mockInvoicesData';
const POS_SETTINGS_STORAGE_KEY = 'mockPosSettings';

const initialMockInventory: Product[] = [
   { id: 'prod1', catalogNumber: '12345', barcode: '7290012345011', description: 'Sample Product 1 (Mock)', shortName: 'Sample 1', quantity: 10, unitPrice: 9.99, lineTotal: 99.90, minStockLevel: 5, maxStockLevel: 20 },
   { id: 'prod2', catalogNumber: '67890', barcode: '7290067890012', description: 'Sample Product 2 (Mock)', shortName: 'Sample 2', quantity: 5, unitPrice: 19.99, lineTotal: 99.95, minStockLevel: 2, maxStockLevel: 10 },
   { id: 'prod3', catalogNumber: 'ABCDE', barcode: '72900ABCDE013', description: 'Another Mock Item', shortName: 'Another Mock', quantity: 25, unitPrice: 1.50, lineTotal: 37.50, minStockLevel: 10, maxStockLevel: 50 },
   { id: 'prod4', catalogNumber: 'LOW01', barcode: '72900LOW01014', description: 'Low Stock Mock', shortName: 'Low Stock', quantity: 8, unitPrice: 5.00, lineTotal: 40.00, minStockLevel: 10, maxStockLevel: 15 },
   { id: 'prod5', catalogNumber: 'OUT01', barcode: '72900OUT01015', description: 'Out of Stock Mock', shortName: 'Out Stock', quantity: 0, unitPrice: 12.00, lineTotal: 0.00, minStockLevel: 5, maxStockLevel: 10 },
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
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || `${key}-${Date.now()}-${index}`
      }));
    } else if (initialData) {
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
    // Potentially re-throw or handle quota exceeded specifically if needed by callers
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.includes('exceeded the quota'))) {
        throw error; // Re-throw quota error to be handled by caller
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

    const currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
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
        if (scannedProduct.barcode && scannedProduct.barcode.trim() !== '') {
            existingIndex = currentInventory.findIndex(p => p.barcode === scannedProduct.barcode);
        }
        if (existingIndex === -1 && scannedProduct.id && !scannedProduct.id.includes('-new') && scannedProduct.id !== tempId) {
            existingIndex = currentInventory.findIndex(p => p.id === scannedProduct.id);
        }
        if (existingIndex === -1 && scannedProduct.catalogNumber && scannedProduct.catalogNumber !== 'N/A') {
            existingIndex = currentInventory.findIndex(p => p.catalogNumber === scannedProduct.catalogNumber);
        }


        if (existingIndex !== -1) {
            const existingProduct = currentInventory[existingIndex];
            const existingUnitPrice = existingProduct.unitPrice;

            if (unitPriceFromScan !== 0 && Math.abs(existingUnitPrice - unitPriceFromScan) > 0.001) {
                console.log(`Price discrepancy found for product ID ${existingProduct.id}. Existing: ${existingUnitPrice}, New: ${unitPriceFromScan}`);
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
            productsToSaveDirectly.push(scannedProduct);
        }
    });

    console.log("Price check complete. Direct saves:", productsToSaveDirectly, "Discrepancies:", priceDiscrepancies);
    return { productsToSaveDirectly, priceDiscrepancies };
}


export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    fileName: string,
    source: string = 'upload',
    retrievedInvoiceDataUri?: string, // Changed parameter name
    tempInvoiceId?: string
): Promise<void> {
    console.log(`Finalizing save for products: ${fileName} (source: ${source}, tempInvoiceId: ${tempInvoiceId})`, productsToFinalizeSave);
    await new Promise(resolve => setTimeout(resolve, 100));

    let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
    let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);

    let calculatedInvoiceTotalAmount = 0;
    let productsProcessedSuccessfully = true;

    try {
        const updatedInventory = [...currentInventory];

        productsToFinalizeSave.forEach(productToSave => {
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            const unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
            const lineTotal = parseFloat((quantityToAdd * unitPrice).toFixed(2));

            if (!isNaN(lineTotal)) {
                calculatedInvoiceTotalAmount += lineTotal;
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
                // Do not update unit price or other details if product exists, only quantity
                existingProduct.lineTotal = parseFloat((existingProduct.quantity * existingProduct.unitPrice).toFixed(2));
                // Keep existing description, shortName, barcode, catalogNumber, min/max stock
                console.log(`Updated existing product ID ${existingProduct.id}: Qty=${existingProduct.quantity}, UnitPrice=${existingProduct.unitPrice} (unchanged), LineTotal=${existingProduct.lineTotal}`);
            } else {
                if (!productToSave.catalogNumber && !productToSave.description && !productToSave.barcode) {
                    console.log("Skipping adding product with no identifier:", productToSave);
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
                    lineTotal: lineTotal,
                    catalogNumber: productToSave.catalogNumber || 'N/A',
                    description: productToSave.description || 'No Description',
                    barcode: productToSave.barcode,
                    shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                    minStockLevel: productToSave.minStockLevel,
                    maxStockLevel: productToSave.maxStockLevel,
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
    }

    if (source === 'upload') {
        const finalStatus = productsProcessedSuccessfully ? 'completed' : 'error';
        const errorMessage = productsProcessedSuccessfully ? undefined : 'Failed to process some products into inventory.';
        
        let invoiceIdToUse: string;
        let existingInvoiceIndex = -1;

        if (tempInvoiceId) {
            existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === tempInvoiceId);
        }

        if (existingInvoiceIndex !== -1 && tempInvoiceId) {
            invoiceIdToUse = tempInvoiceId;
            const existingRecord = currentInvoices[existingInvoiceIndex];
            currentInvoices[existingInvoiceIndex] = {
                ...existingRecord,
                fileName: fileName,
                uploadTime: new Date().toISOString(),
                status: finalStatus,
                totalAmount: parseFloat(calculatedInvoiceTotalAmount.toFixed(2)),
                invoiceDataUri: retrievedInvoiceDataUri, // Use the passed URI
                errorMessage: errorMessage,
            };
            console.log(`Updated invoice record ID: ${invoiceIdToUse}`);
        } else {
            invoiceIdToUse = tempInvoiceId || `inv-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
            const newInvoiceRecord: InvoiceHistoryItem = {
                id: invoiceIdToUse,
                fileName: fileName,
                uploadTime: new Date().toISOString(),
                status: finalStatus,
                totalAmount: parseFloat(calculatedInvoiceTotalAmount.toFixed(2)),
                invoiceDataUri: retrievedInvoiceDataUri, // Use the passed URI
                errorMessage: errorMessage,
            };
            currentInvoices = [newInvoiceRecord, ...currentInvoices];
            console.log(`Created new invoice record ID: ${invoiceIdToUse}`);
        }
        
        try {
            saveStoredData(INVOICES_STORAGE_KEY, currentInvoices);
            console.log('Updated localStorage invoices:', currentInvoices);
        } catch (storageError) {
            console.error("Critical error saving invoices to localStorage:", storageError);
            const saveError = new Error(`Failed to save invoice history: ${(storageError as Error).message}`);
            (saveError as any).updatedBySaveProducts = true; 
            throw saveError;
        }

        if (!productsProcessedSuccessfully) {
            console.warn("[Backend - finalizeSaveProductsService] Product processing error occurred, invoice status set to 'error'.");
        }
    } else {
        console.log(`Skipping invoice history update for source: ${source}`);
    }
}


export async function getProductsService(): Promise<Product[]> {
  console.log("getProductsService called");
  await new Promise(resolve => setTimeout(resolve, 50));
  const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
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
    updatedProduct.minStockLevel = updatedData.minStockLevel === null ? undefined : (Number.isFinite(updatedData.minStockLevel) ? Number(updatedData.minStockLevel) : currentInventory[productIndex].minStockLevel);
    updatedProduct.maxStockLevel = updatedData.maxStockLevel === null ? undefined : (Number.isFinite(updatedData.maxStockLevel) ? Number(updatedData.maxStockLevel) : currentInventory[productIndex].maxStockLevel);


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
  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    uploadTime: new Date(inv.uploadTime)
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
  const finalUpdatedData: InvoiceHistoryItem = {
    ...originalInvoice,
    ...updatedData,
    id: invoiceId,
    uploadTime: originalInvoice.uploadTime, // Keep original uploadTime
    invoiceDataUri: updatedData.invoiceDataUri === null ? undefined : (updatedData.invoiceDataUri ?? originalInvoice.invoiceDataUri),
    status: originalInvoice.status,
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
    saveStoredData(INVENTORY_STORAGE_KEY, []);
    console.log("Inventory cleared from localStorage.");
}


export async function savePosSettingsService(systemId: string, config: PosConnectionConfig): Promise<void> {
    console.log(`[Backend] Saving POS settings for ${systemId}`, config);
    await new Promise(resolve => setTimeout(resolve, 100));
    const settings: StoredPosSettings = { systemId, config };
    saveStoredData(POS_SETTINGS_STORAGE_KEY, settings);
    console.log("[Backend] POS settings saved to localStorage.");
}

export async function getPosSettingsService(): Promise<StoredPosSettings | null> {
  if (typeof window === 'undefined') {
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
