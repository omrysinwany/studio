// src/hooks/useTranslation.ts
'use client';

import { useLanguage, Locale } from '@/context/LanguageContext';

export const useTranslation = () => {
  const { t, locale, isLoadingTranslations } = useLanguage();
  return { t, locale, isLoadingTranslations };
};
