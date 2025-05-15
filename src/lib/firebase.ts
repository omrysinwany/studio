// src/lib/firebase.ts
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

let firebaseApp: FirebaseApp | null = null; // Initialize as null

if (!getApps().length) {
  // Check if essential config values are present
  if (
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
  ) {
    try {
      firebaseApp = initializeApp(firebaseConfig);
    } catch (error) {
      console.error("Firebase initialization error:", error);
      // firebaseApp remains null
    }
  } else {
    console.error(
      'Firebase configuration is missing or incomplete. ' +
      'Please ensure all NEXT_PUBLIC_FIREBASE_ environment variables are set in your .env file ' +
      'and that the Next.js development server has been restarted.'
    );
  }
} else {
  firebaseApp = getApps()[0];
}

// Conditionally export db and auth if firebaseApp was initialized successfully
export const db = firebaseApp ? getFirestore(firebaseApp) : null;
export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export { GoogleAuthProvider };
export default firebaseApp;
