// src/services/backend-server.ts

import { db } from "@/lib/firebase";
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
  documentId,
} from "firebase/firestore";
import { format, parseISO, isValid } from "date-fns";
import {
  createOrUpdateCaspitProductAction,
  createOrUpdateCaspitSupplierAction,
  createCaspitPurchaseDocumentAction,
  deactivateCaspitProductAction,
} from "@/actions/caspit-actions";
import firebaseApp from "@/lib/firebase";
import { adminDb } from "@/lib/firebase-admin";
import { getStorage } from "firebase-admin/storage";
import type { PosConnectionConfig } from "./pos-integration/pos-adapter.interface";
import {
  type User,
  type Product,
  type InvoiceHistoryItem,
  type SupplierSummary,
  type UserSettings,
  type OtherExpense,
  type ExpenseCategory,
  type ProductPriceDiscrepancy,
  type PriceCheckResult,
} from "./types";

// Re-export types for other server-side modules that import from here
export type {
  User,
  Product,
  InvoiceHistoryItem,
  SupplierSummary,
  UserSettings,
  OtherExpense,
  ExpenseCategory,
  ProductPriceDiscrepancy,
  PriceCheckResult,
};

// Firestore Collection Names
export const USERS_COLLECTION = "users";
export const INVENTORY_COLLECTION = "inventoryProducts";
export const DOCUMENTS_COLLECTION = "documents";
export const SUPPLIERS_COLLECTION = "suppliers";
export const OTHER_EXPENSES_COLLECTION = "otherExpenses";
export const EXPENSE_CATEGORIES_COLLECTION = "expenseCategories";

// --- Path Builders ---
export const userDoc = (userId: string) => {
  if (!db) throw new Error("Firestore not initialized for userDoc.");
  return doc(db, USERS_COLLECTION, userId);
};
export const productsCol = (userId: string) => {
  if (!db) throw new Error("Firestore not initialized for productsCol.");
  return collection(userDoc(userId), INVENTORY_COLLECTION);
};
export const productDoc = (userId: string, productId: string) => {
  if (!db) throw new Error("Firestore not initialized for productDoc.");
  return doc(productsCol(userId), productId);
};
export const documentsCol = (userId: string) => {
  if (!db) throw new Error("Firestore not initialized for documentsCol.");
  return collection(userDoc(userId), DOCUMENTS_COLLECTION);
};
export const documentDoc = (userId: string, docId: string) => {
  if (!db) throw new Error("Firestore not initialized for documentDoc.");
  return doc(documentsCol(userId), docId);
};
export const suppliersCol = (userId: string) => {
  if (!db) throw new Error("Firestore not initialized for suppliersCol.");
  return collection(userDoc(userId), SUPPLIERS_COLLECTION);
};
export const supplierDoc = (userId: string, supplierId: string) => {
  if (!db) throw new Error("Firestore not initialized for supplierDoc.");
  return doc(suppliersCol(userId), supplierId);
};
export const otherExpensesCol = (userId: string) => {
  if (!db) throw new Error("Firestore not initialized for otherExpensesCol.");
  return collection(userDoc(userId), OTHER_EXPENSES_COLLECTION);
};
export const otherExpenseDoc = (userId: string, expenseId: string) => {
  if (!db) throw new Error("Firestore not initialized for otherExpenseDoc.");
  return doc(otherExpensesCol(userId), expenseId);
};
export const expenseCategoriesCol = (userId: string) => {
  if (!db)
    throw new Error("Firestore not initialized for expenseCategoriesCol.");
  return collection(userDoc(userId), EXPENSE_CATEGORIES_COLLECTION);
};
export const expenseCategoryDoc = (userId: string, categoryId: string) => {
  if (!db) throw new Error("Firestore not initialized for expenseCategoryDoc.");
  return doc(expenseCategoriesCol(userId), categoryId);
};

// Util function to convert string/Date to Timestamp, or return null/FieldValue
export const convertToTimestampIfValid = (
  dateVal: any
): Timestamp | null | FieldValue => {
  if (!dateVal) return null;
  if (dateVal instanceof Date && isValid(dateVal))
    return Timestamp.fromDate(dateVal);
  if (typeof dateVal === "string") {
    let parsedDate = parseISO(dateVal);
    if (isValid(parsedDate)) return Timestamp.fromDate(parsedDate);
    const parts = dateVal.split("/");
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        parsedDate = new Date(year, month, day);
        if (
          isValid(parsedDate) &&
          parsedDate.getFullYear() === year &&
          parsedDate.getMonth() === month &&
          parsedDate.getDate() === day
        ) {
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
    `[convertToTimestampIfValid] Could not convert date value:`,
    dateVal
  );
  return null;
};

export const MAX_INVOICE_HISTORY_ITEMS = 10;
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.8 * 1024 * 1024;

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
  if (!db) throw new Error("Firestore not initialized.");
  if (!userData.id) throw new Error("User ID missing.");

  const userRef = userDoc(userData.id);

  try {
    const userSnapshot = await getDoc(userRef);
    const dataToSave: any = {
      email: userData.email || null,
      username: userData.username || null,
      lastLoginAt: serverTimestamp(),
    };

    if (!userSnapshot.exists()) {
      dataToSave.createdAt = serverTimestamp();
      dataToSave.settings = {
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
            "addExpense",
            "addProduct",
            "openInvoices",
          ],
          quickActionOrder: [
            "scanDocument",
            "addExpense",
            "addProduct",
            "openInvoices",
            "latestDocument",
            "addSupplier",
          ],
        },
      };
    }

    await setDoc(userRef, dataToSave, { merge: true });
    console.log(`User ${userData.id} saved/updated in Firestore.`);
  } catch (error) {
    console.error("Error saving user to Firestore:", error);
    throw new Error("Could not save user data.");
  }
}

export async function getUserFromFirestore(
  userId: string
): Promise<User | null> {
  if (!db || !userId) {
    console.error("Firestore not initialized or User ID missing.");
    return null;
  }
  try {
    const userSnapshot = await getDoc(userDoc(userId));
    if (userSnapshot.exists()) {
      return { id: userSnapshot.id, ...userSnapshot.data() } as User;
    } else {
      console.log(`No user found with ID: ${userId}`);
      return null;
    }
  } catch (error) {
    console.error("Error fetching user from Firestore:", error);
    return null;
  }
}

export async function getProductsService(
  userId: string,
  options: { includeInactive?: boolean } = {}
): Promise<Product[]> {
  if (!userId) throw new Error("User ID is required.");

  try {
    const q = options.includeInactive
      ? query(productsCol(userId))
      : query(productsCol(userId), where("status", "==", "active"));

    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (doc) => ({ ...doc.data(), id: doc.id } as Product)
    );
  } catch (error) {
    console.error("Error fetching products:", error);
    return [];
  }
}

export async function getProductByIdService(
  productId: string,
  userId: string
): Promise<Product | null> {
  if (!userId) throw new Error("User ID is required.");
  try {
    const docRef = productDoc(userId, productId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as Product;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching product ${productId}:`, error);
    return null;
  }
}

export async function getUserSettingsService(
  userId: string
): Promise<UserSettings> {
  const user = await getUserFromFirestore(userId);
  return (
    user?.settings ?? {
      kpiPreferences: { visibleKpiIds: [], kpiOrder: [] },
      quickActionPreferences: {
        visibleQuickActionIds: [],
        quickActionOrder: [],
      },
    }
  );
}

export async function getSupplierByNameService(
  userId: string,
  supplierName: string
): Promise<SupplierSummary | null> {
  if (!userId) throw new Error("User ID is required.");
  try {
    const q = query(
      suppliersCol(userId),
      where("name", "==", supplierName),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return null;
    }
    const doc = snapshot.docs[0];
    return { ...doc.data(), id: doc.id } as SupplierSummary;
  } catch (error) {
    console.error(`Error fetching supplier by name "${supplierName}":`, error);
    return null;
  }
}

export async function updateProductService(
  productId: string,
  updatedData: Partial<Omit<Product, "id" | "userId">>,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  try {
    const productRef = productDoc(userId, productId);
    const sanitizedData = sanitizeForFirestore({
      ...updatedData,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(productRef, sanitizedData);
  } catch (error) {
    console.error(`Error updating product ${productId}:`, error);
    throw new Error("Could not update product.");
  }
}

export async function deleteProductService(
  productId: string,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  const userSettings = await getUserSettingsService(userId);
  const posConfig = userSettings.posConnection;

  if (
    posConfig &&
    posConfig.type === "caspit" &&
    posConfig.config.autoDeactivateProducts
  ) {
    try {
      const product = await getProductByIdService(productId, userId);
      if (product?.caspitId) {
        console.log(
          `Deactivating product in Caspit, caspitId: ${product.caspitId}`
        );
        const result = await deactivateCaspitProductAction(
          posConfig,
          product.caspitId
        );
        if (!result.success) {
          console.error(
            `Failed to deactivate product in Caspit: ${result.message}`
          );
        }
      }
    } catch (e) {
      console.error("Error during Caspit product deactivation:", e);
    }
  }

  try {
    await deleteDoc(productDoc(userId, productId));
  } catch (error) {
    console.error(`Error deleting product ${productId}:`, error);
    throw new Error("Could not delete product.");
  }
}

async function deleteUserSubcollection(
  collectionName: string,
  userId: string
): Promise<void> {
  if (!db) return;
  const collectionRef = collection(db, "users", userId, collectionName);
  const snapshot = await getDocs(collectionRef);
  const batch = writeBatch(db);
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

export async function clearInventoryService(userId: string): Promise<void> {
  await deleteUserSubcollection(INVENTORY_COLLECTION, userId);
}

export async function getInvoicesService(
  userId: string
): Promise<InvoiceHistoryItem[]> {
  if (!userId) throw new Error("User ID is required.");
  try {
    const q = query(
      documentsCol(userId),
      orderBy("uploadedAt", "desc"),
      limit(50)
    );
    const snapshot = await getDocs(q);

    const convertTimestampToString = (field: any): string | null => {
      if (field instanceof Timestamp) {
        return field.toDate().toISOString();
      }
      return null;
    };

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        uploadedAt: convertTimestampToString(data.uploadedAt),
        invoiceDate: convertTimestampToString(data.invoiceDate),
        paymentDueDate: convertTimestampToString(data.paymentDueDate),
        paymentDate: convertTimestampToString(data.paymentDate),
      } as unknown as InvoiceHistoryItem;
    });
  } catch (error) {
    console.error("Error fetching invoices:", error);
    return [];
  }
}

export async function updateInvoiceService(
  invoiceId: string,
  updatedData: Partial<Omit<InvoiceHistoryItem, "id" | "userId">>,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  if (!db) throw new Error("Firestore not initialized");

  const convertToTimestampIfValidStringOrDate = (
    dateField: any
  ): Timestamp | null | FieldValue => {
    if (!dateField) return null;
    if (dateField instanceof Date) return Timestamp.fromDate(dateField);
    if (typeof dateField === "string") {
      const parsed = parseISO(dateField);
      if (isValid(parsed)) return Timestamp.fromDate(parsed);
    }
    if (dateField instanceof Timestamp) return dateField;
    if (
      typeof dateField === "object" &&
      dateField !== null &&
      "isEqual" in dateField
    ) {
      return dateField as FieldValue;
    }
    return null;
  };

  try {
    const docRef = documentDoc(userId, invoiceId);
    const dataToUpdate = { ...updatedData };

    if (dataToUpdate.invoiceDate) {
      dataToUpdate.invoiceDate =
        convertToTimestampIfValidStringOrDate(dataToUpdate.invoiceDate) ??
        undefined;
    }
    if (dataToUpdate.paymentDueDate) {
      dataToUpdate.paymentDueDate =
        convertToTimestampIfValidStringOrDate(dataToUpdate.paymentDueDate) ??
        undefined;
    }
    if (dataToUpdate.paymentDate) {
      dataToUpdate.paymentDate =
        convertToTimestampIfValidStringOrDate(dataToUpdate.paymentDate) ??
        undefined;
    }

    const sanitizedData = sanitizeForFirestore({
      ...dataToUpdate,
      updatedAt: serverTimestamp(),
    });

    await updateDoc(docRef, sanitizedData);
  } catch (error) {
    console.error(`Error updating invoice ${invoiceId}:`, error);
    throw new Error("Could not update invoice.");
  }
}

export async function updateInvoicePaymentStatusService(
  invoiceId: string,
  paymentStatus: InvoiceHistoryItem["paymentStatus"],
  userId: string,
  paymentReceiptImageUri: string | null = null
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  try {
    const docRef = documentDoc(userId, invoiceId);
    const updateData: any = {
      paymentStatus,
      updatedAt: serverTimestamp(),
    };
    if (paymentStatus === "paid") {
      updateData.paymentDate = serverTimestamp();
      if (paymentReceiptImageUri) {
        updateData.paymentReceiptImageUri = paymentReceiptImageUri;
      }
    }
    await updateDoc(docRef, updateData);
  } catch (error) {
    console.error(
      `Error updating payment status for invoice ${invoiceId}:`,
      error
    );
    throw new Error("Could not update invoice payment status.");
  }
}

export async function deleteInvoiceService(
  invoiceId: string,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  await deleteDoc(documentDoc(userId, invoiceId));
}

export async function clearDocumentsService(userId: string): Promise<void> {
  await deleteUserSubcollection(DOCUMENTS_COLLECTION, userId);
}

export async function checkProductPricesBeforeSaveService(
  productsToCheck: Product[],
  userId: string
): Promise<PriceCheckResult> {
  if (!userId) throw new Error("User ID is required.");
  const result: PriceCheckResult = {
    hasDiscrepancies: false,
    discrepancies: [],
  };
  if (productsToCheck.length === 0) {
    return result;
  }

  const productIds = productsToCheck
    .map((p) => p.id)
    .filter((id): id is string => !!id);

  if (productIds.length === 0) {
    return result;
  }

  const existingProductsQuery = query(
    productsCol(userId),
    where(documentId(), "in", productIds)
  );
  const snapshot = await getDocs(existingProductsQuery);
  const existingProductsMap = new Map<string, Product>();
  snapshot.docs.forEach((doc) => {
    existingProductsMap.set(doc.id, { id: doc.id, ...doc.data() } as Product);
  });

  for (const product of productsToCheck) {
    if (!product.id) continue;
    const existing = existingProductsMap.get(product.id);
    if (existing) {
      const priceChanged =
        product.price !== undefined &&
        product.price !== null &&
        existing.price !== product.price;
      const costChanged =
        product.cost !== undefined &&
        product.cost !== null &&
        existing.cost !== product.cost;

      if (priceChanged || costChanged) {
        result.hasDiscrepancies = true;
        result.discrepancies.push({
          productId: existing.id,
          name: existing.name,
          barcode: existing.barcode,
          oldPrice: existing.price,
          newPrice: product.price,
          oldCost: existing.cost,
          newCost: product.cost,
        });
      }
    }
  }

  return result;
}

export async function getSupplierSummariesService(
  userId: string
): Promise<SupplierSummary[]> {
  if (!userId) throw new Error("User ID is required.");
  try {
    const snapshot = await getDocs(suppliersCol(userId));
    return snapshot.docs.map(
      (doc) => ({ ...doc.data(), id: doc.id } as SupplierSummary)
    );
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    return [];
  }
}

export async function createSupplierService(
  name: string,
  details: {
    taxId?: string;
    phone?: string;
    email?: string;
    paymentTerms?: string;
  },
  userId: string
): Promise<SupplierSummary> {
  if (!userId) throw new Error("User ID is required.");

  const existingSupplier = await getSupplierByNameService(userId, name);
  if (existingSupplier) {
    return existingSupplier;
  }

  const newSupplierRef = doc(suppliersCol(userId));
  const newSupplierData = {
    ...details,
    name: name,
    userId: userId,
    createdAt: serverTimestamp(),
  };
  await setDoc(newSupplierRef, newSupplierData);
  return { ...newSupplierData, id: newSupplierRef.id } as SupplierSummary;
}

export async function deleteSupplierService(
  supplierId: string,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  await deleteDoc(supplierDoc(userId, supplierId));
}

export async function clearSuppliersService(userId: string): Promise<void> {
  await deleteUserSubcollection(SUPPLIERS_COLLECTION, userId);
}

export async function updateSupplierService(
  supplierId: string,
  details: Partial<Omit<SupplierSummary, "id" | "userId">>,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  const docRef = supplierDoc(userId, supplierId);
  const dataToUpdate = {
    ...details,
    updatedAt: serverTimestamp(),
  };
  await updateDoc(docRef, sanitizeForFirestore(dataToUpdate));
}

export async function getOtherExpensesService(
  userId: string
): Promise<OtherExpense[]> {
  if (!userId) throw new Error("User ID required");
  try {
    const q = query(otherExpensesCol(userId), orderBy("date", "desc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        date:
          data.date instanceof Timestamp
            ? data.date.toDate().toISOString()
            : data.date,
      } as OtherExpense;
    });
  } catch (error) {
    console.error("Error fetching other expenses:", error);
    return [];
  }
}

export async function saveOtherExpenseService(
  expenseData: Omit<OtherExpense, "id" | "userId" | "date"> & {
    id?: string;
    date: string | Date | Timestamp;
  },
  userId: string
): Promise<string> {
  if (!userId) throw new Error("User ID required");
  const { id, ...data } = expenseData;
  const docRef = id
    ? otherExpenseDoc(userId, id)
    : doc(otherExpensesCol(userId));
  const dataToSave = {
    ...data,
    userId,
    date: convertToTimestampIfValid(data.date),
    updatedAt: serverTimestamp(),
  };

  if (!id) {
    (dataToSave as any).createdAt = serverTimestamp();
  }

  await setDoc(docRef, sanitizeForFirestore(dataToSave), { merge: true });
  return docRef.id;
}

export async function deleteOtherExpenseService(
  expenseId: string,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  await deleteDoc(otherExpenseDoc(userId, expenseId));
}

export async function clearOtherExpensesService(userId: string): Promise<void> {
  await deleteUserSubcollection(OTHER_EXPENSES_COLLECTION, userId);
}

export async function getExpenseCategoriesService(
  userId: string
): Promise<ExpenseCategory[]> {
  if (!userId) throw new Error("User ID required");
  try {
    const q = query(expenseCategoriesCol(userId), orderBy("name", "asc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() } as ExpenseCategory)
    );
  } catch (error) {
    console.error("Error fetching expense categories:", error);
    return [];
  }
}

export async function saveExpenseCategoryService(
  categoryData: Omit<ExpenseCategory, "id" | "userId" | "createdAt">,
  userId: string
): Promise<string> {
  if (!userId) throw new Error("User ID required");

  const newCategoryRef = doc(expenseCategoriesCol(userId));
  const dataToSave = { ...categoryData, userId, createdAt: serverTimestamp() };
  await setDoc(newCategoryRef, dataToSave);
  return newCategoryRef.id;
}

export async function clearExpenseCategoriesService(
  userId: string
): Promise<void> {
  await deleteUserSubcollection(EXPENSE_CATEGORIES_COLLECTION, userId);
}

export async function reactivateProductService(
  productId: string,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  const productRef = productDoc(userId, productId);
  await updateDoc(productRef, {
    status: "active",
    updatedAt: serverTimestamp(),
  });
}

export async function archiveDocumentService(
  documentId: string,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID required");
  const docRef = documentDoc(userId, documentId);
  await updateDoc(docRef, {
    isArchived: true,
    updatedAt: serverTimestamp(),
  });
}

export async function saveUserSettings(
  settings: Partial<UserSettings>,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID is required for saving user settings.");
  const userRef = userDoc(userId);
  await setDoc(userRef, { settings }, { merge: true });
}

export async function deleteTemporaryInvoice(
  userId: string,
  tempInvoiceId: string
): Promise<void> {
  if (!userId || !tempInvoiceId) {
    console.warn("User ID or Temp Invoice ID not provided for deletion.");
    return;
  }
  try {
    const tempDocRef = documentDoc(userId, tempInvoiceId);
    await deleteDoc(tempDocRef);
    console.log(`Temporary invoice ${tempInvoiceId} deleted successfully.`);
  } catch (error) {
    console.error(`Error deleting temporary invoice ${tempInvoiceId}:`, error);
  }
}
