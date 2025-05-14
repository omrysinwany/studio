// src/components/accounts/AddCategoryDialog.tsx
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
import { PlusCircle, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface AddCategoryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onAddCategory: (categoryName: string) => void;
}

const AddCategoryDialog: React.FC<AddCategoryDialogProps> = ({
  isOpen,
  onOpenChange,
  onAddCategory,
}) => {
  const { t } = useTranslation();
  const [categoryName, setCategoryName] = useState('');

  const handleSubmit = () => {
    if (categoryName.trim()) {
      onAddCategory(categoryName.trim());
      setCategoryName(''); 
      onOpenChange(false); 
    }
  };

  const handleClose = () => {
    setCategoryName(''); 
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md rounded-lg shadow-xl">
        <DialogHeader className="p-6">
          <DialogTitle className="flex items-center text-lg font-semibold text-primary">
            <PlusCircle className="mr-2 h-5 w-5" />
            {t('accounts_add_category_dialog_title')}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t('accounts_add_category_dialog_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-4">
          <div className="grid grid-cols-1 gap-3">
            <Label htmlFor="categoryName" className="text-sm font-medium">
              {t('accounts_add_category_name_label')}
            </Label>
            <Input
              id="categoryName"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder={t('accounts_add_category_name_placeholder')}
              className="h-10"
            />
          </div>
        </div>
        <DialogFooter className="p-6 border-t flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleClose} className="w-full sm:w-auto">
            <X className="mr-2 h-4 w-4" /> {t('cancel_button')}
          </Button>
          <Button onClick={handleSubmit} disabled={!categoryName.trim()} className="w-full sm:w-auto bg-primary hover:bg-primary/90">
            <PlusCircle className="mr-2 h-4 w-4" /> {t('accounts_add_category_button_add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddCategoryDialog;
