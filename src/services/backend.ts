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
// export const EXPENSE_TEMPLATES_COLLECTION = "expenseTemplates"; // Not fully implemented with Firestore yet
export const USER_SETTINGS_COLLECTION = "userSettings";

// localStorage keys FOR UI PREFERENCES ONLY (or very temporary data if Firestore fails for pending doc)
export const KPI_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_kpiPreferences_v2';
export const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_quickActionsPreferences_v1';
export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScanData_'; // For raw AI scan JSON if pending Firestore doc fails

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
  imageUrl?: string | null;
  lastUpdated?: Timestamp | FieldValue;
  _originalId?: string;
}

export interface InvoiceHistoryItem {
  id: string; // Firestore document ID
  userId: string;
  originalFileName: string;
  generatedFileName: string;
  uploadTime: string | Timestamp | FieldValue;
  status: 'pending' | 'processing' | 'completed' | 'error';
  documentType: 'deliveryNote' | 'invoice' | 'paymentReceipt';
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Timestamp | FieldValue | null;
  totalAmount?: number | null;
  paymentMethod?: string | null;
  paymentDueDate?: string | Timestamp | FieldValue | null;
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentReceiptImageUri?: string | null;
  originalImagePreviewUri?: string | null; // Data URI or Firebase Storage URL
  compressedImageForFinalRecordUri?: string | null; // Data URI or Firebase Storage URL
  errorMessage?: string | null;
  linkedDeliveryNoteId?: string | null;
  rawScanResultJson?: string | null; // Store the full JSON output from AI scan
  _displayContext?: 'image_only' | 'full_details';
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

export interface ExpenseTemplate { // Not fully migrated to Firestore yet
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
    console.warn(`[getStorageKey] Called for baseKey "${baseKey}" without a userId.`);
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
    console.log(`[Backend getProductsService] Fetched ${snapshot.docs.length} products for user ${userId}`);
    return snapshot.docs.map(docSnap => ({ 
        id: docSnap.id, 
        userId, 
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
  
  // Ensure only actual fields present in updatedData are included, and add lastUpdated
  const dataToUpdate: Record<string, any> = {};
  for (const key in updatedData) {
    if (Object.prototype.hasOwnProperty.call(updatedData, key)) {
      const productKey = key as keyof Omit<Product, 'id' | 'userId'>;
      if (updatedData[productKey] !== undefined) { // Only include defined values
        dataToUpdate[productKey] = updatedData[productKey];
      }
    }
  }
  dataToUpdate.lastUpdated = serverTimestamp();

  try {
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists() || productDoc.data().userId !== userId) {
      throw new Error("Permission denied or product not found for update.");
    }
    await updateDoc(productRef, sanitizeForFirestore(dataToUpdate));
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
  console.log(`[Backend deleteCollectionByUserId] Attempting to delete all documents in ${collectionName} for user ${userId}.`);
  const q = query(collection(db, collectionName), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    console.log(`[Backend deleteCollectionByUserId] No documents to delete in ${collectionName} for user ${userId}.`);
    return;
  }

  const batch = writeBatch(db);
  snapshot.docs.forEach(docSnap => {
    batch.delete(docSnap.ref);
  });
  await batch.commit();
  console.log(`[Backend deleteCollectionByUserId] All documents in ${collectionName} for user ${userId} have been deleted.`);
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
    console.log(`[Backend getInvoicesService] Firestore query for user ${userId} found ${snapshot.docs.length} documents.`);
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
  const convertToTimestampIfValidStringOrDate = (dateField: any): Timestamp | null | FieldValue => {
    if (!dateField) return null;
    if (dateField === 'SERVER_TIMESTAMP') return serverTimestamp();
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
  console.log("[Backend checkProductPricesBeforeSaveService] Checking prices for products:", productsToCheck);

  const productsToSaveDirectly: Product[] = [];
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

  for (const product of productsToCheck) {
    const currentProductUnitPrice = Number(product.unitPrice) || 0;
    // Ensure product has an id; if it's a temp one, it's fine for this stage
    const productWithId = { ...product, id: product.id || `temp-${Date.now()}`, unitPrice: currentProductUnitPrice };


    let existingProductData: Product | null = null;
    // Try to find by ID first if it's not a clearly temporary ID
    if (productWithId.id && !productWithId.id.startsWith('prod-temp-') && !productWithId.id.startsWith('temp-id-') && !productWithId.id.startsWith('scan-temp-')) {
        const docRef = doc(db, INVENTORY_COLLECTION, productWithId.id);
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().userId === userId) {
            existingProductData = { id: snap.id, userId, ...snap.data() } as Product;
            console.log(`[Backend checkProductPricesBeforeSaveService] Found existing product by ID ${productWithId.id}`);
        }
    }
    // If not found by ID, or if ID was temporary, try catalogNumber
    if (!existingProductData && productWithId.catalogNumber && productWithId.catalogNumber !== 'N/A') {
      const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productWithId.catalogNumber), limit(1));
      const catSnap = await getDocs(qCat);
      if (!catSnap.empty) {
        existingProductData = { id: catSnap.docs[0].id, userId, ...catSnap.docs[0].data() } as Product;
        console.log(`[Backend checkProductPricesBeforeSaveService] Found existing product by Catalog# ${productWithId.catalogNumber}`);
      }
    }
    // If still not found, try barcode
    if (!existingProductData && productWithId.barcode && productWithId.barcode.trim() !== '') {
      const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productWithId.barcode.trim()), limit(1));
      const barSnap = await getDocs(qBar);
      if (!barSnap.empty) {
        existingProductData = { id: barSnap.docs[0].id, userId, ...barSnap.docs[0].data() } as Product;
         console.log(`[Backend checkProductPricesBeforeSaveService] Found existing product by Barcode ${productWithId.barcode}`);
      }
    }

    if (existingProductData) {
        const existingUnitPrice = Number(existingProductData.unitPrice) || 0;
        if (Math.abs(existingUnitPrice - productWithId.unitPrice) > 0.001 && productWithId.unitPrice > 0) {
          console.log(`[Backend checkProductPricesBeforeSaveService] Discrepancy found for ${existingProductData.id}: Old: ${existingUnitPrice}, New: ${productWithId.unitPrice}`);
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
          productsToSaveDirectly.push({...productWithId, id: existingProductData.id, userId, _originalId: existingProductData.id });
        }
    } else {
        // Product is new to the inventory
        productsToSaveDirectly.push({...productWithId, userId });
    }
  }
  console.log(`[Backend checkProductPricesBeforeSaveService] Direct save count: ${productsToSaveDirectly.length}, Discrepancies: ${priceDiscrepancies.length}`);
  return { productsToSaveDirectly, priceDiscrepancies };
}

export async function finalizeSaveProductsService(
    productsFromDoc: Partial<Product>[], 
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
    originalImagePreviewDataUri?: string | null,
    compressedImageForFinalRecordDataUri?: string | null,
    rawScanResultJson?: string | null 
): Promise<{
  finalInvoiceRecord: InvoiceHistoryItem;
  savedProductsWithFinalIds: Product[];
}> {
  if (!db) throw new Error("Database not initialized for finalizeSaveProductsService.");
  if (!userId) throw new Error("User authentication is required for finalizeSaveProductsService.");
  console.log(`[Backend finalizeSaveProductsService] User: ${userId}, DocType: ${documentType}, TempID: ${tempInvoiceId}, Products Count: ${productsFromDoc.length}`);
  console.log(`[Backend finalizeSaveProductsService] Extracted Details - Inv#: ${extractedInvoiceNumber}, Supplier: ${finalSupplierName}, Total: ${extractedTotalAmount}`);
  console.log(`[Backend finalizeSaveProductsService] Dates - Due: ${paymentDueDate}, Invoice: ${invoiceDate}`);
  console.log(`[Backend finalizeSaveProductsService] Payment Method: ${paymentMethod}`);
  console.log(`[Backend finalizeSaveProductsService] Image URIs - Preview: ${originalImagePreviewDataUri ? 'Present' : 'Absent'}, Final: ${compressedImageForFinalRecordDataUri ? 'Present' : 'Absent'}`);
  console.log(`[Backend finalizeSaveProductsService] Raw Scan JSON: ${rawScanResultJson ? 'Present' : 'Absent'}`);


  const savedProductsWithFinalIds: Product[] = [];
  let calculatedInvoiceTotalAmountFromProducts = 0;
  const batchOp = writeBatch(db);
  const shouldUpdateInventory = documentType === 'deliveryNote';

  if (shouldUpdateInventory && productsFromDoc.length > 0) {
    console.log("[Backend finalizeSaveProductsService] Processing products for delivery note inventory update...");
    for (const productFromDoc of productsFromDoc) {
      // Ensure all numeric fields that might come from UI/scan are numbers or null
      const quantityFromDoc = Number(productFromDoc.quantity) || 0;
      let unitPriceFromDoc = Number(productFromDoc.unitPrice) || 0;
      const lineTotalFromDoc = Number(productFromDoc.lineTotal) || 0;
      const salePriceFromDoc = productFromDoc.salePrice !== undefined ? (Number(productFromDoc.salePrice) ?? null) : null;

      if (unitPriceFromDoc === 0 && quantityFromDoc !== 0 && lineTotalFromDoc !== 0) {
        unitPriceFromDoc = parseFloat((lineTotalFromDoc / quantityFromDoc).toFixed(2));
      }
      calculatedInvoiceTotalAmountFromProducts += lineTotalFromDoc;

      let existingProductRef;
      let existingProductData: Product | undefined = undefined;
      let productIdentifierForLog = `Cat: ${productFromDoc.catalogNumber}, Bar: ${productFromDoc.barcode}, Desc: ${productFromDoc.description?.substring(0,20)}`;
      
      // Use _originalId if available (means it was identified as existing by checkProductPricesBeforeSaveService)
      const idToLookup = productFromDoc._originalId || productFromDoc.id;

      if (idToLookup && !idToLookup.startsWith('prod-temp-') && !idToLookup.startsWith('temp-id-') && !idToLookup.startsWith('scan-temp-')) {
        const snap = await getDoc(doc(db, INVENTORY_COLLECTION, idToLookup));
        if (snap.exists() && snap.data().userId === userId) {
          existingProductRef = snap.ref;
          existingProductData = { id: snap.id, userId, ...snap.data() } as Product;
          productIdentifierForLog = `ID: ${idToLookup}`;
        }
      }
      // Fallback search if _originalId wasn't set or didn't find a match (e.g., new product identified by catalog/barcode)
      if (!existingProductData && productFromDoc.catalogNumber && productFromDoc.catalogNumber !== 'N/A') {
        const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productFromDoc.catalogNumber), limit(1));
        const catSnap = await getDocs(qCat);
        if (!catSnap.empty) {
          existingProductRef = catSnap.docs[0].ref;
          existingProductData = { id: catSnap.docs[0].id, userId, ...catSnap.docs[0].data() } as Product;
          productIdentifierForLog = `Catalog: ${productFromDoc.catalogNumber}`;
        }
      }
      if (!existingProductData && productFromDoc.barcode && productFromDoc.barcode.trim() !== '') {
        const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productFromDoc.barcode.trim()), limit(1));
        const barSnap = await getDocs(qBar);
        if (!barSnap.empty) {
          existingProductRef = barSnap.docs[0].ref;
          existingProductData = { id: barSnap.docs[0].id, userId, ...barSnap.docs[0].data() } as Product;
          productIdentifierForLog = `Barcode: ${productFromDoc.barcode}`;
        }
      }

      if (existingProductRef && existingProductData) {
        console.log(`[Backend finalizeSaveProductsService] Updating existing product: ${productIdentifierForLog}`);
        const currentInventoryQuantity = Number(existingProductData.quantity) || 0;
        const updatedQuantity = currentInventoryQuantity + quantityFromDoc;
        
        const updatePayload: Partial<Omit<Product, 'id' | 'userId'>> & { lastUpdated: FieldValue } = {
          quantity: updatedQuantity,
          unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : (existingProductData.unitPrice || 0),
          lastUpdated: serverTimestamp(),
        };
        // Only update other fields if they were explicitly provided from the UI (productFromDoc might have them from BarcodePrompt)
        if (productFromDoc.description !== undefined && productFromDoc.description !== existingProductData.description) updatePayload.description = productFromDoc.description;
        if (productFromDoc.shortName !== undefined && productFromDoc.shortName !== existingProductData.shortName) updatePayload.shortName = productFromDoc.shortName;
        if (productFromDoc.catalogNumber && productFromDoc.catalogNumber !== existingProductData.catalogNumber) updatePayload.catalogNumber = productFromDoc.catalogNumber; // Allow catalog update
        if (productFromDoc.barcode !== undefined && productFromDoc.barcode !== existingProductData.barcode) updatePayload.barcode = productFromDoc.barcode || null;
        if (salePriceFromDoc !== undefined && salePriceFromDoc !== existingProductData.salePrice) updatePayload.salePrice = salePriceFromDoc;
        if (productFromDoc.minStockLevel !== undefined && productFromDoc.minStockLevel !== existingProductData.minStockLevel) updatePayload.minStockLevel = Number(productFromDoc.minStockLevel) ?? null;
        if (productFromDoc.maxStockLevel !== undefined && productFromDoc.maxStockLevel !== existingProductData.maxStockLevel) updatePayload.maxStockLevel = Number(productFromDoc.maxStockLevel) ?? null;
        if (productFromDoc.imageUrl !== undefined && productFromDoc.imageUrl !== existingProductData.imageUrl) updatePayload.imageUrl = productFromDoc.imageUrl || null;
        
        updatePayload.lineTotal = parseFloat(((updatePayload.quantity || 0) * (updatePayload.unitPrice || 0)).toFixed(2));
        
        batchOp.update(existingProductRef, sanitizeForFirestore(updatePayload as Partial<Product>));
        savedProductsWithFinalIds.push({ ...existingProductData, ...updatePayload, id: existingProductData.id, userId } as Product);
      } else {
        console.log(`[Backend finalizeSaveProductsService] Creating new product: ${productIdentifierForLog}`);
        if (!productFromDoc.catalogNumber && !productFromDoc.description && !productFromDoc.barcode) {
          console.warn("[Backend finalizeSaveProductsService] Skipping new product due to missing identifiers:", productFromDoc);
          continue;
        }
        const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
        const newProductData: Product = {
          id: newProductRef.id, 
          userId: userId, // Ensure userId is set
          catalogNumber: productFromDoc.catalogNumber || 'N/A',
          description: productFromDoc.description || 'No Description',
          shortName: productFromDoc.shortName || (productFromDoc.description || 'No Description').split(' ').slice(0, 3).join(' '),
          barcode: (productFromDoc.barcode && productFromDoc.barcode.trim() !== '') ? (productFromDoc.barcode.trim() || null) : null,
          quantity: quantityFromDoc,
          unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : 0,
          salePrice: salePriceFromDoc,
          lineTotal: 0, 
          minStockLevel: productFromDoc.minStockLevel !== undefined ? (Number(productFromDoc.minStockLevel) ?? null) : null,
          maxStockLevel: productFromDoc.maxStockLevel !== undefined ? (Number(productFromDoc.maxStockLevel) ?? null) : null,
          imageUrl: productFromDoc.imageUrl || null,
          lastUpdated: serverTimestamp(),
        };
        newProductData.lineTotal = parseFloat(((newProductData.quantity || 0) * (newProductData.unitPrice || 0)).toFixed(2));

        console.log(`[Backend finalizeSaveProductsService] Data for new product ${newProductRef.id}:`, newProductData);
        batchOp.set(newProductRef, sanitizeForFirestore(newProductData));
        savedProductsWithFinalIds.push({ ...newProductData });
      }
    }
  } else if (documentType === 'invoice') {
    console.log("[Backend finalizeSaveProductsService] Processing tax invoice - no inventory update.");
    // For tax invoices, we only sum up line totals if provided, but don't update inventory
    // This calculation seems to be for display if extractedTotalAmount is missing.
    // The actual totalAmount saved to document is handled below.
    productsFromDoc.forEach(p => calculatedInvoiceTotalAmountFromProducts += (Number(p.lineTotal) || 0));
  }

  // Determine the final total amount for the document
  const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && extractedTotalAmount !== null && !isNaN(extractedTotalAmount))
                                  ? extractedTotalAmount
                                  : (documentType === 'deliveryNote' ? parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2)) : null); // For delivery note, use calculated if no explicit total. For tax invoice, it should come from scan.

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
  const currentUploadTime = serverTimestamp(); // Use a single server timestamp for consistency if creating new

  if (tempInvoiceId) {
    docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
    const existingDocSnap = await getDoc(docRef);
    if (existingDocSnap.exists() && existingDocSnap.data().userId === userId) {
        isUpdatingPendingDoc = true;
    } else {
        console.warn(`[Backend finalizeSaveProductsService] Pending document ${tempInvoiceId} not found or user mismatch for finalize. Creating new document.`);
        docRef = doc(collection(db, DOCUMENTS_COLLECTION)); 
    }
  } else { 
    docRef = doc(collection(db, DOCUMENTS_COLLECTION));
  }
  console.log(`[Backend finalizeSaveProductsService] Using document ref: ${docRef.path}, IsUpdatingPending: ${isUpdatingPendingDoc}`);

  const convertToTimestampIfValid = (dateVal: any): Timestamp | null | FieldValue => {
    if (!dateVal) return null;
    if (dateVal instanceof Date && isValid(dateVal)) return Timestamp.fromDate(dateVal);
    if (typeof dateVal === 'string' && isValid(parseISO(dateVal))) return Timestamp.fromDate(parseISO(dateVal));
    if (dateVal instanceof Timestamp) return dateVal;
    return null;
  };

  const documentDataForFirestore: Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { userId: string, uploadTime: Timestamp | FieldValue } = {
    userId: userId, // Ensure userId is set
    generatedFileName: finalGeneratedFileName,
    originalFileName: originalFileNameFromUpload,
    uploadTime: isUpdatingPendingDoc ? (await getDoc(docRef)).data()?.uploadTime || currentUploadTime : currentUploadTime,
    status: 'completed',
    documentType: documentType,
    invoiceNumber: extractedInvoiceNumber || null,
    supplierName: finalSupplierName || null,
    totalAmount: !isNaN(finalInvoiceTotalAmount as number) ? finalInvoiceTotalAmount : null,
    paymentStatus: 'pending_payment', // Default for new/finalized documents
    paymentDueDate: convertToTimestampIfValid(paymentDueDate),
    invoiceDate: convertToTimestampIfValid(invoiceDate),
    paymentMethod: paymentMethod || null,
    errorMessage: null, 
    rawScanResultJson: rawScanResultJson || null, 
    paymentReceiptImageUri: null, 
    originalImagePreviewUri: originalImagePreviewDataUri || null,
    compressedImageForFinalRecordUri: compressedImageForFinalRecordDataUri || null,
    linkedDeliveryNoteId: null,
  };
  
  console.log(`[Backend finalizeSaveProductsService] Data for document ${docRef.id}:`, documentDataForFirestore);
  batchOp.set(docRef, sanitizeForFirestore(documentDataForFirestore as any), { merge: isUpdatingPendingDoc }); 


  let finalUploadTimeForReturn: string;
  const docDataToReturn = { ...documentDataForFirestore, id: docRef.id };
  if (docDataToReturn.uploadTime === serverTimestamp()) { // If it was set to serverTimestamp
    finalUploadTimeForReturn = new Date().toISOString(); // Use current client time as approximation
  } else {
    finalUploadTimeForReturn = (docDataToReturn.uploadTime as Timestamp).toDate().toISOString();
  }
  
  const finalInvoiceRecord: InvoiceHistoryItem = { 
    ...(docDataToReturn as Omit<InvoiceHistoryItem, 'id' | 'uploadTime' | 'invoiceDate' | 'paymentDueDate'>), 
    id: docRef.id, 
    userId,
    uploadTime: finalUploadTimeForReturn,
    invoiceDate: docDataToReturn.invoiceDate instanceof Timestamp ? docDataToReturn.invoiceDate.toDate().toISOString() : (docDataToReturn.invoiceDate || null),
    paymentDueDate: docDataToReturn.paymentDueDate instanceof Timestamp ? docDataToReturn.paymentDueDate.toDate().toISOString() : (docDataToReturn.paymentDueDate || null),
  };

  try {
    await batchOp.commit();
    console.log("[Backend] Firestore batch commit successful for finalizeSaveProductsService.");
  } catch (error: any) {
    console.error("[Backend] Error committing batch to Firestore in finalizeSaveProductsService:", error);
    // Provide more detailed error if possible
    let specificErrorDetail = error.message;
    if (error.details) specificErrorDetail += ` | Details: ${error.details}`;
    if (error.code) specificErrorDetail += ` | Code: ${error.code}`;
    console.error(`[Backend finalizeSaveProductsService] Error: ${specificErrorDetail}`);
    throw new Error(`Failed to save document and products to Firestore: ${specificErrorDetail}`);
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
  // Fetch all documents for the user, then filter by status and calculate totals in code
  const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId));


  try {
    const [suppliersSnapshot, allDocumentsSnapshot] = await Promise.all([
      getDocs(suppliersQuery),
      getDocs(documentsQuery) 
    ]);

    const supplierMap = new Map<string, SupplierSummary>();

    suppliersSnapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      const createdAtTimestamp = data.createdAt instanceof Timestamp ? data.createdAt : serverTimestamp();
      let lastActivityDateValue: string | Timestamp | null = null;
      if (data.lastActivityDate instanceof Timestamp) {
        lastActivityDateValue = data.lastActivityDate.toDate().toISOString();
      } else if (typeof data.lastActivityDate === 'string' && isValid(parseISO(data.lastActivityDate))) {
        lastActivityDateValue = data.lastActivityDate;
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
          lastActivityDate: lastActivityDateValue,
          createdAt: createdAtTimestamp,
        });
      } else {
        console.warn(`[Backend] Supplier document ${docSnap.id} for user ${userId} is missing a valid name.`);
      }
    });

    allDocumentsSnapshot.docs.forEach(docSnap => {
      const docData = docSnap.data();
      // Ensure we are looking at completed documents for financial summaries
      if (docData.supplierName && typeof docData.supplierName === 'string' && docData.status === 'completed') {
        let supplierEntry = supplierMap.get(docData.supplierName);
        if (supplierEntry) {
            supplierEntry.invoiceCount += 1;
            supplierEntry.totalSpent += (Number(docData.totalAmount) || 0);

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
        }
      }
    });
    return Array.from(supplierMap.values()).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  } catch (error) {
    console.error("[Backend getSupplierSummariesService] Error fetching supplier summaries from Firestore:", error);
    if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for suppliers or documents. Please create the suggested index in your Firebase console.");
    }
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
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    
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
    
    delete (settingsToSave as any).userId; 
    
    console.log("[Backend - saveUserSettingsService] Saving settings for user:", userId, settingsToSave);
    await setDoc(userSettingsRef, sanitizeForFirestore(settingsToSave as any), { merge: true });
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
        };
    }
    console.log(`[Backend] No settings found for user ${userId}, returning defaults and creating initial settings doc.`);
    await setDoc(userSettingsRef, sanitizeForFirestore({ ...defaultSettings, userId } as any), { merge: true }); 
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

export async function saveOtherExpenseService(expenseData: Omit<OtherExpense, 'id' | 'userId' | 'date'> & {id?:string, date: string | Date | Timestamp }, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveOtherExpenseService.");
  
  const { id: expenseId, date: dateInput, ...dataToProcess } = expenseData;

  let dateForFirestore: Timestamp | FieldValue;
  // ✅ הבדיקות תקינות עכשיו כי OtherExpense.date יכול להיות גם Date
  if (dateInput instanceof Timestamp) {
    dateForFirestore = dateInput;
  } else if (dateInput instanceof Date && isValid(dateInput)) { // בדוק Date לפני string
    dateForFirestore = Timestamp.fromDate(dateInput);
  } else if (typeof dateInput === 'string' && isValid(parseISO(dateInput))) {
    dateForFirestore = Timestamp.fromDate(parseISO(dateInput));
  } else {
    console.warn(`[Backend] Invalid date provided for expense, defaulting to server timestamp:`, dateInput);
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
    await updateDoc(docRef, sanitizeForFirestore({ ...dataToSave, lastUpdatedAt: serverTimestamp() }));
    return expenseId;
  } else { 
    const newDocRef = doc(collection(db, OTHER_EXPENSES_COLLECTION));
    // delete dataToSave.id; // No need if id is not part of dataToSave initially
    await setDoc(newDocRef, sanitizeForFirestore({ ...dataToSave, createdAt: serverTimestamp() }));
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

// --- Temporary Data Management for Uploads (Only rawScanResultJson if pending doc fails) ---
export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined' || !userId) return;
    if (!uniqueScanId) {
      console.warn("[Backend - clearTemporaryScanData] Called without uniqueScanId for user:", userId);
      return;
    }
    try {
      const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      localStorage.removeItem(dataKey);
      console.log(`[Backend - clearTemporaryScanData] Cleared localStorage scan result (JSON) for key: ${dataKey}`);
    } catch (error) {
        console.error(`[Backend] Error removing temp localStorage key for UserID: ${userId}, ScanID: ${uniqueScanId}`, error);
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
    if (key && key.startsWith(TEMP_DATA_KEY_PREFIX)) { 
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
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`[Backend] Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`[Backend] Cleared ${itemsCleared} old/emergency temp scan JSON items from localStorage (User: ${userIdToClear || 'All Relevant'}).`);
}