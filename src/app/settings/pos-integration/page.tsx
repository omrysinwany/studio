// src/app/settings/pos-integration/page.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getAvailablePosSystems, testPosConnection } from '@/services/pos-integration/integration-manager';
import {
    savePosSettingsService,
    getPosSettingsService,
    finalizeSaveProductsService
} from '@/services/backend';
import type { PosConnectionConfig, SyncResult } from '@/services/pos-integration/pos-adapter.interface';
import { syncInventoryAction, syncSalesAction } from '@/actions/sync-actions'; // Updated import
import { Loader2, Settings, Plug, CheckCircle, XCircle, Save, HelpCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from '@/hooks/useTranslation';


type PosSystemInfo = { systemId: string; systemName: string };

const systemConfigFields: Record<string, { key: keyof PosConnectionConfig; labelKey: string; type: string; tooltipKey?: string }[]> = {
  caspit: [
    { key: 'user', labelKey: 'pos_config_caspit_user', type: 'text', tooltipKey: 'pos_config_caspit_user_tooltip' },
    { key: 'pwd', labelKey: 'pos_config_caspit_pwd', type: 'password', tooltipKey: 'pos_config_caspit_pwd_tooltip' },
    { key: 'osekMorshe', labelKey: 'pos_config_caspit_osek', type: 'text', tooltipKey: 'pos_config_caspit_osek_tooltip' },
  ],
  hashavshevet: [
     { key: 'apiKey', labelKey: 'pos_config_hash_apikey', type: 'password', tooltipKey: 'pos_config_hash_apikey_tooltip' },
     { key: 'apiSecret', labelKey: 'pos_config_hash_apisecret', type: 'password', tooltipKey: 'pos_config_hash_apisecret_tooltip' },
     { key: 'companyId', labelKey: 'pos_config_hash_companyid', type: 'text', tooltipKey: 'pos_config_hash_companyid_tooltip' },
     { key: 'endpointUrl', labelKey: 'pos_config_hash_endpoint', type: 'text', tooltipKey: 'pos_config_hash_endpoint_tooltip' },
  ],
};


export default function PosIntegrationSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();

  const [availableSystems, setAvailableSystems] = useState<PosSystemInfo[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<string>('');
  const [configValues, setConfigValues] = useState<PosConnectionConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSyncingInventory, setIsSyncingInventory] = useState(false);
  const [isSyncingSales, setIsSyncingSales] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const loadInitialData = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const systems = getAvailablePosSystems();
      setAvailableSystems(systems);

      const savedSettings = await getPosSettingsService(user.id);
      if (savedSettings) {
        setSelectedSystemId(savedSettings.systemId);
        setConfigValues(savedSettings.config || {});
      }
    } catch (error) {
      console.error("Error loading POS settings:", error);
      toast({
        title: t('pos_toast_error_loading_title'),
        description: t('pos_toast_error_loading_desc'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, user, t]);

  useEffect(() => {
    if (user) {
        loadInitialData();
    }
  }, [loadInitialData, user]);

  const handleSystemChange = (systemId: string) => {
    setSelectedSystemId(systemId);
    if (user) {
        getPosSettingsService(user.id).then(savedSettings => {
            if (savedSettings && savedSettings.systemId === systemId) {
                setConfigValues(savedSettings.config || {});
            } else {
                setConfigValues({});
            }
        }).catch(error => {
            console.error("Error fetching settings on system change:", error);
            setConfigValues({});
            toast({ title: t('error_title'), description: t('pos_toast_error_system_change'), variant: "destructive" });
        });
    }
    setTestResult(null);
    setSyncResults([]);
  };


  const handleInputChange = (field: keyof PosConnectionConfig, value: string) => {
    setConfigValues(prev => ({ ...prev, [field]: value }));
    setTestResult(null);
    setSyncResults([]);
  };

  const handleTestConnection = async () => {
     if (!selectedSystemId || !user) return;
     setIsTesting(true);
     setTestResult(null);
     let result: { success: boolean; message: string } | null = null;
     console.log(`[POS Page] Testing connection for ${selectedSystemId} with config:`, configValues);
     try {
       result = await testPosConnection(selectedSystemId, configValues); // This function now correctly uses actions
       setTestResult(result);
       toast({
         title: result.success ? t('pos_toast_test_success_title') : t('pos_toast_test_fail_title'),
         description: result.message,
         variant: result.success ? 'default' : 'destructive',
       });
     } catch (error: any) {
        console.error("[POS Page] Error during test connection call:", error);
        const errorMessage = t('pos_toast_test_error_desc', { message: error.message || t('pos_unknown_error')});
        result = { success: false, message: errorMessage };
        setTestResult(result);
       toast({
         title: t('pos_toast_test_error_title'),
         description: errorMessage,
         variant: 'destructive',
       });
     } finally {
       setIsTesting(false);
     }
   };


  const handleSaveChanges = async () => {
    if (!selectedSystemId || !user) return;
    setIsSaving(true);
    try {
      await savePosSettingsService(selectedSystemId, configValues, user.id);
      toast({
        title: t('pos_toast_save_success_title'),
        description: t('pos_toast_save_success_desc', { systemName: availableSystems.find(s => s.systemId === selectedSystemId)?.systemName || 'system' }),
      });
       setTestResult(null);
       setSyncResults([]);
    } catch (error: any) {
      console.error("Error saving settings:", error);
      toast({
        title: t('pos_toast_save_fail_title'),
        description: t('pos_toast_save_fail_desc', { message: error.message || t('pos_unknown_error')}),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

   const handleSyncInventoryNow = async () => {
     if (!selectedSystemId || !user) return;

     setIsSyncingInventory(true);
     setSyncResults([]);
     toast({ title: t('pos_toast_sync_start_title'), description: t('pos_toast_sync_start_desc_inventory', { systemId: selectedSystemId }) });

     try {
         const inventoryResult = await syncInventoryAction(configValues, selectedSystemId, user.id);
         setSyncResults(prev => [...prev, inventoryResult]);

         if (inventoryResult.success && inventoryResult.products && inventoryResult.products.length > 0) {
             try {
                 console.log(`[POS Page] Saving ${inventoryResult.products.length} synced products...`);
                 await finalizeSaveProductsService(inventoryResult.products, `POS_Inventory_Sync_${selectedSystemId}_${new Date().toISOString().split('T')[0]}`, `${selectedSystemId}_sync`, user.id);
                 console.log(`[POS Page] Successfully saved synced products.`);
                 setSyncResults(prev => [...prev, { success: true, message: t('pos_toast_sync_save_products_desc', { count: inventoryResult.products?.length ?? 0 }) }]);
                 toast({
                    title: t('pos_toast_sync_complete_title_inventory'),
                    description: t('pos_toast_sync_complete_desc', { count: inventoryResult.products.length, systemId: selectedSystemId }),
                 });
             } catch (saveError: any) {
                 console.error("[POS Page] Error saving synced products:", saveError);
                 setSyncResults(prev => [...prev, { success: false, message: t('pos_toast_sync_save_fail_desc_products', { message: saveError.message }) }]);
                 toast({
                     title: t('pos_toast_sync_save_fail_title_products'),
                     description: t('pos_toast_sync_save_fail_desc_products_generic', { message: saveError.message || t('pos_unknown_error') }),
                     variant: "destructive",
                 });
             }
         } else if (inventoryResult.success && (!inventoryResult.products || inventoryResult.products.length === 0)) {
             toast({
                title: t('pos_toast_sync_no_products_title'),
                description: t('pos_toast_sync_no_products_desc', { systemId: selectedSystemId }),
             });
         } else {
            toast({
                title: t('pos_toast_sync_fail_title_inventory'),
                description: inventoryResult.message || t('pos_toast_sync_fail_desc_inventory_generic', { systemId: selectedSystemId }),
                variant: "destructive",
            });
         }
     } catch (error: any) {
         console.error(`[POS Page] Error during ${selectedSystemId} inventory sync process:`, error);
         setSyncResults([{ success: false, message: t('pos_toast_sync_error_desc_process', { message: error.message || t('pos_unknown_error') }) }]);
         toast({
             title: t('pos_toast_sync_error_title_process'),
             description: t('pos_toast_sync_error_desc_process_generic', { message: error.message || t('pos_unknown_error') }),
             variant: "destructive",
         });
     } finally {
         setIsSyncingInventory(false);
     }
   };

   const handleSyncSalesNow = async () => {
    if (!selectedSystemId || !user) return;

    setIsSyncingSales(true);
    setSyncResults([]); // Clear previous results or manage them differently if needed
    toast({ title: t('pos_toast_sync_start_title'), description: t('pos_toast_sync_start_desc_sales', { systemId: selectedSystemId }) });

    try {
        const salesResult = await syncSalesAction(configValues, selectedSystemId, user.id);
        setSyncResults(prev => [...prev, salesResult]); // Add sales result

        if (salesResult.success) {
            toast({
                title: t('pos_toast_sync_complete_title_sales'),
                // Assuming salesResult.message contains useful info, otherwise use a generic one
                description: salesResult.message || t('pos_toast_sync_complete_desc_sales_generic', { systemId: selectedSystemId }),
            });
            // Further processing for sales data might be needed here (e.g., updating reports, etc.)
            // For now, just showing the success message.
        } else {
           toast({
               title: t('pos_toast_sync_fail_title_sales'),
               description: salesResult.message || t('pos_toast_sync_fail_desc_sales_generic', { systemId: selectedSystemId }),
               variant: "destructive",
           });
        }
    } catch (error: any) {
        console.error(`[POS Page] Error during ${selectedSystemId} sales sync process:`, error);
        setSyncResults([{ success: false, message: t('pos_toast_sync_error_desc_process', { message: error.message || t('pos_unknown_error') }) }]);
        toast({
            title: t('pos_toast_sync_error_title_process'),
            description: t('pos_toast_sync_error_desc_process_generic', { message: error.message || t('pos_unknown_error') }),
            variant: "destructive",
        });
    } finally {
        setIsSyncingSales(false);
    }
  };


  const renderConfigFields = () => {
    if (!selectedSystemId) return null;
    const fields = systemConfigFields[selectedSystemId] || [];
    if (fields.length === 0) {
        return <p className="text-sm text-muted-foreground">{t('pos_no_config_needed')}</p>;
    }
    return (
        <TooltipProvider>
            {fields.map(field => (
                <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key} className="flex items-center">
                    {t(field.labelKey)}
                    {field.tooltipKey && (
                        <Tooltip delayDuration={100}>
                        <TooltipTrigger asChild>
                            <HelpCircle className="ml-1.5 h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{t(field.tooltipKey)}</p>
                        </TooltipContent>
                        </Tooltip>
                    )}
                    </Label>
                    <Input
                    id={field.key}
                    type={field.type}
                    value={configValues[field.key] || ''}
                    onChange={(e) => handleInputChange(field.key, e.target.value)}
                    placeholder={t('pos_placeholder_enter_field', { fieldLabel: t(field.labelKey) })}
                    />
                </div>
            ))}
      </TooltipProvider>
    );
  };

  if (authLoading || isLoading || !user) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
       <Button variant="outline" size="sm" asChild className="mb-4">
        <Link href="/settings">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('back_to_settings_button')}
        </Link>
      </Button>
      <Card className="shadow-md scale-fade-in">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Plug className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('pos_title')}
          </CardTitle>
          <CardDescription>{t('pos_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="pos-system">{t('pos_select_system_label')}</Label>
            <Select value={selectedSystemId} onValueChange={handleSystemChange}>
              <SelectTrigger id="pos-system" className="w-full md:w-[300px]">
                <SelectValue placeholder={t('pos_select_system_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {availableSystems.length > 0 ? (
                  availableSystems.map(system => (
                    <SelectItem key={system.systemId} value={system.systemId}>
                      {system.systemName}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>{t('pos_no_systems_available')}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {selectedSystemId && (
            <Card className="bg-muted/30 p-4 md:p-6 space-y-4 border scale-fade-in" style={{animationDelay: '0.1s'}}>
                <h3 className="text-lg font-medium mb-4">
                    {t('pos_configure_system_title', { systemName: availableSystems.find(s => s.systemId === selectedSystemId)?.systemName || '' })}
                </h3>
                {renderConfigFields()}

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-4">
                    <Button
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={isTesting || !selectedSystemId || Object.keys(configValues).length === 0}
                        className="w-full sm:w-auto"
                    >
                        {isTesting ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('pos_testing_button')}...</>
                        ) : (
                            <>{t('pos_test_connection_button')}</>
                        )}
                    </Button>
                    {testResult && (
                        <div className={`flex items-center text-sm font-medium mt-2 sm:mt-0 sm:ml-4 ${testResult.success ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                            {testResult.success ? <CheckCircle className="mr-1 h-4 w-4" /> : <XCircle className="mr-1 h-4 w-4" />}
                            {testResult.message}
                        </div>
                    )}
                </div>
                 <div className="flex justify-end pt-2">
                     <Button
                         onClick={handleSaveChanges}
                         disabled={isSaving || !selectedSystemId || Object.keys(configValues).length === 0}
                         className="w-full sm:w-auto"
                     >
                     {isSaving ? (
                         <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving_button')}...</>
                     ) : (
                         <><Save className="mr-2 h-4 w-4" /> {t('pos_save_settings_button')}</>
                     )}
                     </Button>
                 </div>
            </Card>
          )}

           {selectedSystemId && (
               <Card className="p-4 md:p-6 space-y-4 border scale-fade-in" style={{animationDelay: '0.2s'}}>
                   <h3 className="text-lg font-medium">{t('pos_manual_sync_title')}</h3>
                   <CardDescription>{t('pos_manual_sync_note')}</CardDescription>
                   <Separator />
                   <div className="space-y-4">
                        <div>
                            <h4 className="text-md font-medium mb-2">{t('pos_sync_inventory_title')}</h4>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                <Button
                                    onClick={handleSyncInventoryNow}
                                    disabled={isSyncingInventory || !selectedSystemId || Object.keys(configValues).length === 0 || isSaving}
                                    className="w-full sm:w-auto"
                                >
                                    {isSyncingInventory ? (
                                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('pos_syncing_button')}...</>
                                    ) : (
                                        <><RefreshCw className="mr-2 h-4 w-4" /> {t('pos_sync_inventory_now_button')}</>
                                    )}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">{t('pos_manual_sync_desc_inventory')}</p>
                        </div>
                        <Separator />
                        <div>
                             <h4 className="text-md font-medium mb-2">{t('pos_sync_sales_title')}</h4>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                <Button
                                    onClick={handleSyncSalesNow}
                                    disabled={isSyncingSales || !selectedSystemId || Object.keys(configValues).length === 0 || isSaving}
                                    className="w-full sm:w-auto"
                                >
                                    {isSyncingSales ? (
                                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('pos_syncing_button')}...</>
                                    ) : (
                                        <><RefreshCw className="mr-2 h-4 w-4" /> {t('pos_sync_sales_now_button')}</>
                                    )}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">{t('pos_manual_sync_desc_sales')}</p>
                        </div>
                   </div>

                   {syncResults.length > 0 && (
                       <div className="mt-4 space-y-2 text-sm">
                           <h4 className="font-medium">{t('pos_sync_results_title')}</h4>
                           {syncResults.map((result, index) => (
                               <div key={index} className={`flex items-center ${result.success ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                                   {result.success ? <CheckCircle className="mr-1 h-4 w-4 flex-shrink-0" /> : <XCircle className="mr-1 h-4 w-4 flex-shrink-0" />}
                                   <span>{result.message} {result.itemsSynced !== undefined ? `(${result.itemsSynced} ${t('pos_items_synced_label')})` : ''}</span>
                               </div>
                           ))}
                       </div>
                   )}
               </Card>
           )}


          {!selectedSystemId && availableSystems.length > 0 && (
            <Alert className="scale-fade-in" style={{animationDelay: '0.1s'}}>
              <AlertTitle>{t('pos_alert_select_system_title')}</AlertTitle>
              <AlertDescription>
                {t('pos_alert_select_system_desc')}
              </AlertDescription>
            </Alert>
          )}
            {!selectedSystemId && availableSystems.length === 0 && (
            <Alert variant="destructive" className="scale-fade-in" style={{animationDelay: '0.1s'}}>
              <AlertTitle>{t('pos_alert_no_adapters_title')}</AlertTitle>
              <AlertDescription>
                {t('pos_alert_no_adapters_desc')}
              </AlertDescription>
            </Alert>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
