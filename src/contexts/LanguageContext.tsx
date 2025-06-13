// src/context/LanguageContext.tsx
"use client";

import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  ReactNode,
  useCallback,
  useMemo,
} from "react";

export type Locale = "en" | "he";

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

const translationsCache: Record<Locale, Record<string, string>> = {
  en: {},
  he: {},
};

async function loadTranslations(
  locale: Locale
): Promise<Record<string, string>> {
  if (Object.keys(translationsCache[locale]).length > 0) {
    return translationsCache[locale];
  }
  try {
    const module = await import(`@/locales/${locale}.json`);
    translationsCache[locale] = module.default; // Cache the translations
    return module.default;
  } catch (error) {
    console.error(`Failed to load translations for locale: ${locale}`, error);
    return {}; // Fallback to empty object
  }
}

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>("he"); // Default to Hebrew
  const [loadedTranslations, setLoadedTranslations] = useState<
    Record<string, string>
  >({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedLocale = localStorage.getItem("locale") as Locale | null;
    if (storedLocale && ["en", "he"].includes(storedLocale)) {
      setLocaleState(storedLocale);
    } else {
      // Set a default locale if nothing is stored or stored locale is invalid
      const browserLang =
        typeof navigator !== "undefined"
          ? (navigator.language.split("-")[0] as Locale)
          : "he";
      const defaultLocale = ["en", "he"].includes(browserLang)
        ? browserLang
        : "he";
      setLocaleState(defaultLocale);
      localStorage.setItem("locale", defaultLocale);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    loadTranslations(locale).then((data) => {
      if (isMounted) {
        setLoadedTranslations(data);
        setIsLoading(false);
        if (typeof document !== "undefined") {
          document.documentElement.lang = locale;
          document.documentElement.dir = locale === "he" ? "rtl" : "ltr";
        }
      }
    });
    return () => {
      isMounted = false;
    };
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("locale", newLocale);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      if (isLoading) return key;
      let translation = loadedTranslations[key] || key;
      if (params) {
        Object.keys(params).forEach((paramKey) => {
          translation = translation.replace(
            new RegExp(`{{${paramKey}}}`, "g"),
            String(params[paramKey])
          );
        });
      }
      return translation;
    },
    [isLoading, loadedTranslations]
  );

  // Memoize the context value
  const contextValue = useMemo(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale, t]
  );

  if (isLoading) {
    // Basic loading state to prevent app crash before translations are ready
    // You might want a more sophisticated loading UI
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontFamily: "sans-serif",
        }}
      >
        Loading InvoTrack...
      </div>
    );
  }

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
};
