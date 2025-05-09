'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { getSupplierSummariesService, SupplierSummary, InvoiceHistoryItem, getInvoicesService, updateSupplierContactInfoService, createSupplierService, deleteSupplierService } from '@/services/backend';
import { Briefcase, Search, DollarSign, FileTextIcon, Loader2, Info, ChevronDown, ChevronUp, Phone, Mail, BarChart3, ListChecks, Edit, Save, X, PlusCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths } from 'date-fns';
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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import CreateSupplierSheet from '@/components/create-supplier-sheet';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';


const ITEMS_PER_PAGE = 10;

type SortKey = keyof Pick<SupplierSummary, 'name' | 'invoiceCount'> | 'totalSpent' ;
type SortDirection = 'asc' | 'desc';


const formatDate = (date: Date | string | undefined, t: (key: string) => string, f: string = 'PP') => {
  if (!date) return t('suppliers_na');
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date;
    if (isNaN(dateObj.getTime())) return t('suppliers_invalid_date');
    return format(dateObj, f);
  } catch (e) {
    console.error("Error formatting date:", e, "Input:", date);
    return t('suppliers_invalid_date');
  }
};


const renderStatusBadge = (status: InvoiceHistoryItem['status'], t: (key: string) => string) => {
    let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
    let className = '';
    let icon = null;

    switch (status) {
        case 'completed':
            variant = 'secondary';
            className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80';
            icon = <Info className="mr-1 h-3 w-3" />;
            break;
        case 'processing':
            variant = 'secondary';
            className = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse hover:bg-blue-100/80';
            icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />;
            break;
        case 'pending':
            variant = 'secondary';
            className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80';
            icon = <Info className="mr-1 h-3 w-3" />;
            break;
        case 'error':
            variant = 'destructive';
            icon = <Info className="mr-1 h-3 w-3" />;
            break;
        default:
            variant = 'outline';
            icon = null;
            break;
    }
    return (
        <Badge variant={variant} className={cn("text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5", className)}>
            {icon}
            {t(`invoice_status_${status}` as any) || status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
    );
};

interface MonthlySpendingData {
  month: string;
  total: number;
}

export default function SuppliersPage() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  const formatCurrency = (value: number | undefined | null): string => {
    if (value === undefined || value === null || isNaN(value)) return `${t('currency_symbol')}0.00`;
    return `${t('currency_symbol')}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [allInvoices, setAllInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierSummary | null>(null);
  const [selectedSupplierInvoices, setSelectedSupplierInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [monthlySpendingData, setMonthlySpendingData] = useState<MonthlySpendingData[]>([]);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);

  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editedContactInfo, setEditedContactInfo] = useState<{ phone?: string; email?: string }>({});
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [isDeletingSupplier, setIsDeletingSupplier] = useState(false);


  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const fetchData = async () => {
    if(!user) return;
    setIsLoading(true);
    try {
      const [summaries, invoicesData] = await Promise.all([
        getSupplierSummariesService(),
        getInvoicesService()
      ]);
      setSuppliers(summaries);
      setAllInvoices(invoicesData.map(inv => ({...inv, uploadTime: inv.uploadTime })));
    } catch (error) {
      console.error("Failed to fetch supplier data:", error);
      toast({
        title: t('suppliers_toast_error_load_title'),
        description: t('suppliers_toast_error_load_desc'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if(user){
        fetchData();
    }
  }, [toast, t, user]); // Added t to dependencies

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
    setEditedContactInfo({ phone: supplier.phone || '', email: supplier.email || '' });
    setIsEditingContact(false);
    const invoicesForSupplier = allInvoices.filter(inv => inv.supplier === supplier.name)
                                      .sort((a,b) => new Date(b.uploadTime as string).getTime() - new Date(a.uploadTime as string).getTime());
    setSelectedSupplierInvoices(invoicesForSupplier);

    const last12Months = eachMonthOfInterval({
        start: subMonths(new Date(), 11),
        end: new Date()
    });

    const spendingByMonth: Record<string, number> = {};
    last12Months.forEach(monthDate => {
        const monthYear = formatDate(monthDate, t, 'MMM yyyy');
        spendingByMonth[monthYear] = 0;
    });

    invoicesForSupplier.forEach(invoice => {
      if (invoice.totalAmount && invoice.status === 'completed') {
        const monthYear = formatDate(invoice.uploadTime as string, t, 'MMM yyyy');
        if(spendingByMonth.hasOwnProperty(monthYear)){
            spendingByMonth[monthYear] = (spendingByMonth[monthYear] || 0) + invoice.totalAmount;
        }
      }
    });
    const chartData = Object.entries(spendingByMonth)
      .map(([month, total]) => ({ month, total }))
      .sort((a,b) => new Date(a.month).getTime() - new Date(b.month).getTime());
    setMonthlySpendingData(chartData);

    setIsDetailSheetOpen(true);
  };

  const navigateToInvoiceDetails = (invoiceId: string) => {
    router.push(`/invoices?viewInvoiceId=${invoiceId}`);
    setIsDetailSheetOpen(false);
  };

  const handleSaveContactInfo = async () => {
    if (!selectedSupplier) return;
    setIsSavingContact(true);
    try {
      await updateSupplierContactInfoService(selectedSupplier.name, editedContactInfo);
      setSuppliers(prev => prev.map(s => s.name === selectedSupplier.name ? {...s, ...editedContactInfo} : s));
      setSelectedSupplier(prev => prev ? {...prev, ...editedContactInfo} : null);
      toast({ title: t('suppliers_toast_contact_updated_title'), description: t('suppliers_toast_contact_updated_desc', { supplierName: selectedSupplier.name }) });
      setIsEditingContact(false);
    } catch (error: any) {
      console.error("Failed to update contact info:", error);
      toast({ title: t('suppliers_toast_update_fail_title'), description: t('suppliers_toast_update_fail_desc', { message: error.message }), variant: "destructive" });
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleCreateSupplier = async (name: string, contactInfo: { phone?: string; email?: string }) => {
    try {
      const newSupplier = await createSupplierService(name, contactInfo);
      setSuppliers(prev => [newSupplier, ...prev]);
      toast({ title: t('suppliers_toast_created_title'), description: t('suppliers_toast_created_desc', { supplierName: name }) });
      setIsCreateSheetOpen(false);
    } catch (error: any) {
      console.error("Failed to create supplier:", error);
      toast({ title: t('suppliers_toast_create_fail_title'), description: t('suppliers_toast_create_fail_desc', { message: error.message }), variant: "destructive" });
    }
  };

  const handleDeleteSupplier = async (supplierName: string) => {
    setIsDeletingSupplier(true);
    try {
      await deleteSupplierService(supplierName);
      setSuppliers(prev => prev.filter(s => s.name !== supplierName));
      toast({ title: t('suppliers_toast_deleted_title'), description: t('suppliers_toast_deleted_desc', { supplierName }) });
      if (selectedSupplier?.name === supplierName) {
        setIsDetailSheetOpen(false);
        setSelectedSupplier(null);
      }
    } catch (error: any) {
      console.error("Failed to delete supplier:", error);
      toast({ title: t('suppliers_toast_delete_fail_title'), description: t('suppliers_toast_delete_fail_desc', { message: error.message }), variant: "destructive" });
    } finally {
      setIsDeletingSupplier(false);
    }
  };


  if (authLoading || isLoading) {
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
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <Briefcase className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('suppliers_title')}
              </CardTitle>
              <CardDescription>{t('suppliers_description')}</CardDescription>
            </div>
            <Button onClick={() => setIsCreateSheetOpen(true)} className="w-full sm:w-auto">
              <PlusCircle className="mr-2 h-4 w-4" /> {t('suppliers_add_new_button')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6">
            <div className="relative w-full md:max-w-xs lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('suppliers_search_placeholder')}
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="pl-10"
                aria-label={t('suppliers_search_aria')}
              />
            </div>
          </div>

          <div className="overflow-x-auto relative">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('name')}>
                    {t('suppliers_col_name')} {sortKey === 'name' && (sortDirection === 'asc' ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />)}
                  </TableHead>
                  <TableHead className="text-center cursor-pointer hover:bg-muted/50" onClick={() => handleSort('invoiceCount')}>
                    {t('suppliers_col_orders')} {sortKey === 'invoiceCount' && (sortDirection === 'asc' ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />)}
                  </TableHead>
                   <TableHead className="text-center">{t('suppliers_col_actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSuppliers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
                      {t('suppliers_no_suppliers_found')}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSuppliers.map((supplier) => (
                    <TableRow key={supplier.name} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{supplier.name}</TableCell>
                      <TableCell className="text-center">{supplier.invoiceCount}</TableCell>
                       <TableCell className="text-center space-x-1">
                        <Button variant="ghost" size="icon" onClick={() => handleViewSupplierDetails(supplier)} title={t('suppliers_view_details_title', { supplierName: supplier.name })}>
                          <Info className="h-4 w-4 text-primary" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" title={t('suppliers_delete_title', { supplierName: supplier.name })} disabled={isDeletingSupplier}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('suppliers_delete_confirm_title')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('suppliers_delete_confirm_desc', { supplierName: supplier.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={isDeletingSupplier}>{t('cancel_button')}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteSupplier(supplier.name)} disabled={isDeletingSupplier} className={cn(buttonVariants({variant: "destructive"}), isDeletingSupplier && "opacity-50")}>
                                {isDeletingSupplier && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t('suppliers_delete_confirm_action')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
                {t('inventory_pagination_previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('inventory_pagination_page_info', { currentPage: currentPage, totalPages: totalPages, totalItems: totalItems })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                {t('inventory_pagination_next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={isDetailSheetOpen} onOpenChange={setIsDetailSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl flex flex-col p-0">
          <SheetHeader className="p-4 sm:p-6 border-b shrink-0">
            <SheetTitle className="text-lg sm:text-xl">{selectedSupplier?.name || t('suppliers_details_title_generic')}</SheetTitle>
            <SheetDescription>
              {t('suppliers_details_desc', { supplierName: selectedSupplier?.name || '' })}
            </SheetDescription>
          </SheetHeader>
          {selectedSupplier && (
            <ScrollArea className="flex-grow">
              <div className="p-4 sm:p-6 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center"><DollarSign className="mr-2 h-4 w-4 text-primary" /> {t('suppliers_total_spending')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-primary">{formatCurrency(selectedSupplier.totalSpent)}</p>
                    <p className="text-xs text-muted-foreground">{t('suppliers_across_orders', { count: selectedSupplier.invoiceCount })}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base flex items-center"><Info className="mr-2 h-4 w-4 text-primary" /> {t('suppliers_contact_info')}</CardTitle>
                    {!isEditingContact && (
                      <Button variant="ghost" size="icon" onClick={() => setIsEditingContact(true)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="text-sm space-y-2">
                    {isEditingContact ? (
                      <>
                        <div>
                          <Label htmlFor="supplierPhone" className="text-xs">{t('suppliers_phone_label')}</Label>
                          <Input
                            id="supplierPhone"
                            type="tel"
                            value={editedContactInfo.phone || ''}
                            onChange={(e) => setEditedContactInfo(prev => ({ ...prev, phone: e.target.value }))}
                            placeholder={t('suppliers_phone_placeholder')}
                            className="h-9 mt-1"
                            disabled={isSavingContact}
                          />
                        </div>
                        <div>
                          <Label htmlFor="supplierEmail" className="text-xs">{t('suppliers_email_label')}</Label>
                          <Input
                            id="supplierEmail"
                            type="email"
                            value={editedContactInfo.email || ''}
                            onChange={(e) => setEditedContactInfo(prev => ({ ...prev, email: e.target.value }))}
                            placeholder={t('suppliers_email_placeholder')}
                            className="h-9 mt-1"
                            disabled={isSavingContact}
                          />
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button size="sm" onClick={() => setIsEditingContact(false)} variant="outline" disabled={isSavingContact}>
                            <X className="mr-1 h-4 w-4" /> {t('cancel_button')}
                          </Button>
                          <Button size="sm" onClick={handleSaveContactInfo} disabled={isSavingContact}>
                            {isSavingContact ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                            {t('suppliers_save_contact_button')}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="flex items-center"><Phone className="mr-2 h-3.5 w-3.5 text-muted-foreground"/> {selectedSupplier.phone || t('suppliers_na')}</p>
                        <p className="flex items-center"><Mail className="mr-2 h-3.5 w-3.5 text-muted-foreground"/> {selectedSupplier.email || t('suppliers_na')}</p>
                      </>
                    )}
                  </CardContent>
                </Card>

                 <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center"><BarChart3 className="mr-2 h-4 w-4 text-primary" /> {t('suppliers_monthly_spending_title')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {monthlySpendingData.length > 0 && monthlySpendingData.some(d => d.total > 0) ? (
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={monthlySpendingData} margin={{ top: 5, right: 0, left: -25, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="month" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis fontSize={10} tickFormatter={(value) => `${t('currency_symbol')}${value/1000}k`} tickLine={false} axisLine={false}/>
                            <RechartsTooltip formatter={(value: number) => [formatCurrency(value), t('suppliers_tooltip_total_spent')]}/>
                            <Legend wrapperStyle={{fontSize: "12px"}}/>
                            <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name={t('suppliers_bar_name_spending')}/>
                            </BarChart>
                        </ResponsiveContainer>
                        ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">{t('suppliers_no_spending_data')}</p>
                        )}
                    </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center"><ListChecks className="mr-2 h-4 w-4 text-primary" /> {t('suppliers_activity_timeline_title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedSupplierInvoices.length > 0 ? (
                      <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                        {selectedSupplierInvoices.slice(0, 10).map((invoice, index) => (
                          <React.Fragment key={invoice.id}>
                            <div className="flex items-start space-x-3">
                              <div className="flex flex-col items-center">
                                <div className={cn("mt-1 h-3 w-3 rounded-full", invoice.status === 'completed' ? 'bg-green-500' : invoice.status === 'error' ? 'bg-destructive' : 'bg-yellow-500')} />
                                {index < selectedSupplierInvoices.slice(0, 10).length - 1 && <div className="h-full w-px bg-border" />}
                              </div>
                              <div className="pb-3 flex-1">
                                <p className="text-xs text-muted-foreground">{formatDate(invoice.uploadTime as string, t, 'PPp')}</p>
                                <p className="text-sm font-medium">
                                  <Button variant="link" className="p-0 h-auto text-sm" onClick={() => navigateToInvoiceDetails(invoice.id)}>
                                    {invoice.fileName} {invoice.invoiceNumber && `(#${invoice.invoiceNumber})`}
                                  </Button>
                                </p>
                                <div className="text-xs text-muted-foreground">
                                  {t('suppliers_invoice_total')}: {formatCurrency(invoice.totalAmount)} - {t('upload_history_col_status')}: {renderStatusBadge(invoice.status, t)}
                                </div>
                              </div>
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">{t('suppliers_no_invoices_found_for_supplier')}</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          )}
          <SheetFooter className="p-4 sm:p-6 border-t shrink-0">
            <SheetClose asChild>
              <Button variant="outline">{t('invoices_close_button')}</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <CreateSupplierSheet
        isOpen={isCreateSheetOpen}
        onOpenChange={setIsCreateSheetOpen}
        onCreateSupplier={handleCreateSupplier}
      />
    </div>
  );
}
