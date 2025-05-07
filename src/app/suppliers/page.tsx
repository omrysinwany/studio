'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { getSupplierSummariesService, SupplierSummary, InvoiceHistoryItem, getInvoicesService } from '@/services/backend';
import { Briefcase, Search, DollarSign, FileText, Loader2, Info, ChevronDown, ChevronUp, ExternalLink, Phone, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';

const ITEMS_PER_PAGE = 10;

type SortKey = keyof SupplierSummary | 'contact' | ''; // Added 'contact' for sorting
type SortDirection = 'asc' | 'desc';

const formatCurrency = (value: number) => `₪${value.toFixed(2)}`;

const renderStatusBadge = (status: InvoiceHistoryItem['status']) => {
    let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
    let className = '';
    let icon = null;

    switch (status) {
        case 'completed':
            variant = 'secondary';
            className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80';
            icon = <Info className="mr-1 h-3 w-3" />; // Using Info for completed
            break;
        case 'processing':
            variant = 'secondary';
            className = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse hover:bg-blue-100/80';
            icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />;
            break;
        case 'pending':
            variant = 'secondary';
            className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80';
            icon = <Info className="mr-1 h-3 w-3" />; // Using Info for pending
            break;
        case 'error':
            variant = 'destructive';
            icon = <Info className="mr-1 h-3 w-3" />; // Using Info for error
            break;
        default:
            variant = 'outline';
            icon = null;
            break;
    }
    return (
        <Badge variant={variant} className={cn("text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5", className)}>
            {icon}
            {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
    );
};


export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [allInvoices, setAllInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('totalSpent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierSummary | null>(null);
  const [selectedSupplierInvoices, setSelectedSupplierInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [summaries, invoicesData] = await Promise.all([
          getSupplierSummariesService(),
          getInvoicesService()
        ]);
        setSuppliers(summaries);
        setAllInvoices(invoicesData.map(inv => ({...inv, uploadTime: new Date(inv.uploadTime)})));
      } catch (error) {
        console.error("Failed to fetch supplier data:", error);
        toast({
          title: "Error Loading Data",
          description: "Could not load supplier information.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [toast]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const filteredAndSortedSuppliers = useMemo(() => {
    let result = [...suppliers];
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(s => s.name.toLowerCase().includes(lowerSearchTerm));
    }

    if (sortKey) {
      result.sort((a, b) => {
        const valA = a[sortKey as keyof SupplierSummary];
        const valB = b[sortKey as keyof SupplierSummary];
        let comparison = 0;
        if (typeof valA === 'number' && typeof valB === 'number') {
          comparison = valA - valB;
        } else if (typeof valA === 'string' && typeof valB === 'string') {
          comparison = valA.localeCompare(valB);
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }
    return result;
  }, [suppliers, searchTerm, sortKey, sortDirection]);

  const totalItems = filteredAndSortedSuppliers.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const paginatedSuppliers = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedSuppliers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredAndSortedSuppliers, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleViewSupplierDetails = (supplier: SupplierSummary) => {
    setSelectedSupplier(supplier);
    const invoicesForSupplier = allInvoices.filter(inv => inv.supplier === supplier.name)
                                      .sort((a,b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());
    setSelectedSupplierInvoices(invoicesForSupplier);
    setIsSheetOpen(true);
  };
  
  const navigateToInvoiceDetails = (invoiceId: string) => {
    // Find the specific invoice in allInvoices to pass its data or key
    const invoice = allInvoices.find(inv => inv.id === invoiceId);
    if (invoice) {
      // For now, let's assume InvoicesPage can handle an invoice ID or key via query param
      // This part needs to align with how InvoicesPage expects to load a specific invoice detail.
      // If InvoicesPage uses localStorage for viewing, you might need to store selected invoice detail temporarily
      // and redirect. This example uses a query param.
      router.push(`/invoices?viewInvoiceId=${invoiceId}`); // Example query param
      setIsSheetOpen(false); // Close supplier sheet
    } else {
      toast({ title: "Error", description: "Could not find invoice details.", variant: "destructive" });
    }
  };


  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Briefcase className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> Suppliers Overview
          </CardTitle>
          <CardDescription>Manage and review your suppliers and their order history.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6">
            <div className="relative w-full md:max-w-xs lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search suppliers..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="pl-10"
                aria-label="Search suppliers"
              />
            </div>
            {/* Future: Add filter/sort dropdowns here if needed */}
          </div>

          <div className="overflow-x-auto relative">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('name')}>
                    Supplier Name {sortKey === 'name' && (sortDirection === 'asc' ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />)}
                  </TableHead>
                  <TableHead className="text-center cursor-pointer hover:bg-muted/50" onClick={() => handleSort('invoiceCount')}>
                    Orders {sortKey === 'invoiceCount' && (sortDirection === 'asc' ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />)}
                  </TableHead>
                  <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('totalSpent')}>
                    Total Spent {sortKey === 'totalSpent' && (sortDirection === 'asc' ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />)}
                  </TableHead>
                   <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSuppliers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      No suppliers found.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSuppliers.map((supplier) => (
                    <TableRow key={supplier.name} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{supplier.name}</TableCell>
                      <TableCell className="text-center">{supplier.invoiceCount}</TableCell>
                      <TableCell className="text-right">{formatCurrency(supplier.totalSpent)}</TableCell>
                       <TableCell className="text-center">
                        <Button variant="ghost" size="icon" onClick={() => handleViewSupplierDetails(supplier)} title={`View details for ${supplier.name}`}>
                          <Info className="h-4 w-4 text-primary" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-end space-x-2 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
          <SheetHeader className="p-4 sm:p-6 border-b shrink-0">
            <SheetTitle className="text-lg sm:text-xl">{selectedSupplier?.name || 'Supplier Details'}</SheetTitle>
            <SheetDescription>
              Contact information and order history.
            </SheetDescription>
          </SheetHeader>
          {selectedSupplier && (
            <ScrollArea className="flex-grow">
              <div className="p-4 sm:p-6 space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center"><Info className="mr-2 h-4 w-4" /> Contact (Placeholder)</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <p className="flex items-center"><Phone className="mr-2 h-3.5 w-3.5 text-muted-foreground"/> N/A</p>
                    <p className="flex items-center"><Mail className="mr-2 h-3.5 w-3.5 text-muted-foreground"/> N/A</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center"><FileText className="mr-2 h-4 w-4" />Recent Invoices ({selectedSupplierInvoices.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedSupplierInvoices.length > 0 ? (
                      <div className="max-h-80 overflow-y-auto_ pr-2"> {/* Added max-height and overflow for this specific table */}
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs px-2 py-1">File Name</TableHead>
                              <TableHead className="text-xs px-2 py-1">Date</TableHead>
                              <TableHead className="text-xs px-2 py-1 text-right">Total</TableHead>
                               <TableHead className="text-xs px-2 py-1 text-center">Status</TableHead>
                               <TableHead className="text-xs px-2 py-1 text-center">View</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedSupplierInvoices.slice(0, 15).map(invoice => ( // Show recent 15
                              <TableRow key={invoice.id}>
                                <TableCell className="text-xs px-2 py-1 truncate max-w-[100px]">{invoice.fileName}</TableCell>
                                <TableCell className="text-xs px-2 py-1">{format(new Date(invoice.uploadTime), 'PP')}</TableCell>
                                <TableCell className="text-xs px-2 py-1 text-right">{invoice.totalAmount !== undefined ? formatCurrency(invoice.totalAmount) : 'N/A'}</TableCell>
                                 <TableCell className="text-xs px-2 py-1 text-center">{renderStatusBadge(invoice.status)}</TableCell>
                                 <TableCell className="text-xs px-2 py-1 text-center">
                                   <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigateToInvoiceDetails(invoice.id)}>
                                     <ExternalLink className="h-3.5 w-3.5 text-primary"/>
                                   </Button>
                                 </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">No invoices found for this supplier.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          )}
          <SheetFooter className="p-4 sm:p-6 border-t shrink-0">
            <SheetClose asChild>
              <Button variant="outline">Close</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}