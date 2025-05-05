'use client';

/**
 * Represents a product extracted from a document.
 */
export interface Product {
  /**
   * Optional unique identifier for the product in the inventory.
   */
  id?: string;
  /**
   * The catalog number of the product.
   */
  catalogNumber: string;
  /**
   * The description of the product.
   */
  description: string;
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
}

const INVENTORY_STORAGE_KEY = 'mockInventoryData';
const INVOICES_STORAGE_KEY = 'mockInvoicesData';

// Initial mock inventory data store (only used if localStorage is empty)
const initialMockInventory: Product[] = [
   { id: 'prod1', catalogNumber: '12345', description: 'Sample Product 1 (Mock)', quantity: 10, unitPrice: 9.99, lineTotal: 99.90 },
   { id: 'prod2', catalogNumber: '67890', description: 'Sample Product 2 (Mock)', quantity: 5, unitPrice: 19.99, lineTotal: 99.95 },
   { id: 'prod3', catalogNumber: 'ABCDE', description: 'Another Mock Item', quantity: 25, unitPrice: 1.50, lineTotal: 37.50 },
   { id: 'prod4', catalogNumber: 'LOW01', description: 'Low Stock Mock', quantity: 8, unitPrice: 5.00, lineTotal: 40.00 },
   { id: 'prod5', catalogNumber: 'OUT01', description: 'Out of Stock Mock', quantity: 0, unitPrice: 12.00, lineTotal: 0.00 },
];

// Initial mock invoice history data store (only used if localStorage is empty)
const initialMockInvoices: InvoiceHistoryItem[] = [
  { id: 'inv1', fileName: 'invoice_acme_corp.pdf', uploadTime: new Date(Date.now() - 86400000 * 1).toISOString(), status: 'completed', invoiceNumber: 'INV-1001', supplier: 'Acme Corp', totalAmount: 1250.75 },
  { id: 'inv2', fileName: 'delivery_note_beta_inc.jpg', uploadTime: new Date(Date.now() - 86400000 * 3).toISOString(), status: 'completed', invoiceNumber: 'DN-0523', supplier: 'Beta Inc', totalAmount: 800.00 },
  { id: 'inv3', fileName: 'receipt_gamma_ltd.png', uploadTime: new Date(Date.now() - 86400000 * 5).toISOString(), status: 'error', errorMessage: 'Failed to extract totals' },
];

// Helper to safely get data from localStorage
const getStoredData = <T>(key: string, initialData: T[]): T[] => {
  if (typeof window === 'undefined') {
    // Return initial data during SSR or if window is not available
    return initialData;
  }
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    } else {
      // Initialize localStorage if key doesn't exist
      localStorage.setItem(key, JSON.stringify(initialData));
      return initialData;
    }
  } catch (error) {
    console.error(`Error reading ${key} from localStorage:`, error);
    return initialData; // Return initial data on error
  }
};

// Helper to safely save data to localStorage
const saveStoredData = <T>(key: string, data: T[]): void => {
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
        description: 'Extracted Item A',
        quantity: 2,
        unitPrice: 15.00, // Assuming AI might provide this or it's calculated later
        lineTotal: 30.00,
      },
      {
         id: `new-${Date.now()}-2`,
        catalogNumber: 'EXTRACT-002',
        description: 'Extracted Item B',
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
 *
 * @param products The list of products to save.
 * @param fileName The name of the original file processed.
 * @returns A promise that resolves when the data is successfully saved.
 */
export async function saveProducts(products: Product[], fileName: string): Promise<void> {
  console.log('Saving products for file:', fileName, products);
  await new Promise(resolve => setTimeout(resolve, 100)); // Short delay

  let currentInventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  let currentInvoices = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);

  let invoiceTotalAmount = 0;

  const updatedInventory = [...currentInventory]; // Create a mutable copy

  products.forEach(newProduct => {
    const quantity = parseFloat(String(newProduct.quantity)) || 0;
    const lineTotal = parseFloat(String(newProduct.lineTotal)) || 0;
    // Recalculate unit price here to ensure consistency before saving
    const unitPrice = quantity !== 0 ? parseFloat((lineTotal / quantity).toFixed(2)) : 0;

    invoiceTotalAmount += lineTotal;

    let existingIndex = -1;
    if (newProduct.id) {
        existingIndex = updatedInventory.findIndex(p => p.id === newProduct.id);
    }
    if (existingIndex === -1 && newProduct.catalogNumber && newProduct.catalogNumber !== 'N/A') {
        existingIndex = updatedInventory.findIndex(p => p.catalogNumber === newProduct.catalogNumber);
    }

    if (existingIndex !== -1) {
      console.log(`Updating product ${updatedInventory[existingIndex].catalogNumber} (ID: ${updatedInventory[existingIndex].id})`);
      // Merge existing data with new data, ensuring essential fields are updated
      updatedInventory[existingIndex] = {
          ...updatedInventory[existingIndex], // Keep existing fields like ID
          ...newProduct, // Overwrite with new data
          quantity: quantity,
          unitPrice: unitPrice, // Use recalculated unit price
          lineTotal: lineTotal,
          catalogNumber: newProduct.catalogNumber || updatedInventory[existingIndex].catalogNumber,
          description: newProduct.description || updatedInventory[existingIndex].description,
      };
       console.log(`Product updated:`, updatedInventory[existingIndex]);

    } else {
       if (!newProduct.catalogNumber && !newProduct.description) {
           console.log("Skipping adding product with no catalog number or description:", newProduct);
           return;
       }
      console.log(`Adding new product: ${newProduct.catalogNumber || newProduct.description}`);
      const productToAdd: Product = {
        ...newProduct,
        id: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        quantity: quantity,
        unitPrice: unitPrice,
        lineTotal: lineTotal,
        catalogNumber: newProduct.catalogNumber || 'N/A',
        description: newProduct.description || 'No Description',
      };
      updatedInventory.push(productToAdd);
      console.log(`Product added:`, productToAdd);
    }
  });

   // Add a record to the invoice history
   const newInvoiceRecord: InvoiceHistoryItem = {
       id: `inv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
       fileName: fileName,
       uploadTime: new Date().toISOString(), // Store as ISO string
       status: 'completed',
       totalAmount: parseFloat(invoiceTotalAmount.toFixed(2)),
       // TODO: Add supplier/invoiceNumber if available
   };
   const updatedInvoices = [newInvoiceRecord, ...currentInvoices];

   // Save updated data back to localStorage
   saveStoredData(INVENTORY_STORAGE_KEY, updatedInventory);
   saveStoredData(INVOICES_STORAGE_KEY, updatedInvoices);

   console.log('Updated localStorage inventory:', updatedInventory);
   console.log('Updated localStorage invoices:', updatedInvoices);

  return;
}


/**
 * Asynchronously retrieves the list of all products using localStorage.
 *
 * @returns A promise that resolves to an array of Product objects.
 */
export async function getProductsService(): Promise<Product[]> {
  console.log("getProductsService called");
  await new Promise(resolve => setTimeout(resolve, 50)); // Simulate small delay
  const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
  console.log("Returning inventory from localStorage:", inventory);
  return inventory; // Directly return the data from localStorage helper
}

/**
 * Asynchronously retrieves a single product by its ID using localStorage.
 *
 * @param productId The ID of the product to retrieve.
 * @returns A promise that resolves to the Product object or null if not found.
 */
export async function getProductById(productId: string): Promise<Product | null> {
   console.log(`getProductById called for ID: ${productId}`);
   await new Promise(resolve => setTimeout(resolve, 50));
   const inventory = getStoredData<Product>(INVENTORY_STORAGE_KEY, initialMockInventory);
   const product = inventory.find(p => p.id === productId);
   return product ? { ...product } : null; // Return a copy or null
}

/**
 * Asynchronously retrieves the list of all processed invoices using localStorage.
 * Parses date strings back into Date objects.
 *
 * @returns A promise that resolves to an array of InvoiceHistoryItem objects.
 */
export async function getInvoices(): Promise<InvoiceHistoryItem[]> {
  console.log("getInvoices called");
  await new Promise(resolve => setTimeout(resolve, 50));
  const invoicesRaw = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY, initialMockInvoices);
  // Convert stored date strings back to Date objects
  const invoices = invoicesRaw.map(inv => ({
    ...inv,
    uploadTime: new Date(inv.uploadTime) // Parse string back to Date
  }));
  console.log("Returning invoices from localStorage:", invoices);
  return invoices;
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
