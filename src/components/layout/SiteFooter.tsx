"use client";

import Link from "next/link";
import { useTranslation } from "@/hooks/useTranslation"; // Assuming you have this hook

export const SiteFooter = () => {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
      <div className="container mx-auto px-6 py-8 flex flex-col md:flex-row justify-between items-center">
        <p className="text-sm text-center md:text-left mb-4 md:mb-0">
          &copy; {currentYear} {t("app_name_slug") || "InvoTrack"}.{" "}
          {t("footer_rights_reserved") || "All rights reserved."}
        </p>
        <div className="flex space-x-4">
          <Link
            href="/terms"
            className="hover:text-slate-900 dark:hover:text-slate-200 text-sm"
          >
            {t("footer_terms_of_service") || "Terms of Service"}
          </Link>
          <Link
            href="/privacy"
            className="hover:text-slate-900 dark:hover:text-slate-200 text-sm"
          >
            {t("footer_privacy_policy") || "Privacy Policy"}
          </Link>
        </div>
      </div>
    </footer>
  );
};
