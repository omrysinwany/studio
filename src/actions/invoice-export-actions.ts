'use server';

import { getInvoicesService, type InvoiceHistoryItem } from '@/services/backend';
import { format, parseISO } from 'date-fns';

// Helper function to escape CSV values
const escapeCsvValue = (value: any): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    try { return value.toISOString(); } catch { return 'Invalid Date'; }
  }
  let stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    stringValue = stringValue.replace(/"/g, '""'); // Escape double quotes
    return `"${stringValue}"`;
  }
  return stringValue;
};

export async function generateAndEmailInvoicesAction(
  selectedInvoiceIds: string[],
  accountantEmail: string,
  note: string,
  userId?: string
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  try {
    const allInvoices = await getInvoicesService(userId);
    const selectedInvoices = allInvoices.filter(invoice => selectedInvoiceIds.includes(invoice.id));

    if (selectedInvoices.length === 0) {
      return { success: false, message: "No invoices selected or found." };
    }

    // Define CSV Headers (adjust keys and labels as needed)
    const headers = [
      "Invoice ID",
      "File Name",
      "Invoice Number",
      "Supplier",
      "Total Amount",
      "Scan Status",
      "Payment Status",
      "Upload Date",
      "Due Date",
      "Error Message"
    ];

    const csvRows = selectedInvoices.map(invoice => [
      escapeCsvValue(invoice.id),
      escapeCsvValue(invoice.fileName),
      escapeCsvValue(invoice.invoiceNumber),
      escapeCsvValue(invoice.supplier),
      escapeCsvValue(invoice.totalAmount !== undefined ? invoice.totalAmount.toFixed(2) : ''),
      escapeCsvValue(invoice.status),
      escapeCsvValue(invoice.paymentStatus),
      escapeCsvValue(invoice.uploadTime ? format(parseISO(invoice.uploadTime as string), 'yyyy-MM-dd HH:mm') : ''),
      escapeCsvValue(invoice.paymentDueDate ? format(parseISO(invoice.paymentDueDate as string), 'yyyy-MM-dd') : ''),
      escapeCsvValue(invoice.errorMessage)
    ]);

    const csvContent = [headers.join(','), ...csvRows.map(row => row.join(','))].join('\n');

    // Simulate email sending
    console.log("--- SIMULATING INVOICE EXPORT EMAIL ---");
    console.log("To:", accountantEmail);
    console.log("Note:", note || "(No note provided)");
    console.log("Attachment: invoices.csv");
    console.log("CSV Content:\n", csvContent);
    console.log("--- END OF SIMULATION ---");

    // In a real application, you would use an email service (e.g., SendGrid, Nodemailer) here
    // await sendEmailWithAttachment(accountantEmail, "Selected Invoices Export", note, csvContent, "invoices.csv");

    return { success: true, message: `Successfully prepared ${selectedInvoices.length} invoices. Email simulation logged to console.` };

  } catch (error: any) {
    console.error("Error in generateAndEmailInvoicesAction:", error);
    return { success: false, message: `Failed to export invoices: ${error.message || 'Unknown error'}` };
  }
}
