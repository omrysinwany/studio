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
  runTransaction
} from "firebase/firestore";
import { parseISO, isValid } from 'date-fns';
import type { PosConnectionConfig } from './pos-integration/pos-adapter.interface';
import firebaseApp from '@/lib/firebase'; // Assuming firebaseApp is needed for storage if re-enabled

// Firestore Collection Names
export const USERS_COLLECTION = "users";
export const INVENTORY_COLLECTION = "inventoryProducts";
export const DOCUMENTS_COLLECTION = "documents";
export const SUPPLIERS_COLLECTION = "suppliers";
export const OTHER_EXPENSES_COLLECTION = "otherExpenses";
export const EXPENSE_CATEGORIES_COLLECTION = "expenseCategories";
export const EXPENSE_TEMPLATES_COLLECTION = "expenseTemplates";
export const USER_SETTINGS_COLLECTION = "userSettings";

// localStorage keys for UI preferences ONLY (if any remain after full migration)
// export const KPI_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_kpiPreferences_v2';
// export const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_quickActionsPreferences_v1';

export interface User {
  id: string;
  username?: string | null;
  email?: string | null;
  createdAt?: Timestamp | FieldValue;
  lastLoginAt?: Timestamp | FieldValue;
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
  imageUrl?: string | null; // URL to image in Firebase Storage or Data URI
  lastUpdated?: Timestamp | FieldValue;
  _originalId?: string; // Used during scan processing to track temp IDs
}

export interface InvoiceHistoryItem { // Consider renaming to DocumentRecord for clarity
  id: string; // Firestore document ID
  userId: string;
  originalFileName: string;
  generatedFileName: string;
  uploadTime: string | Timestamp | FieldValue; // Store as ISO string or Timestamp
  status: 'pending' | 'processing' | 'completed' | 'error';
  documentType: 'deliveryNote' | 'invoice' | 'paymentReceipt';
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Timestamp | FieldValue | null; // Store as ISO string or Timestamp
  totalAmount?: number | null;
  paymentMethod?: string | null;
  paymentDueDate?: string | Timestamp | FieldValue | null; // Store as ISO string or Timestamp
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentReceiptImageUri?: string | null; // URL to image or Data URI
  originalImagePreviewUri?: string | null; // URL to image or Data URI
  compressedImageForFinalRecordUri?: string | null; // URL to image or Data URI
  errorMessage?: string | null;
  linkedDeliveryNoteId?: string | null;
  rawScanResultJson?: string | null; // Store the full JSON output from AI scan
  _displayContext?: 'image_only' | 'full_details';
}

export interface SupplierSummary {
  id: string; // Firestore document ID
  userId: string;
  name: string;
  invoiceCount: number; // Calculated field
  totalSpent: number;   // Calculated field
  phone?: string | null;
  email?: string | null;
  paymentTerms?: string | null;
  lastActivityDate?: string | Timestamp | null; // Store as ISO string or Timestamp
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
  userId: string; // Should match the document ID in Firestore
  reminderDaysBefore?: number | null;
  posSystemId?: string | null;
  posConfig?: PosConnectionConfig | null;
  accountantSettings?: AccountantSettings | null;
  monthlyBudget?: number | null;
  kpiPreferences?: KpiPreferences | null;
  quickActionPreferences?: QuickActionPreferences | null;
}

export interface OtherExpense {
  id: string; // Firestore document ID
  userId: string;
  description: string;
  amount: number;
  date: string | Timestamp; // Store as ISO string or Timestamp
  category: string; // User-defined category name
  _internalCategoryKey?: string | null; // For matching, e.g. "property_tax"
  categoryId?: string | null; // Optional: if categories are managed separately
}

export interface ExpenseCategory {
  id: string; // Firestore document ID
  userId: string;
  name: string; // User-facing name
  internalKey: string; // For programmatic reference, e.g., "property_tax"
  isFixed?: boolean;
  defaultAmount?: number | null;
  createdAt: Timestamp | FieldValue;
}

export interface ExpenseTemplate {
  id: string; // Firestore document ID
  userId: string;
  name: string;
  categoryId: string; // Link to ExpenseCategory
  description: string;
  amount: number;
}

export const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(`[getStorageKey] Called for baseKey "${baseKey}" without a userId.`);
    return `${baseKey}_SHARED_OR_NO_USER`;
  }
  return `${baseKey}_${userId}`;
};

// `getStoredData` and `saveStoredData` for localStorage are now largely obsolete for core business data.
// They might still be used for very minor UI preferences not fitting into UserSettings, or for temporary states if absolutely necessary.
// For this migration, we assume they are being phased out for critical data.

export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScanData_'; // Used for temporary AI scan JSON if Firestore pending doc fails
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.8 * 1024 * 1024; // For AI scan JSON (Firestore doc limit is 1MB)
export const MAX_INVOICE_HISTORY_ITEMS = 10; // For recent uploads display if loaded from localStorage, less relevant with Firestore

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
  if (!db) throw new Error("Firestore (db) is not initialized in saveUserToFirestore.");
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
    console.log(`[Backend] User ${userData.id} saved/updated in Firestore.`);
  } catch (error) {
    console.error("[Backend - saveUserToFirestore] Error saving user to Firestore:", error);
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
    return null;
  } catch (error) {
    console.error("[Backend] Error fetching user from Firestore:", error);
    throw error; 
  }
}

// --- Inventory Products (Firestore) ---
export async function getProductsService(userId: string): Promise<Product[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getProductsService.");
    return [];
  }
  if (!userId) {
    console.warn("getProductsService called without userId. Returning empty array.");
    return [];
  }
  
  const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), orderBy("shortName"));
  try {
    const snapshot = await getDocs(productsQuery);
    return snapshot.docs.map(docSnap => ({ 
        id: docSnap.id, 
        userId, // Ensure userId is part of the returned object
        ...docSnap.data(),
        lastUpdated: docSnap.data().lastUpdated instanceof Timestamp ? docSnap.data().lastUpdated : undefined,
    } as Product));
  } catch (error) {
    console.error("[Backend] Error fetching products from Firestore:", error);
    if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for products. Please create the suggested index in your Firebase console.");
    }
    throw error;
  }
}

export async function getProductByIdService(productId: string, userId: string): Promise<Product | null> {
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
          lastUpdated: data.lastUpdated instanceof Timestamp ? data.lastUpdated : undefined,
      } as Product;
    }
    return null;
  } catch (error) {
    console.error(`[Backend] Error fetching product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function updateProductService(productId: string, updatedData: Partial<Omit<Product, 'id' | 'userId'>>, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
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
     console.log(`[Backend] Product ${productId} updated in Firestore for user ${userId}.`);
  } catch (error) {
    console.error(`[Backend] Error updating product ${productId} in Firestore:`, error);
    throw error;
  }
}

export async function deleteProductService(productId: string, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  try {
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists() || productDoc.data().userId !== userId) {
      throw new Error("Permission denied or product not found for deletion.");
    }
    await deleteDoc(productRef);
    console.log(`[Backend] Product ${productId} deleted from Firestore for user ${userId}.`);
  } catch (error) {
    console.error(`[Backend] Error deleting product ${productId} from Firestore:`, error);
    throw error;
  }
}

async function deleteCollectionByUserId(collectionName: string, userId: string): Promise<void> {
  if (!db || !userId) throw new Error(`DB not initialized or User ID missing for deleteCollectionByUserId: ${collectionName}`);
  
  const q = query(collection(db, collectionName), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    console.log(`[Backend - deleteCollectionByUserId] No documents to delete in ${collectionName} for user ${userId}.`);
    return;
  }

  const batch = writeBatch(db);
  snapshot.docs.forEach(docSnap => {
    batch.delete(docSnap.ref);
  });
  await batch.commit();
  console.log(`[Backend - deleteCollectionByUserId] All documents in ${collectionName} for user ${userId} have been deleted.`);
}

export async function clearInventoryService(userId: string): Promise<void> {
  await deleteCollectionByUserId(INVENTORY_COLLECTION, userId);
}

// --- Documents (Invoices/Delivery Notes - Firestore) ---
export async function getInvoicesService(userId: string): Promise<InvoiceHistoryItem[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getInvoicesService.");
    return [];
  }
  if (!userId) {
    console.warn("getInvoicesService called without userId. Returning empty array.");
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
            userId,
            ...data,
            uploadTime: convertTimestampToString(data.uploadTime), 
            invoiceDate: convertTimestampToString(data.invoiceDate),
            paymentDueDate: convertTimestampToString(data.paymentDueDate),
            _displayContext: data._displayContext || 'full_details',
        } as InvoiceHistoryItem;
    });
  } catch (error) {
    console.error("[Backend] Error fetching documents from Firestore:", error);
     if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for documents. Firebase usually provides a link in the error message to create it. Check the browser console for the full error.");
    }
    throw error;
  }
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<Omit<InvoiceHistoryItem, 'id' | 'userId'>>, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");

  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  
  const dataToUpdate: any = { ...updatedData }; 
  const convertToTimestampIfValidStringOrDate = (dateField: any): Timestamp | null => {
    if (!dateField) return null;
    if (dateField instanceof Date && isValid(dateField)) return Timestamp.fromDate(dateField); 
    if (typeof dateField === 'string' && isValid(parseISO(dateField))) {
      return Timestamp.fromDate(parseISO(dateField));
    }
    return dateField instanceof Timestamp ? dateField : null; 
  };

  if (dataToUpdate.hasOwnProperty('invoiceDate')) dataToUpdate.invoiceDate = convertToTimestampIfValidStringOrDate(dataToUpdate.invoiceDate);
  if (dataToUpdate.hasOwnProperty('paymentDueDate')) dataToUpdate.paymentDueDate = convertToTimestampIfValidStringOrDate(dataToUpdate.paymentDueDate);
  if (dataToUpdate.hasOwnProperty('uploadTime') && !(dataToUpdate.uploadTime instanceof Timestamp || dataToUpdate.uploadTime === serverTimestamp())) {
     dataToUpdate.uploadTime = convertToTimestampIfValidStringOrDate(dataToUpdate.uploadTime) || serverTimestamp();
  }
  
  const sanitizedDataToUpdate = sanitizeForFirestore(dataToUpdate);

  try {
    const docSnap = await getDoc(docRef);
    if(!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for update.");
    }
    await updateDoc(docRef, sanitizedDataToUpdate);
    console.log(`[Backend] Document ${invoiceId} updated in Firestore for user ${userId}.`);
  } catch (error) {
    console.error(`[Backend] Error updating document ${invoiceId} in Firestore:`, error);
    throw error;
  }
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId: string, paymentReceiptImageUri?: string | null): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const updateData: any = { paymentStatus };
 
  if (paymentStatus === 'paid' && paymentReceiptImageUri !== undefined) {
    updateData.paymentReceiptImageUri = paymentReceiptImageUri; 
  } else if (paymentStatus !== 'paid') { 
    updateData.paymentReceiptImageUri = null;
  }

  try {
     const docSnap = await getDoc(docRef);
     if(!docSnap.exists() || docSnap.data().userId !== userId) {
        throw new Error("Permission denied or document not found for payment status update.");
     }
    await updateDoc(docRef, sanitizeForFirestore(updateData));
     console.log(`[Backend] Payment status for document ${invoiceId} updated to ${paymentStatus} for user ${userId}.`);
  } catch (error) {
    console.error(`[Backend] Error updating payment status for document ${invoiceId}:`, error);
    throw error;
  }
}

export async function deleteInvoiceService(invoiceId: string, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  try {
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for deletion.");
    }
    await deleteDoc(docRef);
    console.log(`[Backend] Document ${invoiceId} deleted from Firestore for user ${userId}.`);
  } catch (error) {
    console.error(`[Backend] Error deleting document ${invoiceId} from Firestore:`, error);
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
  if (!db) {
    console.error("Firestore (db) is not initialized in checkProductPricesBeforeSaveService.");
    return { productsToSaveDirectly: productsToCheck.map(p => ({...p, unitPrice: Number(p.unitPrice) || 0 })), priceDiscrepancies: [] };
  }
  if (!userId) {
    console.warn("checkProductPricesBeforeSaveService called without userId");
    return { productsToSaveDirectly: productsToCheck.map(p => ({...p, unitPrice: Number(p.unitPrice) || 0 })), priceDiscrepancies: [] };
  }

  const productsToSaveDirectly: Product[] = [];
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

  for (const product of productsToCheck) {
    const currentProductUnitPrice = Number(product.unitPrice) || 0;
    const productWithNumericPrice = { ...product, unitPrice: currentProductUnitPrice };

    let existingProductData: Product | null = null;
    let productToQueryId = product._originalId || product.id;

    if (productToQueryId && !productToQueryId.startsWith('prod-temp-') && !productToQueryId.startsWith('temp-id-')) {
      const docRef = doc(db, INVENTORY_COLLECTION, productToQueryId);
      const snap = await getDoc(docRef);
      if (snap.exists() && snap.data().userId === userId) {
        existingProductData = { id: snap.id, userId, ...snap.data() } as Product;
      }
    }
    if (!existingProductData && product.catalogNumber && product.catalogNumber !== 'N/A') {
      const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", product.catalogNumber), limit(1));
      const catSnap = await getDocs(qCat);
      if (!catSnap.empty) {
        existingProductData = { id: catSnap.docs[0].id, userId, ...catSnap.docs[0].data() } as Product;
      }
    }
    if (!existingProductData && product.barcode && product.barcode.trim() !== '') {
      const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", product.barcode.trim()), limit(1));
      const barSnap = await getDocs(qBar);
      if (!barSnap.empty) {
        existingProductData = { id: barSnap.docs[0].id, userId, ...barSnap.docs[0].data() } as Product;
      }
    }

    if (existingProductData) {
        const existingUnitPrice = Number(existingProductData.unitPrice) || 0;
        if (Math.abs(existingUnitPrice - productWithNumericPrice.unitPrice) > 0.001 && productWithNumericPrice.unitPrice > 0) {
          priceDiscrepancies.push({
            ...productWithNumericPrice,
            id: existingProductData.id, 
            userId,
            _originalId: existingProductData.id,
            existingUnitPrice: existingUnitPrice,
            newUnitPrice: productWithNumericPrice.unitPrice,
          });
        } else {
          productsToSaveDirectly.push({...productWithNumericPrice, id: existingProductData.id, userId, _originalId: existingProductData.id });
        }
    } else {
        productsToSaveDirectly.push({...productWithNumericPrice, userId});
    }
  }
  return { productsToSaveDirectly, priceDiscrepancies };
}

export async function finalizeSaveProductsService(
    productsFromDoc: Partial<Product>[], // Products might not have full Product structure yet
    originalFileNameFromUpload: string,
    documentType: 'deliveryNote' | 'invoice',
    userId: string,
    tempInvoiceId?: string, // This is the ID of the pending Firestore document
    extractedInvoiceNumber?: string | null,
    finalSupplierName?: string | null,
    extractedTotalAmount?: number | null,
    paymentDueDate?: string | Date | Timestamp | null,
    invoiceDate?: string | Date | Timestamp | null,
    paymentMethod?: string | null,
    originalImagePreviewDataUri?: string | null,
    compressedImageForFinalRecordDataUri?: string | null,
    rawScanResultJson?: string | null // The full JSON from AI scan
): Promise<{
  finalInvoiceRecord: InvoiceHistoryItem;
  savedProductsWithFinalIds: Product[];
}> {
  if (!db) throw new Error("Database not initialized for finalizeSaveProductsService.");
  if (!userId) throw new Error("User authentication is required for finalizeSaveProductsService.");
  console.log(`[Backend - finalizeSaveProductsService] User: ${userId}, DocType: ${documentType}, TempID: ${tempInvoiceId}, Products: ${productsFromDoc.length}`);

  const savedProductsWithFinalIds: Product[] = [];
  let calculatedInvoiceTotalAmountFromProducts = 0;
  const batchOp = writeBatch(db);
  const shouldUpdateInventory = documentType === 'deliveryNote';

  if (shouldUpdateInventory && productsFromDoc.length > 0) {
    for (const productFromUI of productsFromDoc) {
      const quantityFromDoc = Number(productFromUI.quantity) || 0;
      let unitPriceFromDoc = Number(productFromUI.unitPrice) || 0;
      const lineTotalFromDoc = Number(productFromUI.lineTotal) || 0;

      if (unitPriceFromDoc === 0 && quantityFromDoc !== 0 && lineTotalFromDoc !== 0) {
        unitPriceFromDoc = parseFloat((lineTotalFromDoc / quantityFromDoc).toFixed(2));
      }
      calculatedInvoiceTotalAmountFromProducts += lineTotalFromDoc;

      let existingProductRef;
      let existingProductData: Product | undefined = undefined;
      let productToQueryId = productFromUI._originalId || productFromUI.id;

      if (productToQueryId && !productToQueryId.startsWith('prod-temp-') && !productToQueryId.startsWith('temp-id-')) {
        const snap = await getDoc(doc(db, INVENTORY_COLLECTION, productToQueryId));
        if (snap.exists() && snap.data().userId === userId) {
          existingProductRef = snap.ref;
          existingProductData = { id: snap.id, userId, ...snap.data() } as Product;
        }
      }
      if (!existingProductData && productFromUI.catalogNumber && productFromUI.catalogNumber !== 'N/A') {
        const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productFromUI.catalogNumber), limit(1));
        const catSnap = await getDocs(qCat);
        if (!catSnap.empty) {
          existingProductRef = catSnap.docs[0].ref;
          existingProductData = { id: catSnap.docs[0].id, userId, ...catSnap.docs[0].data() } as Product;
        }
      }
      if (!existingProductData && productFromUI.barcode && productFromUI.barcode.trim() !== '') {
        const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productFromUI.barcode.trim()), limit(1));
        const barSnap = await getDocs(qBar);
        if (!barSnap.empty) {
          existingProductRef = barSnap.docs[0].ref;
          existingProductData = { id: barSnap.docs[0].id, userId, ...barSnap.docs[0].data() } as Product;
        }
      }

      if (existingProductRef && existingProductData) {
        const currentInventoryQuantity = Number(existingProductData.quantity) || 0;
        const updatedQuantity = currentInventoryQuantity + quantityFromDoc;
        
        const updatePayload: Partial<Product> & { lastUpdated: FieldValue } = {
          quantity: updatedQuantity,
          unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : (existingProductData.unitPrice || 0), // Update cost price
          lastUpdated: serverTimestamp(),
          // Preserve existing details unless explicitly provided from UI (which now happens for new products via BarcodePromptDialog)
          description: productFromUI.description !== undefined && productFromUI.description !== existingProductData.description ? productFromUI.description : existingProductData.description,
          shortName: productFromUI.shortName !== undefined && productFromUI.shortName !== existingProductData.shortName ? productFromUI.shortName : existingProductData.shortName,
          catalogNumber: productFromUI.catalogNumber || existingProductData.catalogNumber,
          barcode: productFromUI.barcode !== undefined ? (productFromUI.barcode || null) : (existingProductData.barcode || null),
          salePrice: productFromUI.salePrice !== undefined ? (Number(productFromUI.salePrice) ?? null) : (existingProductData.salePrice ?? null),
          minStockLevel: productFromUI.minStockLevel !== undefined ? (Number(productFromUI.minStockLevel) ?? null) : (existingProductData.minStockLevel ?? null),
          maxStockLevel: productFromUI.maxStockLevel !== undefined ? (Number(productFromUI.maxStockLevel) ?? null) : (existingProductData.maxStockLevel ?? null),
          imageUrl: productFromUI.imageUrl !== undefined ? (productFromUI.imageUrl || null) : (existingProductData.imageUrl || null),
        };
        updatePayload.lineTotal = parseFloat(((updatePayload.quantity || 0) * (updatePayload.unitPrice || 0)).toFixed(2));
        
        batchOp.update(existingProductRef, sanitizeForFirestore(updatePayload as Partial<Product>));
        savedProductsWithFinalIds.push({ ...existingProductData, ...updatePayload, id: existingProductData.id, userId } as Product);
        console.log(`[Backend] Product ${existingProductData.id} updated for user ${userId}. New Qty: ${updatePayload.quantity}`);
      } else {
        if (!productFromUI.catalogNumber && !productFromUI.description && !productFromUI.barcode) {
          console.warn("[Backend] Skipping new product due to missing identifiers:", productFromUI);
          continue;
        }
        const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
        const newProductData: Product = {
          id: newProductRef.id, 
          userId,
          catalogNumber: productFromUI.catalogNumber || 'N/A',
          description: productFromUI.description || 'No Description',
          shortName: productFromUI.shortName || (productFromUI.description || 'No Description').split(' ').slice(0, 3).join(' '),
          barcode: (productFromUI.barcode && productFromUI.barcode.trim() !== '') ? (productFromUI.barcode.trim() || null) : null,
          quantity: quantityFromDoc,
          unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : 0,
          salePrice: productFromUI.salePrice !== undefined ? (Number(productFromUI.salePrice) ?? null) : null,
          lineTotal: 0, 
          minStockLevel: productFromUI.minStockLevel !== undefined ? (Number(productFromUI.minStockLevel) ?? null) : null,
          maxStockLevel: productFromUI.maxStockLevel !== undefined ? (Number(productFromUI.maxStockLevel) ?? null) : null,
          imageUrl: productFromUI.imageUrl || null,
          lastUpdated: serverTimestamp(),
        };
        newProductData.lineTotal = parseFloat(((newProductData.quantity || 0) * (newProductData.unitPrice || 0)).toFixed(2));

        batchOp.set(newProductRef, sanitizeForFirestore(newProductData));
        savedProductsWithFinalIds.push({ ...newProductData });
        console.log(`[Backend] New product ${newProductRef.id} created for user ${userId}.`);
      }
    }
  } else if (documentType === 'invoice') {
    // For tax invoices, we only sum up line totals if provided, but don't update inventory
    productsFromDoc.forEach(p => calculatedInvoiceTotalAmountFromProducts += (Number(p.lineTotal) || 0));
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
  let isUpdatingPendingDoc = false;

  if (tempInvoiceId) {
    docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
    const existingDocSnap = await getDoc(docRef);
    if (existingDocSnap.exists() && existingDocSnap.data().userId === userId) {
        isUpdatingPendingDoc = true;
    } else {
        console.warn(`[Backend] Pending document ${tempInvoiceId} not found or user mismatch for finalize. Creating new document.`);
        docRef = doc(collection(db, DOCUMENTS_COLLECTION)); // Create a new doc if pending not found or user mismatch
    }
  } else { 
    docRef = doc(collection(db, DOCUMENTS_COLLECTION));
  }

  const convertToTimestampIfValid = (dateVal: any): Timestamp | null => {
    if (!dateVal) return null;
    if (dateVal instanceof Date && isValid(dateVal)) return Timestamp.fromDate(dateVal);
    if (typeof dateVal === 'string' && isValid(parseISO(dateVal))) return Timestamp.fromDate(parseISO(dateVal));
    if (dateVal instanceof Timestamp) return dateVal;
    return null;
  };

  const documentDataForFirestore: Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { uploadTime: Timestamp | FieldValue } = {
    userId,
    generatedFileName: finalGeneratedFileName,
    originalFileName: originalFileNameFromUpload,
    uploadTime: isUpdatingPendingDoc ? (await getDoc(docRef)).data()?.uploadTime || serverTimestamp() : serverTimestamp(),
    status: 'completed',
    documentType: documentType,
    invoiceNumber: extractedInvoiceNumber || null,
    supplierName: finalSupplierName || null,
    totalAmount: !isNaN(finalInvoiceTotalAmount) ? finalInvoiceTotalAmount : null,
    paymentStatus: 'unpaid', 
    paymentDueDate: convertToTimestampIfValid(paymentDueDate),
    invoiceDate: convertToTimestampIfValid(invoiceDate),
    paymentMethod: paymentMethod || null,
    errorMessage: null, // Clear any previous error message from pending state
    rawScanResultJson: rawScanResultJson || null, // Save the raw AI scan result
    paymentReceiptImageUri: null, // Only for paid invoices, handled by a separate function
    originalImagePreviewUri: originalImagePreviewDataUri || null,
    compressedImageForFinalRecordUri: compressedImageForFinalRecordDataUri || null,
    linkedDeliveryNoteId: null,
  };
  
  batchOp.set(docRef, sanitizeForFirestore(documentDataForFirestore), { merge: isUpdatingPendingDoc }); // Merge if updating existing pending doc
  console.log(`[Backend] Document ${docRef.id} ${isUpdatingPendingDoc ? 'updated' : 'created'} in Firestore for user ${userId}.`);


  let finalUploadTimeForReturn: string;
  const currentDataForUploadTime = (await getDoc(docRef)).data(); // Re-fetch to get server timestamp if it was set
  if (currentDataForUploadTime && currentDataForUploadTime.uploadTime instanceof Timestamp) {
    finalUploadTimeForReturn = currentDataForUploadTime.uploadTime.toDate().toISOString();
  } else {
    finalUploadTimeForReturn = new Date().toISOString(); // Fallback
  }
  
  const finalInvoiceRecord: InvoiceHistoryItem = { 
    ...(documentDataForFirestore as Omit<InvoiceHistoryItem, 'id' | 'uploadTime' | 'invoiceDate' | 'paymentDueDate'>), 
    id: docRef.id, 
    userId,
    uploadTime: finalUploadTimeForReturn,
    invoiceDate: documentDataForFirestore.invoiceDate instanceof Timestamp ? documentDataForFirestore.invoiceDate.toDate().toISOString() : null,
    paymentDueDate: documentDataForFirestore.paymentDueDate instanceof Timestamp ? documentDataForFirestore.paymentDueDate.toDate().toISOString() : null,
  };

  try {
    await batchOp.commit();
    console.log("[Backend] Firestore batch commit successful for finalizeSaveProductsService.");
    // Temporary localStorage data for AI scan JSON is now handled by upload page; no need to clear from here
  } catch (error: any) {
    console.error("[Backend] Error committing batch to Firestore in finalizeSaveProductsService:", error);
    throw new Error(`Failed to save document and products to Firestore: ${error.message}`);
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
      const createdAtTimestamp = data.createdAt instanceof Timestamp ? data.createdAt : serverTimestamp();
      let lastActivityDateTimestamp: Timestamp | string | null = null;
      if (data.lastActivityDate instanceof Timestamp) {
        lastActivityDateTimestamp = data.lastActivityDate.toDate().toISOString();
      } else if (typeof data.lastActivityDate === 'string') {
        lastActivityDateTimestamp = data.lastActivityDate;
      }
      
      if (data.name && typeof data.name === 'string' && data.name.trim() !== '') {
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
        console.warn(`[Backend] Supplier document ${docSnap.id} for user ${userId} is missing a valid name.`);
      }
    });

    documentsSnapshot.docs.forEach(docSnap => {
      const docData = docSnap.data() as InvoiceHistoryItem; 
      if (docData.supplierName && typeof docData.supplierName === 'string' && docData.status === 'completed') {
        let supplierEntry = supplierMap.get(docData.supplierName);
        if (supplierEntry) {
            supplierEntry.invoiceCount += 1;
            supplierEntry.totalSpent += (docData.totalAmount || 0);

            let docUploadDate: Date | null = null;
            if (docData.uploadTime) {
                if (docData.uploadTime instanceof Timestamp) docUploadDate = docData.uploadTime.toDate();
                else if (typeof docData.uploadTime === 'string' && isValid(parseISO(docData.uploadTime))) docUploadDate = parseISO(docData.uploadTime);
            }
            
            let currentLastActivityDate: Date | null = null;
            if (supplierEntry.lastActivityDate) {
                 if(supplierEntry.lastActivityDate instanceof Timestamp) currentLastActivityDate = supplierEntry.lastActivityDate.toDate();
                 else if(typeof supplierEntry.lastActivityDate === 'string' && isValid(parseISO(supplierEntry.lastActivityDate))) currentLastActivityDate = parseISO(supplierEntry.lastActivityDate);
            }

            if (docUploadDate && (!currentLastActivityDate || docUploadDate > currentLastActivityDate)) {
              supplierEntry.lastActivityDate = docUploadDate.toISOString();
            }
            supplierMap.set(docData.supplierName, supplierEntry);
        } else {
            // console.warn(`[Backend] Supplier "${docData.supplierName}" from document ${docSnap.id} not found in main suppliers list for user ${userId}. Consider creating it.`);
        }
      }
    });
    return Array.from(supplierMap.values()).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  } catch (error) {
    console.error("[Backend] Error fetching supplier summaries from Firestore:", error);
    throw error;
  }
}

export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId: string): Promise<SupplierSummary> {
  if (!db) throw new Error("Database not initialized for createSupplierService.");
  if (!userId) throw new Error("User authentication is required for createSupplierService.");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  console.log(`[Backend - createSupplierService] Checking for existing supplier: Name='${normalizedName}', UserID='${userId}'`);
  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) {
    console.warn(`[Backend - createSupplierService] Supplier with name "${normalizedName}" already exists for user ${userId}.`);
    throw new Error(`Supplier with name "${normalizedName}" already exists.`);
  }

  const newSupplierRef = doc(collection(db, SUPPLIERS_COLLECTION));
  const newSupplierData: Omit<SupplierSummary, 'id' | 'createdAt' | 'lastActivityDate' | 'invoiceCount' | 'totalSpent'> & { userId: string, createdAt: FieldValue } = {
    name: normalizedName,
    phone: contactInfo.phone?.trim() || null,
    email: contactInfo.email?.trim() || null,
    paymentTerms: contactInfo.paymentTerms?.trim() || null,
    userId: userId, 
    createdAt: serverTimestamp(),
  };
  console.log(`[Backend - createSupplierService] Attempting to save new supplier with data:`, newSupplierData, `for userId: ${userId}`);
  await setDoc(newSupplierRef, sanitizeForFirestore(newSupplierData));
  console.log(`[Backend] New supplier ${newSupplierRef.id} created for user ${userId}.`);

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

export async function deleteSupplierService(supplierId: string, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing for deleteSupplierService.");
  
  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const supplierDoc = await getDoc(supplierRef);
  if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
    throw new Error(`Supplier not found or permission denied for deletion for supplier ID: ${supplierId}`);
  }
  await deleteDoc(supplierRef);
   console.log(`[Backend] Supplier ${supplierId} deleted for user ${userId}.`);
}

export async function clearSuppliersService(userId: string): Promise<void> {
  await deleteCollectionByUserId(SUPPLIERS_COLLECTION, userId);
}

export async function updateSupplierContactInfoService(supplierId: string, contactInfo: { phone?: string | null; email?: string | null; paymentTerms?: string | null }, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");

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
    console.log(`[Backend - updateSupplierContactInfoService] Updating supplier ${supplierId} with:`, updatePayload);
    await updateDoc(supplierRef, sanitizeForFirestore(updatePayload));
    console.log(`[Backend] Supplier contact info for ${supplierId} updated by user ${userId}.`);
  } else {
    console.log(`[Backend - updateSupplierContactInfoService] No changes to update for supplier ${supplierId}.`);
  }
}


// --- User Settings (Firestore) ---
export async function saveUserSettingsService(settings: Partial<Omit<UserSettings, 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("DB not initialized or User ID missing for saveUserSettingsService.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId); // Document ID IS the userId
    
    // Create a deep copy to avoid mutating the original settings object, then sanitize
    const settingsToSave: Partial<UserSettings> = JSON.parse(JSON.stringify(settings)); 

    if (settingsToSave.hasOwnProperty('accountantSettings')) {
        settingsToSave.accountantSettings = settingsToSave.accountantSettings ? sanitizeForFirestore(settingsToSave.accountantSettings) : { name: null, email: null, phone: null };
    }
    if (settingsToSave.hasOwnProperty('posConfig')) {
        settingsToSave.posConfig = settingsToSave.posConfig ? sanitizeForFirestore(settingsToSave.posConfig) : {};
    }
    if (settingsToSave.hasOwnProperty('kpiPreferences')) {
        settingsToSave.kpiPreferences = settingsToSave.kpiPreferences ? sanitizeForFirestore(settingsToSave.kpiPreferences) : { visibleKpiIds: ['totalItems', 'inventoryValue', 'grossProfit', 'currentMonthExpenses', 'lowStock', 'amountToPay'], kpiOrder: ['totalItems', 'inventoryValue', 'grossProfit', 'currentMonthExpenses', 'lowStock', 'amountToPay', 'documentsProcessed30d', 'averageInvoiceValue', 'suppliersCount'] };
    }
    if (settingsToSave.hasOwnProperty('quickActionPreferences')) {
        settingsToSave.quickActionPreferences = settingsToSave.quickActionPreferences ? sanitizeForFirestore(settingsToSave.quickActionPreferences) : { visibleQuickActionIds: ['scanDocument', 'viewInventory', 'viewDocuments', 'addExpense', 'openInvoices', 'latestDocument'], quickActionOrder: ['scanDocument', 'viewInventory', 'viewDocuments', 'addExpense', 'openInvoices', 'latestDocument', 'addSupplier'] };
    }
    
    if (settingsToSave.hasOwnProperty('monthlyBudget') && settingsToSave.monthlyBudget === undefined) settingsToSave.monthlyBudget = null;
    if (settingsToSave.hasOwnProperty('reminderDaysBefore') && settingsToSave.reminderDaysBefore === undefined) settingsToSave.reminderDaysBefore = null;
    if (settingsToSave.hasOwnProperty('posSystemId') && settingsToSave.posSystemId === undefined) settingsToSave.posSystemId = null;
    
    delete (settingsToSave as any).userId; // Ensure userId is not part of the data payload itself
    
    console.log("[Backend - saveUserSettingsService] Saving settings for user:", userId, settingsToSave);
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
        kpiPreferences: { visibleKpiIds: ['totalItems', 'inventoryValue', 'grossProfit', 'currentMonthExpenses', 'lowStock', 'amountToPay'], kpiOrder: ['totalItems', 'inventoryValue', 'grossProfit', 'currentMonthExpenses', 'lowStock', 'amountToPay', 'documentsProcessed30d', 'averageInvoiceValue', 'suppliersCount'] }, 
        quickActionPreferences: { visibleQuickActionIds: ['scanDocument', 'viewInventory', 'viewDocuments', 'addExpense', 'openInvoices', 'latestDocument'], quickActionOrder: ['scanDocument', 'viewInventory', 'viewDocuments', 'addExpense', 'openInvoices', 'latestDocument', 'addSupplier'] } 
    };
    if (!db || !userId) {
      console.warn("[Backend] getUserSettingsService called without db or userId, returning defaults.");
      return defaultSettings;
    }
    
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        return { 
            ...defaultSettings, 
            ...data,            
            userId, // Ensure userId from param is used as the primary identifier
            accountantSettings: data.accountantSettings ? { 
                name: data.accountantSettings.name || null,
                email: data.accountantSettings.email || null,
                phone: data.accountantSettings.phone || null,
            } : defaultSettings.accountantSettings,
            posConfig: data.posConfig || defaultSettings.posConfig,
            kpiPreferences: data.kpiPreferences || defaultSettings.kpiPreferences,
            quickActionPreferences: data.quickActionPreferences || defaultSettings.quickActionPreferences,
            monthlyBudget: data.monthlyBudget === undefined ? null : (data.monthlyBudget ?? null), // Handle undefined specifically
            reminderDaysBefore: data.reminderDaysBefore === undefined ? defaultSettings.reminderDaysBefore : (data.reminderDaysBefore ?? null),
        };
    }
    console.log(`[Backend] No settings found for user ${userId}, returning defaults and creating initial settings doc.`);
    // Create initial settings doc if it doesn't exist
    await setDoc(userSettingsRef, sanitizeForFirestore({ ...defaultSettings, userId }), { merge: true }); // Ensure userId is set here too
    return defaultSettings; 
}


// --- Other Expenses & Categories (Firestore) ---
export async function getOtherExpensesService(userId: string): Promise<OtherExpense[]> {
  if (!db || !userId) {
    console.warn("[Backend] getOtherExpensesService called without db or userId, returning empty array.");
    return [];
  }
  const expensesQuery = query(collection(db, OTHER_EXPENSES_COLLECTION), where("userId", "==", userId), orderBy("date", "desc"));
  try {
    const snapshot = await getDocs(expensesQuery);
    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
            id: docSnap.id, ...data,
            userId,
            date: data.date instanceof Timestamp ? data.date.toDate().toISOString() : data.date, 
        } as OtherExpense;
    });
  } catch (error) {
    console.error("[Backend] Error fetching other expenses from Firestore:", error);
    if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for otherExpenses. Check browser console for link to create it.");
    }
    throw error;
  }
}

export async function saveOtherExpenseService(expenseData: Omit<OtherExpense, 'id' | 'userId'> & {id?: string}, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveOtherExpenseService.");
  
  const { id: expenseId, ...dataToProcess } = expenseData;

  let dateForFirestore: Timestamp | FieldValue;
  if (dataToProcess.date instanceof Timestamp) {
    dateForFirestore = dataToProcess.date;
  } else if (typeof dataToProcess.date === 'string' && isValid(parseISO(dataToProcess.date))) {
    dateForFirestore = Timestamp.fromDate(parseISO(dataToProcess.date));
  } else if (dataToProcess.date instanceof Date && isValid(dataToProcess.date)) {
    dateForFirestore = Timestamp.fromDate(dataToProcess.date);
  } else {
    dateForFirestore = serverTimestamp();
  }

  const dataToSave: any = { 
    ...dataToProcess,
    userId,
    date: dateForFirestore, 
    _internalCategoryKey: dataToProcess._internalCategoryKey || null, 
    categoryId: dataToProcess.categoryId || null, 
  };

  if (expenseId) { 
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    await updateDoc(docRef, sanitizeForFirestore({ ...dataToSave, lastUpdatedAt: serverTimestamp() }));
    console.log(`[Backend] Other expense ${expenseId} updated for user ${userId}.`);
    return expenseId;
  } else { 
    const newDocRef = doc(collection(db, OTHER_EXPENSES_COLLECTION));
    delete dataToSave.id; // Ensure no 'id' field in the data if Firestore generates it
    await setDoc(newDocRef, sanitizeForFirestore({ ...dataToSave, createdAt: serverTimestamp() }));
    console.log(`[Backend] New other expense ${newDocRef.id} created for user ${userId}.`);
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
    console.log(`[Backend] Other expense ${expenseId} deleted for user ${userId}.`);
}

export async function clearOtherExpensesService(userId: string): Promise<void> {
  await deleteCollectionByUserId(OTHER_EXPENSES_COLLECTION, userId);
}

export async function getExpenseCategoriesService(userId: string): Promise<ExpenseCategory[]> {
  if (!db || !userId) {
    console.warn("[Backend] getExpenseCategoriesService called without db or userId, returning empty array.");
    return [];
  }
  const categoriesQuery = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId), orderBy("name"));
  try {
    const snapshot = await getDocs(categoriesQuery);
    return snapshot.docs.map(docSnap => ({
        id: docSnap.id, 
        userId,
        ...docSnap.data(), 
        createdAt: docSnap.data().createdAt instanceof Timestamp ? docSnap.data().createdAt : serverTimestamp() 
    } as ExpenseCategory));
  } catch (error) {
     console.error("[Backend] Error fetching expense categories from Firestore:", error);
     if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for expenseCategories. Check browser console for link to create it.");
    }
    throw error;
  }
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
  console.log(`[Backend] New expense category ${newDocRef.id} created for user ${userId}.`);
  return newDocRef.id;
}

export async function clearExpenseCategoriesService(userId: string): Promise<void> {
  await deleteCollectionByUserId(EXPENSE_CATEGORIES_COLLECTION, userId);
}

// --- Temporary Data Management for Uploads (localStorage for scan JSON if Firestore pending doc fails or for quick resume) ---
// clearTemporaryScanData now only clears the AI scan JSON if it was stored in localStorage.
// Image URIs are handled by the calling function (upload/edit page) which should store/retrieve them from the Firestore pending doc.
export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined' || !userId) return;
    if (!uniqueScanId) {
      console.warn("[Backend - clearTemporaryScanData] Called without uniqueScanId for user:", userId);
      return;
    }
    try {
      const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      localStorage.removeItem(dataKey);
      console.log(`[Backend - clearTemporaryScanData] Cleared localStorage scan result for key: ${dataKey}`);
    } catch (error) {
        console.error(`[Backend] Error removing temp localStorage key for UserID: ${userId}, ScanID: ${uniqueScanId}`, error);
    }
}

// clearOldTemporaryScanData remains useful for clearing out old *scan JSON data* from localStorage
export function clearOldTemporaryScanData(emergencyClear: boolean = false, userIdToClear?: string) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // Only target keys related to scan JSON data
    if (key && key.startsWith(TEMP_DATA_KEY_PREFIX)) { 
        if (userIdToClear && !key.includes(`_${userIdToClear}_`)) {
            continue;
        }
        const parts = key.split('_');
        const timestampString = parts.find(part => /^\d{13,}$/.test(part)); // Find the timestamp part
        const timestamp = timestampString ? parseInt(timestampString, 10) : null;

        if (emergencyClear && (userIdToClear || !key.includes('_SHARED_OR_NO_USER_'))) {
             keysToRemove.push(key);
        } else if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) {
          keysToRemove.push(key);
        }
    }
  }
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`[Backend] Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`[Backend] Cleared ${itemsCleared} old/emergency temp scan JSON items from localStorage (User: ${userIdToClear || 'All Relevant'}).`);
}
