// src/components/layout/ClientLayoutWrapper.tsx
'use client';

import React, { useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from '@/context/AuthContext';
import Navigation from '@/components/layout/Navigation';
import { Toaster } from "@/components/ui/toaster";

export default function ClientLayoutWrapper({ children }: { children: React.ReactNode }) {
  const { locale, t } = useLanguage();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
  }, [locale]);

  useEffect(() => {
    // This will update the title client-side with the translated version
    document.title = t('app_title');
  }, [t, locale]); // t and locale are dependencies

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AuthProvider>
        <Navigation />
        <main className="flex-grow fade-in-content">
          {children}
        </main>
        <Toaster />
      </AuthProvider>
    </ThemeProvider>
  );
}
