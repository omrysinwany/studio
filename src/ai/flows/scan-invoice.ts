// src/ai/flows/scan-invoice.ts
'use server';
/**
 * @fileOverview A flow to scan invoices using Gemini and extract product information.
 *
 * - scanInvoice - A function that handles the invoice scanning process.
 * - ScanInvoiceInput - The input type for the scanInvoice function.
 * - ScanInvoiceOutput - The return type for the scanInvoice function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';
import {
  ScanInvoiceInputSchema,
  ScanInvoiceOutputSchema,
  ExtractedProductSchema,
  FinalProductSchema,
  PromptOutputSchema,
} from './invoice-schemas';
import type {
  ScanInvoiceInput,
  ScanInvoiceOutput
} from './invoice-schemas';


export type { ScanInvoiceInput, ScanInvoiceOutput };


export async function scanInvoice(input: ScanInvoiceInput): Promise<ScanInvoiceOutput> {
  return scanInvoiceFlow(input);
}


const prompt = ai.definePrompt({
  name: 'scanInvoicePrompt',
  input: {
    schema: z.object({
      invoiceDataUri: z
        .string()
        .describe(
          "A photo of an invoice, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
        ),
    }),
  },
  output: {
    schema: PromptOutputSchema
  },
  prompt: `
    Analyze the following image and extract information.
    Provide the extracted data as a JSON **object**.

    This JSON object should have a key named "products" whose value is a JSON **array** (list) of JSON objects.
    Each JSON object in the "products" array should represent a single product. 
    
    For each product, ALWAYS include the following keys:
    "product_name" (string),
    "catalog_number" (string, if not found, provide an empty string "").

    Also include these keys if the information is present:
    "barcode" (EAN or UPC, include this key only if a barcode is clearly visible for that specific product),
    "quantity" (number),
    "purchase_price" (number),
    "sale_price" (number, include this key only if a sale price is clearly present for that specific product),
    "total" (number),
    "description" (string, include this key only if a description is clearly present for that specific product).

    **IMPORTANT for "quantity":** If there are multiple columns indicating quantity (e.g., one for "Units"/'יח'/'כמות' and another for "Cases"/'ארגזים'/'קרטונים'), ALWAYS extract the value from the column representing **individual units**.

    For the keys "quantity", "purchase_price", "sale_price", and "total", extract ONLY the numerical value (integers or decimals).
    **DO NOT** include any currency symbols (like $, ₪, EUR), commas (unless they are decimal separators if applicable), or any other non-numeric text in the values for these four keys. If the value is not found for "purchase_price", "sale_price", or "total", you can omit the key or provide a value of 0. For "quantity", if not found, provide 0.


    Include a key \`short_product_name\` containing a very brief (max 3-4 words) summary or key identifier for the product. If you cannot create a meaningful short name, provide 1-2 relevant keywords instead.
    
    Additionally, the main JSON object should also have a key named "invoice_details" if invoice-level information is found.
    The value of "invoice_details" should be a JSON object containing the following optional keys:
    "invoice_number" (string, the invoice number from the document),
    "supplier_name" (string, the supplier's name identified on the document),
    "invoice_total_amount" (number, the final total amount stated on the invoice, typically including taxes. Look for keywords like "סהכ לתשלום", "Total Amount Due", "Grand Total", "סהכ מחיר", "סהכ בתעודה". Extract ONLY the numerical value, no currency symbols).

    Ensure the entire output is a valid JSON object.
    If no products are found, "products" should be an empty array: \`{"products": []}\`.
    If no invoice-level details are found, the "invoice_details" key can be omitted or be an empty object.
    NEVER return null or an empty response. ALWAYS return a JSON object structured as described.

    Invoice Image: {{media url=invoiceDataUri}}
  `,
});


const scanInvoiceFlow = ai.defineFlow<
  typeof ScanInvoiceInputSchema,
  typeof ScanInvoiceOutputSchema
>({
  name: 'scanInvoiceFlow',
  inputSchema: ScanInvoiceInputSchema,
  outputSchema: ScanInvoiceOutputSchema
}, async (input, streamingCallback) => {
    let rawOutputFromAI: z.infer<typeof PromptOutputSchema> | null = null;
    let productsForOutput: z.infer<typeof FinalProductSchema>[] = [];
    let invoiceNumberForOutput: string | undefined = undefined;
    let supplierForOutput: string | undefined = undefined;
    let totalAmountForOutput: number | undefined = undefined;

    const maxRetries = 3;
    let currentRetry = 0;
    let delay = 1000; // Initial delay 1 second

    while (currentRetry < maxRetries) {
        try {
            if (streamingCallback) {
              streamingCallback({
                index: currentRetry,
                content: currentRetry > 0 ? `Retrying AI call (attempt ${currentRetry + 1})...` : 'Calling AI for scan...'
              });
            }
            const { output } = await prompt(input);
            
            const validationResult = PromptOutputSchema.safeParse(output);

            if (!validationResult.success) {
                console.error('AI output structure validation failed. Received:', output, 'Errors:', validationResult.error.flatten());
                if (currentRetry < maxRetries - 1 && output === null) { 
                    console.log(`AI returned null, retrying... (Attempt ${currentRetry + 1})`);
                    currentRetry++;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                    continue;
                }
                return {
                    products: [],
                    error: `AI output validation failed: ${validationResult.error.flatten().formErrors.join(', ')}`
                };
            }
            rawOutputFromAI = validationResult.data;
            break; 

        } catch (promptError: any) {
            console.error(`Error calling AI prompt (attempt ${currentRetry + 1}):`, promptError, "Raw AI output if available (before error):", rawOutputFromAI);
            
            const isServiceUnavailable = promptError.message?.includes("503") || promptError.message?.toLowerCase().includes("service unavailable") || promptError.message?.toLowerCase().includes("model is overloaded");
            const isRateLimit = promptError.message?.includes("429") || promptError.message?.toLowerCase().includes("rate limit");

            if ((isServiceUnavailable || isRateLimit) && currentRetry < maxRetries - 1) {
                currentRetry++;
                if (streamingCallback) {
                  streamingCallback({
                    index: currentRetry,
                    content: `AI service temporarily unavailable. Retrying in ${delay/1000}s... (Attempt ${currentRetry + 1})`
                  });
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; 
            } else {
                let userErrorMessage = `Error calling AI: ${promptError.message || 'Unknown AI error'}`;
                if (isServiceUnavailable) {
                     userErrorMessage = "The AI scanning service is temporarily unavailable due to high demand. Please try again in a few minutes. If the issue persists, you can add products manually.";
                } else if (promptError.message && (promptError.message.includes("INVALID_ARGUMENT") || promptError.message.includes("Parse Error")) && promptError.message.includes("Provided data: null")) {
                    userErrorMessage = "The AI model failed to return structured product data. This can happen with unclear images or complex layouts. Please try a clearer image or add products manually.";
                } else if (promptError.message && promptError.message.includes("Schema validation failed")) {
                     userErrorMessage = `The AI model's response did not match the expected format. Details: ${promptError.message}`;
                }
                return { products: [], error: userErrorMessage };
            }
        }
    }

    if (!rawOutputFromAI) {
        return { products: [], error: "AI processing failed after multiple retries. The AI service might be temporarily unavailable. Please try again later or add products manually." };
    }
    
    if (streamingCallback) streamingCallback({ index: maxRetries, content: 'Processing scanned data...' });

    try {
        if (!rawOutputFromAI || !Array.isArray(rawOutputFromAI.products)) {
            console.error('Invalid rawOutputFromAI structure before processing product lines:', rawOutputFromAI);
            return { products: [], error: "Internal error: Invalid raw product data structure from AI after initial processing." };
        }

        productsForOutput = rawOutputFromAI.products
            .map((rawProduct: z.infer<typeof ExtractedProductSchema>) => {
                const quantity = rawProduct.quantity ?? 0;
                const lineTotal = rawProduct.total ?? 0;
                const purchasePrice = rawProduct.purchase_price ?? 0;
                const salePrice = rawProduct.sale_price; 

                let unitPrice = 0;
                if (quantity !== 0 && lineTotal !== 0) {
                    unitPrice = parseFloat((lineTotal / quantity).toFixed(2));
                } else if (purchasePrice !== 0) {
                    unitPrice = purchasePrice;
                }

                const description = rawProduct.product_name || rawProduct.description || rawProduct.catalog_number || 'Unknown Product';
                const shortName = rawProduct.short_product_name || description.split(' ').slice(0, 3).join(' ') || rawProduct.catalog_number || undefined;

                const finalProduct: z.infer<typeof FinalProductSchema> = {
                    catalogNumber: rawProduct.catalog_number || 'N/A',
                    barcode: rawProduct.barcode,
                    description: description,
                    shortName: shortName,
                    quantity: quantity,
                    unitPrice: unitPrice, 
                    salePrice: salePrice,
                    lineTotal: lineTotal,
                    minStockLevel: undefined,
                    maxStockLevel: undefined,
                };
                return finalProduct;
            })
            .filter(product => (product.catalogNumber && product.catalogNumber !== 'N/A') || (product.description && product.description !== 'Unknown Product') || product.barcode);


        if (rawOutputFromAI.invoice_details) {
            invoiceNumberForOutput = rawOutputFromAI.invoice_details.invoice_number;
            supplierForOutput = rawOutputFromAI.invoice_details.supplier_name;
            totalAmountForOutput = rawOutputFromAI.invoice_details.invoice_total_amount;
        }
        
        if (streamingCallback) streamingCallback({ index: maxRetries +1 , content: 'Scan processing complete!' });
        return { 
            products: productsForOutput,
            invoiceNumber: invoiceNumberForOutput,
            supplier: supplierForOutput,
            totalAmount: totalAmountForOutput,
        };

    } catch (processingError: any) {
         console.error('Error processing AI output:', processingError, 'Raw Output for processing:', rawOutputFromAI);
         return { products: [], error: `Error processing AI data: ${(processingError as Error).message || 'Unknown processing error'}` };
    }
});

