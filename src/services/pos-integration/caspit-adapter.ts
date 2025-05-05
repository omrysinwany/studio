
/**
 * @fileOverview Implementation for the Caspit POS system adapter using demo credentials.
 * Handles fetching products and mapping them to the InvoTrack format.
 */

import type { IPosSystemAdapter, PosConnectionConfig, SyncResult, Product } from './pos-adapter.interface';
import { saveProducts } from '@/services/backend'; // Import saveProducts to save synced data

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
  private readonly baseUrl = 'https://app.caspit.biz/api/v1';

  // --- Authentication ---
  private async getToken(config: PosConnectionConfig): Promise<string> {
    // Use provided config or fallback to demo credentials for testing
    const user = config.user || 'demo';
    const pwd = config.pwd || 'demodemo';
    const osekMorshe = config.osekMorshe || '123456789'; // Caspit's demo osekMorshe

    const url = `${this.baseUrl}/Token?user=${encodeURIComponent(user)}&pwd=${encodeURIComponent(pwd)}&osekMorshe=${encodeURIComponent(osekMorshe)}`;
    console.log(`[CaspitAdapter] Getting token from: ${url}`);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[CaspitAdapter] Failed to get token: ${response.status} ${response.statusText}`, errorText);
            throw new Error(`Failed to get token: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!data || !data.AccessToken) {
             console.error('[CaspitAdapter] Invalid token response:', data);
             throw new Error('Invalid token response from Caspit API');
        }
        console.log('[CaspitAdapter] Successfully obtained token.');
        return data.AccessToken;
    } catch (error) {
        console.error('[CaspitAdapter] Error fetching token:', error);
        throw error; // Re-throw the error for handling in calling functions
    }
  }

  // --- Connection Test ---
  async testConnection(config: PosConnectionConfig): Promise<boolean> {
    console.log(`[CaspitAdapter] Testing connection with config:`, config);
    try {
      // Use the actual config provided by the user in settings
      const token = await this.getToken(config);
      const connectionSuccess = !!token;
      console.log(`[CaspitAdapter] Connection test result: ${connectionSuccess}`);
      return connectionSuccess;
    } catch (error) {
      console.error("[CaspitAdapter] Connection test failed:", error);
      return false;
    }
  }

  // --- Product Sync ---
  async syncProducts(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting product sync...`);
    try {
      // Use the actual config provided by the user in settings
      const token = await this.getToken(config);
      let page = 1;
      let allCaspitProducts: CaspitProduct[] = [];
      let hasMore = true;

      console.log(`[CaspitAdapter] Fetching products page ${page}...`);
      while (hasMore) {
        const url = `${this.baseUrl}/Products?token=${token}&page=${page}`;
        const response = await fetch(url, {
             headers: {
                 'Accept': 'application/json' // Explicitly request JSON
             }
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[CaspitAdapter] Failed to fetch products (Page ${page}): ${response.status} ${response.statusText}`, errorText);
          throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
        }

        // Check content type before parsing
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
             console.error(`[CaspitAdapter] Unexpected content type received: ${contentType}. Expected JSON.`);
            // Attempt to read as text for debugging
             const textResponse = await response.text();
             console.error("[CaspitAdapter] Response Text:", textResponse);
             throw new Error(`Expected JSON response but received ${contentType}`);
        }


        let caspitProductsPage: CaspitProduct[] = [];
        try {
            caspitProductsPage = await response.json();
        } catch (jsonError) {
             console.error(`[CaspitAdapter] Failed to parse JSON response (Page ${page}):`, jsonError);
             throw new Error(`Failed to parse JSON response from Caspit API: ${jsonError}`);
        }


        if (!Array.isArray(caspitProductsPage)) {
           console.error('[CaspitAdapter] Invalid product data structure received (not an array):', caspitProductsPage);
           throw new Error('Invalid product data structure received from Caspit API.');
        }

        if (caspitProductsPage.length === 0) {
          hasMore = false;
          console.log(`[CaspitAdapter] No more products found (Page ${page}).`);
        } else {
          console.log(`[CaspitAdapter] Fetched ${caspitProductsPage.length} products on page ${page}.`);
          allCaspitProducts = allCaspitProducts.concat(caspitProductsPage);
          page++;
          // Optional: Add a small delay between page fetches if needed
          // await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`[CaspitAdapter] Total products fetched from Caspit: ${allCaspitProducts.length}`);

      // Map Caspit products to InvoTrack format
      const mappedProducts = allCaspitProducts.map(this.mapCaspitProduct).filter(p => p !== null) as Product[];
      console.log(`[CaspitAdapter] Mapped ${mappedProducts.length} products to InvoTrack format.`);

      // Save mapped products to InvoTrack backend (localStorage in this case)
      await saveProducts(mappedProducts, "Caspit Sync", 'caspit_sync'); // Use specific source
      console.log(`[CaspitAdapter] Saved products to InvoTrack.`);

      return {
          success: true,
          message: `Successfully synced ${mappedProducts.length} products from Caspit.`,
          itemsSynced: mappedProducts.length
      };

    } catch (error: any) {
      console.error("[CaspitAdapter] Product sync failed:", error);
      return { success: false, message: `Product sync failed: ${error.message || 'Unknown error'}` };
    }
  }

  // --- Map Caspit Product to InvoTrack Product ---
  private mapCaspitProduct(caspitProduct: CaspitProduct): Product | null {
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

  // --- Sales Sync (Placeholder) ---
  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting sales sync (Placeholder)...`);
    try {
      const token = await this.getToken(config); // Authenticate first
      // --- TODO: Implement fetching sales data from Caspit ---
      // Example: const salesUrl = `${this.baseUrl}/Sales?token=${token}&startDate=...&endDate=...`;
      // const salesResponse = await fetch(salesUrl); ...
      console.warn('[CaspitAdapter] Sales sync not fully implemented yet.');
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate some work

       // --- TODO: Process sales data and update InvoTrack inventory ---
       // For each sale item, find the corresponding product in InvoTrack (by ID or catalogNumber)
       // and decrease its quantity.
       // Example:
       // let currentInventory = await getProductsService();
       // salesData.forEach(sale => {
       //   const productIndex = currentInventory.findIndex(p => p.catalogNumber === sale.catalogNumber);
       //   if (productIndex > -1) {
       //     currentInventory[productIndex].quantity -= sale.quantitySold;
       //   }
       // });
       // await saveProducts(currentInventory, "Caspit Sales Sync Update", "caspit_sync_sales"); // Use a different source?

      return { success: true, message: 'Sales sync placeholder completed.' };
    } catch (error: any) {
      console.error("[CaspitAdapter] Sales sync failed:", error);
      return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error'}` };
    }
  }
}

// Export a single instance of the adapter
export const caspitAdapter = new CaspitAdapter();
