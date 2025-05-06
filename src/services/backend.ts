'use client';

import type { PosConnectionConfig } from './pos-integration/pos-adapter.interface'; // Import POS types

/**
 * Represents a product extracted from a document or POS system.
 */
export interface Product {
  /**
   * Unique identifier for the product in the inventory. Generated if not provided.
   */
  id: string;
  /**
   * The catalog number of the product.
   */
  catalogNumber: string;
  /**
   * The description of the product.
   */
  description: string;
  /**
   * A short, concise name for the product (e.g., for quick display). Optional.
   */
  shortName?: string;
   /**
   * The barcode (EAN/UPC) of the product. Optional.
   */
  barcode?: string;
  /**
   * The quantity of the product.
   */
  quantity: number;
  /**
   * The unit price of the product. Calculated as lineTotal / quantity if possible.
   */
  unitPrice: number;
  /**
   * The line total for the product.
   */
  lineTotal: number;
}

// Define the structure for invoice history items
export interface InvoiceHistoryItem {
  id: string; // Could be the same ID as upload history or a separate one
  fileName: string;
  uploadTime: Date | string; // Allow string for JSON parsing
  status: 'pending' | 'processing' | 'completed' | 'error';
  invoiceNumber?: string; // Extracted invoice number
  supplier?: string; // Extracted supplier
  totalAmount?: number; // Extracted total amount
  errorMessage?: string;
  invoiceDataUri?: string; // URI of the scanned invoice image
}

// --- Storage Keys ---
const INVENTORY_STORAGE_KEY = 'mockInventoryData';
const INVOICES_STORAGE_KEY = 'mockInvoicesData';
const POS_SETTINGS_STORAGE_KEY = 'mockPosSettings'; // New key for POS settings

// --- Initial Mock Data ---
const initialMockInventory: Product[] = [
   { id: 'prod1', catalogNumber: '12345', barcode: '7290012345011', description: 'Sample Product 1 (Mock)', shortName: 'Sample 1', quantity: 10, unitPrice: 9.99, lineTotal: 99.90 },
   { id: 'prod2', catalogNumber: '67890', barcode: '7290067890012', description: 'Sample Product 2 (Mock)', shortName: 'Sample 2', quantity: 5, unitPrice: 19.99, lineTotal: 99.95 },
   { id: 'prod3', catalogNumber: 'ABCDE', barcode: '72900ABCDE013', description: 'Another Mock Item', shortName: 'Another Mock', quantity: 25, unitPrice: 1.50, lineTotal: 37.50 },
   { id: 'prod4', catalogNumber: 'LOW01', barcode: '72900LOW01014', description: 'Low Stock Mock', shortName: 'Low Stock', quantity: 8, unitPrice: 5.00, lineTotal: 40.00 },
   { id: 'prod5', catalogNumber: 'OUT01', barcode: '72900OUT01015', description: 'Out of Stock Mock', shortName: 'Out Stock', quantity: 0, unitPrice: 12.00, lineTotal: 0.00 },
];

const initialMockInvoices: InvoiceHistoryItem[] = [
  { id: 'inv1', fileName: 'invoice_acme_corp.pdf', uploadTime: new Date(Date.now() - 86400000 * 1).toISOString(), status: 'completed', invoiceNumber: 'INV-1001', supplier: 'Acme Corp', totalAmount: 1250.75, invoiceDataUri: 'https://picsum.photos/600/800?random=1' },
  { id: 'inv2', fileName: 'delivery_note_beta_inc.jpg', uploadTime: new Date(Date.now() - 86400000 * 3).toISOString(), status: 'completed', invoiceNumber: 'DN-0523', supplier: 'Beta Inc', totalAmount: 800.00, invoiceDataUri: 'https://picsum.photos/600/800?random=2' },
  { id: 'inv3', fileName: 'receipt_gamma_ltd.png', uploadTime: new Date(Date.now() - 86400000 * 5).toISOString(), status: 'error', errorMessage: 'Failed to extract totals', invoiceDataUri: 'https://picsum.photos/600/800?random=3' },
];

// Interface for stored POS settings
interface StoredPosSettings {
    systemId: string;
    config: PosConnectionConfig;
}

// --- LocalStorage Helper Functions ---
const getStoredData = <T extends {id: string}>(key: string, initialData?: T[]): T[] => {
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
  }
};


/**
 * Represents the response from the document processing API.
 */
export interface DocumentProcessingResponse {
  /**
   * The list of products extracted from the document.
   */
  products: Product[];
}


/**
 * Asynchronously saves the edited product data and creates/updates an invoice history record.
 * Uses localStorage for persistence.
 * If a product already exists (matched by ID or catalog number), its quantity is increased and lineTotal recalculated.
 * Otherwise, a new product is added.
 * An invoice history item is created or updated ONLY if source is 'upload'.
 *
 * @param productsToSave The list of products to save.
 * @param fileName The name of the original file processed.
 * @param source Optional source identifier (e.g., 'upload', 'caspit_sync'). Defaults to 'upload'.
 * @param invoiceDataUri Optional URI of the scanned invoice image, used only if source is 'upload'.
 * @param tempId Optional temporary ID used for optimistic UI updates. This ID will be used for the final record if provided.
 * @returns A promise that resolves when the data is successfully saved.
 */
export async function saveProducts(
    productsToSave: Product[],
    fileName: string,
    source: string = 'upload',
    invoiceDataUri?: string, // Explicitly pass this for invoice history
    tempId?: string
): Promise<void> {
  console.log(`Saving products for file: ${fileName} (source: ${source}, tempId: ${tempId})`, productsToSave);
  await new Promise(resolve => setTimeout(resolve, 100));

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);

  let invoiceTotalAmount = 0;
  let productsProcessedSuccessfully = true;

  try {
    const updatedInventory = [...currentInventory];

    productsToSave.forEach(newProduct => {
      const quantityToAdd = parseFloat(String(newProduct.quantity)) || 0;
      const lineTotal = parseFloat(String(newProduct.lineTotal)) || 0;
      let unitPrice = parseFloat(String(newProduct.unitPrice)) || 0;
       if (unitPrice === 0 && quantityToAdd !== 0 && lineTotal !==0) {
          unitPrice = parseFloat((lineTotal / quantityToAdd).toFixed(2));
       }

      invoiceTotalAmount += lineTotal;

      let existingIndex = -1;
      if (newProduct.barcode && newProduct.barcode.trim() !== '') {
          existingIndex = updatedInventory.findIndex(p => p.barcode === newProduct.barcode);
      }
      if (existingIndex === -1 && newProduct.id && !newProduct.id.includes('-new') && newProduct.id !== tempId) {
          existingIndex = updatedInventory.findIndex(p => p.id === newProduct.id);
      }
      if (existingIndex === -1 && newProduct.catalogNumber && newProduct.catalogNumber !== 'N/A') {
          existingIndex = updatedInventory.findIndex(p => p.catalogNumber === newProduct.catalogNumber);
      }


      if (existingIndex !== -1) {
        const existingProduct = updatedInventory[existingIndex];
        existingProduct.quantity += quantityToAdd;
        const priceToUse = (existingProduct.unitPrice && existingProduct.unitPrice > 0) ? existingProduct.unitPrice : unitPrice;
        existingProduct.unitPrice = priceToUse;
        existingProduct.lineTotal = parseFloat((existingProduct.quantity * priceToUse).toFixed(2));
        existingProduct.description = newProduct.description || existingProduct.description;
        existingProduct.shortName = newProduct.shortName || existingProduct.shortName;
        existingProduct.barcode = newProduct.barcode || existingProduct.barcode;
        existingProduct.catalogNumber = newProduct.catalogNumber || existingProduct.catalogNumber;
        console.log(`Updated existing product ID ${existingProduct.id}: Qty=${existingProduct.quantity}, LineTotal=${existingProduct.lineTotal}`);
      } else {
         if (!newProduct.catalogNumber && !newProduct.description && !newProduct.barcode) {
             console.log("Skipping adding product with no identifier:", newProduct);
             return;
         }
         const newId = (newProduct.id && !newProduct.id.includes('-new') && newProduct.id !== tempId)
                        ? newProduct.id
                        : `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
         const productToAdd: Product = {
          ...newProduct,
          id: newId,
          quantity: quantityToAdd,
          unitPrice: unitPrice,
          lineTotal: lineTotal,
          catalogNumber: newProduct.catalogNumber || 'N/A',
          description: newProduct.description || 'No Description',
          barcode: newProduct.barcode,
          shortName: newProduct.shortName || (newProduct.description || 'No Description').split(' ').slice(0, 3).join(' '),
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
    throw new Error(`Failed to process products for inventory: ${(error as Error).message}`);
  }

  // Only create/update invoice history if the source is 'upload'
  if (source === 'upload') {
    const finalStatus = productsProcessedSuccessfully ? 'completed' : 'error';
    const errorMessage = productsProcessedSuccessfully ? undefined : 'Failed to process some products into inventory.';

    let invoiceIdToUse: string;
    let existingInvoiceIndex = -1;

    if (tempId) {
        existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === tempId);
        invoiceIdToUse = tempId; // Use the tempId if provided (for updating optimistic entry)
    } else {
        invoiceIdToUse = `inv-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    }

    const invoiceRecord: InvoiceHistoryItem = {
        id: invoiceIdToUse,
        fileName: fileName,
        uploadTime: new Date().toISOString(),
        status: finalStatus,
        totalAmount: parseFloat(invoiceTotalAmount.toFixed(2)),
        invoiceDataUri: invoiceDataUri, // Use the passed invoiceDataUri
        errorMessage: errorMessage,
        invoiceNumber: existingInvoiceIndex !== -1 ? currentInvoices[existingInvoiceIndex].invoiceNumber : undefined,
        supplier: existingInvoiceIndex !== -1 ? currentInvoices[existingInvoiceIndex].supplier : undefined,
    };

    if (existingInvoiceIndex !== -1) {
        currentInvoices[existingInvoiceIndex] = invoiceRecord;
        console.log(`Updated invoice record ID: ${invoiceIdToUse}`);
    } else {
        currentInvoices = [invoiceRecord, ...currentInvoices];
        console.log(`Created new invoice record ID: ${invoiceIdToUse}`);
    }
    saveStoredData(INVOICES_STORAGE_KEY, currentInvoices);
    console.log('Updated localStorage invoices:', currentInvoices);
  } else {
     console.log(`Skipping invoice history update for source: ${source}`);
  }


  if (!productsProcessedSuccessfully && source === 'upload') {
    const saveError = new Error('One or more products failed to save to inventory. Invoice record updated with error status.');
    (saveError as any).updatedBySaveProducts = true;
    throw saveError;
  }
}


/**
 * Asynchronously retrieves the list of all products using localStorage.
 * Ensures each product has an ID.
 * @returns A promise that resolves to an array of Product objects.
 */
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
        barcode: item.barcode || undefined
      };
  });
  console.log("Returning inventory with recalculated totals and shortNames:", inventoryWithDefaults);
  return inventoryWithDefaults;
}

/**
 * Asynchronously retrieves a single product by its ID using localStorage.
 * Ensures the returned product has an ID.
 * @param productId The ID of the product to retrieve.
 * @returns A promise that resolves to the Product object or null if not found.
 */
export async function getProductById(productId: string): Promise<Product | null> {
   console.log(`getProductById called for ID: ${productId}`);
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
           barcode: product.barcode || undefined
        };
   }
   return null;
}


/**
 * Asynchronously updates an existing product in localStorage.
 * Finds the product by ID and replaces it with the updated data.
 * @param productId The ID of the product to update.
 * @param updatedData Partial product data containing the fields to update.
 * @returns A promise that resolves when the update is complete.
 * @throws Error if the product with the given ID is not found.
 */
export async function updateProduct(productId: string, updatedData: Partial<Product>): Promise<void> {
  console.log(`updateProduct called for ID: ${productId}`, updatedData);
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


  currentInventory[productIndex] = updatedProduct;

  saveStoredData(INVENTORY_STORAGE_KEY, currentInventory);
  console.log(`Product ${productId} updated successfully.`);
}

/**
 * Asynchronously deletes a product from localStorage by its ID.
 * @param productId The ID of the product to delete.
 * @returns A promise that resolves when the deletion is complete.
 * @throws Error if the product with the given ID is not found.
 */
export async function deleteProduct(productId: string): Promise<void> {
  console.log(`deleteProduct called for ID: ${productId}`);
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


/**
 * Asynchronously retrieves the list of all processed invoices using localStorage.
 * Parses date strings back into Date objects and ensures each invoice has an ID.
 * @returns A promise that resolves to an array of InvoiceHistoryItem objects.
 */
export async function getInvoices(): Promise<InvoiceHistoryItem[]> {
  console.log("getInvoices called");
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

/**
 * Asynchronously deletes an invoice from localStorage by its ID.
 * @param invoiceId The ID of the invoice to delete.
 * @returns A promise that resolves when the deletion is complete.
 * @throws Error if the invoice with the given ID is not found.
 */
export async function deleteInvoice(invoiceId: string): Promise<void> {
  console.log(`deleteInvoice called for ID: ${invoiceId}`);
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


/**
 * Asynchronously clears all inventory data from localStorage.
 * @returns A promise that resolves when the inventory is cleared.
 */
export async function clearInventory(): Promise<void> {
    console.log("clearInventory called");
    await new Promise(resolve => setTimeout(resolve, 100));
    saveStoredData(INVENTORY_STORAGE_KEY, []);
    console.log("Inventory cleared from localStorage.");
}


// --- POS Integration Settings ---

/**
 * Asynchronously saves the POS system connection settings.
 * @param systemId - The ID of the POS system (e.g., 'caspit').
 * @param config - The connection configuration.
 * @returns A promise that resolves when settings are saved.
 */
export async function savePosSettings(systemId: string, config: PosConnectionConfig): Promise<void> {
    console.log(`[Backend] Saving POS settings for ${systemId}`, config);
    await new Promise(resolve => setTimeout(resolve, 100));
    const settings: StoredPosSettings = { systemId, config };
    saveStoredData(POS_SETTINGS_STORAGE_KEY, settings);
    console.log("[Backend] POS settings saved to localStorage.");
}

/**
 * Asynchronously retrieves the saved POS system connection settings.
 * This function is intended for client-side use only.
 * @returns A promise that resolves to the stored settings object or null if none exist.
 */
export async function getPosSettings(): Promise<StoredPosSettings | null> {
  if (typeof window === 'undefined') {
    console.warn("[Backend] getPosSettings called from server-side. Returning null.");
    return null; // Cannot access localStorage on server
  }
  console.log("[Backend] Retrieving POS settings (client-side).");
  await new Promise(resolve => setTimeout(resolve, 50));
  const settings = getStoredObject<StoredPosSettings>(POS_SETTINGS_STORAGE_KEY);
  console.log("[Backend] Retrieved POS settings (client-side):", settings);
  return settings;
}


// --- Auth ---

export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// Auth functions remain as they interact with localStorage directly in AuthContext
/**
 * Asynchronously registers a new user.
 *
 * @param userData The user registration data.
 * @returns A promise that resolves with the authentication response.
 */
export async function register(userData: any): Promise<AuthResponse> {
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

/**
 * Asynchronously logs in an existing user.
 *
 * @param credentials The user login credentials.
 * @returns A promise that resolves with the authentication response.
 */
export async function login(credentials: any): Promise<AuthResponse> {
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