"use server";

import { adminDb } from "@/lib/firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { INVENTORY_COLLECTION } from "@/services/backend-server";
import { Product } from "@/services/types";

// Re-export the type for client-side usage
export type { Product };

const convertAdminTimestampToString = (
  field: Timestamp | Date | string | null | undefined
): string | undefined => {
  if (!field) return undefined;
  if (typeof field === "string") return field;
  if (field instanceof Date) {
    return field.toISOString();
  }
  if (
    typeof field === "object" &&
    typeof (field as any).toDate === "function"
  ) {
    return (field as Timestamp).toDate().toISOString();
  }
  return undefined;
};

/**
 * Fetches a single product by its ID, ensuring it belongs to the specified user.
 */
export async function getProductByIdService(
  productId: string,
  userId: string
): Promise<Product | null> {
  const docRef = adminDb.collection(INVENTORY_COLLECTION).doc(productId);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    console.warn(`Product with ID ${productId} not found.`);
    return null;
  }

  const productData = docSnap.data() as Product;

  if (productData.userId !== userId) {
    console.error(
      `User ${userId} attempted to access unauthorized product ${productId}.`
    );
    return null;
  }

  // Convert timestamp fields to ISO strings for the client
  return {
    ...productData,
    id: docSnap.id,
    lastUpdated: convertAdminTimestampToString(productData.lastUpdated as any),
  };
}

/**
 * Updates a product document in Firestore.
 */
export async function updateProductService(
  productId: string,
  updatedData: Partial<Omit<Product, "id">>,
  userId: string
): Promise<void> {
  const productRef = adminDb.collection(INVENTORY_COLLECTION).doc(productId);

  // Security check: Ensure the product belongs to the user trying to update it
  const currentDoc = await productRef.get();
  if (!currentDoc.exists || currentDoc.data()?.userId !== userId) {
    throw new Error("Unauthorized or product not found.");
  }

  await productRef.update({
    ...updatedData,
    lastUpdated: FieldValue.serverTimestamp(),
  });
}

/**
 * Soft-deletes a product by setting its `isActive` flag to false.
 */
export async function deleteProductService(
  productId: string,
  userId: string
): Promise<void> {
  const productRef = adminDb.collection(INVENTORY_COLLECTION).doc(productId);

  // Security check
  const currentDoc = await productRef.get();
  if (!currentDoc.exists || currentDoc.data()?.userId !== userId) {
    throw new Error("Unauthorized or product not found.");
  }

  await productRef.update({
    isActive: false,
    lastUpdated: FieldValue.serverTimestamp(),
  });
}

/**
 * Reactivates a soft-deleted product by setting its `isActive` flag to true.
 */
export async function reactivateProductService(
  productId: string,
  userId: string
): Promise<void> {
  const productRef = adminDb.collection(INVENTORY_COLLECTION).doc(productId);

  // Security check
  const currentDoc = await productRef.get();
  if (!currentDoc.exists || currentDoc.data()?.userId !== userId) {
    throw new Error("Unauthorized or product not found.");
  }

  await productRef.update({
    isActive: true,
    lastUpdated: FieldValue.serverTimestamp(),
  });
}
