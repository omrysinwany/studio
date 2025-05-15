
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
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID // Included if you have it
};

let firebaseApp: FirebaseApp | undefined; // Initialize as undefined

if (!getApps().length) {
  // Check if essential config values are present and valid strings
  if (
    firebaseConfig.apiKey && typeof firebaseConfig.apiKey === 'string' &&
    firebaseConfig.authDomain && typeof firebaseConfig.authDomain === 'string' &&
    firebaseConfig.projectId && typeof firebaseConfig.projectId === 'string' &&
    firebaseConfig.appId && typeof firebaseConfig.appId === 'string'
  ) {
    try {
      firebaseApp = initializeApp(firebaseConfig);
      console.log("Firebase initialized successfully via firebase.ts.");
    } catch (error) {
      console.error("Firebase initialization error in firebase.ts:", error);
      // firebaseApp remains undefined
    }
  } else {
    console.error(
      'Firebase configuration is missing or incomplete in environment variables. ' +
      'Please ensure all NEXT_PUBLIC_FIREBASE_ environment variables are set in your .env file ' +
      'and that the Next.js development server has been restarted.'
    );
  }
} else {
  firebaseApp = getApps()[0];
  console.log("Firebase app already initialized in firebase.ts.");
}

// Conditionally export db and auth only if firebaseApp was successfully initialized
export const db = firebaseApp ? getFirestore(firebaseApp) : null;
export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export { GoogleAuthProvider };
export default firebaseApp;
