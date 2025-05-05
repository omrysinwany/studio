
/**
 * @fileOverview Implementation for the Caspit POS system adapter using demo credentials.
 * Handles fetching products and mapping them to the InvoTrack format.
 */

import type { IPosSystemAdapter, PosConnectionConfig, SyncResult, Product } from './pos-adapter.interface';
import { saveProducts } from '@/services/backend'; // Import saveProducts to save synced data
import { testCaspitConnectionAction, syncCaspitProductsAction, syncCaspitSalesAction } from '@/actions/caspit-actions'; // Import server actions

// Define expected structure for Caspit product (adjust based on actual API response)
interface CaspitProduct {
  ProductID?: string; // Example field, adjust as needed
  ProductName?: string;
  CatalogNumber?: string;
  SalePrice?: number; // Assuming this is the unit price
  // Add other relevant fields from Caspit API
}

class CaspitAdapter implements IPosSystemAdapter {
  readonly systemId = 'caspit';
  readonly systemName = 'Caspit (כספית)';
  // Removed baseUrl as direct fetching is moved to server actions

  // --- Authentication (handled within server actions now) ---
  // private async getToken(config: PosConnectionConfig): Promise<string> { ... } // Removed - Logic moved to server actions

  // --- Connection Test ---
  async testConnection(config: PosConnectionConfig): Promise<boolean> {
    console.log(`[CaspitAdapter] Testing connection via server action with config:`, config);
    try {
      // Call the server action to test the connection
      const result = await testCaspitConnectionAction(config);
      console.log(`[CaspitAdapter] Connection test result from server action: ${result.success}`);
      return result.success;
    } catch (error) {
      console.error("[CaspitAdapter] Error calling test connection server action:", error);
      return false;
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
        // Note: Saving products via saveProducts is now handled *within* the server action if needed
    } catch (error: any) {
        console.error("[CaspitAdapter] Error calling product sync server action:", error);
        return { success: false, message: `Product sync failed: ${error.message || 'Unknown error'}` };
    }
  }


  // --- Map Caspit Product to InvoTrack Product (Still needed if mapping happens client-side, but likely moved server-side) ---
  // This might be better placed within the server action itself if mapping happens there.
  private mapCaspitProduct(caspitProduct: any): Product | null {
     // Basic mapping, adjust fields based on actual CaspitProduct structure
     const catalogNumber = caspitProduct.CatalogNumber || '';
     const description = caspitProduct.ProductName || '';
     const unitPrice = caspitProduct.SalePrice ?? 0;

     // Skip if essential data is missing
     if (!catalogNumber && !description) {
       console.warn('[CaspitAdapter] Skipping product due to missing catalog number and description:', caspitProduct);
       return null;
     }

     const invoTrackProduct: Product = {
       id: caspitProduct.ProductID, // Use Caspit's ID if available
       catalogNumber: catalogNumber || 'N/A', // Fallback for catalog number
       description: description || 'No Description', // Fallback for description
       quantity: 0, // Initial quantity is 0, sales sync should update this
       unitPrice: unitPrice,
       lineTotal: 0, // This will be calculated based on quantity * unitPrice later or by sales sync
     };
     return invoTrackProduct;
   }


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
