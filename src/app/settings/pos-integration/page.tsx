'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getAvailablePosSystems, testPosConnection } from '@/services/pos-integration/integration-manager';
import { savePosSettings, getPosSettings, saveProducts } from '@/services/backend'; // Import backend functions for settings AND saveProducts
import type { PosConnectionConfig, SyncResult, Product } from '@/services/pos-integration/pos-adapter.interface'; // Import SyncResult type
import { syncInventoryAction } from '@/actions/sync-inventory-action'; // Import the inventory sync action
import { syncCaspitSalesAction } from '@/actions/caspit-actions'; // Keep sales action for demo
import { Loader2, Settings, Plug, CheckCircle, XCircle, Save, HelpCircle, RefreshCw } from 'lucide-react'; // Added RefreshCw
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from '@/components/ui/separator'; // Import Separator

type PosSystemInfo = { systemId: string; systemName: string };

// Define field structures for different systems
const systemConfigFields: Record<string, { key: keyof PosConnectionConfig; label: string; type: string; tooltip?: string }[]> = {
  caspit: [
    { key: 'user', label: 'Caspit Username', type: 'text', tooltip: 'Your Caspit login username.' },
    { key: 'pwd', label: 'Caspit Password', type: 'password', tooltip: 'Your Caspit login password.' },
    { key: 'osekMorshe', label: 'Business ID (Osek Morshe)', type: 'text', tooltip: 'Your Caspit business identifier (עוסק מורשה).' },
  ],
  hashavshevet: [
     { key: 'apiKey', label: 'Hashavshevet API Key', type: 'password', tooltip: 'Your unique API key for Hashavshevet.' },
     { key: 'apiSecret', label: 'Hashavshevet API Secret (Optional)', type: 'password', tooltip: 'Your API Secret, if required by Hashavshevet.' },
     { key: 'companyId', label: 'Hashavshevet Company ID', type: 'text', tooltip: 'Your specific company identifier in Hashavshevet.' },
     { key: 'endpointUrl', label: 'Hashavshevet API URL (Optional)', type: 'text', tooltip: 'Override the default API URL if needed.' },
  ],
};


export default function PosIntegrationSettingsPage() {
  const [availableSystems, setAvailableSystems] = useState<PosSystemInfo[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<string>('');
  const [configValues, setConfigValues] = useState<PosConnectionConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false); // Initialize state properly
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]); // Combined results from diff sync types
  const { toast } = useToast();

  // Fetch available systems and load existing settings on mount
  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    try {
      const systems = getAvailablePosSystems();
      setAvailableSystems(systems);

      const savedSettings = await getPosSettings();
      if (savedSettings) {
        setSelectedSystemId(savedSettings.systemId);
        setConfigValues(savedSettings.config || {});
      }
    } catch (error) {
      console.error("Error loading POS settings:", error);
      toast({
        title: "Error Loading Settings",
        description: "Could not load POS integration settings.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const handleSystemChange = (systemId: string) => {
    setSelectedSystemId(systemId);
    // Fetch saved settings for the newly selected system
    getPosSettings().then(savedSettings => {
        if (savedSettings && savedSettings.systemId === systemId) {
            setConfigValues(savedSettings.config || {});
        } else {
            // If no saved settings for this system, clear the config form
            setConfigValues({});
        }
    }).catch(error => {
        console.error("Error fetching settings on system change:", error);
        setConfigValues({}); // Clear form on error too
        toast({ title: "Error", description: "Could not load settings for the selected system.", variant: "destructive" });
    });
    setTestResult(null); // Clear test result on system change
    setSyncResults([]); // Clear sync results on system change
  };


  const handleInputChange = (field: keyof PosConnectionConfig, value: string) => {
    setConfigValues(prev => ({ ...prev, [field]: value }));
    setTestResult(null);
    setSyncResults([]);
  };

  const handleTestConnection = async () => {
     if (!selectedSystemId) return;
     setIsTesting(true);
     setTestResult(null);
     let result: { success: boolean; message: string } | null = null;
     console.log(`[POS Page] Testing connection for ${selectedSystemId} with config:`, configValues);
     try {
       // Use the manager function which now calls the correct adapter/action
       result = await testPosConnection(selectedSystemId, configValues);
       setTestResult(result);
       toast({
         title: result.success ? 'Connection Test Succeeded' : 'Connection Test Failed',
         description: result.message,
         variant: result.success ? 'default' : 'destructive',
       });
     } catch (error: any) {
        console.error("[POS Page] Error during test connection call:", error);
        const errorMessage = `Error: ${error.message || 'Unknown error during test'}`;
        result = { success: false, message: errorMessage };
        setTestResult(result);
       toast({
         title: 'Connection Test Error',
         description: errorMessage,
         variant: 'destructive',
       });
     } finally {
       setIsTesting(false);
     }
   };


  const handleSaveChanges = async () => {
    if (!selectedSystemId) return;
    setIsSaving(true);
    try {
      await savePosSettings(selectedSystemId, configValues);
      toast({
        title: "Settings Saved",
        description: `POS integration settings for ${availableSystems.find(s => s.systemId === selectedSystemId)?.systemName || 'system'} saved successfully.`,
      });
       setTestResult(null); // Clear test result after saving
       setSyncResults([]); // Clear sync results after saving
    } catch (error: any) {
      console.error("Error saving settings:", error);
      toast({
        title: "Save Failed",
        description: `Could not save settings: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

   const handleSyncNow = async () => {
     if (!selectedSystemId) return;

     setIsSyncing(true);
     setSyncResults([]); // Clear previous results
     toast({ title: "Inventory Sync Started", description: `Starting inventory sync with ${selectedSystemId}...` });
     let inventorySyncSucceeded = false;

     try {

         // **No need to call getPosSettings() here - pass configValues directly**
         // const settings = await getPosSettings(); // REMOVED
         // if (!settings || settings.systemId !== selectedSystemId || !settings.config) {
         //      throw new Error(`POS settings for ${selectedSystemId} not configured or incomplete.`);
         // }
         // const currentConfig = settings.config; // REMOVED

         // 2. Call the server action, passing the current config from state
         console.log(`[POS Page] Calling syncInventoryAction for ${selectedSystemId} with config...`);
         const inventoryResult = await syncInventoryAction(configValues, selectedSystemId); // Pass configValues from state
         setSyncResults([inventoryResult]); // Show inventory sync result

         if (inventoryResult.success && inventoryResult.products) {
             inventorySyncSucceeded = true;
             // 3. Save fetched products ON THE CLIENT using saveProducts
             try {
                 console.log(`[POS Page] Saving ${inventoryResult.products.length} synced products...`);
                 await saveProducts(inventoryResult.products, `POS Sync (${selectedSystemId}) ${new Date().toISOString()}`, `${selectedSystemId}_sync`);
                 console.log(`[POS Page] Successfully saved synced products.`);
                 // Add success message for saving
                 setSyncResults(prev => [...prev, { success: true, message: `Saved ${inventoryResult.products?.length ?? 0} products to inventory.` }]);
                 toast({
                    title: "Inventory Sync Completed",
                    description: `Successfully synced and saved ${inventoryResult.products.length} products from ${selectedSystemId}.`,
                 });
             } catch (saveError: any) {
                 inventorySyncSucceeded = false; // Mark as failed if saving fails
                 console.error("[POS Page] Error saving synced products:", saveError);
                 setSyncResults(prev => [...prev, { success: false, message: `Failed to save products: ${saveError.message}` }]);
                 toast({
                     title: "Product Save Failed",
                     description: `Could not save synced products: ${saveError.message || 'Unknown error'}`,
                     variant: "destructive",
                 });
             }
         } else {
            // Inventory sync failed at fetching stage
            toast({
                title: "Inventory Sync Failed",
                description: inventoryResult.message || `Failed to sync inventory with ${selectedSystemId}.`,
                variant: "destructive",
            });
         }
     } catch (error: any) {
         console.error(`[POS Page] Error during ${selectedSystemId} inventory sync process:`, error);
         setSyncResults([{ success: false, message: `Inventory sync failed: ${error.message || 'Unknown error'}` }]);
         toast({
             title: "Inventory Sync Error",
             description: `An error occurred during inventory synchronization: ${error.message || 'Unknown error'}`,
             variant: "destructive",
         });
     } finally {
         setIsSyncing(false);
     }

     // --- Placeholder for Sales Sync (Keep separate if needed) ---
     /*
     setIsSyncing(true); // Reuse or use separate state if running concurrently
     try {
        const salesConfig = await getPosSettings(); // Refetch config just in case
        if (salesConfig && salesConfig.systemId === 'caspit' && salesConfig.config) {
            const salesResult = await syncCaspitSalesAction(salesConfig.config);
            // Add sales result to syncResults (careful with state updates if concurrent)
            setSyncResults(prev => [...prev, salesResult]);
            toast({
                title: salesResult.success ? "Sales Sync Completed (Placeholder)" : "Sales Sync Failed (Placeholder)",
                description: salesResult.message,
                variant: salesResult.success ? 'default' : 'destructive',
            });
        }
     } catch (salesError: any) {
        // Handle sales sync error
     } finally {
        // Update syncing state
     }
     */

   };

  // --- Dynamic Form Fields based on selected system ---
  const renderConfigFields = () => {
    if (!selectedSystemId) return null;
    const fields = systemConfigFields[selectedSystemId] || [];
    if (fields.length === 0) {
        return <p className="text-sm text-muted-foreground">No specific configuration needed for this system, or configuration fields not yet defined.</p>;
    }
    return (
        <TooltipProvider>
            {fields.map(field => (
                <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key} className="flex items-center">
                    {field.label}
                    {field.tooltip && (
                        <Tooltip delayDuration={100}>
                        <TooltipTrigger asChild>
                            <HelpCircle className="ml-1.5 h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{field.tooltip}</p>
                        </TooltipContent>
                        </Tooltip>
                    )}
                    </Label>
                    <Input
                    id={field.key}
                    type={field.type}
                    value={configValues[field.key] || ''}
                    onChange={(e) => handleInputChange(field.key, e.target.value)}
                    placeholder={`Enter ${field.label}`}
                    />
                </div>
            ))}
      </TooltipProvider>
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary flex items-center">
            <Plug className="mr-2 h-6 w-6" /> Point of Sale (POS) Integration
          </CardTitle>
          <CardDescription>Connect InvoTrack to your POS system to synchronize data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* System Selection */}
          <div className="space-y-2">
            <Label htmlFor="pos-system">Select POS System</Label>
            <Select value={selectedSystemId} onValueChange={handleSystemChange}>
              <SelectTrigger id="pos-system" className="w-full md:w-[300px]">
                <SelectValue placeholder="Choose a system..." />
              </SelectTrigger>
              <SelectContent>
                {availableSystems.length > 0 ? (
                  availableSystems.map(system => (
                    <SelectItem key={system.systemId} value={system.systemId}>
                      {system.systemName}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>No systems available</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Configuration Fields */}
          {selectedSystemId && (
            <Card className="bg-muted/30 p-4 md:p-6 space-y-4 border">
                <h3 className="text-lg font-medium mb-4">
                    Configure {availableSystems.find(s => s.systemId === selectedSystemId)?.systemName}
                </h3>
                {renderConfigFields()}

                {/* Connection Test */}
                <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
                    <Button
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={isTesting || !selectedSystemId || Object.keys(configValues).length === 0}
                    >
                        {isTesting ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Testing...</>
                        ) : (
                            <>Test Connection</>
                        )}
                    </Button>
                    {testResult && (
                        <div className={`flex items-center text-sm font-medium ${testResult.success ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                            {testResult.success ? <CheckCircle className="mr-1 h-4 w-4" /> : <XCircle className="mr-1 h-4 w-4" />}
                            {testResult.message}
                        </div>
                    )}
                </div>
                 {/* Save Button for Config */}
                 <div className="flex justify-end pt-2">
                     <Button
                         onClick={handleSaveChanges}
                         disabled={isSaving || !selectedSystemId || Object.keys(configValues).length === 0}
                     >
                     {isSaving ? (
                         <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                     ) : (
                         <><Save className="mr-2 h-4 w-4" /> Save Settings</>
                     )}
                     </Button>
                 </div>
            </Card>
          )}

           {/* Manual Sync Section */}
           {selectedSystemId && (
               <Card className="p-4 md:p-6 space-y-4 border">
                   <h3 className="text-lg font-medium">Manual Inventory Synchronization</h3>
                   <Separator />
                   <div className="flex flex-col sm:flex-row items-center gap-4">
                       <Button
                           onClick={handleSyncNow} // This button now triggers inventory sync
                           disabled={isSyncing || !selectedSystemId || Object.keys(configValues).length === 0 || isSaving} // Disable if no config or saving
                       >
                           {isSyncing ? (
                               <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Syncing Inventory...</>
                           ) : (
                               <><RefreshCw className="mr-2 h-4 w-4" /> Sync Inventory Now</> // Changed label
                           )}
                       </Button>
                       {/* Display Sync Results */}
                       {syncResults.length > 0 && (
                           <div className="space-y-2 text-sm mt-2 sm:mt-0">
                               {syncResults.map((result, index) => (
                                   <div key={index} className={`flex items-center ${result.success ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                                       {result.success ? <CheckCircle className="mr-1 h-4 w-4 flex-shrink-0" /> : <XCircle className="mr-1 h-4 w-4 flex-shrink-0" />}
                                       <span>{result.message} {result.itemsSynced !== undefined ? `(${result.itemsSynced} items)` : ''}</span>
                                   </div>
                               ))}
                           </div>
                       )}
                   </div>
                    <p className="text-xs text-muted-foreground">Manually synchronizes product data from the selected POS system.</p>
                    {/* Add notes about scheduled sync if needed */}
                    <p className="text-xs text-muted-foreground mt-2">Note: Automatic daily sync requires additional setup (e.g., Cron Jobs).</p>
               </Card>
           )}


          {/* Initial/No System Selected State */}
          {!selectedSystemId && availableSystems.length > 0 && (
            <Alert>
              <AlertTitle>Select a System</AlertTitle>
              <AlertDescription>
                Please choose a POS system from the list above to configure the integration.
              </AlertDescription>
            </Alert>
          )}
            {!selectedSystemId && availableSystems.length === 0 && (
            <Alert variant="destructive">
              <AlertTitle>No Adapters Available</AlertTitle>
              <AlertDescription>
                No POS system adapters are currently configured in the application. Add adapters in the code to enable integration.
              </AlertDescription>
            </Alert>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
