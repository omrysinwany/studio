
/**
 * @fileOverview Defines the interface for Point of Sale (POS) system adapters.
 * This ensures a consistent structure for integrating different POS systems.
 */

/**
 * Represents the configuration settings required to connect to a specific POS system.
 * The exact fields will vary depending on the POS system.
 */
export interface PosConnectionConfig {
  apiKey?: string;
  apiSecret?: string;
  storeId?: string;
  endpointUrl?: string;
  [key: string]: any; // Allow for additional, POS-specific fields
}

/**
 * Represents the result of a synchronization operation.
 */
export interface SyncResult {
  success: boolean;
  message: string;
  itemsSynced?: number;
  errors?: any[];
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
   * Tests the connection to the POS system using the provided configuration.
   * @param config - The connection configuration.
   * @returns A promise resolving to true if the connection is successful, false otherwise.
   */
  testConnection(config: PosConnectionConfig): Promise<boolean>;

  /**
   * Synchronizes product data from the POS system to InvoTrack.
   * (Or potentially two-way sync in the future).
   * @param config - The connection configuration.
   * @returns A promise resolving to a SyncResult object.
   */
  syncProducts(config: PosConnectionConfig): Promise<SyncResult>;

  /**
   * Synchronizes sales data from the POS system to InvoTrack.
   * This could involve creating corresponding records or updating inventory based on sales.
   * @param config - The connection configuration.
   * @returns A promise resolving to a SyncResult object.
   */
  syncSales(config: PosConnectionConfig): Promise<SyncResult>;

  // Add other potential methods as needed:
  // syncCustomers?(config: PosConnectionConfig): Promise<SyncResult>;
  // getSettingsSchema?(): any; // Optional: Return a schema for required settings fields
}
