// src/app/accounts/other-expenses/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format, parseISO, isValid, getYear, getMonth, isSameMonth, isSameYear } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, PlusCircle, Landmark, ArrowLeft, Edit2, Trash2, Home, Building, Droplet, Zap, Save } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AddCategoryDialog from '@/components/accounts/AddCategoryDialog';
import AddExpenseDialog from '@/components/accounts/AddExpenseDialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';

export interface OtherExpense {
  id: string;
  category: string;
  _internalCategoryKey?: string;
  description: string;
  amount: number;
  date: string;
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

const SPECIAL_CATEGORY_KEYS = {
  PROPERTY_TAX: 'property_tax',
  RENT: 'rent',
  ELECTRICITY: 'electricity',
  WATER: 'water',
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
  const [editingExpense, setEditingExpense] = useState<OtherExpense | null>(null);
  const [prefillDataForDialog, setPrefillDataForDialog] = useState<Partial<Omit<OtherExpense, 'id'> & { isSpecialFixedExpense?: boolean }>>({});

  useEffect(() => {
    if (typeof window !== 'undefined' && user) {
      setIsLoadingData(true);
      const categoriesStorageKey = getStorageKey(EXPENSE_CATEGORIES_STORAGE_KEY_BASE, user.id);
      const expensesStorageKey = getStorageKey(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id);
      const templatesStorageKey = getStorageKey(EXPENSE_TEMPLATES_STORAGE_KEY_BASE, user.id);

      const storedCategories = localStorage.getItem(categoriesStorageKey);
      const defaultInternalCategories = [SPECIAL_CATEGORY_KEYS.ELECTRICITY, SPECIAL_CATEGORY_KEYS.WATER];
      let finalCategories = [...defaultInternalCategories];
      if (storedCategories) {
        const parsedCategories = JSON.parse(storedCategories).map((cat: string) => cat.toLowerCase());
        const uniqueParsed = parsedCategories.filter((cat: string) => !defaultInternalCategories.includes(cat.toLowerCase()) && !Object.values(SPECIAL_CATEGORY_KEYS).includes(cat.toLowerCase()));
        finalCategories = [...Object.values(SPECIAL_CATEGORY_KEYS), ...uniqueParsed];
      } else {
        finalCategories = Object.values(SPECIAL_CATEGORY_KEYS);
      }

      if (!finalCategories.includes(SPECIAL_CATEGORY_KEYS.PROPERTY_TAX)) finalCategories.push(SPECIAL_CATEGORY_KEYS.PROPERTY_TAX);
      if (!finalCategories.includes(SPECIAL_CATEGORY_KEYS.RENT)) finalCategories.push(SPECIAL_CATEGORY_KEYS.RENT);

      setExpenseCategories(Array.from(new Set(finalCategories)));

      const generalTabCategories = finalCategories.filter(catKey =>
          catKey !== SPECIAL_CATEGORY_KEYS.PROPERTY_TAX && catKey !== SPECIAL_CATEGORY_KEYS.RENT
      );

      if (generalTabCategories.length > 0 && (!activeExpenseTab || !generalTabCategories.includes(activeExpenseTab))) {
        setActiveExpenseTab(generalTabCategories[0]);
      } else if (generalTabCategories.length === 0 && finalCategories.length > 0) {
        setActiveExpenseTab(finalCategories.find(cat => cat !== SPECIAL_CATEGORY_KEYS.PROPERTY_TAX && cat !== SPECIAL_CATEGORY_KEYS.RENT) || '');
      }


      const storedExpenses = localStorage.getItem(expensesStorageKey);
      const parsedExpenses: OtherExpense[] = storedExpenses ? JSON.parse(storedExpenses) : [];
      setOtherExpenses(parsedExpenses);

      const storedTemplates = localStorage.getItem(templatesStorageKey);
      setExpenseTemplates(storedTemplates ? JSON.parse(storedTemplates) : []);
      setIsLoadingData(false);
    } else if (!authLoading && !user) {
        router.push('/login');
    }
  }, [user, authLoading, router, t, activeExpenseTab]); // Removed specialExpenseAmounts from dependencies

  const saveExpenseCategories = (categoriesToSave: string[]) => {
    if (typeof window !== 'undefined' && user) {
      const categoriesStorageKey = getStorageKey(EXPENSE_CATEGORIES_STORAGE_KEY_BASE, user.id);
      localStorage.setItem(categoriesStorageKey, JSON.stringify(Array.from(new Set(categoriesToSave.map(c => c.toLowerCase())))));
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
    const internalKey = trimmedName.toLowerCase().replace(/\s+/g, '_');

    const categoryExists = expenseCategories.some(catKey =>
        catKey === internalKey ||
        t(`accounts_other_expenses_tab_${catKey}` as any, { defaultValue: catKey }).toLowerCase() === trimmedName.toLowerCase()
    );
    if (categoryExists) {
      toast({ title: t('accounts_toast_category_exists_title'), description: t('accounts_toast_category_exists_desc', { categoryName: trimmedName }), variant: "destructive" });
      return;
    }
    const updatedCategories = [...expenseCategories, internalKey];
    setExpenseCategories(updatedCategories);
    saveExpenseCategories(updatedCategories);
    if (!Object.values(SPECIAL_CATEGORY_KEYS).includes(internalKey as any)) {
        setActiveExpenseTab(internalKey);
    }
    toast({ title: t('accounts_toast_category_added_title'), description: t('accounts_toast_category_added_desc', { categoryName: trimmedName }) });
    setShowAddCategoryDialog(false);
  };


  const handleAddOrUpdateExpense = (
    expenseData: Omit<OtherExpense, 'id' | '_internalCategoryKey'> & { id?: string; _internalCategoryKey?: string },
    templateDetails?: { saveAsTemplate: boolean; templateName?: string }
  ) => {
    if (!user) return;
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

    const internalCatKey = expenseData._internalCategoryKey ||
                            expenseCategories.find(catKey => t(`accounts_other_expenses_tab_${catKey}` as any, {defaultValue: catKey}).toLowerCase() === expenseData.category.toLowerCase()) ||
                            expenseData.category.toLowerCase().replace(/\s+/g, '_');
    
    const categoryLabel = t(`accounts_other_expenses_tab_${internalCatKey}` as any, { defaultValue: internalCatKey.charAt(0).toUpperCase() + internalCatKey.slice(1) });
    const currentMonthYear = format(parseISO(expenseData.date), 'MMMM yyyy');
    const defaultDescription = `${categoryLabel} - ${currentMonthYear}`;


    const expenseToSave: Omit<OtherExpense, 'id'> & { id?: string } = {
      ...expenseData,
      _internalCategoryKey: internalCatKey,
      description: expenseData.description.trim() || defaultDescription,
    };


    if (expenseData.id) { // Editing an existing expense
      updatedExpenses = otherExpenses.map(exp =>
        exp.id === expenseData.id ? { ...exp, ...expenseToSave } as OtherExpense : exp
      );
      toastMessage = t('accounts_toast_expense_updated_title');
    } else { // Adding a new expense
      const newExpense: OtherExpense = {
        id: `exp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        ...expenseToSave,
      } as OtherExpense;
      updatedExpenses = [...otherExpenses, newExpense];
      toastMessage = t('accounts_toast_expense_added_title');
    }

    setOtherExpenses(updatedExpenses);
    saveOtherExpenses(updatedExpenses);
    toast({ title: toastMessage, description: t('accounts_toast_expense_added_desc', { description: expenseToSave.description }) });
    setShowAddExpenseDialog(false);
    setEditingExpense(null);
    setPrefillDataForDialog({});

    if (templateDetails?.saveAsTemplate) {
      const newTemplate: ExpenseTemplate = {
        id: `tmpl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: templateDetails.templateName || `${expenseToSave.description.substring(0, 20)} Template`,
        category: internalCatKey,
        description: expenseToSave.description,
        amount: expenseToSave.amount,
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
    toast({ title: t('accounts_toast_expense_deleted_title'), description: t('accounts_toast_expense_deleted_desc') });
  };

  const openEditDialog = (expense: OtherExpense) => {
    setEditingExpense(expense);
    setPrefillDataForDialog({}); // Clear general prefill if editing specific
    setShowAddExpenseDialog(true);
  };

  const openEditSpecialExpenseDialog = (internalCatKey: string) => {
    const latestExpenseForCategory = otherExpenses
      .filter(exp => exp._internalCategoryKey === internalCatKey)
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())[0];

    let categoryLabel = '';
    if (internalCatKey === SPECIAL_CATEGORY_KEYS.PROPERTY_TAX) {
        categoryLabel = t('accounts_other_expenses_tab_property_tax');
    } else if (internalCatKey === SPECIAL_CATEGORY_KEYS.RENT) {
        categoryLabel = t('accounts_other_expenses_tab_rent');
    } else {
        categoryLabel = t(`accounts_other_expenses_tab_${internalCatKey}` as any, { defaultValue: internalCatKey.charAt(0).toUpperCase() + internalCatKey.slice(1) });
    }
    
    const currentMonthYear = format(new Date(), 'MMMM yyyy');
    const defaultDescription = `${categoryLabel} - ${currentMonthYear}`;

    if (latestExpenseForCategory) {
        setEditingExpense(latestExpenseForCategory);
        setPrefillDataForDialog({}); // Clear prefill as we are editing
    } else {
        setEditingExpense(null); // Ensure not editing if no expense exists
        setPrefillDataForDialog({ 
            category: categoryLabel, 
            _internalCategoryKey: internalCatKey,
            description: defaultDescription,
            date: new Date().toISOString(),
         });
    }
    setShowAddExpenseDialog(true);
  };


  const openAddDialogForVariableCategory = (internalCatKey: string) => {
    const categoryLabel = t(`accounts_other_expenses_tab_${internalCatKey}` as any, { defaultValue: internalCatKey.charAt(0).toUpperCase() + internalCatKey.slice(1) });
    setPrefillDataForDialog({ category: categoryLabel, _internalCategoryKey: internalCatKey, date: new Date().toISOString() });
    setEditingExpense(null);
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
    return `${t('currency_symbol')}${value.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
  };

  const tabCategories = expenseCategories.filter(catKey =>
      catKey !== SPECIAL_CATEGORY_KEYS.PROPERTY_TAX && catKey !== SPECIAL_CATEGORY_KEYS.RENT
  );

  const getCategoryIcon = (categoryKey: string): React.ElementType => {
    const lowerCategoryKey = categoryKey.toLowerCase();
    if (lowerCategoryKey.includes(SPECIAL_CATEGORY_KEYS.ELECTRICITY)) return Zap;
    if (lowerCategoryKey.includes(SPECIAL_CATEGORY_KEYS.WATER)) return Droplet;
    if (lowerCategoryKey.includes(SPECIAL_CATEGORY_KEYS.PROPERTY_TAX)) return Home; 
    if (lowerCategoryKey.includes(SPECIAL_CATEGORY_KEYS.RENT)) return Building; 
    return Landmark;
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {[SPECIAL_CATEGORY_KEYS.PROPERTY_TAX, SPECIAL_CATEGORY_KEYS.RENT].map((specialCatKey) => {
            let categoryLabel = '';
            if (specialCatKey === SPECIAL_CATEGORY_KEYS.PROPERTY_TAX) {
                categoryLabel = t('accounts_other_expenses_tab_property_tax');
            } else if (specialCatKey === SPECIAL_CATEGORY_KEYS.RENT) {
                categoryLabel = t('accounts_other_expenses_tab_rent');
            }
            const CategoryIcon = getCategoryIcon(specialCatKey);
            const latestExpenseForCategory = otherExpenses
                .filter(exp => exp._internalCategoryKey === specialCatKey)
                .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())[0];

            return (
                <Card key={specialCatKey} className="shadow-md scale-fade-in delay-100 flex flex-col">
                    <CardHeader className="pb-3 flex flex-row items-start justify-between">
                        <div>
                            <CardTitle className="text-xl font-semibold text-primary flex items-center">
                                <CategoryIcon className="mr-2 h-5 w-5" /> {categoryLabel}
                            </CardTitle>
                            <CardDescription>{t('accounts_other_expenses_recurring_desc', { category: categoryLabel.toLowerCase() })}</CardDescription>
                        </div>
                         <Button variant="ghost" size="icon" onClick={() => openEditSpecialExpenseDialog(specialCatKey)} className="h-8 w-8 text-muted-foreground hover:text-primary">
                            <Edit2 className="h-4 w-4" />
                            <span className="sr-only">{t('edit_button')}</span>
                         </Button>
                    </CardHeader>
                    <CardContent className="space-y-1 flex-grow">
                         {latestExpenseForCategory ? (
                             <>
                                <p className="text-2xl font-bold text-primary">{formatCurrency(latestExpenseForCategory.amount)}</p>
                                <p className="text-xs text-muted-foreground">
                                    {t('accounts_other_expenses_last_recorded_on')}{' '}
                                    <strong className="font-semibold">{formatDateDisplay(latestExpenseForCategory.date)}</strong>
                                </p>
                             </>
                        ) : (
                            <p className="text-sm text-muted-foreground py-4">{t('accounts_other_expenses_no_record_yet')}</p>
                        )}
                    </CardContent>
                     <CardFooter className="border-t pt-3 pb-3">
                         <Button
                           onClick={() => openEditSpecialExpenseDialog(specialCatKey)}
                           size="sm"
                           className="w-full bg-primary hover:bg-primary/90"
                         >
                           {latestExpenseForCategory ? <Edit2 className="mr-2 h-4 w-4" /> : <PlusCircle className="mr-2 h-4 w-4" /> }
                           {latestExpenseForCategory ? t('accounts_edit_expense_dialog_title') : t('accounts_add_expense_button')}
                         </Button>
                     </CardFooter>
                </Card>
            );
        })}
      </div>


      <Card className="shadow-md scale-fade-in delay-200">
          <CardHeader>
              <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <Landmark className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('accounts_other_expenses_variable_title')}
              </CardTitle>
              <CardDescription>{t('accounts_other_expenses_variable_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={activeExpenseTab} onValueChange={setActiveExpenseTab} className="w-full">
              <div className="flex items-center gap-2 border-b pb-2">
                <ScrollArea className="w-full whitespace-nowrap">
                    <TabsList className="inline-flex h-10 items-center justify-start rounded-lg bg-muted p-1 text-muted-foreground">
                        {tabCategories.map(categoryKey => (
                            <TabsTrigger
                                key={categoryKey}
                                value={categoryKey}
                                className="data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-3 py-1.5 text-sm font-medium transition-all flex-1 sm:flex-none"
                            >
                             {t(`accounts_other_expenses_tab_${categoryKey.toLowerCase().replace(/\s+/g, '_')}` as any, {defaultValue: categoryKey.charAt(0).toUpperCase() + categoryKey.slice(1)})}
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
              {tabCategories.map(categoryKey => (
                <TabsContent key={categoryKey} value={categoryKey} className="mt-4 min-h-[200px] tabs-content-fade-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {otherExpenses.filter(exp => exp._internalCategoryKey === categoryKey).length > 0 ? (
                      otherExpenses.filter(exp => exp._internalCategoryKey === categoryKey)
                        .sort((a,b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())
                        .map(expense => (
                          <Card key={expense.id} className="bg-card shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base font-semibold text-foreground truncate" title={expense.description}>{expense.description}</CardTitle>
                              <CardDescription className="text-xs">{formatDateDisplay(expense.date)}</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-0 pb-2 flex-grow">
                               <p className="text-lg font-bold text-primary">{formatCurrency(expense.amount)}</p>
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
                        {React.createElement(getCategoryIcon(categoryKey), { className: "mx-auto h-12 w-12 mb-2 opacity-50" })}
                        <p className="text-sm ">{t('accounts_other_expenses_no_expenses_in_category')}</p>
                        <Button variant="link" size="sm" onClick={() => openAddDialogForVariableCategory(categoryKey)} className="mt-1 text-primary">
                           {t('accounts_add_expense_button')} {t(`accounts_other_expenses_tab_${categoryKey.toLowerCase().replace(/\s+/g, '_')}` as any, {defaultValue: categoryKey.toLowerCase()})}
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
            {/* Removed the general "Add Expense" button as requested */}
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
          if (!isOpen) {
            setEditingExpense(null);
            setPrefillDataForDialog({});
          }
        }}
        categories={expenseCategories}
        onAddExpense={handleAddOrUpdateExpense}
        preselectedCategory={prefillDataForDialog._internalCategoryKey || editingExpense?._internalCategoryKey || activeExpenseTab}
        existingTemplates={expenseTemplates}
        otherExpenses={otherExpenses}
        editingExpense={editingExpense}
        prefillData={prefillDataForDialog}
      />
    </div>
  );
}

