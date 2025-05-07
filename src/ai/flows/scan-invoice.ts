
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
  FinalProductSchema
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
    schema: z.object({
        products: z.array(ExtractedProductSchema)
                 .describe('Raw extracted product list from the invoice.'),
    })
  },
  prompt: `
    Analyze the following image and extract information for ALL distinct products found.
    Provide the extracted data as a JSON **object** with a single key named "products".
    The value of the "products" key should be a JSON **array** (list) of JSON objects.
    Each JSON object in the array should represent a single product and contain the following keys:
    "product_name",
    "catalog_number",
    "barcode" (EAN or UPC, include this key only if a barcode is clearly visible for that specific product),
    "quantity",
    "purchase_price",
    "total",
    "description" (include this key only if a description is clearly present for that specific product).

    **IMPORTANT for "quantity":** If there are multiple columns indicating quantity (e.g., one for "Units"/'יח'/'כמות' and another for "Cases"/'ארגזים'/'קרטונים'), ALWAYS extract the value from the column representing **individual units**.

    For the keys "quantity", "purchase_price", and "total", extract ONLY the numerical value (integers or decimals).
    **DO NOT** include any currency symbols (like $, ₪, EUR), commas (unless they are decimal separators if applicable), or any other non-numeric text in the values for these three keys.

    **NEW**: Also, include a key \`short_product_name\` containing a very brief (max 3-4 words) summary or key identifier for the product. If you cannot create a meaningful short name, provide 1-2 relevant keywords instead.

    If a specific piece of information (other than description and barcode) for a product is not found, you can omit that key from that product's JSON object.
    Ensure the output is a valid JSON object.
    If no products are found, return a JSON object with the "products" key set to an empty array: \`{"products": []}\`.
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
}, async input => {
    let rawOutputFromAI: any = null; // To store the direct output from AI
    try {
        const { output } = await prompt(input);
        rawOutputFromAI = output; // Store the raw output for logging

        const validationResult = z.object({ products: z.array(ExtractedProductSchema).nullable() }).safeParse(output);

        if (validationResult.success) {
             // Handle cases where 'products' might be null even if the object structure is valid
            const productsArray = validationResult.data.products ?? [];
            rawOutputFromAI = { products: productsArray }; // Ensure rawOutput always has a products array
        } else {
            console.error('AI did not return the expected { products: [...] } structure or validation failed. Received:', output, 'Errors:', validationResult.error);
            return { products: [], error: "AI output validation failed. The structure of the data from the AI was not as expected." };
        }

    } catch (promptError: any) {
        console.error('Error calling AI prompt:', promptError, "Raw AI output if available:", rawOutputFromAI);
        return { products: [], error: `Error calling AI: ${promptError.message || 'Unknown AI error'}` };
    }

    try {
        if (!rawOutputFromAI || !Array.isArray(rawOutputFromAI.products)) {
            console.error('Invalid rawOutputFromAI structure before processing:', rawOutputFromAI);
            return { products: [], error: "Internal error: Invalid raw data structure from AI after initial processing." };
        }

        const processedProducts = rawOutputFromAI.products
            .map((rawProduct: z.infer<typeof ExtractedProductSchema>) => {
                const quantity = rawProduct.quantity ?? 0;
                const lineTotal = rawProduct.total ?? 0;
                const purchasePrice = rawProduct.purchase_price ?? 0;

                const calculatedUnitPrice = quantity !== 0 && lineTotal !== 0
                               ? parseFloat((lineTotal / quantity).toFixed(2))
                               : 0;

                const unitPrice = calculatedUnitPrice !== 0 ? calculatedUnitPrice : purchasePrice;
                const description = rawProduct.product_name || rawProduct.description || rawProduct.catalog_number || 'Unknown Product';
                const shortName = rawProduct.short_product_name || description.split(' ').slice(0, 3).join(' ') || rawProduct.catalog_number || undefined;

                const finalProduct: z.infer<typeof FinalProductSchema> = {
                    catalogNumber: rawProduct.catalog_number || 'N/A',
                    barcode: rawProduct.barcode,
                    description: description,
                    shortName: shortName,
                    quantity: quantity,
                    unitPrice: unitPrice,
                    lineTotal: lineTotal,
                };
                return finalProduct;
            })
            .filter(product => product.catalogNumber !== 'N/A' || product.description !== 'Unknown Product' || product.barcode);

        return { products: processedProducts };

    } catch (processingError: any) {
         console.error('Error processing AI output:', processingError, 'Raw Output for processing:', rawOutputFromAI);
         return { products: [], error: `Error processing AI data: ${(processingError as Error).message || 'Unknown processing error'}` };
    }
});
