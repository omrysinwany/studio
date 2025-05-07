// src/actions/hashavshevet-actions.ts
'use server';

import type { PosConnectionConfig, SyncResult, Product } from '@/services/pos-integration/pos-adapter.interface';

// TODO: Replace with actual Hashavshevet API details and logic
const HASHAVSHEVET_API_BASE_URL = 'https://api.example-hashavshevet.com/v1'; // Replace with actual URL

// --- Helper function to handle authentication (placeholder) ---
async function getHashavshevetAuthHeaders(config: PosConnectionConfig): Promise<Record<string, string>> {
    const { apiKey } = config;
    if (!apiKey) {
        throw new Error('Missing Hashavshevet API Key in configuration.');
    }
    console.log('[Hashavshevet Action - getAuth] Using API Key:', apiKey ? 'Provided' : 'Missing');
    return {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };
}

// --- Server Action to Test Connection ---
export async function testHashavshevetConnectionAction(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
        const headers = await getHashavshevetAuthHeaders(config);
        const testUrl = `${HASHAVSHEVET_API_BASE_URL}/test-endpoint`;
        console.log('[Hashavshevet Action - testConnection] Testing connection to:', testUrl);

        const response = await fetch(testUrl, { method: 'GET', headers });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Hashavshevet API Error (${response.status}): ${errorText || response.statusText}`);
        }

        console.log('[Hashavshevet Action - testConnection] Test connection successful.');
        return { success: true, message: 'Connection successful!' };

    } catch (error: any) {
        console.error("[Hashavshevet Action - testConnection] Test failed:", error);
        return { success: false, message: `Connection failed: ${error.message}` };
    }
}

// --- Map Hashavshevet Product Data ---
 function mapHashavshevetProductToAction(hashavshevetProduct: any): Product | null {
      const productId = hashavshevetProduct.InternalID || hashavshevetProduct.ItemKey;
      const catalogNumber = hashavshevetProduct.ItemCode || hashavshevetProduct.CatalogNum;
      const description = hashavshevetProduct.ItemName || hashavshevetProduct.Description;
      const unitPrice = hashavshevetProduct.PurchasePrice || hashavshevetProduct.CostPrice || 0; // Cost price
      const salePrice = hashavshevetProduct.SalePrice || hashavshevetProduct.ListPrice || undefined; // Sale price (optional)
      const quantityInStock = hashavshevetProduct.StockQuantity ?? hashavshevetProduct.QuantityOnHand ?? 0;

      if (!catalogNumber && !description) {
        console.warn('[Hashavshevet Action - mapProduct] Skipping product due to missing catalog number and description:', hashavshevetProduct);
        return null;
      }

      const invoTrackProduct: Product = {
        id: productId || `${catalogNumber}-${Date.now()}`,
        catalogNumber: catalogNumber || 'N/A',
        description: description || 'No Description',
        quantity: quantityInStock,
        unitPrice: unitPrice,
        salePrice: salePrice, // Add salePrice
        lineTotal: quantityInStock * unitPrice, // Based on cost price
      };
      return invoTrackProduct;
}


// --- Server Action to Sync Products ---
export async function syncHashavshevetProductsAction(config: PosConnectionConfig): Promise<SyncResult> {
    let headers: Record<string, string>;
    try {
        headers = await getHashavshevetAuthHeaders(config);
    } catch (error: any) {
        return { success: false, message: `Product sync failed: Could not get auth headers - ${error.message}` };
    }

    let allProducts: Product[] = [];
    let currentPage = 1;
    let hasMore = true;
    let totalSynced = 0;

    try {
        while (hasMore) {
            const url = `${HASHAVSHEVET_API_BASE_URL}/items?page=${currentPage}`;
            console.log(`[Hashavshevet Action - syncProducts] Fetching page ${currentPage}: ${url}`);
            const response = await fetch(url, { headers });
            const responseText = await response.text();

            if (!response.ok) {
                 console.error(`[Hashavshevet Action - syncProducts] Failed fetch for page ${currentPage}. Status: ${response.status}. Response: ${responseText}`);
                throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}. Response: ${responseText}`);
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                console.error(`[Hashavshevet Action - syncProducts] Failed to parse JSON for page ${currentPage}. Response: ${responseText}`);
                throw new Error('Invalid JSON response received from Hashavshevet product API.');
            }

            const productsFromApi = Array.isArray(data) ? data : data?.results || data?.Items;

            if (!Array.isArray(productsFromApi)) {
                console.error(`[Hashavshevet Action - syncProducts] Invalid product data structure received. Expected array. Raw response: ${responseText}`);
                throw new Error(`Invalid product data structure received from Hashavshevet API. Expected array. Received structure: ${typeof data}. Raw response: ${responseText}`);
            }

            const mappedProducts = productsFromApi
                .map(mapHashavshevetProductToAction)
                .filter((p): p is Product => p !== null);

            allProducts = allProducts.concat(mappedProducts);
            totalSynced += mappedProducts.length;

            if (productsFromApi.length < 50) { 
                 hasMore = false;
            } else {
                 currentPage++;
            }

            if (currentPage > 50) { 
                 console.warn(`[Hashavshevet Action - syncProducts] Reached page limit (${currentPage}). Stopping sync.`);
                 hasMore = false;
            }
        }

        console.log(`[Hashavshevet Action - syncProducts] Returning ${totalSynced} products.`);
        return {
            success: true,
            message: `Successfully fetched ${totalSynced} products from Hashavshevet.`,
            itemsSynced: totalSynced,
            products: allProducts
        };

    } catch (error: any) {
        console.error("[Hashavshevet Action - syncProducts] Product sync failed:", error);
        return { success: false, message: `Product sync failed: ${error.message}` };
    }
}


// --- Server Action to Sync Sales ---
export async function syncHashavshevetSalesAction(config: PosConnectionConfig): Promise<SyncResult> {
    let headers: Record<string, string>;
    try {
        headers = await getHashavshevetAuthHeaders(config);
    } catch (error: any) {
        return { success: false, message: `Sales sync failed: Could not get auth headers - ${error.message}` };
    }

    console.log("[Hashavshevet Action - syncSales] Placeholder for sales sync...");
     try {
        return { success: true, message: "Sales sync placeholder completed (Hashavshevet)." };
    } catch (error: any) {
        console.error("[Hashavshevet Action - syncSales] Error during sales sync:", error);
        return { success: false, message: `Sales sync failed: ${error.message}` };
    }
}
