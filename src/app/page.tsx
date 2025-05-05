'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { Package, FileText, BarChart2, ScanLine } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation'; // Use App Router's useRouter

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const handleScanClick = () => {
    router.push('/upload');
  };

  const handleInventoryClick = () => {
    router.push('/inventory');
  };

  const handleReportsClick = () => {
    router.push('/reports');
  };


  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-4 md:p-8 home-background">
      <div className="w-full max-w-4xl text-center fade-in-content">
        <h1 className="text-4xl md:text-5xl font-bold mb-4 text-primary">
          Welcome to InvoTrack Mobile
        </h1>
        {loading ? (
          <p className="text-lg text-muted-foreground">Loading user data...</p>
        ) : user ? (
          <p className="text-lg text-muted-foreground mb-8">
            Hello, {user.username}! Manage your inventory efficiently.
          </p>
        ) : (
          <p className="text-lg text-muted-foreground mb-8">
             Please <Link href="/login" className="text-accent hover:underline">log in</Link> or <Link href="/register" className="text-accent hover:underline">register</Link> to get started.
          </p>
        )}

        {/* Quick Stats Dashboard */}
        {user && !loading && (
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
            <Card className="shadow-md hover:shadow-lg transition-shadow duration-300">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Items</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">1,234</div> {/* Placeholder */}
                <p className="text-xs text-muted-foreground">+5% from last month</p> {/* Placeholder */}
              </CardContent>
            </Card>
            <Card className="shadow-md hover:shadow-lg transition-shadow duration-300">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
                <span className="h-4 w-4 text-muted-foreground">$</span>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">$15,678.90</div> {/* Placeholder */}
                <p className="text-xs text-muted-foreground">Updated yesterday</p> {/* Placeholder */}
              </CardContent>
            </Card>
            <Card className="shadow-md hover:shadow-lg transition-shadow duration-300">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Docs Processed (30d)</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">89</div> {/* Placeholder */}
                <p className="text-xs text-muted-foreground">Last: Invoice #INV-089</p> {/* Placeholder */}
              </CardContent>
            </Card>
          </div>
        )}


        {/* Quick Action Buttons */}
         <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-shadow duration-300"
            onClick={handleScanClick}
            disabled={!user || loading}
          >
            <ScanLine className="mr-2 h-5 w-5" /> Scan New Document
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="border-primary text-primary hover:bg-primary/10 shadow-md hover:shadow-lg transition-shadow duration-300"
             onClick={handleInventoryClick}
             disabled={!user || loading}
          >
            <Package className="mr-2 h-5 w-5" /> View Inventory
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="bg-secondary hover:bg-secondary/80 text-secondary-foreground shadow-md hover:shadow-lg transition-shadow duration-300"
             onClick={handleReportsClick}
             disabled={!user || loading}
          >
            <BarChart2 className="mr-2 h-5 w-5" /> View Reports
          </Button>
        </div>
      </div>
    </div>
  );
}