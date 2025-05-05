// src/actions/caspit-actions.ts
'use server';

import type { PosConnectionConfig, SyncResult } from '@/services/pos-integration/pos-adapter.interface';
import type { Product } from '@/services/backend';
import { saveProducts } from '@/services/backend'; // Import saveProducts

const CASPIT_API_BASE_URL = 'https://app.caspit.biz/api/v1';

// --- Helper function to get the Caspit API token ---
async function getCaspitToken(config: PosConnectionConfig): Promise<string> {
    const { user, pwd, osekMorshe } = config;
    if (!user || !pwd || !osekMorshe) {
        throw new Error('Missing Caspit credentials (user, pwd, osekMorshe) in configuration.');
    }

    const url = `${CASPIT_API_BASE_URL}/Token?user=${encodeURIComponent(user)}&pwd=${encodeURIComponent(pwd)}&osekMorshe=${encodeURIComponent(osekMorshe)}`;
    console.log('[Caspit Action - getToken] Requesting token from:', url);

    let response: Response;
    let responseText = '';
    try {
        response = await fetch(url, { method: 'GET' }); // Use GET as per documentation for demo user
        responseText = await response.text(); // Read the response body as text first
        console.log(`[Caspit Action - getToken] Raw response status: ${response.status}`);
        console.log(`[Caspit Action - getToken] Raw response headers:`, response.headers);
        console.log(`[Caspit Action - getToken] Raw response text START:\n---\n${responseText}\n---\nRaw response text END`);

        if (!response.ok) {
            throw new Error(`Caspit API Error (${response.status}): ${responseText || response.statusText}`);
        }

        // Handle potential plain text token response (as seen in documentation examples)
        // Check content type or try parsing directly
        const contentType = response.headers.get('content-type');
        let accessToken: string | null = null;

        if (contentType && contentType.includes('application/json')) {
            try {
                const data = JSON.parse(responseText);
                accessToken = data?.AccessToken; // AccessToken as per OpenAPI example
                if (!accessToken) {
                     // Fallback check for plain text if JSON parse succeeds but token is missing
                     // This scenario is less likely if content-type is json, but good for robustness
                     if (typeof responseText === 'string' && responseText.trim().length > 10) {
                         accessToken = responseText.trim();
                         console.log('[Caspit Action - getToken] JSON response parsed, but AccessToken missing. Using raw text as token.');
                     } else {
                         console.error('[Caspit Action - getToken] Invalid JSON token response structure. AccessToken missing. Parsed Data:', data);
                         throw new Error('Invalid JSON token response structure from Caspit API. AccessToken missing.');
                     }
                }
            } catch (jsonError: any) {
                console.error('[Caspit Action - getToken] Failed to parse JSON response, trying raw text:', jsonError);
                // If JSON parsing fails, check if the raw text looks like a token
                 if (typeof responseText === 'string' && responseText.trim().length > 10) { // Basic check if it might be a token
                     accessToken = responseText.trim();
                     console.log('[Caspit Action - getToken] JSON parse failed. Using raw text as token.');
                 } else {
                     throw new Error(`Invalid response received from Caspit API. Could not parse JSON and raw text is not a valid token. Raw response: ${responseText}`);
                 }
            }
        } else if (typeof responseText === 'string' && responseText.trim().length > 10) {
            // Assume plain text token if not JSON and looks like a token
            accessToken = responseText.trim();
            console.log('[Caspit Action - getToken] Non-JSON response. Using raw text as token.');
        }

        if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
            console.error('[Caspit Action - getToken] Failed to extract token from response. Raw Text:', responseText);
            throw new Error('Failed to extract a valid AccessToken from Caspit API response.');
        }

        console.log('[Caspit Action - getToken] Successfully obtained token.');
        return accessToken;

    } catch (error: any) {
        console.error('[Caspit Action - getToken] Error fetching Caspit token:', error);
        // Include raw response text in the error for better debugging
        throw new Error(`Caspit token request failed: ${error.message}. Raw Response: ${responseText}`);
    }
}


// --- Server Action to Test Connection ---
export async function testCaspitConnectionAction(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
        const token = await getCaspitToken(config);
        // Optionally, make a simple authenticated call like getting contacts page 1 to further verify
        // const testUrl = `${CASPIT_API_BASE_URL}/Contacts?token=${token}&page=1&pageSize=1`;
        // const testResponse = await fetch(testUrl);
        // if (!testResponse.ok) throw new Error(`Test API call failed: ${testResponse.statusText}`);

        return { success: true, message: 'Connection successful!' };
    } catch (error: any) {
        console.error("[Caspit Action - testConnection] Test failed:", error);
        return { success: false, message: `Connection failed: ${error.message}` };
    }
}

// --- Map Caspit Product Data ---
 function mapCaspitProduct(caspitProduct: any): Product | null {
      // Use fields from the provided JSON structure (API response example)
      const productId = caspitProduct.ProductId; // Caspit's internal ID
      const catalogNumber = caspitProduct.CatalogNumber || '';
      // Use Name first, then Description as fallback
      const description = caspitProduct.Name || caspitProduct.Description || '';
      // Prioritize SalePrice1, fallback to PurchasePrice, then 0
      const unitPrice = caspitProduct.SalePrice1 ?? caspitProduct.PurchasePrice ?? 0;
      // Get quantity in stock from API if needed, otherwise default to 0 for sync
      const quantityInStock = caspitProduct.QtyInStock ?? 0;

      if (!catalogNumber && !description) {
        console.warn('[Caspit Action - mapCaspitProduct] Skipping product due to missing catalog number and name/description:', caspitProduct);
        return null;
      }

      const invoTrackProduct: Product = {
        id: productId, // Use ProductId from Caspit
        catalogNumber: catalogNumber || 'N/A',
        description: description || 'No Description',
        // For product sync, we usually fetch the catalog. Quantity is often updated by sales sync.
        // Let's keep the fetched QtyInStock for now, but be aware it might represent current stock, not purchase quantity.
        quantity: quantityInStock,
        unitPrice: unitPrice,
        lineTotal: quantityInStock * unitPrice, // Calculate initial line total based on stock quantity
      };
      return invoTrackProduct;
}


// --- Server Action to Sync Products ---
export async function syncCaspitProductsAction(config: PosConnectionConfig): Promise<SyncResult> {
    let token: string;
    try {
        token = await getCaspitToken(config);
    } catch (error: any) {
        return { success: false, message: `Product sync failed: Could not get token - ${error.message}` };
    }

    let allProducts: Product[] = [];
    let currentPage = 1;
    let hasMore = true;
    let totalSynced = 0;

    try {
        while (hasMore) {
            const url = `${CASPIT_API_BASE_URL}/Products?token=${token}&page=${currentPage}`;
            console.log(`[Caspit Action - syncProducts] Fetching page ${currentPage}: ${url}`);
            const response = await fetch(url);
            const responseText = await response.text(); // Get raw text for logging

            if (!response.ok) {
                 console.error(`[Caspit Action - syncProducts] Failed fetch for page ${currentPage}. Status: ${response.status}. Response: ${responseText}`);
                throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}. Response: ${responseText}`);
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                console.error(`[Caspit Action - syncProducts] Failed to parse JSON for page ${currentPage}. Response: ${responseText}`);
                throw new Error('Invalid JSON response received from Caspit product API.');
            }


            // *** Check the structure based on the provided example ***
            if (!data || typeof data !== 'object' || !Array.isArray(data.Results)) {
                console.error(`[Caspit Action - syncProducts] Invalid product data structure received from Caspit API. Expected object with 'Results' array. Raw response: ${responseText}`);
                throw new Error("Invalid product data structure received from Caspit API. Expected object with 'Results' array.");
            }

            const mappedProducts = data.Results
                .map(mapCaspitProduct)
                .filter((p): p is Product => p !== null); // Filter out nulls

            allProducts = allProducts.concat(mappedProducts);
            totalSynced += mappedProducts.length;

            // Check if there's a next page using NextPageUrl
            if (data.NextPageUrl) {
                currentPage++;
            } else {
                hasMore = false;
            }
             // Safety break - avoid infinite loops in case API logic is flawed
            if (currentPage > (data.TotalPages || 50)) { // Limit to 50 pages max or TotalPages if provided
                 console.warn(`[Caspit Action - syncProducts] Reached page limit (${currentPage}). Stopping sync.`);
                 hasMore = false;
            }
        }

        // Save the fetched products to our backend/localStorage
        if (allProducts.length > 0) {
             console.log(`[Caspit Action - syncProducts] Saving ${allProducts.length} products to backend...`);
            await saveProducts(allProducts, `Caspit Sync ${new Date().toISOString()}`, 'caspit_sync'); // Pass source
        }

        return { success: true, message: `Successfully synced ${totalSynced} products from Caspit.`, itemsSynced: totalSynced };

    } catch (error: any) {
        console.error("[Caspit Action - syncProducts] Product sync failed:", error);
        return { success: false, message: `Product sync failed: ${error.message}` };
    }
}


// --- Server Action to Sync Sales ---
export async function syncCaspitSalesAction(config: PosConnectionConfig): Promise<SyncResult> {
    // Placeholder - Implement actual sales fetching and processing logic here
    console.log("[Caspit Action - syncSales] Placeholder for sales sync...");
     try {
        const token = await getCaspitToken(config);
        // Fetch sales data using token and relevant Caspit endpoints (e.g., Documents, ExpensePayments?)
        // Process sales data (e.g., update inventory quantities in backend)
        // Example: Get recent documents
        // const salesUrl = `${CASPIT_API_BASE_URL}/Documents?token=${token}&page=1&trxTypeId=...&datStart=...`; // Adjust params
        // const salesResponse = await fetch(salesUrl);
        // ... process sales data ...

        return { success: true, message: "Sales sync placeholder completed." }; // Update message when implemented
    } catch (error: any) {
        console.error("[Caspit Action - syncSales] Error during sales sync:", error);
        return { success: false, message: `Sales sync failed: ${error.message}` };
    }
}
