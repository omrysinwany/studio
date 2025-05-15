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

        // This is a placeholder - replace with an actual API call that Hashavshevet supports for testing
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
        salePrice: salePrice,
        lineTotal: quantityInStock * unitPrice,
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
    let currentPage = 1; // Assuming Hashavshevet API uses 1-based indexing for pages
    let hasMore = true;
    let totalSynced = 0;
    const pageSize = 50; // Example page size, adjust if Hashavshevet API specifies differently

    try {
        while (hasMore) {
            // Adjust URL structure based on actual Hashavshevet API
            const url = `${HASHAVSHEVET_API_BASE_URL}/items?page=${currentPage}&pageSize=${pageSize}`;
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

            // Adapt to how Hashavshevet returns products and pagination info
            // Example: data might be { items: [...], totalPages: X, currentPage: Y }
            const productsFromApi = Array.isArray(data) ? data : data?.results || data?.Items || data?.products || []; // Adjust based on actual API

            if (!Array.isArray(productsFromApi)) {
                console.error(`[Hashavshevet Action - syncProducts] Invalid product data structure received. Expected array. Raw response: ${responseText}`);
                throw new Error(`Invalid product data structure received from Hashavshevet API. Expected array. Received structure: ${typeof data}. Raw response: ${responseText}`);
            }

            const mappedProducts = productsFromApi
                .map(mapHashavshevetProductToAction)
                .filter((p): p is Product => p !== null);

            allProducts = allProducts.concat(mappedProducts);
            totalSynced += mappedProducts.length;

            // Update hasMore based on Hashavshevet's pagination response
            // Example: if (data.currentPage >= data.totalPages || productsFromApi.length < pageSize)
            if (productsFromApi.length < pageSize) { // Simple check, adjust if API provides totalPages
                 hasMore = false;
            } else {
                 currentPage++;
            }

            // Safety break
            if (currentPage > 50) { // Adjust limit if necessary
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
        // TODO: Implement actual sales sync logic with Hashavshevet API, using the headers.
        // Map sales data to a meaningful structure for InvoTrack.
        return { success: true, message: "Sales sync placeholder completed (Hashavshevet). Actual implementation pending." };
    } catch (error: any) {
        console.error("[Hashavshevet Action - syncSales] Error during sales sync:", error);
        return { success: false, message: `Sales sync failed: ${error.message}` };
    }
}
