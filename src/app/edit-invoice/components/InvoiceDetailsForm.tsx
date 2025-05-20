import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { EditableTaxInvoiceDetails } from '../types';
import { Timestamp } from 'firebase/firestore';
import { format, parseISO, isValid } from 'date-fns';

interface InvoiceDetailsFormProps {
  editableTaxInvoiceDetails: EditableTaxInvoiceDetails;
  handleTaxInvoiceDetailsChange: (field: keyof EditableTaxInvoiceDetails, value: string | number | undefined | Date | Timestamp) => void;
  isSaving: boolean;
  selectedPaymentDueDate?: Date; // Could be managed here or passed in
  onSelectedPaymentDueDateChange?: (date: Date | undefined) => void; // If managed by parent
  t: (key: string, params?: Record<string, string | number>) => string;
}

export function InvoiceDetailsForm({
  editableTaxInvoiceDetails,
  handleTaxInvoiceDetailsChange,
  isSaving,
  selectedPaymentDueDate, // Use this if it's the source of truth for the input
  onSelectedPaymentDueDateChange,
  t
}: InvoiceDetailsFormProps) {

  const paymentDueDateValue = selectedPaymentDueDate
    ? format(selectedPaymentDueDate, 'yyyy-MM-dd')
    : editableTaxInvoiceDetails.paymentDueDate
      ? (
          editableTaxInvoiceDetails.paymentDueDate instanceof Timestamp ? format(editableTaxInvoiceDetails.paymentDueDate.toDate(), 'yyyy-MM-dd')
          : typeof editableTaxInvoiceDetails.paymentDueDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.paymentDueDate)) ? format(parseISO(editableTaxInvoiceDetails.paymentDueDate), 'yyyy-MM-dd')
          : editableTaxInvoiceDetails.paymentDueDate instanceof Date && isValid(editableTaxInvoiceDetails.paymentDueDate) ? format(editableTaxInvoiceDetails.paymentDueDate, 'yyyy-MM-dd')
          : ''
        )
      : '';

  const invoiceDateValue = editableTaxInvoiceDetails.invoiceDate
      ? (
          editableTaxInvoiceDetails.invoiceDate instanceof Timestamp ? format(editableTaxInvoiceDetails.invoiceDate.toDate(), 'yyyy-MM-dd')
          : typeof editableTaxInvoiceDetails.invoiceDate === 'string' && isValid(parseISO(editableTaxInvoiceDetails.invoiceDate)) ? format(parseISO(editableTaxInvoiceDetails.invoiceDate), 'yyyy-MM-dd')
          : editableTaxInvoiceDetails.invoiceDate instanceof Date && isValid(editableTaxInvoiceDetails.invoiceDate) ? format(editableTaxInvoiceDetails.invoiceDate, 'yyyy-MM-dd')
          : ''
        )
      : '';


  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="taxSupplierName">{t('invoice_details_supplier_label')}</Label>
        <Input
          id="taxSupplierName"
          value={editableTaxInvoiceDetails.supplierName || ''}
          onChange={(e) => handleTaxInvoiceDetailsChange('supplierName', e.target.value)}
          disabled={isSaving}
        />
      </div>
      <div>
        <Label htmlFor="taxInvoiceNumber">{t('invoice_details_invoice_number_label')}</Label>
        <Input
          id="taxInvoiceNumber"
          value={editableTaxInvoiceDetails.invoiceNumber || ''}
          onChange={(e) => handleTaxInvoiceDetailsChange('invoiceNumber', e.target.value)}
          disabled={isSaving}
        />
      </div>
      <div>
        <Label htmlFor="taxTotalAmount">{t('invoice_details_total_amount_label')}</Label>
        <Input
          id="taxTotalAmount"
          type="number"
          value={editableTaxInvoiceDetails.totalAmount ?? ''}
          onChange={(e) => handleTaxInvoiceDetailsChange('totalAmount', e.target.value === '' ? undefined : parseFloat(e.target.value))}
          disabled={isSaving}
        />
      </div>
      <div>
        <Label htmlFor="taxInvoiceDate">{t('invoice_details_invoice_date_label')}</Label>
        <Input
          id="taxInvoiceDate"
          type="date"
          value={invoiceDateValue}
          onChange={(e) => handleTaxInvoiceDetailsChange('invoiceDate', e.target.value ? parseISO(e.target.value) : undefined)} // Store as Date object or ISO string
          disabled={isSaving}
        />
      </div>
      <div>
        <Label htmlFor="taxPaymentMethod">{t('invoice_details_payment_method_label')}</Label>
        <Select
          value={editableTaxInvoiceDetails.paymentMethod || ''}
          onValueChange={(value) => handleTaxInvoiceDetailsChange('paymentMethod', value)}
          disabled={isSaving}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder={t('invoice_details_payment_method_placeholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">{t('payment_method_cash')}</SelectItem>
            <SelectItem value="credit_card">{t('payment_method_credit_card')}</SelectItem>
            <SelectItem value="bank_transfer">{t('payment_method_bank_transfer')}</SelectItem>
            <SelectItem value="check">{t('payment_method_check')}</SelectItem>
            <SelectItem value="other">{t('payment_method_other')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="taxPaymentDueDate">{t('payment_due_date_dialog_title')}</Label>
        <Input
          id="taxPaymentDueDate"
          type="date"
          value={paymentDueDateValue}
          onChange={(e) => {
            const newDate = e.target.value ? parseISO(e.target.value) : undefined;
            if (onSelectedPaymentDueDateChange) onSelectedPaymentDueDateChange(newDate); // Update state if managed by parent
            handleTaxInvoiceDetailsChange('paymentDueDate', newDate); // Store as Date object or ISO string
          }}
          disabled={isSaving}
        />
      </div>
    </div>
  );
}