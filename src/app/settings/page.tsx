'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2, Settings as SettingsIcon, User, LogIn, Plug } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';


export default function SettingsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { t } = useTranslation();

    React.useEffect(() => {
        if (!authLoading && !user) {
          router.push('/login');
        }
    }, [user, authLoading, router]);


     if (authLoading) {
      return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
           <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
        </div>
      );
    }

    if (!user) {
        return null;
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
           {user && <p className="text-center text-muted-foreground mt-8 scale-fade-in" style={{animationDelay: '0.4s'}}>{t('settings_more_coming_soon')}</p>}

        </CardContent>
      </Card>
    </div>
  );
}
