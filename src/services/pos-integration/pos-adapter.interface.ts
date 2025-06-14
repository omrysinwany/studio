/**
 * @fileOverview Defines the interface for Point of Sale (POS) system adapters.
 * This ensures a consistent structure for integrating different POS systems.
 */

/**
 * Represents the configuration settings required to connect to a specific POS system.
 * The exact fields will vary depending on the POS system.
 */
export interface PosConnectionConfig {
  // System identifier
  systemId?: string;
  
  // Common fields (examples)
  apiKey?: string;
  apiSecret?: string;
  storeId?: string;
  endpointUrl?: string;

  // Caspit specific fields (added for clarity)
  user?: string; // Caspit username
  pwd?: string; // Caspit password
  osekMorshe?: string; // Caspit business ID

  // Allow for additional, POS-specific fields
  [key: string]: any;
}

/**
 * Field configuration for dynamic form generation
 */
export interface PosConfigField {
  key: string;
  labelKey: string;
  type: 'text' | 'password' | 'number' | 'select' | 'checkbox';
  tooltipKey?: string;
  required?: boolean;
  options?: { value: string; labelKey: string }[]; // For select fields
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
}

/**
 * Represents the result of a synchronization operation.
 */
export interface SyncResult {
  success: boolean;
  message: string;
  itemsSynced?: number;
  errors?: any[];
  products?: Product[]; // Optional: Include products fetched during sync
  data?: any; // Generic data payload
}

/**
 * Generic result interface for CRUD operations
 */
export interface OperationResult<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  externalId?: string;
  errors?: any[];
}

/**
 * Represents a product structure compatible with InvoTrack.
 * Adapters should map their native product format to this structure.
 */
export interface Product {
  id?: string;
  catalogNumber: string;
  description: string;
  quantity: number;
  unitPrice: number;
  salePrice?: number | null; // Allow null for salePrice
  lineTotal: number;
  
  // External system references
  externalIds?: {
    [systemId: string]: string;
  };
}

/**
 * Represents a supplier/contact structure
 */
export interface Supplier {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  
  // External system references
  externalIds?: {
    [systemId: string]: string;
  };
}

/**
 * Represents an invoice/document structure
 */
export interface PosDocument {
  id?: string;
  type: 'invoice' | 'deliveryNote' | 'order' | 'creditNote';
  documentNumber?: string;
  date: Date;
  supplierId: string;
  items: Product[];
  totalAmount: number;
  
  // External system references
  externalIds?: {
    [systemId: string]: string;
  };
}

/**
 * Interface defining the common methods that any POS system adapter must implement.
 */
export interface IPosSystemAdapter {
  /**
   * A unique identifier for the POS system (e.g., 'caspit', 'retalix').
   */
  readonly systemId: string;

  /**
   * A user-friendly name for the POS system (e.g., 'Caspit', 'Retalix').
   */
  readonly systemName: string;

  /**
   * Get the configuration schema for this POS system
   * @returns Array of field configurations for dynamic form generation
   */
  getConfigSchema(): PosConfigField[];

  /**
   * Tests the connection to the POS system using the provided configuration.
   * @param config - The connection configuration.
   * @returns A promise resolving to an object { success: boolean, message: string }.
   */
  testConnection(
    config: PosConnectionConfig
  ): Promise<{ success: boolean; message: string }>;

  // --- Product Operations ---
  
  /**
   * Creates or updates a product in the POS system
   * @param config - The connection configuration
   * @param product - The product data
   * @returns Operation result with external product ID if successful
   */
  createOrUpdateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult<{ externalId: string }>>;

  /**
   * Updates an existing product in the POS system
   * @param config - The connection configuration
   * @param product - The product data with external ID
   * @returns Operation result
   */
  updateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult>;

  /**
   * Deactivates a product in the POS system
   * @param config - The connection configuration
   * @param product - The product data with external ID
   * @returns Operation result
   */
  deactivateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult>;

  /**
   * Synchronizes product data from the POS system to InvoTrack.
   * This method should fetch data and return it, not save it directly.
   * @param config - The connection configuration.
   * @returns A promise resolving to a SyncResult object, potentially including the fetched products.
   */
  syncProducts(config: PosConnectionConfig): Promise<SyncResult>;

  // --- Supplier/Contact Operations ---
  
  /**
   * Creates or updates a supplier/contact in the POS system
   * @param config - The connection configuration
   * @param supplier - The supplier data
   * @returns Operation result with external supplier ID if successful
   */
  createOrUpdateSupplier(
    config: PosConnectionConfig,
    supplier: Supplier
  ): Promise<OperationResult<{ externalId: string }>>;

  /**
   * Synchronizes suppliers data from the POS system to InvoTrack.
   * @param config - The connection configuration.
   * @returns A promise resolving to a SyncResult object.
   */
  syncSuppliers(config: PosConnectionConfig): Promise<SyncResult>;

  // --- Document Operations ---
  
  /**
   * Creates a document (invoice, order, etc.) in the POS system
   * @param config - The connection configuration
   * @param document - The document data
   * @param externalSupplierId - The supplier's external ID in the POS system
   * @returns Operation result with external document ID if successful
   */
  createDocument(
    config: PosConnectionConfig,
    document: PosDocument,
    externalSupplierId: string
  ): Promise<OperationResult<{ externalId: string }>>;

  /**
   * Synchronizes documents data from the POS system to InvoTrack.
   * @param config - The connection configuration.
   * @returns A promise resolving to a SyncResult object.
   */
  syncDocuments(config: PosConnectionConfig): Promise<SyncResult>;

  // --- Sales Operations ---
  
  /**
   * Synchronizes sales data from the POS system to InvoTrack.
   * This could involve creating corresponding records or updating inventory based on sales.
   * @param config - The connection configuration.
   * @returns A promise resolving to a SyncResult object.
   */
  syncSales(config: PosConnectionConfig): Promise<SyncResult>;

  // --- Optional Methods ---
  
  /**
   * Get available document types for this POS system
   * @returns Array of document type identifiers
   */
  getAvailableDocumentTypes?(): string[];

  /**
   * Validate configuration before saving
   * @param config - The configuration to validate
   * @returns Validation result
   */
  validateConfig?(config: PosConnectionConfig): Promise<{
    valid: boolean;
    errors?: { field: string; message: string }[];
  }>;
}
