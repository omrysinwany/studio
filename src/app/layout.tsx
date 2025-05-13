
'use client'; 

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from '@/context/AuthContext';
import Navigation from '@/components/layout/Navigation';
import { ThemeProvider } from "@/components/theme-provider";
// Removed LanguageProvider import
import React, { useEffect } from 'react'; 
import { 
  clearOldTemporaryScanData
} from '@/services/backend';


const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Metadata is commented out as it cannot be in a 'use client' file directly.
// If static metadata is needed, it should be in a parent server component or a specific page.ts/layout.ts.
/*
export const metadata: Metadata = {
  title: 'InvoTrack',
  description: 'Inventory management based on delivery notes and invoices',
};
*/

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useEffect(() => {
    clearOldTemporaryScanData();
  }, []);

  return (
    // Removed LanguageProvider
    <html lang="en" dir="ltr" suppressHydrationWarning> {/* Default to English and LTR */}
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
