/**
 * @fileoverview Defines the TypeScript types for Caspit API objects.
 * Based on the official API documentation provided.
 * @see https://app.caspit.biz/apihelp
 */

/**
 * Represents a line in a Caspit document (e.g., an invoice line).
 */
export interface CaspitDocumentLine {
  Number?: number;
  ProductId?: string; // Corresponds to 'barcode' or 'sku'
  ProductCatalogNumber?: string;
  ProductName: string;
  Details?: string;
  UnitPrice: number;
  Qty: number;
  CurrencySymbol?: string; // e.g., '₪', '$', '€'
  Rate?: number; // Exchange rate, default 1
  Rebate?: number; // Discount per line (amount)
  ExtendedPrice: number; // Qty * UnitPrice (after discount)
  ChargeVAT: boolean; // Does this line include VAT?
  VATRate?: number; // The VAT rate for this line (e.g., 17 for 17%)
  VAT?: number; // VAT amount for this line
}

/**
 * Represents a line in a Caspit receipt.
 * The documentation is sparse, so this is a minimal representation.
 */
export interface CaspitReceiptLine {
  // Fields for receipt lines are not detailed in the provided docs.
  // Add fields here as they become known.
  [key: string]: any; // Allow other properties
}

/**
 * Represents a document related to the main document.
 */
export interface RelatedDocument {
  // Fields for related documents are not detailed.
  [key: string]: any; // Allow other properties
}

/**
 * Represents a contact (customer or supplier) in Caspit.
 * Used for creating a new contact.
 */
export interface CaspitContact {
  // --- Core Info ---
  Id?: string; // Caspit's internal ID, returned on creation.
  Name: string; // Business name.
  OsekMorshe?: string; // Tax ID.
  ContactType: number; // 1 for Customer, 2 for Supplier.

  // --- Contact Person ---
  ContactName?: string;
  Email?: string;
  MobilePhone?: string;

  // --- Address ---
  Address1?: string;
  Address2?: string;
  City?: string;
  PostalCode?: string;
  Country?: string;

  // Allow other properties
  [key: string]: any;
}

/**
 * Represents a Caspit document (e.g., Invoice, Expense).
 * This is the main object sent to create a new document.
 */
export interface CaspitDocument {
  // --- Identifiers (Required) ---
  DocumentId: string; // A unique ID you provide for tracking.
  TrxTypeId: number; // **Required**. See TrxTypes enumeration. e.g., 35 for 'Expenses_VAT'.

  // --- Document Details ---
  DocumentSource?: number; // 3 = Created from API.
  DocumentNumberBranch?: number; // Default is 98.
  Number?: string; // Document number, used for retrieval, not creation.
  Date: string; // Document date in ISO 8601 format.
  DueDate?: string; // Payment due date in ISO 8601 format.
  Details?: string; // Internal details/notes (not shown to customer).
  Comments?: string; // Public comments (shown to customer).

  // --- Customer/Supplier Info ---
  CustomerId?: string; // Caspit's internal ID for the contact.
  CustomerBusinessName?: string;
  CustomerOsekMorshe?: string; // Tax ID of the customer/supplier.
  CustomerContactName?: string;
  CustomerAddress1?: string;
  CustomerAddress2?: string;
  CustomerCity?: string;
  CustomerPostalCode?: string;
  CustomerCountry?: string;
  CustomerEmail?: string;
  MobilePhone?: string;

  // --- Financials ---
  Total?: number; // Total amount including VAT. Auto-calculated by Caspit if lines are provided.
  Vat?: number; // Total VAT amount. Auto-calculated.
  VatRate?: number; // VAT rate (e.g., 17 for 17%). Default is based on document date.
  TotalBeforeVAT?: number; // Total before VAT. Auto-calculated.
  Rebate?: number; // Document-level discount amount on VAT-liable items.
  RebatePercent?: number; // Document-level discount percentage on VAT-liable items.
  RountTotal?: boolean; // Note: 'RountTotal' is the spelling in the API.
  RebateRounding?: number; // Rounding discount. Auto-calculated.

  // --- Document & Receipt Lines ---
  DocumentLines?: CaspitDocumentLine[]; // For Invoices, Expenses etc.
  ReceiptLines?: CaspitReceiptLine[]; // For Receipts.

  // --- Classification ---
  TrxCode?: string; // Transaction classification name (e.g., "מכירות"). Read-only.
  TrxCodeNumber?: number; // **Required**. Transaction classification ID.

  // --- Read-Only / System-Populated Fields ---
  BusinessId?: string; // Populated by Caspit.
  TotalLinesChargeVAT?: number;
  TotalBeforeVATChargeVAT?: number;
  TotalNoChargeVat?: number;
  EffectiveTotal?: number;
  Status?: number; // See DocStatus enumeration.
  RowVersion?: Uint8Array;
  LinkToPdf?: string;
  ViewUrl?: string;
  PaymentUrl?: string;
  RelatedDocuments?: RelatedDocument[];
  AllocationNumber?: string; // Israel Tax Authority allocation number.
  DateCreated?: string;
  UserCreated?: string;
  DateUpdated?: string;
  UserUpdated?: string;

  // --- Fields for Receipts / Payments ---
  Payment?: number;
  TaxDeduction?: number;
  TotalPayment?: number;
  ReceiptCurrencySymbol?: string; // '₪', '$', '€'
  ReceiptRate?: number; // Exchange rate for the receipt part.
  TaxDeductionNIS?: number;
  PaymentNIS?: number;
  TotalPaymentNIS?: number;
}
