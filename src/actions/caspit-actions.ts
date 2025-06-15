// src/actions/caspit-actions.ts
"use server";

import type {
  PosConnectionConfig,
  SyncResult,
} from "@/services/pos-integration/pos-adapter.interface";
import type { Product, InvoiceHistoryItem, Supplier } from "@/services/types";
import {
  CaspitContact,
  CaspitDocument,
  CaspitExpense,
} from "@/services/pos-integration/caspit-types";
import { Timestamp } from "firebase/firestore";
import { format } from "date-fns";

const CASPIT_TRX_TYPE_IDS = {
  PURCHASE_INVOICE: 300, // חשבונית רכש
  GOODS_RECEIVED_VOUCHER: 305, // תעודת כניסה למלאי (תעודת משלוח)
};

const CASPIT_API_BASE_URL = "https://app.caspit.biz/api/v1";

// --- Helper function to get the Caspit API token ---
async function getCaspitToken(config: PosConnectionConfig): Promise<string> {
  const { user, pwd, osekMorshe } = config;
  if (!user || !pwd || !osekMorshe) {
    throw new Error(
      "Missing Caspit credentials (user, pwd, osekMorshe) in configuration."
    );
  }

  // Use demo credentials if actual ones are not fully provided or for testing
  const effectiveUser = user || "demo";
  const effectivePwd = pwd || "demodemo";
  const effectiveOsekMorshe = osekMorshe || "123456789";

  const url = `${CASPIT_API_BASE_URL}/Token?user=${encodeURIComponent(
    effectiveUser
  )}&pwd=${encodeURIComponent(effectivePwd)}&osekMorshe=${encodeURIComponent(
    effectiveOsekMorshe
  )}`;
  console.log("[Caspit Action - getToken] Requesting token from:", url);

  let response: Response;
  let responseText = "";
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain",
      },
    });
    responseText = await response.text();
    console.log(
      `[Caspit Action - getToken] Raw response status: ${response.status}`
    );
    console.log(
      `[Caspit Action - getToken] Raw response headers:`,
      response.headers
    );
    console.log(
      `[Caspit Action - getToken] Raw response text START:\n---\n${responseText}\n---\nRaw response text END`
    );

    if (!response.ok) {
      const genericApiError = `Caspit API request failed with status ${response.status}.`;
      console.error(
        `[Caspit Action - getToken] ${genericApiError} Full Response: ${responseText}`
      );
      let displayErrorMessage = genericApiError;
      if (
        responseText &&
        (responseText.trim().startsWith("<") || responseText.includes("<?xml"))
      ) {
        displayErrorMessage +=
          " (Received non-JSON/text response from Caspit). Check server logs for Caspit's full response.";
      } else if (responseText) {
        displayErrorMessage += ` (Caspit response snippet: ${responseText.substring(
          0,
          70
        )}${
          responseText.length > 70 ? "..." : ""
        }). Check server logs for full response.`;
      }
      throw new Error(displayErrorMessage);
    }

    let data;
    let accessToken: string | null = null;

    if (responseText.trim().startsWith("{")) {
      try {
        data = JSON.parse(responseText);
        accessToken =
          data?.AccessToken || data?.accessToken || data?.Token || data?.token;
        if (!accessToken && typeof data === "object" && data !== null) {
          for (const key in data) {
            if (
              key.toLowerCase() === "accesstoken" ||
              key.toLowerCase() === "token"
            ) {
              if (typeof data[key] === "string" && data[key].trim() !== "") {
                accessToken = data[key].trim();
                break;
              }
            }
          }
        }
      } catch (jsonError) {
        console.warn(
          "[Caspit Action - getToken] Failed to parse as JSON. Will attempt to treat as plain text token. JSON Error:",
          (jsonError as Error).message
        );
      }
    }

    if (!accessToken) {
      if (
        typeof responseText === "string" &&
        responseText.length >= 20 &&
        /^[a-zA-Z0-9.-_]+$/.test(responseText.replace(/^"+|"+$/g, ""))
      ) {
        accessToken = responseText.trim().replace(/^"+|"+$/g, "");
        console.log(
          "[Caspit Action - getToken] Interpreted response as plain text token."
        );
      } else {
        console.warn(
          "[Caspit Action - getToken] Response is not valid JSON and does not look like a plain text token. Raw response logged above."
        );
        throw new Error(
          "Caspit API returned an unparsable response or not a token. Check server logs."
        );
      }
    }

    if (
      !accessToken ||
      typeof accessToken !== "string" ||
      accessToken.trim() === ""
    ) {
      console.error(
        "[Caspit Action - getToken] Failed to extract token from response. Raw Response Text:",
        responseText
      );
      let detail = "AccessToken missing or empty in the response.";
      if (responseText.trim().startsWith("<")) {
        detail = "Received unexpected XML/HTML from Caspit instead of token.";
      } else if (responseText.length > 200) {
        detail = "Unexpected and lengthy response format from Caspit.";
      } else if (responseText.trim() !== "" && !accessToken) {
        console.warn(
          "[Caspit Action - getToken] Potentially problematic responseText (not included in client error):",
          responseText
        );
        detail = "Unrecognized response format from Caspit.";
      }
      throw new Error(
        `Caspit API: Invalid token response. ${detail} Check server logs.`
      );
    }

    accessToken = accessToken.replace(/^"+|"+$/g, "");

    console.log(
      "[Caspit Action - getToken] Successfully obtained token:",
      accessToken
    );
    return accessToken;
  } catch (error: any) {
    console.error(
      "[Caspit Action - getToken] Error processing Caspit token request:",
      error.message
    );
    const specificMessage =
      error.message || "Unknown error during token request.";
    if (
      specificMessage.toLowerCase().includes("fetch failed") ||
      specificMessage.toLowerCase().includes("networkerror")
    ) {
      throw new Error(
        `Network error while trying to reach Caspit API. Please check your internet connection and Caspit API status. Server logs may have more details.`
      );
    }
    throw new Error(
      `Caspit token request failed. Please check server logs for detailed error information.`
    );
  }
}

// --- Server Action to Test Connection ---
export async function testCaspitConnectionAction(
  config: PosConnectionConfig
): Promise<{ success: boolean; message: string }> {
  try {
    await getCaspitToken(config);
    return { success: true, message: "Connection successful!" };
  } catch (error: any) {
    console.error("[Caspit Action - testConnection] Test failed:", error);
    return {
      success: false,
      message:
        "Connection test failed. Please check server console logs for details.",
    };
  }
}

// --- Map Caspit Product Data (from Caspit to App Product) ---
function mapCaspitProductToAppProduct(caspitProduct: any): Product | null {
  const productId = caspitProduct.ProductId; // This is Caspit's ID
  const catalogNumber = caspitProduct.CatalogNumber || "";
  const description = caspitProduct.Name || caspitProduct.Description || "";
  const unitPrice = caspitProduct.PurchasePrice ?? 0;
  const salePrice = caspitProduct.SalePrice1 ?? undefined;
  const quantityInStock = caspitProduct.QtyInStock ?? 0;

  if (!productId && !catalogNumber && !description) {
    // ProductId from Caspit is key for mapping
    console.warn(
      "[Caspit Action - mapCaspitProductToAppProduct] Skipping product due to missing critical identifiers (ProductId, CatalogNumber, Name/Description):",
      caspitProduct
    );
    return null;
  }

  // This mapped Product will be partial, consumer needs to fill userId etc.
  const invoTrackProduct: Partial<Product> & { caspitProductId: string } = {
    // id: typically you would find or create a Firestore ID based on caspitProductId
    caspitProductId: productId, // Store Caspit's ID
    catalogNumber: catalogNumber || undefined, // Use undefined if empty string is not desired
    description: description || "No Description",
    shortName: caspitProduct.Name || description.substring(0, 50), // Example shortName logic
    quantity: quantityInStock,
    unitPrice: unitPrice,
    salePrice: salePrice,
    // lineTotal: quantityInStock * unitPrice, // App should calculate this if needed
    // barcode: caspitProduct.Barcode || undefined,
    // minStockLevel: caspitProduct.MinQtyInStock ?? undefined,
    // maxStockLevel: caspitProduct.MaxQtyInStock ?? undefined,
    // imageUrl: caspitProduct.ImageUrl || undefined,
  };
  return invoTrackProduct as Product; // Cast carefully, ensure all required Product fields are handled by consumer
}

// Interface for the payload to send to Caspit API when creating/updating product
interface CaspitProductPayload {
  ProductId?: string | null; // Sent for updates (in URL), potentially for create if app dictates ID, otherwise Caspit generates
  Name: string;
  Description?: string | null;
  CatalogNumber?: string | null;
  PurchasePrice?: number | null;
  SalePrice1?: number | null;
  QtyInStock?: number | null;
  Barcode?: string | null;
  Status?: boolean | null; // Added for activating/deactivating products
  // Optional: Add other fields from the user's Postman example if they are relevant and controllable from the app
  // SerialNumber?: string | null;
  // SupplierCatalogNumber1?: string | null;
  // Status?: boolean | null; // e.g., true for active
  // Warranty?: string | null;
  // CurrencySymbol?: string | null; // Typically "₪" or could be dynamic from settings
  // ChargeVat?: boolean | null; // e.g., true
  // UnitName?: string | null;
  // Class?: string | null;
  // IsPriceIncludeVat?: boolean | null;
}

// --- Server Action to Create or Update a Product in Caspit ---
// Handles both initial creation (POST) and subsequent updates (PUT) based on caspitProductId presence
export async function createOrUpdateCaspitProductAction(
  config: PosConnectionConfig,
  appProduct: Partial<Product> & { userId: string } // appProduct.id is Firestore ID, appProduct.caspitProductId is Caspit's ID
): Promise<{
  success: boolean;
  message: string;
  caspitProductId?: string | null;
}> {
  let token: string;
  try {
    token = await getCaspitToken(config);
  } catch (error: any) {
    console.error(
      "[Caspit Action - createOrUpdateCaspitProduct] Failed to get token:",
      error
    );
    return {
      success: false,
      message: `Failed to get Caspit token: ${error.message}`,
    };
  }

  // Map appProduct to CaspitProductPayload
  const payload: CaspitProductPayload = {
    Name: appProduct.shortName || appProduct.description || "Unnamed Product", // Caspit requires a Name
    Description: appProduct.description || null,
    CatalogNumber: appProduct.catalogNumber || null,
    PurchasePrice: appProduct.unitPrice ?? null,
    SalePrice1: appProduct.salePrice ?? null,
    QtyInStock: appProduct.quantity ?? null,
    Barcode: appProduct.barcode || null,
    ProductId: null, // Initialize ProductId
  };

  const isUpdate = !!appProduct.caspitProductId; // This ID is from Caspit, after a successful sync/creation

  if (isUpdate && appProduct.caspitProductId) {
    // This is an UPDATE operation for an existing Caspit product.
    // The ProductId in the URL will be appProduct.caspitProductId.
    // The ProductId in the payload should also be appProduct.caspitProductId.
    payload.ProductId = appProduct.caspitProductId;
    console.log(
      `[Caspit Action] Preparing UPDATE for Caspit ProductId: ${payload.ProductId}`
    );
  } else if (!isUpdate && appProduct.id) {
    // This is a CREATE operation (or an UPsert if Caspit treats POST with existing ID as update).
    // We will use the Firebase ID (appProduct.id) as the ProductId for Caspit.
    payload.ProductId = appProduct.id; // Use Firestore ID
    console.log(
      `[Caspit Action] Preparing CREATE/UPSERT for Caspit with ProductId (from Firestore ID): ${payload.ProductId}`
    );
  } else {
    // This case should ideally not be reached if appProduct always has an 'id' for new items
    // or 'caspitProductId' for existing ones.
    console.error(
      "[Caspit Action] Critical error: Missing necessary ID (appProduct.id for new, or appProduct.caspitProductId for update) to send to Caspit."
    );
    return {
      success: false,
      message:
        "Internal error: Missing product identifier for Caspit operation.",
    };
  }

  // Ensure no null ProductId is sent if it's absolutely required by Caspit for both POST and PUT in payload
  if (!payload.ProductId) {
    console.error(
      `[Caspit Action] Critical error: payload.ProductId is null or undefined before sending. isUpdate: ${isUpdate}, appProduct.id: ${appProduct.id}, appProduct.caspitProductId: ${appProduct.caspitProductId}`
    );
    return {
      success: false,
      message:
        "Internal error: ProductId for Caspit is missing in payload before sending.",
    };
  }

  // For PUT, Caspit's ProductId will be in the URL.
  // For POST, Caspit uses the ProductId from the payload.
  const url =
    isUpdate && appProduct.caspitProductId
      ? `${CASPIT_API_BASE_URL}/Products/${appProduct.caspitProductId}?token=${token}` // PUT URL uses Caspit's known ID
      : `${CASPIT_API_BASE_URL}/Products?token=${token}`; // POST URL

  // If Caspit performs an "upsert" on POST with a ProductId in the payload,
  // the distinction between POST and PUT might be less critical for "creation" vs "update" logic,
  // but it's good practice to use PUT for explicit updates to existing resources.
  const method = isUpdate && appProduct.caspitProductId ? "PUT" : "POST";

  console.log(
    `[Caspit Action - createOrUpdateCaspitProduct] Method: ${method}, URL: ${url}`
  );
  console.log(
    `[Caspit Action - createOrUpdateCaspitProduct] Payload being sent to Caspit:`,
    JSON.stringify(payload, null, 2)
  );

  try {
    const response = await fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json", // Important for Caspit to return JSON
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log(
      `[Caspit Action - createOrUpdateCaspitProduct] Raw response status: ${response.status}`
    );
    console.log(
      `[Caspit Action - createOrUpdateCaspitProduct] Raw response text: ${responseText}`
    );

    if (!response.ok) {
      // Improved error handling for API issues
      let errorDetails = responseText;
      try {
        const jsonError = JSON.parse(responseText);
        errorDetails = jsonError.Message || jsonError.message || responseText;
      } catch (e) {
        /* Not a JSON error response, use raw text */
      }
      console.error(
        `[Caspit Action - createOrUpdateCaspitProduct] Caspit API error: ${response.status} - ${errorDetails}`
      );
      throw new Error(
        `Caspit API request failed (${response.status}): ${errorDetails}`
      );
    }

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error(
        "[Caspit Action - createOrUpdateCaspitProduct] Failed to parse Caspit response as JSON:",
        responseText
      );
      throw new Error(
        "Caspit API returned non-JSON response for product operation."
      );
    }

    // Caspit might return the full product object or just a success message.
    // We need its ProductId if it was a create operation.
    const returnedCaspitProductId =
      responseData?.ProductId ||
      responseData?.id ||
      responseData?.ID ||
      payload.ProductId || // If Caspit doesn't echo it back, assume the one we sent is used
      (isUpdate ? appProduct.caspitProductId : null);

    if (!returnedCaspitProductId && !isUpdate) {
      console.error(
        "[Caspit Action - createOrUpdateCaspitProduct] Caspit ProductId not found in response for a new product.",
        responseData
      );
      throw new Error(
        "Caspit API did not return a ProductId for the created product."
      );
    }

    console.log(
      `[Caspit Action - createOrUpdateCaspitProduct] Successfully ${
        isUpdate ? "updated" : "created"
      } product. Caspit ID: ${returnedCaspitProductId}`
    );
    return {
      success: true,
      message: `Product ${
        isUpdate ? "updated" : "created"
      } successfully in Caspit.`,
      caspitProductId: returnedCaspitProductId,
    };
  } catch (error: any) {
    console.error(
      `[Caspit Action - createOrUpdateCaspitProduct] Error during ${method} product: `,
      error
    );
    return {
      success: false,
      message: `Failed to ${method} product in Caspit: ${
        error.message || "Unknown error."
      }`,
    };
  }
}

// --- Server Action to Update an Existing Product in Caspit ---
export async function updateCaspitProductAction(
  config: PosConnectionConfig,
  appProduct: Product // Expect a full Product object from Firestore, which includes caspitProductId
): Promise<{
  success: boolean;
  message: string;
  caspitProductId?: string | null;
}> {
  if (!appProduct.caspitProductId) {
    console.error(
      "[Caspit Action - updateCaspitProduct] Missing caspitProductId. Cannot update product in Caspit without it.",
      appProduct
    );
    return {
      success: false,
      message:
        "Failed to update product in Caspit: Caspit Product ID is missing.",
      caspitProductId: null, // Explicitly return null for caspitProductId on failure
    };
  }

  console.log(
    `[Caspit Action] Preparing UPDATE for Caspit with ProductId: ${appProduct.caspitProductId}`
  );

  try {
    const token = await getCaspitToken(config);
    const url = `${CASPIT_API_BASE_URL}/Products/${appProduct.caspitProductId}?token=${token}`;

    const payload: CaspitProductPayload = {
      ProductId: appProduct.caspitProductId, // Must be in payload as well
      Name: appProduct.shortName || appProduct.description || "N/A",
      Description: appProduct.description || appProduct.shortName || null,
      CatalogNumber: appProduct.catalogNumber || null,
      PurchasePrice: appProduct.unitPrice,
      SalePrice1:
        appProduct.salePrice === null ? undefined : appProduct.salePrice, // Ensure salePrice is handled (null vs undefined)
      QtyInStock: appProduct.quantity, // Assuming this is the current stock level from Firestore
      Barcode: appProduct.barcode || null,
      Status: true, // Default to active for updates, specific deactivation will use another function or flag
      // TODO: Add any other fields that Caspit requires for a PUT request, based on their API docs or Postman examples
      // e.g. CurrencySymbol, ChargeVat, IsPriceIncludeVat, etc. - assuming Caspit defaults are fine if not specified
    };

    console.log(
      `[Caspit Action - updateCaspitProduct] Method: PUT, URL: ${url}`
    );
    console.log(
      "[Caspit Action - updateCaspitProduct] Payload being sent to Caspit:",
      JSON.stringify(payload, null, 2)
    );

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log(
      `[Caspit Action - updateCaspitProduct] Raw response status: ${response.status}`
    );
    console.log(
      `[Caspit Action - updateCaspitProduct] Raw response text: ${responseText}`
    );

    if (!response.ok) {
      // Log the full payload and response for easier debugging on failure
      console.error(
        "[Caspit Action - updateCaspitProduct] Update failed. Payload:",
        payload,
        "Response:",
        responseText
      );
      throw new Error(
        `Caspit API PUT request failed with status ${response.status}. Response: ${responseText}`
      );
    }

    // Caspit PUT for product update might return 200 OK with the updated product, or 204 No Content
    // If it returns the product, we could parse it, but for now, success is enough.
    let updatedCaspitProductId = appProduct.caspitProductId;
    try {
      const jsonResponse = JSON.parse(responseText);
      updatedCaspitProductId =
        jsonResponse?.ProductId || appProduct.caspitProductId;
    } catch (e) {
      console.warn(
        "[Caspit Action - updateCaspitProduct] Response was not JSON or ProductId missing, using original caspitProductId."
      );
    }

    console.log(
      `[Caspit Action - updateCaspitProduct] Successfully updated product. Caspit ID: ${updatedCaspitProductId}`
    );
    return {
      success: true,
      message: `Product ${updatedCaspitProductId} updated successfully in Caspit.`,
      caspitProductId: updatedCaspitProductId,
    };
  } catch (error: any) {
    console.error(
      `[Caspit Action - updateCaspitProduct] Error updating product ${appProduct.caspitProductId} in Caspit: `,
      error.message
    );
    return {
      success: false,
      message:
        error.message ||
        `An unknown error occurred while updating product ${appProduct.caspitProductId} in Caspit.`,
      caspitProductId: appProduct.caspitProductId, // Return existing ID on failure to update
    };
  }
}

// --- Server Action to Deactivate a Product in Caspit ---
export async function deactivateCaspitProductAction(
  config: PosConnectionConfig,
  appProduct: Product // Expect a full Product object from Firestore, including caspitProductId
): Promise<{
  success: boolean;
  message: string;
}> {
  if (!appProduct.caspitProductId) {
    console.error(
      "[Caspit Action - deactivateCaspitProduct] Missing caspitProductId. Cannot deactivate product in Caspit without it.",
      appProduct
    );
    return {
      success: false,
      message:
        "Failed to deactivate product in Caspit: Caspit Product ID is missing.",
    };
  }

  console.log(
    `[Caspit Action] Preparing DEACTIVATE for Caspit with ProductId: ${appProduct.caspitProductId}`
  );

  try {
    const token = await getCaspitToken(config);
    const url = `${CASPIT_API_BASE_URL}/Products/${appProduct.caspitProductId}?token=${token}`;

    // For deactivation, we still need to send the full payload, but with Status: false
    const payload: CaspitProductPayload = {
      ProductId: appProduct.caspitProductId,
      Name: appProduct.shortName || appProduct.description || "N/A",
      Description: appProduct.description || appProduct.shortName || null,
      CatalogNumber: appProduct.catalogNumber || null,
      PurchasePrice: appProduct.unitPrice,
      SalePrice1:
        appProduct.salePrice === null ? undefined : appProduct.salePrice,
      QtyInStock: appProduct.quantity, // Current quantity
      Barcode: appProduct.barcode || null,
      Status: false, // Key change for deactivation
      // Include other fields as Caspit expects the full product representation for PUT
    };

    console.log(
      `[Caspit Action - deactivateCaspitProduct] Method: PUT, URL: ${url}`
    );
    console.log(
      "[Caspit Action - deactivateCaspitProduct] Payload for deactivation:",
      JSON.stringify(payload, null, 2)
    );

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log(
      `[Caspit Action - deactivateCaspitProduct] Raw response status: ${response.status}`
    );
    console.log(
      `[Caspit Action - deactivateCaspitProduct] Raw response text: ${responseText}`
    );

    if (!response.ok) {
      console.error(
        "[Caspit Action - deactivateCaspitProduct] Deactivation failed. Payload:",
        payload,
        "Response:",
        responseText
      );
      throw new Error(
        `Caspit API PUT request for deactivation failed with status ${response.status}. Response: ${responseText}`
      );
    }

    console.log(
      `[Caspit Action - deactivateCaspitProduct] Successfully deactivated product. Caspit ID: ${appProduct.caspitProductId}`
    );
    return {
      success: true,
      message: `Product ${appProduct.caspitProductId} deactivated successfully in Caspit.`,
    };
  } catch (error: any) {
    console.error(
      `[Caspit Action - deactivateCaspitProduct] Error deactivating product ${appProduct.caspitProductId} in Caspit: `,
      error.message
    );
    return {
      success: false,
      message:
        error.message ||
        `An unknown error occurred while deactivating product ${appProduct.caspitProductId} in Caspit.`,
    };
  }
}

// --- Server Action to Sync Products (Fetch from Caspit) ---
export async function syncCaspitProductsAction(
  config: PosConnectionConfig
): Promise<SyncResult> {
  let token: string;
  try {
    console.log("[Caspit Action - syncProducts] Fetching fresh token...");
    token = await getCaspitToken(config);
    console.log(
      "[Caspit Action - syncProducts] Fresh token obtained for product sync."
    );
  } catch (error: any) {
    return {
      success: false,
      message: `Product sync failed: Could not get token. Check server logs.`,
    };
  }

  let allAppProducts: Product[] = [];
  let currentPage = 1;
  let hasMore = true;
  let totalSynced = 0;
  const BATCH_SIZE = 100; // Caspit default page size seems to be 100, confirm this or make configurable

  try {
    while (hasMore) {
      const url = `${CASPIT_API_BASE_URL}/Products?token=${token}&page=${currentPage}&size=${BATCH_SIZE}`;
      console.log(
        `[Caspit Action - syncProducts] Fetching page ${currentPage} from ${url}`
      );
      const response = await fetch(url, {
        headers: {
          Accept: "application/json", // Important for Caspit to return JSON
        },
      });
      const responseText = await response.text();

      if (!response.ok) {
        console.error(
          `[Caspit Action - syncProducts] Caspit API request failed with status ${response.status}. URL: ${url}. Response: ${responseText}`
        );
        throw new Error(
          `Caspit API products request failed (${response.status}). Check server logs.`
        );
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error(
          "[Caspit Action - syncProducts] Failed to parse Caspit products response as JSON:",
          responseText
        );
        throw new Error(
          "Caspit API returned non-JSON response for products list."
        );
      }

      if (!data || typeof data !== "object" || !Array.isArray(data.Results)) {
        console.error(
          `[Caspit Action - syncProducts] Invalid product data structure received from Caspit API. Expected object with 'Results' array. Raw response: ${responseText}`
        );
        throw new Error(
          `Caspit API: Invalid product data structure. Check server logs.`
        );
      }

      const caspitProductsPage: any[] = data.Results;
      const mappedProducts = caspitProductsPage
        .map(mapCaspitProductToAppProduct) // Use the renamed mapping function
        .filter((p): p is Product => p !== null);

      allAppProducts = allAppProducts.concat(mappedProducts);
      totalSynced += mappedProducts.length;

      // Caspit pagination check - this is an assumption, verify with API docs
      // Common patterns: data.HasMore, data.NextPage, data.TotalPages, data.CurrentPage
      if (
        caspitProductsPage.length < BATCH_SIZE ||
        (data.TotalPages && currentPage >= data.TotalPages)
      ) {
        hasMore = false;
      } else {
        currentPage++;
      }

      // Safety break for runaway loops, e.g. if TotalPages is not reliable
      if (currentPage > (data.TotalPages || 100)) {
        console.warn(
          `[Caspit Action - syncProducts] Reached page limit (${currentPage}). Stopping sync.`
        );
        hasMore = false;
      }
    }

    console.log(
      `[Caspit Action - syncProducts] Returning ${totalSynced} products after mapping.`
    );
    return {
      success: true,
      message: `Successfully fetched and mapped ${totalSynced} products from Caspit.`,
      itemsSynced: totalSynced,
      products: allAppProducts, // These are partial app products, need to be merged with Firestore data
    };
  } catch (error: any) {
    console.error("[Caspit Action - syncProducts] Product sync failed:", error);
    return {
      success: false,
      message: `Product sync failed: ${
        error.message || "Unknown error. Check server logs."
      }`,
      products: [],
    };
  }
}

// --- Server Action to Sync Sales ---
export async function syncCaspitSalesAction(
  config: PosConnectionConfig
): Promise<SyncResult> {
  console.log("[Caspit Action - syncSales] Starting sales sync...");
  try {
    const token = await getCaspitToken(config);
    const url = `${CASPIT_API_BASE_URL}/Invoices`; // Assuming sales are invoices
    console.log(
      `[Caspit Action - syncSales] Fetching sales from Caspit API: ${url}`
    );

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Caspit Action - syncSales] Caspit API error: ${response.status} ${response.statusText}`,
        errorText
      );
      throw new Error(
        `Failed to fetch sales from Caspit: ${response.statusText}`
      );
    }

    const salesData = await response.json();
    console.log(
      `[Caspit Action - syncSales] Received ${salesData.length} sales records from Caspit.`
    );
    // Here you would typically process and save the sales data
    // For now, we'll just log it.
    console.log("Sales data:", salesData);

    return {
      success: true,
      message: `Successfully synced ${salesData.length} sales records.`,
      data: salesData, // Or a summary
    };
  } catch (error: any) {
    console.error("[Caspit Action - syncSales] Error:", error.message);
    return {
      success: false,
      message: `An error occurred during sales sync: ${error.message}`,
    };
  }
}

// --- Server Action to Sync Suppliers ---
export async function syncCaspitSuppliersAction(
  config: PosConnectionConfig
): Promise<SyncResult> {
  console.log("[Caspit Action - syncSuppliers] Starting supplier sync...");
  try {
    const token = await getCaspitToken(config);
    const url = `${CASPIT_API_BASE_URL}/Suppliers`; // Endpoint assumption
    console.log(
      `[Caspit Action - syncSuppliers] Fetching suppliers from Caspit API: ${url}`
    );

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Caspit Action - syncSuppliers] Caspit API error: ${response.status} ${response.statusText}`,
        errorText
      );
      throw new Error(
        `Failed to fetch suppliers from Caspit: ${response.statusText}`
      );
    }

    const suppliersData = await response.json();
    console.log(
      `[Caspit Action - syncSuppliers] Received ${suppliersData.length} supplier records from Caspit.`
    );
    // TODO: Map to app's Supplier type and save to DB
    console.log("Suppliers data:", suppliersData);

    return {
      success: true,
      message: `Successfully synced ${suppliersData.length} supplier records.`,
      data: suppliersData,
    };
  } catch (error: any) {
    console.error("[Caspit Action - syncSuppliers] Error:", error.message);
    return {
      success: false,
      message: `An error occurred during supplier sync: ${error.message}`,
    };
  }
}

// --- Server Action to Sync Documents ---
export async function syncCaspitDocumentsAction(
  config: PosConnectionConfig
): Promise<SyncResult> {
  console.log("[Caspit Action - syncDocuments] Starting document sync...");
  try {
    const token = await getCaspitToken(config);
    const invoicesUrl = `${CASPIT_API_BASE_URL}/Invoices`;
    console.log(
      `[Caspit Action - syncDocuments] Fetching invoices from Caspit API: ${invoicesUrl}`
    );

    const response = await fetch(invoicesUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Caspit Action - syncDocuments] Caspit API error: ${response.status} ${response.statusText}`,
        errorText
      );
      throw new Error(
        `Failed to fetch documents from Caspit: ${response.statusText}`
      );
    }

    const documentsData = await response.json();
    console.log(
      `[Caspit Action - syncDocuments] Received ${documentsData.length} document records from Caspit.`
    );
    // TODO: Map to app's Document type and save to DB
    console.log("Documents data:", documentsData);

    return {
      success: true,
      message: `Successfully synced ${documentsData.length} document records.`,
      data: documentsData,
    };
  } catch (error: any) {
    console.error("[Caspit Action - syncDocuments] Error:", error.message);
    return {
      success: false,
      message: `An error occurred during document sync: ${error.message}`,
    };
  }
}

// --- PAYLOAD INTERFACES ---

// Payload for creating/updating a contact (Supplier/Customer) in Caspit
interface CaspitContactPayload {
  Id?: string | null;
  Name: string;
  OsekMorshe?: string | null; // Tax ID
  ContactType: number; // 0 for Customer, 1 for Supplier, 2 for CustomerAndSupplier
  Email?: string | null;
  Address1?: string | null;
  City?: string | null;
  MobilePhone?: string | null;
  // Include other fields from CaspitContact as needed
}

// Payload for creating a document in Caspit
interface CaspitDocumentPayload extends CaspitDocument {
  // This can extend the main type and override/add fields as needed for creation payloads
}

// A helper function to convert our Payment Term string to Caspit's numeric codes
const convertPaymentTermsToCaspit = (
  termString: string | null | undefined
): { PaymentTerms?: number; PaymentTermsDays?: number } => {
  if (!termString) return {};

  if (termString.toLowerCase().includes("immediate"))
    return { PaymentTerms: 2 }; // Cash
  if (termString.toLowerCase().includes("eom")) return { PaymentTerms: 1 }; // "Shotef"
  if (termString.toLowerCase().includes("net 30"))
    return { PaymentTerms: 3, PaymentTermsDays: 30 }; // Days
  if (termString.toLowerCase().includes("net 60"))
    return { PaymentTerms: 3, PaymentTermsDays: 60 }; // Days
  if (termString.toLowerCase().includes("net 90"))
    return { PaymentTerms: 3, PaymentTermsDays: 90 }; // Days

  // Basic logic for "Shotef+X"
  const shotefPlusMatch = termString.match(/(\d+)/);
  if (shotefPlusMatch && shotefPlusMatch[1]) {
    return {
      PaymentTerms: 3,
      PaymentTermsDays: parseInt(shotefPlusMatch[1], 10),
    };
  }

  return {};
};

export const createOrUpdateCaspitContactAction = async (
  config: PosConnectionConfig,
  supplier: Supplier
): Promise<{
  success: boolean;
  caspitAccountId?: string;
  message?: string;
}> => {
  try {
    console.log(
      `[Caspit Action] Starting create/update for contact: ${supplier.name}`
    );
    const token = await getCaspitToken(config);
    if (!token) throw new Error("Could not retrieve Caspit auth token.");

    const url = `${CASPIT_API_BASE_URL}/Contacts?token=${token}`;
    const method = "POST"; // Caspit uses POST for both create and update (upsert)

    const caspitPaymentTerms = convertPaymentTermsToCaspit(
      supplier.paymentTerms
    );

    const payload = {
      // Key fields
      ContactId: supplier.caspitAccountId || supplier.id, // Use existing Caspit ID or fall back to Firestore ID
      ContactType: 2, // 1 for Supplier, 2 for Customer+Supplier. 2 is safer.

      // Main identifiers
      BusinessName: supplier.name,
      OsekMorshe: supplier.osekMorshe || null,

      // Contact Person and Details
      Name: supplier.contactPersonName || supplier.name, // Use specific contact person or fallback to business name
      Email: supplier.email || null,
      Phone: supplier.phone || null,
      Mobile: supplier.mobile || null,

      // Address
      Address1: supplier.address?.street || null,
      City: supplier.address?.city || null,
      PostalCode: supplier.address?.postalCode || null,
      Country: supplier.address?.country || "ישראל",

      // Payment and invoicing
      ...caspitPaymentTerms,
      InvoiceComment: supplier.invoiceComment || null,

      // Bank Details
      BankAcctNumber: supplier.bankDetails?.accountNumber || null,
      BankAcctBranch: supplier.bankDetails?.branch || null,
      BankAcctBankId: supplier.bankDetails?.bankId || null,
    };

    console.log(
      `[Caspit Action - createOrUpdateContact] Sending request to Caspit. Method: ${method}, URL: ${url}`
    );
    console.log(
      `[Caspit Action - createOrUpdateContact] Payload:`,
      JSON.stringify(payload, null, 2)
    );

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Caspit API request failed (${response.status}): ${responseText}`
      );
    }

    // Caspit returns the object on success, which includes the ID.
    const result = JSON.parse(responseText);
    const returnedId = result.ContactId;

    console.log(
      `[Caspit Action] Successfully created/updated contact. Caspit ID: ${returnedId}`
    );

    return { success: true, caspitAccountId: returnedId };
  } catch (error: any) {
    console.error(
      `[Caspit Action] Error syncing contact ${supplier.name}: ${error.message}`
    );
    return { success: false, message: error.message };
  }
};

// --- Server Action to Create a Document in Caspit ---
export async function createCaspitDocumentAction(
  config: PosConnectionConfig,
  document: InvoiceHistoryItem,
  products: Product[],
  caspitSupplierId: string
): Promise<{
  success: boolean;
  message: string;
  caspitPurchaseDocId?: string;
}> {
  console.log(`[Caspit Action] Starting create for document: ${document.id}`);
  try {
    const token = await getCaspitToken(config);
    if (!token) {
      throw new Error("Failed to obtain Caspit token.");
    }

    const trxTypeId =
      document.documentType === "invoice"
        ? CASPIT_TRX_TYPE_IDS.PURCHASE_INVOICE
        : CASPIT_TRX_TYPE_IDS.GOODS_RECEIVED_VOUCHER;

    // --- START: Improved Date Logic ---
    const dateSource = document.invoiceDate || document.uploadTime;
    let finalDate: string;

    if (dateSource instanceof Timestamp) {
      finalDate = dateSource.toDate().toISOString();
    } else if (typeof dateSource === "string") {
      const parsedDate = new Date(dateSource);
      // Use the parsed date only if it's valid
      finalDate = !isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();
    } else {
      // Fallback for null, undefined, or FieldValue
      finalDate = new Date().toISOString();
    }
    // --- END: Improved Date Logic ---

    const caspitDocumentPayload: CaspitDocumentPayload = {
      DocumentId: document.id, // Using our internal ID as the reference
      TrxTypeId: trxTypeId,
      Date: finalDate, // Use the safer, finalDate variable
      CustomerId: caspitSupplierId,
      CustomerBusinessName: document.supplierName || "N/A",
      Details: `Document from InvoTrack: ${document.originalFileName}`,
      DocumentLines: products.map((p) => ({
        ProductName: p.description,
        ProductCatalogNumber: p.catalogNumber,
        UnitPrice: p.unitPrice,
        Qty: p.quantity,
        ExtendedPrice: p.lineTotal,
        ChargeVAT: true, // Assuming VAT is always applicable for purchase docs
      })),
      Total: document.totalAmount || 0,
    };

    console.log(
      `[Caspit Action - createDocument] Sending request to Caspit. Method: POST, URL: ${CASPIT_API_BASE_URL}/Documents?token=${token}`
    );
    console.log(
      `[Caspit Action - createDocument] Payload:`,
      JSON.stringify(caspitDocumentPayload, null, 2)
    );

    const response = await fetch(
      `${CASPIT_API_BASE_URL}/Documents?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(caspitDocumentPayload),
      }
    );

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Caspit API request failed (${response.status}): ${responseText}`
      );
    }

    // The response from Caspit for creating a document is the new document's ID.
    // It's often returned as a simple string, sometimes with quotes.
    const caspitPurchaseDocId = responseText.replace(/"/g, "");

    console.log(
      `[Caspit Action] Successfully created document. Caspit Purchase Doc ID: ${caspitPurchaseDocId}`
    );
    return {
      success: true,
      message: "Document created successfully in Caspit.",
      caspitPurchaseDocId: caspitPurchaseDocId,
    };
  } catch (error: any) {
    console.error(
      `[Caspit Action] Error syncing document ${document.id}:`,
      error
    );
    return {
      success: false,
      message: error.message,
    };
  }
}

/**
 * Creates a new supplier expense in Caspit using the /api/v1/Expenses endpoint.
 * This is used for invoices and similar documents that represent an expense.
 *
 * @param config The POS connection configuration.
 * @param document The internal document object from our app.
 * @param caspitSupplierId The Caspit ID for the supplier.
 * @returns A promise that resolves with the result of the operation.
 */
export async function createCaspitExpenseAction(
  config: PosConnectionConfig,
  document: InvoiceHistoryItem,
  caspitSupplierId: string
): Promise<{
  success: boolean;
  message: string;
  caspitExpenseId?: string;
}> {
  console.log(
    `[Caspit Action] Starting create for expense document: ${document.id}`
  );
  try {
    const token = await getCaspitToken(config);
    if (!token) {
      throw new Error("Failed to obtain Caspit token.");
    }

    const dateSource = document.invoiceDate || document.uploadTime;
    let finalDate: string;

    if (dateSource instanceof Timestamp) {
      finalDate = dateSource.toDate().toISOString().split("T")[0]; // YYYY-MM-DD
    } else if (typeof dateSource === "string") {
      const parsedDate = new Date(dateSource);
      finalDate = !isNaN(parsedDate.getTime())
        ? parsedDate.toISOString().split("T")[0] // YYYY-MM-DD
        : new Date().toISOString().split("T")[0];
    } else {
      finalDate = new Date().toISOString().split("T")[0];
    }

    // Use the document's final Firestore ID, which is shorter and more reliable
    const expenseIdForCaspit = document.id.startsWith("pending-inv-")
      ? document.id.substring("pending-inv-".length)
      : document.id;

    if (expenseIdForCaspit.length > 50) {
      console.warn(
        `[Caspit Action] Generated ExpenseId is too long (${expenseIdForCaspit.length} chars). Truncating to 50.`
      );
    }

    // --- Start: Calculate VAT amounts for balanced request ---
    const totalAmount = document.totalAmount || 0;
    // Assuming 17% VAT. This could be made configurable in user settings in the future.
    const VAT_RATE = 18.0;
    const totalNoVat = totalAmount / (1 + VAT_RATE / 100);
    const vatAmount = totalAmount - totalNoVat;
    // --- End: Calculate VAT amounts ---

    const expensePayload: CaspitExpense = {
      ExpenseId: expenseIdForCaspit.substring(0, 50),
      Date: finalDate,
      SupplierId: caspitSupplierId,
      TrxCodeNumber: 3100, // General Expenses
      Reference: document.invoiceNumber || "",
      Details: `Document from InvoTrack: ${document.originalFileName || "N/A"}`,
      Total: totalAmount,
      TotalNoVat: parseFloat(totalNoVat.toFixed(2)),
      Vat: parseFloat(vatAmount.toFixed(2)),
      VatRate: VAT_RATE,
      Flag: 0,
    };

    const url = `${CASPIT_API_BASE_URL}/Expenses`;
    console.log(
      `[Caspit Action - createExpense] Sending request to Caspit. Method: POST, URL: ${url}`
    );
    console.log(
      `[Caspit Action - createExpense] Payload:`,
      JSON.stringify(expensePayload, null, 2)
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Caspit-Token": token,
      },
      body: JSON.stringify(expensePayload),
    });

    // Per documentation, a successful response has an empty body.
    if (response.status === 201 || response.status === 200) {
      console.log(
        `[Caspit Action] Successfully created/updated expense for document ID: ${document.id}`
      );
      return {
        success: true,
        message: "Expense created successfully in Caspit.",
        caspitExpenseId: document.id,
      };
    } else {
      const responseText = await response.text();
      throw new Error(
        `Caspit API request failed (${response.status}): ${responseText}`
      );
    }
  } catch (error: any) {
    console.error(
      `[Caspit Action] Error syncing expense for document ${document.id}:`,
      error
    );
    return {
      success: false,
      message: error.message,
    };
  }
}
