// src/app/accounts/other-expenses/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, PlusCircle, Landmark, ArrowLeft, Edit2, Trash2 } from 'lucide-react'; // Added Edit2, Trash2
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AddCategoryDialog from '@/components/accounts/AddCategoryDialog';
import AddExpenseDialog from '@/components/accounts/AddExpenseDialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

export interface OtherExpense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string; // ISO date string
}

export interface ExpenseTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  amount: number;
}

const EXPENSE_CATEGORIES_STORAGE_KEY_BASE = 'invoTrack_expenseCategories';
const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses';
const EXPENSE_TEMPLATES_STORAGE_KEY_BASE = 'invoTrack_expenseTemplates';

const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(`[getStorageKey OtherExpensesPage] Attempted to get storage key for base "${baseKey}" without a userId.`);
    return baseKey;
  }
  return `${baseKey}_${userId}`;
};

export default function OtherExpensesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
  const [otherExpenses, setOtherExpenses] = useState<OtherExpense[]>([]);
  const [expenseTemplates, setExpenseTemplates] = useState<ExpenseTemplate[]>([]);
  const [activeExpenseTab, setActiveExpenseTab] = useState<string>('');

  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [showAddExpenseDialog, setShowAddExpenseDialog] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [editingExpense, setEditingExpense] = useState<OtherExpense | null>(null); // For editing

  useEffect(() => {
    if (typeof window !== 'undefined' && user) {
      setIsLoadingData(true);
      const categoriesStorageKey = getStorageKey(EXPENSE_CATEGORIES_STORAGE_KEY_BASE, user.id);
      const expensesStorageKey = getStorageKey(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id);
      const templatesStorageKey = getStorageKey(EXPENSE_TEMPLATES_STORAGE_KEY_BASE, user.id);

      const storedCategories = localStorage.getItem(categoriesStorageKey);
      const defaultCategories = ['electricity', 'water', 'arnona', 'rent'];
      let finalCategories = [...defaultCategories];
      if (storedCategories) {
        const parsedCategories = JSON.parse(storedCategories);
        finalCategories = Array.from(new Set([...defaultCategories, ...parsedCategories]));
      }
      setExpenseCategories(finalCategories);
      if (finalCategories.length > 0 && (!activeExpenseTab || !finalCategories.includes(activeExpenseTab))) {
        setActiveExpenseTab(finalCategories[0]);
      }

      const storedExpenses = localStorage.getItem(expensesStorageKey);
      setOtherExpenses(storedExpenses ? JSON.parse(storedExpenses) : []);
      
      const storedTemplates = localStorage.getItem(templatesStorageKey);
      setExpenseTemplates(storedTemplates ? JSON.parse(storedTemplates) : []);
      setIsLoadingData(false);
    } else if (!authLoading && !user) {
        router.push('/login');
    }
  }, [user, authLoading, router, activeExpenseTab]);

  const saveExpenseCategories = (categories: string[]) => {
    if (typeof window !== 'undefined' && user) {
      const categoriesStorageKey = getStorageKey(EXPENSE_CATEGORIES_STORAGE_KEY_BASE, user.id);
      localStorage.setItem(categoriesStorageKey, JSON.stringify(categories));
    }
  };

  const saveOtherExpenses = (expenses: OtherExpense[]) => {
    if (typeof window !== 'undefined' && user) {
      const expensesStorageKey = getStorageKey(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id);
      localStorage.setItem(expensesStorageKey, JSON.stringify(expenses));
    }
  };
  
  const saveExpenseTemplates = (templates: ExpenseTemplate[]) => {
    if (typeof window !== 'undefined' && user) {
      const templatesStorageKey = getStorageKey(EXPENSE_TEMPLATES_STORAGE_KEY_BASE, user.id);
      localStorage.setItem(templatesStorageKey, JSON.stringify(templates));
    }
  };

  const handleAddCategory = (newCategoryName: string) => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) {
      toast({ title: t('error_title'), description: t('accounts_toast_category_name_empty_desc'), variant: "destructive" });
      return;
    }
    if (expenseCategories.some(cat => cat.toLowerCase() === trimmedName.toLowerCase())) {
      toast({ title: t('accounts_toast_category_exists_title'), description: t('accounts_toast_category_exists_desc', { categoryName: trimmedName }), variant: "destructive" });
      return;
    }
    const updatedCategories = [...expenseCategories, trimmedName];
    setExpenseCategories(updatedCategories);
    saveExpenseCategories(updatedCategories);
    setActiveExpenseTab(trimmedName); 
    toast({ title: t('accounts_toast_category_added_title'), description: t('accounts_toast_category_added_desc', { categoryName: trimmedName }) });
    setShowAddCategoryDialog(false);
  };

  const handleAddOrUpdateExpense = (
    expenseData: Omit<OtherExpense, 'id'> & { id?: string }, // id is optional for new, required for update
    templateDetails?: { saveAsTemplate: boolean; templateName?: string }
  ) => {
    if (!expenseData.description.trim()) {
      toast({ title: t('error_title'), description: t('accounts_toast_expense_desc_empty_desc'), variant: "destructive" });
      return;
    }
    if (expenseData.amount <= 0) {
      toast({ title: t('accounts_toast_expense_invalid_amount_title'), description: t('accounts_toast_expense_invalid_amount_desc'), variant: "destructive" });
      return;
    }
    if (!expenseData.category) {
        toast({ title: t('error_title'), description: t('accounts_toast_expense_category_empty_desc'), variant: "destructive"});
        return;
    }
     if (!expenseData.date || !isValid(parseISO(expenseData.date))) {
        toast({ title: t('error_title'), description: t('accounts_toast_expense_invalid_date_desc'), variant: "destructive"});
        return;
    }

    let updatedExpenses: OtherExpense[];
    let toastMessage = '';

    if (expenseData.id) { // Editing existing expense
      updatedExpenses = otherExpenses.map(exp => 
        exp.id === expenseData.id ? { ...exp, ...expenseData } as OtherExpense : exp
      );
      toastMessage = t('accounts_toast_expense_updated_title'); // You'll need to add this translation
    } else { // Adding new expense
      const newExpense: OtherExpense = {
        id: `exp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        ...expenseData,
      } as OtherExpense;
      updatedExpenses = [...otherExpenses, newExpense];
      toastMessage = t('accounts_toast_expense_added_title');
    }
    
    setOtherExpenses(updatedExpenses);
    saveOtherExpenses(updatedExpenses);
    toast({ title: toastMessage, description: t('accounts_toast_expense_added_desc', { description: expenseData.description }) }); // Can refine desc for update
    setShowAddExpenseDialog(false);
    setEditingExpense(null); // Clear editing state

    if (templateDetails?.saveAsTemplate) {
      const newTemplate: ExpenseTemplate = {
        id: `tmpl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: templateDetails.templateName || `${expenseData.description.substring(0, 20)} Template`,
        category: expenseData.category,
        description: expenseData.description,
        amount: expenseData.amount,
      };
      const updatedTemplates = [...expenseTemplates, newTemplate];
      setExpenseTemplates(updatedTemplates);
      saveExpenseTemplates(updatedTemplates);
      toast({ title: t('accounts_toast_template_saved_title'), description: t('accounts_toast_template_saved_desc', { templateName: newTemplate.name }) });
    }
  };

  const handleDeleteExpense = (expenseId: string) => {
    const updatedExpenses = otherExpenses.filter(exp => exp.id !== expenseId);
    setOtherExpenses(updatedExpenses);
    saveOtherExpenses(updatedExpenses);
    toast({ title: t('accounts_toast_expense_deleted_title'), description: t('accounts_toast_expense_deleted_desc') }); // Add translations
  };

  const openEditDialog = (expense: OtherExpense) => {
    setEditingExpense(expense);
    setShowAddExpenseDialog(true);
  };


  const formatDateDisplay = (dateString: string | Date | undefined, formatStr: string = 'PP') => {
    if (!dateString) return t('invoices_na');
    try {
      const dateObj = typeof dateString === 'string' ? parseISO(dateString) : dateString;
      return format(dateObj, formatStr);
    } catch (e) {
      console.error("Error formatting date for display:", e, "Input:", dateString);
      return t('invoices_invalid_date');
    }
  };

  const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null) return t('invoices_na');
    return `${t('currency_symbol')}${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  };

  if (authLoading || isLoadingData || !user) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
       <Button variant="outline" size="sm" asChild className="mb-4 scale-fade-in">
        <Link href="/accounts">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('back_to_accounts_button')}
        </Link>
      </Button>

      <Card className="shadow-md scale-fade-in delay-100">
          <CardHeader>
              <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <Landmark className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('accounts_other_expenses_title')}
              </CardTitle>
              <CardDescription>{t('accounts_other_expenses_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={activeExpenseTab} onValueChange={setActiveExpenseTab} className="w-full">
              <div className="flex items-center gap-2 border-b pb-2">
                <ScrollArea className="w-full whitespace-nowrap">
                    <TabsList className="inline-flex h-10 items-center justify-start rounded-lg bg-muted p-1 text-muted-foreground">
                        {expenseCategories.map(category => (
                            <TabsTrigger
                                key={category}
                                value={category}
                                className="data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-3 py-1.5 text-sm font-medium transition-all flex-1 sm:flex-none"
                            >
                            {t(`accounts_other_expenses_tab_${category.toLowerCase().replace(/\s+/g, '_')}` as any) || category.charAt(0).toUpperCase() + category.slice(1)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
                <Button variant="ghost" size="icon" onClick={() => setShowAddCategoryDialog(true)} className="ml-auto flex-shrink-0 text-primary hover:bg-primary/10">
                  <PlusCircle className="h-5 w-5" />
                  <span className="sr-only">{t('accounts_add_category_button')}</span>
                </Button>
              </div>
              {expenseCategories.map(category => (
                <TabsContent key={category} value={category} className="mt-4 min-h-[200px] tabs-content-fade-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {otherExpenses.filter(exp => exp.category === category).length > 0 ? (
                      otherExpenses.filter(exp => exp.category === category)
                        .sort((a,b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())
                        .map(expense => (
                          <Card key={expense.id} className="bg-card shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base font-semibold text-foreground truncate" title={expense.description}>{expense.description}</CardTitle>
                              <CardDescription className="text-xs">{formatDateDisplay(expense.date)}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow pt-0">
                              <p className="text-xl font-bold text-primary">{formatCurrency(expense.amount)}</p>
                            </CardContent>
                            <CardFooter className="border-t pt-3 pb-3 flex justify-end gap-2">
                                <Button variant="ghost" size="icon" onClick={() => openEditDialog(expense)} className="h-8 w-8 text-muted-foreground hover:text-primary">
                                    <Edit2 className="h-4 w-4" />
                                    <span className="sr-only">{t('edit_button')}</span>
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteExpense(expense.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                    <span className="sr-only">{t('delete_button')}</span>
                                </Button>
                            </CardFooter>
                          </Card>
                        ))
                    ) : (
                      <div className="sm:col-span-2 lg:col-span-3 text-center py-8 text-muted-foreground">
                        <Landmark className="mx-auto h-12 w-12 mb-2 opacity-50"/>
                        <p className="text-sm ">{t('accounts_other_expenses_no_expenses_in_category')}</p>
                        <Button variant="link" size="sm" onClick={() => { setActiveExpenseTab(category); setEditingExpense(null); setShowAddExpenseDialog(true); }} className="mt-1 text-primary">
                            {t('accounts_add_expense_button')} {t(`accounts_other_expenses_tab_${category.toLowerCase().replace(/\s+/g, '_')}` as any) || category.toLowerCase()}
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
            <div className="flex flex-col sm:flex-row justify-end pt-4 mt-4 border-t">
              <Button onClick={() => { setEditingExpense(null); setShowAddExpenseDialog(true); }} className="w-full sm:w-auto bg-primary hover:bg-primary/90">
                  <PlusCircle className="mr-2 h-4 w-4" /> {t('accounts_add_expense_button')}
              </Button>
            </div>
          </CardContent>
      </Card>

      <AddCategoryDialog
        isOpen={showAddCategoryDialog}
        onOpenChange={setShowAddCategoryDialog}
        onAddCategory={handleAddCategory}
      />
      <AddExpenseDialog
        isOpen={showAddExpenseDialog}
        onOpenChange={(isOpen) => {
          setShowAddExpenseDialog(isOpen);
          if (!isOpen) setEditingExpense(null); // Clear editing state when dialog closes
        }}
        categories={expenseCategories}
        onAddExpense={handleAddOrUpdateExpense}
        preselectedCategory={activeExpenseTab}
        existingTemplates={expenseTemplates}
        otherExpenses={otherExpenses}
        editingExpense={editingExpense} // Pass expense to edit
      />
    </div>
  );
}

