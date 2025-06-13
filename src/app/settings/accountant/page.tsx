"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@@/contexts/1/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  getAccountantSettingsService,
  saveAccountantSettingsService,
  type AccountantSettings,
} from "@/services/backend";
import { Loader2, Mail, Save, ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/1";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/hooks/useTranslation";

export default function AccountantSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [accountantName, setAccountantName] = useState("");
  const [accountantEmail, setAccountantEmail] = useState("");
  const [accountantPhone, setAccountantPhone] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    } else if (user) {
      loadSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router]);

  const loadSettings = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const settings = await getAccountantSettingsService(user.id);
      if (settings) {
        setAccountantName(settings.name || "");
        setAccountantEmail(settings.email || "");
        setAccountantPhone(settings.phone || "");
      }
    } catch (error) {
      console.error("Error loading accountant settings:", error);
      toast({
        title: t("error_title"),
        description: t("settings_accountant_toast_load_error_desc"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!user) return;
    if (!accountantEmail.trim()) {
      toast({
        title: t("error_title"),
        description: t("settings_accountant_toast_email_required_desc"),
        variant: "destructive",
      });
      return;
    }
    // Optional: Add more sophisticated email validation
    if (accountantEmail.trim() && !/\S+@\S+\.\S+/.test(accountantEmail)) {
      toast({
        title: t("error_title"),
        description: t("settings_accountant_toast_invalid_email_desc"),
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const settingsToSave: AccountantSettings = {
        name: accountantName.trim() || undefined,
        email: accountantEmail.trim(),
        phone: accountantPhone.trim() || undefined,
      };
      await saveAccountantSettingsService(settingsToSave, user.id);
      toast({
        title: t("settings_accountant_toast_save_success_title"),
        description: t("settings_accountant_toast_save_success_desc"),
      });
    } catch (error) {
      console.error("Error saving accountant settings:", error);
      toast({
        title: t("error_title"),
        description: t("settings_accountant_toast_save_error_desc"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || isLoading || !user) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t("loading_data")}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Button variant="outline" size="sm" asChild className="mb-4">
        <Link href="/settings">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("back_to_settings_button")}
        </Link>
      </Button>
      <Card className="shadow-md scale-fade-in">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Mail className="mr-2 h-5 sm:h-6 w-5 sm:w-6" />{" "}
            {t("settings_accountant_page_title")}
          </CardTitle>
          <CardDescription>
            {t("settings_accountant_page_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="accountantName">
              {t("settings_accountant_name_label")}
            </Label>
            <Input
              id="accountantName"
              value={accountantName}
              onChange={(e) => setAccountantName(e.target.value)}
              placeholder={t("settings_accountant_name_placeholder")}
              disabled={isSaving}
            />
          </div>
          <div>
            <Label htmlFor="accountantEmail">
              {t("settings_accountant_email_label")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="accountantEmail"
              type="email"
              value={accountantEmail}
              onChange={(e) => setAccountantEmail(e.target.value)}
              placeholder={t("settings_accountant_email_placeholder")}
              disabled={isSaving}
              required
            />
          </div>
          <div>
            <Label htmlFor="accountantPhone">
              {t("settings_accountant_phone_label")}
            </Label>
            <Input
              id="accountantPhone"
              type="tel"
              value={accountantPhone}
              onChange={(e) => setAccountantPhone(e.target.value)}
              placeholder={t("settings_accountant_phone_placeholder")}
              disabled={isSaving}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveSettings}
              disabled={isSaving || !accountantEmail.trim()}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                  {t("saving_button")}...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />{" "}
                  {t("settings_accountant_save_button")}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
