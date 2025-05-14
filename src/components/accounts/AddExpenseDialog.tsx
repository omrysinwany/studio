// src/components/accounts/AddExpenseDialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose, 
} from '@/components/ui/sheet'; 
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PlusCircle, X, CalendarIcon, Save } from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { OtherExpense, ExpenseTemplate } from '@/app/accounts/other-expenses/page';
import { useTranslation } from '@/hooks/useTranslation';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area'; 

interface AddExpenseDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  categories: string[];
  onAddExpense: (expenseData: Omit<OtherExpense, 'id'> & { id?: string }, templateDetails?: { saveAsTemplate: boolean; templateName?: string }) => void;
  preselectedCategory?: string;
  existingTemplates: ExpenseTemplate[];
  otherExpenses: OtherExpense[];
  editingExpense?: OtherExpense | null;
  prefillData?: Partial<Omit<OtherExpense, 'id'>>; 
}

const AddExpenseDialog: React.FC<AddExpenseDialogProps> = ({
  isOpen,
  onOpenChange,
  categories,
  onAddExpense,
  preselectedCategory,
  existingTemplates,
  otherExpenses,
  editingExpense,
  prefillData,
}) => {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const SPECIAL_CATEGORIES_LOWERCASE = ['property_tax', 'rent', t('accounts_other_expenses_tab_property_tax').toLowerCase(), t('accounts_other_expenses_tab_rent').toLowerCase()];


  const resetForm = (expenseToEdit?: OtherExpense | null, prefill?: Partial<Omit<OtherExpense, 'id'>>) => {
    setDescription(prefill?.description || expenseToEdit?.description || '');
    setAmount(prefill?.amount ?? expenseToEdit?.amount ?? '');
    setDate(prefill?.date ? parseISO(prefill.date) : (expenseToEdit?.date ? parseISO(expenseToEdit.date) : new Date()));
    
    const initialCategory = prefill?._internalCategoryKey || 
                            expenseToEdit?._internalCategoryKey || 
                            (preselectedCategory && categories.includes(preselectedCategory) 
                              ? preselectedCategory 
                              : (categories.length > 0 ? categories[0] : ''));
    setSelectedCategory(initialCategory);
    setSaveAsTemplate(false);
    setTemplateName('');
  };

  useEffect(() => {
    if (isOpen) {
      resetForm(editingExpense, prefillData);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingExpense, prefillData]);


  useEffect(() => {
    if (isOpen && selectedCategory && !editingExpense && !prefillData?.description && !prefillData?.amount) {
      const lowerSelectedCategory = selectedCategory.toLowerCase();
      
      if (!SPECIAL_CATEGORIES_LOWERCASE.includes(lowerSelectedCategory)) {
          const recentExpensesInCat = otherExpenses
            .filter(exp => (exp._internalCategoryKey || exp.category.toLowerCase().replace(/\s+/g, '_')) === lowerSelectedCategory)
            .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());

          if (recentExpensesInCat.length > 0) {
            const lastExpense = recentExpensesInCat[0];
            setDescription(lastExpense.description);
            setAmount(lastExpense.amount);
          } else {
            const templateForCategory = existingTemplates.find(
              (template) => template.category.toLowerCase() === lowerSelectedCategory
            );
            if (templateForCategory) {
              setDescription(templateForCategory.description);
              setAmount(templateForCategory.amount);
            } else {
              
              setDescription('');
              setAmount('');
            }
          }
          setSaveAsTemplate(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedCategory, editingExpense, prefillData]);


  const handleSubmit = () => {
    const internalCatKey = selectedCategory; 
    const categoryLabel = t(`accounts_other_expenses_tab_${internalCatKey}` as any, { defaultValue: internalCatKey.charAt(0).toUpperCase() + internalCatKey.slice(1) });

    const expenseData: Omit<OtherExpense, 'id'> & { id?: string; _internalCategoryKey?: string } = {
      description: description.trim(),
      amount: Number(amount),
      date: date ? date.toISOString() : new Date().toISOString(),
      category: categoryLabel, 
      _internalCategoryKey: internalCatKey, 
    };
    if (editingExpense) {
      expenseData.id = editingExpense.id;
    }
    const templateDetails = saveAsTemplate ? { saveAsTemplate: true, templateName: templateName.trim() || undefined } : undefined;
    
    onAddExpense(expenseData, templateDetails);
    onOpenChange(false); 
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="h-auto max-h-[85vh] flex flex-col p-0 rounded-t-lg shadow-xl">
        <SheetHeader className="p-4 sm:p-6 border-b shrink-0">
          <SheetTitle className="flex items-center text-lg font-semibold text-primary">
            {editingExpense ? <Save className="mr-2 h-5 w-5" /> : <PlusCircle className="mr-2 h-5 w-5" />}
            {editingExpense ? t('accounts_edit_expense_dialog_title') : t('accounts_add_expense_dialog_title')}
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
             {editingExpense ? t('accounts_edit_expense_dialog_desc') : t('accounts_add_expense_dialog_desc')}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-grow">
            <div className="p-4 sm:p-6 space-y-4">
            <div>
                <Label htmlFor="expenseDescription" className="text-sm font-medium">
                {t('accounts_add_expense_desc_label')}
                </Label>
                <Textarea
                id="expenseDescription"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1"
                placeholder={t('accounts_add_expense_desc_placeholder')}
                rows={3}
                />
            </div>
            <div>
                <Label htmlFor="expenseAmount" className="text-sm font-medium">
                {t('accounts_add_expense_amount_label', { currency_symbol: t('currency_symbol') })}
                </Label>
                <Input
                id="expenseAmount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                className="mt-1 h-10"
                placeholder={t('accounts_add_expense_amount_placeholder', { currency_symbol: t('currency_symbol') })}
                min="0.01"
                step="0.01"
                />
            </div>
            <div>
                <Label htmlFor="expenseDate" className="text-sm font-medium">
                {t('accounts_add_expense_date_label')}
                </Label>
                <Popover>
                <PopoverTrigger asChild>
                    <Button
                    variant={"outline"}
                    className={cn(
                        "w-full justify-start text-left font-normal mt-1 h-10",
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
            <div>
                <Label htmlFor="expenseCategory" className="text-sm font-medium">
                {t('accounts_add_expense_category_label')}
                </Label>
                <Select 
                    value={selectedCategory} 
                    onValueChange={setSelectedCategory}
                    disabled={!!prefillData?._internalCategoryKey || !!editingExpense?._internalCategoryKey} 
                >
                <SelectTrigger className="w-full mt-1 h-10">
                    <SelectValue placeholder={t('accounts_add_expense_category_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                    {categories.filter(catKey => !SPECIAL_CATEGORIES_LOWERCASE.includes(catKey.toLowerCase())).map((catKey) => (
                    <SelectItem key={catKey} value={catKey}>
                        {t(`accounts_other_expenses_tab_${catKey.toLowerCase().replace(/\s+/g, '_')}` as any, {defaultValue: catKey.charAt(0).toUpperCase() + catKey.slice(1)})}
                    </SelectItem>
                    ))}
                </SelectContent>
                </Select>
            </div>

            {!editingExpense && !SPECIAL_CATEGORIES_LOWERCASE.includes(selectedCategory.toLowerCase()) && (
                <>
                <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                    id="saveAsTemplate"
                    checked={saveAsTemplate}
                    onCheckedChange={(checked) => setSaveAsTemplate(Boolean(checked))}
                    />
                    <Label htmlFor="saveAsTemplate" className="text-sm font-normal cursor-pointer">
                    {t('accounts_add_expense_save_as_template_label')}
                    </Label>
                </div>

                {saveAsTemplate && (
                    <div className="animate-in fade-in-0 slide-in-from-top-2 duration-300">
                    <Label htmlFor="templateName" className="text-sm font-medium">
                        {t('accounts_add_expense_template_name_label')}
                    </Label>
                    <Input
                        id="templateName"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        className="mt-1 h-10"
                        placeholder={t('accounts_add_expense_template_name_placeholder')}
                    />
                    </div>
                )}
                </>
            )}
            </div>
        </ScrollArea>
        <SheetFooter className="p-4 sm:p-6 border-t flex-col sm:flex-row gap-2 shrink-0">
            
            <SheetClose asChild>
                <Button variant="outline" className="w-full sm:w-auto">
                    <X className="mr-2 h-4 w-4" /> {t('cancel_button')}
                </Button>
            </SheetClose>
          <Button 
            onClick={handleSubmit} 
            disabled={!description.trim() || Number(amount) <= 0 || !selectedCategory || !date}
            className="w-full sm:w-auto bg-primary hover:bg-primary/90"
          >
            {editingExpense ? <Save className="mr-2 h-4 w-4" /> : <PlusCircle className="mr-2 h-4 w-4" />}
            {editingExpense ? t('save_changes_button') : t('accounts_add_expense_button_add')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default AddExpenseDialog;
