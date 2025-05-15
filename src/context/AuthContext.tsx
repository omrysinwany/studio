
// src/context/AuthContext.tsx
'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { User, saveUserToFirestore, getUserFromFirestore } from '@/services/backend'; // Use backend service
import { auth as firebaseAuth, GoogleAuthProvider } from '@/lib/firebase';
// Import Firebase Auth functions, and alias the auth module
import * as fbAuth from 'firebase/auth';
import { doc, serverTimestamp, setDoc, Timestamp, FieldValue } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from '@/hooks/useTranslation';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  token: string | null; // Firebase ID token
  loading: boolean;
  loginWithEmail: (credentials: { email: string, password: string }) => Promise<void>;
  registerWithEmail: (userData: {email: string, password: string, username?: string}) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { t } = useTranslation();
  const router = useRouter();

  const performLogout = async (showToast = true) => {
    setUser(null);
    setToken(null);
    if (firebaseAuth) {
        try {
            await fbAuth.signOut(firebaseAuth);
            console.log("[AuthContext] Successfully signed out from Firebase Auth.");
        } catch (error) {
            console.error("[AuthContext] Error during Firebase sign out:", error);
        }
    }
    if (showToast) {
      toast({ title: t('logout_toast_title'), description: t('logout_toast_desc') });
    }
  };

  const processFirebaseUser = async (
    firebaseUser: fbAuth.User | null,
    isNewUserRegistration: boolean = false,
    showSuccessToastOnNewAuth = true,
    redirectPath: string | null = '/',
    formUsername?: string
  ) => {
    console.log("[AuthContext] processFirebaseUser called with firebaseUser:", firebaseUser?.uid, "isNewUserRegistration:", isNewUserRegistration, "formUsername:", formUsername);
    if (firebaseUser) {
      try {
        const idToken = await fbAuth.getIdToken(firebaseUser);
        setToken(idToken);
        console.log("[AuthContext] ID token set.");

        let appUser = await getUserFromFirestore(firebaseUser.uid);
        const isNewFirestoreUser = !appUser;
        console.log(`[AuthContext] User from Firestore: ${appUser ? appUser.id : 'null'}. Is new Firestore user: ${isNewFirestoreUser}`);

        if (!appUser && db) {
          const usernameForNewUser = formUsername || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || t('user_fallback_name');
          const newUserDetails: User = {
            id: firebaseUser.uid,
            email: firebaseUser.email || undefined,
            username: usernameForNewUser,
            createdAt: serverTimestamp() as FieldValue,
            lastLoginAt: serverTimestamp() as FieldValue,
          };
          console.log("[AuthContext] Attempting to save new user to Firestore:", newUserDetails);
          await saveUserToFirestore(newUserDetails);
          console.log("[AuthContext] New user saved to Firestore. Re-fetching...");
          appUser = await getUserFromFirestore(firebaseUser.uid);
          if (!appUser) {
            console.error("[AuthContext] Critical: Failed to fetch user from Firestore even after creation attempt.");
            // await performLogout(false); // Don't logout here, let the calling function handle UI
            setLoading(false);
            throw new Error("Failed to retrieve user details after creation."); // Throw to signal failure
          }
          console.log("[AuthContext] Re-fetched new user:", appUser);
        } else if (appUser && db) {
          console.log("[AuthContext] User exists. Updating lastLoginAt for user:", appUser.id);
          const userRef = doc(db, "users", firebaseUser.uid);
          await setDoc(userRef, { lastLoginAt: serverTimestamp() as FieldValue }, { merge: true });
          appUser = { ...appUser, lastLoginAt: Timestamp.now() };
          console.log("[AuthContext] lastLoginAt updated.");
        } else if (!db) {
            console.error("[AuthContext] Firestore (db) is not initialized. Cannot save or update user details.");
            toast({ title: t('error_title'), description: "Database not available. User details cannot be saved.", variant: "destructive" });
        }

        setUser(appUser);
        console.log("[AuthContext] App user state set:", appUser);

        if (showSuccessToastOnNewAuth && (isNewUserRegistration || isNewFirestoreUser)) {
          toast({ title: t('register_toast_success_title'), description: t('register_toast_success_desc') });
        } else if (showSuccessToastOnNewAuth && !isNewUserRegistration && !isNewFirestoreUser) {
           toast({ title: t('login_toast_success_title'), description: t('login_toast_success_desc') });
        }

        if (redirectPath) {
          router.push(redirectPath);
          console.log(`[AuthContext] Redirecting to ${redirectPath}`);
        }
      } catch (error) {
        console.error("[AuthContext] Error processing Firebase user:", error);
        toast({ title: t('error_title'), description: t('google_signin_toast_fail_desc'), variant: "destructive" });
        // await performLogout(false); // Avoid logout if processing failed, could be transient
        setUser(null); // Reset user state on processing error
        setToken(null);
        throw error; // Re-throw to allow calling function to handle
      }
    } else {
      console.log("[AuthContext] No Firebase user. Local user/token state reset.");
      setUser(null);
      setToken(null);
    }
  };

  useEffect(() => {
    if (!firebaseAuth) {
      console.error("[AuthContext] Firebase auth is not initialized in useEffect.");
      setLoading(false);
      setUser(null);
      setToken(null);
      return;
    }
    console.log("[AuthContext] Setting up onAuthStateChanged listener.");
    const unsubscribe = fbAuth.onAuthStateChanged(firebaseAuth, async (currentFirebaseUser) => {
      console.log("[AuthContext] onAuthStateChanged triggered. FirebaseUser UID:", currentFirebaseUser?.uid);
      setLoading(true);
      try {
        await processFirebaseUser(currentFirebaseUser, false, false, null);
      } catch (error) {
        console.warn("[AuthContext] Error in onAuthStateChanged during processFirebaseUser, user state remains null:", error);
        // User state is already reset by processFirebaseUser on error
      } finally {
        setLoading(false);
        console.log("[AuthContext] Finished processing onAuthStateChanged. Loading set to false.");
      }
    });
    return () => {
      console.log("[AuthContext] Cleaning up onAuthStateChanged listener.");
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginWithEmail = async (credentials: { email: string, password: string }) => {
    if (!firebaseAuth) {
      toast({ title: t('error_title'), description: "Firebase auth not initialized.", variant: "destructive" });
      throw new Error("Firebase auth not initialized.");
    }
    setLoading(true);
    try {
      const userCredential = await fbAuth.signInWithEmailAndPassword(firebaseAuth, credentials.email, credentials.password);
      await processFirebaseUser(userCredential.user, false, true, '/');
    } catch (error: any) {
      console.error('Email/Password Login failed:', error);
      toast({ title: t('login_toast_fail_title'), description: error.message || t('login_toast_fail_desc'), variant: "destructive" });
      // Don't performLogout here, let the onAuthStateChanged handle it if needed or keep user state as is
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const registerWithEmail = async (userData: {email: string, password: string, username?: string}) => {
    if (!firebaseAuth) {
      toast({ title: t('error_title'), description: "Firebase auth not initialized.", variant: "destructive" });
      throw new Error("Firebase auth not initialized.");
    }
    setLoading(true);
    try {
      console.log("[AuthContext] Attempting to create user with Firebase Auth:", userData.email);
      const userCredential = await fbAuth.createUserWithEmailAndPassword(firebaseAuth, userData.email, userData.password);
      console.log("[AuthContext] Firebase Auth user created:", userCredential.user?.uid);
      
      await processFirebaseUser(userCredential.user, true, true, '/', userData.username);
    } catch (error: any) {
      console.error('Email/Password Registration failed:', error.code, error.message);
      toast({ title: t('register_toast_fail_title'), description: error.message || t('register_toast_fail_desc'), variant: "destructive" });
      // No need to performLogout here for registration errors.
      throw error; // Re-throw so the calling component (RegisterPage) can handle UI state.
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!firebaseAuth) {
      toast({ title: t('error_title'), description: "Firebase auth not initialized.", variant: "destructive" });
      return; // or throw
    }
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await fbAuth.signInWithPopup(firebaseAuth, provider);
      await processFirebaseUser(result.user, false, true, '/');
    } catch (error: any) {
      console.error('Google Sign-In failed:', error);
      let errorMessage = error.message || t('google_signin_toast_fail_desc');
      if (error.code === 'auth/popup-closed-by-user') errorMessage = t('google_signin_popup_closed_desc');
      else if (error.code === 'auth/cancelled-popup-request') errorMessage = t('google_signin_popup_cancelled_desc');
      toast({ title: t('google_signin_toast_fail_title'), description: errorMessage, variant: "destructive" });
      // Don't performLogout here if popup is closed by user or cancelled.
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    console.log("[AuthContext] logout function called.");
    setLoading(true);
    await performLogout(); // This already handles toast and Firebase sign out
    // onAuthStateChanged will handle resetting user and token state
    // It's generally better to let onAuthStateChanged handle the redirection after logout
    // to ensure a consistent state update, but if immediate redirect is preferred:
    router.push('/login');
    setLoading(false);
    console.log("[AuthContext] User logged out action completed. Redirecting to /login.");
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, loginWithEmail, registerWithEmail, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
