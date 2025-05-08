
'use client'; // Mark as client component to use useEffect

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from '@/context/AuthContext';
import Navigation from '@/components/layout/Navigation';
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from '@/context/LanguageContext';
import React, { useEffect } from 'react'; // Import useEffect
import { 
  TEMP_DATA_KEY_PREFIX, 
  TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, 
  TEMP_COMPRESSED_IMAGE_KEY_PREFIX,
  clearOldTemporaryScanData // Import the cleanup function
} from '@/services/backend';


const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Metadata cannot be exported from a client component.
// If dynamic metadata is needed, use the generateMetadata function in a server component.
// For static metadata, it can remain here if this were a server component,
// but since we need 'use client' for useEffect, this would be an issue.
// Let's remove it for now or assume it's handled at a higher level server component.
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
    // Call the cleanup function when the app loads (RootLayout mounts)
    clearOldTemporaryScanData();
    
    // Optional: Set an interval to run cleanup periodically while the app is open
    // const intervalId = setInterval(clearOldTemporaryScanData, 60 * 60 * 1000); // Every hour
    // return () => clearInterval(intervalId); // Cleanup interval on unmount
  }, []);

  return (
    <LanguageProvider>
      <html lang="en" dir="ltr" suppressHydrationWarning>
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
    </LanguageProvider>
  );
}
