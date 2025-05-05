
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getAvailablePosSystems, testPosConnection, getPosAdapter, syncWithPos } from '@/services/pos-integration/integration-manager'; // Import syncWithPos
import { savePosSettings, getPosSettings } from '@/services/backend'; // Import backend functions for settings
import type { PosConnectionConfig, SyncResult } from '@/services/pos-integration/pos-adapter.interface'; // Import SyncResult type
import { Loader2, Settings, Plug, CheckCircle, XCircle, Save, HelpCircle, RefreshCw } from 'lucide-react'; // Added RefreshCw
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from '@/components/ui/separator'; // Import Separator

type PosSystemInfo = { systemId: string; systemName: string };

export default function PosIntegrationSettingsPage() {
  const [availableSystems, setAvailableSystems] = useState<PosSystemInfo[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<string>('');
  const [configValues, setConfigValues] = useState<PosConnectionConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false); // Initialize with false
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false); // State for sync process
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]); // State for sync results
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
        setConfigValues(savedSettings.config || {}); // Ensure config is an object
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
  }, [toast]); // Include toast in dependencies

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]); // Run loadInitialData on mount

  const handleSystemChange = (systemId: string) => {
    setSelectedSystemId(systemId);
    setConfigValues({}); // Reset config when system changes
    setTestResult(null); // Reset test result
    setSyncResults([]); // Reset sync results
  };

  const handleInputChange = (field: keyof PosConnectionConfig, value: string) => {
    setConfigValues(prev => ({ ...prev, [field]: value }));
    setTestResult(null); // Reset test result on input change
    setSyncResults([]); // Reset sync results
  };

  const handleTestConnection = async () => {
    if (!selectedSystemId) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const success = await testPosConnection(selectedSystemId, configValues);
      setTestResult({
        success: success,
        message: success ? 'Connection successful!' : 'Connection failed. Please check your settings.',
      });
      toast({
        title: success ? 'Connection Test Succeeded' : 'Connection Test Failed',
        description: success ? 'Successfully connected to the POS system.' : 'Could not connect. Verify credentials.',
        variant: success ? 'default' : 'destructive',
      });
    } catch (error: any) {
        console.error("Error testing connection:", error);
        setTestResult({ success: false, message: `Error: ${error.message || 'Unknown error'}` });
        toast({
            title: 'Connection Test Error',
            description: `An error occurred: ${error.message || 'Unknown error'}`,
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
       setTestResult(null); // Reset test result after saving
       setSyncResults([]); // Reset sync results
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
     toast({ title: "Sync Started", description: `Starting sync with ${selectedSystemId}...` });
     try {
       // Perform both product and sales sync ('all')
       const results = await syncWithPos(selectedSystemId, configValues, 'all');
       setSyncResults(results);

       const overallSuccess = results.every(r => r.success);
       toast({
         title: overallSuccess ? "Sync Completed" : "Sync Partially Failed",
         description: overallSuccess
           ? `Successfully synced data with ${selectedSystemId}.`
           : `Some sync operations failed. Check details below.`,
         variant: overallSuccess ? 'default' : 'destructive',
       });

       // Optionally refresh other parts of the app or indicate data updated
        // Example: router.push('/inventory?refresh=true');

     } catch (error: any) {
       console.error("Error during manual sync:", error);
       setSyncResults([{ success: false, message: `Sync failed: ${error.message || 'Unknown error'}` }]);
       toast({
         title: "Sync Error",
         description: `An error occurred during synchronization: ${error.message || 'Unknown error'}`,
         variant: "destructive",
       });
     } finally {
       setIsSyncing(false);
     }
   };

  // --- Dynamic Form Fields based on selected system ---
  const renderConfigFields = () => {
    if (!selectedSystemId) return null;

    // Basic fields required by Caspit demo adapter
    // In a real app, use adapter.getSettingsSchema() if implemented
    const fields: { key: keyof PosConnectionConfig; label: string; type: string; tooltip?: string }[] = [
      { key: 'user', label: 'Caspit Username', type: 'text', tooltip: 'Your Caspit login username.' },
      { key: 'pwd', label: 'Caspit Password', type: 'password', tooltip: 'Your Caspit login password.' },
      { key: 'osekMorshe', label: 'Business ID (Osek Morshe)', type: 'text', tooltip: 'Your Caspit business identifier (עוסק מורשה).' },
      // { key: 'apiKey', label: 'API Key', type: 'password', tooltip: 'Your unique API key provided by the POS system.' },
      // Add more fields based on specific adapter needs
    ];

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
                    type={field.type} // Use 'password' for sensitive fields
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
          <CardDescription>Connect InvoTrack to your POS system to synchronize data automatically.</CardDescription>
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
                        disabled={isTesting || Object.keys(configValues).length === 0}
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
                   <h3 className="text-lg font-medium">Manual Synchronization</h3>
                   <Separator />
                   <div className="flex flex-col sm:flex-row items-center gap-4">
                       <Button
                           onClick={handleSyncNow}
                           disabled={isSyncing || !selectedSystemId || Object.keys(configValues).length === 0 || isSaving} // Disable if no config or saving
                       >
                           {isSyncing ? (
                               <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Syncing...</>
                           ) : (
                               <><RefreshCw className="mr-2 h-4 w-4" /> Sync Now (All)</>
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
                    <p className="text-xs text-muted-foreground">Manually synchronizes products and sales data with the selected POS system.</p>
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
