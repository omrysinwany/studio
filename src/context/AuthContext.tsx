
// src/context/AuthContext.tsx
'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { loginService, registerService, User, AuthResponse } from '@/services/backend';
import { auth as firebaseAuth, GoogleAuthProvider } from '@/lib/firebase'; // Import firebaseAuth and GoogleAuthProvider
import { signInWithPopup, signOut as firebaseSignOut, User as FirebaseUser, getIdToken, onAuthStateChanged } from 'firebase/auth';
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from '@/hooks/useTranslation';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (credentials: any) => Promise<void>;
  register: (userData: any) => Promise<void>;
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


  useEffect(() => {
    if (!firebaseAuth) {
      console.error("Firebase auth is not initialized. Cannot set up auth state listener.");
      setLoading(false);
      // Potentially set user to null or handle as unauthenticated
      setUser(null);
      setToken(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        try {
          const idToken = await getIdToken(firebaseUser);
          const appUser: User = {
            id: firebaseUser.uid,
            username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || t('user_fallback_name'),
            email: firebaseUser.email || '',
          };
          handleAuthResponse({ token: idToken, user: appUser }, false); // Don't show toast on initial load/refresh
        } catch (error) {
          console.error("Error getting ID token on auth state change:", error);
          performLogout(false);
        }
      } else {
        performLogout(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]); // t is a dependency for user_fallback_name

  const handleAuthResponse = (response: AuthResponse, showSuccessToast = true, redirectPath: string | null = '/') => {
    setUser(response.user);
    setToken(response.token);
    if (typeof window !== 'undefined') {
      localStorage.setItem('authToken', response.token);
      localStorage.setItem('authUser', JSON.stringify(response.user));
    }
    if (showSuccessToast) {
      toast({
        title: t('login_toast_success_title'),
        description: t('login_toast_success_desc'),
      });
    }
    if (redirectPath) {
        router.push(redirectPath);
    }
  };

  const performLogout = (showToast = true) => {
    setUser(null);
    setToken(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUser');
    }
    if (showToast) {
      toast({
        title: t('logout_toast_title'),
        description: t('logout_toast_desc'),
      });
    }
  };

  const login = async (credentials: any) => {
    setLoading(true);
    try {
      // This is a mock login. Replace with actual Firebase email/password login if needed.
      // For now, it assumes traditional login is handled elsewhere or not used if Google Sign-In is primary.
      const response = await loginService(credentials);
      handleAuthResponse(response);
    } catch (error) {
      console.error('Login failed:', error);
      toast({
        title: t('login_toast_fail_title'),
        description: (error as Error).message || t('login_toast_fail_desc'),
        variant: "destructive",
      });
      performLogout(false);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData: any) => {
    setLoading(true);
    try {
      // This is a mock register. Replace with actual Firebase email/password registration if needed.
      const response = await registerService(userData);
      handleAuthResponse(response);
    } catch (error) {
      console.error('Registration failed:', error);
      toast({
        title: t('register_toast_fail_title'),
        description: (error as Error).message || t('register_toast_fail_desc'),
        variant: "destructive",
      });
      performLogout(false);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!firebaseAuth) {
      toast({ title: t('error_title'), description: "Firebase auth not initialized. Cannot sign in with Google.", variant: "destructive" });
      setLoading(false);
      return;
    }
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(firebaseAuth, provider);
      const firebaseUser = result.user;
      const idToken = await getIdToken(firebaseUser);

      // Here, you might want to check if this user exists in your backend
      // or create a new user record if they don't.
      // For simplicity, we'll just use the Firebase user details.
      const appUser: User = {
        id: firebaseUser.uid,
        username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || t('user_fallback_name'),
        email: firebaseUser.email || '',
        // You might want to add other fields here if your User interface has them
      };
      handleAuthResponse({ token: idToken, user: appUser });
    } catch (error: any) {
      console.error('Google Sign-In failed:', error);
      let errorMessage = error.message || t('google_signin_toast_fail_desc');
      if (error.code === 'auth/popup-closed-by-user') {
        errorMessage = t('google_signin_popup_closed_desc');
      } else if (error.code === 'auth/cancelled-popup-request') {
        errorMessage = t('google_signin_popup_cancelled_desc');
      }
      toast({
        title: t('google_signin_toast_fail_title'),
        description: errorMessage,
        variant: "destructive",
      });
      performLogout(false); // Ensure inconsistent state is cleared
      // Do not throw error here to prevent unhandled rejection if user simply closes popup
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    if (!firebaseAuth) {
      performLogout();
      setLoading(false);
      router.push('/login');
      return;
    }
    setLoading(true);
    try {
      await firebaseSignOut(firebaseAuth);
      performLogout();
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
      performLogout(false); // Still clear local state
      toast({
        title: t('logout_toast_fail_title'),
        description: (error as Error).message || t('logout_toast_fail_desc'),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, signInWithGoogle, logout }}>
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
