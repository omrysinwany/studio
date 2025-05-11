// src/components/accounts/AddExpenseDialog.tsx
'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PlusCircle, X, CalendarIcon } from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { OtherExpense } from '@/app/accounts/page';
import { useTranslation } from '@/hooks/useTranslation';

interface AddExpenseDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  categories: string[];
  onAddExpense: (expenseData: Omit<OtherExpense, 'id'>) => void;
}

const AddExpenseDialog: React.FC<AddExpenseDialogProps> = ({
  isOpen,
  onOpenChange,
  categories,
  onAddExpense,
}) => {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedCategory, setSelectedCategory] = useState<string>(categories[0] || '');

  const handleSubmit = () => {
    const expenseData = {
      description: description.trim(),
      amount: Number(amount),
      date: date ? date.toISOString() : new Date().toISOString(),
      category: selectedCategory,
    };
    onAddExpense(expenseData);
    // Reset form after adding
    setDescription('');
    setAmount('');
    setDate(new Date());
    setSelectedCategory(categories[0] || '');
  };

  const handleClose = () => {
    setDescription('');
    setAmount('');
    setDate(new Date());
    setSelectedCategory(categories[0] || '');
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <PlusCircle className="mr-2 h-5 w-5 text-primary" />
            {t('accounts_add_expense_dialog_title')}
          </DialogTitle>
          <DialogDescription>
            {t('accounts_add_expense_dialog_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="expenseDescription" className="text-right col-span-1">
              {t('accounts_add_expense_desc_label')}
            </Label>
            <Textarea
              id="expenseDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="col-span-3"
              placeholder={t('accounts_add_expense_desc_placeholder')}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="expenseAmount" className="text-right col-span-1">
              {t('accounts_add_expense_amount_label')}
            </Label>
            <Input
              id="expenseAmount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="col-span-3"
              placeholder={t('accounts_add_expense_amount_placeholder')}
              min="0.01"
              step="0.01"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="expenseDate" className="text-right col-span-1">
              {t('accounts_add_expense_date_label')}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "col-span-3 justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP") : <span>{t('payment_due_date_pick_date')}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="expenseCategory" className="text-right col-span-1">
              {t('accounts_add_expense_category_label')}
            </Label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder={t('accounts_add_expense_category_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {t(`accounts_other_expenses_tab_${cat.toLowerCase().replace(/\s+/g, '_')}` as any) || cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
             <X className="mr-2 h-4 w-4" /> {t('cancel_button')}
          </Button>
          <Button onClick={handleSubmit} disabled={!description.trim() || Number(amount) <= 0 || !selectedCategory || !date}>
            <PlusCircle className="mr-2 h-4 w-4" /> {t('accounts_add_expense_button_add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddExpenseDialog;
