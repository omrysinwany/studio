// src/components/layout/ClientLayoutWrapper.tsx
"use client";

import React, { useEffect } from "react";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageTransitionLoader } from "@/components/PageTransitionLoader";
import SiteHeader from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { locale, t } = useLanguage();

  useEffect(() => {
    document.title = t("app_title");
  }, [t, locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "he" ? "rtl" : "ltr";
  }, [locale]);

  return (
    <div className="flex flex-col min-h-screen text-foreground bg-transparent">
      <SiteHeader />
      <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-6 bg-transparent">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export default function ClientLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LanguageProvider>
      <AuthProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <PageTransitionLoader />
            <LayoutContent>{children}</LayoutContent>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
