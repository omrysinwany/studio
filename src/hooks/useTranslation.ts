
'use client';

import { useLanguage } from '@/context/LanguageContext';

export const useTranslation = () => {
  const { t, locale } = useLanguage();
  return { t, locale };
};
