// src/app/settings/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2, Settings as SettingsIcon, User, LogIn, Plug, Mail, Bell, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import {
    clearInventoryService,
    clearDocumentsService,
    clearSuppliersService,
    clearOtherExpensesService,
    clearExpenseCategoriesService,
    // USER_SETTINGS_COLLECTION, // No direct function to clear this, done via deleteDoc
    // TEMP_DATA_KEY_PREFIX, // Used for localStorage clearing
    // TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX,
    // TEMP_COMPRESSED_IMAGE_KEY_PREFIX,
    getStorageKey, // For localStorage
    deleteDoc, // For userSettings specific doc
    doc, // For userSettings specific doc
    db, // For userSettings specific doc
    USERS_COLLECTION,
    USER_SETTINGS_COLLECTION,
} from '@/services/backend';
import { cn } from '@/lib/utils';

// Base keys from other-expenses page (assuming they are exported or redefined if not)
// const EXPENSE_CATEGORIES_STORAGE_KEY_BASE = 'invoTrack_expenseCategories'; // Now in Firestore
// const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses'; // Now in Firestore
// const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget'; // Now in UserSettings in Firestore


export default function SettingsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { t } = useTranslation();
    const { toast } = useToast();
    const [isDeletingAllData, setIsDeletingAllData] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) {
          router.push('/login');
        }
    }, [user, authLoading, router]);

    const handleDeleteAllUserData = async () => {
      if (!user || !user.id) {
        toast({ title: t('error_title'), description: t('settings_delete_all_error_no_user'), variant: 'destructive' });
        return;
      }
      setIsDeletingAllData(true);
      try {
        console.log(`[SettingsPage] Initiating delete all data for user: ${user.id}`);
        // Delete Firestore data
        await clearInventoryService(user.id);
        console.log("[SettingsPage] Inventory cleared from Firestore.");
        await clearDocumentsService(user.id);
        console.log("[SettingsPage] Documents cleared from Firestore.");
        await clearSuppliersService(user.id);
        console.log("[SettingsPage] Suppliers cleared from Firestore.");
        await clearOtherExpensesService(user.id);
        console.log("[SettingsPage] Other Expenses cleared from Firestore.");
        await clearExpenseCategoriesService(user.id);
        console.log("[SettingsPage] Expense Categories cleared from Firestore.");
        
        // Delete userSettings document
        if (db) { // Ensure db is initialized
            const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, user.id);
            await deleteDoc(userSettingsRef);
            console.log("[SettingsPage] UserSettings document deleted from Firestore.");
        } else {
            console.error("[SettingsPage] Firestore db instance is not available for deleting userSettings.");
        }

        // Optionally, clear user-specific localStorage items if any remain (e.g., UI preferences not in UserSettings)
        const localStorageKeysToClearBases = [
          // Add any user-specific localStorage keys that are NOT part of UserSettings
          // For example, if KPI_PREFERENCES_STORAGE_KEY_BASE was still in localStorage:
          // 'invoTrack_kpiPreferences_v2', 
          // 'invoTrack_quickActionsPreferences_v1',
        ];
        localStorageKeysToClearBases.forEach(baseKey => {
          const userSpecificKey = getStorageKey(baseKey, user.id);
          localStorage.removeItem(userSpecificKey);
          console.log(`[SettingsPage] Removed from localStorage: ${userSpecificKey}`);
        });
        
        // Clear temporary scan data from localStorage
        const tempKeysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith(`invoTrackTempScan_${user.id}_`) ||
                      key.startsWith(`invoTrackTempOriginalImagePreviewUri_${user.id}_`) ||
                      key.startsWith(`invoTrackTempCompressedImageUri_${user.id}_`))) {
            tempKeysToRemove.push(key);
          }
        }
        tempKeysToRemove.forEach(key => {
          localStorage.removeItem(key);
          console.log(`[SettingsPage] Removed temporary scan data from localStorage: ${key}`);
        });


        toast({
          title: t('settings_delete_all_success_title'),
          description: t('settings_delete_all_success_desc'),
        });
        router.refresh(); // Refresh to reflect cleared state
      } catch (error) {
        console.error("[SettingsPage] Error deleting all user data:", error);
        toast({
          title: t('error_title'),
          description: `${t('settings_delete_all_error_desc')} ${(error as Error).message}`,
          variant: "destructive",
        });
      } finally {
        setIsDeletingAllData(false);
      }
    };


     if (authLoading || !user) {
      return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
        </div>
      );
    }


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md scale-fade-in">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary flex items-center">
            <SettingsIcon className="mr-2 h-6 w-6" /> {t('settings_title')}
          </CardTitle>
           {user ? (
             <CardDescription>{t('settings_description_user')}</CardDescription>
           ) : (
             <CardDescription>{t('settings_description_guest')}</CardDescription>
           )}
        </CardHeader>
        <CardContent className="space-y-6">
           {user ? (
              <>
                <Card className="scale-fade-in" style={{animationDelay: '0.1s'}}>
                     <CardHeader>
                        <CardTitle className="text-lg flex items-center"><User className="mr-2 h-5 w-5" /> {t('settings_user_profile_title')}</CardTitle>
                     </CardHeader>
                     <CardContent className="space-y-2">
                         <p><strong>{t('settings_username_label')}:</strong> {user.username}</p>
                         <p><strong>{t('settings_email_label')}:</strong> {user.email}</p>
                     </CardContent>
                </Card>

                 <Card className="scale-fade-in" style={{animationDelay: '0.2s'}}>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center">
                            <Plug className="mr-2 h-5 w-5" /> {t('settings_pos_integration_title')}
                        </CardTitle>
                        <CardDescription>
                            {t('settings_pos_integration_desc')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                         <Button asChild variant="outline">
                            <Link href="/settings/pos-integration">
                                {t('settings_pos_integration_button')}
                            </Link>
                         </Button>
                    </CardContent>
                 </Card>

                 <Card className="scale-fade-in" style={{animationDelay: '0.3s'}}>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center">
                            <Mail className="mr-2 h-5 w-5" /> {t('settings_accountant_details_title')}
                        </CardTitle>
                        <CardDescription>
                            {t('settings_accountant_details_desc')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                         <Button asChild variant="outline">
                            <Link href="/settings/accountant">
                                {t('settings_accountant_details_button')}
                            </Link>
                         </Button>
                    </CardContent>
                 </Card>

                 <Card className="scale-fade-in" style={{animationDelay: '0.4s'}}>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center">
                            <Bell className="mr-2 h-5 w-5" /> {t('settings_notification_prefs_title')}
                        </CardTitle>
                        <CardDescription>
                            {t('settings_notification_prefs_desc')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                         <Button asChild variant="outline">
                            <Link href="/settings/notifications">
                                {t('settings_notification_prefs_button')}
                            </Link>
                         </Button>
                    </CardContent>
                 </Card>

                <Card className="scale-fade-in border-destructive/50" style={{animationDelay: '0.5s'}}>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center text-destructive">
                            <Trash2 className="mr-2 h-5 w-5" /> {t('settings_delete_all_data_title')}
                        </CardTitle>
                        <CardDescription className="text-destructive/90">
                            {t('settings_delete_all_data_desc')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" disabled={isDeletingAllData}>
                                    {isDeletingAllData ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                    {t('settings_delete_all_data_button')}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                <AlertDialogTitle>{t('settings_delete_all_confirm_title')}</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {t('settings_delete_all_confirm_desc')}
                                </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                <AlertDialogCancel disabled={isDeletingAllData}>{t('cancel_button')}</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={handleDeleteAllUserData}
                                    disabled={isDeletingAllData}
                                    className={cn(buttonVariants({variant: "destructive"}), isDeletingAllData && "opacity-50")}
                                >
                                    {isDeletingAllData && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {t('settings_delete_all_confirm_action')}
                                </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </CardContent>
                </Card>


              </>
           ) : (
               <div className="text-center p-6 border rounded-md bg-muted/50 scale-fade-in">
                  <p className="text-muted-foreground mb-4">{t('settings_login_required')}</p>
                  <Button asChild>
                     <Link href="/login">
                        <LogIn className="mr-2 h-4 w-4" /> {t('nav_login')}
                     </Link>
                  </Button>
               </div>
           )}
           {user && <p className="text-center text-muted-foreground mt-8 scale-fade-in" style={{animationDelay: '0.6s'}}>{t('settings_more_coming_soon')}</p>}

        </CardContent>
      </Card>
    </div>
  );
}
