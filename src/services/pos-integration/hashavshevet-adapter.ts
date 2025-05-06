/**
 * @fileOverview Placeholder implementation for the Hashavshevet POS/ERP system adapter.
 * Handles fetching products and mapping them to the InvoTrack format.
 */

import type { IPosSystemAdapter, PosConnectionConfig, SyncResult, Product } from './pos-adapter.interface';
import { testHashavshevetConnectionAction, syncHashavshevetProductsAction, syncHashavshevetSalesAction } from '@/actions/hashavshevet-actions'; // Import server actions

class HashavshevetAdapter implements IPosSystemAdapter {
  readonly systemId = 'hashavshevet';
  readonly systemName = 'Hashavshevet (חשבשבת)';

  // --- Connection Test ---
  async testConnection(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    console.log(`[HashavshevetAdapter] Testing connection via server action with config:`, config);
    try {
      // Call the server action to test the connection
      const result = await testHashavshevetConnectionAction(config);
      console.log(`[HashavshevetAdapter] Connection test result from server action:`, result);
      return result;
    } catch (error: any) {
      console.error("[HashavshevetAdapter] Error calling test connection server action:", error);
      return { success: false, message: `Failed to execute test connection: ${error.message || 'Unknown error'}` };
    }
  }

  // --- Product Sync ---
  async syncProducts(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[HashavshevetAdapter] Starting product sync via server action...`);
    try {
      // Call the server action, passing the config.
      const result = await syncHashavshevetProductsAction(config);
      console.log(`[HashavshevetAdapter] Product sync result from server action:`, result);
      // Saving products should happen on the client-side after the action returns
      return result;
    } catch (error: any) {
      console.error("[HashavshevetAdapter] Error calling product sync server action:", error);
      return { success: false, message: `Product sync failed: ${error.message || 'Unknown error'}` };
    }
  }

  // --- Sales Sync ---
  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[HashavshevetAdapter] Starting sales sync via server action...`);
    try {
      // Call the server action, passing the config.
      const result = await syncHashavshevetSalesAction(config);
      console.log(`[HashavshevetAdapter] Sales sync result from server action:`, result);
      return result;
    } catch (error: any) {
      console.error("[HashavshevetAdapter] Error calling sales sync server action:", error);
      return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error'}` };
    }
  }

   // --- Placeholder for mapping ---
   // Needs implementation based on Hashavshevet's actual API response structure
   private mapHashavshevetProduct(hashProduct: any): Product | null {
      // Example mapping - adjust based on real data
      const catalogNumber = hashProduct.ItemCode || hashProduct.CatalogNumber;
      const description = hashProduct.ItemName || hashProduct.Description;
      const unitPrice = hashProduct.Price || 0;
      const quantityInStock = hashProduct.StockQuantity ?? 0; // Check available stock field

      if (!catalogNumber && !description) {
        console.warn('[HashavshevetAdapter - mapHashavshevetProduct] Skipping product due to missing identifier:', hashProduct);
        return null;
      }

      return {
        id: hashProduct.InternalID || catalogNumber, // Use internal ID or fallback
        catalogNumber: catalogNumber || 'N/A',
        description: description || 'No Description',
        quantity: quantityInStock, // Stock quantity from API
        unitPrice: unitPrice,
        lineTotal: quantityInStock * unitPrice, // Initial total based on stock
      };
   }
}

// Export a single instance of the adapter
export const hashavshevetAdapter = new HashavshevetAdapter();
