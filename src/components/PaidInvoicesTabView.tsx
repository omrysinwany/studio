// src/components/PaidInvoicesTabView.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardFooter, CardTitle } from '@/components/ui/card';
import { Loader2, Info, CheckSquare, ChevronLeft, ChevronRight, Receipt, Trash2, ImageIcon as ImageIconLucide, ChevronUp, ChevronDown, CreditCard, MailIcon } from 'lucide-react'; // Added MailIcon
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import type { DateRange } from 'react-day-picker';
import { format, parseISO, isValid, isSameDay, isAfter, isBefore } from 'date-fns';
import { enUS, he } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { InvoiceHistoryItem, getInvoicesService, deleteInvoiceService, getUserSettingsService, updateInvoicePaymentStatusService } from '@/services/backend';
import NextImage from 'next/image';
import {
 AlertDialog,
 AlertDialogAction,
 AlertDialogCancel,
 AlertDialogContent as AlertDialogContentComponent,
 AlertDialogDescription as AlertDialogDescriptionComponent,
 AlertDialogFooter as AlertDialogFooterComponent,
 AlertDialogHeader as AlertDialogHeaderComponent,
 AlertDialogTitle as AlertDialogTitleComponent,
 AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { Checkbox } from '@/components/ui/checkbox';
import PaymentReceiptUploadDialog from '@/components/PaymentReceiptUploadDialog';
import { Timestamp } from 'firebase/firestore';
import { Skeleton } from "@/components/ui/skeleton"; // Added Skeleton import

const ITEMS_PER_PAGE_PAID_INVOICES = 8;

const isValidImageSrc = (src: string | undefined | null): src is string => {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://');
};

type SortKeyPaid = keyof Pick<InvoiceHistoryItem, 'originalFileName' | 'uploadTime' | 'supplierName' | 'invoiceDate' | 'totalAmount' | 'paymentMethod'> | 'paymentReceiptImageUri' | '';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';


interface PaidInvoicesTabViewProps {
    filterDocumentType: 'deliveryNote' | 'invoice' | 'paymentReceipt' | '';
    filterSupplier: string;
    dateRange?: DateRange;
    searchTerm: string;
    visibleColumns: Record<string, boolean>;
    columnDefinitions: Array<{ key: string; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean, headerClassName?: string }>;
    handleSort: (key: SortKeyPaid) => void;
    handleViewDetails: (invoice: InvoiceHistoryItem, context?: 'image_only' | 'full_details') => void;
    handleSelectInvoice: (invoiceId: string, checked: boolean) => void;
    selectedInvoiceIds: string[];
    onOpenExportDialog: () => void;
    onTriggerInvoiceFetch: () => void;
    viewMode: ViewMode;
    currentSortKey: SortKeyPaid;
    currentSortDirection: SortDirection;
}


export default function PaidInvoicesTabView({
    filterDocumentType,
    filterSupplier,
    dateRange,
    searchTerm,
    visibleColumns,
    columnDefinitions = [],
    handleSort: parentHandleSort,
    handleViewDetails,
    handleSelectInvoice,
    selectedInvoiceIds,
    onOpenExportDialog,
    onTriggerInvoiceFetch,
    viewMode,
    currentSortKey,
    currentSortDirection,
}: PaidInvoicesTabViewProps) {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useTranslation();
  const [paidInvoices, setPaidInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [currentPage, setCurrentPage] = useState(1);
  
  const [isDeleting, setIsDeleting] = useState(false);
  const [invoiceForReceiptUpload, setInvoiceForReceiptUpload] = useState<InvoiceHistoryItem | null>(null);
  const [showReceiptUploadDialog, setShowReceiptUploadDialog] = useState(false);
  const router = useRouter();
  const { toast } = useToast();


  const formatDateForDisplay = useCallback((dateInput: string | Date | Timestamp | undefined, formatStr: string = 'PPp') => {
    if (!dateInput) return t('invoices_na');
    try {
        let dateObj: Date | null = null;
        if (dateInput instanceof Timestamp) dateObj = dateInput.toDate();
        else if (typeof dateInput === 'string' && isValid(parseISO(dateInput))) dateObj = parseISO(dateInput);
        else if (dateInput instanceof Date && isValid(dateInput)) dateObj = dateInput;

        if (!dateObj || !isValid(dateObj)) {
            console.warn("[PaidInvoicesTabView] Invalid date object for input:", dateInput);
            return t('invoices_invalid_date');
        }
        const dateLocale = locale === 'he' ? he : enUS;
        return window.innerWidth < 640 
            ? format(dateObj, 'dd/MM/yy HH:mm', { locale: dateLocale })
            : format(dateObj, formatStr, { locale: dateLocale });
    } catch (e) {
        console.error("[PaidInvoicesTabView] Error formatting date:", e);
        return t('invoices_invalid_date');
    }
  }, [locale, t]);

  const formatCurrencyDisplay = useCallback((
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
  ): string => {
      const { decimals = 0, useGrouping = true } = options || {};
      if (value === null || value === undefined || isNaN(value)) {
          const zeroFormatted = (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
              useGrouping: useGrouping,
          });
          return `${t('currency_symbol')}${zeroFormatted}`;
      }
      const formattedValue = value.toLocaleString(t('locale_code_for_number_formatting') || undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: useGrouping,
      });
      return `${t('currency_symbol')}${formattedValue}`;
  }, [t]);


  const fetchPaidInvoices = useCallback(async () => {
      if (!user?.id) {
          setPaidInvoices([]);
          setIsLoading(false);
          return;
      }
      setIsLoading(true);
      try {
        let fetchedData = await getInvoicesService(user.id);
        fetchedData = fetchedData.filter(inv => inv.paymentStatus === 'paid' && inv.status === 'completed');

        if (filterDocumentType) {
           fetchedData = fetchedData.filter(inv => inv.documentType === filterDocumentType);
        }
        if (filterSupplier) {
           fetchedData = fetchedData.filter(inv => inv.supplierName === filterSupplier);
        }
        if (dateRange?.from) {
            const startDate = new Date(dateRange.from); 
            startDate.setHours(0,0,0,0);
            fetchedData = fetchedData.filter(inv => {
                let invDate: Date | null = null;
                if(inv.invoiceDate){
                    if(inv.invoiceDate instanceof Timestamp) invDate = inv.invoiceDate.toDate();
                    else if (typeof inv.invoiceDate === 'string' && isValid(parseISO(inv.invoiceDate))) invDate = parseISO(inv.invoiceDate);
                    else if (inv.invoiceDate instanceof Date && isValid(inv.invoiceDate)) invDate = inv.invoiceDate;
                } else if (inv.uploadTime) {
                    if(inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
                    else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
                     else if (inv.uploadTime instanceof Date && isValid(inv.uploadTime)) invDate = inv.uploadTime;
                }
                return invDate ? isAfter(invDate, startDate) || isSameDay(invDate, startDate) : false;
            });
        }
        if (dateRange?.to) {
            const endDate = new Date(dateRange.to); 
            endDate.setHours(23,59,59,999);
            fetchedData = fetchedData.filter(inv => {
                let invDate: Date | null = null;
                 if(inv.invoiceDate){
                    if(inv.invoiceDate instanceof Timestamp) invDate = inv.invoiceDate.toDate();
                    else if (typeof inv.invoiceDate === 'string' && isValid(parseISO(inv.invoiceDate))) invDate = parseISO(inv.invoiceDate);
                    else if (inv.invoiceDate instanceof Date && isValid(inv.invoiceDate)) invDate = inv.invoiceDate;
                } else if (inv.uploadTime) {
                     if(inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
                    else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
                    else if (inv.uploadTime instanceof Date && isValid(inv.uploadTime)) invDate = inv.uploadTime;
                }
                return invDate ? isBefore(invDate, endDate) || isSameDay(invDate, endDate) : false;
            });
        }
        if (searchTerm) {
          const lowerSearchTerm = searchTerm.toLowerCase();
          fetchedData = fetchedData.filter(item =>
            (item.originalFileName || item.generatedFileName || '').toLowerCase().includes(lowerSearchTerm) ||
            (item.invoiceNumber && item.invoiceNumber.toLowerCase().includes(lowerSearchTerm)) ||
            (item.supplierName && item.supplierName.toLowerCase().includes(lowerSearchTerm))
          );
        }

        if (currentSortKey) {
             fetchedData.sort((a, b) => {
                 const valA = a[currentSortKey as keyof InvoiceHistoryItem];
                 const valB = b[currentSortKey as keyof InvoiceHistoryItem];
                 let comparison = 0;

                if (currentSortKey === 'uploadTime' || currentSortKey === 'invoiceDate') {
                    let dateA = 0; let dateB = 0;
                    const aDateVal = valA; const bDateVal = valB;
                    if (aDateVal) { if (aDateVal instanceof Timestamp) dateA = aDateVal.toDate().getTime(); else if (typeof aDateVal === 'string' && isValid(parseISO(aDateVal))) dateA = parseISO(aDateVal).getTime(); else if (aDateVal instanceof Date && isValid(aDateVal)) dateA = aDateVal.getTime(); }
                    if (bDateVal) { if (bDateVal instanceof Timestamp) dateB = bDateVal.toDate().getTime(); else if (typeof bDateVal === 'string' && isValid(parseISO(bDateVal))) dateB = parseISO(bDateVal).getTime(); else if (bDateVal instanceof Date && isValid(bDateVal)) dateB = bDateVal.getTime(); }
                    comparison = dateA - dateB;
                 } else if (typeof valA === 'number' && typeof valB === 'number') {
                     comparison = valA - valB;
                 } else if (typeof valA === 'string' && typeof valB === 'string') {
                     comparison = (valA || "").localeCompare(valB || "", locale);
                 } else {
                    if ((valA === undefined || valA === null) && (valB !== undefined && valB !== null)) comparison = 1;
                    else if ((valA !== undefined && valA !== null) && (valB === undefined || valB === null)) comparison = -1;
                    else comparison = 0;
                 }
                 return currentSortDirection === 'asc' ? comparison : comparison * -1;
             });
         }
        setPaidInvoices(fetchedData);
      } catch (error) {
        console.error("Failed to fetch paid invoices:", error);
        toast({
          title: t('invoices_toast_error_fetch_invoices_title'),
          description: t('invoices_toast_error_fetch_invoices_desc'),
          variant: "destructive",
        });
        setPaidInvoices([]);
      } finally {
        setIsLoading(false);
      }
    }, [user, filterDocumentType, filterSupplier, dateRange, searchTerm, currentSortKey, currentSortDirection, toast, t, locale]);

  useEffect(() => {
    if (user?.id) {
      fetchPaidInvoices();
    } else if (!authLoading) {
        setPaidInvoices([]);
        setIsLoading(false);
    }
  }, [user, authLoading, fetchPaidInvoices, onTriggerInvoiceFetch]);

  const totalPaidInvoicesPages = useMemo(() => {
      return Math.ceil(paidInvoices.length / ITEMS_PER_PAGE_PAID_INVOICES);
  }, [paidInvoices]);

  const displayedPaidInvoices = useMemo(() => {
      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE_PAID_INVOICES;
      return paidInvoices.slice(startIndex, startIndex + ITEMS_PER_PAGE_PAID_INVOICES);
  }, [paidInvoices, currentPage]);

  const handlePageChange = (newPage: number) => {
      if (newPage >= 1 && newPage <= totalPaidInvoicesPages) {
          setCurrentPage(newPage);
      }
  };

  const handlePaymentReceiptUploaded = async (invoiceId: string, receiptUri: string) => {
    if (!invoiceForReceiptUpload || !user?.id || invoiceForReceiptUpload.id !== invoiceId) return;
    setShowReceiptUploadDialog(false);
    setInvoiceForReceiptUpload(null);
    
    try {
        await updateInvoicePaymentStatusService(invoiceId, 'paid', user.id, receiptUri);
        toast({ title: t('paid_invoices_toast_receipt_uploaded_title'), description: t('paid_invoices_toast_receipt_uploaded_desc', { fileName: paidInvoices.find(inv => inv.id === invoiceId)?.originalFileName || 'Invoice' }) });
        fetchPaidInvoices(); 
        onTriggerInvoiceFetch(); 
    } catch (error) {
        console.error("Error updating invoice with new receipt:", error);
        toast({ title: t('error_title'), description: t('toast_invoice_payment_status_update_fail_desc'), variant: "destructive" });
    }
  };

  const visibleColumnHeadersPaid = useMemo(() => {
    if (!columnDefinitions) return [];
    return columnDefinitions.filter(h => visibleColumns[h.key as keyof typeof visibleColumns]);
  }, [columnDefinitions, visibleColumns]);


  return (
    <>
        {viewMode === 'list' ? (
          <div className="overflow-x-auto relative">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow>
                  {visibleColumnHeadersPaid.map((header) => (
                    <TableHead
                      key={header.key}
                      className={cn(
                          "text-center", 
                          header.className,
                          header.sortable && "cursor-pointer hover:bg-muted/50",
                          header.mobileHidden && "hidden sm:table-cell", 
                          'px-2 sm:px-4 py-2',
                           header.key === 'actions' ? 'sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10' : (header.key === 'selection' ? 'sticky left-0 bg-card z-20' : '')
                      )}
                      onClick={() => header.sortable && parentHandleSort(header.key as SortKeyPaid)}
                      aria-sort={header.sortable ? (currentSortKey === header.key ? (currentSortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                    >
                      <div className="flex items-center gap-1 whitespace-nowrap justify-center">
                         {header.key === 'selection' ? (
                              <Checkbox
                                  checked={selectedInvoiceIds.length > 0 && selectedInvoiceIds.length === paidInvoices.length && paidInvoices.length > 0}
                                  onCheckedChange={(checked) => handleSelectInvoice('all-paid', !!checked)}
                                  aria-label={t('invoice_export_select_all_aria')}
                                  className="mx-auto"
                              />
                         ) : (
                          t(header.labelKey as any, { currency_symbol: t('currency_symbol') })
                         )}
                         {header.sortable && currentSortKey === header.key && (
                            <span className="text-xs" aria-hidden="true">
                               {currentSortDirection === 'asc' ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />}
                            </span>
                         )}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumnHeadersPaid.length} className="h-24 text-center px-2 sm:px-4 py-2">
                      <div className="flex justify-center items-center">
                         <Loader2 className="h-6 w-6 animate-spin text-primary" />
                         <span className="ml-2">{t('invoices_loading')}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : displayedPaidInvoices.length === 0 ? (
                  <TableRow>
                     <TableCell colSpan={visibleColumnHeadersPaid.length} className="h-24 text-center px-2 sm:px-4 py-2">
                       {t('paid_invoices_no_paid_invoices_found')}
                     </TableCell>
                  </TableRow>
                ) : (
                  displayedPaidInvoices.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/50" data-testid={`paid-invoice-item-${item.id}`}>
                        {visibleColumns.selection && (
                           <TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-0 bg-card z-20", columnDefinitions.find(h => h.key === 'selection')?.className)}>
                              <Checkbox
                                checked={selectedInvoiceIds.includes(item.id)}
                                onCheckedChange={(checked) => handleSelectInvoice(item.id, !!checked)}
                                aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || item.generatedFileName || ''})}
                              />
                           </TableCell>
                        )}
                        {visibleColumns.actions && (
                           <TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10", columnDefinitions.find(h => h.key === 'actions')?.className)}>
                               <Button
                                   variant="ghost"
                                   size="icon"
                                   className="text-primary hover:text-primary/80 h-7 w-7"
                                   onClick={() => handleViewDetails(item, 'full_details')}
                                   title={t('invoices_view_details_title', { fileName: item.originalFileName || item.generatedFileName || '' })}
                               >
                                   <Info className="h-4 w-4" />
                               </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-blue-600 hover:text-blue-500 h-7 w-7"
                                    onClick={() => { setInvoiceForReceiptUpload(item); setShowReceiptUploadDialog(true); }}
                                    title={t('paid_invoices_update_receipt_button')}
                                >
                                    <Receipt className="h-4 w-4" />
                                </Button>
                           </TableCell>
                       )}
                       {visibleColumns.originalFileName && (
                          <TableCell className={cn("font-medium px-2 sm:px-4 py-2", columnDefinitions.find(h => h.key === 'originalFileName')?.className)}>
                             <Button
                                variant="link"
                                className="p-0 h-auto text-left font-medium cursor-pointer hover:underline truncate"
                                onClick={() => handleViewDetails(item, 'image_only')}
                                title={t('invoices_view_details_title', { fileName: item.originalFileName || item.generatedFileName || ''})}
                              >
                                {item.originalFileName || item.generatedFileName}
                            </Button>
                          </TableCell>
                       )}
                       {visibleColumns.uploadTime && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'uploadTime')?.mobileHidden && 'hidden sm:table-cell')}>{formatDateForDisplay(item.uploadTime)}</TableCell>}
                       {visibleColumns.invoiceDate && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'invoiceDate')?.mobileHidden && 'hidden sm:table-cell')}>{item.invoiceDate ? formatDateForDisplay(item.invoiceDate, 'PP') : t('invoices_na')}</TableCell>}
                       {visibleColumns.supplierName && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'supplierName')?.mobileHidden && 'hidden sm:table-cell')}>{item.supplierName || t('invoices_na')}</TableCell>}
                       {visibleColumns.totalAmount && (
                         <TableCell className="text-right px-2 sm:px-4 py-2 whitespace-nowrap">
                            {item.totalAmount !== undefined && item.totalAmount !== null ? formatCurrencyDisplay(item.totalAmount, {decimals:0}) : t('invoices_na')}
                         </TableCell>
                       )}
                       {visibleColumns.paymentMethod && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'paymentMethod')?.mobileHidden && 'hidden sm:table-cell')}>{item.paymentMethod ? t(`payment_method_${item.paymentMethod.toLowerCase().replace(/\s+/g, '_')}` as any, {defaultValue: item.paymentMethod}) : t('invoices_na')}</TableCell>}
                       {visibleColumns.paymentReceiptImageUri && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'paymentReceiptImageUri')?.mobileHidden && 'hidden sm:table-cell')}>{ item.paymentReceiptImageUri ? <Button variant="link" size="sm" onClick={() => handleViewDetails(item, 'image_only')} className="p-0 h-auto text-xs">{t('paid_invoices_view_receipt_link')}</Button> : t('invoices_na')}</TableCell>}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
             {totalPaidInvoicesPages > 1 && (
                <div className="flex items-center justify-end space-x-2 py-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                    >
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">{t('inventory_pagination_previous')}</span>
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        {t('inventory_pagination_page_info_simple', { currentPage: currentPage, totalPages: totalPaidInvoicesPages})}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPaidInvoicesPages}
                    >
                         <span className="sr-only">{t('inventory_pagination_next')}</span>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2 sm:gap-4" style={{ gridAutoRows: 'minmax(150px, auto)' }}>
            {isLoading ? (
               Array.from({ length: ITEMS_PER_PAGE_PAID_INVOICES }).map((_, index) => (
                  <Card key={index} className="animate-pulse">
                      <CardHeader className="p-0 relative aspect-[4/3] bg-muted rounded-t-lg" />
                      <CardContent className="p-3 space-y-1">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                          <Skeleton className="h-3 w-1/4" />
                      </CardContent>
                       <CardFooter className="p-3 border-t flex gap-1">
                            <Skeleton className="h-8 w-1/2" />
                            <Skeleton className="h-8 w-1/2" />
                        </CardFooter>
                  </Card>
               ))
            ) : displayedPaidInvoices.length === 0 ? (
              <p className="col-span-full text-center text-muted-foreground py-10">{t('paid_invoices_no_paid_invoices_found')}</p>
            ) : (
              displayedPaidInvoices.map((item) => (
                <Card key={item.id} className="flex flex-col overflow-hidden cursor-pointer hover:shadow-lg transition-shadow scale-fade-in">
                  <div className="p-2 absolute top-0 left-0 z-10">
                       <Checkbox
                          checked={selectedInvoiceIds.includes(item.id)}
                          onCheckedChange={(checked) => handleSelectInvoice(item.id, !!checked)}
                          aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || item.generatedFileName || ''})}
                          className="bg-background/70 hover:bg-background border-primary"
                      />
                  </div>
                  <CardHeader className="p-0 relative aspect-[4/3]" onClick={() => handleViewDetails(item, 'image_only')}>
                    {isValidImageSrc(item.paymentReceiptImageUri || item.originalImagePreviewUri) ? (
                      <NextImage
                        src={item.paymentReceiptImageUri || item.originalImagePreviewUri!} 
                        alt={t('paid_invoices_receipt_image_alt', { fileName: item.originalFileName || item.generatedFileName || '' })}
                        layout="fill"
                        objectFit="cover"
                        className="rounded-t-lg"
                        data-ai-hint="payment receipt document"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted rounded-t-lg flex items-center justify-center">
                        <Receipt className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                     <div className="absolute top-2 right-2 flex flex-col gap-1">
                         <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80 text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5">
                            <CreditCard className="mr-1 h-3 w-3" />{t('invoice_payment_status_paid')}
                         </Badge>
                     </div>
                  </CardHeader>
                  <CardContent className="p-3 flex-grow" onClick={() => handleViewDetails(item, 'full_details')}>
                    <CardTitle className="text-sm font-semibold truncate" title={item.originalFileName || item.generatedFileName}>{item.originalFileName || item.generatedFileName}</CardTitle>
                    <p className="text-xs text-muted-foreground">{formatDateForDisplay(item.uploadTime)}</p>
                     {item.supplierName && <p className="text-xs text-muted-foreground">{t('invoice_details_supplier_label')}: {item.supplierName}</p>}
                     {item.totalAmount !== undefined && <p className="text-xs font-medium">{t('invoices_col_total')}: {formatCurrencyDisplay(item.totalAmount, {decimals:0})}</p>}
                  </CardContent>
                   <CardFooter className="p-3 border-t flex gap-1">
                      <Button variant="ghost" size="sm" className="flex-1 justify-start text-xs" onClick={(e) => { e.stopPropagation(); handleViewDetails(item, 'full_details'); }}><Info className="mr-1.5 h-3.5 w-3.5"/> {t('invoices_view_details_button')}</Button>
                       <Button variant="ghost" size="sm" className="flex-1 justify-start text-xs text-blue-600 hover:text-blue-500" onClick={(e) => { e.stopPropagation(); setInvoiceForReceiptUpload(item); setShowReceiptUploadDialog(true);}}><Receipt className="mr-1.5 h-3.5 w-3.5"/> {t('paid_invoices_update_receipt_button')}</Button>
                   </CardFooter>
                </Card>
              ))
            )}
          </div>
        )}
         {viewMode === 'grid' && totalPaidInvoicesPages > 1 && (
            <div className="flex items-center justify-end space-x-2 py-4 mt-4">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="sr-only">{t('inventory_pagination_previous')}</span>
                </Button>
                <span className="text-sm text-muted-foreground">
                    {t('inventory_pagination_page_info_simple', { currentPage: currentPage, totalPages: totalPaidInvoicesPages})}
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPaidInvoicesPages}
                >
                     <span className="sr-only">{t('inventory_pagination_next')}</span>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        )}
        {selectedInvoiceIds.length > 0 && (
             <div className="mt-4 flex flex-col sm:flex-row justify-end gap-2">
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="w-full sm:w-auto">
                            <Trash2 className="mr-2 h-4 w-4"/>
                            {t('invoices_bulk_delete_button', {count: selectedInvoiceIds.length})}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContentComponent>
                        <AlertDialogHeaderComponent>
                            <AlertDialogTitleComponent>{t('invoices_delete_confirm_title')}</AlertDialogTitleComponent>
                            <AlertDialogDescriptionComponent>{t('invoices_delete_confirm_desc', {fileName: `${selectedInvoiceIds.length} ${t('documents_plural_for_delete_message')}`})}</AlertDialogDescriptionComponent>
                        </AlertDialogHeaderComponent>
                        <AlertDialogFooterComponent>
                            <AlertDialogCancel>{t('cancel_button')}</AlertDialogCancel>
                            <AlertDialogAction 
                                onClick={async () => {
                                    if(!user?.id) return;
                                    setIsDeleting(true);
                                    try {
                                        for (const id of selectedInvoiceIds) {
                                            await deleteInvoiceService(id, user.id);
                                        }
                                        toast({ title: t('invoices_toast_bulk_deleted_title'), description: t('invoices_toast_bulk_deleted_desc', { count: selectedInvoiceIds.length }) });
                                        fetchPaidInvoices();
                                        onTriggerInvoiceFetch();
                                        handleSelectInvoice('all-paid', false); // Deselect all
                                    } catch (error) {
                                        toast({ title: t('invoices_toast_delete_fail_title'), description: t('invoices_toast_delete_fail_desc'), variant: "destructive" });
                                    } finally {
                                        setIsDeleting(false);
                                    }
                                }} 
                                className={buttonVariants({variant: "destructive"})}
                                disabled={isDeleting}
                            >
                                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                {t('invoices_delete_confirm_action')}
                            </AlertDialogAction>
                        </AlertDialogFooterComponent>
                    </AlertDialogContentComponent>
                </AlertDialog>
                 <Button
                      onClick={onOpenExportDialog} // Changed to call parent's handler
                      disabled={false} // Parent will handle isExporting state
                      className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                  >
                      <MailIcon className="mr-2 h-4 w-4" /> {/* Changed icon to MailIcon */}
                      {t('invoice_export_selected_button')}
                  </Button>
            </div>
        )}

    {showReceiptUploadDialog && invoiceForReceiptUpload && (
        <PaymentReceiptUploadDialog
            isOpen={showReceiptUploadDialog}
            onOpenChange={(isOpen) => { setShowReceiptUploadDialog(isOpen); if (!isOpen) setInvoiceForReceiptUpload(null); }}
            invoiceFileName={invoiceForReceiptUpload.originalFileName || invoiceForReceiptUpload.generatedFileName || ''}
            onConfirmUpload={async (receiptUri) => {
                await handlePaymentReceiptUploaded(invoiceForReceiptUpload.id, receiptUri);
            }}
        />
    )}
    </>
  );
}
