
'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { loginService, registerService, User, AuthResponse } from '@/services/backend'; // Use backend service with Service suffix
import { auth as firebaseAuth, GoogleAuthProvider } from '@/lib/firebase'; // Import firebaseAuth and GoogleAuthProvider
import { signInWithPopup, signOut as firebaseSignOut, User as FirebaseUser, getIdToken } from 'firebase/auth';
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from '@/hooks/useTranslation';


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


  useEffect(() => {
    const unsubscribe = firebaseAuth?.onAuthStateChanged(async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        try {
          const idToken = await getIdToken(firebaseUser);
          const appUser: User = {
            id: firebaseUser.uid,
            username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || t('user_fallback_name'),
            email: firebaseUser.email || '',
          };
          handleAuthResponse({ token: idToken, user: appUser }, false); // Don't show toast on initial load
        } catch (error) {
          console.error("Error getting ID token on auth state change:", error);
          performLogout(false); // Log out if token retrieval fails
        }
      } else {
        performLogout(false); // Don't show toast on initial load or if already logged out
      }
      setLoading(false);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [t]); // Added t to dependency array

  const handleAuthResponse = (response: AuthResponse, showSuccessToast = true) => {
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
      const response = await loginService(credentials); // Use actual backend service
      handleAuthResponse(response);
    } catch (error) {
      console.error('Login failed:', error);
      toast({
        title: t('login_toast_fail_title'),
        description: (error as Error).message || t('login_toast_fail_desc'),
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData: any) => {
    setLoading(true);
    try {
      const response = await registerService(userData); // Use actual backend service
      handleAuthResponse(response);
      toast({
        title: t('register_toast_success_title'),
        description: t('register_toast_success_desc'),
      });
    } catch (error) {
      console.error('Registration failed:', error);
      toast({
        title: t('register_toast_fail_title'),
        description: (error as Error).message || t('register_toast_fail_desc'),
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!firebaseAuth) {
      toast({ title: t('error_title'), description: "Firebase not initialized.", variant: "destructive" });
      setLoading(false);
      return;
    }
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(firebaseAuth, provider);
      const firebaseUser = result.user;
      const idToken = await getIdToken(firebaseUser);
      const appUser: User = {
        id: firebaseUser.uid,
        username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || t('user_fallback_name'),
        email: firebaseUser.email || '',
      };
      handleAuthResponse({ token: idToken, user: appUser });
    } catch (error: any) {
      console.error('Google Sign-In failed:', error);
      toast({
        title: t('google_signin_toast_fail_title'),
        description: error.message || t('google_signin_toast_fail_desc'),
        variant: "destructive",
      });
      performLogout(false);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    if (!firebaseAuth) {
      // If Firebase isn't initialized, just clear local state
      performLogout();
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      await firebaseSignOut(firebaseAuth);
      performLogout();
    } catch (error) {
      console.error('Logout failed:', error);
      performLogout(false);
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
