
// src/context/LanguageContext.tsx
'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback } from 'react';

export type Locale = 'en' | 'he';

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Record<Locale, Record<string, string>> = {
  en: {},
  he: {},
};

async function loadTranslations(locale: Locale): Promise<Record<string, string>> {
  try {
    const module = await import(`@/locales/${locale}.json`);
    return module.default;
  } catch (error) {
    console.error(`Failed to load translations for locale: ${locale}`, error);
    return {}; // Fallback to empty object
  }
}

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>('en'); // Default to English
  const [loadedTranslations, setLoadedTranslations] = useState<Record<string, string>>({});
  const [isLoadingTranslations, setIsLoadingTranslations] = useState(true);

  useEffect(() => {
    const storedLocale = localStorage.getItem('locale') as Locale | null;
    if (storedLocale && ['en', 'he'].includes(storedLocale)) {
      setLocaleState(storedLocale);
    } else {
      // Set a default locale if nothing is stored or stored locale is invalid
      const browserLang = navigator.language.split('-')[0] as Locale;
      const defaultLocale = ['en', 'he'].includes(browserLang) ? browserLang : 'en';
      setLocaleState(defaultLocale);
      localStorage.setItem('locale', defaultLocale);
    }
  }, []);

  useEffect(() => {
    setIsLoadingTranslations(true);
    loadTranslations(locale).then(data => {
      translations[locale] = data; // Cache it
      setLoadedTranslations(data);
      setIsLoadingTranslations(false);
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
    });
  }, [locale]);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('locale', newLocale);
  };

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    if (isLoadingTranslations) return key; // Or a loading indicator string

    let translation = loadedTranslations[key] || translations.en[key] || key; // Fallback to English then key
    if (params) {
      Object.keys(params).forEach((paramKey) => {
        translation = translation.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(params[paramKey]));
      });
    }
    return translation;
  }, [loadedTranslations, isLoadingTranslations, locale]);


  if (isLoadingTranslations && !Object.keys(loadedTranslations).length) {
     // Basic loading state to prevent app crash before translations are ready
     // You might want a more sophisticated loading UI
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif' }}>Loading InvoTrack...</div>;
  }

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
