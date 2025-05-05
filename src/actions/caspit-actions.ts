// src/actions/caspit-actions.ts
'use server';

import type { PosConnectionConfig, SyncResult } from '@/services/pos-integration/pos-adapter.interface';
import type { Product } from '@/services/backend';
// Removed: import { saveProducts } from '@/services/backend'; // saveProducts is client-side, cannot be called here

const CASPIT_API_BASE_URL = 'https://app.caspit.biz/api/v1';

// --- Helper function to get the Caspit API token ---
async function getCaspitToken(config: PosConnectionConfig): Promise<string> {
    const { user, pwd, osekMorshe } = config;
    if (!user || !pwd || !osekMorshe) {
        throw new Error('Missing Caspit credentials (user, pwd, osekMorshe) in configuration.');
    }

    // Use the demo user details provided
    const demoUser = 'demo';
    const demoPwd = 'demodemo';
    const demoOsekMorshe = '123456789';

    const url = `${CASPIT_API_BASE_URL}/Token?user=${encodeURIComponent(demoUser)}&pwd=${encodeURIComponent(demoPwd)}&osekMorshe=${encodeURIComponent(demoOsekMorshe)}`;
    console.log('[Caspit Action - getToken] Requesting token from:', url);

    let response: Response;
    let responseText = '';
    try {
        response = await fetch(url, { method: 'GET' }); // Use GET for demo user token request
        responseText = await response.text(); // Read the response body as text first
        console.log(`[Caspit Action - getToken] Raw response status: ${response.status}`);
        console.log(`[Caspit Action - getToken] Raw response headers:`, response.headers);
        console.log(`[Caspit Action - getToken] Raw response text START:\n---\n${responseText}\n---\nRaw response text END`);

        if (!response.ok) {
             // Handle specific error messages if possible
             if (responseText.includes("Invalid")) {
                throw new Error(`Caspit API Error (${response.status}): Invalid credentials or token parameters.`);
             }
            throw new Error(`Caspit API Error (${response.status}): ${responseText || response.statusText}`);
        }

        // *** Handle plain text token response ***
        // Caspit documentation for demo user shows token is returned as plain text
        let accessToken: string | null = null;
        if (typeof responseText === 'string' && responseText.trim().length > 10 && !responseText.trim().startsWith('{')) {
            accessToken = responseText.trim();
            console.log('[Caspit Action - getToken] Assuming plain text token response.');
        } else {
             // Attempt JSON parsing as a fallback, though not expected for demo token
             try {
                const data = JSON.parse(responseText);
                accessToken = data?.AccessToken; // Standard field name
                if (!accessToken) {
                     console.log('[Caspit Action - getToken] JSON parsed, but AccessToken missing. Falling back to raw text check.');
                     // Check raw text again if JSON parse succeeded but token missing
                     if (typeof responseText === 'string' && responseText.trim().length > 10) {
                         accessToken = responseText.trim();
                     } else {
                         throw new Error('JSON response did not contain AccessToken, and raw text is not a valid token.');
                     }
                }
             } catch (jsonError) {
                 console.error('[Caspit Action - getToken] Failed to parse JSON response, and raw text does not appear to be a token:', jsonError);
                 throw new Error(`Invalid response received from Caspit API. Could not parse JSON and raw text is not a valid token. Raw response: ${responseText}`);
             }
        }

        if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
            console.error('[Caspit Action - getToken] Failed to extract token from response. Raw Text:', responseText);
            throw new Error('Invalid token response structure from Caspit API. AccessToken missing or empty.');
        }

        // Clean potential surrounding quotes if they exist from plain text response
        accessToken = accessToken.replace(/^"+|"+$/g, '');

        console.log('[Caspit Action - getToken] Successfully obtained token:', accessToken); // Log the extracted token
        return accessToken;

    } catch (error: any) {
        console.error('[Caspit Action - getToken] Error fetching Caspit token:', error);
        throw new Error(`Caspit token request failed: ${error.message}. Raw Response: ${responseText}`);
    }
}


// --- Server Action to Test Connection ---
export async function testCaspitConnectionAction(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
        const token = await getCaspitToken(config);
        // A successful token retrieval is the test
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
      // Note: The example shows PurchasePrice, SalePrice1 might not always exist
      const unitPrice = caspitProduct.PurchasePrice ?? caspitProduct.SalePrice1 ?? 0;
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
// Accepts config directly to fetch a fresh token internally
// Returns SyncResult which now includes the products array
export async function syncCaspitProductsAction(config: PosConnectionConfig): Promise<SyncResult> {
    let token: string;
    try {
        // Fetch a fresh token *inside* the action, right before use
        console.log('[Caspit Action - syncProducts] Fetching fresh token...');
        token = await getCaspitToken(config);
        console.log('[Caspit Action - syncProducts] Fresh token obtained for product sync.');
    } catch (error: any) {
        return { success: false, message: `Product sync failed: Could not get token - ${error.message}` };
    }

    let allProducts: Product[] = [];
    let currentPage = 1;
    let hasMore = true;
    let totalSynced = 0;

    try {
        while (hasMore) {
            // Use the freshly obtained token
            const url = `${CASPIT_API_BASE_URL}/Products?token=${token}&page=${currentPage}`;
            console.log(`[Caspit Action - syncProducts] Fetching page ${currentPage}: ${url}`);
            const response = await fetch(url);
            const responseText = await response.text(); // Get raw text for logging

            if (!response.ok) {
                 console.error(`[Caspit Action - syncProducts] Failed fetch for page ${currentPage}. Status: ${response.status}. Response: ${responseText}`);
                 // Provide more specific error message for 401
                 if (response.status === 401) {
                    throw new Error(`Failed to fetch products: ${response.status} Invalid token. Token used: "${token}". Response: ${responseText}`);
                 }
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
            // The API returns an object like { CurrentPage: 1, Results: [...] }
            if (!data || typeof data !== 'object' || !Array.isArray(data.Results)) {
                console.error(`[Caspit Action - syncProducts] Invalid product data structure received from Caspit API. Expected object with 'Results' array. Raw response: ${responseText}`);
                // Provide the structure received for debugging
                throw new Error(`Invalid product data structure received from Caspit API. Expected object with 'Results' array. Received structure: ${JSON.stringify(Object.keys(data))}. Raw response: ${responseText}`);
            }

            const mappedProducts = data.Results
                .map(mapCaspitProduct)
                .filter((p): p is Product => p !== null); // Filter out nulls

            allProducts = allProducts.concat(mappedProducts);
            totalSynced += mappedProducts.length;

            // Check if there's a next page using NextPageUrl or TotalPages
            if (data.TotalPages && currentPage < data.TotalPages && data.NextPageUrl) {
                 currentPage++;
            } else {
                hasMore = false;
            }
             // Safety break - avoid infinite loops in case API logic is flawed
             // Limit to 50 pages max or TotalPages if provided (adjust limit if needed)
            if (currentPage > (data.TotalPages || 50)) {
                 console.warn(`[Caspit Action - syncProducts] Reached page limit (${currentPage}). Stopping sync.`);
                 hasMore = false;
            }
        }

        // ** DO NOT SAVE HERE - RETURN PRODUCTS **
        // The `saveProducts` function is client-side and cannot be called from a server action.
        // The results must be returned to the client component to handle saving.
        // if (allProducts.length > 0) {
        //      console.log(`[Caspit Action - syncProducts] Saving ${allProducts.length} products to backend...`);
        //     await saveProducts(allProducts, `Caspit Sync ${new Date().toISOString()}`, 'caspit_sync'); // <-- THIS CANNOT BE CALLED HERE
        // }

        console.log(`[Caspit Action - syncProducts] Returning ${totalSynced} products.`);
        return {
            success: true,
            message: `Successfully fetched ${totalSynced} products from Caspit.`,
            itemsSynced: totalSynced,
            products: allProducts // Return the fetched products
        };

    } catch (error: any) {
        console.error("[Caspit Action - syncProducts] Product sync failed:", error);
        return { success: false, message: `Product sync failed: ${error.message}` };
    }
}


// --- Server Action to Sync Sales ---
// Accepts config directly to fetch a fresh token internally
export async function syncCaspitSalesAction(config: PosConnectionConfig): Promise<SyncResult> {
    let token: string;
    try {
        // Fetch a fresh token *inside* the action, right before use
        console.log('[Caspit Action - syncSales] Fetching fresh token...');
        token = await getCaspitToken(config);
        console.log('[Caspit Action - syncSales] Fresh token obtained for sales sync.');
    } catch (error: any) {
        return { success: false, message: `Sales sync failed: Could not get token - ${error.message}` };
    }

    // Placeholder - Implement actual sales fetching and processing logic here
    console.log("[Caspit Action - syncSales] Placeholder for sales sync...");
     try {
        // Fetch sales data using the fresh token and relevant Caspit endpoints (e.g., Documents, ExpensePayments?)
        // Process sales data (e.g., update inventory quantities in backend)
        // Example: Get recent documents
        // const salesUrl = `${CASPIT_API_BASE_URL}/Documents?token=${token}&page=1&trxTypeId=...&datStart=...`; // Adjust params
        // const salesResponse = await fetch(salesUrl);
        // ... process sales data ...

        return { success: true, message: "Sales sync placeholder completed." }; // Update message when implemented
    } catch (error: any) {
        console.error("[Caspit Action - syncSales] Error during sales sync:", error);
         // Handle potential token errors specifically
         if (error instanceof Error && error.message.includes('401')) {
             return { success: false, message: `Sales sync failed: Invalid token. ${error.message}` };
         }
        return { success: false, message: `Sales sync failed: ${error.message}` };
    }
}
