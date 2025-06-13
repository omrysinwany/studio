// src/app/settings/notifications/page.tsx
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
  getUserSettingsService,
  saveUserSettingsService,
  type UserSettings,
} from "@/services/backend";
import { Loader2, Bell, Save, ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/1";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/hooks/useTranslation";

export default function NotificationSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [reminderDaysBefore, setReminderDaysBefore] = useState<
    number | undefined
  >(undefined);
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
      const settings = await getUserSettingsService(user.id);
      if (settings && settings.reminderDaysBefore !== undefined) {
        setReminderDaysBefore(settings.reminderDaysBefore);
      } else {
        setReminderDaysBefore(undefined); // Or a default value like 3
      }
    } catch (error) {
      console.error("Error loading user settings:", error);
      toast({
        title: t("error_title"),
        description: t("settings_notification_toast_load_error_desc"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!user) return;

    const days =
      reminderDaysBefore !== undefined &&
      reminderDaysBefore !== null &&
      !isNaN(Number(reminderDaysBefore))
        ? Number(reminderDaysBefore)
        : undefined;

    if (days !== undefined && (days < 0 || days > 30)) {
      toast({
        title: t("error_title"),
        description: t("settings_notification_toast_invalid_days_desc"),
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const settingsToSave: UserSettings = {
        reminderDaysBefore: days,
      };
      await saveUserSettingsService(settingsToSave, user.id);
      toast({
        title: t("settings_notification_toast_save_success_title"),
        description: t("settings_notification_toast_save_success_desc"),
      });
    } catch (error) {
      console.error("Error saving user settings:", error);
      toast({
        title: t("error_title"),
        description: t("settings_notification_toast_save_error_desc"),
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
            <Bell className="mr-2 h-5 sm:h-6 w-5 sm:w-6" />{" "}
            {t("settings_notification_page_title")}
          </CardTitle>
          <CardDescription>
            {t("settings_notification_page_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="reminderDays">
              {t("settings_notification_reminder_days_label")}
            </Label>
            <Input
              id="reminderDays"
              type="number"
              value={
                reminderDaysBefore === undefined
                  ? ""
                  : String(reminderDaysBefore)
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === "") {
                  setReminderDaysBefore(undefined);
                } else {
                  const numVal = parseInt(val, 10);
                  if (!isNaN(numVal)) {
                    setReminderDaysBefore(numVal);
                  }
                }
              }}
              placeholder={t("settings_notification_reminder_days_placeholder")}
              min="0"
              max="30" // Example max
              disabled={isSaving}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("settings_notification_reminder_days_note")}
            </p>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={handleSaveSettings} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                  {t("saving_button")}...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />{" "}
                  {t("settings_notification_save_button")}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
