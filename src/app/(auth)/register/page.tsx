'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
import { UserPlus } from 'lucide-react';
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
  const { register, loading } = useAuth();
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

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      await register(values);
      toast({
        title: t('register_toast_success_title'),
        description: t('register_toast_success_desc'),
      });
      router.push('/'); // Redirect to home page after successful registration
    } catch (error) {
      console.error("Registration failed:", error);
       toast({
         title: t('register_toast_fail_title'),
         description: t('register_toast_fail_desc'),
         variant: "destructive",
       });
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
