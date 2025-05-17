
// src/app/invoices/page.tsx
'use client';

 import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
 import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
 import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
 } from '@/components/ui/table';
 import {
   DropdownMenu,
   DropdownMenuCheckboxItem,
   DropdownMenuContent,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
   DropdownMenuSub,
   DropdownMenuSubTrigger,
   DropdownMenuSubContent,
   DropdownMenuPortal,
 } from '@/components/ui/dropdown-menu';
 import { Card, CardContent, CardDescription, CardHeader, CardFooter, CardTitle } from '@/components/ui/card';
 import { Search, Filter, ChevronDown, Loader2, XCircle, Clock, Info, Download, Trash2, Edit, Save, ListChecks, Grid, Receipt, Eye, FileText as FileTextIconLucide, ImageIcon as ImageIconLucide, CalendarDays, ListFilter, Columns, CreditCard, Briefcase, CheckCircle, Mail as MailIcon, CheckSquare, PlusCircle } from 'lucide-react';
 import { useRouter, useSearchParams } from 'next/navigation';
 import { useToast } from '@/hooks/use-toast';
 import type { DateRange } from 'react-day-picker';
 import { Calendar } from '@/components/ui/calendar';
 import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
 import { Timestamp } from 'firebase/firestore';
 import { format, parseISO, subDays, startOfMonth, endOfMonth, isValid } from 'date-fns';
 import { enUS, he } from 'date-fns/locale';
 import { cn } from '@/lib/utils';
 import { Calendar as CalendarIcon } from 'lucide-react';
 import { InvoiceHistoryItem, getInvoicesService, deleteInvoiceService, updateInvoiceService, SupplierSummary, getSupplierSummariesService, getUserSettingsService, updateInvoicePaymentStatusService, DOCUMENTS_COLLECTION, INVENTORY_COLLECTION, SUPPLIERS_COLLECTION, OTHER_EXPENSES_COLLECTION, EXPENSE_CATEGORIES_COLLECTION, USER_SETTINGS_COLLECTION } from '@/services/backend';
 import { Badge } from '@/components/ui/badge';
 import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
    SheetClose,
} from '@/components/ui/sheet';
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
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { Checkbox } from '@/components/ui/checkbox';
import { generateAndEmailInvoicesAction } from '@/actions/invoice-export-actions';
import PaymentReceiptUploadDialog from '@/components/PaymentReceiptUploadDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from '@/hooks/use-mobile';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from "@/components/ui/skeleton";
import { db } from '@/lib/firebase'; // Ensure db is imported for any direct Firestore operations if needed


const isValidImageSrc = (src: string | undefined | null): src is string => {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/') || src.startsWith('blob:');
};

type ViewMode = 'grid' | 'list';

const ITEMS_PER_PAGE_SCANNED_DOCS = 8;
const ITEMS_PER_PAGE_PAID_INVOICES = 8;


const formatDateForDisplay = (dateInput: string | Date | Timestamp | undefined, currentLocale: string, t: (key: string, params?: any) => string): string => {
  if (!dateInput) return t('invoices_na');
  try {
      let dateObj: Date | null = null;
      if (dateInput instanceof Timestamp) {
          dateObj = dateInput.toDate();
      } else if (typeof dateInput === 'string') {
          const parsed = parseISO(dateInput);
          if (isValid(parsed)) dateObj = parsed;
      } else if (dateInput instanceof Date && isValid(dateInput)) {
          dateObj = dateInput;
      }

      if (!dateObj || !isValid(dateObj)) {
          console.warn(`[DocumentsPage formatDateForDisplay] Invalid date object for input:`, dateInput);
          return t('invoices_invalid_date');
      }
      const dateFnsLocale = currentLocale === 'he' ? he : enUS;
      return window.innerWidth < 640
           ? format(dateObj, 'dd/MM/yy HH:mm', { locale: dateFnsLocale })
           : format(dateObj, 'PPp', { locale: dateFnsLocale });
  } catch (e) {
    console.error("[DocumentsPage formatDateForDisplay] Error formatting date:", e, "Input:", dateInput);
    return t('invoices_invalid_date');
  }
};

const formatCurrencyDisplay = (
  value: number | undefined | null,
  t: (key: string, params?: Record<string, string | number>) => string,
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
};


// --- ScannedDocsView Component (Integrated into DocumentsPage) ---
function ScannedDocsView({
    invoices,
    isLoading,
    sortKey,
    sortDirection,
    onSort,
    onViewDetails,
    onSelectInvoice,
    selectedInvoiceIds,
    viewMode,
    currentPage,
    totalPages,
    onPageChange,
    parentVisibleColumns,
    parentColumnDefinitions,
    onMarkAsPaid,
    onEdit,
}: {
    invoices: InvoiceHistoryItem[];
    isLoading: boolean;
    sortKey: string;
    sortDirection: string;
    onSort: (key: string) => void;
    onViewDetails: (invoice: InvoiceHistoryItem, context?: 'image_only' | 'full_details') => void;
    onSelectInvoice: (id: string, checked: boolean) => void;
    selectedInvoiceIds: string[];
    viewMode: ViewMode;
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    parentVisibleColumns: Record<string, boolean>;
    parentColumnDefinitions: { key: string; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean }[];
    onMarkAsPaid: (invoice: InvoiceHistoryItem) => void;
    onEdit: (invoiceId: string, docType: 'deliveryNote' | 'invoice', fileName: string) => void;
}) {
    const { t, locale } = useTranslation();
    const router = useRouter();
    const visibleColumnHeaders = parentColumnDefinitions.filter(h => parentVisibleColumns[h.key]);

     const renderScanStatusBadge = (status: InvoiceHistoryItem['status'], t: (key: string, params?: any) => string) => {
        let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
        let className = '';
        let icon = null;
        let labelKey = '';

       switch (status as InvoiceHistoryItem['status']) {
           case 'completed': variant = 'secondary'; className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80'; icon = <CheckCircle className="mr-1 h-3 w-3" />; labelKey = 'invoice_status_completed'; break;
           case 'processing': variant = 'secondary'; className = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse hover:bg-blue-100/80'; icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />; labelKey = 'invoice_status_processing'; break;
           case 'pending': variant = 'secondary'; className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80'; icon = <Clock className="mr-1 h-3 w-3" />; labelKey = 'invoice_status_pending'; break;
           case 'error': variant = 'destructive'; icon = <XCircle className="mr-1 h-3 w-3" />; labelKey = 'invoice_status_error'; break;
           default: variant = 'outline'; icon = null; labelKey = String(status); break;
       }
        return (
           <Badge variant={variant} className={cn("text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5", className)}>
               {icon}
               {t(labelKey as any) || (typeof status === 'string' ? status.charAt(0).toUpperCase() + status.slice(1) : '')}
           </Badge>
        );
     };
     const renderPaymentStatusBadge = (status: InvoiceHistoryItem['paymentStatus'], t: (key: string, params?: any) => string) => {
        let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
        let className = '';
        let icon = null;
        let labelKey = '';
        switch (status as InvoiceHistoryItem['paymentStatus']) {
           case 'paid': variant = 'secondary'; className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80'; icon = <CreditCard className="mr-1 h-3 w-3" />; labelKey = 'invoice_payment_status_paid'; break;
           case 'unpaid': variant = 'secondary'; className = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-100/80'; icon = <CreditCard className="mr-1 h-3 w-3" />; labelKey = 'invoice_payment_status_unpaid'; break;
           case 'pending_payment': variant = 'secondary'; className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80'; icon = <Clock className="mr-1 h-3 w-3" />; labelKey = 'invoice_payment_status_pending_payment'; break;
           default: variant = 'outline'; icon = null; labelKey = String(status);
        }
        return (
           <Badge variant={variant} className={cn("text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5", className)}>
               {icon}
               {t(labelKey as any) || (typeof status === 'string' ? status.charAt(0).toUpperCase() + status.slice(1) : '')}
           </Badge>
        );
     };


    return (
        <>
            {viewMode === 'list' ? (
                <div className="overflow-x-auto relative">
                    <Table className="min-w-[600px]">
                        <TableHeader>
                            <TableRow>
                                {visibleColumnHeaders.map((header) => (
                                    <TableHead key={header.key} className={cn(header.className, header.sortable && "cursor-pointer hover:bg-muted/50", header.mobileHidden ? 'hidden sm:table-cell' : 'table-cell', 'px-2 sm:px-4 py-2', header.key === 'actions' ? 'sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10' : (header.key === 'selection' ? 'sticky left-0 bg-card z-20' : ''))}
                                        onClick={() => header.sortable && onSort(header.key as string)}
                                        aria-sort={header.sortable ? (sortKey === header.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
                                        <div className="flex items-center gap-1 whitespace-nowrap">
                                            {header.key === 'selection' ? (<Checkbox checked={selectedInvoiceIds.length > 0 && selectedInvoiceIds.length === invoices.length && invoices.length > 0} onCheckedChange={(checked) => { if (checked) { onSelectInvoice('all', true); } else { onSelectInvoice('all', false); } }} aria-label={t('invoice_export_select_all_aria')} className="mx-auto" />)
                                                : (t(header.labelKey as any, { currency_symbol: t('currency_symbol') }))}
                                            {header.sortable && sortKey === header.key && (<span className="text-xs" aria-hidden="true">{sortDirection === 'asc' ? '▲' : '▼'}</span>)}
                                        </div>
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center px-2 sm:px-4 py-2"><div className="flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /><span className="ml-2">{t('invoices_loading')}</span></div></TableCell></TableRow>)
                                : invoices.length === 0 ? (<TableRow><TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center px-2 sm:px-4 py-2">{t('invoices_no_invoices_found')}</TableCell></TableRow>)
                                    : (invoices.map((item: InvoiceHistoryItem) => (
                                        <TableRow key={item.id} className="hover:bg-muted/50" data-testid={`invoice-item-${item.id}`}>
                                            {parentVisibleColumns.selection && (<TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-0 bg-card z-20", parentColumnDefinitions.find(h => h.key === 'selection')?.className)}><Checkbox checked={selectedInvoiceIds.includes(item.id)} onCheckedChange={(checked) => onSelectInvoice(item.id, !!checked)} aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || item.generatedFileName || '' })} /></TableCell>)}
                                            {parentVisibleColumns.actions && (<TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10", parentColumnDefinitions.find(h => h.key === 'actions')?.className)}><Button variant="ghost" size="icon" className="text-primary hover:text-primary/80 h-7 w-7" onClick={() => onViewDetails(item)} title={t('invoices_view_details_title', { fileName: item.originalFileName || item.generatedFileName || '' })} aria-label={t('invoices_view_details_aria', { fileName: item.originalFileName || item.generatedFileName || '' })}><Info className="h-4 w-4" /></Button></TableCell>)}
                                            {parentVisibleColumns.originalFileName && (<TableCell className={cn("font-medium px-2 sm:px-4 py-2", parentColumnDefinitions.find(h => h.key === 'originalFileName')?.className)}><Button variant="link" className="p-0 h-auto text-left font-medium text-foreground hover:text-primary truncate" onClick={() => onViewDetails(item, 'image_only')} title={t('upload_history_view_image_title', { fileName: item.originalFileName || item.generatedFileName || '' })}><ImageIconLucide className="inline-block mr-1.5 h-3.5 w-3.5 text-muted-foreground" />{item.generatedFileName || item.originalFileName}</Button></TableCell>)}
                                            {parentVisibleColumns.uploadTime && <TableCell className={cn('px-2 sm:px-4 py-2', parentColumnDefinitions.find(h => h.key === 'uploadTime')?.mobileHidden && 'hidden sm:table-cell')}>{formatDateForDisplay(item.uploadTime, locale, t)}</TableCell>}
                                            {parentVisibleColumns.status && (<TableCell className="px-2 sm:px-4 py-2">{renderScanStatusBadge(item.status, t)}</TableCell>)}
                                            {parentVisibleColumns.paymentStatus && (<TableCell className="px-2 sm:px-4 py-2">{renderPaymentStatusBadge(item.paymentStatus, t)}</TableCell>)}
                                            {parentVisibleColumns.paymentDueDate && <TableCell className={cn('px-2 sm:px-4 py-2', parentColumnDefinitions.find(h => h.key === 'paymentDueDate')?.mobileHidden && 'hidden sm:table-cell')}>{item.paymentDueDate ? formatDateForDisplay(item.paymentDueDate, locale, t) : t('invoices_na')}</TableCell>}
                                            {parentVisibleColumns.invoiceNumber && <TableCell className={cn('px-2 sm:px-4 py-2', parentColumnDefinitions.find(h => h.key === 'invoiceNumber')?.mobileHidden && 'hidden sm:table-cell')}>{item.invoiceNumber || t('invoices_na')}</TableCell>)}
                                            {parentVisibleColumns.supplierName && <TableCell className={cn('px-2 sm:px-4 py-2', parentColumnDefinitions.find(h => h.key === 'supplierName')?.mobileHidden && 'hidden sm:table-cell')}>{item.supplierName || t('invoices_na')}</TableCell>)}
                                            {parentVisibleColumns.totalAmount && (<TableCell className="text-right px-2 sm:px-4 py-2 whitespace-nowrap">{item.totalAmount !== undefined && item.totalAmount !== null ? formatCurrencyDisplay(item.totalAmount, t) : t('invoices_na')}</TableCell>)}
                                            {parentVisibleColumns.errorMessage && (<TableCell className={cn('px-2 sm:px-4 py-2', parentColumnDefinitions.find(h => h.key === 'errorMessage')?.className)}>{item.status === 'error' ? item.errorMessage : t('invoices_na')}</TableCell>)}
                                        </TableRow>
                                    )))}
                        </TableBody>
                    </Table>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" style={{ gridAutoRows: 'minmax(150px, auto)' }}>
                    {isLoading ? (Array.from({ length: ITEMS_PER_PAGE_SCANNED_DOCS }).map((_, index) => (<Card key={index} className="animate-pulse"><CardHeader className="p-0 relative aspect-[4/3] bg-muted rounded-t-lg" /><CardContent className="p-3 space-y-1"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-1/4" /></CardContent><CardFooter className="p-3 border-t"><Skeleton className="h-7 w-full" /></CardFooter></Card>)))
                        : invoices.length === 0 ? (<p className="col-span-full text-center text-muted-foreground py-10">{t('invoices_no_invoices_found')}</p>)
                            : (invoices.map((item: InvoiceHistoryItem) => (
                                <Card key={item.id} className="flex flex-col overflow-hidden cursor-pointer hover:shadow-lg transition-shadow scale-fade-in">
                                    <div className="p-2 absolute top-0 left-0 z-10"><Checkbox checked={selectedInvoiceIds.includes(item.id)} onCheckedChange={(checked) => onSelectInvoice(item.id, !!checked)} aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || item.generatedFileName || '' })} className="bg-background/70 hover:bg-background border-primary" /></div>
                                    <CardHeader className="p-0 relative aspect-[4/3]" onClick={() => onViewDetails(item, 'image_only')}>
                                        {isValidImageSrc(item.originalImagePreviewUri || item.compressedImageForFinalRecordUri) ? (<NextImage src={item.originalImagePreviewUri || item.compressedImageForFinalRecordUri!} alt={t('invoices_preview_alt', { fileName: item.originalFileName || item.generatedFileName || '' })} layout="fill" objectFit="cover" className="rounded-t-lg" data-ai-hint="invoice document" />)
                                            : (<div className="w-full h-full bg-muted rounded-t-lg flex items-center justify-center">{item.documentType === 'invoice' ? <FileTextIconLucide className="h-12 w-12 text-blue-500/50" /> : <FileTextIconLucide className="h-12 w-12 text-green-500/50" />}</div>)}
                                        <div className="absolute top-2 right-2 flex flex-col gap-1">{renderScanStatusBadge(item.status, t)}{renderPaymentStatusBadge(item.paymentStatus, t)}</div>
                                        {item.status === 'error' && item.errorMessage && (
                                            <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-destructive/80 text-destructive-foreground text-[9px] text-center truncate" title={item.errorMessage}>
                                                {t('invoice_status_error')}: {item.errorMessage.substring(0,35)}{item.errorMessage.length > 35 ? '...' : ''}
                                            </div>
                                        )}
                                    </CardHeader>
                                    <CardContent className="p-3 flex-grow" onClick={() => onViewDetails(item)}>
                                        <CardTitle className="text-sm font-semibold truncate" title={item.generatedFileName || item.originalFileName}>
                                         {item.documentType === 'invoice' ? <FileTextIconLucide className="inline-block mr-1.5 h-3.5 w-3.5 text-blue-500" /> : <FileTextIconLucide className="inline-block mr-1.5 h-3.5 w-3.5 text-green-500" />}
                                         {item.generatedFileName || item.originalFileName}
                                        </CardTitle>
                                        <p className="text-xs text-muted-foreground">{t('invoice_details_upload_time_label')}: {formatDateForDisplay(item.uploadTime, locale, t)}</p>
                                        {item.supplierName && <p className="text-xs text-muted-foreground">{t('invoice_details_supplier_label')}: {item.supplierName}</p>}
                                        {item.invoiceNumber && <p className="text-xs text-muted-foreground">{t('invoice_details_invoice_number_label')}: {item.invoiceNumber}</p>}
                                        {item.totalAmount !== undefined && <p className="text-xs font-medium">{t('invoices_col_total')}: {formatCurrencyDisplay(item.totalAmount, t)}</p>}
                                    </CardContent>
                                    <CardFooter className="p-3 border-t flex-wrap gap-1">
                                        <Button variant="ghost" size="sm" className="flex-1 min-w-[calc(50%-0.25rem)] justify-start text-xs h-8" onClick={(e) => { e.stopPropagation(); onViewDetails(item); }}><Info className="mr-1.5 h-3.5 w-3.5" /> {t('invoices_view_details_button')}</Button>
                                        {(item.status === 'pending' || item.status === 'error') && item.id && (<Button variant="ghost" size="sm" className="flex-1 min-w-[calc(50%-0.25rem)] justify-start text-xs h-8 text-amber-600 hover:text-amber-700" onClick={(e) => { e.stopPropagation(); onEdit(item.id, item.documentType, item.originalFileName || item.generatedFileName || 'unknown_doc'); }}><Edit className="mr-1.5 h-3.5 w-3.5" /> {t('edit_button')}</Button>)}
                                        {item.paymentStatus !== 'paid' && ( <Button variant="ghost" size="sm" className="flex-1 min-w-[calc(50%-0.25rem)] justify-start text-xs h-8 text-green-600 hover:text-green-700" onClick={(e) => { e.stopPropagation(); onMarkAsPaid(item);}}><Receipt className="mr-1.5 h-3.5 w-3.5" /> {t('paid_invoices_mark_as_paid_button')}</Button>)}
                                    </CardFooter>
                                </Card>
                            )))}
                </div>
            )}
            {totalPages > 1 && (
                <div className="flex items-center justify-end space-x-2 py-4 mt-4">
                    <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">{t('inventory_pagination_previous')}</span></Button>
                    <span className="text-sm text-muted-foreground">{t('inventory_pagination_page_info_simple', { currentPage: currentPage, totalPages: totalPages })}</span>
                    <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}><span className="hidden sm:inline">{t('inventory_pagination_next')}</span> <ChevronRight className="h-4 w-4" /></Button>
                </div>
            )}
        </>
    );
}

const PaidInvoicesTabView = ({
    filterDocumentType,
    filterSupplier,
    dateRange,
    searchTerm,
    parentVisibleColumns,
    parentColumnDefinitions,
    onToggleColumnVisibility,
    onViewDetails,
    onDeleteInvoice,
    onEditInvoice,
    onUpdateReceipt,
    selectedInvoiceIds: parentSelectedInvoiceIds,
    onSelectInvoice,
    onExportSelected,
    onSelectAllLastMonth,
}: {
    filterDocumentType: 'deliveryNote' | 'invoice' | '';
    filterSupplier: string;
    dateRange?: DateRange;
    searchTerm: string;
    parentVisibleColumns: Record<string, boolean>;
    parentColumnDefinitions: { key: string; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean }[];
    onToggleColumnVisibility: (key: string) => void;
    onViewDetails: (invoice: InvoiceHistoryItem, context?: 'image_only' | 'full_details') => void;
    onDeleteInvoice: (invoiceId: string) => void;
    onEditInvoice: (invoiceData: Partial<InvoiceHistoryItem>) => void; // Assuming a generic update function
    onUpdateReceipt: (invoice: InvoiceHistoryItem) => void;
    selectedInvoiceIds: string[];
    onSelectInvoice: (id: string, checked: boolean) => void;
    onExportSelected: () => void;
    onSelectAllLastMonth: () => void;
}) => {
    const { user, loading: authLoading } = useAuth();
    const { t, locale } = useTranslation();
    const [paidInvoices, setPaidInvoices] = useState<InvoiceHistoryItem[]>([]);
    const [isLoadingPaid, setIsLoadingPaid] = useState(true);
    const [sortKeyPaid, setSortKeyPaid] = useState<string>('uploadTime');
    const [sortDirectionPaid, setSortDirectionPaid] = useState<'asc' | 'desc'>('desc');
    const [currentPagePaid, setCurrentPagePaid] = useState(1);
    const [viewMode, setViewMode] = useState<ViewMode>('grid'); // Can be 'list' or 'grid'
    const isMobile = useIsMobile();


    const fetchPaidInvoices = useCallback(async () => {
        if (!user?.id) {
            setIsLoadingPaid(false);
            setPaidInvoices([]);
            return;
        }
        setIsLoadingPaid(true);
        try {
            let fetchedData = await getInvoicesService(user.id);
            fetchedData = fetchedData.filter(inv => inv.paymentStatus === 'paid');

            if (filterDocumentType) {
                 fetchedData = fetchedData.filter(inv => inv.documentType === filterDocumentType);
            }
            if (filterSupplier) {
                fetchedData = fetchedData.filter(inv => inv.supplierName === filterSupplier);
            }
            if (dateRange?.from) {
                const startDate = new Date(dateRange.from);
                startDate.setHours(0, 0, 0, 0);
                fetchedData = fetchedData.filter(inv => {
                    const invDate = inv.uploadTime instanceof Timestamp ? inv.uploadTime.toDate() : (typeof inv.uploadTime === 'string' ? parseISO(inv.uploadTime) : null);
                    return invDate ? invDate >= startDate : false;
                });
            }
            if (dateRange?.to) {
                const endDate = new Date(dateRange.to);
                endDate.setHours(23, 59, 59, 999);
                fetchedData = fetchedData.filter(inv => {
                    const invDate = inv.uploadTime instanceof Timestamp ? inv.uploadTime.toDate() : (typeof inv.uploadTime === 'string' ? parseISO(inv.uploadTime) : null);
                    return invDate ? invDate <= endDate : false;
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


             if (sortKeyPaid) {
                 fetchedData.sort((a, b) => {
                     const valA = a[sortKeyPaid as keyof InvoiceHistoryItem];
                     const valB = b[sortKeyPaid as keyof InvoiceHistoryItem];
                     let comparison = 0;
                     if (sortKeyPaid === 'uploadTime' || sortKeyPaid === 'invoiceDate') {
                        let dateA = 0;
                        let dateB = 0;
                        const aDateVal = valA;
                        const bDateVal = valB;

                        if (aDateVal) {
                            if (aDateVal instanceof Timestamp) dateA = aDateVal.toDate().getTime();
                            else if (typeof aDateVal === 'string' && isValid(parseISO(aDateVal))) dateA = parseISO(aDateVal).getTime();
                            else if (aDateVal instanceof Date && isValid(aDateVal)) dateA = aDateVal.getTime();
                        }
                        if (bDateVal) {
                            if (bDateVal instanceof Timestamp) dateB = bDateVal.toDate().getTime();
                            else if (typeof bDateVal === 'string' && isValid(parseISO(bDateVal))) dateB = parseISO(bDateVal).getTime();
                            else if (bDateVal instanceof Date && isValid(bDateVal)) dateB = bDateVal.getTime();
                        }
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
                     return sortDirectionPaid === 'asc' ? comparison : comparison * -1;
                 });
             }
            setPaidInvoices(fetchedData);
        } catch (error) {
            console.error("Failed to fetch paid invoices:", error);
            setPaidInvoices([]);
        } finally {
            setIsLoadingPaid(false);
        }
    }, [user?.id, filterDocumentType, filterSupplier, dateRange, searchTerm, sortKeyPaid, sortDirectionPaid, locale]);

    useEffect(() => {
        if (user?.id) {
            fetchPaidInvoices();
        }
    }, [user?.id, fetchPaidInvoices]);
    
    useEffect(() => {
        setViewMode(isMobile ? 'grid' : 'list');
    }, [isMobile]);

    const handleSortPaid = (key: string) => {
        if (!key) return;
        const sortableKey = key as keyof InvoiceHistoryItem;
        if (sortKeyPaid === sortableKey) {
            setSortDirectionPaid(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKeyPaid(sortableKey);
            setSortDirectionPaid('desc');
        }
        setCurrentPagePaid(1);
    };

    const totalPagesPaid = Math.ceil(paidInvoices.length / ITEMS_PER_PAGE_PAID_INVOICES);
    const displayedPaidInvoices = useMemo(() => {
        const startIndex = (currentPagePaid - 1) * ITEMS_PER_PAGE_PAID_INVOICES;
        return paidInvoices.slice(startIndex, startIndex + ITEMS_PER_PAGE_PAID_INVOICES);
    }, [paidInvoices, currentPagePaid]);

    const handlePageChangePaid = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPagesPaid) {
            setCurrentPagePaid(newPage);
        }
    };
    const visibleColumnHeadersPaid = parentColumnDefinitions.filter(h => parentVisibleColumns[h.key]);


    return (
        <>
          <div className="flex items-center justify-end gap-2 mb-4">
            <Button variant="outline" onClick={onSelectAllLastMonth} className="text-xs sm:text-sm">
                <CheckSquare className="mr-2 h-4 w-4" /> {t('invoice_export_select_all_last_month_button')}
            </Button>
            <Button onClick={onExportSelected} disabled={parentSelectedInvoiceIds.length === 0} className="bg-primary hover:bg-primary/90 text-xs sm:text-sm">
                <MailIcon className="mr-2 h-4 w-4" /> {t('invoice_export_selected_button')}
            </Button>
         </div>
          {viewMode === 'list' ? (
                <div className="overflow-x-auto relative">
                    <Table className="min-w-[600px]">
                        <TableHeader>
                            <TableRow>
                                {visibleColumnHeadersPaid.map((header) => (
                                    <TableHead key={header.key} className={cn(header.className, header.sortable && "cursor-pointer hover:bg-muted/50", header.mobileHidden ? 'hidden sm:table-cell' : 'table-cell', 'px-2 sm:px-4 py-2', header.key === 'actions' ? 'sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10' : (header.key === 'selection' ? 'sticky left-0 bg-card z-20' : ''))}
                                        onClick={() => header.sortable && handleSortPaid(header.key as string)}
                                        aria-sort={header.sortable ? (sortKeyPaid === header.key ? (sortDirectionPaid === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
                                        <div className="flex items-center gap-1 whitespace-nowrap">
                                            {header.key === 'selection' ? (<Checkbox checked={parentSelectedInvoiceIds.length > 0 && parentSelectedInvoiceIds.length === displayedPaidInvoices.length && displayedPaidInvoices.length > 0} onCheckedChange={(checked) => { if (checked) { onSelectInvoice('all', true); } else { onSelectInvoice('all', false); } }} aria-label={t('invoice_export_select_all_aria')} className="mx-auto" />)
                                                : (t(header.labelKey as any, { currency_symbol: t('currency_symbol') }))}
                                            {header.sortable && sortKeyPaid === header.key && (<span className="text-xs" aria-hidden="true">{sortDirectionPaid === 'asc' ? '▲' : '▼'}</span>)}
                                        </div>
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingPaid ? (<TableRow><TableCell colSpan={visibleColumnHeadersPaid.length} className="h-24 text-center px-2 sm:px-4 py-2"><div className="flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /><span className="ml-2">{t('invoices_loading')}</span></div></TableCell></TableRow>)
                                : displayedPaidInvoices.length === 0 ? (<TableRow><TableCell colSpan={visibleColumnHeadersPaid.length} className="h-24 text-center px-2 sm:px-4 py-2">{t('paid_invoices_no_paid_invoices_found')}</TableCell></TableRow>)
                                    : (displayedPaidInvoices.map((item: InvoiceHistoryItem) => (
                                        <TableRow key={item.id} className="hover:bg-muted/50" data-testid={`paid-invoice-item-${item.id}`}>
                                            {parentVisibleColumns.selection && (<TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-0 bg-card z-20", parentColumnDefinitions.find(h => h.key === 'selection')?.className)}><Checkbox checked={parentSelectedInvoiceIds.includes(item.id)} onCheckedChange={(checked) => onSelectInvoice(item.id, !!checked)} aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || item.generatedFileName || '' })} /></TableCell>)}
                                            {parentVisibleColumns.actions && (<TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10", parentColumnDefinitions.find(h => h.key === 'actions')?.className)}><Button variant="ghost" size="icon" className="text-primary hover:text-primary/80 h-7 w-7" onClick={() => onViewDetails(item)} title={t('invoices_view_details_title', { fileName: item.originalFileName || item.generatedFileName || '' })} aria-label={t('invoices_view_details_aria', { fileName: item.originalFileName || item.generatedFileName || '' })}><Info className="h-4 w-4" /></Button></TableCell>)}
                                            {parentVisibleColumns.originalFileName && (<TableCell className={cn("font-medium px-2 sm:px-4 py-2", parentColumnDefinitions.find(h => h.key === 'originalFileName')?.className)}><Button variant="link" className="p-0 h-auto text-left font-medium text-foreground hover:text-primary truncate" onClick={() => onViewDetails(item, 'image_only')} title={t('upload_history_view_image_title', { fileName: item.originalFileName || item.generatedFileName || '' })}><Receipt className="inline-block mr-1.5 h-3.5 w-3.5 text-muted-foreground" />{item.generatedFileName || item.originalFileName}</Button></TableCell>)}
                                            {parentVisibleColumns.invoiceDate && <TableCell className={cn('px-2 sm:px-4 py-2', parentColumnDefinitions.find(h => h.key === 'invoiceDate')?.mobileHidden && 'hidden sm:table-cell')}>{formatDateForDisplay(item.invoiceDate, locale, t)}</TableCell>}
                                            {parentVisibleColumns.supplierName && <TableCell className={cn('px-2 sm:px-4 py-2', parentColumnDefinitions.find(h => h.key === 'supplierName')?.mobileHidden && 'hidden sm:table-cell')}>{item.supplierName || t('invoices_na')}</TableCell>}
                                            {parentVisibleColumns.totalAmount && (<TableCell className="text-right px-2 sm:px-4 py-2 whitespace-nowrap">{item.totalAmount !== undefined && item.totalAmount !== null ? formatCurrencyDisplay(item.totalAmount, t) : t('invoices_na')}</TableCell>)}
                                            {parentVisibleColumns.paymentMethod && <TableCell className={cn('px-2 sm:px-4 py-2', parentColumnDefinitions.find(h => h.key === 'paymentMethod')?.mobileHidden && 'hidden sm:table-cell')}>{item.paymentMethod ? t(`payment_method_${item.paymentMethod.toLowerCase().replace(/\s+/g, '_')}` as any, {defaultValue: item.paymentMethod}) : t('invoices_na')}</TableCell>}
                                        </TableRow>
                                    )))}
                        </TableBody>
                    </Table>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" style={{ gridAutoRows: 'minmax(150px, auto)' }}>
                    {isLoadingPaid ? (Array.from({ length: ITEMS_PER_PAGE_PAID_INVOICES }).map((_, index) => (<Card key={index} className="animate-pulse"><CardHeader className="p-0 relative aspect-[4/3] bg-muted rounded-t-lg" /><CardContent className="p-3 space-y-1"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-1/4" /></CardContent><CardFooter className="p-3 border-t"><Skeleton className="h-7 w-full" /></CardFooter></Card>)))
                        : displayedPaidInvoices.length === 0 ? (<p className="col-span-full text-center text-muted-foreground py-10">{t('paid_invoices_no_paid_invoices_found')}</p>)
                            : (displayedPaidInvoices.map((item: InvoiceHistoryItem) => (
                                <Card key={item.id} className="flex flex-col overflow-hidden cursor-pointer hover:shadow-lg transition-shadow scale-fade-in">
                                    <div className="p-2 absolute top-0 left-0 z-10"><Checkbox checked={parentSelectedInvoiceIds.includes(item.id)} onCheckedChange={(checked) => onSelectInvoice(item.id, !!checked)} aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || item.generatedFileName || '' })} className="bg-background/70 hover:bg-background border-primary" /></div>
                                    <CardHeader className="p-0 relative aspect-[4/3]" onClick={() => onViewDetails(item, 'image_only')}>
                                        {isValidImageSrc(item.paymentReceiptImageUri || item.originalImagePreviewUri) ? (<NextImage src={item.paymentReceiptImageUri || item.originalImagePreviewUri!} alt={t('paid_invoices_receipt_image_alt', { fileName: item.originalFileName || item.generatedFileName || '' })} layout="fill" objectFit="cover" className="rounded-t-lg" data-ai-hint="payment receipt document" />)
                                            : (<div className="w-full h-full bg-muted rounded-t-lg flex items-center justify-center"><Receipt className="h-12 w-12 text-muted-foreground" /></div>)}
                                    </CardHeader>
                                    <CardContent className="p-3 flex-grow" onClick={() => onViewDetails(item)}>
                                        <CardTitle className="text-sm font-semibold truncate" title={item.generatedFileName || item.originalFileName}><Receipt className="inline-block mr-1.5 h-3.5 w-3.5 text-green-600" />{item.generatedFileName || item.originalFileName}</CardTitle>
                                        <p className="text-xs text-muted-foreground">{t('invoice_details_invoice_date_label')}: {formatDateForDisplay(item.invoiceDate, locale, t)}</p>
                                        {item.supplierName && <p className="text-xs text-muted-foreground">{t('invoice_details_supplier_label')}: {item.supplierName}</p>}
                                        {item.totalAmount !== undefined && <p className="text-xs font-medium">{t('invoices_col_total')}: {formatCurrencyDisplay(item.totalAmount, t)}</p>}
                                    </CardContent>
                                    <CardFooter className="p-3 border-t flex-wrap gap-1">
                                        <Button variant="ghost" size="sm" className="flex-1 min-w-[calc(50%-0.25rem)] justify-start text-xs h-8" onClick={(e) => { e.stopPropagation(); onViewDetails(item); }}><Info className="mr-1.5 h-3.5 w-3.5" /> {t('invoices_view_details_button')}</Button>
                                        <Button variant="ghost" size="sm" className="flex-1 min-w-[calc(50%-0.25rem)] justify-start text-xs h-8 text-blue-600 hover:text-blue-700" onClick={(e) => { e.stopPropagation(); onUpdateReceipt(item);}}><ImageIconLucide className="mr-1.5 h-3.5 w-3.5" /> {t('paid_invoices_update_receipt_button')}</Button>
                                    </CardFooter>
                                </Card>
                            )))}
                </div>
            )}
            {totalPagesPaid > 1 && (
                <div className="flex items-center justify-end space-x-2 py-4 mt-4">
                    <Button variant="outline" size="sm" onClick={() => handlePageChangePaid(currentPagePaid - 1)} disabled={currentPagePaid === 1}><ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">{t('inventory_pagination_previous')}</span></Button>
                    <span className="text-sm text-muted-foreground">{t('inventory_pagination_page_info_simple', { currentPage: currentPagePaid, totalPages: totalPagesPaid })}</span>
                    <Button variant="outline" size="sm" onClick={() => handlePageChangePaid(currentPagePaid + 1)} disabled={currentPagePaid === totalPagesPaid}><span className="hidden sm:inline">{t('inventory_pagination_next')}</span> <ChevronRight className="h-4 w-4" /></Button>
                </div>
            )}
        </>
    );
};


export default function DocumentsPage() {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useTranslation();
  const router = useRouter();
  const searchParamsHook = useSearchParams();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [allUserInvoices, setAllUserInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [filterDocumentType, setFilterDocumentType] = useState<'deliveryNote' | 'invoice' | ''>('');
  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterScanStatus, setFilterScanStatus] = useState<InvoiceHistoryItem['status'] | ''>('');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<InvoiceHistoryItem['paymentStatus'] | ''>('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  
  const [sortKey, setSortKey] = useState<string>('uploadTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const [showDetailsSheet, setShowDetailsSheet] = useState(false);
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<InvoiceHistoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedInvoiceData, setEditedInvoiceData] = useState<Partial<InvoiceHistoryItem>>({});
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  
  const [viewMode, setViewMode] = useState<ViewMode>(isMobile ? 'grid' : 'list');
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [showReceiptUploadDialog, setShowReceiptUploadDialog] = useState(false);
  const [invoiceForReceiptUpload, setInvoiceForReceiptUpload] = useState<InvoiceHistoryItem | null>(null);
  
  const [currentScannedDocsPage, setCurrentScannedDocsPage] = useState(1);
  
  const [selectedForBulkAction, setSelectedForBulkAction] = useState<string[]>([]);
  
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [accountantEmail, setAccountantEmail] = useState('');
  const [emailNote, setEmailNote] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'scanned-docs' | 'paid-invoices'>('scanned-docs');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const scannedDocsColumnDefinitions: { key: string; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean }[] = useMemo(() => [
      { key: 'selection', labelKey: 'invoice_export_select_column_header', sortable: false, className: 'w-[3%] sm:w-[3%] text-center px-1 sticky left-0 bg-card z-20' },
      { key: 'actions', labelKey: 'edit_invoice_th_actions', sortable: false, className: 'w-[5%] sm:w-[5%] text-center px-1 sm:px-2 sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10' },
      { key: 'originalFileName', labelKey: 'upload_history_col_file_name', sortable: true, className: 'w-[20%] sm:w-[25%] min-w-[80px] sm:min-w-[100px] truncate' },
      { key: 'uploadTime', labelKey: 'upload_history_col_upload_time', sortable: true, className: 'min-w-[130px] sm:min-w-[150px]', mobileHidden: true },
      { key: 'status', labelKey: 'upload_history_col_status', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]' },
      { key: 'paymentStatus', labelKey: 'invoice_payment_status_label', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]' },
      { key: 'paymentDueDate', labelKey: 'payment_due_date_dialog_title', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true},
      { key: 'invoiceNumber', labelKey: 'invoices_col_inv_number', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
      { key: 'supplierName', labelKey: 'invoice_details_supplier_label', sortable: true, className: 'min-w-[120px] sm:min-w-[150px]', mobileHidden: true },
      { key: 'totalAmount', labelKey: 'invoices_col_total_currency', sortable: true, className: 'text-right min-w-[100px] sm:min-w-[120px]' },
      { key: 'errorMessage', labelKey: 'invoice_details_error_message_label', sortable: false, className: 'text-xs text-destructive max-w-xs truncate hidden' },
   ], []);
  const paidInvoicesColumnDefinitions: { key: string; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean }[] = useMemo(() => [
      { key: 'selection', labelKey: 'invoice_export_select_column_header', sortable: false, className: 'w-[3%] sm:w-[3%] text-center px-1 sticky left-0 bg-card z-20' },
      { key: 'actions', labelKey: 'edit_invoice_th_actions', sortable: false, className: 'w-[5%] sm:w-[5%] text-center px-1 sm:px-2 sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10' },
      { key: 'originalFileName', labelKey: 'upload_history_col_file_name', sortable: true, className: 'w-[20%] sm:w-[25%] min-w-[80px] sm:min-w-[100px] truncate' },
      { key: 'invoiceDate', labelKey: 'invoice_details_invoice_date_label', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
      { key: 'supplierName', labelKey: 'invoice_details_supplier_label', sortable: true, className: 'min-w-[120px] sm:min-w-[150px]', mobileHidden: true },
      { key: 'totalAmount', labelKey: 'invoices_col_total_currency', sortable: true, className: 'text-right min-w-[100px] sm:min-w-[120px]' },
      { key: 'paymentMethod', labelKey: 'invoice_details_payment_method_label', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
      { key: 'paymentReceiptImageUri', labelKey: 'paid_invoices_receipt_image_label', sortable: false, mobileHidden: true },
  ], []);

  const defaultScannedColumns: Record<string, boolean> = useMemo(() => ({
    selection: true, actions: true, originalFileName: true, uploadTime: !isMobile, status: true, invoiceNumber: !isMobile, supplierName: !isMobile, totalAmount: true, paymentStatus: true, paymentDueDate: !isMobile, errorMessage: false,
  }), [isMobile]);
  const defaultPaidColumns: Record<string, boolean> = useMemo(() => ({
    selection: true, actions: true, originalFileName: true, invoiceDate: !isMobile, supplierName: !isMobile, totalAmount: true, paymentMethod: !isMobile, paymentReceiptImageUri: true,
  }), [isMobile]);

  const [visibleColumnsScanned, setVisibleColumnsScanned] = useState(defaultScannedColumns);
  const [visibleColumnsPaid, setVisibleColumnsPaid] = useState(defaultPaidColumns);

  const currentVisibleColumns = useMemo(() => activeTab === 'scanned-docs' ? visibleColumnsScanned : visibleColumnsPaid, [activeTab, visibleColumnsScanned, visibleColumnsPaid]);
  const currentColumnDefinitions = useMemo(() => activeTab === 'scanned-docs' ? scannedDocsColumnDefinitions : paidInvoicesColumnDefinitions, [activeTab, scannedDocsColumnDefinitions, paidInvoicesColumnDefinitions]);
  
  const toggleColumnVisibility = useCallback((key: string) => {
    if (activeTab === 'scanned-docs') {
        setVisibleColumnsScanned(prev => ({ ...prev, [key]: !prev[key] }));
    } else {
        setVisibleColumnsPaid(prev => ({ ...prev, [key]: !prev[key] }));
    }
  }, [activeTab]);


  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const fetchUserData = useCallback(async () => {
    if (!user?.id) {
        setIsLoading(false);
        setAllUserInvoices([]);
        setExistingSuppliers([]);
        return;
    }
    setIsLoading(true);
    try {
      const [invoicesData, suppliersData, settingsData] = await Promise.all([
        getInvoicesService(user.id),
        getSupplierSummariesService(user.id),
        getUserSettingsService(user.id)
      ]);
      setAllUserInvoices(invoicesData);
      setExistingSuppliers(suppliersData);
      if (settingsData?.accountantSettings?.email) {
        setAccountantEmail(settingsData.accountantSettings.email);
      }
    } catch (error) {
      console.error("Failed to fetch user data for invoices page:", error);
      toast({
        title: t('invoices_toast_error_fetch_invoices_title'),
        description: `${t('invoices_toast_error_fetch_invoices_desc')} (${(error as Error).message})`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast, t]);

  useEffect(() => {
    if (user?.id) {
      fetchUserData();
    }
    const view = searchParamsHook.get('viewMode') as ViewMode | null; 
    if (view && ['grid', 'list'].includes(view)) {
        setViewMode(view);
    } else if (isMobile) {
        setViewMode('grid'); 
    } else {
        setViewMode('list'); 
    }

    const supplierQuery = searchParamsHook.get('supplier');
    if (supplierQuery) setFilterSupplier(decodeURIComponent(supplierQuery));

    const paymentStatusQuery = searchParamsHook.get('filterPaymentStatus') as InvoiceHistoryItem['paymentStatus'] | null;
     if (paymentStatusQuery) setFilterPaymentStatus(paymentStatusQuery);

     const tabQuery = searchParamsHook.get('tab') as 'scanned-docs' | 'paid-invoices' | null;
     if (tabQuery) setActiveTab(tabQuery);

     const viewInvoiceId = searchParamsHook.get('viewInvoiceId');
     if (viewInvoiceId && allUserInvoices.length > 0) {
        const invoiceToView = allUserInvoices.find(inv => inv.id === viewInvoiceId);
        if (invoiceToView) {
            handleViewDetails(invoiceToView);
        }
     }

  }, [user, fetchUserData, searchParamsHook, isMobile, allUserInvoices]);


  const handleSortInternal = (key: string) => {
    if (!key) return;
    const sortableKey = key as keyof InvoiceHistoryItem;
    if (sortKey === sortableKey) {
        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
        setSortKey(sortableKey);
        setSortDirection('desc');
    }
    setCurrentScannedDocsPage(1);
  };

  const filteredInvoices = useMemo(() => {
    let result = allUserInvoices;

    if (filterDocumentType) {
        result = result.filter(inv => inv.documentType === filterDocumentType);
    }
    if (filterSupplier) {
        result = result.filter(inv => inv.supplierName === filterSupplier);
    }
    if (filterScanStatus && activeTab === 'scanned-docs') {
        result = result.filter(inv => inv.status === filterScanStatus);
    }
    if (filterPaymentStatus && activeTab === 'scanned-docs') {
        result = result.filter(inv => inv.paymentStatus === filterPaymentStatus);
    }
    if (dateRange?.from) {
        const startDate = new Date(dateRange.from);
        startDate.setHours(0, 0, 0, 0);
        result = result.filter(inv => {
            if (!inv.uploadTime) return false;
            let invDate: Date | null = null;
            if (inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
            else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
            else if (inv.uploadTime instanceof Date && isValid(inv.uploadTime)) invDate = inv.uploadTime;
            return invDate ? invDate >= startDate : false;
        });
    }
    if (dateRange?.to) {
        const endDate = new Date(dateRange.to);
        endDate.setHours(23, 59, 59, 999);
        result = result.filter(inv => {
            if (!inv.uploadTime) return false;
            let invDate: Date | null = null;
            if (inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
            else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
            else if (inv.uploadTime instanceof Date && isValid(inv.uploadTime)) invDate = inv.uploadTime;
            return invDate ? invDate <= endDate : false;
        });
    }
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(item =>
        (item.originalFileName || item.generatedFileName || '').toLowerCase().includes(lowerSearchTerm) ||
        (item.invoiceNumber && item.invoiceNumber.toLowerCase().includes(lowerSearchTerm)) ||
        (item.supplierName && item.supplierName.toLowerCase().includes(lowerSearchTerm))
      );
    }

    if (sortKey) {
         result.sort((a, b) => {
             const valA = a[sortKey as keyof InvoiceHistoryItem];
             const valB = b[sortKey as keyof InvoiceHistoryItem];
             let comparison = 0;
             if (sortKey === 'uploadTime' || sortKey === 'paymentDueDate' || sortKey === 'invoiceDate') {
                let dateA = 0;
                let dateB = 0;
                const aDateVal = valA;
                const bDateVal = valB;

                if (aDateVal) {
                    if (aDateVal instanceof Timestamp) dateA = aDateVal.toDate().getTime();
                    else if (typeof aDateVal === 'string' && isValid(parseISO(aDateVal))) dateA = parseISO(aDateVal).getTime();
                    else if (aDateVal instanceof Date && isValid(aDateVal)) dateA = aDateVal.getTime();
                }
                 if (bDateVal) {
                    if (bDateVal instanceof Timestamp) dateB = bDateVal.toDate().getTime();
                    else if (typeof bDateVal === 'string' && isValid(parseISO(bDateVal))) dateB = parseISO(bDateVal).getTime();
                    else if (bDateVal instanceof Date && isValid(bDateVal)) dateB = bDateVal.getTime();
                }
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
             return sortDirection === 'asc' ? comparison : comparison * -1;
         });
     }
    return result;
  }, [allUserInvoices, activeTab, filterDocumentType, filterSupplier, filterScanStatus, filterPaymentStatus, dateRange, searchTerm, sortKey, sortDirection, locale]);

  const paginatedScannedDocs = useMemo(() => {
    const scanned = filteredInvoices.filter(inv => inv.paymentStatus !== 'paid');
    const startIndex = (currentScannedDocsPage - 1) * ITEMS_PER_PAGE_SCANNED_DOCS;
    return scanned.slice(startIndex, startIndex + ITEMS_PER_PAGE_SCANNED_DOCS);
  }, [filteredInvoices, currentScannedDocsPage]);
  
  const totalScannedDocsPages = useMemo(() => {
      return Math.ceil(filteredInvoices.filter(inv => inv.paymentStatus !== 'paid').length / ITEMS_PER_PAGE_SCANNED_DOCS);
  }, [filteredInvoices]);

  const handleScannedDocsPageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalScannedDocsPages) {
        setCurrentScannedDocsPage(newPage);
    }
  };

   const handleViewDetails = (invoice: InvoiceHistoryItem, context?: 'image_only' | 'full_details') => {
    if (invoice) {
        const detailsToSet: InvoiceHistoryItem = {...invoice, _displayContext: context || 'full_details'};
        setSelectedInvoiceDetails(detailsToSet);
        setEditedInvoiceData({ ...invoice });
        setIsEditingDetails(false);
        setShowDetailsSheet(true);
    } else {
        setSelectedInvoiceDetails(null);
        setShowDetailsSheet(false);
    }
  };

  const handleEditScannedDoc = (invoiceId: string, docType: 'deliveryNote' | 'invoice', fileName: string) => {
    if (!invoiceId) {
        toast({title: t('upload_retry_unavailable_title'), description: t('upload_retry_unavailable_desc'), variant: "destructive"});
        return;
    }
    const queryParams = new URLSearchParams({
        tempInvoiceId: invoiceId, 
        docType: docType,
        originalFileName: encodeURIComponent(fileName || 'unknown_doc'),
    });
    router.push(`/edit-invoice?${queryParams.toString()}`);
  };

  const handleDeleteInvoice = async (invoiceId: string | string[]) => {
    if (!user?.id) return;
    setIsDeleting(true);
    try {
      const idsToDelete = Array.isArray(invoiceId) ? invoiceId : [invoiceId];
      if (idsToDelete.length === 0) {
        toast({ title: t('invoices_toast_no_selection_delete_title'), variant: 'destructive' });
        setIsDeleting(false);
        return;
      }
      for (const id of idsToDelete) {
        await deleteInvoiceService(id, user.id);
      }
      toast({
          title: idsToDelete.length > 1 ? t('invoices_toast_bulk_deleted_title') : t('invoices_toast_deleted_title'),
          description: idsToDelete.length > 1 ? t('invoices_toast_bulk_deleted_desc', { count: idsToDelete.length }) : t('invoices_toast_deleted_desc'),
      });
      fetchUserData();
      setShowDetailsSheet(false);
      setSelectedInvoiceDetails(null);
      setSelectedForBulkAction([]);
    } catch (error) {
      console.error("Failed to delete invoice(s):", error);
      toast({
          title: t('invoices_toast_delete_fail_title'),
          description: t('invoices_toast_delete_fail_desc'),
          variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };


  const handleEditDetailsInputChange = (field: keyof InvoiceHistoryItem, value: string | number | Date | undefined | null | Timestamp ) => {
     if (field === 'uploadTime' || field === 'status') return;
    setEditedInvoiceData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveInvoiceDetails = async () => {
    if (!selectedInvoiceDetails || !selectedInvoiceDetails.id || !user?.id) return;
    setIsSavingDetails(true);
    try {
        const updatedInvoiceData: Partial<InvoiceHistoryItem> = {
            originalFileName: editedInvoiceData.originalFileName || selectedInvoiceDetails.originalFileName,
            generatedFileName: editedInvoiceData.generatedFileName || selectedInvoiceDetails.generatedFileName,
            invoiceNumber: editedInvoiceData.invoiceNumber || undefined,
            supplierName: editedInvoiceData.supplierName || undefined,
            totalAmount: typeof editedInvoiceData.totalAmount === 'number' ? editedInvoiceData.totalAmount : undefined,
            errorMessage: editedInvoiceData.errorMessage || undefined,
            paymentStatus: editedInvoiceData.paymentStatus || selectedInvoiceDetails.paymentStatus,
            paymentDueDate: editedInvoiceData.paymentDueDate,
            documentType: editedInvoiceData.documentType || selectedInvoiceDetails.documentType,
            invoiceDate: editedInvoiceData.invoiceDate,
            paymentMethod: editedInvoiceData.paymentMethod,
            compressedImageForFinalRecordUri: editedInvoiceData.compressedImageForFinalRecordUri,
            originalImagePreviewUri: editedInvoiceData.originalImagePreviewUri,
            paymentReceiptImageUri: editedInvoiceData.paymentReceiptImageUri,
        };

        await updateInvoiceService(selectedInvoiceDetails.id, updatedInvoiceData, user.id);
        toast({
            title: t('invoices_toast_updated_title'),
            description: t('invoices_toast_updated_desc'),
        });
        setIsEditingDetails(false);
        const refreshedInvoice = await getInvoicesService(user.id).then(all => all.find(inv => inv.id === selectedInvoiceDetails!.id));
        if (refreshedInvoice) {
            setSelectedInvoiceDetails(refreshedInvoice);
            fetchUserData();
        } else {
           setShowDetailsSheet(false);
           fetchUserData();
        }

    } catch (error) {
        console.error("Failed to save invoice details:", error);
        toast({
            title: t('invoices_toast_save_fail_title'),
            description: t('invoices_toast_save_fail_desc'),
            variant: "destructive",
            duration: 6000,
        });
    } finally {
        setIsSavingDetails(false);
    }
  };

 const handlePaymentStatusChange = async (invoiceId: string, newStatus: InvoiceHistoryItem['paymentStatus']) => {
    if (!user?.id || !selectedInvoiceDetails) return;

    if (newStatus === 'paid') {
        setInvoiceForReceiptUpload(selectedInvoiceDetails);
        setShowReceiptUploadDialog(true);
    } else {
        const originalInvoice = allUserInvoices.find(inv => inv.id === invoiceId);
        if (!originalInvoice) return;

        setSelectedInvoiceDetails(prev => prev ? {...prev, paymentStatus: newStatus, paymentReceiptImageUri: undefined } : null);
        setAllUserInvoices(prevInvoices => prevInvoices.map(inv => inv.id === invoiceId ? {...inv, paymentStatus: newStatus, paymentReceiptImageUri: undefined } : inv));

        try {
            await updateInvoicePaymentStatusService(invoiceId, newStatus, user.id, undefined);
            toast({
                title: t('toast_invoice_payment_status_updated_title'),
                description: t('toast_invoice_payment_status_updated_desc', { fileName: originalInvoice.originalFileName || originalInvoice.generatedFileName || '', status: t(`invoice_payment_status_${newStatus}` as any) || newStatus }),
            });
            fetchUserData();
        } catch (error) {
            console.error("Failed to update payment status:", error);
            setSelectedInvoiceDetails(prev => prev ? {...prev, paymentStatus: originalInvoice.paymentStatus, paymentReceiptImageUri: originalInvoice.paymentReceiptImageUri } : null);
            setAllUserInvoices(prevInvoices => prevInvoices.map(inv => inv.id === invoiceId ? {...inv, paymentStatus: originalInvoice.paymentStatus, paymentReceiptImageUri: originalInvoice.paymentReceiptImageUri } : inv));
            toast({
                title: t('toast_invoice_payment_status_update_fail_title'),
                description: t('toast_invoice_payment_status_update_fail_desc'),
                variant: "destructive",
            });
        }
    }
};

const handleConfirmReceiptUpload = async (receiptImageUriParam: string) => {
    if (!invoiceForReceiptUpload || !user?.id) return;
    const invoiceId = invoiceForReceiptUpload.id;

    try {
        await updateInvoicePaymentStatusService(invoiceId, 'paid', user.id, receiptImageUriParam);
        toast({
            title: t('paid_invoices_toast_receipt_uploaded_title'),
            description: t('paid_invoices_toast_receipt_uploaded_desc', { fileName: invoiceForReceiptUpload.originalFileName || invoiceForReceiptUpload.generatedFileName || '' }),
        });
        setShowReceiptUploadDialog(false);
        setInvoiceForReceiptUpload(null);
        fetchUserData(); 
        if (selectedInvoiceDetails && selectedInvoiceDetails.id === invoiceId) {
             setSelectedInvoiceDetails(prev => prev ? {...prev, paymentStatus: 'paid', paymentReceiptImageUri: receiptImageUriParam } : null);
        }
    } catch (error) {
        console.error("Failed to confirm receipt upload and update status:", error);
        toast({
            title: t('toast_invoice_payment_status_update_fail_title'),
            description: t('paid_invoices_error_processing_receipt'),
            variant: "destructive",
        });
    }
};


  const handleSelectInvoiceForBulkAction = (invoiceId: string, checked: boolean) => {
     if (invoiceId === 'all') {
       if (checked) {
         const currentTabInvoices = activeTab === 'scanned-docs' ? paginatedScannedDocs : filteredInvoices.filter(inv => inv.paymentStatus === 'paid');
         setSelectedForBulkAction(currentTabInvoices.map(inv => inv.id));
       } else {
         setSelectedForBulkAction([]);
       }
     } else {
        setSelectedForBulkAction(prev =>
          checked ? [...prev, invoiceId] : prev.filter(id => id !== invoiceId)
        );
     }
  };

  const handleSelectAllLastMonth = async () => {
    if(!user?.id) return;
    const allUserInvoicesData = await getInvoicesService(user.id); 
    const paidUserInvoices = allUserInvoicesData.filter(inv => inv.paymentStatus === 'paid');
    const today = new Date();
    const lastMonthStart = startOfMonth(subDays(today, today.getDate())); 
    const lastMonthEnd = endOfMonth(subDays(today, today.getDate()));   

    const lastMonthInvoices = paidUserInvoices.filter(invoice => {
      let invoiceDate: Date | null = null;
      if (invoice.invoiceDate instanceof Timestamp) invoiceDate = invoice.invoiceDate.toDate();
      else if (typeof invoice.invoiceDate === 'string' && isValid(parseISO(invoice.invoiceDate))) invoiceDate = parseISO(invoice.invoiceDate);
      
      return invoiceDate ? (invoiceDate >= lastMonthStart && invoiceDate <= lastMonthEnd) : false;
    });

    setSelectedForBulkAction(lastMonthInvoices.map(invoice => invoice.id));
    toast({
      title: t('invoice_export_selected_last_month_title'),
      description: t('invoice_export_selected_last_month_desc', { count: lastMonthInvoices.length }),
    });
  };


  const handleOpenExportDialog = async () => {
    if (selectedForBulkAction.length === 0) {
      toast({
        title: t('invoice_export_error_no_selection_title'),
        description: t('invoice_export_error_no_selection_desc'),
        variant: "destructive",
      });
      return;
    }
    if (user?.id) {
        const settings = await getUserSettingsService(user.id);
        if (settings && settings.accountantSettings?.email) {
            setAccountantEmail(settings.accountantSettings.email);
        } else {
            setAccountantEmail('');
            toast({
                title: t('settings_accountant_toast_email_required_title'),
                description: t('settings_accountant_toast_email_required_desc_export'),
                variant: "destructive"
            })
        }
    }
    setShowExportDialog(true);
  };

 const handleExportSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id) {
        toast({ title: t("settings_login_required"), variant: "destructive" });
        return;
    }
    if (!accountantEmail.trim()) {
        toast({ title: t('invoice_export_error_invalid_email_title'), description: t('invoice_export_error_invalid_email_desc'), variant: "destructive" });
        return;
    }
     if (accountantEmail.trim() && !/\S+@\S+\.\S+/.test(accountantEmail)) {
        toast({
            title: t('error_title'),
            description: t('settings_accountant_toast_invalid_email_desc'),
            variant: "destructive",
        });
        return;
    }

    setIsExporting(true);
    try {
        const result = await generateAndEmailInvoicesAction(selectedForBulkAction, accountantEmail, emailNote, user.id);
        if (result.success) {
            toast({ title: t('invoice_export_success_title'), description: result.message });
            setShowExportDialog(false);
            setSelectedForBulkAction([]);
            setEmailNote('');
        } else {
            toast({ title: t('invoice_export_error_title'), description: result.message, variant: "destructive" });
        }
    } catch (error: any) {
        toast({ title: t('invoice_export_error_unexpected_title'), description: t('invoice_export_error_unexpected_desc', { message: error.message }), variant: "destructive"});
    } finally {
        setIsExporting(false);
    }
 };


   if (authLoading || (isLoading && !user)) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="ml-2 text-muted-foreground">{t('invoices_loading')}</p>
       </div>
     );
   }
   if (!user && !authLoading) {
    return null;
   }


  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <FileTextIconLucide className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('documents_page_title')}
            </CardTitle>
             <div className="flex items-center gap-2">
                 <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowAdvancedFilters(prev => !prev)}
                    className={cn("h-9 w-9 sm:h-10 sm:w-10", showAdvancedFilters && "bg-accent text-accent-foreground")}
                    aria-label={t('filter_options_button_aria')}
                 >
                    <Filter className="h-4 w-4 sm:h-5 sm:w-5" />
                 </Button>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setViewMode(prev => prev === 'list' ? 'grid' : 'list')}
                    className={cn("h-9 w-9 sm:h-10 sm:w-10", isMobile && "hidden")} 
                    aria-label={t('invoices_toggle_view_mode_aria')}
                >
                    {viewMode === 'list' ? <Grid className="h-4 w-4 sm:h-5 sm:w-5" /> : <ListChecks className="h-4 w-4 sm:h-5 sm:w-5" />}
                </Button>
            </div>
          </div>
          <CardDescription>{t('documents_page_description')}</CardDescription>
        </CardHeader>
        <CardContent>
         <div className="mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap">
            <div className="relative w-full sm:flex-grow sm:max-w-xs">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                 <Input
                    placeholder={t('inventory_search_placeholder')}
                    value={searchTerm}
                    onChange={(e) => {setSearchTerm(e.target.value); setCurrentScannedDocsPage(1);}}
                    className="pl-10 h-10 w-full"
                    aria-label={t('invoices_search_aria')}
                 />
            </div>
             <Select value={filterDocumentType} onValueChange={(value) => setFilterDocumentType(value === "all" ? "" : value as any)}>
                <SelectTrigger className="w-full sm:w-auto h-10">
                    <SelectValue placeholder={t('invoices_filter_doc_type_all')} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">{t('invoices_filter_doc_type_all')}</SelectItem>
                    <SelectItem value="deliveryNote">{t('upload_doc_type_delivery_note')}</SelectItem>
                    <SelectItem value="invoice">{t('upload_doc_type_invoice')}</SelectItem>
                </SelectContent>
             </Select>
             <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAdvancedFilters(prev => !prev)}
                className={cn("h-10 w-10", showAdvancedFilters && "bg-accent text-accent-foreground")}
                aria-label={t('filter_options_button_aria')}
              >
                <Filter className="h-5 w-5" />
            </Button>
          </div>

          {showAdvancedFilters && (
             <div className="mb-4 flex flex-wrap items-stretch justify-start gap-2 p-3 border rounded-md bg-muted/50 animate-in fade-in-0 duration-300">
                 {/* Date Range Filter */}
                 <Popover>
                     <PopoverTrigger asChild>
                         <Button variant="outline" className="rounded-full text-xs h-9 px-3 py-1 border bg-background hover:bg-muted flex flex-col items-center justify-center w-20 h-20 sm:w-24 sm:h-24">
                             <CalendarDays className="h-5 w-5 sm:h-6 sm:w-6 mb-1" />
                             <span className="text-[10px] sm:text-xs">{t('filter_label_dates')}</span>
                         </Button>
                     </PopoverTrigger>
                     <PopoverContent className="w-auto p-0" align="start">
                         <Calendar initialFocus mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={isMobile ? 1 : 2} />
                          {dateRange && (
                            <div className="p-2 border-t flex justify-end">
                                <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>{t('reports_date_range_clear')}</Button>
                            </div>
                         )}
                     </PopoverContent>
                 </Popover>
                 {/* Supplier Filter */}
                 <DropdownMenu>
                     <DropdownMenuTrigger asChild><Button variant="outline" className="rounded-full text-xs h-9 px-3 py-1 border bg-background hover:bg-muted flex flex-col items-center justify-center w-20 h-20 sm:w-24 sm:h-24"><Briefcase className="h-5 w-5 sm:h-6 sm:w-6 mb-1 text-muted-foreground" /><span className="text-[10px] sm:text-xs">{existingSuppliers.find(s => s.name === filterSupplier)?.name || t('filter_label_supplier')}</span></Button></DropdownMenuTrigger>
                     <DropdownMenuContent align="start"><DropdownMenuLabel>{t('invoices_filter_supplier_label')}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuCheckboxItem checked={!filterSupplier} onCheckedChange={() => setFilterSupplier('')}>{t('invoices_filter_supplier_all')}</DropdownMenuCheckboxItem>{existingSuppliers.map((supplier) => (<DropdownMenuCheckboxItem key={supplier.id} checked={filterSupplier === supplier.name} onCheckedChange={() => setFilterSupplier(supplier.name)}>{supplier.name}</DropdownMenuCheckboxItem>))}</DropdownMenuContent>
                 </DropdownMenu>
                
                 {activeTab === 'scanned-docs' && (
                     <>
                        {/* Scan Status Filter */}
                        <DropdownMenu>
                             <DropdownMenuTrigger asChild><Button variant="outline" className="rounded-full text-xs h-9 px-3 py-1 border bg-background hover:bg-muted flex flex-col items-center justify-center w-20 h-20 sm:w-24 sm:h-24"><ListFilter className="h-5 w-5 sm:h-6 sm:w-6 mb-1 text-muted-foreground" /><span className="text-[10px] sm:text-xs">{filterScanStatus ? t(`invoice_status_${filterScanStatus}` as any) : t('filter_label_scan_status')}</span></Button></DropdownMenuTrigger>
                             <DropdownMenuContent align="start"><DropdownMenuLabel>{t('invoices_filter_status_label')}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuCheckboxItem checked={!filterScanStatus} onCheckedChange={() => setFilterScanStatus('')}>{t('invoices_filter_status_all')}</DropdownMenuCheckboxItem>{(['completed', 'processing', 'pending', 'error'] as InvoiceHistoryItem['status'][]).map((status) => (<DropdownMenuCheckboxItem key={status} checked={filterScanStatus === status} onCheckedChange={() => setFilterScanStatus(status)}>{t(`invoice_status_${status}` as any)}</DropdownMenuCheckboxItem>))}</DropdownMenuContent>
                        </DropdownMenu>
                        {/* Payment Status Filter */}
                        <DropdownMenu>
                             <DropdownMenuTrigger asChild><Button variant="outline" className="rounded-full text-xs h-9 px-3 py-1 border bg-background hover:bg-muted flex flex-col items-center justify-center w-20 h-20 sm:w-24 sm:h-24"><CreditCard className="h-5 w-5 sm:h-6 sm:w-6 mb-1 text-muted-foreground" /><span className="text-[10px] sm:text-xs">{filterPaymentStatus ? t(`invoice_payment_status_${filterPaymentStatus}` as any) : t('filter_label_payment_status')}</span></Button></DropdownMenuTrigger>
                             <DropdownMenuContent align="start"><DropdownMenuLabel>{t('invoices_filter_payment_status_label')}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuCheckboxItem checked={!filterPaymentStatus} onCheckedChange={() => setFilterPaymentStatus('')}>{t('invoices_filter_payment_status_all')}</DropdownMenuCheckboxItem>{(['unpaid', 'pending_payment'] as InvoiceHistoryItem['paymentStatus'][]).map((pStatus) => (<DropdownMenuCheckboxItem key={pStatus} checked={filterPaymentStatus === pStatus} onCheckedChange={() => setFilterPaymentStatus(pStatus)}>{t(`invoice_payment_status_${pStatus}` as any)}</DropdownMenuCheckboxItem>))}</DropdownMenuContent>
                        </DropdownMenu>
                     </>
                 )}
                 {/* View Columns Filter */}
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                         <Button variant="outline" className="rounded-full text-xs h-9 px-3 py-1 border bg-background hover:bg-muted flex flex-col items-center justify-center w-20 h-20 sm:w-24 sm:h-24">
                             <Columns className="h-5 w-5 sm:h-6 sm:w-6 mb-1 text-muted-foreground" /> <span className="text-[10px] sm:text-xs">{t('filter_label_columns')}</span>
                         </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>
                            {activeTab === 'scanned-docs' ? t('invoices_tab_scanned_docs') : t('invoices_tab_paid_invoices')} - {t('inventory_toggle_columns_label')}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {currentColumnDefinitions.filter(h => h.key !== 'id' && h.key !== 'actions' && h.key !== 'selection').map((header) => (
                            <DropdownMenuCheckboxItem
                                key={header.key}
                                className="capitalize"
                                checked={currentVisibleColumns[header.key as keyof typeof currentVisibleColumns]}
                                onCheckedChange={() => toggleColumnVisibility(header.key)}
                            >
                                {t(header.labelKey as any, { currency_symbol: t('currency_symbol') })}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                 </DropdownMenu>
             </div>
          )}

          <Tabs value={activeTab} onValueChange={(value) => {setActiveTab(value as any); setCurrentScannedDocsPage(1); setSelectedForBulkAction([]);}} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="scanned-docs">{t('invoices_tab_scanned_docs')}</TabsTrigger>
              <TabsTrigger value="paid-invoices">{t('invoices_tab_paid_invoices')}</TabsTrigger>
            </TabsList>
            <TabsContent value="scanned-docs">
              <ScannedDocsView
                invoices={paginatedScannedDocs}
                isLoading={isLoading}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortInternal}
                onViewDetails={handleViewDetails}
                onSelectInvoice={handleSelectInvoiceForBulkAction}
                selectedInvoiceIds={selectedForBulkAction}
                viewMode={viewMode}
                currentPage={currentScannedDocsPage}
                totalPages={totalScannedDocsPages}
                onPageChange={handleScannedDocsPageChange}
                parentVisibleColumns={visibleColumnsScanned}
                parentColumnDefinitions={scannedDocsColumnDefinitions}
                onMarkAsPaid={(invoice) => {
                   setInvoiceForReceiptUpload(invoice);
                   setShowReceiptUploadDialog(true);
                }}
                onEdit={handleEditScannedDoc}
              />
                 {activeTab === 'scanned-docs' && selectedForBulkAction.length > 0 && (
                 <div className="mt-4 flex flex-col sm:flex-row justify-end gap-2">
                     <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" className="w-full sm:w-auto">
                                <Trash2 className="mr-2 h-4 w-4"/>
                                {t('invoices_bulk_delete_button', {count: selectedForBulkAction.length})}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContentComponent>
                            <AlertDialogHeaderComponent>
                                <AlertDialogTitleComponent>{t('invoices_delete_confirm_title')}</AlertDialogTitleComponent>
                                <AlertDialogDescriptionComponent>{t('invoices_delete_confirm_desc', {fileName: `${selectedForBulkAction.length} ${t('documents_plural_for_delete_message')}`})}</AlertDialogDescriptionComponent>
                            </AlertDialogHeaderComponent>
                            <AlertDialogFooterComponent>
                                <AlertDialogCancel>{t('cancel_button')}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteInvoice(selectedForBulkAction)} className={buttonVariants({variant: "destructive"})}>
                                    {t('invoices_delete_confirm_action')}
                                </AlertDialogAction>
                            </AlertDialogFooterComponent>
                        </AlertDialogContentComponent>
                     </AlertDialog>
                 </div>
                )}
            </TabsContent>
            <TabsContent value="paid-invoices">
              <PaidInvoicesTabView 
                filterDocumentType={filterDocumentType} 
                filterSupplier={filterSupplier}
                dateRange={dateRange}
                searchTerm={searchTerm}
                parentVisibleColumns={visibleColumnsPaid}
                parentColumnDefinitions={paidInvoicesColumnDefinitions}
                onToggleColumnVisibility={toggleColumnVisibility}
                onViewDetails={handleViewDetails}
                onDeleteInvoice={(invoiceId) => handleDeleteInvoice(invoiceId)}
                onEditInvoice={handleSaveInvoiceDetails} 
                onUpdateReceipt={(invoice) => {
                    setInvoiceForReceiptUpload(invoice);
                    setShowReceiptUploadDialog(true);
                }}
                selectedInvoiceIds={selectedForBulkAction}
                onSelectInvoice={handleSelectInvoiceForBulkAction}
                onExportSelected={handleOpenExportDialog}
                onSelectAllLastMonth={handleSelectAllLastMonth}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Sheet open={showDetailsSheet} onOpenChange={(open) => {
          setShowDetailsSheet(open);
          if (!open) {
            setIsEditingDetails(false);
            setSelectedInvoiceDetails(null);
          }
      }}>
        <SheetContent side="bottom" className="h-[85vh] sm:h-[90vh] flex flex-col p-0 rounded-t-lg">
          <SheetHeader className="p-4 sm:p-6 border-b shrink-0 sticky top-0 bg-background z-10">
             <SheetTitle className="flex items-center text-lg sm:text-xl">{isEditingDetails ? <Edit className="mr-2 h-5 w-5"/> : <Info className="mr-2 h-5 w-5"/>}{isEditingDetails ? t('invoices_edit_details_title') : (selectedInvoiceDetails?._displayContext === 'image_only' ? t('upload_history_image_preview_title') : t('invoice_details_title'))}</SheetTitle>
             {selectedInvoiceDetails?._displayContext !== 'image_only' && (
                <SheetDescription className="text-xs sm:text-sm">
                    {isEditingDetails ? t('invoices_edit_details_desc', { fileName: selectedInvoiceDetails?.originalFileName || selectedInvoiceDetails?.generatedFileName || '' }) : t('invoice_details_description', { fileName: selectedInvoiceDetails?.originalFileName || selectedInvoiceDetails?.generatedFileName || '' })}
                </SheetDescription>
             )}
          </SheetHeader>
          {selectedInvoiceDetails && (
            <ScrollArea className="flex-grow p-0"> 
              <div className="p-4 sm:p-6 space-y-4">
              {isEditingDetails && selectedInvoiceDetails._displayContext !== 'image_only' ? (
                <div className="space-y-3">
                    <div><Label htmlFor="editOriginalFileName">{t('invoice_details_file_name_label')}</Label><Input id="editOriginalFileName" value={editedInvoiceData.originalFileName || ''} onChange={(e) => handleEditDetailsInputChange('originalFileName', e.target.value)} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editDocumentType">{t('invoices_document_type_label')}</Label><Select value={editedInvoiceData.documentType || selectedInvoiceDetails.documentType} onValueChange={(value) => handleEditDetailsInputChange('documentType', value as 'deliveryNote' | 'invoice')} disabled={isSavingDetails}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deliveryNote">{t('upload_doc_type_delivery_note')}</SelectItem><SelectItem value="invoice">{t('upload_doc_type_invoice')}</SelectItem></SelectContent></Select></div>
                    <div><Label htmlFor="editInvoiceNumber">{t('invoice_details_invoice_number_label')}</Label><Input id="editInvoiceNumber" value={editedInvoiceData.invoiceNumber || ''} onChange={(e) => handleEditDetailsInputChange('invoiceNumber', e.target.value)} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editSupplierName">{t('invoice_details_supplier_label')}</Label><Input id="editSupplierName" value={editedInvoiceData.supplierName || ''} onChange={(e) => handleEditDetailsInputChange('supplierName', e.target.value)} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editTotalAmount">{t('invoices_col_total_currency', { currency_symbol: t('currency_symbol') })}</Label><Input id="editTotalAmount" type="number" value={editedInvoiceData.totalAmount ?? ''} onChange={(e) => handleEditDetailsInputChange('totalAmount', parseFloat(e.target.value))} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editInvoiceDate">{t('invoice_details_invoice_date_label')}</Label><Input id="editInvoiceDate" type="date" value={editedInvoiceData.invoiceDate ? (editedInvoiceData.invoiceDate instanceof Timestamp ? format(editedInvoiceData.invoiceDate.toDate(), 'yyyy-MM-dd') : (typeof editedInvoiceData.invoiceDate === 'string' && isValid(parseISO(editedInvoiceData.invoiceDate)) ? format(parseISO(editedInvoiceData.invoiceDate), 'yyyy-MM-dd') : (editedInvoiceData.invoiceDate instanceof Date && isValid(editedInvoiceData.invoiceDate) ? format(editedInvoiceData.invoiceDate, 'yyyy-MM-dd') : ''))) : ''} onChange={(e) => handleEditDetailsInputChange('invoiceDate', e.target.value ? parseISO(e.target.value) : undefined)} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editPaymentMethod">{t('invoice_details_payment_method_label')}</Label><Input id="editPaymentMethod" value={editedInvoiceData.paymentMethod || ''} onChange={(e) => handleEditDetailsInputChange('paymentMethod', e.target.value)} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editPaymentDueDate">{t('payment_due_date_dialog_title')}</Label><Input id="editPaymentDueDate" type="date" value={editedInvoiceData.paymentDueDate ? (editedInvoiceData.paymentDueDate instanceof Timestamp ? format(editedInvoiceData.paymentDueDate.toDate(), 'yyyy-MM-dd') : (typeof editedInvoiceData.paymentDueDate === 'string' && isValid(parseISO(editedInvoiceData.paymentDueDate)) ? format(parseISO(editedInvoiceData.paymentDueDate), 'yyyy-MM-dd') : (editedInvoiceData.paymentDueDate instanceof Date && isValid(editedInvoiceData.paymentDueDate) ? format(editedInvoiceData.paymentDueDate, 'yyyy-MM-dd') : ''))) : ''} onChange={(e) => handleEditDetailsInputChange('paymentDueDate', e.target.value ? parseISO(e.target.value) : undefined)} disabled={isSavingDetails}/></div>
                    {selectedInvoiceDetails.status === 'error' && (<div><Label htmlFor="editErrorMessage">{t('invoice_details_error_message_label')}</Label><Textarea id="editErrorMessage" value={editedInvoiceData.errorMessage || ''} onChange={(e) => handleEditDetailsInputChange('errorMessage', e.target.value as string)} disabled={isSavingDetails}/></div>)}
                     {activeTab === 'scanned-docs' && selectedInvoiceDetails.paymentStatus !== 'paid' && (
                         <div>
                            <Label>{t('invoice_payment_status_label')}</Label>
                                <div className="flex gap-2 mt-1">
                                    {(['unpaid', 'pending_payment', 'paid'] as InvoiceHistoryItem['paymentStatus'][]).map(pStatus => (
                                        <Button key={pStatus} variant={editedInvoiceData.paymentStatus === pStatus ? 'default' : 'outline'} size="sm"
                                            onClick={() => handlePaymentStatusChange(selectedInvoiceDetails!.id, pStatus)}
                                            disabled={isSavingDetails}>
                                          {t(`invoice_payment_status_${pStatus}` as any)}
                                        </Button>
                                    ))}
                                </div>
                         </div>
                     )}
                </div>
              ) : (
                <>
                 <div className="space-y-2"><h3 className="text-md font-semibold text-primary border-b pb-1">{t('invoice_details_document_section_title')}</h3>
                      <p><strong>{t('invoice_details_file_name_label')}:</strong> {selectedInvoiceDetails.generatedFileName || selectedInvoiceDetails.originalFileName}</p>
                      <p><strong>{t('invoice_details_upload_time_label')}:</strong> {formatDateForDisplay(selectedInvoiceDetails.uploadTime, locale, t)}</p>
                      <p><strong>{t('invoices_document_type_label')}:</strong> {t(`upload_doc_type_${selectedInvoiceDetails.documentType}` as any) || selectedInvoiceDetails.documentType}</p>
                      <div className="flex items-center"><strong className="mr-1">{t('invoice_details_status_label')}:</strong> {ScannedDocsView({ invoices: [], isLoading: false, sortKey: '', sortDirection: '', onSort: ()=>{}, onViewDetails: ()=>{}, onSelectInvoice: ()=>{}, selectedInvoiceIds: [], viewMode: 'list', currentPage: 1, totalPages: 1, onPageChange: ()=>{}, parentVisibleColumns: {}, parentColumnDefinitions: [], onMarkAsPaid: ()=>{}, onEdit: ()=>{} }) /*Placeholder, actual component might need refactor or direct badge use*/ }</div>
                  </div>
                  <Separator className="my-3"/>
                   <div className="space-y-2"><h3 className="text-md font-semibold text-primary border-b pb-1">{t('invoice_details_financial_section_title')}</h3>
                      <p><strong>{t('invoice_details_invoice_number_label')}:</strong> {selectedInvoiceDetails.invoiceNumber || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_supplier_label')}:</strong> {selectedInvoiceDetails.supplierName || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_total_amount_label')}:</strong> {selectedInvoiceDetails.totalAmount !== undefined ? formatCurrencyDisplay(selectedInvoiceDetails.totalAmount, t) : t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_invoice_date_label')}:</strong> {selectedInvoiceDetails.invoiceDate ? formatDateForDisplay(selectedInvoiceDetails.invoiceDate, locale, t) : t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_payment_method_label')}:</strong> {selectedInvoiceDetails.paymentMethod ? t(`payment_method_${selectedInvoiceDetails.paymentMethod.toLowerCase().replace(/\s+/g, '_')}` as any, {defaultValue: selectedInvoiceDetails.paymentMethod}) : t('invoices_na')}</p>
                      <div className="flex items-center mt-1"><strong className="mr-1">{t('invoice_payment_status_label')}:</strong> {activeTab === 'scanned-docs' ? ScannedDocsView({ invoices: [], isLoading: false, sortKey: '', sortDirection: '', onSort: ()=>{}, onViewDetails: ()=>{}, onSelectInvoice: ()=>{}, selectedInvoiceIds: [], viewMode: 'list', currentPage: 1, totalPages: 1, onPageChange: ()=>{}, parentVisibleColumns: {}, parentColumnDefinitions: [], onMarkAsPaid: ()=>{}, onEdit: ()=>{} }) : ScannedDocsView({ invoices: [], isLoading: false, sortKey: '', sortDirection: '', onSort: ()=>{}, onViewDetails: ()=>{}, onSelectInvoice: ()=>{}, selectedInvoiceIds: [], viewMode: 'list', currentPage: 1, totalPages: 1, onPageChange: ()=>{}, parentVisibleColumns: {}, parentColumnDefinitions: [], onMarkAsPaid: ()=>{}, onEdit: ()=>{} })}</div>
                      {selectedInvoiceDetails.paymentDueDate && (<p><strong>{t('payment_due_date_dialog_title')}:</strong> {formatDateForDisplay(selectedInvoiceDetails.paymentDueDate, locale, t)}</p>)}
                   </div>
                  {selectedInvoiceDetails.errorMessage && selectedInvoiceDetails.status === 'error' && (<><Separator className="my-3"/><div className="space-y-1"><h3 className="text-md font-semibold text-destructive border-b pb-1">{t('invoice_details_error_message_label')}</h3><p className="text-destructive text-xs">{selectedInvoiceDetails.errorMessage}</p></div></>)}
                  <Separator className="my-3"/>
                  <div className="space-y-2">
                     <h3 className="text-md font-semibold text-primary border-b pb-1">{selectedInvoiceDetails.paymentStatus === 'paid' && selectedInvoiceDetails.paymentReceiptImageUri ? t('paid_invoices_receipt_image_label') : t('invoice_details_image_label')}</h3>
                      {isValidImageSrc(selectedInvoiceDetails._displayContext === 'image_only' ? (selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri) : (selectedInvoiceDetails.paymentStatus === 'paid' && selectedInvoiceDetails.paymentReceiptImageUri ? selectedInvoiceDetails.paymentReceiptImageUri : (selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri))) ? (
                        <NextImage src={selectedInvoiceDetails._displayContext === 'image_only' ? (selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri)! : (selectedInvoiceDetails.paymentStatus === 'paid' && selectedInvoiceDetails.paymentReceiptImageUri ? selectedInvoiceDetails.paymentReceiptImageUri! : (selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri)!)} alt={t('invoice_details_image_alt', { fileName: selectedInvoiceDetails.originalFileName || selectedInvoiceDetails.generatedFileName || '' })} width={800} height={1100} className="rounded-md object-contain mx-auto" data-ai-hint="invoice document" />
                        ) : (<div className="text-muted-foreground text-center py-4 flex flex-col items-center"><ImageIconLucide className="h-10 w-10 mb-2"/><p>{selectedInvoiceDetails.paymentStatus === 'paid' ? t('paid_invoices_no_receipt_image_available') : t('invoice_details_no_image_available')}</p></div>)}
                  </div>
                </>
              )}
              </div>
            </ScrollArea>
          )}
          <SheetFooter className="p-4 sm:p-6 border-t flex flex-col sm:flex-row gap-2 shrink-0 sticky bottom-0 bg-background z-10">
            {selectedInvoiceDetails && selectedInvoiceDetails._displayContext !== 'image_only' && (<>
                {isEditingDetails ? (<><Button variant="outline" onClick={() => setIsEditingDetails(false)} disabled={isSavingDetails}>{t('cancel_button')}</Button><Button onClick={handleSaveInvoiceDetails} disabled={isSavingDetails}>{isSavingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{isSavingDetails ? t('saving_button') : t('save_changes_button')}</Button></>)
                : (<Button variant="outline" onClick={() => setIsEditingDetails(true)}><Edit className="mr-2 h-4 w-4" /> {t('invoices_edit_details_button')}</Button>)}
                <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={isDeleting || isSavingDetails}><Trash2 className="mr-2 h-4 w-4" /> {t('invoices_delete_button')}</Button></AlertDialogTrigger>
                    <AlertDialogContentComponent><AlertDialogHeaderComponent><AlertDialogTitleComponent>{t('invoices_delete_confirm_title')}</AlertDialogTitleComponent><AlertDialogDescriptionComponent>{t('invoices_delete_confirm_desc', {fileName: selectedInvoiceDetails?.originalFileName || selectedInvoiceDetails?.generatedFileName || '' })}</AlertDialogDescriptionComponent></AlertDialogHeaderComponent>
                        <AlertDialogFooterComponent><AlertDialogCancel disabled={isDeleting}>{t('cancel_button')}</AlertDialogCancel><AlertDialogAction onClick={() => selectedInvoiceDetails && handleDeleteInvoice(selectedInvoiceDetails.id)} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>{isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{t('invoices_delete_confirm_action')}</AlertDialogAction></AlertDialogFooterComponent>
                    </AlertDialogContentComponent>
                </AlertDialog>
                 {activeTab === 'scanned-docs' && selectedInvoiceDetails.paymentStatus !== 'paid' && (<Button variant="outline" onClick={() => {if(selectedInvoiceDetails) { setInvoiceForReceiptUpload(selectedInvoiceDetails); setShowReceiptUploadDialog(true);}}}><Receipt className="mr-2 h-4 w-4" /> {t('paid_invoices_mark_as_paid_button')}</Button>)}
                 {activeTab === 'paid-invoices' && selectedInvoiceDetails.paymentStatus === 'paid' && (<Button variant="outline" onClick={() => {if(selectedInvoiceDetails) { setInvoiceForReceiptUpload(selectedInvoiceDetails); setShowReceiptUploadDialog(true);}}}><Receipt className="mr-2 h-4 w-4" /> {t('paid_invoices_update_receipt_button')}</Button>)}
            </>)}
            <SheetClose asChild><Button variant="outline" className="sm:ml-auto">{t('invoices_close_button')}</Button></SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

    <AlertDialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <AlertDialogContentComponent><AlertDialogHeaderComponent><AlertDialogTitleComponent>{t('invoice_export_dialog_title')}</AlertDialogTitleComponent><AlertDialogDescriptionComponent>{t('invoice_export_dialog_desc', { count: selectedForBulkAction.length })}</AlertDialogDescriptionComponent></AlertDialogHeaderComponent>
            <form onSubmit={handleExportSubmit} className="space-y-4">
                <div><Label htmlFor="accountantEmail" className="text-sm font-medium">{t('invoice_export_email_label')} <span className="text-destructive">*</span></Label><Input id="accountantEmail" type="email" value={accountantEmail} onChange={(e) => setAccountantEmail(e.target.value)} placeholder={t('invoice_export_email_placeholder')} required className="mt-1"/></div>
                <div><Label htmlFor="emailNote" className="text-sm font-medium">{t('invoice_export_note_label')}</Label><Textarea id="emailNote" value={emailNote} onChange={(e) => setEmailNote(e.target.value)} placeholder={t('invoice_export_note_placeholder')} className="mt-1"/></div>
                <AlertDialogFooterComponent><AlertDialogCancel onClick={() => setShowExportDialog(false)} disabled={isExporting}>{t('cancel_button')}</AlertDialogCancel><Button type="submit" disabled={isExporting} className="bg-primary hover:bg-primary/90">{isExporting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('sending')}</>) : (<><MailIcon className="mr-2 h-4 w-4" />{t('invoice_export_send_email_button')}</>)}</Button></AlertDialogFooterComponent>
            </form>
        </AlertDialogContentComponent>
    </AlertDialog>

    {showReceiptUploadDialog && invoiceForReceiptUpload && (
        <PaymentReceiptUploadDialog
            isOpen={showReceiptUploadDialog}
            onOpenChange={(isOpen) => { setShowReceiptUploadDialog(isOpen); if (!isOpen) setInvoiceForReceiptUpload(null); }}
            invoiceFileName={invoiceForReceiptUpload.originalFileName || invoiceForReceiptUpload.generatedFileName || ''}
            onConfirmUpload={async (receiptUri) => { await handleConfirmReceiptUpload(receiptUri); }}
        />
    )}
    </div>
  );
}

    