/**
 * @fileOverview Implementation for the Caspit POS system adapter using demo credentials.
 * Handles fetching products and mapping them to the InvoTrack format.
 */

import type { IPosSystemAdapter, PosConnectionConfig, SyncResult, Product } from './pos-adapter.interface';
// Removed import { saveProducts } from '@/services/backend'; // Import saveProducts to save synced data
import { testCaspitConnectionAction, syncCaspitProductsAction, syncCaspitSalesAction } from '@/actions/caspit-actions'; // Import server actions

// Define expected structure for Caspit product (adjust based on actual API response)
// This interface is now mainly for reference, actual mapping happens in the action
interface CaspitProduct {
  ProductId?: string; // Example field, adjust as needed
  Name?: string; // Use Name
  Description?: string; // Fallback Description
  CatalogNumber?: string;
  SalePrice1?: number; // Priority for unit price
  PurchasePrice?: number; // Fallback for unit price
  QtyInStock?: number; // Quantity in stock
  // Add other relevant fields from Caspit API
}

class CaspitAdapter implements IPosSystemAdapter {
  readonly systemId = 'caspit';
  readonly systemName = 'Caspit (כספית)';
  // Removed baseUrl as direct fetching is moved to server actions

  // --- Authentication (handled within server actions now) ---
  // private async getToken(config: PosConnectionConfig): Promise<string> { ... } // Removed - Logic moved to server actions

  // --- Connection Test ---
  async testConnection(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    console.log(`[CaspitAdapter] Testing connection via server action with config:`, config);
    try {
      // Call the server action to test the connection, expecting { success, message }
      const result = await testCaspitConnectionAction(config);
      console.log(`[CaspitAdapter] Connection test result from server action:`, result);
      return result; // Return the full result object
    } catch (error: any) {
      // This catch might handle cases where the action promise itself rejects unexpectedly
      console.error("[CaspitAdapter] Error calling test connection server action:", error);
      return { success: false, message: `Failed to execute test connection: ${error.message || 'Unknown error'}` };
    }
  }

  // --- Product Sync ---
  async syncProducts(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting product sync via server action...`);
    try {
        // Call the server action to sync products
        const result = await syncCaspitProductsAction(config);
        console.log(`[CaspitAdapter] Product sync result from server action:`, result);
        return result;
        // Note: Saving products via saveProducts is now handled *within* the server action
    } catch (error: any) {
        console.error("[CaspitAdapter] Error calling product sync server action:", error);
        return { success: false, message: `Product sync failed: ${error.message || 'Unknown error'}` };
    }
  }


  // --- Map Caspit Product to InvoTrack Product (Removed - Logic moved to server action) ---
  // private mapCaspitProduct(caspitProduct: any): Product | null { ... }


  // --- Sales Sync ---
  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting sales sync via server action...`);
    try {
        // Call the server action to sync sales
        const result = await syncCaspitSalesAction(config);
        console.log(`[CaspitAdapter] Sales sync result from server action:`, result);
        return result;
        // Note: Updating inventory based on sales is now handled *within* the server action if needed
    } catch (error: any) {
        console.error("[CaspitAdapter] Error calling sales sync server action:", error);
        return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error'}` };
    }
  }
}

// Export a single instance of the adapter
export const caspitAdapter = new CaspitAdapter();
