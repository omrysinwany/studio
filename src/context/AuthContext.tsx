
// src/context/AuthContext.tsx
'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { User, saveUserToFirestore, getUserFromFirestore } from '@/services/backend'; // Use backend service
import { auth as firebaseAuth, GoogleAuthProvider } from '@/lib/firebase';
import { signInWithPopup, signOut as firebaseSignOut, User as FirebaseUser, getIdToken, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from '@/hooks/useTranslation';
import { useRouter } from 'next/navigation';
import { doc, serverTimestamp, setDoc, Timestamp, FieldValue } from 'firebase/firestore';
import { db } from '@/lib/firebase'; // For serverTimestamp

interface AuthContextType {
  user: User | null;
  token: string | null; // Firebase ID token
  loading: boolean;
  loginWithEmail: (credentials: any) => Promise<void>;
  registerWithEmail: (userData: any) => Promise<void>;
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
            await firebaseSignOut(firebaseAuth);
            console.log("Successfully signed out from Firebase Auth.");
        } catch (error) {
            console.error("Error during Firebase sign out:", error);
        }
    }
    if (showToast) {
      toast({ title: t('logout_toast_title'), description: t('logout_toast_desc') });
    }
  };


  const processFirebaseUser = async (firebaseUser: FirebaseUser | null, showSuccessToastOnNewAuth = true, redirectPath: string | null = '/') => {
    console.log("[AuthContext] processFirebaseUser called with firebaseUser:", firebaseUser?.uid);
    if (firebaseUser) {
      try {
        const idToken = await getIdToken(firebaseUser);
        setToken(idToken);
        console.log("[AuthContext] ID token set.");

        let appUser = await getUserFromFirestore(firebaseUser.uid);
        const isNewFirestoreUser = !appUser;
        console.log(`[AuthContext] User from Firestore: ${appUser ? appUser.id : 'null'}. Is new Firestore user: ${isNewFirestoreUser}`);

        if (!appUser && db) { 
          const newUserDetails: User = {
            id: firebaseUser.uid,
            email: firebaseUser.email || undefined, 
            username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || t('user_fallback_name'),
            createdAt: serverTimestamp() as FieldValue,
            lastLoginAt: serverTimestamp() as FieldValue,
          };
          console.log("[AuthContext] Attempting to save new user to Firestore:", newUserDetails);
          await saveUserToFirestore(newUserDetails);
          console.log("[AuthContext] New user saved to Firestore. Re-fetching...");
          appUser = await getUserFromFirestore(firebaseUser.uid);
          if (!appUser) {
            console.error("[AuthContext] Critical: Failed to fetch user from Firestore even after creation attempt.");
            await performLogout(false);
            setLoading(false);
            return;
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

        if (showSuccessToastOnNewAuth && isNewFirestoreUser) {
          toast({ title: t('register_toast_success_title'), description: t('register_toast_success_desc') });
        } else if (showSuccessToastOnNewAuth && !isNewFirestoreUser) {
           toast({ title: t('login_toast_success_title'), description: t('login_toast_success_desc') });
        }

        if (redirectPath) {
          router.push(redirectPath);
          console.log(`[AuthContext] Redirecting to ${redirectPath}`);
        }
      } catch (error) {
        console.error("[AuthContext] Error processing Firebase user:", error);
        toast({ title: t('error_title'), description: t('google_signin_toast_fail_desc'), variant: "destructive" });
        await performLogout(false);
      }
    } else {
      console.log("[AuthContext] No Firebase user. Performing local logout.");
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
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentFirebaseUser) => {
      console.log("[AuthContext] onAuthStateChanged triggered. FirebaseUser UID:", currentFirebaseUser?.uid);
      setLoading(true); 
      await processFirebaseUser(currentFirebaseUser, false, null);
      setLoading(false);
      console.log("[AuthContext] Finished processing onAuthStateChanged. Loading set to false.");
    });
    return () => {
      console.log("[AuthContext] Cleaning up onAuthStateChanged listener.");
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  const loginWithEmail = async (credentials: any) => {
    if (!firebaseAuth) {
      toast({ title: t('error_title'), description: "Firebase auth not initialized.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(firebaseAuth, credentials.username, credentials.password); // Assuming username is email
      await processFirebaseUser(userCredential.user);
    } catch (error: any) {
      console.error('Email/Password Login failed:', error);
      toast({ title: t('login_toast_fail_title'), description: error.message || t('login_toast_fail_desc'), variant: "destructive" });
      await performLogout(false);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const registerWithEmail = async (userData: any) => {
    if (!firebaseAuth) {
      toast({ title: t('error_title'), description: "Firebase auth not initialized.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, userData.email, userData.password);
      await processFirebaseUser(userCredential.user, true); 
    } catch (error: any) {
      console.error('Email/Password Registration failed:', error);
      toast({ title: t('register_toast_fail_title'), description: error.message || t('register_toast_fail_desc'), variant: "destructive" });
      await performLogout(false);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!firebaseAuth) {
      toast({ title: t('error_title'), description: "Firebase auth not initialized.", variant: "destructive" });
      return;
    }
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(firebaseAuth, provider);
      await processFirebaseUser(result.user);
    } catch (error: any) {
      console.error('Google Sign-In failed:', error);
      let errorMessage = error.message || t('google_signin_toast_fail_desc');
      if (error.code === 'auth/popup-closed-by-user') errorMessage = t('google_signin_popup_closed_desc');
      else if (error.code === 'auth/cancelled-popup-request') errorMessage = t('google_signin_popup_cancelled_desc');
      toast({ title: t('google_signin_toast_fail_title'), description: errorMessage, variant: "destructive" });
      await performLogout(false); 
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    console.log("[AuthContext] logout function called.");
    setLoading(true);
    await performLogout(); 
    router.push('/login'); 
    setLoading(false);
    console.log("[AuthContext] User logged out and redirected to /login.");
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
