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
  // In a real app, you would manage locale state (e.g., with Context or Zustand)
  // For now, we'll keep it simple and default to English
  // const [currentLocale, setCurrentLocale] = useState<Locale>('en');
  // useEffect(() => {
  //   const storedLocale = localStorage.getItem('locale') as Locale | null;
  //   if (storedLocale) {
  //     setCurrentLocale(storedLocale);
  //     document.documentElement.lang = storedLocale;
  //     document.documentElement.dir = storedLocale === 'he' ? 'rtl' : 'ltr';
  //   } else {
  //     document.documentElement.lang = 'en';
  //     document.documentElement.dir = 'ltr';
  //   }
  // }, []);

  // const setLocale = (newLocale: Locale) => {
  //   setCurrentLocale(newLocale);
  //   localStorage.setItem('locale', newLocale);
  //   document.documentElement.lang = newLocale;
  //   document.documentElement.dir = newLocale === 'he' ? 'rtl' : 'ltr';
  //   // Force a re-render if necessary, or rely on components to re-render
  //   // This might require a more global state management for locale if components don't update
  //   window.location.reload(); // Simplest way to force re-render with new translations
  // };

  return { t, locale: 'en' as Locale /* setLocale */ };
};
