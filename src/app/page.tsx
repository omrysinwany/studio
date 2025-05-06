
'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext"; // Keep useAuth to optionally show user info
import { Package, FileText, BarChart2, ScanLine, Loader2, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react"; // Added more icons for KPIs
import Link from 'next/link';
import { useRouter } from 'next/navigation'; // Use App Router's useRouter
import { cn } from '@/lib/utils'; // Import cn for conditional classes


export default function Home() {
  const { user, loading: authLoading } = useAuth(); // Still check auth to customize experience if logged in
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

  // Show loading indicator while checking auth status (optional, but good UX if you personalize)
   if (authLoading) {
     return (
       <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-4 md:p-8">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="mt-4 text-muted-foreground">Loading...</p>
       </div>
     );
   }

  // Placeholder Data (Replace with actual data fetching later)
  const kpiData = {
    totalItems: 1234,
    inventoryValue: 15678.90,
    valueChangePercent: 5.2,
    docsProcessed: 89,
    lowStockItems: 2,
  };

  // Render the main content (no redirect needed)
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-4 sm:p-6 md:p-8 home-background">
      <div className="w-full max-w-4xl text-center fade-in-content">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 text-primary">
          Welcome to InvoTrack
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground mb-6 md:mb-8">
          {user ? `Hello, ${user.username}! Your inventory, simplified.` : 'Your inventory, simplified.'}
        </p>

        {/* Quick Stats Dashboard */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 md:mb-12">
           {/* Total Items Card */}
           <Link href="/inventory" className="block hover:no-underline">
             <Card className="shadow-md hover:shadow-lg transition-shadow duration-300 h-full text-left sm:text-center">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                 <CardTitle className="text-sm font-medium">Total Items</CardTitle>
                 <Package className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                 <div className="text-2xl font-bold">{kpiData.totalItems.toLocaleString()}</div>
                 <p className="text-xs text-muted-foreground">In stock</p>
               </CardContent>
             </Card>
           </Link>

            {/* Inventory Value Card */}
            <Link href="/reports" className="block hover:no-underline">
             <Card className="shadow-md hover:shadow-lg transition-shadow duration-300 h-full text-left sm:text-center">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                 <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
                 <span className="h-4 w-4 text-muted-foreground font-semibold">₪</span> {/* Changed to ILS */}
               </CardHeader>
               <CardContent>
                 <div className="text-2xl font-bold">₪{kpiData.inventoryValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <p className={cn("text-xs", kpiData.valueChangePercent >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive dark:text-red-400")}>
                   {kpiData.valueChangePercent >= 0 ? <TrendingUp className="inline h-3 w-3 mr-1" /> : <TrendingDown className="inline h-3 w-3 mr-1" />}
                   {Math.abs(kpiData.valueChangePercent)}% vs last period
                 </p>
               </CardContent>
             </Card>
            </Link>

           {/* Docs Processed Card */}
            <Link href="/invoices" className="block hover:no-underline">
             <Card className="shadow-md hover:shadow-lg transition-shadow duration-300 h-full text-left sm:text-center">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                 <CardTitle className="text-sm font-medium">Docs Processed (30d)</CardTitle>
                 <FileText className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                 <div className="text-2xl font-bold">{kpiData.docsProcessed}</div>
                 <p className="text-xs text-muted-foreground">Last: Invoice #INV-089</p> {/* Placeholder */}
               </CardContent>
             </Card>
            </Link>

             {/* Low Stock Items Card */}
             <Link href="/inventory?filter=low" className="block hover:no-underline">
                 <Card className="shadow-md hover:shadow-lg transition-shadow duration-300 h-full text-left sm:text-center">
                 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                     <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
                     <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                 </CardHeader>
                 <CardContent>
                     <div className="text-2xl font-bold">{kpiData.lowStockItems}</div>
                     <p className="text-xs text-muted-foreground">Items needing attention</p>
                 </CardContent>
                 </Card>
            </Link>
         </div>


        {/* Quick Action Buttons */}
        <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
          <Button
            size="lg"
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-shadow duration-300 text-base"
            onClick={handleScanClick}
          >
            <ScanLine className="mr-2 h-5 w-5" /> Scan New Document
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto border-primary text-primary hover:bg-primary/10 shadow-md hover:shadow-lg transition-shadow duration-300 text-base"
             onClick={handleInventoryClick}
          >
            <Package className="mr-2 h-5 w-5" /> View Inventory
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="w-full sm:w-auto bg-secondary hover:bg-secondary/80 text-secondary-foreground shadow-md hover:shadow-lg transition-shadow duration-300 text-base"
             onClick={handleReportsClick}
          >
            <BarChart2 className="mr-2 h-5 w-5" /> View Reports
          </Button>
        </div>
      </div>
    </div>
  );
}
