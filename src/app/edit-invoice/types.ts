// src/app/edit-invoice/types.ts
import type { Timestamp } from "firebase/firestore";
import type { Product as BackendProductType } from "@/services/backend";

import type { DueDateOption as ComponentDueDateOption } from "@/components/supplier-payment-sheet";

export type DueDateOption = ComponentDueDateOption;

export interface EditableProduct extends BackendProductType {
  _originalId?: string;
}

export interface EditableTaxInvoiceDetails {
  supplierName?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  invoiceDate?: string | Timestamp | Date | null;
  paymentMethod?: string | null;
  paymentDueDate?: string | Timestamp | Date | null;
  rawScanResultJson?: string | null;
  paymentTerms?: string | null;
}

export type DialogFlowStep =
  | "idle"
  | "supplier_payment_details"
  | "new_product_details"
  | "ready_to_save"
  | "error_loading";

export interface ProductInputState {
  barcode: string;
  salePrice?: number;
  salePriceMethod: "manual" | "percentage";
  profitPercentage: string;
}

export interface InvoiceHistoryItem {
  id: string;
  userId: string;
  originalFileName: string;
  generatedFileName?: string;
  docType: "deliveryNote" | "invoice";
  status?: "pending" | "processed" | "error";
  uploadDate: Timestamp | Date | string;
  lastModified?: Timestamp | Date | string;
  products?: BackendProductType[];
  supplierName?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  invoiceDate?: Timestamp | Date | string | null;
  paymentMethod?: string | null;
  paymentDueDate?: Timestamp | Date | string | null;
  paymentTermOption?: DueDateOption | null;
  originalImagePreviewUri?: string | null;
  compressedImageForFinalRecordUri?: string | null;
  rawScanResultJson?: string | null;
  errorMessage?: string | null;
  tempInvoiceId?: string | null;
}
