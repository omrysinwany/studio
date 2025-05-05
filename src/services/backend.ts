/**
 * Represents a product extracted from a document.
 */
export interface Product {
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
  return {
    products: [
      {
        catalogNumber: '12345',
        description: 'Sample Product 1',
        quantity: 10,
        unitPrice: 9.99,
        lineTotal: 99.90,
      },
      {
        catalogNumber: '67890',
        description: 'Sample Product 2',
        quantity: 5,
        unitPrice: 19.99,
        lineTotal: 99.95,
      },
    ],
  };
}

/**
 * Asynchronously saves the edited product data to the backend.
 *
 * @param products The list of products to save.
 * @returns A promise that resolves when the data is successfully saved.
 */
export async function saveProducts(products: Product[]): Promise<void> {
  // TODO: Implement this by calling your backend API.
  // For now, just log the data to the console.
  console.log('Saving products:', products);
  return;
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

/**
 * Asynchronously registers a new user.
 *
 * @param userData The user registration data.
 * @returns A promise that resolves with the authentication response.
 */
export async function register(userData: any): Promise<AuthResponse> {
  // TODO: Implement this by calling your backend API.
  return {
    token: 'sample_token',
    user: {
      id: '1',
      username: userData.username,
      email: userData.email,
    },
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
  return {
    token: 'sample_token',
    user: {
      id: '1',
      username: credentials.username,
      email: 'test@example.com',
    },
  };
}
