
'use client';

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from '@/context/AuthContext';
import Navigation from '@/components/layout/Navigation';
import { ThemeProvider } from "@/components/theme-provider";
import React, { useEffect } from 'react';
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

// Metadata is now handled within the component using useTranslation
// export const metadata: Metadata = {
// title: 'InvoTrack', // Will be translated
// description: 'Inventory management based on delivery notes and invoices', // Will be translated
// };

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { locale, t } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
  }, [locale]);

  // Dynamically set document title - this might be better in individual page components
  // or through a more sophisticated metadata management solution if needed for SEO.
  useEffect(() => {
    document.title = t('app_title');
  }, [t]);


  return (
    <html lang={locale} dir={locale === 'he' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        {/* <title>{t('app_title')}</title> */}
        <meta name="description" content={t('app_description')} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}>
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
      </body>
    </html>
  );
}


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <LanguageProvider>
      <LayoutContent>{children}</LayoutContent>
    </LanguageProvider>
  );
}
