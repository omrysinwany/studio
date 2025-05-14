// src/app/layout.tsx

// Ensure this is a Server Component by NOT having 'use client' at the top
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from '@/context/AuthContext';
import Navigation from '@/components/layout/Navigation';
import { ThemeProvider } from "@/components/theme-provider";
import React from 'react';
import { LanguageProvider } from '@/context/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'InvoTrack', // Default/fallback title, can be updated by ClientLayoutWrapper
  description: 'Inventory management based on delivery notes and invoices',
};

// This is a new Client Component that will wrap all client-side logic and providers
function ClientLayoutWrapper({ children }: { children: React.ReactNode }) {
  'use client'; // Mark this component as a Client Component

  const { locale, t } = useTranslation(); // useTranslation can be used here

  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
  }, [locale]);

  React.useEffect(() => {
    // This will update the title client-side with the translated version
    document.title = t('app_title');
  }, [t, locale]);

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

// This is the RootLayout (Server Component)
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning> {/* Default lang, ClientLayoutWrapper will update */}
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}>
        <LanguageProvider> {/* LanguageProvider must wrap ClientLayoutWrapper */}
          <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
        </LanguageProvider>
      </body>
    </html>
  );
}
