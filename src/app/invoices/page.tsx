
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
 } from '@/components/ui/dropdown-menu';
 import { Card, CardContent, CardDescription, CardHeader, CardFooter, CardTitle } from '@/components/ui/card';
 import { Search, Filter, ChevronDown, Loader2, CheckCircle, XCircle, Clock, Image as ImageIcon, Info, Download, Trash2, Edit, Save, List, Grid, FileTextIcon, Briefcase, Eye } from 'lucide-react';
 import { useRouter } from 'next/navigation';
 import { useToast } from '@/hooks/use-toast';
 import { DateRange } from 'react-day-picker';
 import { Calendar } from '@/components/ui/calendar';
 import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
 import { format, parseISO } from 'date-fns';
 import { cn } from '@/lib/utils';
 import { Calendar as CalendarIcon } from 'lucide-react';
 import { InvoiceHistoryItem, getInvoicesService, deleteInvoiceService, updateInvoiceService, getSupplierSummariesService, SupplierSummary } from '@/services/backend';
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
  AlertDialogContent as AlertDialogContentComponent, // Renamed to avoid conflict
  AlertDialogDescription as AlertDialogDescriptionComponent, // Renamed
  AlertDialogFooter as AlertDialogFooterComponent, // Renamed
  AlertDialogHeader as AlertDialogHeaderComponent, // Renamed
  AlertDialogTitle as AlertDialogTitleComponent, // Renamed
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSmartTouch } from '@/hooks/useSmartTouch'; // Corrected path
import { useTranslation } from '@/hooks/useTranslation';


const formatNumber = (
    value: number | undefined | null,
    t: (key: string, params?: Record<string, string | number>) => string,
    options?: { decimals?: number, useGrouping?: boolean, currency?: boolean }
): string => {
    const { decimals = 2, useGrouping = false, currency = false } = options || {};

    if (value === null || value === undefined || isNaN(value)) {
        const zeroFormatted = (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
        });
        return currency ? `${t('currency_symbol')}${zeroFormatted}` : zeroFormatted;
    }

    const formattedValue = value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping,
    });
    return currency ? `${t('currency_symbol')}${formattedValue}` : formattedValue;
};

const isValidImageSrc = (src: string | undefined): src is string => {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://');
};


type SortKey = keyof InvoiceHistoryItem | '';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';

export default function InvoicesPage() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof InvoiceHistoryItem | 'actions', boolean>>({
    actions: true,
    id: false,
    fileName: true,
    uploadTime: false,
    status: true,
    invoiceNumber: false,
    supplier: true,
    totalAmount: true,
    errorMessage: false,
    invoiceDataUri: false,
    originalImagePreviewUri: false,
  });
  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<InvoiceHistoryItem['status'] | ''>('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [sortKey, setSortKey] = useState<SortKey>('uploadTime');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const router = useRouter();
  const { toast } = useToast();
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<InvoiceHistoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedInvoiceData, setEditedInvoiceData] = useState<Partial<InvoiceHistoryItem>>({});
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);

  const dropdownTriggerRef = useRef<HTMLButtonElement>(null);
  const { onTouchStart, onTouchMove, onTouchEnd } = useSmartTouch({
    onTap: (e) => {
      const target = e.target as HTMLElement;
      const trigger = target.closest('[data-radix-dropdown-menu-trigger]');
      if (trigger && dropdownTriggerRef.current && dropdownTriggerRef.current.contains(trigger)) {
        // Logic to handle tap if needed, though Radix UI usually handles this
      }
    }
  });


  const fetchSuppliers = useCallback(async () => {
    try {
      const summaries = await getSupplierSummariesService();
      setExistingSuppliers(summaries);
    } catch (error) {
      console.error("Failed to fetch suppliers for filter:", error);
      toast({
        title: t('invoices_toast_error_fetch_suppliers_title'),
        description: t('invoices_toast_error_fetch_suppliers_desc'),
        variant: "destructive",
      });
    }
  }, [toast, t]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);


    const fetchInvoices = useCallback(async () => {
      setIsLoading(true);
      try {
        let fetchedData = await getInvoicesService();

        let uniqueInvoicesMap = new Map<string, InvoiceHistoryItem>();
        fetchedData.forEach(invoice => {
            const existing = uniqueInvoicesMap.get(invoice.id);
            if (existing) {
                if ((invoice.originalImagePreviewUri && !existing.originalImagePreviewUri) ||
                    (invoice.originalImagePreviewUri && new Date(invoice.uploadTime).getTime() > new Date(existing.uploadTime).getTime())) {
                    uniqueInvoicesMap.set(invoice.id, invoice);
                } else if (!invoice.originalImagePreviewUri && existing.originalImagePreviewUri) {
                    // Keep existing if it has an image and the new one doesn't
                } else if (new Date(invoice.uploadTime).getTime() > new Date(existing.uploadTime).getTime()){
                     uniqueInvoicesMap.set(invoice.id, invoice);
                }
            } else {
                uniqueInvoicesMap.set(invoice.id, invoice);
            }
        });

        let filteredData = Array.from(uniqueInvoicesMap.values());


        if (filterSupplier) {
           filteredData = filteredData.filter(inv => inv.supplier === filterSupplier);
        }
        if (filterStatus) {
           filteredData = filteredData.filter(inv => inv.status === filterStatus);
        }
         if (dateRange?.from) {
            const startDate = new Date(dateRange.from);
            startDate.setHours(0, 0, 0, 0);
            filteredData = filteredData.filter(inv => new Date(inv.uploadTime) >= startDate);
         }
         if (dateRange?.to) {
            const endDate = new Date(dateRange.to);
            endDate.setHours(23, 59, 59, 999);
            filteredData = filteredData.filter(inv => new Date(inv.uploadTime) <= endDate);
         }

         if (sortKey) {
             filteredData.sort((a, b) => {
                 const valA = a[sortKey as keyof InvoiceHistoryItem];
                 const valB = b[sortKey as keyof InvoiceHistoryItem];
                 let comparison = 0;
                 if (sortKey === 'uploadTime') {
                     const dateA = valA instanceof Date ? valA.getTime() : new Date(valA as string).getTime();
                     const dateB = valB instanceof Date ? valB.getTime() : new Date(valB as string).getTime();
                     comparison = dateA - dateB;
                 } else if (typeof valA === 'number' && typeof valB === 'number') {
                     comparison = valA - valB;
                 } else if (typeof valA === 'string' && typeof valB === 'string') {
                     comparison = valA.localeCompare(valB);
                 } else {
                    if (valA == null && valB != null) comparison = 1;
                    else if (valA != null && valB == null) comparison = -1;
                    else comparison = 0;
                 }
                 return sortDirection === 'asc' ? comparison : comparison * -1;
             });
         }
        setInvoices(filteredData);
      } catch (error) {
        console.error("Failed to fetch invoices:", error);
        toast({
          title: t('invoices_toast_error_fetch_invoices_title'),
          description: t('invoices_toast_error_fetch_invoices_desc'),
          variant: "destructive",
        });
        setInvoices([]);
      } finally {
        setIsLoading(false);
      }
    }, [filterSupplier, filterStatus, dateRange, toast, sortKey, sortDirection, t]);


   useEffect(() => {
     fetchInvoices();
   }, [fetchInvoices]);


  const handleSort = (key: SortKey) => {
    if (!key) return;
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

   const filteredAndSortedInvoices = useMemo(() => {
    let result = [...invoices];
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(item =>
        item.fileName.toLowerCase().includes(lowerSearchTerm) ||
        (item.invoiceNumber && item.invoiceNumber.toLowerCase().includes(lowerSearchTerm)) ||
        (item.supplier && item.supplier.toLowerCase().includes(lowerSearchTerm))
      );
    }
    return result;
  }, [invoices, searchTerm]);


   const columnDefinitions: { key: keyof InvoiceHistoryItem | 'actions'; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean }[] = [
      { key: 'actions', labelKey: 'edit_invoice_th_actions', sortable: false, className: 'w-[5%] sm:w-[5%] text-center px-1 sm:px-2 sticky left-0 bg-card z-10' },
      { key: 'id', labelKey: 'inventory_col_id', sortable: true, className: "hidden" },
      { key: 'fileName', labelKey: 'upload_history_col_file_name', sortable: true, className: 'w-[20%] sm:w-[25%] min-w-[80px] sm:min-w-[100px] truncate' },
      { key: 'uploadTime', labelKey: 'upload_history_col_upload_time', sortable: true, className: 'min-w-[130px] sm:min-w-[150px]', mobileHidden: true },
      { key: 'status', labelKey: 'upload_history_col_status', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]' },
      { key: 'invoiceNumber', labelKey: 'invoices_col_inv_number', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
      { key: 'supplier', labelKey: 'invoice_details_supplier_label', sortable: true, className: 'min-w-[120px] sm:min-w-[150px]', mobileHidden: true },
      { key: 'totalAmount', labelKey: 'invoices_col_total_currency', sortable: true, className: 'text-right min-w-[100px] sm:min-w-[120px]' },
      { key: 'errorMessage', labelKey: 'invoice_details_error_message_label', sortable: false, className: 'text-xs text-destructive max-w-xs truncate hidden' },
      { key: 'invoiceDataUri', labelKey: 'invoices_col_image_uri', sortable: false, className: 'hidden' },
      { key: 'originalImagePreviewUri', labelKey: 'invoices_col_preview_uri', sortable: false, className: 'hidden' },
   ];

    const visibleColumnHeaders = columnDefinitions.filter(h => visibleColumns[h.key] && h.key !== 'invoiceDataUri' && h.key !== 'originalImagePreviewUri' && h.key !== 'id' && h.key !== 'errorMessage');

   const formatDate = (date: Date | string | undefined) => {
     if (!date) return t('edit_invoice_unknown_document'); // or a more generic N/A
     try {
        const dateObj = typeof date === 'string' ? parseISO(date) : date;
        if (isNaN(dateObj.getTime())) return t('invoices_invalid_date');
        return window.innerWidth < 640
             ? format(dateObj, 'dd/MM/yy')
             : dateObj.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
     } catch (e) {
       console.error("Error formatting date:", e, "Input:", date);
       return t('invoices_invalid_date');
     }
   };

   const toggleColumnVisibility = (key: keyof InvoiceHistoryItem | 'actions') => {
       setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
   };

   const handleViewDetails = (invoice: InvoiceHistoryItem) => {
    setSelectedInvoiceDetails(invoice);
    setEditedInvoiceData({ ...invoice });
    setIsEditingDetails(false);
    setShowDetailsSheet(true);
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    setIsDeleting(true);
    try {
        await deleteInvoiceService(invoiceId);
        toast({
            title: t('invoices_toast_deleted_title'),
            description: t('invoices_toast_deleted_desc'),
        });
        fetchInvoices();
        setShowDetailsSheet(false);
        setSelectedInvoiceDetails(null);
    } catch (error) {
        console.error("Failed to delete invoice:", error);
        toast({
            title: t('invoices_toast_delete_fail_title'),
            description: t('invoices_toast_delete_fail_desc'),
            variant: "destructive",
        });
    } finally {
        setIsDeleting(false);
    }
  };

  const handleEditDetailsInputChange = (field: keyof InvoiceHistoryItem, value: string | number ) => {
    setEditedInvoiceData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveInvoiceDetails = async () => {
    if (!selectedInvoiceDetails || !selectedInvoiceDetails.id) return;
    setIsSavingDetails(true);
    try {
        const updatedInvoice: Partial<InvoiceHistoryItem> = {
            fileName: editedInvoiceData.fileName || selectedInvoiceDetails.fileName,
            invoiceNumber: editedInvoiceData.invoiceNumber || undefined,
            supplier: editedInvoiceData.supplier || undefined,
            totalAmount: typeof editedInvoiceData.totalAmount === 'number' ? editedInvoiceData.totalAmount : undefined,
            errorMessage: editedInvoiceData.errorMessage || undefined,
            // Status and originalImagePreviewUri are not user-editable here
        };

        await updateInvoiceService(selectedInvoiceDetails.id, updatedInvoice);
        toast({
            title: t('invoices_toast_updated_title'),
            description: t('invoices_toast_updated_desc'),
        });
        setIsEditingDetails(false);
        const refreshedInvoice = await getInvoicesService().then(all => all.find(inv => inv.id === selectedInvoiceDetails.id));
        if (refreshedInvoice) {
            setSelectedInvoiceDetails(refreshedInvoice);
        } else {
           setShowDetailsSheet(false);
           fetchInvoices();
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


  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }


  const renderStatusBadge = (status: InvoiceHistoryItem['status']) => {
     let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
     let className = '';
     let icon = null;

     switch (status) {
         case 'completed':
             variant = 'secondary';
             className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80';
             icon = <CheckCircle className="mr-1 h-3 w-3" />;
             break;
         case 'processing':
              variant = 'secondary';
             className = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse hover:bg-blue-100/80';
             icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />;
             break;
         case 'pending':
              variant = 'secondary';
             className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80';
             icon = <Clock className="mr-1 h-3 w-3" />;
             break;
         case 'error':
             variant = 'destructive';
             icon = <XCircle className="mr-1 h-3 w-3" />;
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

    const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) {
          return '';
        }
         if (value instanceof Date) {
            try { return value.toISOString(); } catch { return t('invoices_invalid_date'); }
         }
         if (typeof value === 'number') {
             return formatNumber(value, t, { decimals: 2, useGrouping: false });
         }
        let stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          stringValue = stringValue.replace(/"/g, '""');
          return `"${stringValue}"`;
        }
        return stringValue;
      };

    const handleExportInvoices = () => {
        if (filteredAndSortedInvoices.length === 0) {
            toast({ title: t('invoices_export_csv_no_data_title'), description: t('invoices_export_csv_no_data_desc') });
            return;
        }
        const exportColumns: (keyof InvoiceHistoryItem)[] = [
            'id', 'fileName', 'uploadTime', 'status', 'invoiceNumber', 'supplier', 'totalAmount', 'errorMessage'
        ];
        const headers = exportColumns
            .map(key => t(columnDefinitions.find(col => col.key === key)?.labelKey || key as any))
            .map(escapeCsvValue)
            .join(',');
        const rows = filteredAndSortedInvoices.map(item => {
            return exportColumns.map(key => escapeCsvValue(item[key])).join(',');
        });
        const csvContent = [headers, ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'invoices_export.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast({ title: t('invoices_export_csv_started_title'), description: t('invoices_export_csv_started_desc') });
    };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <FileTextIcon className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('invoices_title')}
            </CardTitle>
            <div className="flex items-center gap-2"
                 onTouchStart={onTouchStart}
                 onTouchMove={onTouchMove}
                 onTouchEnd={onTouchEnd}
            >
                <Button
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => setViewMode('list')}
                    aria-label={t('invoices_list_view_aria')}
                    title={t('invoices_list_view_title')}
                >
                    <List className="h-5 w-5" />
                </Button>
                <Button
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => setViewMode('grid')}
                    aria-label={t('invoices_grid_view_aria')}
                    title={t('invoices_grid_view_title')}
                >
                    <Grid className="h-5 w-5" />
                </Button>
            </div>
          </div>
          <CardDescription>{t('invoices_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6 flex-wrap"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
          >
            <div className="relative w-full md:max-w-xs lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('inventory_search_placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                aria-label={t('invoices_search_aria')}
              />
            </div>
            <div className="flex gap-2 flex-wrap justify-start md:justify-end"
                 onTouchStart={onTouchStart}
                 onTouchMove={onTouchMove}
                 onTouchEnd={onTouchEnd}
            >
                 <Popover>
                   <PopoverTrigger asChild>
                     <Button
                       ref={dropdownTriggerRef}
                       id="invoiceDate"
                       variant={"outline"}
                       className={cn(
                         "w-full sm:w-[260px] justify-start text-left font-normal",
                         !dateRange && "text-muted-foreground",
                         "touch-manipulation"
                       )}
                       aria-label={t('invoices_date_range_aria')}

                     >
                       <CalendarIcon className="mr-2 h-4 w-4" />
                       {dateRange?.from ? (
                         dateRange.to ? (
                           <>
                             {format(dateRange.from, "PP")} - {format(dateRange.to, "PP")}
                           </>
                         ) : (
                           format(dateRange.from, "PP")
                         )
                       ) : (
                         <span>{t('reports_date_range_placeholder')}</span>
                       )}
                     </Button>
                   </PopoverTrigger>
                   <PopoverContent className="w-auto p-0" align="end">
                     <Calendar
                       initialFocus
                       mode="range"
                       defaultMonth={dateRange?.from}
                       selected={dateRange}
                       onSelect={setDateRange}
                       numberOfMonths={1}
                       className="sm:block hidden"
                     />
                       <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={dateRange?.from}
                        selected={dateRange}
                        onSelect={setDateRange}
                        numberOfMonths={2}
                        className="hidden sm:block"
                     />
                     {dateRange && (
                        <div className="p-2 border-t flex justify-end">
                             <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>{t('reports_date_range_clear')}</Button>
                        </div>
                     )}
                   </PopoverContent>
                 </Popover>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button ref={dropdownTriggerRef} variant="outline" className="flex-1 md:flex-initial touch-manipulation" aria-label={t('invoices_filter_supplier_aria', { filterSupplier: filterSupplier || t('invoices_filter_supplier_all')})} >
                    <Briefcase className="mr-2 h-4 w-4" />
                    {existingSuppliers.find(s => s.name === filterSupplier)?.name || t('invoice_details_supplier_label')}
                    <ChevronDown className="ml-auto md:ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t('invoices_filter_supplier_label')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={!filterSupplier}
                    onCheckedChange={() => setFilterSupplier('')}
                  >
                    {t('invoices_filter_supplier_all')}
                  </DropdownMenuCheckboxItem>
                  {existingSuppliers.map((supplier) => (
                    <DropdownMenuCheckboxItem
                      key={supplier.name}
                      checked={filterSupplier === supplier.name}
                      onCheckedChange={() => setFilterSupplier(supplier.name)}
                    >
                      {supplier.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button ref={dropdownTriggerRef} variant="outline" className="flex-1 md:flex-initial touch-manipulation" aria-label={t('invoices_filter_status_aria', { filterStatus: filterStatus ? t(`invoice_status_${filterStatus}` as any) : t('invoices_filter_status_all')})} >
                    <Filter className="mr-2 h-4 w-4" />
                    {filterStatus ? t(`invoice_status_${filterStatus}` as any) : t('upload_history_col_status')}
                    <ChevronDown className="ml-auto md:ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t('invoices_filter_status_label')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={!filterStatus} onCheckedChange={() => setFilterStatus('')}>{t('invoices_filter_status_all')}</DropdownMenuCheckboxItem>
                  {(['completed', 'processing', 'pending', 'error'] as InvoiceHistoryItem['status'][]).map((status) => (
                    <DropdownMenuCheckboxItem
                      key={status}
                      checked={filterStatus === status}
                      onCheckedChange={() => setFilterStatus(status)}
                    >
                      {t(`invoice_status_${status}` as any)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

             {viewMode === 'list' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button ref={dropdownTriggerRef} variant="outline" className="flex-1 md:flex-initial touch-manipulation" aria-label={t('invoices_view_aria')} >
                      <Eye className="mr-2 h-4 w-4" /> {t('inventory_view_button')}
                      <ChevronDown className="ml-auto md:ml-2 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{t('inventory_toggle_columns_label')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {columnDefinitions.filter(h => h.key !== 'id' && h.key !== 'errorMessage' && h.key !== 'invoiceDataUri' && h.key !== 'originalImagePreviewUri' && h.key !== 'actions').map((header) => (
                      <DropdownMenuCheckboxItem
                        key={header.key}
                        className="capitalize"
                        checked={visibleColumns[header.key]}
                        onCheckedChange={() => toggleColumnVisibility(header.key)}
                      >
                        {t(header.labelKey as any)}
                      </DropdownMenuCheckboxItem>
                    ))}
                    <DropdownMenuCheckboxItem
                        key="errorMessage"
                        className="capitalize"
                        checked={visibleColumns.errorMessage}
                        onCheckedChange={() => toggleColumnVisibility('errorMessage')}
                      >
                        {t(columnDefinitions.find(h => h.key === 'errorMessage')?.labelKey as any) || 'Error Message'}
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

               <Button variant="outline" onClick={handleExportInvoices} className="flex-1 md:flex-initial">
                 <Download className="mr-2 h-4 w-4" /> {t('inventory_export_csv_button')}
               </Button>
            </div>
          </div>

          {viewMode === 'list' ? (
            <div className="overflow-x-auto relative">
              <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    {visibleColumnHeaders.map((header) => (
                      <TableHead
                        key={header.key}
                        className={cn(
                            header.className,
                            header.sortable && "cursor-pointer hover:bg-muted/50",
                            header.mobileHidden ? 'hidden sm:table-cell' : 'table-cell',
                            'px-2 sm:px-4 py-2',
                            header.key === 'actions' && 'sticky left-0 bg-card z-10'
                        )}
                        onClick={() => header.sortable && handleSort(header.key as SortKey)}
                        aria-sort={header.sortable ? (sortKey === header.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                      >
                        <div className="flex items-center gap-1 whitespace-nowrap">
                           {t(header.labelKey as any, { currency_symbol: t('currency_symbol') })}
                           {header.sortable && sortKey === header.key && (
                              <span className="text-xs" aria-hidden="true">
                                 {sortDirection === 'asc' ? '▲' : '▼'}
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
                      <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center px-2 sm:px-4 py-2">
                        <div className="flex justify-center items-center">
                           <Loader2 className="h-6 w-6 animate-spin text-primary" />
                           <span className="ml-2">{t('invoices_loading')}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : filteredAndSortedInvoices.length === 0 ? (
                    <TableRow>
                       <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center px-2 sm:px-4 py-2">
                         {t('invoices_no_invoices_found')}
                       </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedInvoices.map((item) => (
                      <TableRow key={item.id} className="hover:bg-muted/50" data-testid={`invoice-item-${item.id}`}>
                          {visibleColumns.actions && (
                             <TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-0 bg-card z-10", columnDefinitions.find(h => h.key === 'actions')?.className)}>
                                 <Button
                                     variant="ghost"
                                     size="icon"
                                     className="text-primary hover:text-primary/80 h-7 w-7"
                                     onClick={() => handleViewDetails(item)}
                                     title={t('invoices_view_details_title', { fileName: item.fileName })}
                                     aria-label={t('invoices_view_details_aria', { fileName: item.fileName })}
                                 >
                                     <Info className="h-4 w-4" />
                                 </Button>
                             </TableCell>
                         )}
                         {visibleColumns.fileName && (
                            <TableCell className={cn("font-medium px-2 sm:px-4 py-2", columnDefinitions.find(h => h.key === 'fileName')?.className)}>
                               <Button
                                  variant="link"
                                  className="p-0 h-auto text-left font-medium cursor-pointer hover:underline truncate"
                                  onClick={() => handleViewDetails(item)}
                                  title={t('invoices_view_details_title', { fileName: item.fileName })}
                                >
                                  {item.fileName}
                              </Button>
                            </TableCell>
                         )}
                         {visibleColumns.uploadTime && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'uploadTime')?.mobileHidden && 'hidden sm:table-cell')}>{formatDate(item.uploadTime)}</TableCell>}
                         {visibleColumns.status && (
                           <TableCell className="px-2 sm:px-4 py-2">
                              {renderStatusBadge(item.status)}
                           </TableCell>
                         )}
                         {visibleColumns.invoiceNumber && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'invoiceNumber')?.mobileHidden && 'hidden sm:table-cell')}>{item.invoiceNumber || t('invoices_na')}</TableCell>}
                         {visibleColumns.supplier && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'supplier')?.mobileHidden && 'hidden sm:table-cell')}>{item.supplier || t('invoices_na')}</TableCell>}
                         {visibleColumns.totalAmount && (
                           <TableCell className="text-right px-2 sm:px-4 py-2 whitespace-nowrap">
                              {item.totalAmount !== undefined && item.totalAmount !== null ? formatNumber(item.totalAmount, t, { currency: true }) : t('invoices_na')}
                           </TableCell>
                         )}
                         {visibleColumns.errorMessage && (
                           <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'errorMessage')?.className)}>
                               {item.status === 'error' ? item.errorMessage : t('invoices_na')}
                           </TableCell>
                         )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" style={{ gridAutoRows: 'minmax(150px, auto)' }}>
              {isLoading ? (
                 Array.from({ length: 8 }).map((_, index) => (
                    <Card key={index} className="animate-pulse">
                        <CardHeader className="h-32 bg-muted rounded-t-lg" />
                        <CardContent className="p-4 space-y-2">
                            <div className="h-4 bg-muted rounded w-3/4" />
                            <div className="h-3 bg-muted rounded w-1/2" />
                            <div className="h-3 bg-muted rounded w-1/4" />
                        </CardContent>
                    </Card>
                 ))
              ) : filteredAndSortedInvoices.length === 0 ? (
                <p className="col-span-full text-center text-muted-foreground py-10">{t('invoices_no_invoices_found')}</p>
              ) : (
                filteredAndSortedInvoices.map((item) => (
                  <Card key={item.id} className="flex flex-col overflow-hidden cursor-pointer hover:shadow-lg transition-shadow scale-fade-in" onClick={() => handleViewDetails(item)}>
                    <CardHeader className="p-0 relative aspect-[4/3]">
                      {isValidImageSrc(item.originalImagePreviewUri) ? (
                        <NextImage
                          src={item.originalImagePreviewUri}
                          alt={t('invoices_preview_alt', { fileName: item.fileName })}
                          layout="fill"
                          objectFit="cover"
                          className="rounded-t-lg"
                          data-ai-hint="invoice document"
                        />
                      ) : (
                        <div className="w-full h-full bg-muted rounded-t-lg flex items-center justify-center">
                          <ImageIcon className="h-12 w-12 text-muted-foreground" />
                        </div>
                      )}
                       <div className="absolute top-2 right-2">
                          {renderStatusBadge(item.status)}
                       </div>
                    </CardHeader>
                    <CardContent className="p-3 flex-grow">
                      <CardTitle className="text-sm font-semibold truncate" title={item.fileName}>{item.fileName}</CardTitle>
                      <p className="text-xs text-muted-foreground">{formatDate(item.uploadTime)}</p>
                       {item.supplier && <p className="text-xs text-muted-foreground">{t('invoice_details_supplier_label')}: {item.supplier}</p>}
                       {item.totalAmount !== undefined && <p className="text-xs font-medium">{t('invoices_col_total')}: {formatNumber(item.totalAmount, t, { currency: true })}</p>}
                    </CardContent>
                     <CardFooter className="p-3 border-t">
                        <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={(e) => { e.stopPropagation(); handleViewDetails(item); }}>
                            <Info className="mr-1.5 h-3.5 w-3.5"/> {t('invoices_view_details_button')}
                        </Button>
                     </CardFooter>
                  </Card>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={showDetailsSheet} onOpenChange={setShowDetailsSheet}>
        <SheetContent side="bottom" className="h-[85vh] sm:h-[90vh] flex flex-col p-0 rounded-t-lg">
          <SheetHeader className="p-4 sm:p-6 border-b shrink-0 sticky top-0 bg-background z-10">
             <SheetTitle>{isEditingDetails ? t('invoices_edit_details_title') : t('invoice_details_title')}</SheetTitle>
             <SheetDescription>
                {isEditingDetails ? t('invoices_edit_details_desc', { fileName: selectedInvoiceDetails?.fileName || '' }) : t('invoice_details_description', { fileName: selectedInvoiceDetails?.fileName || '' })}
             </SheetDescription>
          </SheetHeader>
          {selectedInvoiceDetails && (
            <ScrollArea className="flex-grow">
              <div className="p-4 sm:p-6 space-y-4">
              {isEditingDetails ? (
                <div className="space-y-3">
                    <div>
                        <Label htmlFor="editFileName">{t('invoice_details_file_name_label')}</Label>
                        <Input id="editFileName" value={editedInvoiceData.fileName || ''} onChange={(e) => handleEditDetailsInputChange('fileName', e.target.value)} disabled={isSavingDetails}/>
                    </div>
                    <div>
                        <Label htmlFor="editInvoiceNumber">{t('invoice_details_invoice_number_label')}</Label>
                        <Input id="editInvoiceNumber" value={editedInvoiceData.invoiceNumber || ''} onChange={(e) => handleEditDetailsInputChange('invoiceNumber', e.target.value)} disabled={isSavingDetails}/>
                    </div>
                    <div>
                        <Label htmlFor="editSupplier">{t('invoice_details_supplier_label')}</Label>
                        <Input id="editSupplier" value={editedInvoiceData.supplier || ''} onChange={(e) => handleEditDetailsInputChange('supplier', e.target.value)} disabled={isSavingDetails}/>
                    </div>
                    <div>
                        <Label htmlFor="editTotalAmount">{t('invoices_col_total_currency', { currency_symbol: t('currency_symbol') })}</Label>
                        <Input id="editTotalAmount" type="number" value={editedInvoiceData.totalAmount || 0} onChange={(e) => handleEditDetailsInputChange('totalAmount', parseFloat(e.target.value))} disabled={isSavingDetails}/>
                    </div>
                    {selectedInvoiceDetails.status === 'error' && (
                        <div>
                            <Label htmlFor="editErrorMessage">{t('invoice_details_error_message_label')}</Label>
                            <Textarea id="editErrorMessage" value={editedInvoiceData.errorMessage || ''} onChange={(e) => handleEditDetailsInputChange('errorMessage', e.target.value)} disabled={isSavingDetails}/>
                        </div>
                    )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p><strong>{t('invoice_details_file_name_label')}:</strong> {selectedInvoiceDetails.fileName}</p>
                      <p><strong>{t('invoice_details_upload_time_label')}:</strong> {formatDate(selectedInvoiceDetails.uploadTime)}</p>
                      <div className="flex items-center">
                        <strong className="mr-1">{t('invoice_details_status_label')}:</strong> {renderStatusBadge(selectedInvoiceDetails.status)}
                      </div>
                    </div>
                    <div>
                      <p><strong>{t('invoice_details_invoice_number_label')}:</strong> {selectedInvoiceDetails.invoiceNumber || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_supplier_label')}:</strong> {selectedInvoiceDetails.supplier || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_total_amount_label')}:</strong> {selectedInvoiceDetails.totalAmount !== undefined ? formatNumber(selectedInvoiceDetails.totalAmount, t, { currency: true }) : t('invoices_na')}</p>
                    </div>
                  </div>
                  {selectedInvoiceDetails.errorMessage && (
                    <div className="mt-2">
                      <p className="font-semibold text-destructive">{t('invoice_details_error_message_label')}:</p>
                      <p className="text-destructive text-xs">{selectedInvoiceDetails.errorMessage}</p>
                    </div>
                  )}
                  <Separator className="my-4"/>
                  <div className="overflow-auto max-h-[calc(85vh-280px)] sm:max-h-[calc(90vh-300px)]">
                  {isValidImageSrc(selectedInvoiceDetails.originalImagePreviewUri) ? (
                    <NextImage
                        src={selectedInvoiceDetails.originalImagePreviewUri}
                        alt={t('invoices_preview_alt', { fileName: selectedInvoiceDetails.fileName })}
                        width={800}
                        height={1100}
                        className="rounded-md object-contain mx-auto"
                        data-ai-hint="invoice document"
                    />
                    ) : (
                    <p className="text-muted-foreground text-center py-4">{t('invoice_details_no_image_available')}</p>
                    )}
                  </div>
                </>
              )}
              </div>
            </ScrollArea>
          )}
          <SheetFooter className="p-4 sm:p-6 border-t flex flex-col sm:flex-row gap-2 shrink-0 sticky bottom-0 bg-background z-10">
            {selectedInvoiceDetails && (
                <>
                    {isEditingDetails ? (
                        <>
                            <Button variant="outline" onClick={() => setIsEditingDetails(false)} disabled={isSavingDetails}>{t('cancel_button')}</Button>
                            <Button onClick={handleSaveInvoiceDetails} disabled={isSavingDetails}>
                                {isSavingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                {isSavingDetails ? t('saving_button') : t('save_changes_button')}
                            </Button>
                        </>
                    ) : (
                        <Button variant="outline" onClick={() => setIsEditingDetails(true)}>
                            <Edit className="mr-2 h-4 w-4" /> {t('invoices_edit_details_button')}
                        </Button>
                    )}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={isDeleting || isSavingDetails}>
                                <Trash2 className="mr-2 h-4 w-4" /> {t('invoices_delete_button')}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContentComponent>
                            <AlertDialogHeaderComponent>
                                <AlertDialogTitleComponent>{t('invoices_delete_confirm_title')}</AlertDialogTitleComponent>
                                <AlertDialogDescriptionComponent>
                                    {t('invoices_delete_confirm_desc', { fileName: selectedInvoiceDetails.fileName })}
                                </AlertDialogDescriptionComponent>
                            </AlertDialogHeaderComponent>
                            <AlertDialogFooterComponent>
                                <AlertDialogCancel disabled={isDeleting}>{t('cancel_button')}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteInvoice(selectedInvoiceDetails.id)} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>
                                    {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {t('invoices_delete_confirm_action')}
                                </AlertDialogAction>
                            </AlertDialogFooterComponent>
                        </AlertDialogContentComponent>
                    </AlertDialog>
                </>
            )}
            <SheetClose asChild>
                 <Button variant="outline" className="sm:ml-auto">{t('invoices_close_button')}</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

    </div>
  );
}
