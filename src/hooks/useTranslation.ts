// src/hooks/useTranslation.ts
'use client';

export type Locale = 'en' | 'he';

// Fallback t function that returns the key itself or a default string
const t = (key: string, params?: Record<string, string | number>): string => {
  if (params) {
    let translation = key;
    Object.keys(params).forEach((paramKey) => {
      translation = translation.replace(`{{${paramKey}}}`, String(params[paramKey]));
    });
    return translation;
  }
  return key; // Return the key itself as translation is removed
};

export const useTranslation = () => {
  return { t, locale: 'en' as Locale }; // Default to 'en' locale
};
