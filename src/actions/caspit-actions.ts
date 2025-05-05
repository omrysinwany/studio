
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

    console.log(`[Caspit Action - getCaspitToken] Attempting to get token from URL: ${url}`); // Log the final URL

    let response: Response | null = null;
    let responseText: string = '';

    try {
        response = await fetch(url, {
            method: 'GET', // Specify GET method
            headers: {
                'Accept': 'application/json, text/plain, */*', // Accept JSON or plain text
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            cache: 'no-store', // Ensure no caching
        });

        responseText = await response.text(); // Read the response body as text first
        console.log(`[Caspit Action - getCaspitToken] Raw response status: ${response.status}`);
        console.log(`[Caspit Action - getCaspitToken] Raw response headers:`, response.headers);
        console.log(`[Caspit Action - getCaspitToken] Raw response text START:\n---\n${responseText}\n---\nRaw response text END`);

        if (!response.ok) {
            // Log specific error details
            console.error(`[Caspit Action - getCaspitToken] Failed to get token. Status: ${response.status} ${response.statusText}. Response: ${responseText}`);
            // Provide a more informative error based on common issues
            let detailedErrorMessage = `Failed to get token: ${response.status} ${response.statusText}.`;
            if (response.status === 401 || response.status === 403) {
                detailedErrorMessage += ' Please check your credentials (Username, Password, Business ID).';
            } else if (response.status === 404) {
                 detailedErrorMessage += ' API endpoint not found. Please check the URL.';
            } else {
                 // Include raw response text in error for debugging
                 detailedErrorMessage += ` Raw response: ${responseText}`;
            }
            throw new Error(detailedErrorMessage);
        }

         // Check content type and attempt to parse JSON IF it looks like JSON
         const contentType = response.headers.get("content-type");
         let accessToken: string | undefined | null = null;

         if (contentType && contentType.includes("application/json")) {
             try {
                 const data = JSON.parse(responseText);
                 console.log('[Caspit Action - getCaspitToken] Parsed JSON data structure:', JSON.stringify(data, null, 2));
                 console.log('[Caspit Action - getCaspitToken] Keys in parsed data:', Object.keys(data || {}));

                 // Look for AccessToken (primary)
                 accessToken = data?.AccessToken; // Only check for AccessToken as per explicit doc structure

                 if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
                     console.warn('[Caspit Action - getCaspitToken] JSON response received, but expected token key (AccessToken) was missing or empty. Parsed Data:', data);
                     // Fall through to check if the raw text might be the token
                     accessToken = null; // Reset to null to allow raw text check
                 } else {
                      console.log('[Caspit Action - getCaspitToken] Successfully obtained token from JSON.');
                      console.log(`[Caspit Action - getCaspitToken] Extracted Token (JSON): "${accessToken}"`); // Log extracted token
                      return accessToken; // Return the found token
                 }

             } catch (jsonError: any) {
                 console.warn('[Caspit Action - getCaspitToken] Failed to parse JSON response even though content-type was JSON:', jsonError);
                 console.warn('[Caspit Action - getCaspitToken] Response text that failed parsing:', responseText);
                 // Fall through to check if the raw text might be the token
                 accessToken = null;
             }
         }

        // If JSON parsing failed or didn't yield a token, check if the raw responseText itself might be the token
        // Basic check: not empty and doesn't look like HTML
        if (!accessToken && responseText.trim() && !responseText.trim().startsWith('<')) {
             console.log('[Caspit Action - getCaspitToken] Assuming raw response text is the token.');
             accessToken = responseText.trim();
             // Add validation if needed (e.g., check length or format)
             if (accessToken.length < 10) { // Example validation
                 console.error('[Caspit Action - getCaspitToken] Raw response text is too short to be a valid token:', accessToken);
                 throw new Error('Received an unexpected short response from Caspit API. Expected a token.');
             }
             console.log('[Caspit Action - getCaspitToken] Successfully obtained token from raw text.');
             console.log(`[Caspit Action - getCaspitToken] Extracted Token (Raw): "${accessToken}"`); // Log extracted token
             return accessToken;
        }

        // If we reach here, neither JSON parsing nor raw text check yielded a valid token
        console.error('[Caspit Action - getCaspitToken] Failed to extract a valid token from the response. Response text:', responseText);
        throw new Error('Invalid or empty token response received from Caspit API.');

    } catch (error) {
        // This catch block now handles fetch errors AND errors thrown above
        console.error('[Caspit Action - getCaspitToken] Error fetching or processing token:', error);
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
    console.log(`[Caspit Action - testCaspitConnectionAction] Testing connection with config:`, config);
    try {
        const token = await getCaspitToken(config);
        // If getToken completes without throwing, connection is considered successful
        return {
            success: true,
            message: 'Connection successful! Token obtained.',
        };
    } catch (error: any) {
        console.error("[Caspit Action - testCaspitConnectionAction] Connection test failed in action:", error);
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
       console.warn('[Caspit Action - mapCaspitProduct] Skipping product due to missing catalog number and description:', caspitProduct);
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
    console.log(`[Caspit Action - syncCaspitProductsAction] Starting product sync...`);
    let token: string;
    try {
        token = await getCaspitToken(config); // Get token first
        console.log(`[Caspit Action - syncCaspitProductsAction] Token obtained successfully for product sync.`);
    } catch (tokenError: any) {
         console.error("[Caspit Action - syncCaspitProductsAction] Failed to obtain token before syncing products:", tokenError);
         return { success: false, message: `Product sync failed: Could not obtain token - ${tokenError.message || 'Unknown token error'}` };
    }

    // Proceed with product fetching using the obtained token
    try {
        let page = 1;
        let allCaspitProducts: any[] = []; // Use 'any' for now, refine if CaspitProduct structure is known
        let hasMore = true;

        console.log(`[Caspit Action - syncCaspitProductsAction] Fetching products page ${page}...`);
        while (hasMore) {
            const url = `${CASPIT_API_BASE_URL}/Products?token=${token}&page=${page}`;
             // *** Add Logging for Fetch URL and Token Used ***
             console.log(`[Caspit Action - syncCaspitProductsAction] Fetching from URL: ${url}`);
             console.log(`[Caspit Action - syncCaspitProductsAction] Using token for page ${page}: "${token}"`); // Log the token being used

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
             console.log(`[Caspit Action - syncCaspitProductsAction] Product fetch (Page ${page}) status: ${response.status}`);
             // console.log(`[Caspit Action - syncCaspitProductsAction] Product fetch (Page ${page}) response text START:\n---\n${responseText}\n---\nProduct fetch response text END`); // Optional: Log full response text if needed

            if (!response.ok) {
                console.error(`[Caspit Action - syncCaspitProductsAction] Failed to fetch products (Page ${page}): ${response.status} ${response.statusText}`, responseText);
                // Include token in error message for debugging
                throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}. Token used: "${token}". Response: ${responseText}`);
            }

             // Check content type before parsing
             const contentType = response.headers.get("content-type");
             if (!contentType || !contentType.includes("application/json")) {
                 console.error(`[Caspit Action - syncCaspitProductsAction] Unexpected content type received for products: ${contentType}. Expected JSON.`);
                 console.error("[Caspit Action - syncCaspitProductsAction] Response Text:", responseText);
                 // Allow continuing if content looks like JSON, but log a warning
                 if (!responseText.trim().startsWith('[')) {
                    throw new Error(`Expected JSON response for products but received ${contentType}. Raw response: ${responseText}`);
                 }
                 console.warn(`[Caspit Action - syncCaspitProductsAction] Content type is not JSON, but attempting to parse anyway.`);
             }

            let caspitProductsPage: any[] = [];
            try {
                 caspitProductsPage = JSON.parse(responseText); // Parse the logged text
            } catch (jsonError: any) {
                 console.error(`[Caspit Action - syncCaspitProductsAction] Failed to parse JSON response for products (Page ${page}):`, jsonError);
                 console.error("[Caspit Action - syncCaspitProductsAction] Response text that failed parsing:", responseText);
                 throw new Error(`Failed to parse JSON product response from Caspit API: ${jsonError.message}`);
            }

            // Log parsed product page data structure (optional, can be verbose)
             // console.log(`[Caspit Action - syncCaspitProductsAction] Parsed product data (Page ${page}):`, JSON.stringify(caspitProductsPage, null, 2));


            if (!Array.isArray(caspitProductsPage)) {
                console.error('[Caspit Action - syncCaspitProductsAction] Invalid product data structure received (not an array):', caspitProductsPage);
                throw new Error('Invalid product data structure received from Caspit API.');
            }

            if (caspitProductsPage.length === 0) {
                hasMore = false;
                console.log(`[Caspit Action - syncCaspitProductsAction] No more products found (Page ${page}).`);
            } else {
                console.log(`[Caspit Action - syncCaspitProductsAction] Fetched ${caspitProductsPage.length} products on page ${page}.`);
                allCaspitProducts = allCaspitProducts.concat(caspitProductsPage);
                page++;
                // Optional delay? await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        console.log(`[Caspit Action - syncCaspitProductsAction] Total products fetched from Caspit: ${allCaspitProducts.length}`);

        // Map Caspit products to InvoTrack format
        const mappedProducts = allCaspitProducts.map(mapCaspitProduct).filter(p => p !== null) as Product[];
        console.log(`[Caspit Action - syncCaspitProductsAction] Mapped ${mappedProducts.length} products to InvoTrack format.`);

        // Save mapped products to InvoTrack backend (localStorage via backend.ts)
        await saveProducts(mappedProducts, "Caspit Sync", 'caspit_sync'); // Use specific source
        console.log(`[Caspit Action - syncCaspitProductsAction] Saved products to InvoTrack backend.`);

        return {
            success: true,
            message: `Successfully synced ${mappedProducts.length} products from Caspit.`,
            itemsSynced: mappedProducts.length
        };

    } catch (error: any) {
        // This catch block handles errors during the product fetching/processing phase
        console.error("[Caspit Action - syncCaspitProductsAction] Product sync failed:", error);
         // Provide a more specific error message
        return { success: false, message: `Product sync failed: ${error.message || 'Unknown error during product sync'}` };
    }
}

// --- Server Action: Sync Sales ---
export async function syncCaspitSalesAction(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[Caspit Action - syncCaspitSalesAction] Starting sales sync (Placeholder)...`);
     let token: string;
     try {
        token = await getCaspitToken(config); // Authenticate
        console.log(`[Caspit Action - syncCaspitSalesAction] Token obtained successfully for sales sync.`);
     } catch (tokenError: any) {
        console.error("[Caspit Action - syncCaspitSalesAction] Failed to obtain token before syncing sales:", tokenError);
        return { success: false, message: `Sales sync failed: Could not obtain token - ${tokenError.message || 'Unknown token error'}` };
     }

    try {
        // --- TODO: Implement fetching sales data from Caspit ---
        // Example: const salesUrl = `${CASPIT_API_BASE_URL}/Sales?token=${token}&startDate=...&endDate=...`;
        // Fetch and process sales data
        console.warn('[Caspit Action - syncCaspitSalesAction] Sales sync logic needs to be implemented.');
        await new Promise(resolve => setTimeout(resolve, 200)); // Simulate work

        // --- TODO: Update InvoTrack inventory based on sales ---
        // let currentInventory = await getProductsService();
        // // Process salesData...
        // // Example: Adjust currentInventory[productIndex].quantity -= sale.quantitySold;
        // await saveProducts(updatedInventory, "Caspit Sales Sync Update", "caspit_sync_sales");


        return { success: true, message: 'Sales sync placeholder completed.' };

    } catch (error: any) {
        console.error("[Caspit Action - syncCaspitSalesAction] Sales sync failed:", error);
         // Provide a more specific error message
        return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error during sales sync'}` };
    }
}

