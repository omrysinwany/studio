// src/actions/hashavshevet-actions.ts
'use server';

import type { PosConnectionConfig, SyncResult, Product } from '@/services/pos-integration/pos-adapter.interface';

// TODO: Replace with actual Hashavshevet API details and logic
const HASHAVSHEVET_API_BASE_URL = 'https://api.example-hashavshevet.com/v1'; // Replace with actual URL

// --- Helper function to handle authentication (placeholder) ---
// Hashavshevet likely uses API keys or other methods. This needs implementation.
async function getHashavshevetAuthHeaders(config: PosConnectionConfig): Promise<Record<string, string>> {
    const { apiKey, apiSecret, companyId } = config; // Example config fields
    if (!apiKey) {
        throw new Error('Missing Hashavshevet API Key in configuration.');
    }
    // Add other necessary validation

    // Placeholder for authentication logic (e.g., creating Basic Auth, Bearer Token)
    // This will depend entirely on Hashavshevet's API requirements.
    console.log('[Hashavshevet Action - getAuth] Using API Key:', apiKey ? 'Provided' : 'Missing');
    return {
        'Authorization': `Bearer ${apiKey}`, // Example: Bearer token
        'Content-Type': 'application/json',
        // Add other headers like Company ID if required
        // 'X-Company-ID': companyId
    };
}

// --- Server Action to Test Connection ---
export async function testHashavshevetConnectionAction(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
        const headers = await getHashavshevetAuthHeaders(config);
        // Make a simple test request (e.g., fetch company info or a specific endpoint that requires auth)
        const testUrl = `${HASHAVSHEVET_API_BASE_URL}/test-endpoint`; // Replace with a real test endpoint
        console.log('[Hashavshevet Action - testConnection] Testing connection to:', testUrl);

        const response = await fetch(testUrl, { method: 'GET', headers });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Hashavshevet API Error (${response.status}): ${errorText || response.statusText}`);
        }

        // If the request succeeds (status 2xx), assume connection is okay
        console.log('[Hashavshevet Action - testConnection] Test connection successful.');
        return { success: true, message: 'Connection successful!' };

    } catch (error: any) {
        console.error("[Hashavshevet Action - testConnection] Test failed:", error);
        return { success: false, message: `Connection failed: ${error.message}` };
    }
}

// --- Map Hashavshevet Product Data ---
 function mapHashavshevetProductToAction(hashavshevetProduct: any): Product | null {
      // Use fields from Hashavshevet's product structure (needs confirmation from API docs)
      // Example field names - ADJUST THESE based on actual API response
      const productId = hashavshevetProduct.InternalID || hashavshevetProduct.ItemKey; // Unique ID if available
      const catalogNumber = hashavshevetProduct.ItemCode || hashavshevetProduct.CatalogNum;
      const description = hashavshevetProduct.ItemName || hashavshevetProduct.Description;
      const unitPrice = hashavshevetProduct.Price || hashavshevetProduct.SalePrice || 0;
      const quantityInStock = hashavshevetProduct.StockQuantity ?? hashavshevetProduct.QuantityOnHand ?? 0;

      if (!catalogNumber && !description) {
        console.warn('[Hashavshevet Action - mapProduct] Skipping product due to missing catalog number and description:', hashavshevetProduct);
        return null;
      }

      const invoTrackProduct: Product = {
        id: productId || `${catalogNumber}-${Date.now()}`, // Use ID or generate one
        catalogNumber: catalogNumber || 'N/A',
        description: description || 'No Description',
        quantity: quantityInStock,
        unitPrice: unitPrice,
        lineTotal: quantityInStock * unitPrice, // Calculate initial line total
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
    // Placeholder for pagination logic (depends on Hashavshevet API)
    let currentPage = 1;
    let hasMore = true;
    let totalSynced = 0;

    try {
        // This loop is a placeholder - Hashavshevet might use different pagination (limit/offset, next page links, etc.)
        while (hasMore) {
            // Construct the URL with pagination parameters
            const url = `${HASHAVSHEVET_API_BASE_URL}/items?page=${currentPage}`; // Replace with actual product endpoint and params
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

            // *** Adjust data structure check based on Hashavshevet's response ***
            // Example: Check if data is an array or an object with a 'results' array
            const productsFromApi = Array.isArray(data) ? data : data?.results || data?.Items; // Adjust based on actual structure

            if (!Array.isArray(productsFromApi)) {
                console.error(`[Hashavshevet Action - syncProducts] Invalid product data structure received. Expected array. Raw response: ${responseText}`);
                throw new Error(`Invalid product data structure received from Hashavshevet API. Expected array. Received structure: ${typeof data}. Raw response: ${responseText}`);
            }

            const mappedProducts = productsFromApi
                .map(mapHashavshevetProductToAction)
                .filter((p): p is Product => p !== null);

            allProducts = allProducts.concat(mappedProducts);
            totalSynced += mappedProducts.length;

            // *** Adjust pagination check based on Hashavshevet's response ***
            // Example: Check for a 'nextPage' link or if the number of results is less than the page size
            if (productsFromApi.length < 50) { // Assuming a page size of 50
                 hasMore = false;
            } else {
                 currentPage++;
            }

            // Safety break
            if (currentPage > 50) { // Limit to 50 pages max
                 console.warn(`[Hashavshevet Action - syncProducts] Reached page limit (${currentPage}). Stopping sync.`);
                 hasMore = false;
            }
        }

        console.log(`[Hashavshevet Action - syncProducts] Returning ${totalSynced} products.`);
        return {
            success: true,
            message: `Successfully fetched ${totalSynced} products from Hashavshevet.`,
            itemsSynced: totalSynced,
            products: allProducts // Return the fetched products
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

    // Placeholder - Implement actual sales fetching and processing logic here
    console.log("[Hashavshevet Action - syncSales] Placeholder for sales sync...");
     try {
        // Fetch sales data using the auth headers and relevant Hashavshevet endpoints (e.g., /invoices, /transactions)
        // Process sales data (e.g., update inventory quantities in backend)
        // const salesUrl = `${HASHAVSHEVET_API_BASE_URL}/sales?startDate=...&endDate=...`; // Adjust endpoint and params
        // const salesResponse = await fetch(salesUrl, { headers });
        // ... process sales data ...

        return { success: true, message: "Sales sync placeholder completed (Hashavshevet)." }; // Update message when implemented
    } catch (error: any) {
        console.error("[Hashavshevet Action - syncSales] Error during sales sync:", error);
        return { success: false, message: `Sales sync failed: ${error.message}` };
    }
}
