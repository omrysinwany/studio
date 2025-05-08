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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SupplierSummary } from '@/services/backend';
import { AlertTriangle, Check, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';

interface SupplierConfirmationDialogProps {
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
  const [renamedSupplier, setRenamedSupplier] = useState(potentialSupplierName);
  const [chosenExistingSupplier, setChosenExistingSupplier] = useState<string>('');

  useEffect(() => {
    setRenamedSupplier(potentialSupplierName);
    setSelectedOption('use_new');
    setChosenExistingSupplier('');
  }, [potentialSupplierName, isOpen]); // Reset state when dialog opens or potential name changes

  const handleConfirm = () => {
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
    }
    onConfirm(confirmedName, isNewSupplier);
    onOpenChange(false);
  };

  const handleDialogCancel = () => {
    onCancel(); // Call the original cancel handler
    onOpenChange(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) handleDialogCancel();
    }}>
      <SheetContent side="bottom" className="h-[75vh] sm:h-[80vh] flex flex-col p-0 rounded-t-lg">
        <SheetHeader className="p-4 sm:p-6 border-b shrink-0">
          <SheetTitle className="flex items-center text-lg sm:text-xl">
            <AlertTriangle className="h-5 w-5 mr-2 text-yellow-500" />
            {t('supplier_confirmation_title')}
          </SheetTitle>
          <SheetDescription className="text-xs sm:text-sm">
            {t('supplier_confirmation_description', { supplierName: potentialSupplierName })}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-grow">
            <div className="p-4 sm:p-6 space-y-4">
            <RadioGroup value={selectedOption} onValueChange={(value) => setSelectedOption(value as SupplierOption)} className="space-y-3">
                <div>
                <div className="flex items-center space-x-2">
                    <RadioGroupItem value="use_new" id="use_new_supplier" />
                    <Label htmlFor="use_new_supplier" className="font-medium cursor-pointer">
                    {t('supplier_confirmation_option_use_new', { supplierName: potentialSupplierName })}
                    </Label>
                </div>
                </div>

                <div>
                <div className="flex items-center space-x-2">
                    <RadioGroupItem value="rename_new" id="rename_new_supplier" />
                    <Label htmlFor="rename_new_supplier" className="font-medium cursor-pointer">
                    {t('supplier_confirmation_option_rename_new')}
                    </Label>
                </div>
                {selectedOption === 'rename_new' && (
                    <Input
                    type="text"
                    value={renamedSupplier}
                    onChange={(e) => setRenamedSupplier(e.target.value)}
                    placeholder={t('supplier_confirmation_rename_placeholder')}
                    className="mt-2 h-9"
                    />
                )}
                </div>
                
                {existingSuppliers.length > 0 && (
                    <div>
                        <div className="flex items-center space-x-2">
                        <RadioGroupItem value="select_existing" id="select_existing_supplier" />
                        <Label htmlFor="select_existing_supplier" className="font-medium cursor-pointer">
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
                                <SelectItem key={supplier.name} value={supplier.name}>
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
          <SheetClose asChild>
            <Button variant="outline" onClick={handleDialogCancel} className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
              <X className="mr-2 h-4 w-4" /> {t('cancel_button')}
            </Button>
          </SheetClose>
          <Button onClick={handleConfirm} className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
            <Check className="mr-2 h-4 w-4" /> {t('supplier_confirmation_confirm_button')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default SupplierConfirmationDialog;
