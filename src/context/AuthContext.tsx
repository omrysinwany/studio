'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { login as apiLogin, register as apiRegister, User, AuthResponse } from '@/services/backend'; // Use backend service

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (credentials: any) => Promise<void>;
  register: (userData: any) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); // Start loading until check is complete

  useEffect(() => {
    // Check local storage for existing token/user on initial load
    const storedToken = localStorage.getItem('authToken');
    const storedUser = localStorage.getItem('authUser');
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch (error) {
        console.error("Failed to parse stored user data:", error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
      }
    }
    setLoading(false); // Finished initial check
  }, []);

  const handleAuthResponse = (response: AuthResponse) => {
    setUser(response.user);
    setToken(response.token);
    localStorage.setItem('authToken', response.token);
    localStorage.setItem('authUser', JSON.stringify(response.user));
  };

  const login = async (credentials: any) => {
    setLoading(true);
    try {
      const response = await apiLogin(credentials);
      handleAuthResponse(response);
    } catch (error) {
      console.error('Login failed:', error);
      // Optionally, handle login errors (e.g., show a toast message)
      throw error; // Re-throw to allow component-level handling
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData: any) => {
    setLoading(true);
    try {
      const response = await apiRegister(userData);
      handleAuthResponse(response);
    } catch (error) {
      console.error('Registration failed:', error);
      // Optionally, handle registration errors
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    // Optionally redirect to login page or home page
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
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