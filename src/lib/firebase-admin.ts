import * as admin from "firebase-admin";

const hasBeenInitialized = admin.apps.length > 0;

if (!hasBeenInitialized) {
  try {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY as string
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error: any) {
    console.error("Firebase Admin SDK initialization error", {
      message: error.message,
      "Did you set FIREBASE_SERVICE_ACCOUNT_KEY in your .env.local file?":
        !process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
    });
  }
}

export const adminDb = admin.firestore();
export const adminAuth = admin.auth();
export const adminSDK = admin;
