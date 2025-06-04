"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

// Define the shape of your user object (can be expanded)
interface User {
  id: string;
  username?: string;
  email?: string;
  // Add other user-specific fields here
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (userData: User) => void; // Example login function
  logout: () => void; // Example logout function
  // Add other auth-related functions or state if needed
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // Initially true to simulate loading auth state

  // Simulate fetching auth state on mount (e.g., from localStorage or an API)
  useEffect(() => {
    // Replace with actual auth state checking logic
    const storedUser = localStorage.getItem("authUser");
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        console.error("Failed to parse stored user:", e);
        localStorage.removeItem("authUser");
      }
    }
    setLoading(false);
  }, []);

  const login = (userData: User) => {
    setUser(userData);
    localStorage.setItem("authUser", JSON.stringify(userData));
    // Potentially redirect or perform other actions
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("authUser");
    // Potentially redirect or perform other actions
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
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
