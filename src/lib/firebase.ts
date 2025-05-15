// src/lib/firebase.ts
import { initializeApp, getApps, FirebaseApp, FirebaseOptions } from 'firebase/app';
import { getFirestore, Firestore }
from 'firebase/firestore';
import { getAuth, Auth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID // Optional, include if you use it
};

let firebaseApp: FirebaseApp | undefined;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

if (typeof window !== 'undefined' && !getApps().length) {
  // Check if essential config values are present and valid strings
  if (
    firebaseConfig.apiKey && typeof firebaseConfig.apiKey === 'string' &&
    firebaseConfig.authDomain && typeof firebaseConfig.authDomain === 'string' &&
    firebaseConfig.projectId && typeof firebaseConfig.projectId === 'string' &&
    firebaseConfig.appId && typeof firebaseConfig.appId === 'string'
  ) {
    try {
      firebaseApp = initializeApp(firebaseConfig);
      dbInstance = getFirestore(firebaseApp);
      authInstance = getAuth(firebaseApp);
      console.log("Firebase initialized successfully via firebase.ts.");
    } catch (error) {
      console.error("Firebase initialization error in firebase.ts:", error);
      // firebaseApp, dbInstance, authInstance remain in their default error state (undefined/null)
    }
  } else {
    console.error(
      'Firebase configuration is missing or incomplete in environment variables. ' +
      'Please ensure all NEXT_PUBLIC_FIREBASE_ environment variables are set in your .env file ' +
      'and that the Next.js development server has been restarted.'
    );
  }
} else if (typeof window !== 'undefined' && getApps().length > 0) {
  firebaseApp = getApps()[0];
  dbInstance = getFirestore(firebaseApp);
  authInstance = getAuth(firebaseApp);
  console.log("Firebase app already initialized in firebase.ts.");
}

export const db = dbInstance;
export const auth = authInstance;
export { GoogleAuthProvider };
export default firebaseApp;
