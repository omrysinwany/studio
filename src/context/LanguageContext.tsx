
'use client';

import type { ReactNode, Dispatch, SetStateAction } from 'react';
import React, { createContext, useState, useContext, useEffect } from 'react';
import en from '@/locales/en.json';
import he from '@/locales/he.json';

export type Locale = 'en' | 'he';

interface LanguageContextType {
  locale: Locale;
  setLocale: Dispatch<SetStateAction<Locale>>;
  translations: Record<string, string>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const translationsData: Record<Locale, Record<string, string>> = {
  en,
  he,
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocale] = useState<Locale>('en'); // Default to English

  useEffect(() => {
    const storedLocale = localStorage.getItem('locale') as Locale | null;
    if (storedLocale && (storedLocale === 'en' || storedLocale === 'he')) {
      setLocale(storedLocale);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('locale', locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
  }, [locale]);

  const t = (key: string, params?: Record<string, string | number>): string => {
    let translation = translationsData[locale][key] || translationsData['en'][key] || key; // Fallback to English then key
    if (params) {
      Object.keys(params).forEach((paramKey) => {
        translation = translation.replace(`{{${paramKey}}}`, String(params[paramKey]));
      });
    }
    return translation;
  };

  return (
    <LanguageContext.Provider value={{ locale, setLocale, translations: translationsData[locale], t }}>
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
