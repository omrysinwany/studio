// src/hooks/useTranslation.ts
'use client';

import { useLanguage, Locale } from '@/context/LanguageContext';

export const useTranslation = () => {
  const { t, locale } = useLanguage(); // Removed isLoadingTranslations as it's not directly used here often
  return { t, locale };
};
