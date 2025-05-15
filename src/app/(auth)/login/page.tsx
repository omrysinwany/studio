
'use client';

import * as React from 'react';
import { useEffect } from 'react'; // Ensure useEffect is imported
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation'; // Use App Router's useRouter

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
import { LogIn, ChromeIcon, Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

const formSchema = z.object({
  email: z.string().email({ // Changed from username to email for Firebase Auth
    message: 'Please enter a valid email.',
  }),
  password: z.string().min(6, {
    message: 'Password must be at least 6 characters.',
  }),
});

export default function LoginPage() {
  const { loginWithEmail, signInWithGoogle, loading, user } = useAuth(); // Changed login to loginWithEmail for clarity
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  useEffect(() => {
    if (!loading && user) {
      router.push('/');
    }
  }, [user, loading, router]);

  if (loading || (!loading && user)) {
    return (
      <div className="flex min-h-[calc(100vh-var(--header-height,4rem))] items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      await loginWithEmail({ email: values.email, password: values.password }); // Use email and password
      // Navigation is handled by processFirebaseUser or useEffect
    } catch (error) {
       form.resetField("password");
       // Error toast is handled by AuthContext
    }
  }

  async function handleGoogleSignIn() {
    try {
      await signInWithGoogle();
      // Navigation is handled by processFirebaseUser or useEffect
    } catch (error) {
      // Error toast is handled by AuthContext
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-var(--header-height,4rem))] items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg scale-fade-in">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-primary">{t('login_title')}</CardTitle>
          <CardDescription>{t('login_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="email" // Changed from username to email
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('register_email_label')}</FormLabel> {/* Using register_email_label for consistency */}
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
                    <FormLabel>{t('login_password_label')}</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder={t('login_password_placeholder')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={loading}>
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('login_button_loading')}</> : <><LogIn className="mr-2 h-4 w-4" /> {t('login_button')}</>}
              </Button>
            </form>
          </Form>

          <div className="my-4 flex items-center text-xs text-muted-foreground">
            <div className="flex-grow border-t border-border"></div>
            <span className="mx-2">{t('login_or_divider')}</span>
            <div className="flex-grow border-t border-border"></div>
          </div>

          <Button variant="outline" className="w-full" onClick={handleGoogleSignIn} disabled={loading}>
            <ChromeIcon className="mr-2 h-4 w-4" />
            {t('login_google_button')}
          </Button>

          <div className="mt-6 text-center text-sm">
            {t('login_no_account')}{' '}
            <Link href="/register" className="font-medium text-accent hover:underline">
              {t('login_register_link')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
