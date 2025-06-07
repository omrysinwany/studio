// src/services/backend.ts
"use client";

import { db, auth as firebaseAuth } from "@/lib/firebase";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  Timestamp,
  serverTimestamp,
  deleteDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  limit,
  orderBy,
  addDoc,
  FieldValue,
  runTransaction,
  Query,
  DocumentData,
  QuerySnapshot,
} from "firebase/firestore";
import { parseISO, isValid } from "date-fns";
import type { PosConnectionConfig } from "./pos-integration/pos-adapter.interface";
import {
  createOrUpdateCaspitProductAction,
  updateCaspitProductAction,
  deactivateCaspitProductAction,
  createOrUpdateCaspitContactAction,
  createCaspitDocumentAction,
} from "@/actions/caspit-actions";
import firebaseApp from "@/lib/firebase";

// Firestore Collection Names
export const USERS_COLLECTION = "users";
export const INVENTORY_COLLECTION = "inventoryProducts";
export const DOCUMENTS_COLLECTION = "documents";
export const SUPPLIERS_COLLECTION = "suppliers";
export const OTHER_EXPENSES_COLLECTION = "otherExpenses";
export const EXPENSE_CATEGORIES_COLLECTION = "expenseCategories";
export const USER_SETTINGS_COLLECTION = "userSettings";

// localStorage keys
export const KPI_PREFERENCES_STORAGE_KEY_BASE = "invoTrack_kpiPreferences_v2";
export const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE =
  "invoTrack_quickActionsPreferences_v1";
export const TEMP_DATA_KEY_PREFIX = "invoTrackTempScanData_";

// Util function to convert string/Date to Timestamp, or return null/FieldValue
const convertToTimestampIfValid = (
  dateVal: any
): Timestamp | null | FieldValue => {
  if (!dateVal) return null;
  if (dateVal instanceof Date && isValid(dateVal))
    return Timestamp.fromDate(dateVal);
  if (typeof dateVal === "string") {
    // Try parsing as ISO string first
    let parsedDate = parseISO(dateVal);
    if (isValid(parsedDate)) return Timestamp.fromDate(parsedDate);

    // Try parsing as DD/MM/YYYY
    const parts = dateVal.split("/");
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed in Date
      const year = parseInt(parts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        parsedDate = new Date(year, month, day);
        if (
          isValid(parsedDate) &&
          parsedDate.getFullYear() === year &&
          parsedDate.getMonth() === month &&
          parsedDate.getDate() === day
        ) {
          console.log(
            `[convertToTimestampIfValid] Successfully parsed DD/MM/YYYY: ${dateVal} to ${parsedDate}`
          );
          return Timestamp.fromDate(parsedDate);
        }
      }
    }
  }
  if (dateVal instanceof Timestamp) return dateVal;
  if (
    typeof dateVal === "object" &&
    dateVal !== null &&
    "isEqual" in dateVal &&
    typeof dateVal.isEqual === "function"
  ) {
    return dateVal as FieldValue;
  }
  console.warn(
    `[convertToTimestampIfValid] Could not convert date value:`, // This log remains if all attempts fail
    dateVal
  );
  return null;
};

export interface User {
  id: string;
  username?: string | null;
  email?: string | null;
  createdAt?: Timestamp | FieldValue;
  lastLoginAt?: Timestamp | FieldValue;
  rawScanResultJson?: string | null;
}

export interface Product {
  id: string; // Firestore document ID
  userId: string;
  catalogNumber: string;
  description: string;
  shortName?: string | null;
  barcode?: string | null;
  quantity: number;
  unitPrice: number; // Cost price
  salePrice?: number | null; // Selling price
  lineTotal: number; // quantity * unitPrice (cost)
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
  imageUrl?: string | null;
  lastUpdated?: Timestamp | FieldValue;
  _originalId?: string;
  caspitProductId?: string | null; // ID from Caspit POS
  isActive?: boolean; // Added for soft delete
}

export interface InvoiceHistoryItem {
  id: string; // Firestore document ID
  userId: string;
  originalFileName: string;
  generatedFileName: string;
  uploadTime: string | Timestamp | FieldValue;
  status: "pending" | "processing" | "completed" | "error" | "archived";
  documentType: "deliveryNote" | "invoice" | "paymentReceipt";
  supplierName?: string | null;
  supplierId?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Timestamp | FieldValue | null;
  totalAmount?: number | null;
  itemCount?: number;
  paymentMethod?: string | null;
  paymentDueDate?: string | Timestamp | FieldValue | null;
  paymentStatus: "paid" | "unpaid" | "pending_payment";
  products: (string | Product)[];
  isArchived?: boolean;
  paymentReceiptImageUri?: string | null;
  originalImagePreviewUri?: string | null;
  compressedImageForFinalRecordUri?: string | null;
  errorMessage?: string | null;
  linkedDeliveryNoteId?: string | null;
  rawScanResultJson?: string | null;
  _displayContext?: "image_only" | "full_details";
  caspitPurchaseDocId?: string | null;
  syncError?: string | null;
}

export interface SupplierSummary {
  id: string;
  userId: string;
  name: string;
  invoiceCount: number;
  totalSpent: number;
  phone?: string | null;
  email?: string | null;
  paymentTerms?: string | null;
  lastActivityDate?: string | Timestamp | null;
  createdAt: Timestamp | FieldValue;
  caspitAccountId?: string | null; // Optional Caspit account ID
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
  category: string;
  _internalCategoryKey?: string | null;
  categoryId?: string | null;
}

export interface ExpenseCategory {
  id: string;
  userId: string;
  name: string;
  internalKey: string;
  isFixed?: boolean;
  defaultAmount?: number | null;
  createdAt: Timestamp | FieldValue;
}

export interface ExpenseTemplate {
  // Not fully migrated to Firestore yet
  id: string;
  userId: string;
  name: string;
  categoryId: string;
  description: string;
  amount: number;
}

export const MAX_INVOICE_HISTORY_ITEMS = 10; // For recent uploads display if needed for UI fallback
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.8 * 1024 * 1024; // For AI scan JSON (Firestore doc limit is 1MB)

export const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(
      `[getStorageKey] Called for baseKey "${baseKey}" without a userId.`
    );
    return `${baseKey}_SHARED_OR_NO_USER`;
  }
  return `${baseKey}_${userId}`;
};

export function sanitizeForFirestore<T extends object>(data: T): T {
  const sanitizedData = { ...data } as Record<string, any>;
  for (const key in sanitizedData) {
    if (sanitizedData[key] === undefined) {
      sanitizedData[key] = null;
    }
  }
  return sanitizedData as T;
}

// --- User Management (Firestore) ---
export async function saveUserToFirestore(userData: User): Promise<void> {
  if (!db)
    throw new Error(
      "Firestore (db) is not initialized in saveUserToFirestore."
    );
  if (!userData.id)
    throw new Error("User ID is missing for saveUserToFirestore.");

  const userRef = doc(db, USERS_COLLECTION, userData.id);
  const dataToSave: Partial<User> = {
    email: userData.email || null,
    username: userData.username || null,
  };

  try {
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      dataToSave.createdAt = serverTimestamp();
    }
    dataToSave.lastLoginAt = serverTimestamp();
    await setDoc(userRef, sanitizeForFirestore(dataToSave), { merge: true });
    console.log(`[Backend] User ${userData.id} saved/updated in Firestore.`);
  } catch (error) {
    console.error(
      "[Backend - saveUserToFirestore] Error saving user to Firestore:",
      error
    );
    throw error;
  }
}

export async function getUserFromFirestore(
  userId: string
): Promise<User | null> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getUserFromFirestore.");
    return null;
  }
  if (!userId) {
    console.warn("getUserFromFirestore called without userId");
    return null;
  }

  const userRef = doc(db, USERS_COLLECTION, userId);
  try {
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        email: data.email || null,
        username: data.username || null,
        createdAt:
          data.createdAt instanceof Timestamp ? data.createdAt : undefined,
        lastLoginAt:
          data.lastLoginAt instanceof Timestamp ? data.lastLoginAt : undefined,
      } as User;
    }
    return null;
  } catch (error) {
    console.error("[Backend] Error fetching user from Firestore:", error);
    throw error;
  }
}

// --- Inventory Products (Firestore) ---
export async function getProductsService(
  userId: string,
  options: { includeInactive?: boolean } = {}
): Promise<Product[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getProductsService.");
    return [];
  }
  if (!userId) {
    console.warn(
      "getProductsService called without userId. Returning empty array."
    );
    return [];
  }

  // Simplified initial query: always fetch by userId and order by shortName.
  // Filtering for active/inactive will happen post-fetch or via a more specific query if includeInactive is false.
  const productsQuery = query(
    collection(db, INVENTORY_COLLECTION),
    where("userId", "==", userId),
    orderBy("shortName")
  );

  // The specific filtering for 'isActive == true' if !options.includeInactive will be done post-fetch to handle missing 'isActive' fields correctly.
  // If options.includeInactive is true, we don't filter by isActive at all.

  try {
    const snapshot = await getDocs(productsQuery);
    console.log(
      `[Backend getProductsService] Fetched ${snapshot.docs.length} raw products for user ${userId} (includeInactive: ${options.includeInactive})`
    );

    let mappedProducts = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        userId,
        ...data,
        lastUpdated:
          data.lastUpdated instanceof Timestamp ? data.lastUpdated : undefined,
        isActive: data.isActive === undefined ? true : data.isActive, // Default to true if undefined
      } as Product;
    });

    // Post-fetch filtering if we only want active products
    if (!options.includeInactive) {
      mappedProducts = mappedProducts.filter((product) => product.isActive);
      console.log(
        `[Backend getProductsService] Filtered down to ${mappedProducts.length} active products for user ${userId}`
      );
    }

    return mappedProducts;
  } catch (error) {
    console.error("[Backend] Error fetching products from Firestore:", error);
    if (
      (error as any).message &&
      ((error as any).message.includes("The query requires an index") ||
        (error as any).message.includes(
          "inequality filter property and first sort-order property must be the same"
        ))
    ) {
      console.error(
        "Firestore missing index error for products. Please create the suggested composite index in your Firebase console. It might involve (userId, isActive, shortName)."
      );
    }
    throw error;
  }
}

export async function getProductByIdService(
  productId: string,
  userId: string
): Promise<Product | null> {
  if (!db || !userId) return null;
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  try {
    const docSnap = await getDoc(productRef);
    if (docSnap.exists() && docSnap.data().userId === userId) {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        userId,
        ...data,
        lastUpdated:
          data.lastUpdated instanceof Timestamp ? data.lastUpdated : undefined,
      } as Product;
    }
    return null;
  } catch (error) {
    console.error(
      `[Backend] Error fetching product ${productId} from Firestore:`,
      error
    );
    throw error;
  }
}

export async function updateProductService(
  productId: string,
  updatedData: Partial<Omit<Product, "id" | "userId">>,
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const productRef = doc(db, INVENTORY_COLLECTION, productId);

  // Ensure only actual fields present in updatedData are included, and add lastUpdated
  const dataToUpdate: Record<string, any> = {};
  for (const key in updatedData) {
    if (Object.prototype.hasOwnProperty.call(updatedData, key)) {
      const productKey = key as keyof Omit<Product, "id" | "userId">;
      if (updatedData[productKey] !== undefined) {
        // Only include defined values
        dataToUpdate[productKey] = updatedData[productKey];
      }
    }
  }
  dataToUpdate.lastUpdated = serverTimestamp();

  let productBeforeUpdate: Product | null = null;

  try {
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists() || productDoc.data().userId !== userId) {
      throw new Error("Permission denied or product not found for update.");
    }
    productBeforeUpdate = {
      id: productDoc.id,
      userId,
      ...productDoc.data(),
    } as Product;

    await updateDoc(productRef, sanitizeForFirestore(dataToUpdate));
    console.log(
      `[Backend] Product ${productId} updated in Firestore for user ${userId}.`
    );

    // --- START CASPIT INTEGRATION FOR UPDATE ---
    if (productBeforeUpdate && productBeforeUpdate.caspitProductId) {
      const userSettings = await getUserSettingsService(userId);
      if (
        userSettings &&
        userSettings.posSystemId === "caspit" &&
        userSettings.posConfig
      ) {
        console.log(
          `[Backend updateProductService] Attempting to update product in Caspit. Caspit ID: ${productBeforeUpdate.caspitProductId}`
        );
        // Construct the full product object as expected by updateCaspitProductAction
        // This means merging the updatedData with the existing data not being changed
        const updatedProductForCaspit: Product = {
          ...productBeforeUpdate, // Start with the state before Firestore update
          ...updatedData, // Apply the specific changes that were sent to Firestore
          id: productId, // Ensure the Firestore ID is correct
          userId: userId, // Ensure userId is correct
          caspitProductId: productBeforeUpdate.caspitProductId, // Critical for Caspit update
          // Ensure lastUpdated is handled correctly - it's a FieldValue for Firestore,
          // but Caspit won't want that. updateCaspitProductAction should handle/ignore it.
          // For safety, remove it or ensure it's converted if Caspit action expects a date string/Timestamp.
          lastUpdated: undefined, // Or convert to a suitable format if needed by Caspit action
        };

        try {
          const caspitResult = await updateCaspitProductAction(
            userSettings.posConfig,
            updatedProductForCaspit
          );
          if (caspitResult.success) {
            console.log(
              `[Backend updateProductService] Successfully updated product ${productId} (Caspit ID: ${productBeforeUpdate.caspitProductId}) in Caspit.`
            );
          } else {
            console.error(
              `[Backend updateProductService] Failed to update product ${productId} (Caspit ID: ${productBeforeUpdate.caspitProductId}) in Caspit: ${caspitResult.message}`
            );
            // Optionally, decide if you want to throw an error here or just log
          }
        } catch (caspitError: any) {
          console.error(
            `[Backend updateProductService] Critical error during Caspit update for product ${productId} (Caspit ID: ${productBeforeUpdate.caspitProductId}): `,
            caspitError.message
          );
        }
      } else {
        console.log(
          `[Backend updateProductService] Caspit POS not configured or product ${productId} has no Caspit ID. Skipping Caspit update.`
        );
      }
    } else {
      console.log(
        `[Backend updateProductService] Product ${productId} has no Caspit ID or data before update is missing. Skipping Caspit update.`
      );
    }
    // --- END CASPIT INTEGRATION FOR UPDATE ---
  } catch (error) {
    console.error(
      `[Backend] Error updating product ${productId} in Firestore: `,
      error
    );
    throw error;
  }
}

export async function deleteProductService(
  productId: string,
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  let productToDeactivate: Product | null = null;

  try {
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists() || productDoc.data().userId !== userId) {
      throw new Error(
        "Permission denied or product not found for deactivation."
      );
    }
    // Capture the full product data before marking as inactive
    productToDeactivate = {
      id: productDoc.id,
      userId,
      ...productDoc.data(),
    } as Product;

    // Instead of deleting, mark as inactive in Firestore
    await updateDoc(productRef, {
      isActive: false,
      lastUpdated: serverTimestamp(),
    });
    console.log(
      `[Backend] Product ${productId} marked as inactive in Firestore for user ${userId}.`
    );

    // --- START CASPIT INTEGRATION FOR DEACTIVATION ---
    if (productToDeactivate && productToDeactivate.caspitProductId) {
      const userSettings = await getUserSettingsService(userId);
      if (
        userSettings &&
        userSettings.posSystemId === "caspit" &&
        userSettings.posConfig
      ) {
        console.log(
          `[Backend deleteProductService] Attempting to deactivate product in Caspit. Caspit ID: ${productToDeactivate.caspitProductId}`
        );

        // Create a plain product object for Caspit, excluding Timestamp or other complex objects
        const plainProductForCaspit: Partial<Product> = {
          ...productToDeactivate,
          // Explicitly set fields needed by Caspit, ensure no Timestamps are passed
        };
        delete (plainProductForCaspit as any).lastUpdated; // Remove timestamp
        delete (plainProductForCaspit as any)._originalId; // Remove if not needed by Caspit
        // Add any other fields that might be complex objects and are not needed by Caspit

        const caspitResult = await deactivateCaspitProductAction(
          userSettings.posConfig,
          plainProductForCaspit as Product // Cast back to Product, assuming Caspit action handles missing fields gracefully or has them as optional
        );

        if (caspitResult.success) {
          console.log(
            `[Backend deleteProductService] Product ${productId} (Caspit ID: ${productToDeactivate.caspitProductId}) also marked as inactive in Caspit.`
          );
        } else {
          console.error(
            `[Backend deleteProductService] Failed to mark product ${productId} (Caspit ID: ${productToDeactivate.caspitProductId}) as inactive in Caspit: ${caspitResult.message}`
          );
          // Optionally, re-throw or handle this error (e.g., revert Firestore change, log to monitoring)
        }
      }
    }
    // --- END CASPIT INTEGRATION FOR DEACTIVATION ---
  } catch (error) {
    console.error(
      `[Backend] Error deactivating product ${productId} in Firestore: `,
      error
    );
    throw error;
  }
}

async function deleteCollectionByUserId(
  collectionName: string,
  userId: string
): Promise<void> {
  if (!db || !userId)
    throw new Error(
      `DB not initialized or User ID missing for deleteCollectionByUserId: ${collectionName}`
    );
  console.log(
    `[Backend deleteCollectionByUserId] Attempting to delete all documents in ${collectionName} for user ${userId}.`
  );
  const q = query(
    collection(db, collectionName),
    where("userId", "==", userId)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    console.log(
      `[Backend deleteCollectionByUserId] No documents to delete in ${collectionName} for user ${userId}.`
    );
    return;
  }

  const batch = writeBatch(db);
  snapshot.docs.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });
  await batch.commit();
  console.log(
    `[Backend deleteCollectionByUserId] All documents in ${collectionName} for user ${userId} have been deleted.`
  );
}

export async function clearInventoryService(userId: string): Promise<void> {
  await deleteCollectionByUserId(INVENTORY_COLLECTION, userId);
}

// --- Documents (Invoices/Delivery Notes - Firestore) ---
export async function getInvoicesService(
  userId: string
): Promise<InvoiceHistoryItem[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getInvoicesService.");
    return [];
  }
  if (!userId) {
    console.warn(
      "getInvoicesService called without userId. Returning empty array."
    );
    return [];
  }

  const documentsQuery = query(
    collection(db, DOCUMENTS_COLLECTION),
    where("userId", "==", userId),
    orderBy("uploadTime", "desc")
  );
  try {
    const snapshot = await getDocs(documentsQuery);
    console.log(
      `[Backend getInvoicesService] Firestore query for user ${userId} found ${snapshot.docs.length} documents.`
    );
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      const convertTimestampToString = (field: any): string | null => {
        if (field instanceof Timestamp) return field.toDate().toISOString();
        if (typeof field === "string" && isValid(parseISO(field))) return field;
        if (field instanceof Date && isValid(field)) return field.toISOString();
        return null;
      };
      return {
        id: docSnap.id,
        userId,
        ...data,
        uploadTime: convertTimestampToString(data.uploadTime),
        invoiceDate: convertTimestampToString(data.invoiceDate),
        paymentDueDate: convertTimestampToString(data.paymentDueDate),
        _displayContext: data._displayContext || "full_details",
      } as InvoiceHistoryItem;
    });
  } catch (error) {
    console.error("[Backend] Error fetching documents from Firestore:", error);
    if (
      (error as any).message &&
      (error as any).message.includes("The query requires an index")
    ) {
      console.error(
        "Firestore missing index error for documents. Firebase usually provides a link in the error message to create it. Check the browser console for the full error."
      );
    }
    throw error;
  }
}

export async function updateInvoiceService(
  invoiceId: string,
  updatedData: Partial<Omit<InvoiceHistoryItem, "id" | "userId">>,
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");

  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);

  const dataToUpdate: any = { ...updatedData };
  const convertToTimestampIfValidStringOrDate = (
    dateField: any
  ): Timestamp | null | FieldValue => {
    if (!dateField) return null;
    if (dateField === "SERVER_TIMESTAMP") return serverTimestamp();
    if (dateField instanceof Date && isValid(dateField))
      return Timestamp.fromDate(dateField);
    if (typeof dateField === "string" && isValid(parseISO(dateField))) {
      return Timestamp.fromDate(parseISO(dateField));
    }
    return dateField instanceof Timestamp ? dateField : null;
  };

  if (dataToUpdate.hasOwnProperty("invoiceDate"))
    dataToUpdate.invoiceDate = convertToTimestampIfValidStringOrDate(
      dataToUpdate.invoiceDate
    );
  if (dataToUpdate.hasOwnProperty("paymentDueDate"))
    dataToUpdate.paymentDueDate = convertToTimestampIfValidStringOrDate(
      dataToUpdate.paymentDueDate
    );
  if (
    dataToUpdate.hasOwnProperty("uploadTime") &&
    !(
      dataToUpdate.uploadTime instanceof Timestamp ||
      dataToUpdate.uploadTime === serverTimestamp()
    )
  ) {
    dataToUpdate.uploadTime =
      convertToTimestampIfValidStringOrDate(dataToUpdate.uploadTime) ||
      serverTimestamp();
  }

  const sanitizedDataToUpdate = sanitizeForFirestore(dataToUpdate);

  try {
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for update.");
    }
    await updateDoc(docRef, sanitizedDataToUpdate);
    console.log(
      `[Backend] Document ${invoiceId} updated in Firestore for user ${userId}.`
    );
  } catch (error) {
    console.error(
      `[Backend] Error updating document ${invoiceId} in Firestore:`,
      error
    );
    throw error;
  }
}

export async function updateInvoicePaymentStatusService(
  invoiceId: string,
  paymentStatus: InvoiceHistoryItem["paymentStatus"],
  userId: string,
  paymentReceiptImageUri?: string | null
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const updateData: any = { paymentStatus };

  if (paymentStatus === "paid" && paymentReceiptImageUri !== undefined) {
    updateData.paymentReceiptImageUri = paymentReceiptImageUri;
  } else if (paymentStatus !== "paid") {
    updateData.paymentReceiptImageUri = null;
  }

  try {
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error(
        "Permission denied or document not found for payment status update."
      );
    }
    await updateDoc(docRef, sanitizeForFirestore(updateData));
    console.log(
      `[Backend] Payment status for document ${invoiceId} updated to ${paymentStatus} for user ${userId}.`
    );
  } catch (error) {
    console.error(
      `[Backend] Error updating payment status for document ${invoiceId}:`,
      error
    );
    throw error;
  }
}

export async function deleteInvoiceService(
  invoiceId: string,
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  try {
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for deletion.");
    }
    await deleteDoc(docRef);
    console.log(
      `[Backend] Document ${invoiceId} deleted from Firestore for user ${userId}.`
    );
  } catch (error) {
    console.error(
      `[Backend] Error deleting document ${invoiceId} from Firestore:`,
      error
    );
    throw error;
  }
}

export async function clearDocumentsService(userId: string): Promise<void> {
  await deleteCollectionByUserId(DOCUMENTS_COLLECTION, userId);
}

// --- Price Discrepancy & Product Finalization (Firestore) ---
export interface ProductPriceDiscrepancy extends Product {
  existingUnitPrice: number;
  newUnitPrice: number;
}

export interface PriceCheckResult {
  productsToSaveDirectly: Product[];
  priceDiscrepancies: ProductPriceDiscrepancy[];
}

export async function checkProductPricesBeforeSaveService(
  productsToCheck: Product[],
  userId: string
): Promise<PriceCheckResult> {
  // --- START NEW LOGS ---
  console.log(
    `[checkProductPricesBeforeSaveService] ENTERED - User ID: ${userId}, Products to check: ${productsToCheck.length}`
  );
  if (productsToCheck && productsToCheck.length > 0) {
    productsToCheck.forEach((p, index) => {
      console.log(
        `[checkProductPricesBeforeSaveService] Product[${index}]: ID=${p.id}, Cat=${p.catalogNumber}, Bar=${p.barcode}, Desc=${p.description}, UnitPrice=${p.unitPrice}, _originalId=${p._originalId}`
      );
    });
  }
  // --- END NEW LOGS ---

  if (!db) {
    console.error(
      "[checkProductPricesBeforeSaveService] CRITICAL: Firestore (db) is not initialized."
    );
    return {
      productsToSaveDirectly: productsToCheck.map((p) => ({
        ...p,
        unitPrice: Number(p.unitPrice) || 0,
      })),
      priceDiscrepancies: [],
    };
  }
  if (!userId) {
    console.warn(
      "[checkProductPricesBeforeSaveService] CRITICAL WARNING: Called without userId. This will cause permission errors during queries."
    );
    // It's better to throw an error or return an empty/error state
    // as proceeding without userId for Firestore queries is guaranteed to fail with strict rules.
    // For now, returning as it was, but this is a major issue if it happens.
    return {
      productsToSaveDirectly: productsToCheck.map((p) => ({
        ...p,
        unitPrice: Number(p.unitPrice) || 0,
      })),
      priceDiscrepancies: [],
    };
  }
  // Original console.log, can be removed if the one above is sufficient
  // console.log(
  //   "[Backend checkProductPricesBeforeSaveService] Checking prices for products:",
  //   productsToCheck
  // );

  const productsToSaveDirectly: Product[] = [];
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

  for (const product of productsToCheck) {
    const currentProductUnitPrice = Number(product.unitPrice) || 0;
    const productWithId = {
      ...product,
      id:
        product.id ||
        `temp-id-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, // Ensure some ID if missing for logging
      unitPrice: currentProductUnitPrice,
    };

    console.log(
      `[checkProductPricesBeforeSaveService] Processing product: ID=${productWithId.id}, Cat=${productWithId.catalogNumber}, Bar=${productWithId.barcode}`
    );

    let existingProductData: Product | null = null;
    if (
      productWithId.id &&
      productWithId.id !== productWithId.catalogNumber && // Only try getDoc if ID is likely a real Firestore ID, not an AI-derived catalog number
      !productWithId.id.startsWith("prod-temp-") &&
      !productWithId.id.startsWith("temp-id-") && // Check against our generated temp prefix
      !productWithId.id.startsWith("scan-temp-") &&
      !productWithId.id.startsWith("scan-item-") // Added this line
    ) {
      const docRef = doc(db, INVENTORY_COLLECTION, productWithId.id);
      console.log(
        `[checkProductPricesBeforeSaveService] Attempting getDoc by actual ID: ${productWithId.id} for user: ${userId}`
      );
      try {
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          console.log(
            `[checkProductPricesBeforeSaveService] Firestore doc found by ID ${
              productWithId.id
            }. Checking userId... Doc data userId: ${snap.data().userId}`
          );
          if (snap.data().userId === userId) {
            existingProductData = {
              id: snap.id,
              userId,
              ...snap.data(),
            } as Product;
            console.log(
              `[checkProductPricesBeforeSaveService] Confirmed existing product by ID ${productWithId.id} (user match).`
            );
          } else {
            console.warn(
              `[checkProductPricesBeforeSaveService] Firestore doc found by ID ${
                productWithId.id
              } but belongs to different user (${
                snap.data().userId
              }). Current user: ${userId}. Will treat as new for this user and attempt catalog/barcode match.`
            );
            existingProductData = null; // Treat as new for *this* user, let catalog/barcode match proceed
          }
        } else {
          console.log(
            `[checkProductPricesBeforeSaveService] No Firestore doc found for ID: ${productWithId.id}. Will attempt catalog/barcode match.`
          );
          existingProductData = null;
        }
      } catch (error: any) {
        // Explicitly type error as 'any' or a more specific Firebase error type
        console.error(
          `[checkProductPricesBeforeSaveService] Error during getDoc by ID ${productWithId.id}:`,
          error
        );
        if (error.code === "permission-denied") {
          console.warn(
            `[checkProductPricesBeforeSaveService] Permission denied trying to getDoc for ID ${productWithId.id}. This likely means the document doesn't exist or doesn't meet rule criteria for the read. Assuming it's not an existing product for this user. Will attempt catalog/barcode match.`
          );
          existingProductData = null; // Treat as if not found for this user due to permission issue on the direct ID lookup
        } else {
          // For other errors (network, etc.), re-throw to be handled by the calling function
          console.error(
            "[checkProductPricesBeforeSaveService] Rethrowing non-permission error from getDoc by ID."
          );
          throw error;
        }
      }
    }
    // If not found by ID (or ID was temporary, or permission issue on ID lookup), try catalogNumber
    if (
      !existingProductData &&
      productWithId.catalogNumber &&
      productWithId.catalogNumber !== "N/A"
    ) {
      const qCat = query(
        collection(db, INVENTORY_COLLECTION),
        where("userId", "==", userId), // Query is correctly scoped to the user
        where("catalogNumber", "==", productWithId.catalogNumber),
        limit(1)
      );
      console.log(
        `[checkProductPricesBeforeSaveService] Querying by Catalog#: ${productWithId.catalogNumber} for user: ${userId}`
      );
      try {
        const catSnap = await getDocs(qCat);
        if (!catSnap.empty) {
          existingProductData = {
            id: catSnap.docs[0].id,
            userId, // This should be correct due to the query
            ...catSnap.docs[0].data(),
          } as Product;
          console.log(
            `[checkProductPricesBeforeSaveService] Found existing product by Catalog# ${productWithId.catalogNumber}. ID: ${existingProductData.id}`
          );
        } else {
          console.log(
            `[checkProductPricesBeforeSaveService] No product found by Catalog#: ${productWithId.catalogNumber} for user ${userId}`
          );
        }
      } catch (error) {
        console.error(
          `[checkProductPricesBeforeSaveService] Error querying by Catalog# ${productWithId.catalogNumber}:`,
          error
        );
        throw error;
      }
    }
    // If still not found, try barcode
    if (
      !existingProductData &&
      productWithId.barcode &&
      productWithId.barcode.trim() !== ""
    ) {
      const qBar = query(
        collection(db, INVENTORY_COLLECTION),
        where("userId", "==", userId), // Query is correctly scoped to the user
        where("barcode", "==", productWithId.barcode.trim()),
        limit(1)
      );
      console.log(
        `[checkProductPricesBeforeSaveService] Querying by Barcode: ${productWithId.barcode} for user: ${userId}`
      );
      try {
        const barSnap = await getDocs(qBar);
        if (!barSnap.empty) {
          existingProductData = {
            id: barSnap.docs[0].id,
            userId, // This should be correct due to the query
            ...barSnap.docs[0].data(),
          } as Product;
          console.log(
            `[checkProductPricesBeforeSaveService] Found existing product by Barcode ${productWithId.barcode}. ID: ${existingProductData.id}`
          );
        } else {
          console.log(
            `[checkProductPricesBeforeSaveService] No product found by Barcode: ${productWithId.barcode} for user ${userId}`
          );
        }
      } catch (error) {
        console.error(
          `[checkProductPricesBeforeSaveService] Error querying by Barcode ${productWithId.barcode}:`,
          error
        );
        throw error;
      }
    }

    if (existingProductData) {
      const existingUnitPrice = Number(existingProductData.unitPrice) || 0;
      if (
        Math.abs(existingUnitPrice - productWithId.unitPrice) > 0.001 &&
        productWithId.unitPrice > 0
      ) {
        console.log(
          `[checkProductPricesBeforeSaveService] Discrepancy found for ${existingProductData.id}: Old: ${existingUnitPrice}, New: ${productWithId.unitPrice}`
        );
        priceDiscrepancies.push({
          ...productWithId, // Use the product data from the scan/UI
          id: existingProductData.id, // Crucially, use the ID of the EXISTING product
          userId,
          _originalId: existingProductData.id, // Store the existing ID
          existingUnitPrice: existingUnitPrice,
          newUnitPrice: productWithId.unitPrice,
        });
      } else {
        // No discrepancy or new price is 0, save/update with existing product's ID
        productsToSaveDirectly.push({
          ...productWithId,
          id: existingProductData.id,
          userId,
          _originalId: existingProductData.id,
        });
      }
    } else {
      // Product is new to the inventory
      productsToSaveDirectly.push({ ...productWithId, userId });
    }
  }
  console.log(
    `[checkProductPricesBeforeSaveService] Direct save count: ${productsToSaveDirectly.length}, Discrepancies: ${priceDiscrepancies.length}`
  );
  return { productsToSaveDirectly, priceDiscrepancies };
}

export async function finalizeSaveProductsService(
  productsFromDoc: Partial<Product>[],
  originalFileNameFromUpload: string,
  documentType: "deliveryNote" | "invoice" | "paymentReceipt",
  userId: string,
  tempInvoiceId?: string | null | undefined,
  extractedInvoiceNumber?: string | null,
  finalSupplierName?: string | null,
  extractedTotalAmount?: number | null,
  paymentDueDate?: string | Date | Timestamp | null,
  invoiceDate?: string | Date | Timestamp | null,
  paymentMethod?: string | null,
  originalImagePreviewDataUri?: string | null,
  compressedImageForFinalRecordDataUri?: string | null,
  rawScanResultJson?: string | null,
  paymentTermString?: string | null
): Promise<{
  finalInvoiceRecord: InvoiceHistoryItem;
  savedProductsWithFinalIds: Product[];
}> {
  const firestoreDb = db;
  if (!firestoreDb) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User ID is missing.");
  if (!finalSupplierName) throw new Error("Supplier name is required.");

  // Step 1: Query for the supplier *outside* the transaction to find its reference.
  const supplierQuery = query(
    collection(firestoreDb, SUPPLIERS_COLLECTION),
    where("userId", "==", userId),
    where("name", "==", finalSupplierName),
    limit(1)
  );
  const supplierQuerySnapshot = await getDocs(supplierQuery);
  const existingSupplierDoc = supplierQuerySnapshot.docs[0]; // This is either the document or undefined

  let finalInvoiceRecord!: InvoiceHistoryItem;
  const savedProductsWithFinalIds: Product[] = [];
  let finalSupplierId!: string;

  try {
    await runTransaction(firestoreDb, async (transaction) => {
      const productsCollectionRef = collection(
        firestoreDb,
        INVENTORY_COLLECTION
      );
      let supplierRef;

      // Step 2: Inside the transaction, use the result from the outside query.
      if (existingSupplierDoc) {
        // If the supplier exists, get its ref and update it.
        supplierRef = doc(
          firestoreDb,
          SUPPLIERS_COLLECTION,
          existingSupplierDoc.id
        );
        finalSupplierId = existingSupplierDoc.id;

        // Re-read the document inside the transaction to ensure atomicity.
        const supplierDocInTransaction = await transaction.get(supplierRef);
        if (!supplierDocInTransaction.exists()) {
          // This case is unlikely but handles deletion between the initial read and the transaction start.
          throw new Error(
            "Supplier was deleted between the initial query and the transaction start."
          );
        }

        const supplierData = supplierDocInTransaction.data();
        transaction.update(supplierRef, {
          totalSpent:
            (supplierData.totalSpent || 0) + (extractedTotalAmount || 0),
          invoiceCount: (supplierData.invoiceCount || 0) + 1,
          lastActivityDate: serverTimestamp(),
        });
      } else {
        // If the supplier does not exist, create a new one.
        supplierRef = doc(collection(firestoreDb, SUPPLIERS_COLLECTION));
        finalSupplierId = supplierRef.id;
        transaction.set(supplierRef, {
          id: finalSupplierId,
          userId,
          name: finalSupplierName,
          totalSpent: extractedTotalAmount || 0,
          invoiceCount: 1,
          createdAt: serverTimestamp(),
          lastActivityDate: serverTimestamp(),
          paymentTerms: paymentTermString || null,
          caspitAccountId: null,
        });
      }

      // Step 3: Continue with the rest of the original transaction logic.
      for (const product of productsFromDoc) {
        const newProductRef = doc(productsCollectionRef);
        const newProductData = {
          ...product,
          id: newProductRef.id,
          userId,
          lastUpdated: serverTimestamp(),
        };
        transaction.set(newProductRef, newProductData);
        savedProductsWithFinalIds.push(newProductData as Product);
      }

      const finalInvoiceRef = tempInvoiceId
        ? doc(firestoreDb, DOCUMENTS_COLLECTION, tempInvoiceId)
        : doc(collection(firestoreDb, DOCUMENTS_COLLECTION));

      const invoiceData: Omit<InvoiceHistoryItem, "uploadTime"> & {
        uploadTime: FieldValue;
      } = {
        id: finalInvoiceRef.id,
        userId,
        originalFileName: originalFileNameFromUpload,
        generatedFileName: `${documentType}_${
          extractedInvoiceNumber || "N_A"
        }_${Date.now()}`,
        uploadTime: serverTimestamp(),
        status: "completed",
        documentType,
        supplierName: finalSupplierName,
        supplierId: finalSupplierId,
        invoiceNumber: extractedInvoiceNumber || null,
        invoiceDate: convertToTimestampIfValid(invoiceDate),
        totalAmount: extractedTotalAmount ?? 0,
        itemCount: productsFromDoc.length,
        paymentMethod: paymentMethod || null,
        paymentDueDate: convertToTimestampIfValid(paymentDueDate),
        paymentStatus: "unpaid",
        products: savedProductsWithFinalIds.map((p) => p.id),
        isArchived: false,
        rawScanResultJson: rawScanResultJson || null,
        caspitPurchaseDocId: null,
        syncError: null,
        paymentReceiptImageUri: null,
        originalImagePreviewUri: originalImagePreviewDataUri || null,
        compressedImageForFinalRecordUri:
          compressedImageForFinalRecordDataUri || null,
        errorMessage: null,
        linkedDeliveryNoteId: null,
        _displayContext: "full_details",
      };

      transaction.set(finalInvoiceRef, invoiceData);
      finalInvoiceRecord = invoiceData as unknown as InvoiceHistoryItem;
    });

    // Caspit sync logic (non-transactional, runs after success)
    try {
      const userSettings = await getUserSettingsService(userId);
      if (
        userSettings.posSystemId === "caspit" &&
        userSettings.posConfig &&
        finalSupplierId
      ) {
        const supplierDocRef = doc(
          firestoreDb,
          SUPPLIERS_COLLECTION,
          finalSupplierId
        );
        const supplierDoc = await getDoc(supplierDocRef);

        const invoiceDocRef = doc(
          firestoreDb,
          DOCUMENTS_COLLECTION,
          finalInvoiceRecord.id
        );
        const invoiceDoc = await getDoc(invoiceDocRef);

        if (supplierDoc.exists() && invoiceDoc.exists()) {
          const supplierData = supplierDoc.data();
          const invoiceData = invoiceDoc.data();
          let caspitContactId = supplierData.caspitAccountId;

          if (!caspitContactId) {
            // Create a plain serializable object for the supplier
            const plainSupplierPayload = {
              id: finalSupplierId,
              userId: supplierData.userId,
              name: supplierData.name,
              invoiceCount: supplierData.invoiceCount,
              totalSpent: supplierData.totalSpent,
              phone: supplierData.phone || null,
              email: supplierData.email || null,
              paymentTerms: supplierData.paymentTerms || null,
              lastActivityDate:
                (supplierData.lastActivityDate as Timestamp)
                  ?.toDate()
                  ?.toISOString() ?? null,
              createdAt:
                (supplierData.createdAt as Timestamp)
                  ?.toDate()
                  ?.toISOString() ?? new Date().toISOString(),
              caspitAccountId: supplierData.caspitAccountId || null,
            };

            const contactResult = await createOrUpdateCaspitContactAction(
              userSettings.posConfig,
              plainSupplierPayload as unknown as SupplierSummary
            );
            if (contactResult.success && contactResult.caspitAccountId) {
              caspitContactId = contactResult.caspitAccountId;
              await updateDoc(supplierDocRef, {
                caspitAccountId: caspitContactId,
              });
            } else {
              throw new Error(
                `Caspit supplier sync failed: ${contactResult.message}`
              );
            }
          }
          if (caspitContactId) {
            // Create a plain serializable object for the invoice
            const plainInvoicePayload = {
              ...invoiceData,
              id: invoiceData.id || finalInvoiceRecord.id,
              uploadTime:
                (invoiceData.uploadTime as Timestamp)?.toDate().toISOString() ??
                new Date().toISOString(),
              invoiceDate:
                (invoiceData.invoiceDate as Timestamp)
                  ?.toDate()
                  .toISOString() ?? null,
              paymentDueDate:
                (invoiceData.paymentDueDate as Timestamp)
                  ?.toDate()
                  .toISOString() ?? null,
            };

            const documentResult = await createCaspitDocumentAction(
              userSettings.posConfig,
              plainInvoicePayload as InvoiceHistoryItem,
              savedProductsWithFinalIds,
              caspitContactId
            );
            if (documentResult.success && documentResult.caspitPurchaseDocId) {
              await updateDoc(invoiceDocRef, {
                caspitPurchaseDocId: documentResult.caspitPurchaseDocId,
                syncError: null,
              });
            } else {
              await updateDoc(invoiceDocRef, {
                syncError: `Caspit: ${documentResult.message}`,
              });
            }
          }
        }
      }
    } catch (caspitError: any) {
      console.error(
        "[Backend] Non-blocking error during Caspit sync:",
        caspitError
      );
      if (finalInvoiceRecord) {
        const invoiceDocRef = doc(
          firestoreDb,
          DOCUMENTS_COLLECTION,
          finalInvoiceRecord.id
        );
        await updateDoc(invoiceDocRef, {
          syncError: `Caspit Sync Failed: ${caspitError.message}`,
        });
      }
    }

    return { finalInvoiceRecord, savedProductsWithFinalIds };
  } catch (error) {
    console.error("[Backend finalizeSaveProductsService] Error:", error);
    throw error;
  }
}

// --- Supplier Management (Firestore) ---
export async function getSupplierSummariesService(
  userId: string
): Promise<SupplierSummary[]> {
  if (!db) {
    console.error(
      "Firestore (db) is not initialized in getSupplierSummariesService."
    );
    return [];
  }
  if (!userId) {
    console.warn("getSupplierSummariesService called without userId");
    return [];
  }

  const suppliersQuery = query(
    collection(db, SUPPLIERS_COLLECTION),
    where("userId", "==", userId)
  );
  // Fetch all documents for the user, then filter by status and calculate totals in code
  const documentsQuery = query(
    collection(db, DOCUMENTS_COLLECTION),
    where("userId", "==", userId)
  );

  try {
    const [suppliersSnapshot, allDocumentsSnapshot] = await Promise.all([
      getDocs(suppliersQuery),
      getDocs(documentsQuery),
    ]);

    const supplierMap = new Map<string, SupplierSummary>();

    suppliersSnapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const createdAtTimestamp =
        data.createdAt instanceof Timestamp
          ? data.createdAt
          : serverTimestamp();
      let lastActivityDateValue: string | Timestamp | null = null;
      if (data.lastActivityDate instanceof Timestamp) {
        lastActivityDateValue = data.lastActivityDate.toDate().toISOString();
      } else if (
        typeof data.lastActivityDate === "string" &&
        isValid(parseISO(data.lastActivityDate))
      ) {
        lastActivityDateValue = data.lastActivityDate;
      }

      if (
        data.name &&
        typeof data.name === "string" &&
        data.name.trim() !== ""
      ) {
        supplierMap.set(data.name, {
          id: docSnap.id,
          userId,
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          paymentTerms: data.paymentTerms || null,
          invoiceCount: 0,
          totalSpent: 0,
          lastActivityDate: lastActivityDateValue,
          createdAt: createdAtTimestamp,
        });
      } else {
        console.warn(
          `[Backend] Supplier document ${docSnap.id} for user ${userId} is missing a valid name.`
        );
      }
    });

    allDocumentsSnapshot.docs.forEach((docSnap) => {
      const docData = docSnap.data();
      // Ensure we are looking at completed documents for financial summaries
      if (
        docData.supplierName &&
        typeof docData.supplierName === "string" &&
        docData.status === "completed"
      ) {
        const supplierEntry = supplierMap.get(docData.supplierName);
        if (supplierEntry) {
          supplierEntry.invoiceCount += 1;
          supplierEntry.totalSpent += Number(docData.totalAmount) || 0;

          let docUploadDate: Date | null = null;
          if (docData.uploadTime) {
            if (docData.uploadTime instanceof Timestamp)
              docUploadDate = docData.uploadTime.toDate();
            else if (
              typeof docData.uploadTime === "string" &&
              isValid(parseISO(docData.uploadTime))
            )
              docUploadDate = parseISO(docData.uploadTime);
          }

          let currentLastActivityDate: Date | null = null;
          if (supplierEntry.lastActivityDate) {
            if (supplierEntry.lastActivityDate instanceof Timestamp)
              currentLastActivityDate = supplierEntry.lastActivityDate.toDate();
            else if (
              typeof supplierEntry.lastActivityDate === "string" &&
              isValid(parseISO(supplierEntry.lastActivityDate))
            )
              currentLastActivityDate = parseISO(
                supplierEntry.lastActivityDate
              );
          }

          if (
            docUploadDate &&
            (!currentLastActivityDate ||
              docUploadDate > currentLastActivityDate)
          ) {
            supplierEntry.lastActivityDate = docUploadDate.toISOString();
          }
          supplierMap.set(docData.supplierName, supplierEntry);
        }
      }
    });
    return Array.from(supplierMap.values()).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "")
    );
  } catch (error) {
    console.error(
      "[Backend getSupplierSummariesService] Error fetching supplier summaries from Firestore:",
      error
    );
    if (
      (error as any).message &&
      (error as any).message.includes("The query requires an index")
    ) {
      console.error(
        "Firestore missing index error for suppliers or documents. Please create the suggested index in your Firebase console."
      );
    }
    throw error;
  }
}

export async function createSupplierService(
  name: string,
  contactInfo: { phone?: string; email?: string; paymentTerms?: string },
  userId: string
): Promise<SupplierSummary> {
  if (!db)
    throw new Error("Database not initialized for createSupplierService.");
  if (!userId)
    throw new Error(
      "User authentication is required for createSupplierService."
    );
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  console.log(
    `[Backend - createSupplierService] Checking for existing supplier: Name='${normalizedName}', UserID='${userId}'`
  );
  const q = query(
    collection(db, SUPPLIERS_COLLECTION),
    where("userId", "==", userId),
    where("name", "==", normalizedName)
  );
  const existing = await getDocs(q);
  if (!existing.empty) {
    console.warn(
      `[Backend - createSupplierService] Supplier with name "${normalizedName}" already exists for user ${userId}.`
    );
    throw new Error(`Supplier with name "${normalizedName}" already exists.`);
  }

  const newSupplierRef = doc(collection(db, SUPPLIERS_COLLECTION));
  const newSupplierData: Omit<
    SupplierSummary,
    "id" | "createdAt" | "lastActivityDate" | "invoiceCount" | "totalSpent"
  > & { userId: string; createdAt: FieldValue } = {
    name: normalizedName,
    phone: contactInfo.phone?.trim() || null,
    email: contactInfo.email?.trim() || null,
    paymentTerms: contactInfo.paymentTerms?.trim() || null,
    userId: userId,
    createdAt: serverTimestamp(),
  };
  console.log(
    `[Backend - createSupplierService] Attempting to save new supplier with data:`,
    newSupplierData,
    `for userId: ${userId}`
  );
  await setDoc(newSupplierRef, sanitizeForFirestore(newSupplierData));
  console.log(
    `[Backend] New supplier ${newSupplierRef.id} created for user ${userId}.`
  );

  const now = Timestamp.now();
  return {
    id: newSupplierRef.id,
    userId,
    name: normalizedName,
    phone: newSupplierData.phone,
    email: newSupplierData.email,
    paymentTerms: newSupplierData.paymentTerms,
    invoiceCount: 0,
    totalSpent: 0,
    lastActivityDate: null,
    createdAt: now,
  };
}

export async function deleteSupplierService(
  supplierId: string,
  userId: string
): Promise<void> {
  if (!db || !userId)
    throw new Error(
      "DB not initialized or User ID missing for deleteSupplierService."
    );

  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const supplierDoc = await getDoc(supplierRef);
  if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
    throw new Error(
      `Supplier not found or permission denied for deletion for supplier ID: ${supplierId}`
    );
  }
  await deleteDoc(supplierRef);
  console.log(`[Backend] Supplier ${supplierId} deleted for user ${userId}.`);
}

export async function clearSuppliersService(userId: string): Promise<void> {
  await deleteCollectionByUserId(SUPPLIERS_COLLECTION, userId);
}

export async function updateSupplierContactInfoService(
  supplierId: string,
  contactInfo: {
    phone?: string | null;
    email?: string | null;
    paymentTerms?: string | null;
  },
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");

  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const existingDoc = await getDoc(supplierRef);
  if (!existingDoc.exists() || existingDoc.data().userId !== userId) {
    throw new Error("Supplier not found or permission denied for update.");
  }

  const updatePayload: Partial<
    Pick<SupplierSummary, "phone" | "email" | "paymentTerms">
  > = {};
  let hasChanges = false;

  if (contactInfo.hasOwnProperty("phone")) {
    const newPhone = contactInfo.phone?.trim() || null;
    if (newPhone !== (existingDoc.data().phone || null)) {
      updatePayload.phone = newPhone;
      hasChanges = true;
    }
  }
  if (contactInfo.hasOwnProperty("email")) {
    const newEmail = contactInfo.email?.trim() || null;
    if (newEmail !== (existingDoc.data().email || null)) {
      updatePayload.email = newEmail;
      hasChanges = true;
    }
  }
  if (contactInfo.hasOwnProperty("paymentTerms")) {
    const newPaymentTerms = contactInfo.paymentTerms?.trim() || null;
    if (newPaymentTerms !== (existingDoc.data().paymentTerms || null)) {
      updatePayload.paymentTerms = newPaymentTerms;
      hasChanges = true;
    }
  }

  if (hasChanges) {
    console.log(
      `[Backend - updateSupplierContactInfoService] Updating supplier ${supplierId} with:`,
      updatePayload
    );
    await updateDoc(supplierRef, sanitizeForFirestore(updatePayload));
    console.log(
      `[Backend] Supplier contact info for ${supplierId} updated by user ${userId}.`
    );
  } else {
    console.log(
      `[Backend - updateSupplierContactInfoService] No changes to update for supplier ${supplierId}.`
    );
  }
}

// --- User Settings (Firestore) ---
export async function saveUserSettingsService(
  settings: Partial<Omit<UserSettings, "userId">>,
  userId: string
): Promise<void> {
  if (!db || !userId)
    throw new Error(
      "DB not initialized or User ID missing for saveUserSettingsService."
    );
  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);

  const settingsToSave: Partial<UserSettings> = JSON.parse(
    JSON.stringify(settings)
  );

  if (settingsToSave.hasOwnProperty("accountantSettings")) {
    settingsToSave.accountantSettings = settingsToSave.accountantSettings
      ? sanitizeForFirestore(settingsToSave.accountantSettings)
      : { name: null, email: null, phone: null };
  }
  if (settingsToSave.hasOwnProperty("posConfig")) {
    settingsToSave.posConfig = settingsToSave.posConfig
      ? sanitizeForFirestore(settingsToSave.posConfig)
      : {};
  }
  if (settingsToSave.hasOwnProperty("kpiPreferences")) {
    settingsToSave.kpiPreferences = settingsToSave.kpiPreferences
      ? sanitizeForFirestore(settingsToSave.kpiPreferences)
      : {
          visibleKpiIds: [
            "totalItems",
            "inventoryValue",
            "grossProfit",
            "currentMonthExpenses",
            "lowStock",
            "amountToPay",
          ],
          kpiOrder: [
            "totalItems",
            "inventoryValue",
            "grossProfit",
            "currentMonthExpenses",
            "lowStock",
            "amountToPay",
            "documentsProcessed30d",
            "averageInvoiceValue",
            "suppliersCount",
          ],
        };
  }
  if (settingsToSave.hasOwnProperty("quickActionPreferences")) {
    settingsToSave.quickActionPreferences =
      settingsToSave.quickActionPreferences
        ? sanitizeForFirestore(settingsToSave.quickActionPreferences)
        : {
            visibleQuickActionIds: [
              "scanDocument",
              "viewInventory",
              "viewDocuments",
              "addExpense",
              "openInvoices",
              "latestDocument",
            ],
            quickActionOrder: [
              "scanDocument",
              "viewInventory",
              "viewDocuments",
              "addExpense",
              "openInvoices",
              "latestDocument",
              "addSupplier",
            ],
          };
  }

  if (
    settingsToSave.hasOwnProperty("monthlyBudget") &&
    settingsToSave.monthlyBudget === undefined
  )
    settingsToSave.monthlyBudget = null;
  if (
    settingsToSave.hasOwnProperty("reminderDaysBefore") &&
    settingsToSave.reminderDaysBefore === undefined
  )
    settingsToSave.reminderDaysBefore = null;
  if (
    settingsToSave.hasOwnProperty("posSystemId") &&
    settingsToSave.posSystemId === undefined
  )
    settingsToSave.posSystemId = null;

  delete (settingsToSave as any).userId;

  console.log(
    "[Backend - saveUserSettingsService] Saving settings for user:",
    userId,
    settingsToSave
  );
  await setDoc(userSettingsRef, sanitizeForFirestore(settingsToSave as any), {
    merge: true,
  });
}

export async function getUserSettingsService(
  userId: string
): Promise<UserSettings> {
  const defaultSettings: UserSettings = {
    userId: userId || "",
    reminderDaysBefore: 3,
    posSystemId: null,
    posConfig: {},
    accountantSettings: { name: null, email: null, phone: null },
    monthlyBudget: null,
    kpiPreferences: {
      visibleKpiIds: [
        "totalItems",
        "inventoryValue",
        "grossProfit",
        "currentMonthExpenses",
        "lowStock",
        "amountToPay",
      ],
      kpiOrder: [
        "totalItems",
        "inventoryValue",
        "grossProfit",
        "currentMonthExpenses",
        "lowStock",
        "amountToPay",
        "documentsProcessed30d",
        "averageInvoiceValue",
        "suppliersCount",
      ],
    },
    quickActionPreferences: {
      visibleQuickActionIds: [
        "scanDocument",
        "viewInventory",
        "viewDocuments",
        "addExpense",
        "openInvoices",
        "latestDocument",
      ],
      quickActionOrder: [
        "scanDocument",
        "viewInventory",
        "viewDocuments",
        "addExpense",
        "openInvoices",
        "latestDocument",
        "addSupplier",
      ],
    },
  };
  if (!db || !userId) {
    console.warn(
      "[Backend] getUserSettingsService called without db or userId, returning defaults."
    );
    return defaultSettings;
  }

  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
  const docSnap = await getDoc(userSettingsRef);

  if (docSnap.exists()) {
    const data = docSnap.data();
    return {
      ...defaultSettings,
      ...data,
      userId,
      accountantSettings: data.accountantSettings
        ? {
            name: data.accountantSettings.name || null,
            email: data.accountantSettings.email || null,
            phone: data.accountantSettings.phone || null,
          }
        : defaultSettings.accountantSettings,
      posConfig: data.posConfig || defaultSettings.posConfig,
      kpiPreferences: data.kpiPreferences || defaultSettings.kpiPreferences,
      quickActionPreferences:
        data.quickActionPreferences || defaultSettings.quickActionPreferences,
      monthlyBudget:
        data.monthlyBudget === undefined ? null : data.monthlyBudget ?? null,
      reminderDaysBefore:
        data.reminderDaysBefore === undefined
          ? defaultSettings.reminderDaysBefore
          : data.reminderDaysBefore ?? null,
    };
  }
  console.log(
    `[Backend] No settings found for user ${userId}, returning defaults and creating initial settings doc.`
  );
  await setDoc(
    userSettingsRef,
    sanitizeForFirestore({ ...defaultSettings, userId } as any),
    { merge: true }
  );
  return defaultSettings;
}

// --- Other Expenses & Categories (Firestore) ---
export async function getOtherExpensesService(
  userId: string
): Promise<OtherExpense[]> {
  if (!db || !userId) {
    console.warn(
      "[Backend] getOtherExpensesService called without db or userId, returning empty array."
    );
    return [];
  }
  const expensesQuery = query(
    collection(db, OTHER_EXPENSES_COLLECTION),
    where("userId", "==", userId),
    orderBy("date", "desc")
  );
  try {
    const snapshot = await getDocs(expensesQuery);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        userId,
        date:
          data.date instanceof Timestamp
            ? data.date.toDate().toISOString()
            : data.date,
      } as OtherExpense;
    });
  } catch (error) {
    console.error(
      "[Backend] Error fetching other expenses from Firestore:",
      error
    );
    if (
      (error as any).message &&
      (error as any).message.includes("The query requires an index")
    ) {
      console.error(
        "Firestore missing index error for otherExpenses. Check browser console for link to create it."
      );
    }
    throw error;
  }
}

export async function saveOtherExpenseService(
  expenseData: Omit<OtherExpense, "id" | "userId" | "date"> & {
    id?: string;
    date: string | Date | Timestamp;
  },
  userId: string
): Promise<string> {
  if (!db || !userId)
    throw new Error(
      "User authentication required for saveOtherExpenseService."
    );

  const { id: expenseId, date: dateInput, ...dataToProcess } = expenseData;

  let dateForFirestore: Timestamp | FieldValue;
  // ✅ הבדיקות תקינות עכשיו כי OtherExpense.date יכול להיות גם Date
  if (dateInput instanceof Timestamp) {
    dateForFirestore = dateInput;
  } else if (dateInput instanceof Date && isValid(dateInput)) {
    // בדוק Date לפני string
    dateForFirestore = Timestamp.fromDate(dateInput);
  } else if (typeof dateInput === "string" && isValid(parseISO(dateInput))) {
    dateForFirestore = Timestamp.fromDate(parseISO(dateInput));
  } else {
    console.warn(
      `[Backend] Invalid date provided for expense, defaulting to server timestamp:`,
      dateInput
    );
    dateForFirestore = serverTimestamp(); // Fallback
  }

  const dataToSave: any = {
    ...dataToProcess,
    userId,
    date: dateForFirestore,
    _internalCategoryKey: dataToProcess._internalCategoryKey || null,
    categoryId: dataToProcess.categoryId || null,
  };
  // הסר את השדה createdAt אם הוא לא אמור להיות כאן בעדכון, אלא רק ביצירה
  // if (expenseId) delete dataToSave.createdAt;

  if (expenseId) {
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    await updateDoc(
      docRef,
      sanitizeForFirestore({ ...dataToSave, lastUpdatedAt: serverTimestamp() })
    );
    return expenseId;
  } else {
    const newDocRef = doc(collection(db, OTHER_EXPENSES_COLLECTION));
    // delete dataToSave.id; // No need if id is not part of dataToSave initially
    await setDoc(
      newDocRef,
      sanitizeForFirestore({ ...dataToSave, createdAt: serverTimestamp() })
    );
    return newDocRef.id;
  }
}

export async function deleteOtherExpenseService(
  expenseId: string,
  userId: string
): Promise<void> {
  if (!db || !userId)
    throw new Error(
      "User authentication required for deleteOtherExpenseService."
    );
  const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists() || docSnap.data().userId !== userId) {
    throw new Error("Expense not found or permission denied.");
  }
  await deleteDoc(docRef);
  console.log(
    `[Backend] Other expense ${expenseId} deleted for user ${userId}.`
  );
}

export async function clearOtherExpensesService(userId: string): Promise<void> {
  await deleteCollectionByUserId(OTHER_EXPENSES_COLLECTION, userId);
}

export async function getExpenseCategoriesService(
  userId: string
): Promise<ExpenseCategory[]> {
  if (!db || !userId) {
    console.warn(
      "[Backend] getExpenseCategoriesService called without db or userId, returning empty array."
    );
    return [];
  }
  const categoriesQuery = query(
    collection(db, EXPENSE_CATEGORIES_COLLECTION),
    where("userId", "==", userId),
    orderBy("name")
  );
  try {
    const snapshot = await getDocs(categoriesQuery);
    return snapshot.docs.map(
      (docSnap) =>
        ({
          id: docSnap.id,
          userId,
          ...docSnap.data(),
          createdAt:
            docSnap.data().createdAt instanceof Timestamp
              ? docSnap.data().createdAt
              : serverTimestamp(),
        } as ExpenseCategory)
    );
  } catch (error) {
    console.error(
      "[Backend] Error fetching expense categories from Firestore:",
      error
    );
    if (
      (error as any).message &&
      (error as any).message.includes("The query requires an index")
    ) {
      console.error(
        "Firestore missing index error for expenseCategories. Check browser console for link to create it."
      );
    }
    throw error;
  }
}

export async function saveExpenseCategoryService(
  categoryData: Omit<ExpenseCategory, "id" | "userId" | "createdAt">,
  userId: string
): Promise<string> {
  if (!db || !userId)
    throw new Error(
      "User authentication required for saveExpenseCategoryService."
    );
  if (!categoryData.name || !categoryData.internalKey)
    throw new Error("Category name and internalKey are required.");

  const q = query(
    collection(db, EXPENSE_CATEGORIES_COLLECTION),
    where("userId", "==", userId),
    where("internalKey", "==", categoryData.internalKey)
  );
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(
      `Expense category with key "${categoryData.internalKey}" already exists for this user.`
    );
  }

  const newDocRef = doc(collection(db, EXPENSE_CATEGORIES_COLLECTION));
  const dataToSave: Omit<ExpenseCategory, "id"> = {
    ...categoryData,
    userId,
    createdAt: serverTimestamp(),
    isFixed: categoryData.isFixed ?? false,
    defaultAmount: categoryData.defaultAmount ?? null,
  };
  await setDoc(newDocRef, sanitizeForFirestore(dataToSave));
  console.log(
    `[Backend] New expense category ${newDocRef.id} created for user ${userId}.`
  );
  return newDocRef.id;
}

export async function clearExpenseCategoriesService(
  userId: string
): Promise<void> {
  await deleteCollectionByUserId(EXPENSE_CATEGORIES_COLLECTION, userId);
}

// --- Temporary Data Management for Uploads (Only rawScanResultJson if pending doc fails) ---
export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
  if (typeof window === "undefined" || !userId) return;
  if (!uniqueScanId) {
    console.warn(
      "[Backend - clearTemporaryScanData] Called without uniqueScanId for user:",
      userId
    );
    return;
  }
  try {
    const dataKey = getStorageKey(
      TEMP_DATA_KEY_PREFIX,
      `${userId}_${uniqueScanId}`
    );
    localStorage.removeItem(dataKey);
    console.log(
      `[Backend - clearTemporaryScanData] Cleared localStorage scan result (JSON) for key: ${dataKey}`
    );
  } catch (error) {
    console.error(
      `[Backend] Error removing temp localStorage key for UserID: ${userId}, ScanID: ${uniqueScanId}`,
      error
    );
  }
}

export function clearOldTemporaryScanData(
  emergencyClear: boolean = false,
  userIdToClear?: string
) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(TEMP_DATA_KEY_PREFIX)) {
      if (userIdToClear && !key.includes(`_${userIdToClear}_`)) {
        continue;
      }
      const parts = key.split("_");
      const timestampString = parts.find((part) => /^\d{13,}$/.test(part));
      const timestamp = timestampString ? parseInt(timestampString, 10) : null;

      if (
        emergencyClear &&
        (userIdToClear || !key.includes("_SHARED_OR_NO_USER_"))
      ) {
        keysToRemove.push(key);
      } else if (
        timestamp &&
        !isNaN(timestamp) &&
        now - timestamp > EXPIRY_DURATION_MS
      ) {
        keysToRemove.push(key);
      }
    }
  }
  keysToRemove.forEach((key) => {
    try {
      localStorage.removeItem(key);
      itemsCleared++;
    } catch (e) {
      console.error(`[Backend] Error removing key ${key}:`, e);
    }
  });
  if (itemsCleared > 0)
    console.log(
      `[Backend] Cleared ${itemsCleared} old/emergency temp scan JSON items from localStorage (User: ${
        userIdToClear || "All Relevant"
      }).`
    );
}

export async function reactivateProductService(
  productId: string,
  userId: string
): Promise<void> {
  if (!db || !userId || !productId) {
    throw new Error(
      "DB, User ID, or Product ID is missing for reactivateProductService."
    );
  }
  const productRef = doc(
    db,
    USERS_COLLECTION,
    userId,
    INVENTORY_COLLECTION,
    productId
  );
  try {
    await updateDoc(productRef, {
      isActive: true,
      lastUpdated: serverTimestamp(),
    });
    console.log(
      `[Backend] Product ${productId} reactivated for user ${userId}.`
    );

    // If Caspit POS is configured, attempt to update there as well
    // This part assumes you have a way to get userSettings, e.g., by fetching it or having it passed
    // For simplicity, let's assume posConfig is fetched/available if needed
    // const userSettings = await getUserSettingsService(userId); // Example: fetch settings
    // if (userSettings?.posSystemId === 'caspit' && userSettings.posConfig) {
    //   const productDoc = await getDoc(productRef);
    //   if (productDoc.exists()) {
    //      const productData = productDoc.data() as Product;
    //      await updateCaspitProductAction(productData, userSettings.posConfig, userId, productId, true); // true for isActive
    //   }
    // }
  } catch (error) {
    console.error(
      `[Backend - reactivateProductService] Error reactivating product ${productId} for user ${userId}:`,
      error
    );
    throw error; // Re-throw to allow caller to handle
  }
}

// Placeholder for archiveDocumentService
export async function archiveDocumentService(
  documentId: string,
  userId: string
): Promise<void> {
  if (!db || !documentId || !userId) {
    throw new Error(
      "DB, Document ID, or User ID is missing for archiveDocumentService."
    );
  }
  const docRef = doc(db, DOCUMENTS_COLLECTION, documentId);
  // Ensure the document belongs to the user before archiving - this is a basic check.
  // A more robust check might involve a specific field like 'userId' on the document itself.
  // For now, we assume if we have a documentId, it's scoped correctly or this check is illustrative.
  const documentSnap = await getDoc(docRef);
  if (!documentSnap.exists() || documentSnap.data()?.userId !== userId) {
    console.error(
      `[Backend - archiveDocumentService] Document ${documentId} not found or does not belong to user ${userId}.`
    );
    throw new Error("Document not found or permission denied.");
  }

  try {
    await updateDoc(docRef, {
      // Add an 'isArchived' field or similar to mark as archived
      // For example: status: 'archived' or isArchived: true
      status: "archived", // Assuming 'status' field can hold this value
      lastUpdated: serverTimestamp(),
    });
    console.log(
      `[Backend - archiveDocumentService] Document ${documentId} archived for user ${userId}.`
    );
  } catch (error) {
    console.error(
      `[Backend - archiveDocumentService] Error archiving document ${documentId} for user ${userId}:`,
      error
    );
    throw error;
  }
}
