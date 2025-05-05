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
  uploadTime: Date;
  status: 'pending' | 'processing' | 'completed' | 'error';
  invoiceNumber?: string; // Extracted invoice number
  supplier?: string; // Extracted supplier
  totalAmount?: number; // Extracted total amount
  errorMessage?: string;
}


// Mock inventory data store
let mockInventory: Product[] = [
   { id: 'prod1', catalogNumber: '12345', description: 'Sample Product 1 (Mock)', quantity: 10, unitPrice: 9.99, lineTotal: 99.90 },
   { id: 'prod2', catalogNumber: '67890', description: 'Sample Product 2 (Mock)', quantity: 5, unitPrice: 19.99, lineTotal: 99.95 },
   { id: 'prod3', catalogNumber: 'ABCDE', description: 'Another Mock Item', quantity: 25, unitPrice: 1.50, lineTotal: 37.50 },
   { id: 'prod4', catalogNumber: 'LOW01', description: 'Low Stock Mock', quantity: 8, unitPrice: 5.00, lineTotal: 40.00 },
   { id: 'prod5', catalogNumber: 'OUT01', description: 'Out of Stock Mock', quantity: 0, unitPrice: 12.00, lineTotal: 0.00 },
];

// Mock invoice history data store
let mockInvoices: InvoiceHistoryItem[] = [
   // Keep initial mock data for display until real saves happen
  { id: 'inv1', fileName: 'invoice_acme_corp.pdf', uploadTime: new Date(Date.now() - 86400000 * 1), status: 'completed', invoiceNumber: 'INV-1001', supplier: 'Acme Corp', totalAmount: 1250.75 },
  { id: 'inv2', fileName: 'delivery_note_beta_inc.jpg', uploadTime: new Date(Date.now() - 86400000 * 3), status: 'completed', invoiceNumber: 'DN-0523', supplier: 'Beta Inc', totalAmount: 800.00 },
  { id: 'inv3', fileName: 'receipt_gamma_ltd.png', uploadTime: new Date(Date.now() - 86400000 * 5), status: 'error', errorMessage: 'Failed to extract totals' },
];


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
 * Asynchronously saves the edited product data to the backend and creates an invoice history record.
 * In this mock implementation, it adds/updates products in mockInventory and adds to mockInvoices.
 *
 * @param products The list of products to save.
 * @param fileName The name of the original file processed.
 * @returns A promise that resolves when the data is successfully saved.
 */
export async function saveProducts(products: Product[], fileName: string): Promise<void> {
  console.log('Saving products for file:', fileName, products);
  await new Promise(resolve => setTimeout(resolve, 300));

  let invoiceTotalAmount = 0; // Calculate total amount for the invoice record

  products.forEach(newProduct => {
    // Ensure values are numbers, default to 0 if not
    const quantity = typeof newProduct.quantity === 'number' ? newProduct.quantity : 0;
    const lineTotal = typeof newProduct.lineTotal === 'number' ? newProduct.lineTotal : 0;
    // Recalculate unitPrice here to ensure consistency before saving
    const unitPrice = quantity !== 0 ? parseFloat((lineTotal / quantity).toFixed(2)) : 0;

    invoiceTotalAmount += lineTotal; // Add to invoice total

    // Attempt to find by ID first, then catalog number
    let existingIndex = -1;
    if (newProduct.id) {
        existingIndex = mockInventory.findIndex(p => p.id === newProduct.id);
    }
    // Only search by catalog number if ID didn't match or wasn't provided
    if (existingIndex === -1 && newProduct.catalogNumber && newProduct.catalogNumber !== 'N/A') {
        existingIndex = mockInventory.findIndex(p => p.catalogNumber === newProduct.catalogNumber);
    }

    if (existingIndex !== -1) {
      // Update existing product
      console.log(`Updating product ${mockInventory[existingIndex].catalogNumber} (ID: ${mockInventory[existingIndex].id})`);
      mockInventory[existingIndex] = {
          ...newProduct, // Copy new data first
          id: mockInventory[existingIndex].id, // Ensure original ID is kept
          quantity: quantity,
          unitPrice: unitPrice, // Use recalculated unit price
          lineTotal: lineTotal,
          catalogNumber: newProduct.catalogNumber || mockInventory[existingIndex].catalogNumber,
          description: newProduct.description || mockInventory[existingIndex].description,
      };
       console.log(`Product updated:`, mockInventory[existingIndex]);

    } else {
      // Add new product if it has some identifying information
       if (!newProduct.catalogNumber && !newProduct.description) {
           console.log("Skipping adding product with no catalog number or description:", newProduct);
           return; // Skip adding essentially empty rows
       }
      console.log(`Adding new product: ${newProduct.catalogNumber || newProduct.description}`);
      const productToAdd: Product = {
        ...newProduct,
        id: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, // Generate a unique ID
        quantity: quantity,
        unitPrice: unitPrice, // Use recalculated unit price
        lineTotal: lineTotal,
        catalogNumber: newProduct.catalogNumber || 'N/A',
        description: newProduct.description || 'No Description',
      };
      mockInventory.push(productToAdd);
      console.log(`Product added:`, productToAdd);
    }
  });

   // Add a record to the invoice history
   const newInvoiceRecord: InvoiceHistoryItem = {
       id: `inv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
       fileName: fileName,
       uploadTime: new Date(),
       status: 'completed', // Assume saving means completion
       totalAmount: parseFloat(invoiceTotalAmount.toFixed(2)), // Store calculated total
       // TODO: Add supplier/invoiceNumber if they are extracted by AI or entered by user
   };
   mockInvoices.push(newInvoiceRecord);
   console.log('Added invoice record:', newInvoiceRecord);
   console.log('Updated mockInventory:', mockInventory);
   console.log('Updated mockInvoices:', mockInvoices);

  return;
}


/**
 * Asynchronously retrieves the list of all products from the backend.
 * Renamed to avoid potential naming conflicts.
 *
 * @returns A promise that resolves to an array of Product objects.
 */
export async function getProductsService(): Promise<Product[]> {
  // TODO: Implement this by calling your backend API.
  console.log("getProductsService called");
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));
  // Return a deep copy of the mock data to prevent direct mutation issues
  console.log("Returning inventory:", JSON.parse(JSON.stringify(mockInventory)));
  return JSON.parse(JSON.stringify(mockInventory));
}

/**
 * Asynchronously retrieves a single product by its ID from the backend.
 *
 * @param productId The ID of the product to retrieve.
 * @returns A promise that resolves to the Product object or null if not found.
 */
export async function getProductById(productId: string): Promise<Product | null> {
   // TODO: Implement this by calling your backend API.
   console.log(`getProductById called for ID: ${productId}`);
   // Simulate API delay
   await new Promise(resolve => setTimeout(resolve, 300));
   const product = mockInventory.find(p => p.id === productId);
   return product ? { ...product } : null; // Return a copy or null
}

/**
 * Asynchronously retrieves the list of all processed invoices from the backend.
 *
 * @returns A promise that resolves to an array of InvoiceHistoryItem objects.
 */
export async function getInvoices(): Promise<InvoiceHistoryItem[]> {
  // TODO: Implement this by calling your backend API.
  console.log("getInvoices called");
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 400));
  // Return a deep copy
  console.log("Returning invoices:", JSON.parse(JSON.stringify(mockInvoices)));
  return JSON.parse(JSON.stringify(mockInvoices));
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

/**
 * Asynchronously registers a new user.
 *
 * @param userData The user registration data.
 * @returns A promise that resolves with the authentication response.
 */
export async function register(userData: any): Promise<AuthResponse> {
  // TODO: Implement this by calling your backend API.
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
  // TODO: Implement this by calling your backend API.
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
