
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

    // Construct the URL carefully, ensuring proper encoding
    const params = new URLSearchParams({
        user: user,
        pwd: pwd,
        osekMorshe: osekMorshe,
    });
    const url = `${CASPIT_API_BASE_URL}/Token?${params.toString()}`;

    console.log(`[Caspit Action] Attempting to get token from URL: ${url}`); // Log the final URL

    let response: Response | null = null; // Define response variable outside try block
    let responseText: string = ''; // Define responseText variable outside try block

    try {
        response = await fetch(url, {
            method: 'GET', // Specify GET method
            headers: {
                'Accept': 'application/json', // Ensure we ask for JSON
                'Cache-Control': 'no-cache, no-store, must-revalidate', // Try stricter cache control
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            cache: 'no-store', // Ensure no caching
        });

        responseText = await response.text(); // Read the response body as text first
        console.log(`[Caspit Action] Raw response status: ${response.status}`);
        console.log(`[Caspit Action] Raw response headers:`, JSON.stringify(Object.fromEntries(response.headers.entries())));
        console.log(`[Caspit Action] Raw response text: ${responseText}`); // Log the raw response text

        if (!response.ok) {
            // Log specific error details
            console.error(`[Caspit Action] Failed to get token. Status: ${response.status} ${response.statusText}. Response: ${responseText}`);
            // Provide a more informative error based on common issues
            let detailedErrorMessage = `Failed to get token: ${response.status} ${response.statusText}.`;
            if (response.status === 401 || response.status === 403) {
                detailedErrorMessage += ' Please check your credentials (Username, Password, Business ID).';
            } else if (response.status === 404) {
                 detailedErrorMessage += ' API endpoint not found. Please check the URL.';
            } else {
                 detailedErrorMessage += ` Raw response: ${responseText}`;
            }
            throw new Error(detailedErrorMessage);
        }

         // Check content type before parsing
         const contentType = response.headers.get("content-type");
         if (!contentType || !contentType.includes("application/json")) {
             console.warn(`[Caspit Action] Unexpected content type received for token: ${contentType}. Expected JSON. Trying to parse anyway.`);
             // You might still want to attempt parsing if the content looks like JSON despite the header
         }


        let data;
        try {
            data = JSON.parse(responseText); // Try parsing the logged text
        } catch (jsonError: any) {
            console.error('[Caspit Action] Failed to parse JSON response:', jsonError);
            console.error('[Caspit Action] Response text that failed parsing:', responseText);
            throw new Error(`Invalid JSON response received from Caspit API: ${jsonError.message}. Raw response: ${responseText}`);
        }

        // *** Log the parsed data structure before checking the AccessToken ***
        console.log('[Caspit Action] Parsed JSON data:', JSON.stringify(data, null, 2));

        // Check if AccessToken exists in the parsed data
        if (!data || !data.AccessToken) {
            console.error('[Caspit Action] Invalid token response structure. AccessToken missing. Parsed Data:', data);
            throw new Error('Invalid token response structure from Caspit API. AccessToken missing.');
        }

        console.log('[Caspit Action] Successfully obtained token.');
        return data.AccessToken;
    } catch (error) {
        // This catch block now handles fetch errors AND errors thrown above (like !response.ok or JSON parse errors)
        console.error('[Caspit Action] Error fetching or processing token:', error);
        // Re-throw a potentially more user-friendly error message
        if (error instanceof Error) {
             // Use the error message generated above if available
             throw new Error(`Caspit token request failed: ${error.message}`);
        } else {
            // Fallback for unknown errors
            throw new Error(`Caspit token request failed with an unknown error. Check server logs.`);
        }
    }
}

// --- Server Action: Test Connection ---
export async function testCaspitConnectionAction(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    console.log(`[Caspit Action] Testing connection with config:`, config);
    try {
        const token = await getCaspitToken(config);
        // If getToken completes without throwing, connection is considered successful
        return {
            success: true,
            message: 'Connection successful! Token obtained.',
        };
    } catch (error: any) {
        console.error("[Caspit Action] Connection test failed in action:", error);
        // Provide a more specific error message back to the UI, using the message from getCaspitToken
        return { success: false, message: error.message || 'Connection failed: Unknown error during token retrieval' };
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
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                cache: 'no-store',
            });

            const responseText = await response.text(); // Read text first
             console.log(`[Caspit Action] Product fetch (Page ${page}) status: ${response.status}`);
             console.log(`[Caspit Action] Product fetch (Page ${page}) response text: ${responseText}`);

            if (!response.ok) {
                console.error(`[Caspit Action] Failed to fetch products (Page ${page}): ${response.status} ${response.statusText}`, responseText);
                throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}. Response: ${responseText}`);
            }

             // Check content type before parsing
             const contentType = response.headers.get("content-type");
             if (!contentType || !contentType.includes("application/json")) {
                 console.error(`[Caspit Action] Unexpected content type received for products: ${contentType}. Expected JSON.`);
                 console.error("[Caspit Action] Response Text:", responseText);
                 // Allow continuing if content looks like JSON, but log a warning
                 if (!responseText.trim().startsWith('[')) {
                    throw new Error(`Expected JSON response for products but received ${contentType}`);
                 }
                 console.warn(`[Caspit Action] Content type is not JSON, but attempting to parse anyway.`);
             }

            let caspitProductsPage: any[] = [];
            try {
                 caspitProductsPage = JSON.parse(responseText); // Parse the logged text
            } catch (jsonError: any) {
                 console.error(`[Caspit Action] Failed to parse JSON response for products (Page ${page}):`, jsonError);
                 console.error("[Caspit Action] Response text that failed parsing:", responseText);
                 throw new Error(`Failed to parse JSON product response from Caspit API: ${jsonError.message}`);
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
         // Provide a more specific error message
        return { success: false, message: `Product sync failed: ${error.message || 'Unknown error during product sync'}` };
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
         // Provide a more specific error message
        return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error during sales sync'}` };
    }
}
