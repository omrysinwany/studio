// src/components/supplier-confirmation-dialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SupplierSummary } from '@/services/backend';
import { AlertTriangle, Check, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';

export interface SupplierConfirmationDialogProps {
  potentialSupplierName: string;
  existingSuppliers: SupplierSummary[];
  onConfirm: (confirmedSupplierName: string | null, isNew?: boolean) => void;
  onCancel: () => void;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

type SupplierOption = 'use_new' | 'rename_new' | 'select_existing';

const SupplierConfirmationDialog: React.FC<SupplierConfirmationDialogProps> = ({
  potentialSupplierName,
  existingSuppliers,
  onConfirm,
  onCancel,
  isOpen,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const [selectedOption, setSelectedOption] = useState<SupplierOption>('use_new');
  // ✅ שימוש ב-renamedSupplier וב-setRenamedSupplier עבור האפשרות של שינוי שם
  const [renamedSupplier, setRenamedSupplier] = useState<string>(potentialSupplierName);
  const [chosenExistingSupplier, setChosenExistingSupplier] = useState<string>('');

  useEffect(() => {
    // איתחול/איפוס המצבים הפנימיים כאשר הדיאלוג נפתח או שם הספק הפוטנציאלי משתנה
    if (isOpen) {
      setRenamedSupplier(potentialSupplierName); // מאתחל את שדה שינוי השם לשם המוצע
      setSelectedOption('use_new'); // ברירת המחדל היא להשתמש בשם החדש כמו שהוא
      setChosenExistingSupplier(''); // מאפס בחירה של ספק קיים
      console.log("[SupplierConfirmationDialog] State reset. isOpen:", isOpen, "potentialName:", potentialSupplierName);
    }
  }, [potentialSupplierName, isOpen]);

  const handleConfirmInternal = () => {
    let confirmedName: string | null = null;
    let isNewSupplier = false;

    if (selectedOption === 'use_new') {
      confirmedName = potentialSupplierName;
      isNewSupplier = true;
    } else if (selectedOption === 'rename_new') {
      if (renamedSupplier.trim() === '') {
        toast({ title: t('error_title'), description: t('supplier_confirmation_error_empty_name'), variant: 'destructive' });
        return;
      }
      confirmedName = renamedSupplier.trim();
      isNewSupplier = true;
    } else if (selectedOption === 'select_existing') {
      if (!chosenExistingSupplier) {
        toast({ title: t('error_title'), description: t('supplier_confirmation_error_select_existing'), variant: 'destructive' });
        return;
      }
      confirmedName = chosenExistingSupplier;
      isNewSupplier = false; // אם בחרנו ספק קיים, זה לא ספק חדש
    }
    onConfirm(confirmedName, isNewSupplier);
    // סגירת הדיאלוג תתבצע על ידי ההורה (EditInvoiceContent) שישנה את ה-prop `isOpen`
  };

  const handleSkipOrExternalClose = () => {
    onCancel(); // קורא לקולבק onCancel מההורה
  };
  
  const internalSheetOpenChangeHandler = (sheetIsCurrentlyOpen: boolean) => {
    onOpenChange(sheetIsCurrentlyOpen); // מעדכן את ההורה על ניסיון שינוי מצב ה-Sheet
  };

  // כאשר הבחירה ב-RadioGroup משתנה
  const handleOptionChange = (value: string) => {
    const newOption = value as SupplierOption;
    setSelectedOption(newOption);
    if (newOption === 'rename_new') {
      // אם המשתמש בוחר לשנות שם, נאתחל את שדה הטקסט לשם הפוטנציאלי
      // כדי שיהיה לו בסיס לעריכה, אם הוא עדיין לא ערך אותו.
      if (renamedSupplier === potentialSupplierName || renamedSupplier === '') { // או תנאי אחר לאיפוס
          setRenamedSupplier(potentialSupplierName);
      }
    } else if (newOption === 'use_new') {
        // אין צורך לעשות משהו מיוחד, השם הוא potentialSupplierName
    } else if (newOption === 'select_existing') {
        // אין צורך לעשות משהו מיוחד, הבחירה תתבצע ב-Select
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={internalSheetOpenChangeHandler}>
      <SheetContent side="bottom" className="h-[75vh] sm:h-[80vh] flex flex-col p-0 rounded-t-lg">
        <SheetHeader className="p-4 sm:p-6 border-b shrink-0">
          <SheetTitle className="flex items-center text-lg sm:text-xl">
            <AlertTriangle className="h-5 w-5 mr-2 text-yellow-500" />
            {t('supplier_confirmation_title')}
          </SheetTitle>
          <SheetDescription className="text-xs sm:text-sm">
            {t('supplier_confirmation_description', { supplierName: potentialSupplierName || t('invoices_unknown_supplier')})}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-grow">
            <div className="p-4 sm:p-6 space-y-4">
            <RadioGroup value={selectedOption} onValueChange={handleOptionChange} className="space-y-3"> {/* שימוש ב-handleOptionChange */}
                <div>
                  <div className="flex items-center space-x-2">
                      <RadioGroupItem value="use_new" id="sd_use_new_supplier_v2" /> {/* שינוי קל ב-id למניעת התנגשויות */}
                      <Label htmlFor="sd_use_new_supplier_v2" className="font-medium cursor-pointer">
                      {t('supplier_confirmation_option_use_new', { supplierName: potentialSupplierName || t('invoices_unknown_supplier') })}
                      </Label>
                  </div>
                </div>

                <div>
                  <div className="flex items-center space-x-2">
                      <RadioGroupItem value="rename_new" id="sd_rename_new_supplier_v2" />
                      <Label htmlFor="sd_rename_new_supplier_v2" className="font-medium cursor-pointer">
                      {t('supplier_confirmation_option_rename_new')}
                      </Label>
                  </div>
                  {selectedOption === 'rename_new' && (
                      <Input
                        type="text"
                        value={renamedSupplier} // ✅ שימוש ב-renamedSupplier
                        onChange={(e) => setRenamedSupplier(e.target.value)} // ✅ שימוש ב-setRenamedSupplier
                        placeholder={t('supplier_confirmation_rename_placeholder')}
                        className="mt-2 h-9"
                      />
                  )}
                </div>
                
                {existingSuppliers && existingSuppliers.length > 0 && (
                    <div>
                        <div className="flex items-center space-x-2">
                        <RadioGroupItem value="select_existing" id="sd_select_existing_supplier_v2" />
                        <Label htmlFor="sd_select_existing_supplier_v2" className="font-medium cursor-pointer">
                            {t('supplier_confirmation_option_select_existing')}
                        </Label>
                        </div>
                        {selectedOption === 'select_existing' && (
                        <Select value={chosenExistingSupplier} onValueChange={setChosenExistingSupplier}>
                            <SelectTrigger className="w-full mt-2 h-9">
                            <SelectValue placeholder={t('supplier_confirmation_select_existing_placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                            {existingSuppliers.map((supplier) => (
                                <SelectItem key={supplier.id || supplier.name} value={supplier.name}>
                                {supplier.name}
                                </SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                        )}
                    </div>
                )}
            </RadioGroup>
            </div>
        </ScrollArea>

        <SheetFooter className="p-4 sm:p-6 border-t flex flex-col sm:flex-row gap-2 shrink-0">
          <Button variant="outline" onClick={handleSkipOrExternalClose} className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
            <X className="mr-2 h-4 w-4" /> {t('skip_button')}
          </Button>
          <Button onClick={handleConfirmInternal} className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
            <Check className="mr-2 h-4 w-4" /> {t('supplier_confirmation_confirm_button')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default SupplierConfirmationDialog;