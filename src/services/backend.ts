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
import { parseISO } from 'date-fns';
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

export interface ExpenseTemplate {
  id: string;
  userId: string;
  name: string;
  category: string;
  description: string;
  amount: number;
}


// Storage Keys for localStorage (some might be legacy or for specific temporary uses)
export const INVENTORY_STORAGE_KEY_BASE = 'invoTrack_inventory';
export const INVOICES_STORAGE_KEY_BASE = 'invoTrack_invoiceHistory';
export const SUPPLIERS_STORAGE_KEY_BASE = 'invoTrack_suppliers';
export const POS_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_posSettings';
export const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_accountantSettings';
export const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses';
export const EXPENSE_CATEGORIES_STORAGE_KEY_BASE = 'invoTrack_expenseCategories';
export const EXPENSE_TEMPLATES_STORAGE_KEY_BASE = 'invoTrack_expenseTemplates';
export const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget';
export const USER_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_userSettings'; // Added export


// --- Storage Keys for temporary data during scan process ---
export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

// --- Storage Limits ---
export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.4 * 1024 * 1024; // 0.4MB
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.5 * 1024 * 1024; // 0.5MB
export const MAX_INVOICE_HISTORY_ITEMS = 50;


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
  if (!userId) {
    console.warn(`[saveStoredData] Attempted to save data for base "${keyBase}" without a userId. Operation aborted.`);
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
  return false;
};


// --- User Management ---
export async function saveUserToFirestore(userData: User): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot save user.");
    throw new Error("Database not initialized.");
  }
  if (!userData.id) {
    console.error("User data must include an ID (Firebase UID).");
    throw new Error("User ID is missing.");
  }
  try {
    const userRef = doc(db, USERS_COLLECTION, userData.id);
    const dataToSave: Partial<User> = { ...userData };
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      dataToSave.createdAt = serverTimestamp();
    }
    dataToSave.lastLoginAt = serverTimestamp();
    await setDoc(userRef, dataToSave, { merge: true });
    console.log("[AuthContext] User details saved/merged in Firestore for UID:", userData.id);
  } catch (error) {
    console.error("Error saving user to Firestore:", error);
    throw error;
  }
}

export async function getUserFromFirestore(userId: string): Promise<User | null> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get user.");
    return null;
  }
  try {
    const userRef = doc(db, USERS_COLLECTION, userId);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        username: data.username,
        email: data.email,
        createdAt: data.createdAt,
        lastLoginAt: data.lastLoginAt,
      } as User;
    }
    console.log(`[AuthContext] User with ID ${userId} not found in Firestore.`);
    return null;
  } catch (error) {
    console.error("Error fetching user from Firestore:", error);
    throw error;
  }
}

// --- Inventory Product Management ---
export async function getProductsService(userId: string): Promise<Product[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get products.");
    return [];
  }
  if (!userId) {
    console.warn("[getProductsService] Called without userId. Returning empty array.");
    return [];
  }
  try {
    const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId));
    const snapshot = await getDocs(productsQuery);
    const products = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Product));
    return products;
  } catch (error) {
    console.error("Error fetching products from Firestore:", error);
    throw error;
  }
}

export async function getProductByIdService(productId: string, userId: string): Promise<Product | null> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get product by ID.");
    return null;
  }
  if (!userId) return null;
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
    const docSnap = await getDoc(productRef);
    if (docSnap.exists() && docSnap.data().userId === userId) {
      return { id: docSnap.id, ...docSnap.data() } as Product;
    }
    console.log(`Product with ID ${productId} not found for user ${userId}.`);
    return null;
  } catch (error) {
    console.error(`Error fetching product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function updateProductService(productId: string, updatedData: Partial<Product>, userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot update product.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
    const dataToUpdate: Partial<Product> & { userId: string, lastUpdated: FieldValue } = {
      ...updatedData,
      userId,
      lastUpdated: serverTimestamp()
    };

    // Ensure optional fields that are undefined become null for Firestore
    (Object.keys(dataToUpdate) as Array<keyof typeof dataToUpdate>).forEach(key => {
      if (dataToUpdate[key] === undefined) {
        (dataToUpdate as any)[key] = null;
      }
    });

    await updateDoc(productRef, dataToUpdate);
  } catch (error) {
    console.error(`Error updating product ${productId} in Firestore:`, error);
    throw error;
  }
}

export async function deleteProductService(productId: string, userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot delete product.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists() || productDoc.data().userId !== userId) {
      throw new Error("Permission denied or product not found.");
    }
    await deleteDoc(productRef);
  } catch (error) {
    console.error(`Error deleting product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function clearInventoryService(userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot clear inventory.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId));
    const snapshot = await getDocs(productsQuery);
    const batchOp = writeBatch(db);
    snapshot.docs.forEach(docSnap => batchOp.delete(docSnap.ref));
    await batchOp.commit();
  } catch (error) {
    console.error("Error clearing inventory from Firestore:", error);
    throw error;
  }
}

// --- Document (Invoice/Delivery Note) Management ---
export async function getInvoicesService(userId: string): Promise<InvoiceHistoryItem[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get documents.");
    return [];
  }
  if (!userId) {
    console.warn("getInvoicesService called without userId. Returning empty array.");
    return [];
  }
  try {
    const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), orderBy("uploadTime", "desc"));
    const snapshot = await getDocs(documentsQuery);
    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const convertTimestamp = (field: any) => {
            if (field instanceof Timestamp) {
                return field.toDate().toISOString();
            }
            return field;
        };
        return {
            id: docSnap.id,
            ...data,
            uploadTime: convertTimestamp(data.uploadTime),
            invoiceDate: convertTimestamp(data.invoiceDate),
            paymentDueDate: convertTimestamp(data.paymentDueDate),
        } as InvoiceHistoryItem;
    });
  } catch (error) {
    console.error("Error fetching documents from Firestore:", error);
    throw error;
  }
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot update document.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
    const dataToUpdate: Partial<InvoiceHistoryItem> & { userId: string } = { ...updatedData, userId };

    const fieldsToNullCheck: (keyof InvoiceHistoryItem)[] = ['supplierName', 'invoiceNumber', 'invoiceDate', 'totalAmount', 'paymentMethod', 'paymentDueDate', 'paymentReceiptImageUri', 'originalImagePreviewUri', 'compressedImageForFinalRecordUri', 'errorMessage', 'linkedDeliveryNoteId'];
    fieldsToNullCheck.forEach(field => {
        if (dataToUpdate[field] === undefined || (typeof dataToUpdate[field] === 'string' && (dataToUpdate[field] as string).trim() === '')) {
            (dataToUpdate as any)[field] = null;
        }
    });
    if (dataToUpdate.invoiceDate && typeof dataToUpdate.invoiceDate === 'string') {
      dataToUpdate.invoiceDate = Timestamp.fromDate(parseISO(dataToUpdate.invoiceDate));
    }
    if (dataToUpdate.paymentDueDate && typeof dataToUpdate.paymentDueDate === 'string') {
      dataToUpdate.paymentDueDate = Timestamp.fromDate(parseISO(dataToUpdate.paymentDueDate));
    }

    await updateDoc(docRef, dataToUpdate);
  } catch (error) {
    console.error(`Error updating document ${invoiceId} in Firestore:`, error);
    throw error;
  }
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId: string, paymentReceiptImageUri?: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  try {
    const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
    const updateData: any = { paymentStatus, userId };
    if (paymentStatus === 'paid' && paymentReceiptImageUri) {
      updateData.paymentReceiptImageUri = paymentReceiptImageUri;
    } else if (paymentStatus !== 'paid') {
      updateData.paymentReceiptImageUri = deleteField();
    }
    await updateDoc(docRef, updateData);
  } catch (error) {
    console.error(`Error updating payment status for document ${invoiceId}:`, error);
    throw error;
  }
}

export async function deleteInvoiceService(invoiceId: string, userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot delete document.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found.");
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
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication required for price check.");

  const productsToSaveDirectly: Product[] = [];
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

  for (const product of productsToCheck) {
    const currentProductUnitPrice = typeof product.unitPrice === 'number' ? product.unitPrice : parseFloat(String(product.unitPrice));
    if (isNaN(currentProductUnitPrice)) {
      console.warn(`[PriceCheck] Product ${product.id || product.catalogNumber} has invalid unitPrice. Skipping price check for it.`);
      productsToSaveDirectly.push(product);
      continue;
    }
    const productWithNumericPrice = { ...product, unitPrice: currentProductUnitPrice };

    if (!product.id || product.id.startsWith('prod-temp-') || product.id.includes('-new') || product.id.includes('_sync_')) {
      productsToSaveDirectly.push(productWithNumericPrice);
      continue;
    }

    try {
      const existingProductRef = doc(db, INVENTORY_COLLECTION, product.id);
      const existingProductSnap = await getDoc(existingProductRef);

      if (existingProductSnap.exists() && existingProductSnap.data().userId === userId) {
        const existingProductData = existingProductSnap.data() as Product;
        const existingUnitPrice = typeof existingProductData.unitPrice === 'number' ? existingProductData.unitPrice : parseFloat(String(existingProductData.unitPrice));

        if (!isNaN(existingUnitPrice) && Math.abs(existingUnitPrice - productWithNumericPrice.unitPrice) > 0.001) {
          priceDiscrepancies.push({
            ...productWithNumericPrice,
            existingUnitPrice: existingUnitPrice,
            newUnitPrice: productWithNumericPrice.unitPrice,
          });
        } else {
          productsToSaveDirectly.push(productWithNumericPrice);
        }
      } else {
        let foundExisting = false;
        if (product.catalogNumber && product.catalogNumber !== 'N/A') {
          const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", product.catalogNumber), limit(1));
          const catSnap = await getDocs(qCat);
          if (!catSnap.empty) {
            const existingProductData = { id: catSnap.docs[0].id, ...catSnap.docs[0].data() } as Product;
            const existingUnitPrice = typeof existingProductData.unitPrice === 'number' ? existingProductData.unitPrice : parseFloat(String(existingProductData.unitPrice));
            if (!isNaN(existingUnitPrice) && Math.abs(existingUnitPrice - productWithNumericPrice.unitPrice) > 0.001) {
              priceDiscrepancies.push({ ...productWithNumericPrice, id: existingProductData.id, existingUnitPrice: existingUnitPrice, newUnitPrice: productWithNumericPrice.unitPrice });
            } else {
              productsToSaveDirectly.push({ ...productWithNumericPrice, id: existingProductData.id });
            }
            foundExisting = true;
          }
        }
        if (!foundExisting && product.barcode && product.barcode.trim() !== '') {
          const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", product.barcode), limit(1));
          const barSnap = await getDocs(qBar);
          if (!barSnap.empty) {
            const existingProductData = { id: barSnap.docs[0].id, ...barSnap.docs[0].data() } as Product;
            const existingUnitPrice = typeof existingProductData.unitPrice === 'number' ? existingProductData.unitPrice : parseFloat(String(existingProductData.unitPrice));
             if (!isNaN(existingUnitPrice) && Math.abs(existingUnitPrice - productWithNumericPrice.unitPrice) > 0.001) {
              priceDiscrepancies.push({ ...productWithNumericPrice, id: existingProductData.id, existingUnitPrice: existingUnitPrice, newUnitPrice: productWithNumericPrice.unitPrice });
            } else {
              productsToSaveDirectly.push({ ...productWithNumericPrice, id: existingProductData.id });
            }
            foundExisting = true;
          }
        }
        if (!foundExisting) {
          productsToSaveDirectly.push(productWithNumericPrice);
        }
      }
    } catch (error) {
      console.error(`Error checking price for product ID ${product.id || product.catalogNumber}:`, error);
      productsToSaveDirectly.push(productWithNumericPrice);
    }
  }
  return { productsToSaveDirectly, priceDiscrepancies };
}


// --- Save Scanned/Edited Document and Update Inventory ---
export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileNameFromUpload: string,
    documentType: 'deliveryNote' | 'invoice',
    userId: string,
    tempInvoiceId?: string,
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number,
    paymentDueDate?: string | Date | Timestamp,
    invoiceDate?: string | Date | Timestamp,
    paymentMethod?: string,
    originalImagePreviewUriToSave?: string,
    compressedImageForFinalRecordUriToSave?: string
): Promise<{
  finalInvoiceRecord?: InvoiceHistoryItem;
  savedProductsWithFinalIds?: Product[];
  uniqueScanIdToClear?: string;
}> {
    if (!db) {
      console.error("Firestore (db) is not initialized. Cannot finalize save.");
      throw new Error("Database not initialized.");
    }
    if (!userId) {
      console.error("User ID is missing. Cannot finalize save.");
      throw new Error("User authentication is required to save products and invoice history.");
    }

    const savedProductsWithFinalIds: Product[] = [];
    let calculatedInvoiceTotalAmountFromProducts = 0;
    const batchOp = writeBatch(db);
    const uniqueScanIdFromTemp = tempInvoiceId?.startsWith(`pending-inv-${userId}_`)
        ? tempInvoiceId.substring(`pending-inv-${userId}_`.length)
        : (tempInvoiceId ? tempInvoiceId : null);

    const shouldUpdateInventory = documentType === 'deliveryNote' || (tempInvoiceId && tempInvoiceId.includes('_sync_'));

    if (shouldUpdateInventory && productsToFinalizeSave.length > 0) {
        for (const productToSave of productsToFinalizeSave) {
            const quantityFromDoc = parseFloat(String(productToSave.quantity)) || 0;
            let unitPriceFromDoc = parseFloat(String(productToSave.unitPrice)) || 0;
            const lineTotalFromDoc = parseFloat(String(productToSave.lineTotal)) || 0;

            if (unitPriceFromDoc === 0 && quantityFromDoc !== 0 && lineTotalFromDoc !== 0 && (lineTotalFromDoc / quantityFromDoc > 0)) {
                unitPriceFromDoc = parseFloat((lineTotalFromDoc / quantityFromDoc).toFixed(2));
            }
            calculatedInvoiceTotalAmountFromProducts += lineTotalFromDoc;

            let existingProductSnap;
            let existingProductRef;

            if (productToSave.id && !productToSave.id.startsWith('prod-temp-') && !productToSave.id.includes('-new') && !productToSave.id.includes('_sync_')) {
                existingProductRef = doc(db, INVENTORY_COLLECTION, productToSave.id);
                existingProductSnap = await getDoc(existingProductRef);
                if (!existingProductSnap.exists() || existingProductSnap.data().userId !== userId) {
                    existingProductSnap = undefined; // Reset if not found or not owned
                }
            }

            if (!existingProductSnap && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productToSave.catalogNumber), limit(1));
                const catSnap = await getDocs(qCat);
                if (!catSnap.empty) {
                    existingProductSnap = catSnap.docs[0];
                    existingProductRef = existingProductSnap.ref;
                }
            }

            if (!existingProductSnap && productToSave.barcode && productToSave.barcode.trim() !== '') {
                const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productToSave.barcode), limit(1));
                const barSnap = await getDocs(qBar);
                if (!barSnap.empty) {
                    existingProductSnap = barSnap.docs[0];
                    existingProductRef = existingProductSnap.ref;
                }
            }

            const productDataForFirestore: Omit<Product, 'id' | 'quantity' | 'unitPrice' | 'lineTotal' > = {
                userId,
                catalogNumber: productToSave.catalogNumber || 'N/A',
                description: productToSave.description || 'No Description',
                shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                barcode: (productToSave.barcode && productToSave.barcode.trim() !== '') ? productToSave.barcode.trim() : null,
                lastUpdated: serverTimestamp(),
                salePrice: productToSave.salePrice !== undefined && !isNaN(Number(productToSave.salePrice)) ? Number(productToSave.salePrice) : null,
                minStockLevel: productToSave.minStockLevel !== undefined && !isNaN(Number(productToSave.minStockLevel)) ? Number(productToSave.minStockLevel) : null,
                maxStockLevel: productToSave.maxStockLevel !== undefined && !isNaN(Number(productToSave.maxStockLevel)) ? Number(productToSave.maxStockLevel) : null,
                imageUrl: productToSave.imageUrl || null,
            };

            if (existingProductSnap && existingProductSnap.exists() && existingProductRef) {
                const existingData = existingProductSnap.data() as Product;
                const currentInventoryQuantity = Number(existingData.quantity) || 0;
                const updatedQuantity = (tempInvoiceId && tempInvoiceId.includes('_sync')) ? quantityFromDoc : currentInventoryQuantity + quantityFromDoc;
                const finalUnitPrice = (unitPriceFromDoc > 0) ? unitPriceFromDoc : (existingData.unitPrice || 0);

                const updatePayload: Partial<Product> = {
                    ...productDataForFirestore,
                    quantity: updatedQuantity,
                    unitPrice: finalUnitPrice,
                    lineTotal: parseFloat(((updatedQuantity || 0) * finalUnitPrice).toFixed(2)),
                };
                batchOp.update(existingProductRef, updatePayload);
                savedProductsWithFinalIds.push({ ...existingData, ...updatePayload, id: existingProductRef.id });
            } else {
                if (!productDataForFirestore.catalogNumber && !productDataForFirestore.description && !productDataForFirestore.barcode) {
                    console.warn("[finalizeSaveProductsService] Skipping product with no identifier:", productToSave);
                    continue;
                }
                const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
                const newProductData: Product = {
                    id: newProductRef.id, // Firestore generates ID here
                    ...(productDataForFirestore as Omit<Product, 'id' | 'quantity' | 'unitPrice' | 'lineTotal' | 'userId'>), // Existing fields
                    userId, // Ensure userId is set for new products
                    quantity: quantityFromDoc,
                    unitPrice: unitPriceFromDoc,
                    lineTotal: parseFloat((quantityFromDoc * unitPriceFromDoc).toFixed(2)),
                };
                batchOp.set(newProductRef, newProductData);
                savedProductsWithFinalIds.push({ ...newProductData });
            }
        }
    } else {
        productsToFinalizeSave.forEach(productToSave => {
            calculatedInvoiceTotalAmountFromProducts += (parseFloat(String(productToSave.lineTotal)) || 0);
        });
    }

    let finalInvoiceRecord: InvoiceHistoryItem | undefined = undefined;
    const finalStatus: InvoiceHistoryItem['status'] = 'completed';
    const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && !isNaN(extractedTotalAmount) && extractedTotalAmount > 0)
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
    const currentUploadTime = Timestamp.now();

    const documentData: Omit<InvoiceHistoryItem, 'id'> = {
        userId,
        generatedFileName: finalGeneratedFileName,
        originalFileName: originalFileNameFromUpload,
        uploadTime: currentUploadTime,
        status: finalStatus,
        documentType: documentType,
        invoiceNumber: extractedInvoiceNumber || null,
        supplierName: finalSupplierName || null,
        totalAmount: finalInvoiceTotalAmount,
        originalImagePreviewUri: originalImagePreviewUriToSave || null,
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave || null,
        paymentStatus: 'unpaid',
        paymentDueDate: paymentDueDate instanceof Date ? Timestamp.fromDate(paymentDueDate) : (typeof paymentDueDate === 'string' ? Timestamp.fromDate(parseISO(paymentDueDate)) : (paymentDueDate instanceof Timestamp ? paymentDueDate : null)),
        invoiceDate: invoiceDate instanceof Timestamp ? invoiceDate : (invoiceDate instanceof Date ? Timestamp.fromDate(invoiceDate) : (typeof invoiceDate === 'string' ? Timestamp.fromDate(parseISO(invoiceDate)) : null)),
        paymentMethod: paymentMethod || null,
        errorMessage: null, // Should be null if successful
    };

    let docRef;
    let isNewDocument = true;

    if (tempInvoiceId && tempInvoiceId.startsWith(`pending-inv-${userId}_`)) {
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        const existingDocSnap = await getDoc(docRef);
        isNewDocument = !existingDocSnap.exists();
    } else if (tempInvoiceId && !tempInvoiceId.includes('_sync')) {
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        const existingDocSnap = await getDoc(docRef);
        isNewDocument = !existingDocSnap.exists();
    } else {
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
    }

    if (isNewDocument) {
        batchOp.set(docRef, documentData);
    } else {
        batchOp.set(docRef, documentData, { merge: true });
    }
    finalInvoiceRecord = { ...documentData, id: docRef.id, uploadTime: (documentData.uploadTime as Timestamp).toDate().toISOString() };

    try {
      await batchOp.commit();
    } catch (error: any) {
      console.error("[finalizeSaveProductsService] Error committing batch to Firestore:", error);
      if (uniqueScanIdFromTemp) {
        return { finalInvoiceRecord: undefined, savedProductsWithFinalIds: [], uniqueScanIdToClear: uniqueScanIdFromTemp };
      }
      throw error;
    }
    return { finalInvoiceRecord, savedProductsWithFinalIds, uniqueScanIdToClear: uniqueScanIdFromTemp };
}


// --- Supplier Management ---
export async function getSupplierSummariesService(userId: string): Promise<SupplierSummary[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get supplier summaries.");
    return [];
  }
  if (!userId) {
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
      supplierMap.set(data.name, {
        id: docSnap.id,
        userId,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        paymentTerms: data.paymentTerms || null,
        invoiceCount: 0,
        totalSpent: 0,
        lastActivityDate: data.lastActivityDate instanceof Timestamp ? data.lastActivityDate.toDate().toISOString() : (data.lastActivityDate || null),
        createdAt: data.createdAt,
      });
    });

    documentsSnapshot.docs.forEach(docSnap => {
      const docData = docSnap.data() as Omit<InvoiceHistoryItem, 'id'>; // Ensure type safety
      if (docData.supplierName && docData.status === 'completed') {
        let supplierEntry = supplierMap.get(docData.supplierName);
        if (supplierEntry) {
          supplierEntry.invoiceCount += 1;
          supplierEntry.totalSpent += (docData.totalAmount || 0);
          const docUploadTime = docData.uploadTime ? (docData.uploadTime instanceof Timestamp ? docData.uploadTime.toDate() : parseISO(docData.uploadTime as string)) : null;
          if (docUploadTime) {
            const currentLastActivity = supplierEntry.lastActivityDate ? parseISO(supplierEntry.lastActivityDate as string) : null;
            if (!currentLastActivity || docUploadTime > currentLastActivity) {
              supplierEntry.lastActivityDate = docUploadTime.toISOString();
            }
          }
        } else {
           const newTempSupplier: SupplierSummary = {
                id: `temp-${docData.supplierName.replace(/\s+/g, '_')}-${Date.now()}`,
                userId,
                name: docData.supplierName,
                invoiceCount: 1,
                totalSpent: docData.totalAmount || 0,
                lastActivityDate: docData.uploadTime ? (docData.uploadTime instanceof Timestamp ? docData.uploadTime.toDate().toISOString() : docData.uploadTime as string) : null,
                createdAt: docData.uploadTime || serverTimestamp(),
            };
            supplierMap.set(docData.supplierName, newTempSupplier);
        }
      }
    });
    return Array.from(supplierMap.values()).sort((a,b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Error fetching supplier summaries from Firestore:", error);
    throw error;
  }
}

export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }, userId: string): Promise<SupplierSummary> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`Supplier with name "${normalizedName}" already exists for this user.`);
  }

  const newSupplierData = {
    userId,
    name: normalizedName,
    phone: contactInfo.phone?.trim() || null,
    email: contactInfo.email?.trim() || null,
    paymentTerms: contactInfo.paymentTerms?.trim() || null,
    invoiceCount: 0,
    totalSpent: 0,
    lastActivityDate: null,
    createdAt: serverTimestamp(),
  };
  const docRef = await addDoc(collection(db, SUPPLIERS_COLLECTION), newSupplierData);
  return { ...newSupplierData, id: docRef.id, createdAt: Timestamp.now() } as SupplierSummary;
}

export async function deleteSupplierService(supplierIdOrName: string, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");

  let supplierRef;
  const docByIdRef = doc(db, SUPPLIERS_COLLECTION, supplierIdOrName);
  let supplierDoc = await getDoc(docByIdRef);

  if (supplierDoc.exists() && supplierDoc.data()?.userId === userId) {
    supplierRef = supplierDoc.ref;
  } else {
    const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", supplierIdOrName), limit(1));
    const nameQuerySnap = await getDocs(q);
    if (!nameQuerySnap.empty) {
      supplierRef = nameQuerySnap.docs[0].ref;
    } else {
      throw new Error(`Supplier "${supplierIdOrName}" not found for this user.`);
    }
  }
  await deleteDoc(supplierRef);
}


export async function updateSupplierContactInfoService(supplierIdOrName: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");

  let supplierRef;
  const docByIdRef = doc(db, SUPPLIERS_COLLECTION, supplierIdOrName);
  let supplierDoc = await getDoc(docByIdRef);

  if (supplierDoc.exists() && supplierDoc.data()?.userId === userId) {
    supplierRef = supplierDoc.ref;
  } else {
    const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", supplierIdOrName), limit(1));
    const nameQuerySnap = await getDocs(q);
    if (!nameQuerySnap.empty) {
      supplierRef = nameQuerySnap.docs[0].ref;
    } else {
      throw new Error(`Supplier "${supplierIdOrName}" not found for this user.`);
    }
  }

  const updateData: any = { userId };
  let hasChanges = false;

  if (contactInfo.phone !== undefined) {
    updateData.phone = contactInfo.phone.trim() || null;
    hasChanges = true;
  }
  if (contactInfo.email !== undefined) {
    updateData.email = contactInfo.email.trim() || null;
    hasChanges = true;
  }
   if (contactInfo.paymentTerms !== undefined) {
    updateData.paymentTerms = contactInfo.paymentTerms.trim() || null;
    hasChanges = true;
  }

  if (hasChanges) {
    await updateDoc(supplierRef, updateData);
  }
}


// --- Settings Management ---
export async function savePosSettingsService(systemId: string, config: PosConnectionConfig, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await setDoc(userSettingsRef, { posSystemId: systemId, posConfig: config, userId }, { merge: true });
}

export async function getPosSettingsService(userId: string): Promise<{ systemId: string; config: PosConnectionConfig } | null> {
  if (!db || !userId) return null;
  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
  const docSnap = await getDoc(userSettingsRef);
  if (docSnap.exists() && docSnap.data().posSystemId) {
    const data = docSnap.data();
    return { systemId: data.posSystemId, config: data.posConfig || {} };
  }
  return null;
}

export async function saveAccountantSettingsService(settings: AccountantSettings, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await setDoc(userSettingsRef, { accountantSettings: settings, userId }, { merge: true });
}

export async function getAccountantSettingsService(userId: string): Promise<AccountantSettings | null> {
    if (!db || !userId) return null;
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);
    if (docSnap.exists()) {
        return docSnap.data().accountantSettings || null;
    }
    return null;
}

export async function saveUserSettingsService(settings: Partial<Omit<UserSettings, 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await setDoc(userSettingsRef, { ...settings, userId }, { merge: true });
}

export async function getUserSettingsService(userId: string): Promise<UserSettings | null> {
    if (!db || !userId) return null;
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        const convertNestedTimestamps = (obj: any): any => {
            if (!obj) return obj;
            Object.keys(obj).forEach(key => {
                if (obj[key] instanceof Timestamp) {
                    obj[key] = obj[key].toDate().toISOString();
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    convertNestedTimestamps(obj[key]);
                }
            });
            return obj;
        };
        return { userId, ...convertNestedTimestamps(data) } as UserSettings;
    }
    return {
        userId,
        reminderDaysBefore: 3,
        posSystemId: null,
        posConfig: {},
        accountantSettings: {},
        monthlyBudget: null,
        kpiPreferences: null,
        quickActionPreferences: null,
    };
}


// --- Temporary Data Management for Uploads ---
export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined' || !userId) {
        return;
    }
    if (!uniqueScanId) {
        return;
    }

    const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${userId}_${uniqueScanId}`);
    const originalImageKey = getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${userId}_${uniqueScanId}`);
    const compressedImageKey = getStorageKey(TEMP_COMPRESSED_IMAGE_KEY_PREFIX, `${userId}_${uniqueScanId}`);
    try {
      localStorage.removeItem(dataKey);
      localStorage.removeItem(originalImageKey);
      localStorage.removeItem(compressedImageKey);
    } catch (error) {
        console.error(`Error removing temp keys for UserID: ${userId}, ScanID: ${uniqueScanId}`, error);
    }
}

export function clearOldTemporaryScanData(emergencyClear: boolean = false, userIdToClear?: string) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
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
    try {
      localStorage.removeItem(key);
      itemsCleared++;
    } catch (e) {
      console.error(`Error removing key ${key}:`, e);
    }
  });

  if (itemsCleared > 0) {
    console.log(`Cleared ${itemsCleared} old/emergency temp scan items (User: ${userIdToClear || 'All Relevant'}).`);
  }
}

// --- Other Expenses & Categories (Placeholder - to be moved to Firestore) ---
// The following are still using localStorage and should be migrated to Firestore
// For now, they are kept to avoid breaking existing functionality that might rely on them
// but will not be further developed using localStorage.

export async function getOtherExpensesService(userId: string): Promise<OtherExpense[]> {
    if (!db || !userId) return [];
    const expensesQuery = query(collection(db, OTHER_EXPENSES_COLLECTION), where("userId", "==", userId));
    const snapshot = await getDocs(expensesQuery);
    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
            id: docSnap.id,
            ...data,
            date: data.date instanceof Timestamp ? data.date.toDate().toISOString() : data.date,
        } as OtherExpense;
    });
}

export async function saveOtherExpensesService(expenses: Omit<OtherExpense, 'id' | 'userId'>[], userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication required.");
    const batch = writeBatch(db);
    expenses.forEach(expense => {
        const newDocRef = doc(collection(db, OTHER_EXPENSES_COLLECTION));
        batch.set(newDocRef, {
            ...expense,
            userId,
            date: typeof expense.date === 'string' ? Timestamp.fromDate(parseISO(expense.date)) : expense.date,
            createdAt: serverTimestamp(),
            id: newDocRef.id
        });
    });
    await batch.commit();
}

export async function updateOtherExpenseService(expenseId: string, expenseData: Partial<Omit<OtherExpense, 'id' | 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication required.");
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    const dataToUpdate: any = { ...expenseData, userId };
    if (expenseData.date && typeof expenseData.date === 'string') {
        dataToUpdate.date = Timestamp.fromDate(parseISO(expenseData.date));
    }
    await updateDoc(docRef, dataToUpdate);
}

export async function deleteOtherExpenseService(expenseId: string, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication required.");
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
        throw new Error("Expense not found or permission denied.");
    }
    await deleteDoc(docRef);
}


export async function getExpenseCategoriesService(userId: string): Promise<string[]> {
  if (!db || !userId) return [];
  const categoriesQuery = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId));
  const snapshot = await getDocs(categoriesQuery);
  return snapshot.docs.map(docSnap => docSnap.data().name as string);
}

export async function saveExpenseCategoriesService(categories: string[], userId: string): Promise<void> {
  if (!db || !userId) throw new Error("User authentication required.");
  const batch = writeBatch(db);
  const existingCategories = await getExpenseCategoriesService(userId); 

  categories.forEach(catName => {
    if (!existingCategories.some(existingCat => existingCat.toLowerCase() === catName.toLowerCase())) {
      const newCategoryRef = doc(collection(db, EXPENSE_CATEGORIES_COLLECTION));
      batch.set(newCategoryRef, { userId, name: catName, createdAt: serverTimestamp() });
    }
  });
  await batch.commit();
}

export async function getExpenseTemplatesService(userId: string): Promise<ExpenseTemplate[]> {
  if (!db || !userId) return [];
  const templatesQuery = query(collection(db, EXPENSE_TEMPLATES_COLLECTION), where("userId", "==", userId));
  const snapshot = await getDocs(templatesQuery);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ExpenseTemplate));
}

export async function saveExpenseTemplatesService(templates: Omit<ExpenseTemplate, 'id' | 'userId'>[], userId: string): Promise<void> {
  if (!db || !userId) throw new Error("User authentication required.");
  const batch = writeBatch(db);
  templates.forEach(template => {
    const newDocRef = doc(collection(db, EXPENSE_TEMPLATES_COLLECTION));
    batch.set(newDocRef, { ...template, userId, createdAt: serverTimestamp(), id: newDocRef.id });
  });
  await batch.commit();
}
