
// src/context/AuthContext.tsx
'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { User, saveUserToFirestore, getUserFromFirestore } from '@/services/backend'; // Use backend service
import { auth as firebaseAuth, GoogleAuthProvider } from '@/lib/firebase';
import { signInWithPopup, signOut as firebaseSignOut, User as FirebaseUser, getIdToken, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from '@/hooks/useTranslation';
import { useRouter } from 'next/navigation';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase'; // For serverTimestamp

interface AuthContextType {
  user: User | null;
  token: string | null; // Firebase ID token
  loading: boolean;
  loginWithEmail: (credentials: any) => Promise<void>; // Renamed from login
  registerWithEmail: (userData: any) => Promise<void>; // Renamed from register
  signInWithGoogle: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUserState] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { t } = useTranslation();
  const router = useRouter();

  const processFirebaseUser = async (firebaseUser: FirebaseUser | null, showSuccessToastOnNewAuth = true, redirectPath: string | null = '/') => {
    if (firebaseUser) {
      try {
        const idToken = await getIdToken(firebaseUser);
        setTokenState(idToken);

        let appUser = await getUserFromFirestore(firebaseUser.uid);
        const isNewFirestoreUser = !appUser;

        if (!appUser) {
          // If user doesn't exist in Firestore, create them
          const newUserDetails: User = {
            id: firebaseUser.uid,
            email: firebaseUser.email,
            username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || t('user_fallback_name'),
            createdAt: serverTimestamp(), // Firestore server timestamp
            lastLoginAt: serverTimestamp(),
          };
          await saveUserToFirestore(newUserDetails);
          appUser = await getUserFromFirestore(firebaseUser.uid); // Re-fetch to get Timestamps resolved
          if (!appUser) {
            // This case should ideally not happen if saveUserToFirestore worked
            console.error("Failed to fetch user from Firestore even after creation attempt.");
            performLogout(false); // Log out if we can't get the app user profile
            return;
          }
        } else {
          // User exists, update lastLoginAt
          if (db) { // Ensure db is initialized
            const userRef = doc(db, "users", firebaseUser.uid);
            await setDoc(userRef, { lastLoginAt: serverTimestamp() }, { merge: true });
          }
        }
        
        setUserState(appUser);

        if (showSuccessToastOnNewAuth && isNewFirestoreUser) {
          toast({ title: t('register_toast_success_title'), description: t('register_toast_success_desc') });
        } else if (showSuccessToastOnNewAuth && !isNewFirestoreUser) {
           toast({ title: t('login_toast_success_title'), description: t('login_toast_success_desc') });
        }

        if (redirectPath) {
          router.push(redirectPath);
        }
      } catch (error) {
        console.error("Error processing Firebase user:", error);
        toast({ title: t('error_title'), description: t('google_signin_toast_fail_desc'), variant: "destructive" });
        await performLogout(false); // Logout on error
      }
    } else {
      // No Firebase user
      performLogout(false);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!firebaseAuth) {
      console.error("Firebase auth is not initialized.");
      setLoading(false);
      performLogout(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      console.log("onAuthStateChanged triggered, firebaseUser:", firebaseUser?.uid);
      await processFirebaseUser(firebaseUser, false, null); // Don't show toast or redirect on initial load/refresh
      setLoading(false);
    });
    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const performLogout = async (showToast = true) => {
    setUserState(null);
    setTokenState(null);
    if (firebaseAuth) {
        try {
            await firebaseSignOut(firebaseAuth);
        } catch (error) {
            console.error("Error during Firebase sign out:", error);
        }
    }
    if (showToast) {
      toast({ title: t('logout_toast_title'), description: t('logout_toast_desc') });
    }
  };

  const loginWithEmail = async (credentials: any) => {
    if (!firebaseAuth) {
      toast({ title: t('error_title'), description: "Firebase auth not initialized.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(firebaseAuth, credentials.email, credentials.password);
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
      // Note: We don't manually update displayName here for email/password.
      // Firebase handles the email, and we'll use Firestore for username/profile.
      await processFirebaseUser(userCredential.user, true); // Show toast on new registration
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
    setLoading(true);
    await performLogout();
    router.push('/login'); // Redirect after logout
    setLoading(false);
  };

  return (
    <AuthContext.Provider value={{ user: userState, token: tokenState, loading, loginWithEmail, registerWithEmail, signInWithGoogle, logout }}>
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
