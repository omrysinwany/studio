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
  { id: 'inv3', fileName: 'receipt_gamma_ltd.png', uploadTime: new Date(Date.now() - 86400000 * 5).toISOString(), status: 'error', errorMessage: 'Failed to extract totals' },
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
      // Ensure each item has an ID
      const parsedData = JSON.parse(stored) as T[];
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || `${key}-${Date.now()}-${index}` // Assign generated ID if missing
      }));
    } else if (initialData) {
       const dataWithIds = initialData.map((item, index) => ({
            ...item,
            id: item.id || `${key}-initial-${Date.now()}-${index}`
       }));
      localStorage.setItem(key, JSON.stringify(dataWithIds));
      return dataWithIds;
    }
    return []; // Return empty array if no initial data and nothing stored
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
 * Asynchronously uploads a document and retrieves the extracted product data.
 * This remains a server-side concept simulation for now, as AI flow is server-side.
 *
 * @param document The document file to upload (JPEG, PNG, or PDF).
 * @returns A promise that resolves to a DocumentProcessingResponse object containing the extracted product data.
 */
export async function uploadDocument(document: File): Promise<DocumentProcessingResponse> {
  // TODO: Implement this by calling your backend API.
  // Provide a stubbed response for now.
  console.log("uploadDocument called with file:", document.name);
  // Simulate some delay
  await new Promise(resolve => setTimeout(resolve, 500));
  return {
    products: [
      {
        id: `new-${Date.now()}-1`,
        catalogNumber: 'EXTRACT-001',
        barcode: '72900EXTRACT01',
        description: 'Extracted Item A',
        shortName: 'Extracted A',
        quantity: 2,
        unitPrice: 15.00, // Assuming AI might provide this or it's calculated later
        lineTotal: 30.00,
      },
      {
         id: `new-${Date.now()}-2`,
        catalogNumber: 'EXTRACT-002',
        barcode: '72900EXTRACT02',
        description: 'Extracted Item B',
        shortName: 'Extracted B',
        quantity: 1,
        unitPrice: 50.50, // Assuming AI might provide this or it's calculated later
        lineTotal: 50.50,
      },
    ],
  };
}

/**
 * Asynchronously saves the edited product data and creates an invoice history record.
 * Uses localStorage for persistence.
 * If a product already exists (matched by ID or catalog number), its quantity is increased and lineTotal recalculated.
 * Otherwise, a new product is added.
 *
 * @param products The list of products to save.
 * @param fileName The name of the original file processed.
 * @param source - Optional source identifier (e.g., 'upload', 'caspit_sync'). Defaults to 'upload'.
 * @param invoiceDataUri - Optional URI of the scanned invoice image.
 * @returns A promise that resolves when the data is successfully saved.
 */
export async function saveProducts(
    products: Product[],
    fileName: string,
    source: string = 'upload', // Add source parameter
    invoiceDataUri?: string // Add invoiceDataUri parameter
): Promise<void> {
  console.log(`Saving products for file: ${fileName} (source: ${source})`, products);
  await new Promise(resolve => setTimeout(resolve, 100)); // Short delay

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);

  let invoiceTotalAmount = 0;

  const updatedInventory = [...currentInventory]; // Create a mutable copy

  products.forEach(newProduct => {
    const quantityToAdd = parseFloat(String(newProduct.quantity)) || 0;
    const lineTotal = parseFloat(String(newProduct.lineTotal)) || 0;
    // Use the provided unitPrice, or calculate if possible and provided one is zero/missing
    let unitPrice = parseFloat(String(newProduct.unitPrice)) || 0;
     if (unitPrice === 0 && quantityToAdd !== 0) {
        unitPrice = parseFloat((lineTotal / quantityToAdd).toFixed(2));
     }

    invoiceTotalAmount += lineTotal;

    let existingIndex = -1;
    // Priority for matching: 1. Barcode, 2. ID, 3. Catalog Number
    if (newProduct.barcode) {
        existingIndex = updatedInventory.findIndex(p => p.barcode === newProduct.barcode);
    }
    if (existingIndex === -1 && newProduct.id) {
        existingIndex = updatedInventory.findIndex(p => p.id === newProduct.id);
    }
     // If no match yet, try matching by catalog number
    if (existingIndex === -1 && newProduct.catalogNumber && newProduct.catalogNumber !== 'N/A') {
        existingIndex = updatedInventory.findIndex(p => p.catalogNumber === newProduct.catalogNumber);
    }

    if (existingIndex !== -1) {
      // Product exists, ADD to quantity
      const existingProduct = updatedInventory[existingIndex];
      console.log(`Updating quantity for product ${existingProduct.catalogNumber || existingProduct.barcode} (ID: ${existingProduct.id}). Adding ${quantityToAdd}.`);
      existingProduct.quantity += quantityToAdd;
      // Recalculate lineTotal based on the new quantity and existing unit price
      existingProduct.lineTotal = parseFloat((existingProduct.quantity * existingProduct.unitPrice).toFixed(2));
       // Optionally update description, shortName, or barcode if the new one is more descriptive/accurate?
       // For now, let's keep the existing data unless it's empty. Update barcode if new one exists and old one doesn't.
       existingProduct.description = existingProduct.description || newProduct.description;
       existingProduct.shortName = existingProduct.shortName || newProduct.shortName;
       existingProduct.barcode = existingProduct.barcode || newProduct.barcode; // Update barcode if missing
       existingProduct.catalogNumber = existingProduct.catalogNumber || newProduct.catalogNumber; // Update catalog# if missing
      console.log(`Product updated:`, existingProduct);

    } else {
       // Product is new, add it to inventory
       if (!newProduct.catalogNumber && !newProduct.description && !newProduct.barcode) {
           console.log("Skipping adding product with no identifier (catalog, description, barcode):", newProduct);
           return;
       }
       // Generate a new unique ID if one wasn't provided
       const newId = newProduct.id || `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
       console.log(`Adding new product: ${newProduct.catalogNumber || newProduct.barcode || newProduct.description} with ID ${newId}`);
       const productToAdd: Product = {
        ...newProduct,
        id: newId,
        quantity: quantityToAdd,
        unitPrice: unitPrice, // Use the determined unit price
        lineTotal: lineTotal,
        catalogNumber: newProduct.catalogNumber || 'N/A',
        description: newProduct.description || 'No Description',
        barcode: newProduct.barcode, // Add barcode
        shortName: newProduct.shortName || (newProduct.description || 'No Description').split(' ').slice(0, 3).join(' '), // Generate fallback shortName
      };
      updatedInventory.push(productToAdd);
      console.log(`Product added:`, productToAdd);
      // TODO: Consider adding a flag or notification here that this is a *new* product being added
      // This could be used by the UI to prompt for barcode assignment if needed.
    }
  });

   // Add a record to the invoice history ONLY if the source is an upload/manual edit
   if (source === 'upload') {
        // Generate a unique ID for the invoice record
        const newInvoiceId = `inv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        console.log(`Adding new invoice record with ID: ${newInvoiceId}`);
       const newInvoiceRecord: InvoiceHistoryItem = {
           id: newInvoiceId,
           fileName: fileName,
           uploadTime: new Date().toISOString(), // Store as ISO string
           status: 'completed',
           totalAmount: parseFloat(invoiceTotalAmount.toFixed(2)),
           invoiceDataUri: invoiceDataUri, // Store the image URI
       };
       const updatedInvoices = [newInvoiceRecord, ...currentInvoices];
       saveStoredData(INVOICES_STORAGE_KEY, updatedInvoices);
       console.log('Updated localStorage invoices:', updatedInvoices);
   } else {
        console.log(`Skipping invoice history update for source: ${source}`);
   }


   // Save updated inventory data back to localStorage
   saveStoredData(INVENTORY_STORAGE_KEY, updatedInventory);
   console.log('Updated localStorage inventory:', updatedInventory);

  return;
}


/**
 * Asynchronously retrieves the list of all products using localStorage.
 * Ensures each product has an ID.
 * @returns A promise that resolves to an array of Product objects.
 */
export async function getProductsService(): Promise<Product[]> {
  console.log("getProductsService called");
  await new Promise(resolve => setTimeout(resolve, 50)); // Simulate small delay
  const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  console.log("Returning inventory from localStorage:", inventory);
  // Recalculate lineTotal and ensure shortName exists for consistency before returning
  const inventoryWithDefaults = inventory.map(item => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const description = item.description || 'No Description';
      return {
        ...item,
        // Ensure ID exists, just in case getStoredData logic changes
        id: item.id || `prod-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        description: description,
        shortName: item.shortName || description.split(' ').slice(0, 3).join(' '), // Generate fallback shortName
        lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
        barcode: item.barcode || undefined // Ensure barcode exists or is undefined
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
   // Recalculate lineTotal and ensure shortName exists before returning
   if (product) {
        const quantity = Number(product.quantity) || 0;
        const unitPrice = Number(product.unitPrice) || 0;
        const description = product.description || 'No Description';
        return {
           ...product,
           id: product.id || productId, // Ensure ID is present
           description: description,
           shortName: product.shortName || description.split(' ').slice(0, 3).join(' '), // Generate fallback shortName
           lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
           barcode: product.barcode || undefined // Ensure barcode exists or is undefined
        };
   }
   return null; // Return null if product not found
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
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay

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
    id: productId, // Ensure ID remains the same
  };

   // Recalculate lineTotal if quantity or unitPrice was part of the update
   if (updatedData.quantity !== undefined || updatedData.unitPrice !== undefined) {
       const quantity = Number(updatedProduct.quantity) || 0;
       const unitPrice = Number(updatedProduct.unitPrice) || 0;
       updatedProduct.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
   }
    // Ensure shortName exists after update
    if (!updatedProduct.shortName) {
         const description = updatedProduct.description || 'No Description';
         updatedProduct.shortName = description.split(' ').slice(0, 3).join(' ');
    }
    // Ensure barcode exists or is undefined
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
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay

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
  // Convert stored date strings back to Date objects and ensure ID
  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, // Ensure ID exists
    uploadTime: new Date(inv.uploadTime) // Parse string back to Date
  }));
  console.log("Returning invoices from localStorage:", invoices);
  return invoices;
}

/**
 * Asynchronously clears all inventory data from localStorage.
 * @returns A promise that resolves when the inventory is cleared.
 */
export async function clearInventory(): Promise<void> {
    console.log("clearInventory called");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay
    saveStoredData(INVENTORY_STORAGE_KEY, []); // Save an empty array
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
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay
    const settings: StoredPosSettings = { systemId, config };
    saveStoredData(POS_SETTINGS_STORAGE_KEY, settings);
    console.log("[Backend] POS settings saved to localStorage.");
}

/**
 * Asynchronously retrieves the saved POS system connection settings.
 * @returns A promise that resolves to the stored settings object or null if none exist.
 */
export async function getPosSettings(): Promise<StoredPosSettings | null> {
    console.log("[Backend] Retrieving POS settings.");
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate delay
    const settings = getStoredObject<StoredPosSettings>(POS_SETTINGS_STORAGE_KEY);
    console.log("[Backend] Retrieved POS settings:", settings);
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
  // TODO: Implement this by calling your REAL backend API.
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
  // TODO: Implement this by calling your REAL backend API.
  console.log("Logging in user:", credentials.username);
  await new Promise(resolve => setTimeout(resolve, 500));
  // Simple mock logic: accept any login for now
  const loggedInUser: User = {
    id: 'user-mock-123',
    username: credentials.username,
    email: `${credentials.username}@example.com`, // Mock email
  };
  return {
    token: 'mock_login_token_' + Date.now(),
    user: loggedInUser,
  };
}