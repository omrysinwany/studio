// src/app/accounts/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2, CreditCard, AlertTriangle, CalendarClock } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getInvoicesService, type InvoiceHistoryItem } from '@/services/backend';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, differenceInCalendarDays, isPast, isToday, isWithinInterval, addDays } from 'date-fns';
import { cn } from '@/lib/utils';

export default function AccountsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [openInvoices, setOpenInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    } else if (user) {
      fetchOpenInvoices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router]);

  const fetchOpenInvoices = async () => {
    if (!user) return;
    setIsLoadingInvoices(true);
    try {
      const allInvoices = await getInvoicesService(user.id);
      const filteredInvoices = allInvoices
        .filter(invoice => invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'pending_payment')
        .sort((a, b) => {
          const dateA = a.paymentDueDate ? new Date(a.paymentDueDate).getTime() : Infinity;
          const dateB = b.paymentDueDate ? new Date(b.paymentDueDate).getTime() : Infinity;
          return dateA - dateB;
        });
      setOpenInvoices(filteredInvoices);
    } catch (error) {
      console.error("Failed to fetch open invoices:", error);
      // Consider adding a toast notification here
    } finally {
      setIsLoadingInvoices(false);
    }
  };

  const getDueDateStatus = (dueDate: string | Date | undefined): { textKey: string; params?: Record<string, any>; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon?: React.ElementType } | null => {
    if (!dueDate) return null;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDateObj = parseISO(dueDate as string);
     dueDateObj.setHours(0,0,0,0);

    if (isPast(dueDateObj) && !isToday(dueDateObj)) {
      return { textKey: 'accounts_due_date_overdue', variant: 'destructive', icon: AlertTriangle };
    }
    
    const daysUntilDue = differenceInCalendarDays(dueDateObj, today);

    if (daysUntilDue <= 0) { // Includes today
         return { textKey: 'accounts_due_date_due_today', variant: 'destructive', icon: AlertTriangle };
    }
    if (daysUntilDue <= 7) {
      return { textKey: 'accounts_due_date_upcoming_soon', params: { days: daysUntilDue }, variant: 'secondary', icon: CalendarClock };
    }
    
    return null; 
  };
  
  const formatDate = (dateString: string | Date | undefined) => {
    if (!dateString) return t('invoices_na');
    try {
      return format(parseISO(dateString as string), 'PP');
    } catch (e) {
      return t('invoices_invalid_date');
    }
  };

  if (authLoading || (!user && !authLoading)) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }
  if (!user) return null;


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md scale-fade-in">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary flex items-center">
            <CreditCard className="mr-2 h-6 w-6" /> {t('accounts_page_title')}
          </CardTitle>
          <CardDescription>{t('accounts_page_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t('settings_more_coming_soon')}</p>
        </CardContent>
      </Card>

      <Card className="shadow-md scale-fade-in delay-100">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary flex items-center">
            <AlertTriangle className="mr-2 h-5 w-5 text-amber-500" /> {t('accounts_open_invoices_title')}
          </CardTitle>
          <CardDescription>{t('accounts_open_invoices_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingInvoices ? (
            <div className="flex justify-center items-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
            </div>
          ) : openInvoices.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">{t('accounts_no_open_invoices')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('invoice_details_supplier_label')}</TableHead>
                    <TableHead>{t('invoice_details_invoice_number_label')}</TableHead>
                    <TableHead className="text-right">{t('invoice_details_total_amount_label')}</TableHead>
                    <TableHead className="text-center">{t('payment_due_date_dialog_title')}</TableHead>
                    <TableHead className="text-center">{t('accounts_due_date_alert_column')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openInvoices.map((invoice) => {
                    const dueDateStatus = getDueDateStatus(invoice.paymentDueDate);
                    const IconComponent = dueDateStatus?.icon;
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{invoice.supplier || t('invoices_na')}</TableCell>
                        <TableCell>{invoice.invoiceNumber || t('invoices_na')}</TableCell>
                        <TableCell className="text-right">{invoice.totalAmount ? `${t('currency_symbol')}${invoice.totalAmount.toFixed(2)}` : t('invoices_na')}</TableCell>
                        <TableCell className="text-center">{formatDate(invoice.paymentDueDate)}</TableCell>
                        <TableCell className="text-center">
                          {dueDateStatus && (
                            <Badge variant={dueDateStatus.variant} className="text-xs">
                              {IconComponent && <IconComponent className="mr-1 h-3.5 w-3.5" />}
                              {t(dueDateStatus.textKey, dueDateStatus.params)}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
