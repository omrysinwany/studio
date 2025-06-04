// src/app/layout.tsx

// Ensure this is a Server Component by NOT having 'use client' at the top
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/context/LanguageContext"; // Import LanguageProvider
import ClientLayoutWrapper from "@/components/layout/ClientLayoutWrapper"; // Import the new ClientLayoutWrapper
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/components/ui/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// This metadata is for the SERVER component RootLayout
export const metadata: Metadata = {
  title: "InvoTrack", // Static title
  description: "Inventory management based on delivery notes and invoices", // Static description
};

// This is the RootLayout (Server Component)
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}
      >
        <AuthProvider>
          <LanguageProvider>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
              <ClientLayoutWrapper>
                <main className="flex-grow">{children}</main>
              </ClientLayoutWrapper>
              <Toaster />
            </ThemeProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
