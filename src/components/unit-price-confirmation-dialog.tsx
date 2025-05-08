'use client';

import React, { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, Check, X, ChevronsUpDown } from 'lucide-react';
import type { Product, ProductPriceDiscrepancy } from '@/services/backend';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { useTranslation } from '@/hooks/useTranslation';

interface UnitPriceConfirmationDialogProps {
  discrepancies: ProductPriceDiscrepancy[];
  onComplete: (resolvedProducts: Product[] | null) => void;
}

type PriceDecision = 'keep_old' | 'update_new';

const UnitPriceConfirmationDialog: React.FC<UnitPriceConfirmationDialogProps> = ({ discrepancies, onComplete }) => {
  const { t } = useTranslation();
  const [priceDecisions, setPriceDecisions] = useState<Record<string, PriceDecision>>(
    discrepancies.reduce((acc, d) => {
      acc[d.id] = 'keep_old';
      return acc;
    }, {} as Record<string, PriceDecision>)
  );
  const [isOpen, setIsOpen] = useState(true);

  const handleDecisionChange = (productId: string, decision: PriceDecision) => {
    setPriceDecisions(prev => ({ ...prev, [productId]: decision }));
  };

  const handleConfirm = () => {
    const resolvedProducts: Product[] = discrepancies.map(d => {
      const decision = priceDecisions[d.id];
      return {
        ...d,
        unitPrice: decision === 'update_new' ? d.newUnitPrice : d.existingUnitPrice,
      };
    });
    setIsOpen(false);
    onComplete(resolvedProducts);
  };

  const handleCancel = () => {
    setIsOpen(false);
    onComplete(null);
  };
  
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      onComplete(null); // Call onComplete with null if dialog is closed by clicking outside or X button
    }
  };

  const handleUpdateAllToNew = () => {
    const newDecisions: Record<string, PriceDecision> = {};
    discrepancies.forEach(d => newDecisions[d.id] = 'update_new');
    setPriceDecisions(newDecisions);
  };

  const handleKeepAllOld = () => {
    const newDecisions: Record<string, PriceDecision> = {};
    discrepancies.forEach(d => newDecisions[d.id] = 'keep_old');
    setPriceDecisions(newDecisions);
  };

  const formatCurrency = (value: number) => `${t('currency_symbol')}${value.toFixed(2)}`;

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] sm:h-[90vh] flex flex-col p-0 rounded-t-lg">
        <SheetHeader className="p-4 sm:p-6 border-b shrink-0">
          <SheetTitle className="flex items-center text-lg sm:text-xl">
            <AlertTriangle className="h-5 w-5 mr-2 text-yellow-500" />
            {t('unit_price_confirmation_title')}
          </SheetTitle>
          <SheetDescription className="text-xs sm:text-sm">
            {t('unit_price_confirmation_description')}
          </SheetDescription>
        </SheetHeader>

        <div className="p-3 sm:p-4 border-b flex flex-col sm:flex-row gap-2">
            <Button onClick={handleUpdateAllToNew} variant="outline" size="sm" className="w-full sm:w-auto">
                <ChevronsUpDown className="mr-2 h-4 w-4"/> {t('unit_price_confirmation_update_all_button')}
            </Button>
            <Button onClick={handleKeepAllOld} variant="outline" size="sm" className="w-full sm:w-auto">
                <ChevronsUpDown className="mr-2 h-4 w-4"/> {t('unit_price_confirmation_keep_all_button')}
            </Button>
        </div>

        <ScrollArea className="flex-grow">
          <div className="space-y-3 p-3 sm:p-4">
            {discrepancies.map((d) => (
              <div key={d.id} className="p-3 border rounded-md shadow-sm bg-card">
                <p className="font-medium text-sm">{d.shortName || d.description}</p>
                <p className="text-xs text-muted-foreground">{t('unit_price_confirmation_catalog_label')}: {d.catalogNumber}</p>
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  <div>
                    <p className="font-semibold">{t('unit_price_confirmation_current_price_label')}:</p>
                    <p>{formatCurrency(d.existingUnitPrice)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-amber-600 dark:text-amber-400">{t('unit_price_confirmation_new_price_label')}:</p>
                    <p className="text-amber-600 dark:text-amber-400">{formatCurrency(d.newUnitPrice)}</p>
                  </div>
                </div>
                <RadioGroup
                  value={priceDecisions[d.id]}
                  onValueChange={(value) => handleDecisionChange(d.id, value as PriceDecision)}
                  className="mt-3 space-y-1"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="keep_old" id={`keep_old_${d.id}`} />
                    <Label htmlFor={`keep_old_${d.id}`} className="text-xs font-normal cursor-pointer">{t('unit_price_confirmation_option_keep_old', { price: formatCurrency(d.existingUnitPrice) })}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="update_new" id={`update_new_${d.id}`} />
                    <Label htmlFor={`update_new_${d.id}`} className="text-xs font-normal cursor-pointer">{t('unit_price_confirmation_option_update_new', { price: formatCurrency(d.newUnitPrice) })}</Label>
                  </div>
                </RadioGroup>
              </div>
            ))}
          </div>
        </ScrollArea>

        <SheetFooter className="p-3 sm:p-4 border-t flex flex-col sm:flex-row gap-2 shrink-0">
          <SheetClose asChild>
             <Button variant="outline" onClick={handleCancel} className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
                <X className="mr-2 h-4 w-4" /> {t('unit_price_confirmation_cancel_button')}
             </Button>
          </SheetClose>
          <Button onClick={handleConfirm} className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
            <Check className="mr-2 h-4 w-4" /> {t('unit_price_confirmation_confirm_button')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default UnitPriceConfirmationDialog;
