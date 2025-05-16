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
export const EXPENSE_TEMPLATES_COLLECTION = "expenseTemplates"; // Note: Currently localStorage based, consider migrating
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
  unitPrice: number;
  salePrice?: number | null;
  lineTotal: number;
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
  imageUrl?: string | null;
  _originalId?: string;
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
  id: string;
  userId: string;
  name: string;
  categoryKey: string;
  description: string;
  amount: number;
  createdAt: Timestamp | FieldValue;
}

export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.25 * 1024 * 1024;
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.4 * 1024 * 1024;
export const MAX_INVOICE_HISTORY_ITEMS = 10;

export const KPI_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_kpiPreferences_v2';
export const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_quickActionsPreferences_v1';
// export const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget_'; // Now part of UserSettings in Firestore

// --- Helper function to get localStorage keys with userId ---
export const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    if ([KPI_PREFERENCES_STORAGE_KEY_BASE, QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE].includes(baseKey)) {
        return baseKey;
    }
    console.warn(`[getStorageKey] Called with base "${baseKey}" but no userId.`);
    return `${baseKey}_SHARED_OR_NO_USER`;
  }
  return `${baseKey}_${userId}`;
};

export const getStoredData = <T>(keyBase: string, userId?: string, defaultDataIfNoUserOrError: T | T[] = []): T | T[] => {
  if (typeof window === 'undefined') return defaultDataIfNoUserOrError;
  const storageKey = getStorageKey(keyBase, userId);
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
    return defaultDataIfNoUserOrError;
  } catch (error) {
    console.error(`Error reading ${storageKey} from localStorage:`, error);
    return defaultDataIfNoUserOrError;
  }
};

const saveStoredData = (keyBase: string, data: any, userId?: string): boolean => {
  if (typeof window === 'undefined') return false;
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

export function sanitizeForFirestore<T extends object>(data: T): T {
  const sanitizedData = { ...data } as Record<string, any>;
  for (const key in sanitizedData) {
    if (sanitizedData[key] === undefined) {
      sanitizedData[key] = null;
    }
  }
  return sanitizedData as T;
}

export async function saveUserToFirestore(userData: User): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userData.id) throw new Error("User ID is missing for saveUserToFirestore.");
  
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
    console.log(`[saveUserToFirestore] User ${userData.id} saved/updated.`);
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
      const data = docSnap.data();
      return { 
        id: docSnap.id, 
        ...data,
        email: data.email || null,
        username: data.username || null,
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt : undefined,
        lastLoginAt: data.lastLoginAt instanceof Timestamp ? data.lastLoginAt : undefined,
      } as User;
    }
    console.log(`[getUserFromFirestore] No user found with ID: ${userId}`);
    return null;
  } catch (error) {
    console.error("Error fetching user from Firestore:", error);
    throw error;
  }
}

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
    if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for products. Please create the suggested index in your Firebase console.");
    }
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

export async function updateProductService(productId: string, updatedData: Partial<Omit<Product, 'id' | 'userId'>>, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for updateProductService.");
  
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  const dataToUpdate: Partial<Omit<Product, 'id' | 'userId'>> & { lastUpdated: FieldValue } = {
    ...sanitizeForFirestore(updatedData),
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

// Helper function to delete all documents in a collection for a specific user
async function deleteCollectionByUserId(collectionName: string, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing for deleteCollectionByUserId.");
  
  const q = query(collection(db, collectionName), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return;

  const batch = writeBatch(db);
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  console.log(`[deleteCollectionByUserId] All documents in ${collectionName} for user ${userId} have been deleted.`);
}


export async function clearInventoryService(userId: string): Promise<void> {
  await deleteCollectionByUserId(INVENTORY_COLLECTION, userId);
}

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
        const convertTimestampToString = (field: any): string | null => {
            if (field instanceof Timestamp) return field.toDate().toISOString();
            if (typeof field === 'string' && isValid(parseISO(field))) return field;
            if (field instanceof Date && isValid(field)) return field.toISOString();
            return null;
        };
        return {
            id: docSnap.id, 
            ...data,
            uploadTime: convertTimestampToString(data.uploadTime),
            invoiceDate: convertTimestampToString(data.invoiceDate),
            paymentDueDate: convertTimestampToString(data.paymentDueDate),
        } as InvoiceHistoryItem;
    });
  } catch (error) {
    console.error("Error fetching documents from Firestore:", error);
     if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for documents. Firebase usually provides a link in the error message to create it. Check the browser console for the full error.");
    }
    throw error;
  }
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<Omit<InvoiceHistoryItem, 'id' | 'userId'>>, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for updateInvoiceService.");

  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  
  const dataToUpdate: any = { ...updatedData }; 
  const convertToTimestampIfValidString = (dateField: any): Timestamp | null => {
    if (dateField && typeof dateField === 'string' && isValid(parseISO(dateField))) {
      return Timestamp.fromDate(parseISO(dateField));
    }
    if (dateField instanceof Date && isValid(dateField)) return Timestamp.fromDate(dateField);
    return dateField instanceof Timestamp ? dateField : null;
  };

  if (dataToUpdate.hasOwnProperty('invoiceDate')) dataToUpdate.invoiceDate = convertToTimestampIfValidString(dataToUpdate.invoiceDate);
  if (dataToUpdate.hasOwnProperty('paymentDueDate')) dataToUpdate.paymentDueDate = convertToTimestampIfValidString(dataToUpdate.paymentDueDate);
  if (dataToUpdate.hasOwnProperty('uploadTime')) {
    dataToUpdate.uploadTime = convertToTimestampIfValidString(dataToUpdate.uploadTime);
  }
  
  const sanitizedDataToUpdate = sanitizeForFirestore(dataToUpdate);

  try {
    const docSnap = await getDoc(docRef);
    if(!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for update.");
    }
    await updateDoc(docRef, sanitizedDataToUpdate);
  } catch (error) {
    console.error(`Error updating document ${invoiceId} in Firestore:`, error);
    throw error;
  }
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId: string, paymentReceiptImageUri?: string | null): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for updateInvoicePaymentStatusService.");
  
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const updateData: any = { paymentStatus };
 
  if (paymentStatus === 'paid' && paymentReceiptImageUri !== undefined) {
    updateData.paymentReceiptImageUri = paymentReceiptImageUri;
  } else if (paymentStatus !== 'paid') { 
    updateData.paymentReceiptImageUri = deleteField();
  }

  try {
     const docSnap = await getDoc(docRef);
     if(!docSnap.exists() || docSnap.data().userId !== userId) {
        throw new Error("Permission denied or document not found for payment status update.");
     }
    await updateDoc(docRef, sanitizeForFirestore(updateData));
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

export async function clearDocumentsService(userId: string): Promise<void> {
  await deleteCollectionByUserId(DOCUMENTS_COLLECTION, userId);
}


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
      console.warn(`[checkProductPricesBeforeSaveService] Product ID ${product.id || product.catalogNumber} has invalid unitPrice. Skipping price check for it.`);
      productsToSaveDirectly.push(product); 
      continue;
    }
    const productWithNumericPrice = { ...product, unitPrice: currentProductUnitPrice };

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
        
        if (!isNaN(existingUnitPrice) && Math.abs(existingUnitPrice - productWithNumericPrice.unitPrice) > 0.001 && productWithNumericPrice.unitPrice > 0) {
          priceDiscrepancies.push({
            ...productWithNumericPrice,
            existingUnitPrice: existingUnitPrice,
            newUnitPrice: productWithNumericPrice.unitPrice,
          });
        } else {
          productsToSaveDirectly.push(productWithNumericPrice);
        }
      } else {
        productsToSaveDirectly.push(productWithNumericPrice);
      }
    } catch (error) {
      console.error(`Error checking price for product ID ${product.id || product.catalogNumber}:`, error);
      productsToSaveDirectly.push(productWithNumericPrice);
    }
  }
  return { productsToSaveDirectly, priceDiscrepancies };
}


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
  finalInvoiceRecord: InvoiceHistoryItem;
  savedProductsWithFinalIds: Product[];
}> {
    if (!db) throw new Error("Database not initialized for finalizeSaveProductsService.");
    if (!userId) throw new Error("User authentication is required for finalizeSaveProductsService.");
    console.log(`[finalizeSaveProductsService] User: ${userId}, DocType: ${documentType}, TempID: ${tempInvoiceId}, Products in Doc: ${productsToFinalizeSave.length}`);

    const savedProductsWithFinalIds: Product[] = [];
    let calculatedInvoiceTotalAmountFromProducts = 0;
    const batchOp = writeBatch(db);

    const shouldUpdateInventory = documentType === 'deliveryNote';

    if (shouldUpdateInventory && productsToFinalizeSave.length > 0) {
        console.log("[finalizeSaveProductsService] Processing products for inventory (deliveryNote)...");
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
            let foundBy: 'id' | 'catalog' | 'barcode' | 'none' = 'none';

            if (productFromDoc.id && !productFromDoc.id.startsWith('prod-temp-') && !productFromDoc.id.startsWith('temp-id-')) {
                const snap = await getDoc(doc(db, INVENTORY_COLLECTION, productFromDoc.id));
                if (snap.exists() && snap.data().userId === userId) {
                    existingProductRef = snap.ref;
                    existingProductData = { id: snap.id, ...snap.data() } as Product;
                    foundBy = 'id';
                }
            }
            if (!existingProductData && productFromDoc.catalogNumber && productFromDoc.catalogNumber !== 'N/A') {
                const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productFromDoc.catalogNumber), limit(1));
                const catSnap = await getDocs(qCat);
                if (!catSnap.empty) {
                    existingProductRef = catSnap.docs[0].ref;
                    existingProductData = { id: catSnap.docs[0].id, ...catSnap.docs[0].data() } as Product;
                    foundBy = 'catalog';
                }
            }
            if (!existingProductData && productFromDoc.barcode && productFromDoc.barcode.trim() !== '') {
                const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productFromDoc.barcode.trim()), limit(1));
                const barSnap = await getDocs(qBar);
                if (!barSnap.empty) {
                    existingProductRef = barSnap.docs[0].ref;
                    existingProductData = { id: barSnap.docs[0].id, ...barSnap.docs[0].data() } as Product;
                    foundBy = 'barcode';
                }
            }

            if (existingProductRef && existingProductData) {
                console.log(`[finalizeSaveProductsService] Updating existing product (found by ${foundBy}): ${existingProductData.id}`);
                const currentInventoryQuantity = Number(existingProductData.quantity) || 0;
                const updatedQuantity = currentInventoryQuantity + quantityFromDoc;
                
                const updatePayload: Partial<Product> = {
                    quantity: updatedQuantity,
                    unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : (existingProductData.unitPrice || 0),
                    lastUpdated: serverTimestamp(),
                    description: productFromDoc.description !== undefined ? (productFromDoc.description || existingProductData.description) : existingProductData.description,
                    shortName: productFromDoc.shortName !== undefined ? (productFromDoc.shortName || existingProductData.shortName) : existingProductData.shortName,
                    salePrice: productFromDoc.salePrice !== undefined ? (productFromDoc.salePrice === null ? null : Number(productFromDoc.salePrice)) : existingProductData.salePrice,
                    minStockLevel: productFromDoc.minStockLevel !== undefined ? (productFromDoc.minStockLevel === null ? null : Number(productFromDoc.minStockLevel)) : existingProductData.minStockLevel,
                    maxStockLevel: productFromDoc.maxStockLevel !== undefined ? (productFromDoc.maxStockLevel === null ? null : Number(productFromDoc.maxStockLevel)) : existingProductData.maxStockLevel,
                    barcode: productFromDoc.barcode !== undefined ? (productFromDoc.barcode || null) : existingProductData.barcode,
                    imageUrl: productFromDoc.imageUrl !== undefined ? (productFromDoc.imageUrl || null) : existingProductData.imageUrl,
                };
                updatePayload.lineTotal = parseFloat(((updatePayload.quantity || 0) * (updatePayload.unitPrice || 0)).toFixed(2));
                
                batchOp.update(existingProductRef, sanitizeForFirestore(updatePayload));
                savedProductsWithFinalIds.push({ ...existingProductData, ...updatePayload, id: existingProductData.id } as Product);
            } else {
                if (!productFromDoc.catalogNumber && !productFromDoc.description && !productFromDoc.barcode) {
                    console.warn("[finalizeSaveProductsService] Skipping new product due to missing identifiers:", productFromDoc);
                    continue;
                }
                const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
                console.log(`[finalizeSaveProductsService] Creating new product: ${productFromDoc.shortName || productFromDoc.description}`);
                const newProductData: Omit<Product, 'id'> = {
                    userId,
                    catalogNumber: productFromDoc.catalogNumber || 'N/A',
                    description: productFromDoc.description || 'No Description',
                    shortName: productFromDoc.shortName || (productFromDoc.description || 'No Description').split(' ').slice(0, 3).join(' '),
                    barcode: (productFromDoc.barcode && productFromDoc.barcode.trim() !== '') ? productFromDoc.barcode.trim() : null,
                    quantity: quantityFromDoc,
                    unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : 0,
                    salePrice: productFromDoc.salePrice !== undefined ? (Number(productFromDoc.salePrice) ?? null) : null,
                    lineTotal: parseFloat((quantityFromDoc * (unitPriceFromDoc > 0 ? unitPriceFromDoc : 0)).toFixed(2)),
                    minStockLevel: productFromDoc.minStockLevel !== undefined ? (Number(productFromDoc.minStockLevel) ?? null) : null,
                    maxStockLevel: productFromDoc.maxStockLevel !== undefined ? (Number(productFromDoc.maxStockLevel) ?? null) : null,
                    imageUrl: productFromDoc.imageUrl || null,
                    lastUpdated: serverTimestamp(),
                };
                batchOp.set(newProductRef, sanitizeForFirestore(newProductData));
                savedProductsWithFinalIds.push({ ...newProductData, id: newProductRef.id } as Product);
            }
        }
    } else if (documentType === 'invoice') {
        console.log("[finalizeSaveProductsService] Tax Invoice: Products not added to inventory. Calculating total from extractedTotalAmount or products if available.");
        productsToFinalizeSave.forEach(p => calculatedInvoiceTotalAmountFromProducts += (parseFloat(String(p.lineTotal)) || 0));
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
    
    let docRef;
    let isNewDocument = true;
    let existingUploadTime: Timestamp | FieldValue = serverTimestamp();

    if (tempInvoiceId && tempInvoiceId.startsWith(`pending-inv-${userId}_`)) {
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        try {
            const existingDocSnap = await getDoc(docRef);
            if (existingDocSnap.exists()) {
                isNewDocument = false; 
                existingUploadTime = existingDocSnap.data().uploadTime || serverTimestamp();
                if (originalImagePreviewUriToSave === undefined && existingDocSnap.data().originalImagePreviewUri) {
                    originalImagePreviewUriToSave = existingDocSnap.data().originalImagePreviewUri;
                }
                if (compressedImageForFinalRecordUriToSave === undefined && existingDocSnap.data().compressedImageForFinalRecordUri) {
                    compressedImageForFinalRecordUriToSave = existingDocSnap.data().compressedImageForFinalRecordUri;
                }
            } else {
                console.warn(`[finalizeSaveProductsService] Pending document with ID ${tempInvoiceId} not found. Creating new document with this ID.`);
                // Keep docRef as is, isNewDocument remains true (or set it true) because we are effectively creating it.
            }
        } catch (e) { 
            console.error(`Error fetching existing pending document ${tempInvoiceId}:`, e);
            // Fallback to creating a new doc if fetch fails but tempId was provided
            docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId); // Still try to use tempInvoiceId
            isNewDocument = true; // Treat as new creation at this specific ID
        }
    } else if (tempInvoiceId) {
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        isNewDocument = false; 
        try {
            const existingDocSnap = await getDoc(docRef);
            if (existingDocSnap.exists()) {
                existingUploadTime = existingDocSnap.data().uploadTime || serverTimestamp();
                 if (originalImagePreviewUriToSave === undefined && existingDocSnap.data().originalImagePreviewUri) {
                    originalImagePreviewUriToSave = existingDocSnap.data().originalImagePreviewUri;
                }
                if (compressedImageForFinalRecordUriToSave === undefined && existingDocSnap.data().compressedImageForFinalRecordUri) {
                    compressedImageForFinalRecordUriToSave = existingDocSnap.data().compressedImageForFinalRecordUri;
                }
            } else {
                console.error(`[finalizeSaveProductsService] Document with ID ${tempInvoiceId} not found for update. Creating new.`);
                docRef = doc(collection(db, DOCUMENTS_COLLECTION));
                isNewDocument = true;
            }
        } catch (e) { 
            console.error(`Error fetching existing document ${tempInvoiceId} for update:`, e);
            docRef = doc(collection(db, DOCUMENTS_COLLECTION));
            isNewDocument = true;
        }
    } else { 
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
    }

    const convertToTimestampIfValid = (dateVal: any): Timestamp | null => {
        if (!dateVal) return null;
        if (dateVal instanceof Date && isValid(dateVal)) return Timestamp.fromDate(dateVal);
        if (typeof dateVal === 'string' && isValid(parseISO(dateVal))) return Timestamp.fromDate(parseISO(dateVal));
        if (dateVal instanceof Timestamp) return dateVal;
        console.warn("[finalizeSaveProductsService] Invalid date value provided for Timestamp conversion:", dateVal);
        return null;
    };

    const documentDataForFirestore: Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { uploadTime: Timestamp | FieldValue } = {
        userId,
        generatedFileName: finalGeneratedFileName,
        originalFileName: originalFileNameFromUpload,
        uploadTime: isNewDocument ? serverTimestamp() : existingUploadTime,
        status: 'completed',
        documentType: documentType,
        invoiceNumber: extractedInvoiceNumber || null,
        supplierName: finalSupplierName || null,
        totalAmount: !isNaN(finalInvoiceTotalAmount) ? finalInvoiceTotalAmount : null,
        paymentStatus: 'unpaid',
        paymentDueDate: convertToTimestampIfValid(paymentDueDate),
        invoiceDate: convertToTimestampIfValid(invoiceDate),
        paymentMethod: paymentMethod || null,
        errorMessage: null,
        paymentReceiptImageUri: null,
        originalImagePreviewUri: originalImagePreviewUriToSave || null,
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave || null,
        linkedDeliveryNoteId: null,
    };
    
    batchOp.set(docRef, sanitizeForFirestore(documentDataForFirestore), { merge: !isNewDocument });

    let finalUploadTimeForReturn: string;
    if (documentDataForFirestore.uploadTime instanceof Timestamp) {
        finalUploadTimeForReturn = documentDataForFirestore.uploadTime.toDate().toISOString();
    } else {
        finalUploadTimeForReturn = new Date().toISOString();
    }
    
    const finalInvoiceRecord: InvoiceHistoryItem = { 
        ...(documentDataForFirestore as Omit<InvoiceHistoryItem, 'id' | 'uploadTime' | 'invoiceDate' | 'paymentDueDate'>),
        id: docRef.id, 
        uploadTime: finalUploadTimeForReturn,
        invoiceDate: documentDataForFirestore.invoiceDate instanceof Timestamp ? documentDataForFirestore.invoiceDate.toDate().toISOString() : null,
        paymentDueDate: documentDataForFirestore.paymentDueDate instanceof Timestamp ? documentDataForFirestore.paymentDueDate.toDate().toISOString() : null,
    };

    try {
      console.log("[finalizeSaveProductsService] Committing batch to Firestore...");
      await batchOp.commit();
      console.log("[finalizeSaveProductsService] Batch commit successful. Final Doc ID:", finalInvoiceRecord.id);
      
      const uniqueScanIdToClear = tempInvoiceId?.startsWith(`pending-inv-${userId}_`)
        ? tempInvoiceId.substring(`pending-inv-${userId}_`.length)
        : (tempInvoiceId && originalFileNameFromUpload) ? `${tempInvoiceId}_${originalFileNameFromUpload.replace(/[^a-zA-Z0-9._-]/g, '')}` : null;
      
      if (uniqueScanIdToClear) {
        clearTemporaryScanData(uniqueScanIdToClear, userId);
      }

    } catch (error: any) {
      console.error("[finalizeSaveProductsService] Error committing batch to Firestore:", error);
      throw new Error(`Failed to save to Firestore: ${error.message}`);
    }
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
    const [suppliersSnapshot, documentsSnapshot] = await Promise.all([
      getDocs(suppliersQuery),
      getDocs(documentsQuery) 
    ]);

    const supplierMap = new Map<string, SupplierSummary>();

    suppliersSnapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      const createdAtTimestamp = data.createdAt instanceof Timestamp ? data.createdAt : (data.createdAt && typeof data.createdAt.toDate === 'function' ? data.createdAt : serverTimestamp());
      const lastActivityDateTimestamp = data.lastActivityDate instanceof Timestamp ? data.lastActivityDate : (data.lastActivityDate && typeof data.lastActivityDate.toDate === 'function' ? data.lastActivityDate : null);
      
      if (data.name && typeof data.name === 'string') {
        supplierMap.set(data.name, {
          id: docSnap.id,
          userId,
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          paymentTerms: data.paymentTerms || null,
          invoiceCount: 0,
          totalSpent: 0,
          lastActivityDate: lastActivityDateTimestamp,
          createdAt: createdAtTimestamp,
        });
      } else {
        console.warn(`Supplier document ${docSnap.id} for user ${userId} is missing a name or name is not a string.`);
      }
    });

    documentsSnapshot.docs.forEach(docSnap => {
      const docData = docSnap.data() as Omit<InvoiceHistoryItem, 'id'> & {id?:string};
      if (docData.supplierName && typeof docData.supplierName === 'string' && docData.status === 'completed') {
        let supplierEntry = supplierMap.get(docData.supplierName);

        if (!supplierEntry) {
          console.warn(`[getSupplierSummariesService] Supplier "${docData.supplierName}" found in documents but not in suppliers collection for user ${userId}. Creating a temporary summary for display.`);
          supplierEntry = {
            id: `doc-derived-${docData.supplierName.replace(/\s+/g, '_')}-${Date.now()}`,
            userId,
            name: docData.supplierName,
            invoiceCount: 0,
            totalSpent: 0,
            lastActivityDate: null,
            createdAt: docData.uploadTime instanceof Timestamp ? docData.uploadTime : serverTimestamp(),
            phone: null, email: null, paymentTerms: null,
          };
        }
        
        supplierEntry.invoiceCount += 1;
        supplierEntry.totalSpent += (docData.totalAmount || 0);

        let docUploadTime: Date | null = null;
        if (docData.uploadTime) {
            if (docData.uploadTime instanceof Timestamp) docUploadTime = docData.uploadTime.toDate();
            else if (typeof docData.uploadTime === 'string' && isValid(parseISO(docData.uploadTime))) docUploadTime = parseISO(docData.uploadTime);
            else if (docData.uploadTime instanceof Date && isValid(docData.uploadTime)) docUploadTime = docData.uploadTime;
        }
        
        let currentLastActivity: Date | null = null;
        if (supplierEntry.lastActivityDate instanceof Timestamp) {
          currentLastActivity = supplierEntry.lastActivityDate.toDate();
        } else if (typeof supplierEntry.lastActivityDate === 'string' && isValid(parseISO(supplierEntry.lastActivityDate))) {
          currentLastActivity = parseISO(supplierEntry.lastActivityDate);
        } else if (supplierEntry.lastActivityDate instanceof Date && isValid(supplierEntry.lastActivityDate)) {
            currentLastActivity = supplierEntry.lastActivityDate;
        }

        if (docUploadTime && (!currentLastActivity || docUploadTime > currentLastActivity)) {
          supplierEntry.lastActivityDate = Timestamp.fromDate(docUploadTime);
        }
        supplierMap.set(docData.supplierName, supplierEntry);
      }
    });
    return Array.from(supplierMap.values()).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  } catch (error) {
    console.error("Error fetching supplier summaries from Firestore:", error);
    throw error;
  }
}

export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId: string): Promise<SupplierSummary> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for createSupplierService.");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) throw new Error(`Supplier with name "${normalizedName}" already exists.`);

  const newSupplierRef = doc(collection(db, SUPPLIERS_COLLECTION));
  const newSupplierData: Omit<SupplierSummary, 'id'> = {
    userId, name: normalizedName,
    phone: contactInfo.phone?.trim() || null, 
    email: contactInfo.email?.trim() || null, 
    paymentTerms: contactInfo.paymentTerms?.trim() || null,
    invoiceCount: 0, totalSpent: 0, lastActivityDate: null, createdAt: serverTimestamp(),
  };
  await setDoc(newSupplierRef, sanitizeForFirestore(newSupplierData));
  const now = Timestamp.now();
  return { 
      id: newSupplierRef.id, 
      ...newSupplierData, 
      createdAt: now, 
      lastActivityDate: null
  } as SupplierSummary;
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

export async function clearSuppliersService(userId: string): Promise<void> {
  await deleteCollectionByUserId(SUPPLIERS_COLLECTION, userId);
}

export async function updateSupplierContactInfoService(supplierId: string, contactInfo: { phone?: string | null; email?: string | null; paymentTerms?: string | null }, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for updateSupplierContactInfoService.");

  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const existingDoc = await getDoc(supplierRef);
  if (!existingDoc.exists() || existingDoc.data().userId !== userId) {
    throw new Error("Supplier not found or permission denied for update.");
  }

  const updatePayload: Partial<Pick<SupplierSummary, 'phone' | 'email' | 'paymentTerms'>> = {};
  let hasChanges = false;

  if (contactInfo.hasOwnProperty('phone')) {
    const newPhone = contactInfo.phone?.trim() || null;
    if (newPhone !== (existingDoc.data().phone || null)) {
        updatePayload.phone = newPhone;
        hasChanges = true;
    }
  }
  if (contactInfo.hasOwnProperty('email')) {
    const newEmail = contactInfo.email?.trim() || null;
    if (newEmail !== (existingDoc.data().email || null)) {
        updatePayload.email = newEmail;
        hasChanges = true;
    }
  }
  if (contactInfo.hasOwnProperty('paymentTerms')) {
    const newPaymentTerms = contactInfo.paymentTerms?.trim() || null;
    if (newPaymentTerms !== (existingDoc.data().paymentTerms || null)) {
        updatePayload.paymentTerms = newPaymentTerms;
        hasChanges = true;
    }
  }
  
  if (hasChanges) {
    await updateDoc(supplierRef, sanitizeForFirestore(updatePayload));
  }
}

// --- User Settings (Firestore) ---
export async function saveUserSettingsService(settings: Partial<Omit<UserSettings, 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required for saveUserSettingsService.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    
    const settingsToSave: Partial<UserSettings> = JSON.parse(JSON.stringify(settings));

    if (settingsToSave.accountantSettings || settings.hasOwnProperty('accountantSettings')) {
        settingsToSave.accountantSettings = sanitizeForFirestore({
            name: settingsToSave.accountantSettings?.name || null,
            email: settingsToSave.accountantSettings?.email || null,
            phone: settingsToSave.accountantSettings?.phone || null,
        });
    }

    if (settingsToSave.posConfig || settings.hasOwnProperty('posConfig')) {
        settingsToSave.posConfig = settingsToSave.posConfig ? sanitizeForFirestore(settingsToSave.posConfig) : {};
    }
    
    if (settingsToSave.kpiPreferences || settings.hasOwnProperty('kpiPreferences')) {
        settingsToSave.kpiPreferences = settingsToSave.kpiPreferences ? sanitizeForFirestore(settingsToSave.kpiPreferences) : { visibleKpiIds: [], kpiOrder: [] };
    }

    if (settingsToSave.quickActionPreferences || settings.hasOwnProperty('quickActionPreferences')) {
        settingsToSave.quickActionPreferences = settingsToSave.quickActionPreferences ? sanitizeForFirestore(settingsToSave.quickActionPreferences) : { visibleQuickActionIds: [], quickActionOrder: [] };
    }

    if (settingsToSave.monthlyBudget === undefined && settings.hasOwnProperty('monthlyBudget')) {
        settingsToSave.monthlyBudget = null;
    }
    if (settingsToSave.reminderDaysBefore === undefined && settings.hasOwnProperty('reminderDaysBefore')) {
        settingsToSave.reminderDaysBefore = null;
    }
    
    delete (settingsToSave as any).userId; 
    
    await setDoc(userSettingsRef, sanitizeForFirestore(settingsToSave), { merge: true });
}

export async function getUserSettingsService(userId: string): Promise<UserSettings> {
    const defaultSettings: UserSettings = {
        userId: userId || '',
        reminderDaysBefore: 3, 
        posSystemId: null,
        posConfig: {},
        accountantSettings: { name: null, email: null, phone: null },
        monthlyBudget: null,
        kpiPreferences: { visibleKpiIds: [], kpiOrder: [] },
        quickActionPreferences: { visibleQuickActionIds: [], quickActionOrder: [] }
    };
    if (!db || !userId) return defaultSettings;
    
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        return { 
            ...defaultSettings,
            ...data,
            userId,
            accountantSettings: data.accountantSettings ? {
                name: data.accountantSettings.name || null,
                email: data.accountantSettings.email || null,
                phone: data.accountantSettings.phone || null,
            } : defaultSettings.accountantSettings,
            posConfig: data.posConfig || defaultSettings.posConfig,
            kpiPreferences: data.kpiPreferences || defaultSettings.kpiPreferences,
            quickActionPreferences: data.quickActionPreferences || defaultSettings.quickActionPreferences,
            monthlyBudget: data.monthlyBudget === undefined ? null : (data.monthlyBudget ?? null),
            reminderDaysBefore: data.reminderDaysBefore === undefined ? defaultSettings.reminderDaysBefore : (data.reminderDaysBefore ?? null),
        } as UserSettings;
    }
    return defaultSettings;
}

// --- Other Expenses & Categories (Firestore) ---
export async function getOtherExpensesService(userId: string): Promise<OtherExpense[]> {
    if (!db || !userId) return [];
    const expensesQuery = query(collection(db, OTHER_EXPENSES_COLLECTION), where("userId", "==", userId), orderBy("date", "desc"));
    try {
        const snapshot = await getDocs(expensesQuery);
        return snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            return {
                id: docSnap.id, ...data,
                date: data.date instanceof Timestamp ? data.date.toDate().toISOString() : data.date,
            } as OtherExpense;
        });
    } catch (error) {
        console.error("Error fetching other expenses from Firestore:", error);
        if ((error as any).message && (error as any).message.includes("The query requires an index")) {
            console.error("Firestore missing index error for otherExpenses. Firebase usually provides a link in the error message to create it. Check the browser console for the full error.");
        }
        throw error;
    }
}

export async function saveOtherExpenseService(expenseData: Omit<OtherExpense, 'id' | 'userId'> & {id?: string}, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveOtherExpenseService.");
  
  const { id: expenseId, ...dataToProcess } = expenseData;

  const dataToSave: any = { 
    ...dataToProcess,
    userId,
    date: typeof dataToProcess.date === 'string' && isValid(parseISO(dataToProcess.date)) 
            ? Timestamp.fromDate(parseISO(dataToProcess.date)) 
            : (dataToProcess.date instanceof Date ? Timestamp.fromDate(dataToProcess.date) 
            : (dataToProcess.date instanceof Timestamp ? dataToProcess.date : serverTimestamp())),
    _internalCategoryKey: dataToProcess._internalCategoryKey || null,
    categoryId: dataToProcess.categoryId || null,
  };

  if (expenseId) { 
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    await updateDoc(docRef, sanitizeForFirestore({ ...dataToSave, lastUpdatedAt: serverTimestamp() }));
    return expenseId;
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

export async function clearOtherExpensesService(userId: string): Promise<void> {
  await deleteCollectionByUserId(OTHER_EXPENSES_COLLECTION, userId);
}


export async function getExpenseCategoriesService(userId: string): Promise<ExpenseCategory[]> {
  if (!db || !userId) return [];
  const categoriesQuery = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId), orderBy("name"));
  const snapshot = await getDocs(categoriesQuery);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data(), createdAt: docSnap.data().createdAt instanceof Timestamp ? docSnap.data().createdAt : serverTimestamp() } as ExpenseCategory));
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
  const dataToSave: Omit<ExpenseCategory, 'id'> = { 
      ...categoryData, 
      userId, 
      createdAt: serverTimestamp(), 
      isFixed: categoryData.isFixed ?? false,
      defaultAmount: categoryData.defaultAmount ?? null,
  };
  await setDoc(newDocRef, sanitizeForFirestore(dataToSave));
  return newDocRef.id;
}

export async function clearExpenseCategoriesService(userId: string): Promise<void> {
  await deleteCollectionByUserId(EXPENSE_CATEGORIES_COLLECTION, userId);
}


// ExpenseTemplates are still localStorage based as per current design.
// If migrating to Firestore:
// export async function getExpenseTemplatesService(userId: string): Promise<ExpenseTemplate[]> { /* ... */ }
// export async function saveExpenseTemplateService(templateData: Omit<ExpenseTemplate, 'id'|'userId'|'createdAt'>, userId: string): Promise<string> { /* ... */ }


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
