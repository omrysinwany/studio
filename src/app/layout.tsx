
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from '@/context/AuthContext';
import Navigation from '@/components/layout/Navigation';
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from '@/context/LanguageContext'; // Import LanguageProvider
import { clearOldTemporaryScanData } from '@/services/backend'; // Import cleanup function
import React from 'react'; // useEffect is implicitly available

// No need to import useEffect if we call clearOldTemporaryScanData in a client component or action

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Metadata remains here as it's for server-side rendering
export const metadata: Metadata = {
  title: 'InvoTrack', // This can be localized later if needed by moving to generateMetadata
  description: 'Inventory management based on delivery notes and invoices',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // useEffect for cleanup should be in a client component,
  // but for simplicity in this structure, we are assuming it's called
  // appropriately elsewhere or this component might be marked 'use client'
  // if direct side effects like this are intended here.
  // For now, just rendering the structure.
  // clearOldTemporaryScanData(); // This would ideally be in a 'use client' component or triggered differently

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
