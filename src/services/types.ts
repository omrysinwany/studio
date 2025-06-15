import type { Timestamp, FieldValue } from "firebase/firestore";
import type { PosConnectionConfig } from "./pos-integration/pos-adapter.interface";

// Note: For client-facing types, date fields that are Timestamps in Firestore
// should be represented as `string` (e.g., ISO string) because server actions
// will serialize them before sending to the client. The `FieldValue` type
// should only be used in server-side update/create operations, not in shared types.

export interface User {
  id: string;
  username?: string | null;
  email?: string | null;
  createdAt?: Timestamp | FieldValue;
  lastLoginAt?: Timestamp | FieldValue;
}

export interface Product {
  id: string;
  userId: string;
  catalogNumber: string;
  name: string;
  description: string;
  shortName?: string | null;
  barcode?: string | null;
  quantity: number;
  unitPrice: number;
  salePrice?: number | null;
  lineTotal: number;
  supplier?: string | null;
  category?: string | null;
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
  imageUrl?: string | null;
  lastUpdated?: Timestamp | FieldValue;
  lastPurchasedAt?: Timestamp | FieldValue;
  caspitProductId?: string | null;
  isActive?: boolean;
}

export interface Invoice {
  id: string;
  userId: string;
  originalFileName: string;
  uploadTime: string | Timestamp | FieldValue;
  status: "pending" | "processing" | "completed" | "error" | "archived";
  documentType: "deliveryNote" | "invoice" | "paymentReceipt";
  supplierName?: string | null;
  supplierId?: string | null;
  osekMorshe?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Timestamp | FieldValue | null;
  totalAmount?: number | null;
  itemCount?: number;
  paymentMethod?: string | null;
  dueDate?: string | Timestamp | FieldValue | null;
  paymentDate?: string | Timestamp | FieldValue | null;
  paymentStatus: "paid" | "unpaid" | "pending_payment";
  products: Product[];
  isArchived?: boolean;
  errorMessage?: string | null;
  caspitPurchaseDocId?: string | null;
  lastUpdated?: Timestamp | FieldValue;
  paymentTerms?: string;
  paymentReceiptImageUri?: string | null | undefined;
  originalImageUri?: string;
  originalImagePreviewUri?: string | null;
  driveFileId?: string;
  rawScanResultJson?: string | null;
  compressedImageForFinalRecordUri?: string | null;
  linkedDeliveryNoteId?: string | null;
}

export interface InvoiceHistoryItem extends Omit<Invoice, "products"> {
  generatedFileName?: string;
  products: (Omit<Product, "id"> & { id?: string })[];
  originalImagePreviewUri?: string | null | undefined;
  compressedImageForFinalRecordUri?: string | null | undefined;
  rawScanResultJson?: string | null | undefined;
}

export interface Supplier {
  id: string;
  userId: string;
  name: string;
  invoiceCount: number;
  totalSpent: number;
  caspitAccountId?: string | null;
  osekMorshe?: string | null;
  contactPersonName?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: {
    street?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
  paymentTerms?: string | null;
  invoiceComment?: string | null;
  bankDetails?: {
    accountNumber?: string | null;
    branch?: string | null;
    bankId?: number | null;
  } | null;
  lastActivityDate?: string | Timestamp | null;
  createdAt: Timestamp | FieldValue;
}

export interface AccountantSettings {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface KpiPreferences {
  visibleKpiIds: string[];
  kpiOrder: string[];
}

export interface QuickActionPreferences {
  visibleQuickActionIds: string[];
  quickActionOrder: string[];
}

export interface UserSettings {
  userId: string;
  reminderDaysBefore?: number | null;
  posSystemId?: string | null;
  posConfig?: PosConnectionConfig | null;
  accountantSettings?: AccountantSettings | null;
  monthlyBudget?: number | null;
  kpiPreferences?: KpiPreferences | null;
  quickActionPreferences?: QuickActionPreferences | null;
}

export interface OtherExpense {
  id: string;
  userId: string;
  description: string;
  amount: number;
  date: string | Timestamp;
  categoryId?: string | null;
  paymentDate?: string | Timestamp;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  userId: string;
}

export interface ProductPriceDiscrepancy extends Product {
  existingUnitPrice: number;
  newUnitPrice: number;
}

export interface PriceCheckResult {
  productsToSaveDirectly: Product[];
  priceDiscrepancies: ProductPriceDiscrepancy[];
}
