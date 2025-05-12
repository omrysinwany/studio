// src/components/accounts/AddExpenseDialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
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
import { PlusCircle, X, CalendarIcon, Save } from 'lucide-react'; // Added Save icon
import { format, isValid, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { OtherExpense, ExpenseTemplate } from '@/app/accounts/other-expenses/page';
import { useTranslation } from '@/hooks/useTranslation';
import { Checkbox } from '@/components/ui/checkbox';

interface AddExpenseDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  categories: string[];
  onAddExpense: (expenseData: Omit<OtherExpense, 'id'> & { id?: string }, templateDetails?: { saveAsTemplate: boolean; templateName?: string }) => void;
  preselectedCategory?: string;
  existingTemplates: ExpenseTemplate[];
  otherExpenses: OtherExpense[];
  editingExpense?: OtherExpense | null; // Make it optional for new expenses
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
}) => {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const resetForm = (expenseToEdit?: OtherExpense | null) => {
    setDescription(expenseToEdit?.description || '');
    setAmount(expenseToEdit?.amount ?? '');
    setDate(expenseToEdit?.date ? parseISO(expenseToEdit.date) : new Date());
    const initialCategory = expenseToEdit?.category || 
                            (preselectedCategory && categories.includes(preselectedCategory) 
                              ? preselectedCategory 
                              : (categories.length > 0 ? categories[0] : ''));
    setSelectedCategory(initialCategory);
    setSaveAsTemplate(false);
    setTemplateName('');
  };

  useEffect(() => {
    if (isOpen) {
      resetForm(editingExpense);
    }
  }, [isOpen, editingExpense, preselectedCategory, categories]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    if (isOpen && selectedCategory && !editingExpense) { // Only prefill for new expenses based on category logic
      const lowerSelectedCategory = selectedCategory.toLowerCase();
      const fixedRecurringCategories = ['arnona', 'rent', t('accounts_other_expenses_tab_arnona').toLowerCase(), t('accounts_other_expenses_tab_rent').toLowerCase()];

      if (fixedRecurringCategories.includes(lowerSelectedCategory)) {
        const recentExpensesInCat = otherExpenses
          .filter(exp => exp.category.toLowerCase() === lowerSelectedCategory)
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
          }
        }
        setSaveAsTemplate(false);
      }
    }
  }, [isOpen, selectedCategory, otherExpenses, existingTemplates, t, editingExpense]);


  const handleSubmit = () => {
    const expenseData: Omit<OtherExpense, 'id'> & { id?: string } = {
      description: description.trim(),
      amount: Number(amount),
      date: date ? date.toISOString() : new Date().toISOString(),
      category: selectedCategory,
    };
    if (editingExpense) {
      expenseData.id = editingExpense.id; // Include ID if editing
    }
    const templateDetails = saveAsTemplate ? { saveAsTemplate: true, templateName: templateName.trim() || undefined } : undefined;
    
    onAddExpense(expenseData, templateDetails);
    onOpenChange(false); 
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg rounded-lg shadow-xl">
        <DialogHeader className="p-6">
          <DialogTitle className="flex items-center text-lg font-semibold text-primary">
            {editingExpense ? <Save className="mr-2 h-5 w-5" /> : <PlusCircle className="mr-2 h-5 w-5" />}
            {editingExpense ? t('accounts_edit_expense_dialog_title') : t('accounts_add_expense_dialog_title')}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
             {editingExpense ? t('accounts_edit_expense_dialog_desc') : t('accounts_add_expense_dialog_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
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
              {t('accounts_add_expense_amount_label')}
            </Label>
            <Input
              id="expenseAmount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="mt-1 h-10"
              placeholder={t('accounts_add_expense_amount_placeholder')}
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
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full mt-1 h-10">
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

          {!editingExpense && ( // Only show template options for new expenses
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
        <DialogFooter className="p-6 border-t flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleClose} className="w-full sm:w-auto">
             <X className="mr-2 h-4 w-4" /> {t('cancel_button')}
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!description.trim() || Number(amount) <= 0 || !selectedCategory || !date}
            className="w-full sm:w-auto bg-primary hover:bg-primary/90"
          >
            {editingExpense ? <Save className="mr-2 h-4 w-4" /> : <PlusCircle className="mr-2 h-4 w-4" />}
            {editingExpense ? t('save_changes_button') : t('accounts_add_expense_button_add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddExpenseDialog;

