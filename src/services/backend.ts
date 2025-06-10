import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  DocumentSnapshot,
  FieldValue,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Query,
  QuerySnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  increment,
  GeoPoint,
  arrayUnion,
  arrayRemove,
  DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  createOrUpdateCaspitProductAction,
  deactivateCaspitProductAction,
} from "@/actions/caspit-actions";
import type { PosConnectionConfig } from "./pos-integration/pos-adapter.interface";
import { useAuth } from "@/contexts/AuthContext";

// =================================================================
// COLLECTION AND SUBCOLLECTION NAMES
// =================================================================
export const USERS_COLLECTION = "users";
export const INVENTORY_SUBCOLLECTION = "inventoryProducts";
export const DOCUMENTS_SUBCOLLECTION = "documents";
export const SUPPLIERS_SUBCOLLECTION = "suppliers";
export const OTHER_EXPENSES_SUBCOLLECTION = "otherExpenses";
export const EXPENSE_CATEGORIES_SUBCOLLECTION = "expenseCategories";
export const USER_SETTINGS_SUBCOLLECTION = "settings";
// Constants for temporary scan data management
export const TEMP_DATA_KEY_PREFIX = "temp-scan-result-";
export const MAX_SCAN_RESULTS_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_INVOICE_HISTORY_ITEMS = 10;
const TEMP_DATA_EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// =================================================================
// TYPE DEFINITIONS
// =================================================================

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
  description: string;
  shortName?: string | null;
  barcode?: string | null;
  quantity: number;
  unitPrice: number;
  salePrice?: number | null;
  lineTotal: number;
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
  imageUrl?: string | null;
  lastUpdated?: Timestamp | FieldValue;
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
  paymentReceiptImageUri?: string;
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
  phone?: string | null;
  email?: string | null;
  paymentTerms?: string | null;
  lastActivityDate?: string | Timestamp | null;
  createdAt: Timestamp | FieldValue;
  caspitAccountId?: string | null;
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

export interface ProductPriceDiscrepancy extends Product {
  existingUnitPrice: number;
  newUnitPrice: number;
}

export interface PriceCheckResult {
  productsToSaveDirectly: Product[];
  priceDiscrepancies: ProductPriceDiscrepancy[];
}

// =================================================================
// SUBCOLLECTION HELPERS
// =================================================================

const getUserSubcollectionRef = <T>(userId: string, collectionName: string) => {
  if (!db) throw new Error("Firestore is not initialized.");
  if (!userId) throw new Error("User ID is required to access subcollections.");
  return collection(db, USERS_COLLECTION, userId, collectionName) as Query<T>;
};

const getUserSubcollectionDocRef = (
  userId: string,
  collectionName: string,
  docId: string
) => {
  if (!db) throw new Error("Firestore is not initialized.");
  if (!userId || !docId) {
    throw new Error(
      "User ID and Document ID are required to access a subcollection document."
    );
  }
  return doc(db, USERS_COLLECTION, userId, collectionName, docId);
};

// =================================================================
// SERVICE FUNCTIONS
// =================================================================

export const checkProductPricesBeforeSaveService = async (
  productsToCheck: Product[],
  userId: string
): Promise<PriceCheckResult> => {
  const inventoryRef = getUserSubcollectionRef<Product>(
    userId,
    INVENTORY_SUBCOLLECTION
  );
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];
  const productsToSaveDirectly: Product[] = [];
  const catalogNumbers = productsToCheck
    .map((p) => p.catalogNumber)
    .filter(Boolean);

  if (catalogNumbers.length === 0) {
    return { productsToSaveDirectly: productsToCheck, priceDiscrepancies: [] };
  }

  const existingProductsMap = new Map<string, Product>();

  // Firestore 'in' query can take up to 30 items.
  const chunks = [];
  for (let i = 0; i < catalogNumbers.length; i += 30) {
    chunks.push(catalogNumbers.slice(i, i + 30));
  }

  for (const chunk of chunks) {
    const q = query(inventoryRef, where("catalogNumber", "in", chunk));
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((doc) => {
      const product = { ...doc.data(), id: doc.id } as Product;
      if (product.catalogNumber) {
        existingProductsMap.set(product.catalogNumber, product);
      }
    });
  }

  for (const product of productsToCheck) {
    const existingProduct = existingProductsMap.get(product.catalogNumber);
    if (
      existingProduct &&
      existingProduct.unitPrice !== product.unitPrice &&
      product.unitPrice > 0
    ) {
      priceDiscrepancies.push({
        ...product,
        id: existingProduct.id,
        existingUnitPrice: existingProduct.unitPrice,
        newUnitPrice: product.unitPrice,
      });
    } else {
      productsToSaveDirectly.push(product);
    }
  }

  return { productsToSaveDirectly, priceDiscrepancies };
};

export const finalizeSaveProductsService = async (
  productsToSave: (Omit<Product, "id"> & { id?: string })[],
  originalFileName: string,
  docType: "deliveryNote" | "invoice" | "paymentReceipt",
  userId: string,
  tempOrExistingDocId: string | null,
  invoiceNumber: string | null | undefined,
  supplierName: string | null | undefined,
  totalAmount: number | null | undefined,
  paymentDueDate: any,
  invoiceDate: any,
  paymentMethod: string | null | undefined,
  originalImagePreviewUri: string | null | undefined,
  compressedImageForFinalRecordUri: string | null | undefined,
  rawScanResultJson: string | null | undefined,
  paymentTermStringForDocument: string | undefined
): Promise<{
  finalInvoiceRecord: InvoiceHistoryItem;
  savedOrUpdatedProducts: Product[];
}> => {
  if (!db) throw new Error("Firestore is not initialized.");
  if (!userId) throw new Error("User ID is required.");

  console.log(
    `[finalizeSaveProductsService] Starting save for docType: ${docType}, tempOrExistingDocId: ${tempOrExistingDocId}`
  );

  try {
    const { finalInvoiceRecord, savedOrUpdatedProducts } = await runTransaction(
      db,
      async (transaction) => {
        // =================================================================
        // 1. READ PHASE - Gather all required data from Firestore
        // =================================================================
        const productSnapshots = new Map<string, DocumentSnapshot>();

        for (const productToSave of productsToSave) {
          const isExistingProduct =
            productToSave.id && !productToSave.id.startsWith("scan-item-");
          if (isExistingProduct) {
            const productRef = doc(
              db!,
              `users/${userId}/${INVENTORY_SUBCOLLECTION}`,
              productToSave.id!
            );
            const snap = await transaction.get(productRef);
            if (snap.exists()) {
              productSnapshots.set(snap.ref.path, snap);
            }
          }
        }

        // =================================================================
        // 2. WRITE PHASE - Perform all writes
        // =================================================================
        const savedOrUpdatedProductsData: Product[] = [];

        for (const productToSave of productsToSave) {
          let productRef: DocumentReference;
          const isExistingProduct =
            productToSave.id && !productToSave.id.startsWith("scan-item-");

          if (isExistingProduct) {
            productRef = doc(
              db!,
              `users/${userId}/${INVENTORY_SUBCOLLECTION}`,
              productToSave.id!
            );
            const productSnap = productSnapshots.get(productRef.path);

            if (productSnap && productSnap.exists()) {
              // Product exists, update it
              const existingProductData = productSnap.data() as Product;
              const newQuantity =
                (existingProductData.quantity || 0) +
                (productToSave.quantity || 0);
              transaction.update(productRef, { quantity: newQuantity });

              savedOrUpdatedProductsData.push({
                ...existingProductData,
                ...productToSave,
                id: productRef.id,
                quantity: newQuantity,
              });
            } else {
              // Product has an ID but doesn't exist in DB, treat as new
              delete productToSave.id;
              productRef = doc(
                collection(db!, `users/${userId}/${INVENTORY_SUBCOLLECTION}`)
              );
              const newProductData: Product = {
                ...(productToSave as Omit<Product, "id">),
                userId,
                id: productRef.id,
                quantity: productToSave.quantity || 0, // Ensure quantity is a number
                isActive: true,
              };
              transaction.set(productRef, newProductData);
              savedOrUpdatedProductsData.push(newProductData);
            }
          } else {
            // New product, create it
            if (productToSave.id?.startsWith("scan-item-")) {
              delete productToSave.id;
            }
            productRef = doc(
              collection(db!, `users/${userId}/${INVENTORY_SUBCOLLECTION}`)
            );
            const newProductData: Product = {
              ...(productToSave as Omit<Product, "id">),
              userId,
              id: productRef.id,
              quantity: productToSave.quantity || 0, // Ensure quantity is a number
              isActive: true,
            };
            transaction.set(productRef, newProductData);
            savedOrUpdatedProductsData.push(newProductData);
          }
        }

        // 3. Finalize Invoice Document
        const finalInvoiceId = tempOrExistingDocId?.startsWith("pending-inv-")
          ? tempOrExistingDocId.replace("pending-inv-", "")
          : doc(collection(db!, "users", userId, DOCUMENTS_SUBCOLLECTION)).id;

        const finalInvoiceDocRef = doc(
          db!,
          `users/${userId}/${DOCUMENTS_SUBCOLLECTION}`,
          finalInvoiceId
        );

        const finalInvoiceData: Partial<Invoice> = {
          userId,
          originalFileName,
          status: "completed",
          documentType: docType,
          products: savedOrUpdatedProductsData,
          supplierName: supplierName || null,
          invoiceNumber: invoiceNumber || null,
          totalAmount: totalAmount || null,
          dueDate: paymentDueDate || null,
          invoiceDate: invoiceDate || null,
          paymentMethod: paymentMethod || null,
          paymentStatus: "unpaid",
          isArchived: false,
          lastUpdated: serverTimestamp(),
          originalImagePreviewUri: originalImagePreviewUri || null,
          compressedImageForFinalRecordUri:
            compressedImageForFinalRecordUri || null,
          rawScanResultJson: rawScanResultJson || null,
        };

        if (paymentTermStringForDocument) {
          finalInvoiceData.paymentTerms = paymentTermStringForDocument;
        }

        transaction.set(finalInvoiceDocRef, finalInvoiceData, { merge: true });

        // 4. Delete temporary document if it exists
        if (tempOrExistingDocId?.startsWith("pending-inv-")) {
          const tempDocRef = doc(
            db!,
            `users/${userId}/${DOCUMENTS_SUBCOLLECTION}`,
            tempOrExistingDocId
          );
          transaction.delete(tempDocRef);
        }

        const finalInvoiceRecordForReturn = {
          ...finalInvoiceData,
          id: finalInvoiceId,
          uploadTime: Timestamp.now(), // Use client-side timestamp for immediate UI update
        } as InvoiceHistoryItem;

        return {
          finalInvoiceRecord: finalInvoiceRecordForReturn,
          savedOrUpdatedProducts: savedOrUpdatedProductsData,
        };
      }
    );

    return { finalInvoiceRecord, savedOrUpdatedProducts };
  } catch (e) {
    console.error(`[finalizeSaveProductsService] Transaction failed:`, e);
    throw e;
  }
};

export const syncProductsWithCaspitService = async (
  products: Product[],
  userId: string
): Promise<void> => {
  if (!userId || !products || products.length === 0) {
    return;
  }

  const settings = await getUserSettingsService(userId);
  if (!settings.posConfig?.autoSync) {
    return; // Auto-sync is disabled
  }

  console.log(
    `[syncProductsWithCaspitService] Starting sync for ${products.length} products.`
  );

  for (const product of products) {
    try {
      const caspitResult = await createOrUpdateCaspitProductAction(
        settings.posConfig,
        product
      );
      if (caspitResult.caspitProductId && product.id) {
        // Update our product with the ID from Caspit for future reference
        const productRef = getUserSubcollectionDocRef(
          userId,
          INVENTORY_SUBCOLLECTION,
          product.id
        );
        await updateDoc(productRef, {
          caspitProductId: caspitResult.caspitProductId,
        });
      }
    } catch (error) {
      console.error(
        `[syncProductsWithCaspitService] Failed to sync product ${
          product.catalogNumber || product.id
        }:`,
        error
      );
      // We continue to the next product even if one fails
    }
  }
  console.log(`[syncProductsWithCaspitService] Sync finished.`);
};

// USER SETTINGS
// -----------------------------------------------------------------

export async function getUserSettingsService(
  userId: string
): Promise<UserSettings> {
  if (!db || !userId) {
    throw new Error(
      "DB not initialized or User ID missing for getUserSettingsService."
    );
  }

  const userSettingsRef = getUserSubcollectionDocRef(
    userId,
    USER_SETTINGS_SUBCOLLECTION,
    "userProfile"
  );
  const docSnap = await getDoc(userSettingsRef as any);

  const defaultSettings: UserSettings = {
    userId,
    posSystemId: null,
    posConfig: null,
    accountantSettings: { name: null, email: null, phone: null },
    monthlyBudget: null,
    reminderDaysBefore: 3,
    kpiPreferences: {
      visibleKpiIds: [
        "totalItems",
        "inventoryValue",
        "grossProfit",
        "currentMonthExpenses",
      ],
      kpiOrder: [
        "totalItems",
        "inventoryValue",
        "grossProfit",
        "currentMonthExpenses",
      ],
    },
    quickActionPreferences: {
      visibleQuickActionIds: [
        "scanDocument",
        "viewInventory",
        "viewDocuments",
        "addExpense",
      ],
      quickActionOrder: [
        "scanDocument",
        "viewInventory",
        "viewDocuments",
        "addExpense",
      ],
    },
  };

  if (!docSnap.exists()) {
    console.log(
      `No settings found for user ${userId}. Creating default settings.`
    );
    await setDoc(userSettingsRef, defaultSettings);
    return defaultSettings;
  }
  return { ...defaultSettings, ...(docSnap.data() as UserSettings) };
}

export async function saveUserSettingsService(
  settings: Partial<Omit<UserSettings, "userId">>,
  userId: string
): Promise<void> {
  if (!db || !userId) {
    throw new Error(
      "DB not initialized or User ID missing for saveUserSettingsService."
    );
  }
  const userSettingsRef = getUserSubcollectionDocRef(
    userId,
    USER_SETTINGS_SUBCOLLECTION,
    "userProfile"
  );
  await setDoc(userSettingsRef, settings, { merge: true });
}

// INVENTORY PRODUCTS
// -----------------------------------------------------------------

export async function getProductsService(
  userId: string,
  options: { includeInactive?: boolean } = {}
): Promise<Product[]> {
  const products: Product[] = [];
  if (!userId) {
    console.error("getProductsService called without userId");
    return products;
  }

  const inventoryRef = getUserSubcollectionRef<Product>(
    userId,
    INVENTORY_SUBCOLLECTION
  );
  let q = query(inventoryRef);
  if (!options.includeInactive) {
    q = query(q, where("isActive", "==", true));
  }

  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    products.push({ ...doc.data(), id: doc.id } as Product);
  });

  return products;
}

export async function getProductByIdService(
  productId: string,
  userId: string
): Promise<Product | null> {
  const docRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { ...docSnap.data(), id: docSnap.id } as Product;
  }
  return null;
}

export async function updateProductService(
  productId: string,
  productData: Partial<Product>,
  userId: string
): Promise<void> {
  if (!userId) {
    throw new Error("User ID is required to update a product.");
  }
  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );
  await updateDoc(productRef, {
    ...productData,
    lastUpdated: serverTimestamp(),
  });
}

export async function deleteProductService(
  productId: string,
  userId: string
): Promise<void> {
  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );
  const productSnap = await getDoc(productRef);
  const productData = productSnap.data() as Product | undefined;

  const settings = await getUserSettingsService(userId);
  const posConfig = settings?.posConfig;

  if (posConfig?.autoSync && productData?.caspitProductId) {
    try {
      await deactivateCaspitProductAction(posConfig, productData);
    } catch (error) {
      console.error("Failed to deactivate product in Caspit:", error);
      throw new Error(
        "Failed to deactivate product in POS. Please check POS connection settings or try again."
      );
    }
  }

  await updateDoc(productRef, { isActive: false });
}

export async function reactivateProductService(
  productId: string,
  userId: string
): Promise<void> {
  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );
  await updateDoc(productRef, { isActive: true });
}

export async function clearInventoryService(userId: string): Promise<void> {
  const inventoryRef = getUserSubcollectionRef(userId, INVENTORY_SUBCOLLECTION);
  const querySnapshot = await getDocs(inventoryRef);
  const batch = writeBatch(db as any);
  querySnapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
}

// TEMP SCAN DATA
// -----------------------------------------------------------------
export function getStorageKey(baseKey: string, userId: string): string {
  if (!userId) {
    // Fallback for cases where a key might be needed without a user context,
    // though this should be rare. Consider throwing an error for stricter enforcement.
    return `${baseKey}_global_unauthenticated`;
  }
  return `${baseKey}_${userId}`;
}

export function clearTemporaryScanData(tempId: string, userId: string) {
  if (!tempId || !userId) return;
  const storageKey = getStorageKey(`${TEMP_DATA_KEY_PREFIX}${tempId}`, userId);
  localStorage.removeItem(storageKey);
  console.log(`Cleared temporary data for key: ${storageKey}`);
}

export function clearOldTemporaryScanData(
  force = false,
  currentUserId?: string
) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  const now = new Date().getTime();
  const lastClearTimestamp = parseInt(
    localStorage.getItem("lastTempDataClear") || "0",
    10
  );

  if (!force && now - lastClearTimestamp < TEMP_DATA_EXPIRATION_MS) {
    return;
  }

  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith(TEMP_DATA_KEY_PREFIX)) {
      try {
        const itemStr = localStorage.getItem(key);
        if (itemStr) {
          const item = JSON.parse(itemStr);
          const itemTimestamp = item.timestamp || 0;
          if (now - itemTimestamp > TEMP_DATA_EXPIRATION_MS) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        localStorage.removeItem(key);
      }
    }
  });

  localStorage.setItem("lastTempDataClear", now.toString());
}

// INVOICES/DOCUMENTS
// -----------------------------------------------------------------

export async function getInvoicesService(
  userId: string
): Promise<InvoiceHistoryItem[]> {
  const invoices: InvoiceHistoryItem[] = [];
  if (!userId) {
    console.error("getInvoicesService called without userId");
    return invoices;
  }
  const documentsRef = getUserSubcollectionRef<InvoiceHistoryItem>(
    userId,
    DOCUMENTS_SUBCOLLECTION
  );
  const q = query(documentsRef, orderBy("invoiceDate", "desc"), limit(250));
  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    invoices.push({ ...doc.data(), id: doc.id } as InvoiceHistoryItem);
  });
  return invoices;
}

export async function updateInvoiceService(
  invoiceId: string,
  invoiceData: Partial<Invoice>,
  userId: string
): Promise<Invoice> {
  const docRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    invoiceId
  );
  await updateDoc(docRef, {
    ...invoiceData,
    lastUpdated: serverTimestamp(),
  });
  const updatedDoc = await getDoc(docRef);
  if (!updatedDoc.exists()) {
    throw new Error("Failed to retrieve updated invoice.");
  }
  return { id: updatedDoc.id, ...updatedDoc.data() } as Invoice;
}

export async function deleteInvoiceService(
  invoiceId: string,
  userId: string
): Promise<void> {
  const docRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    invoiceId
  );
  await deleteDoc(docRef);
}

export async function updateInvoicePaymentStatusService(
  invoiceId: string,
  paymentStatus: Invoice["paymentStatus"],
  userId: string,
  paymentReceiptImageUri?: string | null
): Promise<void> {
  if (userId) {
    const docRef = getUserSubcollectionDocRef(
      userId,
      DOCUMENTS_SUBCOLLECTION,
      invoiceId
    );
    const updatePayload: {
      paymentStatus: Invoice["paymentStatus"];
      paymentDate?: Timestamp;
      paymentReceiptImageUri?: string | null;
    } = { paymentStatus };

    if (paymentStatus === "paid") {
      updatePayload.paymentDate = Timestamp.now();
      if (paymentReceiptImageUri) {
        updatePayload.paymentReceiptImageUri = paymentReceiptImageUri;
      }
    }

    await updateDoc(docRef, updatePayload);
  } else {
    console.error(
      "User not authenticated or user ID is missing. Cannot update invoice payment status."
    );
    throw new Error(
      "User not authenticated or user ID is missing. Cannot update invoice payment status."
    );
  }
}

export const archiveDocumentService = async (
  docId: string,
  userId: string
): Promise<void> => {
  if (!userId) {
    throw new Error("User ID is required to archive a document.");
  }
  const docRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    docId
  );

  await updateDoc(docRef, {
    isArchived: true,
    archivedAt: new Date(),
  });
  console.log(`Document ${docId} archived successfully.`);
};

// SUPPLIERS
// -----------------------------------------------------------------

export async function getSuppliersService(userId: string): Promise<Supplier[]> {
  const suppliers: Supplier[] = [];
  if (!userId) return suppliers;
  const suppliersRef = getUserSubcollectionRef<Supplier>(
    userId,
    SUPPLIERS_SUBCOLLECTION
  );
  const q = query(suppliersRef, orderBy("name"));
  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    suppliers.push({ ...doc.data(), id: doc.id } as Supplier);
  });
  return suppliers;
}

export async function createSupplierService(
  name: string,
  contactInfo: {
    phone?: string;
    email?: string;
    paymentTerms?: string;
    caspitAccountId?: string;
  },
  userId: string
): Promise<Supplier> {
  if (!userId) throw new Error("User ID is required to create a supplier.");

  const suppliersRef = getUserSubcollectionRef<Supplier>(
    userId,
    SUPPLIERS_SUBCOLLECTION
  );
  const newSupplierRef = doc(suppliersRef as any);
  const newSupplier: Supplier = {
    id: newSupplierRef.id,
    userId,
    name,
    ...contactInfo,
    invoiceCount: 0,
    totalSpent: 0,
    createdAt: serverTimestamp(),
  };

  await setDoc(newSupplierRef, newSupplier);

  return newSupplier;
}

export async function updateSupplierService(
  supplierId: string,
  contactInfo: {
    phone?: string | null;
    email?: string | null;
    paymentTerms?: string | null;
  },
  userId: string
): Promise<void> {
  const supplierRef = getUserSubcollectionDocRef(
    userId,
    SUPPLIERS_SUBCOLLECTION,
    supplierId
  );
  await updateDoc(supplierRef, {
    ...contactInfo,
    lastUpdated: serverTimestamp(),
  });
}

export async function deleteSupplierService(
  supplierId: string,
  userId: string
): Promise<void> {
  const supplierRef = getUserSubcollectionDocRef(
    userId,
    SUPPLIERS_SUBCOLLECTION,
    supplierId
  );
  const q = query(
    getUserSubcollectionRef(userId, DOCUMENTS_SUBCOLLECTION),
    where("supplierId", "==", supplierId)
  );
  const docsSnapshot = await getDocs(q);
  if (!docsSnapshot.empty) {
    throw new Error(
      "Cannot delete supplier with associated documents. Please reassign or delete them first."
    );
  }
  await deleteDoc(supplierRef);
}

// OTHER EXPENSES & CATEGORIES
// -----------------------------------------------------------------
export async function getOtherExpensesService(
  userId: string
): Promise<OtherExpense[]> {
  const expenses: OtherExpense[] = [];
  if (!userId) return expenses;

  const expensesRef = getUserSubcollectionRef<OtherExpense>(
    userId,
    OTHER_EXPENSES_SUBCOLLECTION
  );
  const q = query(expensesRef, orderBy("date", "desc"));
  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    expenses.push({ ...doc.data(), id: doc.id } as OtherExpense);
  });
  return expenses;
}

export async function updateOtherExpenseService(
  expenseId: string,
  expenseData: Partial<OtherExpense>,
  userId: string
): Promise<void> {
  const expenseRef = getUserSubcollectionDocRef(
    userId,
    OTHER_EXPENSES_SUBCOLLECTION,
    expenseId
  );
  await updateDoc(expenseRef, {
    ...expenseData,
    lastUpdated: serverTimestamp(),
  });
}

export async function getExpenseCategoriesService(
  userId: string
): Promise<ExpenseCategory[]> {
  const categories: ExpenseCategory[] = [];
  if (!userId) return categories;
  const categoriesRef = getUserSubcollectionRef<ExpenseCategory>(
    userId,
    EXPENSE_CATEGORIES_SUBCOLLECTION
  );
  const q = query(categoriesRef, orderBy("name"));
  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    categories.push({ ...doc.data(), id: doc.id } as ExpenseCategory);
  });
  return categories;
}

/**
 * UTILITY FUNCTIONS
 */

export const saveUserToFirestore = async (
  user: Pick<
    import("firebase/auth").User,
    "uid" | "email" | "displayName" | "metadata"
  >
): Promise<User> => {
  const userRef = doc(db as any, USERS_COLLECTION, user.uid);
  const { creationTime, lastSignInTime } = user.metadata;

  const userData: Partial<User> & { lastLoginAt: any } = {
    username: user.displayName,
    email: user.email,
    lastLoginAt: lastSignInTime
      ? Timestamp.fromDate(new Date(lastSignInTime))
      : serverTimestamp(),
  };

  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    await updateDoc(userRef, userData);
  } else {
    userData.createdAt = creationTime
      ? Timestamp.fromDate(new Date(creationTime))
      : serverTimestamp();
    await setDoc(userRef, userData, { merge: true });
  }
  const finalUserSnap = await getDoc(userRef);
  return { ...finalUserSnap.data(), id: finalUserSnap.id } as User;
};
