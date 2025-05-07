'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Briefcase, Loader2 } from 'lucide-react';

export default function SuppliersLoading() {
  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Briefcase className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> Suppliers Overview
          </CardTitle>
          <CardDescription>Manage and review your suppliers and their order history.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6">
            <Skeleton className="h-10 w-full md:max-w-xs lg:max-w-sm" />
          </div>

          <div className="overflow-x-auto relative">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><Skeleton className="h-5 w-32" /></TableHead>
                  <TableHead className="text-center"><Skeleton className="h-5 w-20" /></TableHead>
                  <TableHead className="text-right"><Skeleton className="h-5 w-24" /></TableHead>
                  <TableHead className="text-center"><Skeleton className="h-5 w-16" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index} className="hover:bg-muted/50">
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-10" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-8 w-8 rounded-full" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
           <div className="flex justify-center items-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2 text-muted-foreground">Loading suppliers...</p>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}