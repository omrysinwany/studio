// src/hooks/useTranslation.ts
"use client";

import { useLanguage, Locale } from "@/contexts/LanguageContext";

export const useTranslation = () => {
  const { t, locale } = useLanguage();
  return { t, locale };
};
