// src/app/layout.tsx

// Ensure this is a Server Component by NOT having 'use client' at the top
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '@/context/LanguageContext';
import ClientLayoutWrapper from '@/components/layout/ClientLayoutWrapper'; // Import the new ClientLayoutWrapper

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// This metadata is for the SERVER component RootLayout
export const metadata: Metadata = {
  title: 'InvoTrack', // Static title
  description: 'Inventory management based on delivery notes and invoices', // Static description
};

// This is the RootLayout (Server Component)
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning> {/* Default lang, ClientLayoutWrapper will update if needed */}
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}>
        <LanguageProvider> {/* LanguageProvider must wrap ClientLayoutWrapper */}
          <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
        </LanguageProvider>
      </body>
    </html>
  );
}
