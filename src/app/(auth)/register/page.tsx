
'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';


import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { useToast } from "@/hooks/use-toast";
import { UserPlus, ChromeIcon, Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

const formSchema = z.object({
  username: z.string().min(2, {
    message: 'Username must be at least 2 characters.',
  }),
  email: z.string().email({
    message: 'Please enter a valid email address.',
  }),
  password: z.string().min(6, {
    message: 'Password must be at least 6 characters.',
  }),
});

export default function RegisterPage() {
  const { register, signInWithGoogle, loading, user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
    },
  });

  useEffect(() => {
    if (!loading && user) { // Check for loading state before redirecting
      router.push('/');
    }
  }, [user, loading, router]);

  if (loading || (!loading && user)) { // Show loader if auth is loading OR if user is logged in (and redirecting)
    return (
      <div className="flex min-h-[calc(100vh-var(--header-height,4rem))] items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      await register(values);
       // Toast is handled by AuthContext
      // router.push('/'); // Navigation handled by useEffect or successful login callback in AuthContext
    } catch (error) {
      // Error toast is handled by AuthContext
    }
  }

  async function handleGoogleSignIn() {
    try {
      await signInWithGoogle();
       // Toast is handled by AuthContext
      // router.push('/'); // Navigation handled by useEffect or successful login callback in AuthContext
    } catch (error) {
      // Error toast is handled by AuthContext
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-var(--header-height,4rem))] items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg scale-fade-in">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-primary">{t('register_title')}</CardTitle>
          <CardDescription>{t('register_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('register_username_label')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('register_username_placeholder')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('register_email_label')}</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder={t('register_email_placeholder')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('register_password_label')}</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder={t('register_password_placeholder')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={loading}>
                {loading ? t('register_button_loading') : <><UserPlus className="mr-2 h-4 w-4" /> {t('register_button')}</>}
              </Button>
            </form>
          </Form>
          <div className="my-4 flex items-center text-xs text-muted-foreground">
            <div className="flex-grow border-t border-border"></div>
            <span className="mx-2">{t('register_or_divider')}</span>
            <div className="flex-grow border-t border-border"></div>
          </div>

          <Button variant="outline" className="w-full" onClick={handleGoogleSignIn} disabled={loading}>
            <ChromeIcon className="mr-2 h-4 w-4" />
            {t('register_google_button')}
          </Button>

           <div className="mt-6 text-center text-sm">
            {t('register_has_account')}{' '}
            <Link href="/login" className="font-medium text-accent hover:underline">
              {t('register_login_link')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
