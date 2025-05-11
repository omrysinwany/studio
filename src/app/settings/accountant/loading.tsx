'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Mail } from "lucide-react";
// Removed Button import as it's not used directly for skeleton.

export default function AccountantSettingsLoading() {
  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        <Skeleton className="h-9 w-36 mb-4" /> {/* Back button skeleton */}
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Mail className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> 
            <Skeleton className="h-7 w-48" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-md mt-1" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" /> {/* Label skeleton */}
            <Skeleton className="h-10 w-full" /> {/* Input skeleton */}
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" /> {/* Label skeleton */}
            <Skeleton className="h-10 w-full" /> {/* Input skeleton */}
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" /> {/* Label skeleton */}
            <Skeleton className="h-10 w-full" /> {/* Input skeleton */}
          </div>
          <div className="flex justify-end pt-2">
            <Skeleton className="h-10 w-32" /> {/* Button skeleton */}
          </div>
        </CardContent>
      </Card>
        <div className="flex justify-center items-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">Loading settings...</p>
        </div>
    </div>
  );
}
