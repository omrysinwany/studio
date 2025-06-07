"use server";

import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { UserSettings } from "@/services/types";
import {
  USERS_COLLECTION, // Corrected constant
  sanitizeForFirestore,
} from "@/services/backend-server";

async function deleteCollectionByUserId(
  collectionName: string,
  userId: string,
  db: FirebaseFirestore.Firestore
) {
  const collectionRef = db.collection(collectionName);
  const q = collectionRef.where("userId", "==", userId);
  const snapshot = await q.get();

  if (snapshot.empty) {
    console.log(
      `No documents to delete in ${collectionName} for user ${userId}.`
    );
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  console.log(
    `Deleted ${snapshot.size} documents from ${collectionName} for user ${userId}.`
  );
}

export async function clearAllUserDataAction(
  userId: string
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User ID is required." };
  }

  try {
    console.log(
      `[clearAllUserDataAction] Initiating delete all data for user: ${userId}`
    );

    await Promise.all([
      deleteCollectionByUserId(INVENTORY_COLLECTION, userId, adminDb),
      deleteCollectionByUserId(DOCUMENTS_COLLECTION, userId, adminDb),
      deleteCollectionByUserId(SUPPLIERS_COLLECTION, userId, adminDb),
      deleteCollectionByUserId(OTHER_EXPENSES_COLLECTION, userId, adminDb),
      deleteCollectionByUserId(EXPENSE_CATEGORIES_COLLECTION, userId, adminDb),
    ]);

    // Also delete the user settings document
    const userSettingsRef = adminDb.collection(USERS_COLLECTION).doc(userId);
    // It's possible the settings doc doesn't have a userId field, so we delete it directly.
    await userSettingsRef.delete();

    console.log(
      `[clearAllUserDataAction] All data cleared for user: ${userId}`
    );
    return {
      success: true,
      message: "All user data has been successfully deleted.",
    };
  } catch (error: any) {
    console.error(
      `[clearAllUserDataAction] Error deleting all data for user ${userId}:`,
      error
    );
    return {
      success: false,
      message: `An error occurred during data deletion: ${error.message}`,
    };
  }
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  if (!adminDb) throw new Error("Firestore Admin DB is not initialized.");
  if (!userId) {
    return Promise.resolve({
      monthlyBudget: 0,
      reminderDaysBefore: 1,
      posConfig: null,
      accountant: null,
      kpiPreferences: { visibleKpiIds: [], kpiOrder: [] },
      quickActionPreferences: {
        visibleQuickActionIds: [],
        quickActionOrder: [],
      },
    });
  }
  const userRef = adminDb.collection(USERS_COLLECTION).doc(userId);
  const docSnap = await userRef.get();

  if (docSnap.exists) {
    const data = docSnap.data();
    return (data?.settings as UserSettings) || {};
  } else {
    return Promise.resolve({
      monthlyBudget: 0,
      reminderDaysBefore: 1,
      posConfig: null,
      accountant: null,
      kpiPreferences: { visibleKpiIds: [], kpiOrder: [] },
      quickActionPreferences: {
        visibleQuickActionIds: [],
        quickActionOrder: [],
      },
    });
  }
}

export async function saveUserSettings(
  settings: Partial<UserSettings>,
  userId: string
): Promise<void> {
  if (!adminDb) throw new Error("Firestore Admin DB is not initialized.");
  if (!userId) throw new Error("User ID is required to save settings.");

  const userRef = adminDb.collection(USERS_COLLECTION).doc(userId);
  const sanitizedSettings = sanitizeForFirestore(settings);

  await userRef.set(
    {
      settings: {
        ...sanitizedSettings,
        lastUpdated: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
}
