"use server";

import { adminDb } from "@/lib/firebase-admin";
import {
  SUPPLIERS_COLLECTION,
  INVENTORY_COLLECTION,
} from "@/services/backend-server";
import { SupplierSummary, Product, InvoiceHistoryItem } from "@/services/types";
import { FieldValue } from "firebase-admin/firestore";

// Action to get all supplier summaries for a user
export async function getSupplierSummaries(
  userId: string
): Promise<SupplierSummary[]> {
  if (!userId) {
    throw new Error("User ID is required to fetch supplier summaries.");
  }
  const snapshot = await adminDb
    .collection(SUPPLIERS_COLLECTION)
    .where("userId", "==", userId)
    .orderBy("name", "asc")
    .get();

  if (snapshot.empty) {
    return [];
  }

  const summaries: SupplierSummary[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      userId: data.userId,
      name: data.name,
      taxId: data.taxId,
      invoiceCount: data.invoiceCount || 0,
      totalSpent: data.totalSpent || 0,
      lastActivityDate: data.lastActivityDate
        ? new Date(data.lastActivityDate.toMillis()).toISOString()
        : null,
      createdAt: data.createdAt
        ? new Date(data.createdAt.toMillis()).toISOString()
        : new Date().toISOString(),
      caspitAccountId: data.caspitAccountId,
    } as SupplierSummary;
  });

  return summaries;
}

// Action to create a new supplier
export async function createSupplier(
  name: string,
  details: Partial<Omit<SupplierSummary, "id" | "name" | "userId">>,
  userId: string
): Promise<string> {
  if (!userId) throw new Error("User ID is required to create a supplier.");
  if (!name) throw new Error("Supplier name is required.");

  const dataToSave = {
    ...details,
    userId,
    name,
    invoiceCount: 0,
    totalSpent: 0,
    createdAt: FieldValue.serverTimestamp(),
    lastActivityDate: FieldValue.serverTimestamp(),
  };

  const docRef = await adminDb.collection(SUPPLIERS_COLLECTION).add(dataToSave);
  return docRef.id;
}

// Action to get all products for a user
export async function getProducts(userId: string): Promise<Product[]> {
  if (!userId) {
    throw new Error("User ID is required to fetch products.");
  }
  const snapshot = await adminDb
    .collection(INVENTORY_COLLECTION)
    .where("userId", "==", userId)
    .where("isActive", "==", true)
    .get();

  if (snapshot.empty) {
    return [];
  }

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      id: doc.id,
      lastUpdated: data.lastUpdated
        ? new Date(data.lastUpdated.toMillis()).toISOString()
        : null,
    } as Product;
  });
}

// Action to update a supplier
export async function updateSupplier(
  supplierId: string,
  details: Partial<Omit<SupplierSummary, "id" | "userId">>,
  userId: string
): Promise<void> {
  if (!userId) throw new Error("User ID is required to update a supplier.");
  if (!supplierId) throw new Error("Supplier ID is required.");

  const docRef = adminDb.collection(SUPPLIERS_COLLECTION).doc(supplierId);
  const doc = await docRef.get();

  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error("Supplier not found or user not authorized.");
  }

  await docRef.update({
    ...details,
    lastActivityDate: FieldValue.serverTimestamp(),
  });
}
