// src/components/layout/ClientLayoutWrapper.tsx
"use client";

import React, { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/context/AuthContext";
import Navigation from "@/components/layout/Navigation";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageTransitionLoader } from "@/components/PageTransitionLoader";
import SiteHeader from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

export default function ClientLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, t } = useLanguage();

  // useEffect(() => {
  //   document.documentElement.lang = locale;
  //   document.documentElement.dir = locale === "he" ? "rtl" : "ltr";
  // }, [locale]);

  useEffect(() => {
    // This will update the title client-side with the translated version
    document.title = t("app_title");
  }, [t, locale]); // t and locale are dependencies

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AuthProvider>
        <TooltipProvider>
          <PageTransitionLoader />
          <div
            // dir={direction} // Removed
            className="flex flex-col min-h-screen text-foreground"
          >
            <SiteHeader />
            <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-6">
              {children}
            </main>
            <SiteFooter />
          </div>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
