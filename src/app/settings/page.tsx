'use client';

import React, { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Settings as SettingsIcon, User } from 'lucide-react';

export default function SettingsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

     // Redirect if not logged in
    useEffect(() => {
      if (!authLoading && !user) {
        router.push('/login');
         toast({
           title: "Authentication Required",
           description: "Please log in to view settings.",
           variant: "destructive",
         });
      }
    }, [authLoading, user, router, toast]);


     if (authLoading) {
      return (
        <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }

     if (!user) {
         // Should be redirected by the effect, but this is a fallback
         return <div className="container mx-auto p-4 md:p-8"><p>Redirecting to login...</p></div>;
     }


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary flex items-center">
            <SettingsIcon className="mr-2 h-6 w-6" /> Settings
          </CardTitle>
          <CardDescription>Manage your account and application settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
           <Card>
                <CardHeader>
                   <CardTitle className="text-lg flex items-center"><User className="mr-2 h-5 w-5" /> User Profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <p><strong>Username:</strong> {user.username}</p>
                    <p><strong>Email:</strong> {user.email}</p>
                    {/* Add options like 'Change Password' here */}
                    {/* <Button variant="outline" size="sm" className="mt-2">Change Password</Button> */}
                </CardContent>
           </Card>

           {/* Add more setting sections as needed */}
           {/* Example: Notification Settings */}
           {/* <Card>
                <CardHeader>
                   <CardTitle className="text-lg">Notifications</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Configure notification preferences...</p>
                </CardContent>
            </Card> */}

           <p className="text-center text-muted-foreground mt-8">More settings coming soon!</p>

        </CardContent>
      </Card>
    </div>
  );
}
