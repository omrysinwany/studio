
'use server';

/**
 * @fileOverview Server actions for interacting with the Caspit POS API.
 */

import type { PosConnectionConfig, SyncResult, Product } from '@/services/pos-integration/pos-adapter.interface';
import { saveProducts, getProductsService } from '@/services/backend'; // Import backend functions if needed for saving/updating

const CASPIT_API_BASE_URL = 'https://app.caspit.biz/api/v1';

// --- Helper function to get token ---
async function getCaspitToken(config: PosConnectionConfig): Promise<string> {
    // Use provided config or fallback to demo credentials for testing
    const user = config.user || 'demo';
    const pwd = config.pwd || 'demodemo';
    const osekMorshe = config.osekMorshe || '123456789'; // Caspit's demo osekMorshe

    const url = `${CASPIT_API_BASE_URL}/Token?user=${encodeURIComponent(user)}&pwd=${encodeURIComponent(pwd)}&osekMorshe=${encodeURIComponent(osekMorshe)}`;
    console.log(`[Caspit Action] Getting token from: ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET', // Specify GET method
            headers: {
                'Accept': 'application/json' // Ensure we ask for JSON
            },
            // Add cache control if needed, e.g., no-cache
            cache: 'no-store',
        });

        if (!response.ok) {
            let errorText = '';
            try {
                errorText = await response.text();
            } catch (textError) {
                console.error('[Caspit Action] Failed to read error response text:', textError);
            }
            console.error(`[Caspit Action] Failed to get token: ${response.status} ${response.statusText}`, errorText);
            throw new Error(`Failed to get token: ${response.status} ${response.statusText}. ${errorText}`);
        }

        const data = await response.json();
        if (!data || !data.AccessToken) {
            console.error('[Caspit Action] Invalid token response:', data);
            throw new Error('Invalid token response from Caspit API');
        }
        console.log('[Caspit Action] Successfully obtained token.');
        return data.AccessToken;
    } catch (error) {
        console.error('[Caspit Action] Error fetching token:', error);
        throw error; // Re-throw the error for handling in calling functions
    }
}

// --- Server Action: Test Connection ---
export async function testCaspitConnectionAction(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    console.log(`[Caspit Action] Testing connection with config:`, config);
    try {
        const token = await getCaspitToken(config);
        const success = !!token;
        return {
            success: success,
            message: success ? 'Connection successful!' : 'Failed to obtain token.', // Message reflects token success
        };
    } catch (error: any) {
        console.error("[Caspit Action] Connection test failed:", error);
        return { success: false, message: `Connection failed: ${error.message || 'Unknown error'}` };
    }
}

// --- Helper: Map Caspit Product ---
// Moved mapping here as it's part of the server-side processing
function mapCaspitProduct(caspitProduct: any): Product | null {
     const catalogNumber = caspitProduct.CatalogNumber || '';
     const description = caspitProduct.ProductName || '';
     const unitPrice = caspitProduct.SalePrice ?? 0;

     if (!catalogNumber && !description) {
       console.warn('[Caspit Action] Skipping product due to missing catalog number and description:', caspitProduct);
       return null;
     }

     const invoTrackProduct: Product = {
       id: caspitProduct.ProductID,
       catalogNumber: catalogNumber || 'N/A',
       description: description || 'No Description',
       quantity: 0, // Default quantity, sales sync should handle updates
       unitPrice: unitPrice,
       lineTotal: 0,
     };
     return invoTrackProduct;
}


// --- Server Action: Sync Products ---
export async function syncCaspitProductsAction(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[Caspit Action] Starting product sync...`);
    try {
        const token = await getCaspitToken(config);
        let page = 1;
        let allCaspitProducts: any[] = []; // Use 'any' for now, refine if CaspitProduct structure is known
        let hasMore = true;

        console.log(`[Caspit Action] Fetching products page ${page}...`);
        while (hasMore) {
            const url = `${CASPIT_API_BASE_URL}/Products?token=${token}&page=${page}`;
            const response = await fetch(url, {
                headers: { 'Accept': 'application/json' },
                cache: 'no-store',
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Caspit Action] Failed to fetch products (Page ${page}): ${response.status} ${response.statusText}`, errorText);
                throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
            }

             // Check content type before parsing
             const contentType = response.headers.get("content-type");
             if (!contentType || !contentType.includes("application/json")) {
                 console.error(`[Caspit Action] Unexpected content type received: ${contentType}. Expected JSON.`);
                 const textResponse = await response.text();
                 console.error("[Caspit Action] Response Text:", textResponse);
                 throw new Error(`Expected JSON response but received ${contentType}`);
             }

            let caspitProductsPage: any[] = [];
            try {
                caspitProductsPage = await response.json();
            } catch (jsonError) {
                 console.error(`[Caspit Action] Failed to parse JSON response (Page ${page}):`, jsonError);
                 throw new Error(`Failed to parse JSON response from Caspit API: ${jsonError}`);
            }

            if (!Array.isArray(caspitProductsPage)) {
                console.error('[Caspit Action] Invalid product data structure received (not an array):', caspitProductsPage);
                throw new Error('Invalid product data structure received from Caspit API.');
            }

            if (caspitProductsPage.length === 0) {
                hasMore = false;
                console.log(`[Caspit Action] No more products found (Page ${page}).`);
            } else {
                console.log(`[Caspit Action] Fetched ${caspitProductsPage.length} products on page ${page}.`);
                allCaspitProducts = allCaspitProducts.concat(caspitProductsPage);
                page++;
                // Optional delay? await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        console.log(`[Caspit Action] Total products fetched from Caspit: ${allCaspitProducts.length}`);

        // Map Caspit products to InvoTrack format
        const mappedProducts = allCaspitProducts.map(mapCaspitProduct).filter(p => p !== null) as Product[];
        console.log(`[Caspit Action] Mapped ${mappedProducts.length} products to InvoTrack format.`);

        // Save mapped products to InvoTrack backend (localStorage via backend.ts)
        await saveProducts(mappedProducts, "Caspit Sync", 'caspit_sync'); // Use specific source
        console.log(`[Caspit Action] Saved products to InvoTrack backend.`);

        return {
            success: true,
            message: `Successfully synced ${mappedProducts.length} products from Caspit.`,
            itemsSynced: mappedProducts.length
        };

    } catch (error: any) {
        console.error("[Caspit Action] Product sync failed:", error);
        return { success: false, message: `Product sync failed: ${error.message || 'Unknown error'}` };
    }
}

// --- Server Action: Sync Sales ---
export async function syncCaspitSalesAction(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[Caspit Action] Starting sales sync (Placeholder)...`);
    try {
        const token = await getCaspitToken(config); // Authenticate

        // --- TODO: Implement fetching sales data from Caspit ---
        // Example: const salesUrl = `${CASPIT_API_BASE_URL}/Sales?token=${token}&startDate=...&endDate=...`;
        // Fetch and process sales data
        console.warn('[Caspit Action] Sales sync logic needs to be implemented.');
        await new Promise(resolve => setTimeout(resolve, 200)); // Simulate work

        // --- TODO: Update InvoTrack inventory based on sales ---
        // let currentInventory = await getProductsService();
        // // Process salesData...
        // // Example: Adjust currentInventory[productIndex].quantity -= sale.quantitySold;
        // await saveProducts(updatedInventory, "Caspit Sales Sync Update", "caspit_sync_sales");


        return { success: true, message: 'Sales sync placeholder completed.' };

    } catch (error: any) {
        console.error("[Caspit Action] Sales sync failed:", error);
        return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error'}` };
    }
}
