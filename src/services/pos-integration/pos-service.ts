/**
 * @fileOverview Central POS Service that acts as a facade for all POS operations.
 * This service provides a unified interface for interacting with different POS systems.
 */

import type {
  IPosSystemAdapter,
  PosConnectionConfig,
  Product,
  Supplier,
  PosDocument,
  SyncResult,
  OperationResult,
  PosConfigField,
} from './pos-adapter.interface';
import { getPosAdapter, getAvailablePosSystems } from './integration-manager';

/**
 * Central service for all POS-related operations.
 * This service abstracts away the specific POS system implementations.
 */
export class PosService {
  private static instance: PosService;

  /**
   * Get singleton instance of PosService
   */
  static getInstance(): PosService {
    if (!PosService.instance) {
      PosService.instance = new PosService();
    }
    return PosService.instance;
  }

  /**
   * Get adapter for a specific POS system
   * @private
   */
  private getAdapter(systemId: string): IPosSystemAdapter {
    const adapter = getPosAdapter(systemId);
    if (!adapter) {
      throw new Error(`POS adapter not found for system: ${systemId}`);
    }
    return adapter;
  }

  /**
   * Ensure systemId is present in config
   * @private
   */
  private ensureSystemId(config: PosConnectionConfig): string {
    if (!config.systemId) {
      throw new Error('System ID is required in POS configuration');
    }
    return config.systemId;
  }

  // --- System Information ---

  /**
   * Get list of available POS systems
   */
  getAvailableSystems(): { systemId: string; systemName: string }[] {
    return getAvailablePosSystems();
  }

  /**
   * Get configuration schema for a specific POS system
   */
  getConfigSchema(systemId: string): PosConfigField[] {
    const adapter = this.getAdapter(systemId);
    return adapter.getConfigSchema();
  }

  /**
   * Get available document types for a specific POS system
   */
  getAvailableDocumentTypes(systemId: string): string[] {
    const adapter = this.getAdapter(systemId);
    return adapter.getAvailableDocumentTypes?.() || ['invoice', 'deliveryNote', 'order'];
  }

  // --- Connection Operations ---

  /**
   * Test connection to a POS system
   */
  async testConnection(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    try {
      console.log(`[PosService] Testing connection for ${systemId}`);
      return await adapter.testConnection(config);
    } catch (error: any) {
      console.error(`[PosService] Error testing connection for ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Connection test failed',
      };
    }
  }

  /**
   * Validate configuration for a POS system
   */
  async validateConfig(config: PosConnectionConfig): Promise<{
    valid: boolean;
    errors?: { field: string; message: string }[];
  }> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    if (adapter.validateConfig) {
      return await adapter.validateConfig(config);
    }
    
    // Default validation - just check required fields from schema
    const schema = adapter.getConfigSchema();
    const errors: { field: string; message: string }[] = [];
    
    for (const field of schema) {
      if (field.required && !config[field.key]) {
        errors.push({
          field: field.key,
          message: `${field.key} is required`,
        });
      }
    }
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // --- Product Operations ---

  /**
   * Create or update a product in the POS system
   */
  async createOrUpdateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult<{ externalId: string }>> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    try {
      console.log(`[PosService] Creating/updating product in ${systemId}`, product);
      const result = await adapter.createOrUpdateProduct(config, product);
      
      // Update product's external IDs if successful
      if (result.success && result.data?.externalId) {
        if (!product.externalIds) {
          product.externalIds = {};
        }
        product.externalIds[systemId] = result.data.externalId;
      }
      
      return result;
    } catch (error: any) {
      console.error(`[PosService] Error creating/updating product in ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to create/update product',
        errors: [error],
      };
    }
  }

  /**
   * Update an existing product in the POS system
   */
  async updateProduct(config: PosConnectionConfig, product: Product): Promise<OperationResult> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    // Check if product has external ID for this system
    if (!product.externalIds?.[systemId]) {
      return {
        success: false,
        message: `Product does not have an external ID for ${systemId}`,
      };
    }
    
    try {
      console.log(`[PosService] Updating product in ${systemId}`, product);
      return await adapter.updateProduct(config, product);
    } catch (error: any) {
      console.error(`[PosService] Error updating product in ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to update product',
        errors: [error],
      };
    }
  }

  /**
   * Deactivate a product in the POS system
   */
  async deactivateProduct(config: PosConnectionConfig, product: Product): Promise<OperationResult> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    // Check if product has external ID for this system
    if (!product.externalIds?.[systemId]) {
      return {
        success: false,
        message: `Product does not have an external ID for ${systemId}`,
      };
    }
    
    try {
      console.log(`[PosService] Deactivating product in ${systemId}`, product);
      return await adapter.deactivateProduct(config, product);
    } catch (error: any) {
      console.error(`[PosService] Error deactivating product in ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to deactivate product',
        errors: [error],
      };
    }
  }

  /**
   * Sync products from POS system
   */
  async syncProducts(config: PosConnectionConfig): Promise<SyncResult> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    try {
      console.log(`[PosService] Syncing products from ${systemId}`);
      const result = await adapter.syncProducts(config);
      
      // Add system ID to external IDs of synced products
      if (result.success && result.products) {
        for (const product of result.products) {
          if (!product.externalIds) {
            product.externalIds = {};
          }
          // Preserve the external ID if it exists
          if (product.id) {
            product.externalIds[systemId] = product.id;
          }
        }
      }
      
      return result;
    } catch (error: any) {
      console.error(`[PosService] Error syncing products from ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to sync products',
        errors: [error],
      };
    }
  }

  // --- Supplier Operations ---

  /**
   * Create or update a supplier in the POS system
   */
  async createOrUpdateSupplier(
    config: PosConnectionConfig,
    supplier: Supplier
  ): Promise<OperationResult<{ externalId: string }>> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    try {
      console.log(`[PosService] Creating/updating supplier in ${systemId}`, supplier);
      const result = await adapter.createOrUpdateSupplier(config, supplier);
      
      // Update supplier's external IDs if successful
      if (result.success && result.data?.externalId) {
        if (!supplier.externalIds) {
          supplier.externalIds = {};
        }
        supplier.externalIds[systemId] = result.data.externalId;
      }
      
      return result;
    } catch (error: any) {
      console.error(`[PosService] Error creating/updating supplier in ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to create/update supplier',
        errors: [error],
      };
    }
  }

  /**
   * Sync suppliers from POS system
   */
  async syncSuppliers(config: PosConnectionConfig): Promise<SyncResult> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    try {
      console.log(`[PosService] Syncing suppliers from ${systemId}`);
      return await adapter.syncSuppliers(config);
    } catch (error: any) {
      console.error(`[PosService] Error syncing suppliers from ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to sync suppliers',
        errors: [error],
      };
    }
  }

  // --- Document Operations ---

  /**
   * Create a document in the POS system
   */
  async createDocument(
    config: PosConnectionConfig,
    document: PosDocument,
    supplier: Supplier
  ): Promise<OperationResult<{ externalId: string }>> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    // Check if supplier has external ID for this system
    const externalSupplierId = supplier.externalIds?.[systemId];
    if (!externalSupplierId) {
      return {
        success: false,
        message: `Supplier does not have an external ID for ${systemId}`,
      };
    }
    
    try {
      console.log(`[PosService] Creating document in ${systemId}`, document);
      const result = await adapter.createDocument(config, document, externalSupplierId);
      
      // Update document's external IDs if successful
      if (result.success && result.data?.externalId) {
        if (!document.externalIds) {
          document.externalIds = {};
        }
        document.externalIds[systemId] = result.data.externalId;
      }
      
      return result;
    } catch (error: any) {
      console.error(`[PosService] Error creating document in ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to create document',
        errors: [error],
      };
    }
  }

  /**
   * Sync documents from POS system
   */
  async syncDocuments(config: PosConnectionConfig): Promise<SyncResult> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    try {
      console.log(`[PosService] Syncing documents from ${systemId}`);
      return await adapter.syncDocuments(config);
    } catch (error: any) {
      console.error(`[PosService] Error syncing documents from ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to sync documents',
        errors: [error],
      };
    }
  }

  // --- Sales Operations ---

  /**
   * Sync sales from POS system
   */
  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    const systemId = this.ensureSystemId(config);
    const adapter = this.getAdapter(systemId);
    
    try {
      console.log(`[PosService] Syncing sales from ${systemId}`);
      return await adapter.syncSales(config);
    } catch (error: any) {
      console.error(`[PosService] Error syncing sales from ${systemId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to sync sales',
        errors: [error],
      };
    }
  }
}

// Export singleton instance
export const posService = PosService.getInstance();