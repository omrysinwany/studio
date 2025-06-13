// src/contexts/AuthContext.tsx
"use client";

import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  ReactNode,
  useCallback,
} from "react";
import { User, saveUserToFirestore } from "@/services/backend-server";
import { auth as firebaseAuth, GoogleAuthProvider } from "@/lib/firebase";
import * as fbAuth from "firebase/auth"; // Import the entire module
import {
  doc,
  serverTimestamp,
  Timestamp,
  FieldValue,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  loginWithEmail: (credentials: {
    email: string;
    password: string;
  }) => Promise<void>;
  registerWithEmail: (userData: {
    email: string;
    password: string;
    username?: string;
  }) => Promise<void>;
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

  const performLogout = useCallback(
    async (showToast = true) => {
      setUser(null);
      setToken(null);
      if (firebaseAuth) {
        try {
          await fbAuth.signOut(firebaseAuth); // Use aliased import
          console.log(
            "[AuthContext] Successfully signed out from Firebase Auth."
          );
        } catch (error) {
          console.error("[AuthContext] Error during Firebase sign out:", error);
        }
      }
      if (showToast) {
        toast({
          title: t("logout_toast_title"),
          description: t("logout_toast_desc"),
        });
      }
    },
    [t, toast]
  );

  const processFirebaseUser = useCallback(
    async (
      firebaseUser: fbAuth.User | null,
      isNewUserRegistration: boolean = false,
      showSuccessToastOnNewAuth = true,
      redirectPath: string | null = "/",
      formUsername?: string
    ) => {
      console.log(
        "[AuthContext] processFirebaseUser called with firebaseUser:",
        firebaseUser?.uid
      );
      if (firebaseUser) {
        try {
          const idToken = await fbAuth.getIdToken(firebaseUser);
          setToken(idToken);

          const usernameForUserObject =
            formUsername ||
            firebaseUser.displayName ||
            firebaseUser.email?.split("@")[0] ||
            t("user_fallback_name");

          const userToSave: User = {
            id: firebaseUser.uid,
            email: firebaseUser.email || undefined,
            username: usernameForUserObject,
            lastLoginAt: serverTimestamp() as FieldValue,
          };

          // This function will create or update the user document.
          await saveUserToFirestore(userToSave);

          // We already have all the info we need, no need to re-fetch.
          const appUser: User = {
            ...userToSave,
            lastLoginAt: Timestamp.now(), // Use a client-side timestamp for the immediate state update.
          };

          setUser(appUser);
          console.log("[AuthContext] App user state set:", appUser);

          if (showSuccessToastOnNewAuth) {
            if (isNewUserRegistration) {
              toast({
                title: t("register_toast_success_title"),
                description: t("register_toast_success_desc"),
              });
            } else {
              toast({
                title: t("login_toast_success_title"),
                description: t("login_toast_success_desc"),
              });
            }
          }

          if (redirectPath) {
            router.push(redirectPath);
          }
        } catch (error) {
          console.error("[AuthContext] Error processing Firebase user:", error);
          toast({
            title: t("error_title"),
            description: t("google_signin_toast_fail_desc"),
            variant: "destructive",
          });
          performLogout(false);
          throw error;
        }
      } else {
        setUser(null);
        setToken(null);
      }
    },
    [t, toast, router, performLogout]
  );

  useEffect(() => {
    if (!firebaseAuth) {
      console.error(
        "[AuthContext] Firebase auth is not initialized in useEffect."
      );
      setLoading(false);
      setUser(null);
      setToken(null);
      return;
    }
    console.log("[AuthContext] Setting up onAuthStateChanged listener.");
    const unsubscribe = fbAuth.onAuthStateChanged(
      firebaseAuth,
      async (currentFirebaseUser) => {
        // Use aliased import
        console.log(
          "[AuthContext] onAuthStateChanged triggered. FirebaseUser UID:",
          currentFirebaseUser?.uid
        );
        setLoading(true);
        try {
          await processFirebaseUser(currentFirebaseUser, false, false, null);
        } catch (error) {
          console.warn(
            "[AuthContext] Error in onAuthStateChanged during processFirebaseUser, user state remains null:",
            error
          );
        } finally {
          setLoading(false);
          console.log(
            "[AuthContext] Finished processing onAuthStateChanged. Loading set to false."
          );
        }
      }
    );
    return () => {
      console.log("[AuthContext] Cleaning up onAuthStateChanged listener.");
      unsubscribe();
    };
  }, [processFirebaseUser]); // This dependency is now stable

  const loginWithEmail = async (credentials: {
    email: string;
    password: string;
  }) => {
    if (!firebaseAuth) {
      toast({
        title: t("error_title"),
        description: "Firebase auth not initialized.",
        variant: "destructive",
      });
      throw new Error("Firebase auth not initialized.");
    }
    setLoading(true);
    try {
      const userCredential = await fbAuth.signInWithEmailAndPassword(
        firebaseAuth,
        credentials.email,
        credentials.password
      ); // Use aliased import
      await processFirebaseUser(userCredential.user, false, true, "/");
    } catch (error: any) {
      console.error("Email/Password Login failed:", error);
      toast({
        title: t("login_toast_fail_title"),
        description: error.message || t("login_toast_fail_desc"),
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const registerWithEmail = async (userData: {
    email: string;
    password: string;
    username?: string;
  }) => {
    if (!firebaseAuth) {
      toast({
        title: t("error_title"),
        description: "Firebase auth not initialized.",
        variant: "destructive",
      });
      throw new Error("Firebase auth not initialized.");
    }
    setLoading(true);
    try {
      console.log(
        "[AuthContext] Attempting to create user with Firebase Auth:",
        userData.email
      );
      const userCredential = await fbAuth.createUserWithEmailAndPassword(
        firebaseAuth,
        userData.email,
        userData.password
      ); // Use aliased import
      console.log(
        "[AuthContext] Firebase Auth user created:",
        userCredential.user?.uid
      );
      await processFirebaseUser(
        userCredential.user,
        true,
        true,
        "/",
        userData.username
      );
    } catch (error: any) {
      console.error(
        "Email/Password Registration failed:",
        error.code,
        error.message
      );
      let toastMessage = error.message || t("register_toast_fail_desc");
      if (error.code === "auth/email-already-in-use") {
        toastMessage = t("register_toast_email_already_in_use");
      }
      toast({
        title: t("register_toast_fail_title"),
        description: toastMessage,
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!firebaseAuth) {
      toast({
        title: t("error_title"),
        description: "Firebase auth not initialized.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await fbAuth.signInWithPopup(firebaseAuth, provider); // Use aliased import
      await processFirebaseUser(result.user, false, true, "/");
    } catch (error: any) {
      console.error("Google Sign-In failed:", error);
      let errorMessage = error.message || t("google_signin_toast_fail_desc");
      if (error.code === "auth/popup-closed-by-user")
        errorMessage = t("google_signin_popup_closed_desc");
      else if (error.code === "auth/cancelled-popup-request")
        errorMessage = t("google_signin_popup_cancelled_desc");
      toast({
        title: t("google_signin_toast_fail_title"),
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    console.log("[AuthContext] logout function called.");
    setLoading(true);
    await performLogout();
    router.push("/login");
    setLoading(false);
    console.log(
      "[AuthContext] User logged out action completed. Redirecting to /login."
    );
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        loginWithEmail,
        registerWithEmail,
        signInWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export type { User };
