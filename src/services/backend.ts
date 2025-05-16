
// src/services/backend.ts
'use client';

import { db, auth as firebaseAuth } from '@/lib/firebase';
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
  deleteField,
  runTransaction
} from "firebase/firestore";
import { parseISO, isValid } from 'date-fns';
import type { PosConnectionConfig } from './pos-integration/pos-adapter.interface';

// Firestore Collection Names
export const USERS_COLLECTION = "users";
export const INVENTORY_COLLECTION = "inventoryProducts";
export const DOCUMENTS_COLLECTION = "documents";
export const SUPPLIERS_COLLECTION = "suppliers";
export const OTHER_EXPENSES_COLLECTION = "otherExpenses";
export const EXPENSE_CATEGORIES_COLLECTION = "expenseCategories";
export const EXPENSE_TEMPLATES_COLLECTION = "expenseTemplates";
export const USER_SETTINGS_COLLECTION = "userSettings";


export interface User {
  id: string;
  username?: string;
  email?: string | null;
  createdAt?: Timestamp | FieldValue;
  lastLoginAt?: Timestamp | FieldValue;
}

export interface Product {
  id: string;
  userId?: string;
  catalogNumber: string;
  description: string;
  shortName?: string;
  barcode?: string | null;
  quantity: number;
  unitPrice: number; // Represents cost price
  salePrice?: number | null;
  lineTotal: number; // Typically quantity * unitPrice (cost price) from the document
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
  imageUrl?: string | null;
  _originalId?: string; // Internal use, e.g., for matching during edits
  lastUpdated?: Timestamp | FieldValue;
}

export interface InvoiceHistoryItem {
  id: string;
  userId: string;
  originalFileName: string;
  generatedFileName: string;
  uploadTime: string | Timestamp;
  status: 'pending' | 'processing' | 'completed' | 'error';
  documentType: 'deliveryNote' | 'invoice' | 'paymentReceipt';
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Timestamp | null;
  totalAmount?: number | null;
  paymentMethod?: string | null;
  paymentDueDate?: string | Timestamp | null;
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentReceiptImageUri?: string | null;
  originalImagePreviewUri?: string | null;
  compressedImageForFinalRecordUri?: string | null;
  errorMessage?: string | null;
  linkedDeliveryNoteId?: string | null;
}


export interface DocumentLineItem {
  documentId?: string;
  userId?: string;
  productId?: string;
  productName: string;
  catalogNumber?: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  shortProductName?: string;
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
}

export interface AccountantSettings {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface UserSettings {
  userId: string;
  reminderDaysBefore?: number | null;
  posSystemId?: string | null;
  posConfig?: PosConnectionConfig | null;
  accountantSettings?: AccountantSettings | null;
  monthlyBudget?: number | null;
  kpiPreferences?: { visibleKpiIds: string[], kpiOrder: string[] } | null;
  quickActionPreferences?: { visibleQuickActionIds: string[], quickActionOrder: string[] } | null;
}

export interface OtherExpense {
  id: string;
  userId: string;
  description: string;
  amount: number;
  date: string | Timestamp;
  category: string;
  _internalCategoryKey?: string | null;
}

export interface ExpenseCategory {
  id: string;
  userId: string;
  name: string;
  internalKey: string;
  isFixed?: boolean;
  defaultAmount?: number;
  createdAt: Timestamp | FieldValue;
}


export interface ExpenseTemplate {
  id: string;
  userId: string;
  name: string;
  categoryKey: string;
  description: string;
  amount: number;
  createdAt: Timestamp | FieldValue;
}

// --- Storage Keys for localStorage (mostly for UI preferences now) ---
export const KPI_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_kpiPreferences_v2';
export const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_quickActionsPreferences_v1';
export const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget';

// --- Storage Keys for temporary data during scan process (localStorage) ---
export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

// --- Storage Limits (localStorage) ---
export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.3 * 1024 * 1024; // 0.3MB
// const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.15 * 1024 * 1024; // 0.15MB - This was removed as we use it in upload
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.4 * 1024 * 1024; // 0.4MB for scan results JSON
export const MAX_INVOICE_HISTORY_ITEMS = 10; // For local storage history if ever re-enabled


export interface ProductPriceDiscrepancy extends Product {
  existingUnitPrice: number;
  newUnitPrice: number;
}

export interface PriceCheckResult {
  productsToSaveDirectly: Product[];
  priceDiscrepancies: ProductPriceDiscrepancy[];
}


export const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(`[getStorageKey] Called with base "${baseKey}" but no userId. This might lead to shared data or issues.`);
    return `${baseKey}_SHARED_OR_NO_USER`;
  }
  return `${baseKey}_${userId}`;
};

export const getStoredData = <T extends {id?: string; name?: string}>(keyBase: string, userId?: string, defaultDataIfNoUserOrError: T[] = []): T[] => {
  if (typeof window === 'undefined') return defaultDataIfNoUserOrError;
  const storageKey = getStorageKey(keyBase, userId);
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsedData = JSON.parse(stored) as T[];
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || (item.name ? `${keyBase}-item-${item.name.replace(/\s+/g, '_')}-${index}` : `${keyBase}-item-${Date.now()}-${index}-${Math.random().toString(36).substring(2,7)}`)
      }));
    }
    return defaultDataIfNoUserOrError;
  } catch (error) {
    console.error(`Error reading ${storageKey} from localStorage:`, error);
    return defaultDataIfNoUserOrError;
  }
};

const saveStoredData = (keyBase: string, data: any, userId?: string): boolean => {
  if (typeof window === 'undefined') return false;
  if (!userId && ![KPI_PREFERENCES_STORAGE_KEY_BASE, QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE].includes(keyBase)) {
    console.warn(`[saveStoredData] Attempted to save data for base "${keyBase}" without a userId. Operation aborted unless it's a known shared preference.`);
    return false;
  }
  const storageKey = getStorageKey(keyBase, userId);
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
    return true;
  } catch (error: any) {
    console.error(`Error writing to localStorage for key ${storageKey}:`, error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.includes('exceeded the quota'))) {
      console.warn(`Quota exceeded for key ${storageKey}. Attempting to clear old temporary scan data and retry...`);
      try {
        clearOldTemporaryScanData(true, userId); 
        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log(`Successfully saved to localStorage after cleanup for key ${storageKey}`);
        return true;
      } catch (retryError) {
        console.error(`Error writing ${storageKey} to localStorage even after cleanup:`, retryError);
        const quotaError = new Error(`Failed to save data to localStorage after cleanup due to storage quota: ${(retryError as Error).message}`);
        (quotaError as any).isQuotaError = true;
        throw quotaError;
      }
    } else {
        const genericError = new Error(`Failed to save data to localStorage: ${(error as Error).message}`);
        (genericError as any).isQuotaError = false;
        throw genericError;
    }
  }
};

// Helper to sanitize data for Firestore (replace undefined with null)
export function sanitizeForFirestore<T extends object>(data: T): T {
  const sanitizedData = { ...data } as Record<string, any>; // Type assertion for broader key access
  for (const key in sanitizedData) {
    if (sanitizedData[key] === undefined) {
      sanitizedData[key] = null; // Replace undefined with null
    }
  }
  return sanitizedData as T;
}


// --- User Management (Firestore) ---
export async function saveUserToFirestore(userData: User): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userData.id) throw new Error("User ID is missing for saveUserToFirestore.");
  
  const userRef = doc(db, USERS_COLLECTION, userData.id);
  const dataToSave: Partial<User> = sanitizeForFirestore({ ...userData });
  
  try {
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      dataToSave.createdAt = serverTimestamp();
    }
    dataToSave.lastLoginAt = serverTimestamp();
    await setDoc(userRef, dataToSave, { merge: true });
  } catch (error) {
    console.error("Error saving user to Firestore:", error);
    throw error;
  }
}

export async function getUserFromFirestore(userId: string): Promise<User | null> {
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
      return { id: docSnap.id, ...docSnap.data() } as User;
    }
    return null;
  } catch (error) {
    console.error("Error fetching user from Firestore:", error);
    throw error;
  }
}

// --- Inventory Product Management (Firestore) ---
export async function getProductsService(userId: string): Promise<Product[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getProductsService.");
    return [];
  }
  if (!userId) {
    console.warn("getProductsService called without userId");
    return [];
  }
  
  const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), orderBy("shortName"));
  try {
    const snapshot = await getDocs(productsQuery);
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Product));
  } catch (error) {
    console.error("Error fetching products from Firestore:", error);
    throw error;
  }
}

export async function getProductByIdService(productId: string, userId: string): Promise<Product | null> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getProductByIdService.");
    return null;
  }
  if (!userId) {
    console.warn("getProductByIdService called without userId");
    return null;
  }
  
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  try {
    const docSnap = await getDoc(productRef);
    if (docSnap.exists() && docSnap.data().userId === userId) {
      return { id: docSnap.id, ...docSnap.data() } as Product;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function updateProductService(productId: string, updatedData: Partial<Product>, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for updateProductService.");
  
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  const dataToUpdate: Partial<Product> & { userId: string, lastUpdated: FieldValue } = {
    ...sanitizeForFirestore(updatedData),
    userId, 
    lastUpdated: serverTimestamp()
  };

  try {
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists() || productDoc.data().userId !== userId) {
      throw new Error("Permission denied or product not found for update.");
    }
    await updateDoc(productRef, dataToUpdate);
  } catch (error) {
    console.error(`Error updating product ${productId} in Firestore:`, error);
    throw error;
  }
}

export async function deleteProductService(productId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for deleteProductService.");
  
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  try {
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists() || productDoc.data().userId !== userId) {
      throw new Error("Permission denied or product not found for deletion.");
    }
    await deleteDoc(productRef);
  } catch (error) {
    console.error(`Error deleting product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function clearInventoryService(userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for clearInventoryService.");
  
  const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId));
  try {
    const snapshot = await getDocs(productsQuery);
    if (snapshot.empty) return;
    const batchOp = writeBatch(db);
    snapshot.docs.forEach(docSnap => batchOp.delete(docSnap.ref));
    await batchOp.commit();
  } catch (error) {
    console.error("Error clearing inventory from Firestore:", error);
    throw error;
  }
}

// --- Document (Invoice/Delivery Note) Management (Firestore) ---
export async function getInvoicesService(userId: string): Promise<InvoiceHistoryItem[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getInvoicesService.");
    return [];
  }
  if (!userId) {
    console.warn("getInvoicesService called without userId");
    return [];
  }
  
  const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), orderBy("uploadTime", "desc"));
  try {
    const snapshot = await getDocs(documentsQuery);
    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const convertTimestampToString = (field: any) => {
            if (field instanceof Timestamp) return field.toDate().toISOString();
            if (typeof field === 'string' && isValid(parseISO(field))) return field; // Already ISO string
            return null; // Or some default/error indicator
        };
        return {
            id: docSnap.id, ...data,
            uploadTime: convertTimestampToString(data.uploadTime),
            invoiceDate: convertTimestampToString(data.invoiceDate),
            paymentDueDate: convertTimestampToString(data.paymentDueDate),
        } as InvoiceHistoryItem;
    });
  } catch (error) {
    console.error("Error fetching documents from Firestore:", error);
    throw error;
  }
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for updateInvoiceService.");

  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const dataToUpdate: any = sanitizeForFirestore({ ...updatedData, userId }); 

  const convertToTimestampIfValidString = (dateField: any) => {
    if (dateField && typeof dateField === 'string' && isValid(parseISO(dateField))) {
      return Timestamp.fromDate(parseISO(dateField));
    }
    return dateField instanceof Timestamp ? dateField : null;
  };

  dataToUpdate.invoiceDate = convertToTimestampIfValidString(dataToUpdate.invoiceDate);
  dataToUpdate.paymentDueDate = convertToTimestampIfValidString(dataToUpdate.paymentDueDate);

  if (updatedData.uploadTime === undefined) {
    delete dataToUpdate.uploadTime;
  } else {
    dataToUpdate.uploadTime = convertToTimestampIfValidString(dataToUpdate.uploadTime) || serverTimestamp(); // Fallback to serverTimestamp if still invalid
  }


  try {
    const docSnap = await getDoc(docRef);
    if(!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for update.");
    }
    await updateDoc(docRef, dataToUpdate);
  } catch (error) {
    console.error(`Error updating document ${invoiceId} in Firestore:`, error);
    throw error;
  }
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId: string, paymentReceiptImageUri?: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for updateInvoicePaymentStatusService.");
  
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const updateData: any = sanitizeForFirestore({ 
      paymentStatus, 
      userId,
  });
 
  if (paymentStatus === 'paid' && paymentReceiptImageUri !== undefined) {
    updateData.paymentReceiptImageUri = paymentReceiptImageUri;
  } else if (paymentStatus !== 'paid') { // Clear receipt if not paid
    updateData.paymentReceiptImageUri = deleteField();
  }


  try {
     const docSnap = await getDoc(docRef);
     if(!docSnap.exists() || docSnap.data().userId !== userId) {
        throw new Error("Permission denied or document not found for payment status update.");
     }
    await updateDoc(docRef, updateData);
  } catch (error) {
    console.error(`Error updating payment status for document ${invoiceId}:`, error);
    throw error;
  }
}

export async function deleteInvoiceService(invoiceId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for deleteInvoiceService.");
  
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  try {
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for deletion.");
    }
    await deleteDoc(docRef);
  } catch (error) {
    console.error(`Error deleting document ${invoiceId} from Firestore:`, error);
    throw error;
  }
}


export async function checkProductPricesBeforeSaveService(
  productsToCheck: Product[],
  userId: string
): Promise<PriceCheckResult> {
  if (!db) {
    console.error("Firestore (db) is not initialized in checkProductPricesBeforeSaveService.");
    return { productsToSaveDirectly: productsToCheck, priceDiscrepancies: [] };
  }
  if (!userId) {
    console.warn("checkProductPricesBeforeSaveService called without userId");
    return { productsToSaveDirectly: productsToCheck, priceDiscrepancies: [] };
  }

  const productsToSaveDirectly: Product[] = [];
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

  for (const product of productsToCheck) {
    const currentProductUnitPrice = typeof product.unitPrice === 'number' ? product.unitPrice : parseFloat(String(product.unitPrice));
    if (isNaN(currentProductUnitPrice)) {
      productsToSaveDirectly.push(product); // Cannot compare if new price is invalid, save as is
      continue;
    }
    const productWithNumericPrice = { ...product, unitPrice: currentProductUnitPrice };

    // If it's a new product (temp ID or no ID), no existing price to check against.
    if (!product.id || product.id.startsWith('prod-temp-') || product.id.includes('-new')) {
      productsToSaveDirectly.push(productWithNumericPrice);
      continue;
    }

    try {
      const existingProductRef = doc(db, INVENTORY_COLLECTION, product.id);
      const existingProductSnap = await getDoc(existingProductRef);

      if (existingProductSnap.exists() && existingProductSnap.data().userId === userId) {
        const existingProductData = existingProductSnap.data() as Product;
        const existingUnitPrice = typeof existingProductData.unitPrice === 'number' ? existingProductData.unitPrice : parseFloat(String(existingProductData.unitPrice));
        
        // Only flag as discrepancy if existing price is valid and different from new valid price
        if (!isNaN(existingUnitPrice) && Math.abs(existingUnitPrice - productWithNumericPrice.unitPrice) > 0.001 && productWithNumericPrice.unitPrice > 0) {
          priceDiscrepancies.push({
            ...productWithNumericPrice,
            existingUnitPrice: existingUnitPrice,
            newUnitPrice: productWithNumericPrice.unitPrice,
          });
        } else {
          productsToSaveDirectly.push(productWithNumericPrice); // Prices are same or existing was invalid
        }
      } else {
        productsToSaveDirectly.push(productWithNumericPrice); // No existing product found with this ID (or permission issue)
      }
    } catch (error) {
      console.error(`Error checking price for product ID ${product.id || product.catalogNumber}:`, error);
      productsToSaveDirectly.push(productWithNumericPrice); // Save product as is on error
    }
  }
  return { productsToSaveDirectly, priceDiscrepancies };
}


// --- Save Scanned/Edited Document and Update Inventory (Firestore) ---
export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileNameFromUpload: string,
    documentType: 'deliveryNote' | 'invoice',
    userId: string,
    tempInvoiceId?: string,
    extractedInvoiceNumber?: string | null,
    finalSupplierName?: string | null,
    extractedTotalAmount?: number | null,
    paymentDueDate?: string | Date | Timestamp | null,
    invoiceDate?: string | Date | Timestamp | null,
    paymentMethod?: string | null,
    originalImagePreviewUriToSave?: string | null,
    compressedImageForFinalRecordUriToSave?: string | null
): Promise<{
  finalInvoiceRecord?: InvoiceHistoryItem;
  savedProductsWithFinalIds?: Product[];
}> {
    if (!db) throw new Error("Database not initialized for finalizeSaveProductsService.");
    if (!userId) throw new Error("User authentication is required for finalizeSaveProductsService.");
    console.log(`[finalizeSaveProductsService] Starting. User: ${userId}, DocType: ${documentType}, TempID: ${tempInvoiceId}, Products Count: ${productsToFinalizeSave.length}`);

    const savedProductsWithFinalIds: Product[] = [];
    let calculatedInvoiceTotalAmountFromProducts = 0;
    const batchOp = writeBatch(db);

    const shouldUpdateInventory = documentType === 'deliveryNote';

    if (shouldUpdateInventory && productsToFinalizeSave.length > 0) {
        console.log("[finalizeSaveProductsService] Processing products for inventory update...");
        for (const productFromDoc of productsToFinalizeSave) {
            const quantityFromDoc = parseFloat(String(productFromDoc.quantity)) || 0;
            let unitPriceFromDoc = parseFloat(String(productFromDoc.unitPrice)) || 0;
            const lineTotalFromDoc = parseFloat(String(productFromDoc.lineTotal)) || 0;

            if (unitPriceFromDoc === 0 && quantityFromDoc !== 0 && lineTotalFromDoc !== 0) {
                unitPriceFromDoc = parseFloat((lineTotalFromDoc / quantityFromDoc).toFixed(2));
            }
            calculatedInvoiceTotalAmountFromProducts += lineTotalFromDoc;

            let existingProductRef;
            let existingProductData: Product | undefined = undefined;

            if (productFromDoc.id && !productFromDoc.id.startsWith('prod-temp-') && !productFromDoc.id.includes('-new')) {
                existingProductRef = doc(db, INVENTORY_COLLECTION, productFromDoc.id);
                const snap = await getDoc(existingProductRef);
                if (snap.exists() && snap.data().userId === userId) {
                    existingProductData = { id: snap.id, ...snap.data() } as Product;
                }
            }
            if (!existingProductData && productFromDoc.catalogNumber && productFromDoc.catalogNumber !== 'N/A') {
                const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productFromDoc.catalogNumber), limit(1));
                const catSnap = await getDocs(qCat);
                if (!catSnap.empty) {
                    existingProductRef = catSnap.docs[0].ref;
                    existingProductData = { id: catSnap.docs[0].id, ...catSnap.docs[0].data() } as Product;
                }
            }
            if (!existingProductData && productFromDoc.barcode && productFromDoc.barcode.trim() !== '') {
                const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productFromDoc.barcode.trim()), limit(1));
                const barSnap = await getDocs(qBar);
                if (!barSnap.empty) {
                    existingProductRef = barSnap.docs[0].ref;
                    existingProductData = { id: barSnap.docs[0].id, ...barSnap.docs[0].data() } as Product;
                }
            }

            if (existingProductRef && existingProductData) {
                console.log(`[finalizeSaveProductsService] Updating existing product: ${existingProductData.id} (${existingProductData.shortName || existingProductData.description})`);
                const currentInventoryQuantity = Number(existingProductData.quantity) || 0;
                const updatedQuantity = currentInventoryQuantity + quantityFromDoc;
                const newCostPrice = unitPriceFromDoc > 0 ? unitPriceFromDoc : (existingProductData.unitPrice || 0);

                const updatePayload: Partial<Product> = {
                    quantity: updatedQuantity,
                    unitPrice: newCostPrice, // Update cost price from document
                    lastUpdated: serverTimestamp(),
                    // Preserve existing values unless new ones are explicitly provided from document/dialog
                    description: productFromDoc.description && productFromDoc.description.trim() !== '' ? productFromDoc.description : existingProductData.description,
                    shortName: productFromDoc.shortName && productFromDoc.shortName.trim() !== '' ? productFromDoc.shortName : existingProductData.shortName,
                    barcode: productFromDoc.barcode && productFromDoc.barcode.trim() !== '' ? productFromDoc.barcode.trim() : (existingProductData.barcode || null),
                    salePrice: productFromDoc.salePrice !== undefined ? Number(productFromDoc.salePrice) : (existingProductData.salePrice ?? null),
                    minStockLevel: productFromDoc.minStockLevel !== undefined ? Number(productFromDoc.minStockLevel) : (existingProductData.minStockLevel ?? null),
                    maxStockLevel: productFromDoc.maxStockLevel !== undefined ? Number(productFromDoc.maxStockLevel) : (existingProductData.maxStockLevel ?? null),
                    imageUrl: productFromDoc.imageUrl || existingProductData.imageUrl || null,
                };
                updatePayload.lineTotal = parseFloat(((updatedQuantity || 0) * (newCostPrice || 0)).toFixed(2));

                batchOp.update(existingProductRef, sanitizeForFirestore(updatePayload));
                savedProductsWithFinalIds.push({ ...existingProductData, ...updatePayload } as Product);

            } else {
                if (!productFromDoc.catalogNumber && !productFromDoc.description && !productFromDoc.barcode) {
                    console.warn("[finalizeSaveProductsService] Skipping new product as it lacks key identifiers:", productFromDoc);
                    continue;
                }
                console.log(`[finalizeSaveProductsService] Creating new product: ${productFromDoc.shortName || productFromDoc.description}`);
                const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
                const productDataForFirestore: Omit<Product, 'id'> & { id?: string } = { // Prepare data for Firestore, ID added by setDoc
                    userId,
                    catalogNumber: productFromDoc.catalogNumber || 'N/A',
                    description: productFromDoc.description || 'No Description',
                    shortName: productFromDoc.shortName || (productFromDoc.description || 'No Description').split(' ').slice(0, 3).join(' '),
                    barcode: (productFromDoc.barcode && productFromDoc.barcode.trim() !== '') ? productFromDoc.barcode.trim() : null,
                    quantity: quantityFromDoc,
                    unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : 0,
                    salePrice: productFromDoc.salePrice !== undefined ? Number(productFromDoc.salePrice) : null,
                    lineTotal: parseFloat((quantityFromDoc * (unitPriceFromDoc > 0 ? unitPriceFromDoc : 0)).toFixed(2)),
                    minStockLevel: productFromDoc.minStockLevel !== undefined ? Number(productFromDoc.minStockLevel) : null,
                    maxStockLevel: productFromDoc.maxStockLevel !== undefined ? Number(productFromDoc.maxStockLevel) : null,
                    imageUrl: productFromDoc.imageUrl || null,
                    lastUpdated: serverTimestamp(),
                };

                const newProductData = sanitizeForFirestore({
                    ...productDataForFirestore,
                    id: newProductRef.id, // Set the ID for the object we push to savedProductsWithFinalIds
                }) as Product;

                batchOp.set(newProductRef, sanitizeForFirestore(productDataForFirestore)); // Pass data without id to Firestore
                savedProductsWithFinalIds.push({ ...newProductData });
            }
        }
    } else if (documentType === 'invoice' && productsToFinalizeSave.length > 0) {
        productsToFinalizeSave.forEach(productFromDoc => {
            calculatedInvoiceTotalAmountFromProducts += (parseFloat(String(productFromDoc.lineTotal)) || 0);
        });
    }

    const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && extractedTotalAmount !== null && !isNaN(extractedTotalAmount) && extractedTotalAmount > 0)
                                    ? extractedTotalAmount
                                    : parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2));

    let finalGeneratedFileName = originalFileNameFromUpload;
    if (finalSupplierName && finalSupplierName.trim() !== '') {
        finalGeneratedFileName = finalSupplierName.trim();
        if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
            finalGeneratedFileName += `_${extractedInvoiceNumber.trim()}`;
        }
    } else if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
        finalGeneratedFileName = `Invoice_${extractedInvoiceNumber.trim()}`;
    }
    finalGeneratedFileName = finalGeneratedFileName.replace(/[/\\?%*:|"<>]/g, '-').substring(0,100);

    const documentDataForFirestore: Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { uploadTime: Timestamp | FieldValue } = sanitizeForFirestore({
        userId,
        generatedFileName: finalGeneratedFileName,
        originalFileName: originalFileNameFromUpload,
        uploadTime: serverTimestamp(), // Use server timestamp for creation/update
        status: 'completed',
        documentType: documentType,
        invoiceNumber: extractedInvoiceNumber || null,
        supplierName: finalSupplierName || null,
        totalAmount: !isNaN(finalInvoiceTotalAmount) ? finalInvoiceTotalAmount : null,
        originalImagePreviewUri: originalImagePreviewUriToSave || null,
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave || null,
        paymentStatus: 'unpaid', // Default for new documents
        paymentDueDate: paymentDueDate instanceof Date ? Timestamp.fromDate(paymentDueDate) : (typeof paymentDueDate === 'string' && isValid(parseISO(paymentDueDate)) ? Timestamp.fromDate(parseISO(paymentDueDate)) : (paymentDueDate instanceof Timestamp ? paymentDueDate : null)),
        invoiceDate: invoiceDate instanceof Date ? Timestamp.fromDate(invoiceDate) : (typeof invoiceDate === 'string' && isValid(parseISO(invoiceDate)) ? Timestamp.fromDate(parseISO(invoiceDate)) : (invoiceDate instanceof Timestamp ? invoiceDate : null)),
        paymentMethod: paymentMethod || null,
        errorMessage: null,
        paymentReceiptImageUri: null,
        linkedDeliveryNoteId: null,
    }) as Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { uploadTime: Timestamp | FieldValue };
    
    let docRef;
    if (tempInvoiceId && tempInvoiceId.startsWith(`pending-inv-${userId}_`)) {
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        console.log(`[finalizeSaveProductsService] Updating/finalizing PENDING document ID: ${tempInvoiceId}`);
        batchOp.set(docRef, documentDataForFirestore); // Use set with merge if you want to ensure all fields from pending are kept if not overridden
    } else if (tempInvoiceId) { 
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        console.log(`[finalizeSaveProductsService] Updating EXISTING document ID (non-pending): ${tempInvoiceId}`);
        batchOp.update(docRef, documentDataForFirestore); // Update existing
    } else { 
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
        console.log(`[finalizeSaveProductsService] Creating NEW document with auto-ID`);
        batchOp.set(docRef, documentDataForFirestore);
    }
    
    // For returning, we'll use current client time as an approximation for uploadTime if serverTimestamp was used
    const currentClientTime = new Date().toISOString();
    const finalUploadTime = documentDataForFirestore.uploadTime === serverTimestamp() ? currentClientTime : (documentDataForFirestore.uploadTime as Timestamp).toDate().toISOString();
    const finalInvoiceDate = documentDataForFirestore.invoiceDate instanceof Timestamp ? documentDataForFirestore.invoiceDate.toDate().toISOString() : documentDataForFirestore.invoiceDate;
    const finalPaymentDueDate = documentDataForFirestore.paymentDueDate instanceof Timestamp ? documentDataForFirestore.paymentDueDate.toDate().toISOString() : documentDataForFirestore.paymentDueDate;

    const finalInvoiceRecord: InvoiceHistoryItem = { 
        ...(documentDataForFirestore as Omit<InvoiceHistoryItem, 'id' | 'uploadTime' | 'invoiceDate' | 'paymentDueDate'>), // Cast to avoid type issues with FieldValue
        id: docRef.id, 
        uploadTime: finalUploadTime,
        invoiceDate: finalInvoiceDate as string | null,
        paymentDueDate: finalPaymentDueDate as string | null,
    };

    try {
      console.log("[finalizeSaveProductsService] Attempting to commit batch to Firestore...");
      await batchOp.commit();
      console.log("[finalizeSaveProductsService] Batch commit successful.");
      const uniqueScanIdToClear = tempInvoiceId?.startsWith(`pending-inv-${userId}_`)
        ? tempInvoiceId.substring(`pending-inv-${userId}_`.length)
        : (originalFileNameFromUpload ? `${Date.now()}_${originalFileNameFromUpload.replace(/[^a-zA-Z0-9._-]/g, '')}` : null); // Fallback if tempId not in expected format
      if (uniqueScanIdToClear) {
        clearTemporaryScanData(uniqueScanIdToClear, userId);
      }
    } catch (error: any) {
      console.error("[finalizeSaveProductsService] Error committing batch to Firestore:", error);
      throw new Error(`Failed to save to Firestore: ${error.message}`);
    }
    console.log("[finalizeSaveProductsService] Completed successfully. Final Invoice ID:", finalInvoiceRecord.id);
    return { finalInvoiceRecord, savedProductsWithFinalIds };
}


// --- Supplier Management (Firestore) ---
export async function getSupplierSummariesService(userId: string): Promise<SupplierSummary[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getSupplierSummariesService.");
    return [];
  }
  if (!userId) {
    console.warn("getSupplierSummariesService called without userId");
    return [];
  }

  const suppliersQuery = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId));
  const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), where("status", "==", "completed"));

  try {
    const [suppliersSnapshot, documentsDataSnapshot] = await Promise.all([
      getDocs(suppliersQuery),
      getDocs(documentsQuery)
    ]);

    const supplierMap = new Map<string, SupplierSummary>();

    suppliersSnapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      supplierMap.set(data.name, { 
        id: docSnap.id, userId, name: data.name,
        phone: data.phone || null, email: data.email || null, paymentTerms: data.paymentTerms || null,
        invoiceCount: 0, totalSpent: 0,
        lastActivityDate: data.lastActivityDate instanceof Timestamp ? data.lastActivityDate.toDate().toISOString() : (typeof data.lastActivityDate === 'string' ? data.lastActivityDate : null),
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt : serverTimestamp(), // Ensure createdAt is a Timestamp or FieldValue
      });
    });

    documentsDataSnapshot.docs.forEach(docSnap => {
      const docData = docSnap.data() as InvoiceHistoryItem;
      if (docData.supplierName && docData.status === 'completed') {
        let supplierEntry = supplierMap.get(docData.supplierName);
        if (supplierEntry) {
            supplierEntry.invoiceCount += 1;
            supplierEntry.totalSpent += (docData.totalAmount || 0);

            let docUploadTime: Date | null = null;
            if (docData.uploadTime) {
                if (docData.uploadTime instanceof Timestamp) docUploadTime = docData.uploadTime.toDate();
                else if (typeof docData.uploadTime === 'string' && isValid(parseISO(docData.uploadTime))) docUploadTime = parseISO(docData.uploadTime);
            }

            if (docUploadTime) {
              const currentLastActivity = supplierEntry.lastActivityDate ? parseISO(supplierEntry.lastActivityDate as string) : null;
              if (!currentLastActivity || docUploadTime > currentLastActivity) {
                supplierEntry.lastActivityDate = docUploadTime.toISOString();
              }
            }
        }
      }
    });
    return Array.from(supplierMap.values()).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  } catch (error) {
    console.error("Error fetching supplier summaries from Firestore:", error);
    throw error;
  }
}

export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }, userId: string): Promise<SupplierSummary> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for createSupplierService.");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) throw new Error(`Supplier with name "${normalizedName}" already exists.`);

  const newSupplierRef = doc(collection(db, SUPPLIERS_COLLECTION));
  const newSupplierData = sanitizeForFirestore({
    id: newSupplierRef.id,
    userId, name: normalizedName,
    phone: contactInfo.phone?.trim() || null, 
    email: contactInfo.email?.trim() || null, 
    paymentTerms: contactInfo.paymentTerms?.trim() || null,
    invoiceCount: 0, totalSpent: 0, lastActivityDate: null, createdAt: serverTimestamp(),
  });
  await setDoc(newSupplierRef, newSupplierData);
  return { ...newSupplierData, createdAt: Timestamp.now() } as SupplierSummary;
}

export async function deleteSupplierService(supplierId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for deleteSupplierService.");
  
  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const supplierDoc = await getDoc(supplierRef);
  if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
    throw new Error(`Supplier not found or permission denied for deletion.`);
  }
  await deleteDoc(supplierRef);
}

export async function updateSupplierContactInfoService(supplierIdOrName: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }, userId: string, isNewSupplier: boolean = false): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for updateSupplierContactInfoService.");

  let supplierRef;
  let existingData: Partial<SupplierSummary> = {};

  if (isNewSupplier) {
    const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", supplierIdOrName));
    const existingSnap = await getDocs(q);
    if (!existingSnap.empty) {
      supplierRef = existingSnap.docs[0].ref;
      existingData = existingSnap.docs[0].data() as SupplierSummary;
      console.log(`[updateSupplierContactInfoService] Found existing supplier by name '${supplierIdOrName}', will update ID: ${supplierRef.id}`);
      isNewSupplier = false;
    } else {
      supplierRef = doc(collection(db, SUPPLIERS_COLLECTION));
      existingData = { name: supplierIdOrName, invoiceCount: 0, totalSpent: 0, lastActivityDate: null, createdAt: serverTimestamp() };
      console.log(`[updateSupplierContactInfoService] Creating new supplier document for '${supplierIdOrName}' with ID: ${supplierRef.id}`);
    }
  } else {
    supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierIdOrName);
    const supplierDoc = await getDoc(supplierRef);
    if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
      throw new Error(`Supplier not found or permission denied for update.`);
    }
    existingData = supplierDoc.data() as SupplierSummary;
  }

  const updateData: any = { userId }; 
  let hasChanges = false;

  if (isNewSupplier && !existingData.id) { // if truly new and not just found by name
    updateData.name = supplierIdOrName;
    updateData.createdAt = existingData.createdAt || serverTimestamp();
    updateData.invoiceCount = 0;
    updateData.totalSpent = 0;
    updateData.lastActivityDate = null;
    hasChanges = true;
  }

  if (contactInfo.phone !== undefined && contactInfo.phone !== (existingData.phone || null)) { 
    updateData.phone = contactInfo.phone.trim() || null; 
    hasChanges = true; 
  }
  if (contactInfo.email !== undefined && contactInfo.email !== (existingData.email || null)) { 
    updateData.email = contactInfo.email.trim() || null; 
    hasChanges = true; 
  }
  if (contactInfo.paymentTerms !== undefined && contactInfo.paymentTerms !== (existingData.paymentTerms || null)) { 
    updateData.paymentTerms = contactInfo.paymentTerms.trim() || null; 
    hasChanges = true; 
  }
  
  if (hasChanges || isNewSupplier) { // Ensure we save if it's a new supplier being effectively created or fields changed
      console.log(`[updateSupplierContactInfoService] Saving/Updating supplier ID ${supplierRef.id} with data:`, sanitizeForFirestore(updateData));
      await setDoc(supplierRef, sanitizeForFirestore(updateData), { merge: true }); 
  } else {
      console.log("[updateSupplierContactInfoService] No actual changes to update for existing supplier.");
  }
}


// --- Settings Management (Firestore) ---
export async function saveUserSettingsService(settings: Partial<Omit<UserSettings, 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required for saveUserSettingsService.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const settingsToSave: any = { ...settings, userId };

    if (settings.accountantSettings) {
        settingsToSave.accountantSettings = sanitizeForFirestore({
            name: settings.accountantSettings.name || null,
            email: settings.accountantSettings.email || null,
            phone: settings.accountantSettings.phone || null,
        });
    } else if (settings.hasOwnProperty('accountantSettings')) { 
        settingsToSave.accountantSettings = null;
    }

    if (settings.posConfig) {
        settingsToSave.posConfig = sanitizeForFirestore(settings.posConfig);
    } else if (settings.hasOwnProperty('posConfig')) {
        settingsToSave.posConfig = {}; 
    }
    
    await setDoc(userSettingsRef, sanitizeForFirestore(settingsToSave), { merge: true });
}

export async function getUserSettingsService(userId: string): Promise<UserSettings | null> {
    if (!db || !userId) return null;
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        return { 
            userId, 
            ...data,
            accountantSettings: data.accountantSettings ? {
                name: data.accountantSettings.name || null,
                email: data.accountantSettings.email || null,
                phone: data.accountantSettings.phone || null,
            } : { name: null, email: null, phone: null },
            posConfig: data.posConfig || {},
            monthlyBudget: data.monthlyBudget === undefined ? null : data.monthlyBudget, // Ensure monthlyBudget is null if not set
            kpiPreferences: data.kpiPreferences || null,
            quickActionPreferences: data.quickActionPreferences || null,
        } as UserSettings;
    }
    return { // Return default structure if no settings doc exists
        userId,
        reminderDaysBefore: 3, 
        posSystemId: null,
        posConfig: {},
        accountantSettings: { name: null, email: null, phone: null },
        monthlyBudget: null,
        kpiPreferences: null,
        quickActionPreferences: null,
    };
}

// --- Other Expenses & Categories (Firestore) ---
export async function getOtherExpensesService(userId: string): Promise<OtherExpense[]> {
    if (!db || !userId) return [];
    const expensesQuery = query(collection(db, OTHER_EXPENSES_COLLECTION), where("userId", "==", userId), orderBy("date", "desc"));
    const snapshot = await getDocs(expensesQuery);
    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
            id: docSnap.id, ...data,
            date: data.date instanceof Timestamp ? data.date.toDate().toISOString() : data.date,
        } as OtherExpense;
    });
}

export async function saveOtherExpenseService(expenseData: Omit<OtherExpense, 'id' | 'userId'| 'createdAt'> & {id?: string}, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveOtherExpenseService.");
  
  const dataToSave: any = { 
    ...expenseData,
    userId,
    date: typeof expenseData.date === 'string' && isValid(parseISO(expenseData.date)) 
            ? Timestamp.fromDate(parseISO(expenseData.date)) 
            : (expenseData.date instanceof Date ? Timestamp.fromDate(expenseData.date) 
            : (expenseData.date instanceof Timestamp ? expenseData.date : serverTimestamp())),
    _internalCategoryKey: expenseData._internalCategoryKey || null,
  };

  if (expenseData.id) { 
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseData.id);
    await updateDoc(docRef, sanitizeForFirestore({ ...dataToSave, lastUpdatedAt: serverTimestamp() }));
    return expenseData.id;
  } else { 
    const newDocRef = doc(collection(db, OTHER_EXPENSES_COLLECTION));
    await setDoc(newDocRef, sanitizeForFirestore({ ...dataToSave, id: newDocRef.id, createdAt: serverTimestamp() }));
    return newDocRef.id;
  }
}


export async function deleteOtherExpenseService(expenseId: string, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication required for deleteOtherExpenseService.");
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    const docSnap = await getDoc(docRef); 
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
        throw new Error("Expense not found or permission denied.");
    }
    await deleteDoc(docRef);
}

export async function getExpenseCategoriesService(userId: string): Promise<ExpenseCategory[]> {
  if (!db || !userId) return [];
  const categoriesQuery = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId), orderBy("name"));
  const snapshot = await getDocs(categoriesQuery);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ExpenseCategory));
}

export async function saveExpenseCategoryService(categoryData: Omit<ExpenseCategory, 'id' | 'userId' | 'createdAt'>, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveExpenseCategoryService.");
  if (!categoryData.name || !categoryData.internalKey) throw new Error("Category name and internalKey are required.");

  const q = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId), where("internalKey", "==", categoryData.internalKey));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`Expense category with key "${categoryData.internalKey}" already exists for this user.`);
  }

  const newDocRef = doc(collection(db, EXPENSE_CATEGORIES_COLLECTION));
  const dataToSave: any = { 
      ...categoryData, 
      id: newDocRef.id,
      userId, 
      createdAt: serverTimestamp(), 
      isFixed: categoryData.isFixed ?? false,
      defaultAmount: categoryData.defaultAmount ?? null,
  };
  await setDoc(newDocRef, sanitizeForFirestore(dataToSave));
  return newDocRef.id;
}

export async function getExpenseTemplatesService(userId: string): Promise<ExpenseTemplate[]> {
  if (!db || !userId) return [];
  const templatesQuery = query(collection(db, EXPENSE_TEMPLATES_COLLECTION), where("userId", "==", userId), orderBy("name"));
  const snapshot = await getDocs(templatesQuery);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ExpenseTemplate));
}

export async function saveExpenseTemplateService(templateData: Omit<ExpenseTemplate, 'id' | 'userId' | 'createdAt'>, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveExpenseTemplateService.");
  const newDocRef = doc(collection(db, EXPENSE_TEMPLATES_COLLECTION));
  await setDoc(newDocRef, sanitizeForFirestore({ ...templateData, id: newDocRef.id, userId, createdAt: serverTimestamp() }));
  return newDocRef.id;
}


// --- Temporary Data Management for Uploads (localStorage) ---
export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined' || !userId) return;
    if (!uniqueScanId) {
      console.warn("[clearTemporaryScanData] Called without uniqueScanId for user:", userId);
      return;
    }
    console.log(`[clearTemporaryScanData] Attempting to clear keys for UserID: ${userId}, ScanID: ${uniqueScanId}`);
    try {
      const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      const originalImageKey = getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      const compressedImageKey = getStorageKey(TEMP_COMPRESSED_IMAGE_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      
      localStorage.removeItem(dataKey);
      localStorage.removeItem(originalImageKey);
      localStorage.removeItem(compressedImageKey);
      console.log(`[clearTemporaryScanData] Cleared keys: ${dataKey}, ${originalImageKey}, ${compressedImageKey}`);
    } catch (error) {
        console.error(`Error removing temp keys for UserID: ${userId}, ScanID: ${uniqueScanId}`, error);
    }
}

export function clearOldTemporaryScanData(emergencyClear: boolean = false, userIdToClear?: string) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000; 
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(TEMP_DATA_KEY_PREFIX) || key.startsWith(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX) || key.startsWith(TEMP_COMPRESSED_IMAGE_KEY_PREFIX))) {
        
        if (userIdToClear && !key.includes(`_${userIdToClear}_`)) {
            continue; 
        }

        const parts = key.split('_');
        const timestampString = parts.find(part => /^\d{13,}$/.test(part));
        const timestamp = timestampString ? parseInt(timestampString, 10) : null;

        if (emergencyClear && (userIdToClear || !key.includes('_SHARED_OR_NO_USER_'))) { 
             keysToRemove.push(key);
        } else if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) { 
          keysToRemove.push(key);
        }
    }
  }
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`Cleared ${itemsCleared} old/emergency temp scan items (User: ${userIdToClear || 'All Relevant'}).`);
}

// Constants exported from backend.ts that were previously causing issues if not found
export const INVENTORY_STORAGE_KEY_BASE = 'invoTrack_inventory'; // No longer primary for data, but might be used in getStoredData if called directly
export const INVOICES_STORAGE_KEY_BASE = 'invoTrack_invoices';     // No longer primary for data
export const SUPPLIERS_STORAGE_KEY_BASE = 'invoTrack_suppliers';   // No longer primary for data
export const POS_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_posSettings'; // For UserSettings
export const USER_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_userSettings'; // For UserSettings
export const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_accountantSettings'; // For UserSettings
// OTHER_EXPENSES_STORAGE_KEY_BASE is already defined above, refers to Firestore collection now.
// EXPENSE_CATEGORIES_STORAGE_KEY_BASE is already defined, refers to Firestore collection.

// It's better to have the Firestore collection names be the primary constants now.
// The localStorage keys are mostly for temporary scan data or UI preferences not yet migrated.
