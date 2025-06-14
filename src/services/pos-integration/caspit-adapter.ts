/**
 * @fileOverview Implementation for the Caspit POS system adapter.
 * Contains all business logic for interacting with Caspit API.
 */

import type {
  IPosSystemAdapter,
  PosConnectionConfig,
  SyncResult,
  Product,
  Supplier,
  PosDocument,
  OperationResult,
  PosConfigField,
} from "./pos-adapter.interface";

// Types imported from backend services
import type { InvoiceHistoryItem } from "@/services/types";
import type { CaspitContact, CaspitDocument } from "./caspit-types";
import { Timestamp } from "firebase/firestore";

// Caspit-specific constants
const CASPIT_API_BASE_URL = "https://app.caspit.biz/api/v1";
const CASPIT_TRX_TYPE_IDS = {
  PURCHASE_INVOICE: 300, // חשבונית רכש
  GOODS_RECEIVED_VOUCHER: 305, // תעודת כניסה למלאי (תעודת משלוח)
};

/**
 * Interface for Caspit product payload
 */
interface CaspitProductPayload {
  ProductId?: string | null;
  Name: string;
  Description?: string | null;
  CatalogNumber?: string | null;
  PurchasePrice?: number | null;
  SalePrice1?: number | null;
  QtyInStock?: number | null;
  Barcode?: string | null;
  Status?: boolean | null;
}

/**
 * Interface for Caspit contact payload
 */
interface CaspitContactPayload {
  Id?: string | null;
  Name: string;
  OsekMorshe?: string | null;
  ContactType: number;
  Email?: string | null;
  Address1?: string | null;
  City?: string | null;
  MobilePhone?: string | null;
}

/**
 * Caspit adapter implementation
 */
class CaspitAdapter implements IPosSystemAdapter {
  readonly systemId = "caspit";
  readonly systemName = "Caspit (כספית)";

  /**
   * Get configuration schema for Caspit
   */
  getConfigSchema(): PosConfigField[] {
    return [
      {
        key: "user",
        labelKey: "pos_config_caspit_user",
        type: "text",
        tooltipKey: "pos_config_caspit_user_tooltip",
        required: true,
      },
      {
        key: "pwd",
        labelKey: "pos_config_caspit_pwd",
        type: "password",
        tooltipKey: "pos_config_caspit_pwd_tooltip",
        required: true,
      },
      {
        key: "osekMorshe",
        labelKey: "pos_config_caspit_osek",
        type: "text",
        tooltipKey: "pos_config_caspit_osek_tooltip",
        required: true,
        validation: {
          pattern: "^[0-9]{9}$",
        },
      },
    ];
  }

  /**
   * Get available document types
   */
  getAvailableDocumentTypes(): string[] {
    return ["invoice", "deliveryNote"];
  }

  /**
   * Validate configuration
   */
  async validateConfig(config: PosConnectionConfig): Promise<{
    valid: boolean;
    errors?: { field: string; message: string }[];
  }> {
    const errors: { field: string; message: string }[] = [];

    if (!config.user) {
      errors.push({ field: "user", message: "Username is required" });
    }
    if (!config.pwd) {
      errors.push({ field: "pwd", message: "Password is required" });
    }
    if (!config.osekMorshe) {
      errors.push({ field: "osekMorshe", message: "Business ID is required" });
    } else if (!/^[0-9]{9}$/.test(config.osekMorshe)) {
      errors.push({
        field: "osekMorshe",
        message: "Business ID must be 9 digits",
      });
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Get Caspit API token
   * @private
   */
  private async getCaspitToken(config: PosConnectionConfig): Promise<string> {
    const { user, pwd, osekMorshe } = config;
    if (!user || !pwd || !osekMorshe) {
      throw new Error(
        "Missing Caspit credentials (user, pwd, osekMorshe) in configuration."
      );
    }

    const url = `${CASPIT_API_BASE_URL}/Token?user=${encodeURIComponent(
      user
    )}&pwd=${encodeURIComponent(pwd)}&osekMorshe=${encodeURIComponent(
      osekMorshe
    )}`;
    console.log("[CaspitAdapter] Requesting token from:", url);

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
      console.log(`[CaspitAdapter] Token response status: ${response.status}`);

      if (!response.ok) {
        const errorMessage = `Caspit API request failed with status ${response.status}`;
        console.error(`[CaspitAdapter] ${errorMessage}. Response: ${responseText}`);
        throw new Error(errorMessage);
      }

      let accessToken: string | null = null;

      // Try to parse as JSON first
      if (responseText.trim().startsWith("{")) {
        try {
          const data = JSON.parse(responseText);
          accessToken =
            data?.AccessToken || data?.accessToken || data?.Token || data?.token;
        } catch (jsonError) {
          console.warn(
            "[CaspitAdapter] Failed to parse token response as JSON"
          );
        }
      }

      // If not JSON, treat as plain text token
      if (!accessToken) {
        if (
          typeof responseText === "string" &&
          responseText.length >= 20 &&
          /^[a-zA-Z0-9.-_]+$/.test(responseText.replace(/^"+|"+$/g, ""))
        ) {
          accessToken = responseText.trim().replace(/^"+|"+$/g, "");
          console.log(
            "[CaspitAdapter] Interpreted response as plain text token."
          );
        } else {
          throw new Error(
            "Caspit API returned an unparsable response or not a token."
          );
        }
      }

      if (!accessToken || typeof accessToken !== "string" || accessToken.trim() === "") {
        throw new Error("Caspit API: Invalid token response.");
      }

      accessToken = accessToken.replace(/^"+|"+$/g, "");
      console.log("[CaspitAdapter] Successfully obtained token");
      return accessToken;
    } catch (error: any) {
      console.error("[CaspitAdapter] Error getting token:", error.message);
      throw new Error(`Failed to get Caspit token: ${error.message}`);
    }
  }

  /**
   * Map Caspit product to application product
   * @private
   */
  private mapCaspitProductToAppProduct(caspitProduct: any): Product | null {
    const productId = caspitProduct.ProductId;
    const catalogNumber = caspitProduct.CatalogNumber || "";
    const description = caspitProduct.Name || caspitProduct.Description || "";
    const unitPrice = caspitProduct.PurchasePrice ?? 0;
    const salePrice = caspitProduct.SalePrice1 ?? undefined;
    const quantityInStock = caspitProduct.QtyInStock ?? 0;

    if (!productId && !catalogNumber && !description) {
      console.warn(
        "[CaspitAdapter] Skipping product due to missing identifiers:",
        caspitProduct
      );
      return null;
    }

    const product: Product = {
      catalogNumber: catalogNumber || "",
      description: description || "No Description",
      quantity: quantityInStock,
      unitPrice: unitPrice,
      salePrice: salePrice,
      lineTotal: quantityInStock * unitPrice,
      externalIds: {
        caspit: productId,
      },
    };

    return product;
  }

  /**
   * Convert payment terms to Caspit format
   * @private
   */
  private convertPaymentTermsToCaspit(
    termString: string | null | undefined
  ): { PaymentTerms?: number; PaymentTermsDays?: number } => {
    if (!termString || termString === "immediate") {
      return { PaymentTerms: 1, PaymentTermsDays: 0 };
    }
    if (termString === "endOfMonth" || termString === "eom") {
      return { PaymentTerms: 5, PaymentTermsDays: 0 };
    }
    if (termString === "endOfMonthPlus45" || termString === "eom+45") {
      return { PaymentTerms: 7, PaymentTermsDays: 45 };
    }
    const daysMatch = termString.match(/^(\d+)days?$/);
    if (daysMatch) {
      const days = parseInt(daysMatch[1], 10);
      if (days === 30) return { PaymentTerms: 2, PaymentTermsDays: 30 };
      if (days === 60) return { PaymentTerms: 3, PaymentTermsDays: 60 };
      if (days === 90) return { PaymentTerms: 4, PaymentTermsDays: 90 };
      return { PaymentTerms: 6, PaymentTermsDays: days };
    }
    const shomitMatch = termString.match(/^shomit\+?(\d+)?$/);
    if (shomitMatch) {
      const days = shomitMatch[1] ? parseInt(shomitMatch[1], 10) : 0;
      return { PaymentTerms: 5, PaymentTermsDays: days };
    }
    return { PaymentTerms: 1, PaymentTermsDays: 0 };
  }

  // --- Connection Test ---
  async testConnection(
    config: PosConnectionConfig
  ): Promise<{ success: boolean; message: string }> {
    console.log(`[CaspitAdapter] Testing connection with config:`, config);
    try {
      await this.getCaspitToken(config);
      return { success: true, message: "Connection successful!" };
    } catch (error: any) {
      console.error("[CaspitAdapter] Connection test failed:", error);
      return {
        success: false,
        message: `Connection test failed: ${error.message}`,
      };
    }
  }

  // --- Product Operations ---

  async createOrUpdateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult<{ externalId: string }>> {
    let token: string;
    try {
      token = await this.getCaspitToken(config);
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to authenticate: ${error.message}`,
      };
    }

    const caspitProductId = product.externalIds?.caspit;
    const isUpdate = !!caspitProductId;

    const payload: CaspitProductPayload = {
      Name: product.description || "Unnamed Product",
      Description: product.description || null,
      CatalogNumber: product.catalogNumber || null,
      PurchasePrice: product.unitPrice ?? null,
      SalePrice1: product.salePrice ?? null,
      QtyInStock: product.quantity ?? null,
      Barcode: null, // Add if product has barcode field
      ProductId: caspitProductId || product.id || null,
    };

    const url = isUpdate
      ? `${CASPIT_API_BASE_URL}/Products/${caspitProductId}?token=${token}`
      : `${CASPIT_API_BASE_URL}/Products?token=${token}`;
    const method = isUpdate ? "PUT" : "POST";

    console.log(`[CaspitAdapter] ${method} product:`, payload);

    try {
      const response = await fetch(url, {
        method: method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      console.log(`[CaspitAdapter] Response status: ${response.status}`);

      if (!response.ok) {
        let errorDetails = responseText;
        try {
          const jsonError = JSON.parse(responseText);
          errorDetails = jsonError.Message || jsonError.message || responseText;
        } catch (e) {
          // Not JSON, use raw text
        }
        throw new Error(`Caspit API error (${response.status}): ${errorDetails}`);
      }

      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        throw new Error("Caspit API returned non-JSON response");
      }

      const returnedCaspitProductId =
        responseData?.ProductId ||
        responseData?.id ||
        payload.ProductId;

      if (!returnedCaspitProductId && !isUpdate) {
        throw new Error("Caspit did not return a product ID");
      }

      return {
        success: true,
        message: `Product ${isUpdate ? "updated" : "created"} successfully`,
        data: { externalId: returnedCaspitProductId },
      };
    } catch (error: any) {
      console.error(`[CaspitAdapter] Error in ${method}:`, error);
      return {
        success: false,
        message: `Failed to ${isUpdate ? "update" : "create"} product: ${error.message}`,
      };
    }
  }

  async updateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult> {
    const caspitProductId = product.externalIds?.caspit;
    if (!caspitProductId) {
      return {
        success: false,
        message: "Product does not have a Caspit ID for update",
      };
    }

    // Use createOrUpdateProduct with the existing ID
    return this.createOrUpdateProduct(config, product);
  }

  async deactivateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult> {
    const caspitProductId = product.externalIds?.caspit;
    if (!caspitProductId) {
      return {
        success: false,
        message: "Product does not have a Caspit ID for deactivation",
      };
    }

    let token: string;
    try {
      token = await this.getCaspitToken(config);
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to authenticate: ${error.message}`,
      };
    }

    const url = `${CASPIT_API_BASE_URL}/Products/${caspitProductId}?token=${token}`;
    const payload: CaspitProductPayload = {
      ProductId: caspitProductId,
      Name: product.description || "N/A",
      Status: false, // Deactivate the product
    };

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Failed to deactivate product: ${responseText}`);
      }

      return {
        success: true,
        message: "Product deactivated successfully",
      };
    } catch (error: any) {
      console.error("[CaspitAdapter] Error deactivating product:", error);
      return {
        success: false,
        message: `Failed to deactivate product: ${error.message}`,
      };
    }
  }

  async syncProducts(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting product sync...`);
    let token: string;
    try {
      token = await this.getCaspitToken(config);
    } catch (error: any) {
      return {
        success: false,
        message: `Authentication failed: ${error.message}`,
      };
    }

    const allProducts: Product[] = [];
    let hasMorePages = true;
    let currentPage = 1;
    const pageSize = 1000;

    while (hasMorePages) {
      const url = `${CASPIT_API_BASE_URL}/Products?token=${token}&page=${currentPage}&pageSize=${pageSize}`;
      console.log(`[CaspitAdapter] Fetching page ${currentPage}`);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch products: ${response.statusText}`);
        }

        const responseText = await response.text();
        let data;
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          throw new Error("Invalid JSON response from Caspit");
        }

        const productsData = data?.Results || data;
        if (!Array.isArray(productsData) || productsData.length === 0) {
          hasMorePages = false;
          break;
        }

        const mappedProducts = productsData
          .map((p) => this.mapCaspitProductToAppProduct(p))
          .filter((p): p is Product => p !== null);

        allProducts.push(...mappedProducts);
        currentPage++;

        if (productsData.length < pageSize) {
          hasMorePages = false;
        }
      } catch (error: any) {
        console.error(`[CaspitAdapter] Error syncing products:`, error);
        return {
          success: false,
          message: `Product sync failed: ${error.message}`,
          itemsSynced: allProducts.length,
          products: allProducts,
        };
      }
    }

    return {
      success: true,
      message: `Successfully synced ${allProducts.length} products`,
      itemsSynced: allProducts.length,
      products: allProducts,
    };
  }

  // --- Supplier Operations ---

  async createOrUpdateSupplier(
    config: PosConnectionConfig,
    supplier: Supplier
  ): Promise<OperationResult<{ externalId: string }>> {
    let token: string;
    try {
      token = await this.getCaspitToken(config);
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to authenticate: ${error.message}`,
      };
    }

    const caspitContactId = supplier.externalIds?.caspit;
    const isUpdate = !!caspitContactId;

    const payload: CaspitContactPayload = {
      Id: caspitContactId || null,
      Name: supplier.name || "Unnamed Supplier",
      OsekMorshe: supplier.taxId || null,
      ContactType: 1, // 1 for Supplier
      Email: supplier.email || null,
      Address1: supplier.address || null,
      City: null, // Add if supplier has city field
      MobilePhone: supplier.phone || null,
    };

    const url = isUpdate
      ? `${CASPIT_API_BASE_URL}/Contacts/${caspitContactId}?token=${token}`
      : `${CASPIT_API_BASE_URL}/Contacts?token=${token}`;
    const method = isUpdate ? "PUT" : "POST";

    console.log(`[CaspitAdapter] ${method} supplier:`, payload);

    try {
      const response = await fetch(url, {
        method: method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Caspit API error: ${responseText}`);
      }

      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        throw new Error("Caspit API returned non-JSON response");
      }

      const returnedContactId = responseData?.Id || responseData?.id || payload.Id;

      return {
        success: true,
        message: `Supplier ${isUpdate ? "updated" : "created"} successfully`,
        data: { externalId: returnedContactId },
      };
    } catch (error: any) {
      console.error(`[CaspitAdapter] Error in ${method} supplier:`, error);
      return {
        success: false,
        message: `Failed to ${isUpdate ? "update" : "create"} supplier: ${error.message}`,
      };
    }
  }

  async syncSuppliers(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting supplier sync...`);
    let token: string;
    try {
      token = await this.getCaspitToken(config);
    } catch (error: any) {
      return {
        success: false,
        message: `Authentication failed: ${error.message}`,
      };
    }

    const url = `${CASPIT_API_BASE_URL}/Contacts?token=${token}&ContactType=1`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch suppliers: ${response.statusText}`);
      }

      const suppliersData = await response.json();
      console.log(`[CaspitAdapter] Received ${suppliersData.length} suppliers`);

      // Map suppliers if needed
      // const suppliers = suppliersData.map(s => mapCaspitSupplierToApp(s));

      return {
        success: true,
        message: `Successfully synced ${suppliersData.length} suppliers`,
        itemsSynced: suppliersData.length,
        data: suppliersData,
      };
    } catch (error: any) {
      console.error("[CaspitAdapter] Error syncing suppliers:", error);
      return {
        success: false,
        message: `Supplier sync failed: ${error.message}`,
      };
    }
  }

  // --- Document Operations ---

  async createDocument(
    config: PosConnectionConfig,
    document: PosDocument,
    externalSupplierId: string
  ): Promise<OperationResult<{ externalId: string }>> {
    let token: string;
    try {
      token = await this.getCaspitToken(config);
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to authenticate: ${error.message}`,
      };
    }

    const trxTypeId = document.type === "invoice" 
      ? CASPIT_TRX_TYPE_IDS.PURCHASE_INVOICE 
      : CASPIT_TRX_TYPE_IDS.GOODS_RECEIVED_VOUCHER;

    // Build Caspit document payload
    const caspitLines = document.items.map((item, index) => ({
      Line: index + 1,
      ProductId: item.externalIds?.caspit || item.id,
      ProductName: item.description,
      Qty: item.quantity,
      UnitPrice: item.unitPrice,
      LineTotalWithoutVat: item.lineTotal,
    }));

    const payload = {
      TrxTypeId: trxTypeId,
      ContactId: externalSupplierId,
      Date: document.date.toISOString(),
      TotalLines: caspitLines.length,
      Lines: caspitLines,
      // Add more fields as needed based on Caspit API requirements
    };

    const url = `${CASPIT_API_BASE_URL}/Documents?token=${token}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Failed to create document: ${responseText}`);
      }

      const responseData = JSON.parse(responseText);
      const documentId = responseData?.Id || responseData?.DocumentId;

      return {
        success: true,
        message: "Document created successfully",
        data: { externalId: documentId },
      };
    } catch (error: any) {
      console.error("[CaspitAdapter] Error creating document:", error);
      return {
        success: false,
        message: `Failed to create document: ${error.message}`,
      };
    }
  }

  async syncDocuments(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting document sync...`);
    let token: string;
    try {
      token = await this.getCaspitToken(config);
    } catch (error: any) {
      return {
        success: false,
        message: `Authentication failed: ${error.message}`,
      };
    }

    const invoicesUrl = `${CASPIT_API_BASE_URL}/Documents?token=${token}&TrxTypeId=${CASPIT_TRX_TYPE_IDS.PURCHASE_INVOICE}`;

    try {
      const response = await fetch(invoicesUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch documents: ${response.statusText}`);
      }

      const documentsData = await response.json();
      console.log(`[CaspitAdapter] Received ${documentsData.length} documents`);

      return {
        success: true,
        message: `Successfully synced ${documentsData.length} documents`,
        itemsSynced: documentsData.length,
        data: documentsData,
      };
    } catch (error: any) {
      console.error("[CaspitAdapter] Error syncing documents:", error);
      return {
        success: false,
        message: `Document sync failed: ${error.message}`,
      };
    }
  }

  // --- Sales Operations ---

  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting sales sync...`);
    let token: string;
    try {
      token = await this.getCaspitToken(config);
    } catch (error: any) {
      return {
        success: false,
        message: `Authentication failed: ${error.message}`,
      };
    }

    const url = `${CASPIT_API_BASE_URL}/Documents?token=${token}&TrxTypeId=100`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch sales: ${response.statusText}`);
      }

      const salesData = await response.json();
      console.log(`[CaspitAdapter] Received ${salesData.length} sales records`);

      return {
        success: true,
        message: `Successfully synced ${salesData.length} sales`,
        itemsSynced: salesData.length,
        data: salesData,
      };
    } catch (error: any) {
      console.error("[CaspitAdapter] Error syncing sales:", error);
      return {
        success: false,
        message: `Sales sync failed: ${error.message}`,
      };
    }
  }
}

export const caspitAdapter = new CaspitAdapter();
