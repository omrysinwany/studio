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
   * The unit price of the product.
   */
  unitPrice: number;
  /**
   * The line total for the product.
   */
  lineTotal: number;
}

// Mock inventory data store
let mockInventory: Product[] = [
   { id: 'prod1', catalogNumber: '12345', description: 'Sample Product 1 (Mock)', quantity: 10, unitPrice: 9.99, lineTotal: 99.90 },
   { id: 'prod2', catalogNumber: '67890', description: 'Sample Product 2 (Mock)', quantity: 5, unitPrice: 19.99, lineTotal: 99.95 },
   { id: 'prod3', catalogNumber: 'ABCDE', description: 'Another Mock Item', quantity: 25, unitPrice: 1.50, lineTotal: 37.50 },
   { id: 'prod4', catalogNumber: 'LOW01', description: 'Low Stock Mock', quantity: 8, unitPrice: 5.00, lineTotal: 40.00 },
   { id: 'prod5', catalogNumber: 'OUT01', description: 'Out of Stock Mock', quantity: 0, unitPrice: 12.00, lineTotal: 0.00 },
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
        unitPrice: 15.00,
        lineTotal: 30.00,
      },
      {
         id: `new-${Date.now()}-2`,
        catalogNumber: 'EXTRACT-002',
        description: 'Extracted Item B',
        quantity: 1,
        unitPrice: 50.50,
        lineTotal: 50.50,
      },
    ],
  };
}

/**
 * Asynchronously saves the edited product data to the backend.
 * In this mock implementation, it adds/updates products in the mockInventory.
 *
 * @param products The list of products to save.
 * @returns A promise that resolves when the data is successfully saved.
 */
export async function saveProducts(products: Product[]): Promise<void> {
  console.log('Saving products:', products);
  await new Promise(resolve => setTimeout(resolve, 300));

  products.forEach(newProduct => {
    // Ensure values are numbers, default to 0 if not
    const quantity = typeof newProduct.quantity === 'number' ? newProduct.quantity : 0;
    const unitPrice = typeof newProduct.unitPrice === 'number' ? newProduct.unitPrice : 0;
    const lineTotal = typeof newProduct.lineTotal === 'number' ? newProduct.lineTotal : 0;

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
      // Replace existing data with new data, keeping the original ID
      mockInventory[existingIndex] = {
          ...newProduct, // Copy new data first
          id: mockInventory[existingIndex].id, // Ensure original ID is kept
          quantity: quantity, // Ensure quantity is updated numeric value
          unitPrice: unitPrice, // Ensure unitPrice is updated numeric value
          lineTotal: lineTotal, // Ensure lineTotal is updated numeric value
          catalogNumber: newProduct.catalogNumber || mockInventory[existingIndex].catalogNumber, // Keep original catalog if new one is empty/N/A
          description: newProduct.description || mockInventory[existingIndex].description, // Keep original description if new one is empty
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
        unitPrice: unitPrice,
        lineTotal: lineTotal,
        catalogNumber: newProduct.catalogNumber || 'N/A', // Ensure catalogNumber exists
        description: newProduct.description || 'No Description', // Ensure description exists
      };
      mockInventory.push(productToAdd);
      console.log(`Product added:`, productToAdd);
    }
  });
  console.log('Updated mockInventory:', mockInventory);
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