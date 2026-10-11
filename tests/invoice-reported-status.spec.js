import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok } from './support/mock-backend';

/**
 * A simplified (B2C) invoice reported to ZATCA is REPORTED; invoices reported
 * before that fix are stored as ACCEPTED. Both must offer credit and debit
 * notes and nothing that would change or resend the invoice.
 */

const page1 = (rows) => ok({ data: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } });

const reported = (status, no) => ({
  _id: `id-${no}`,
  invoiceNumber: no,
  referenceNumber: `REF-${no}`,
  status,
  invoiceType: 'B2C',
  currency: 'SAR',
  paymentType: 'CASH',
  customerId: { registrationName: 'Acme Corp' },
  totalsInCurrency: { grandTotal: 115 },
  createdAt: '2026-10-11T10:00:00.000Z',
  compliance: { invoiceXml: '<Invoice/>', zatcaResponse: { valid: true } },
  clearance: { invoiceXml: '<Invoice/>', zatcaResponse: { reportingStatus: 'REPORTED' } },
});

for (const status of ['REPORTED', 'ACCEPTED']) {
  test(`a ${status} simplified invoice offers credit/debit notes and cannot be resent, edited or deleted`, async ({ page }) => {
    const no = status === 'REPORTED' ? 'INV-2026-000901' : 'INV-2026-000902';
    await mockBackend(page, {
      routes: [{ method: 'GET', match: (p) => p.endsWith('/invoices'), respond: () => page1([reported(status, no)]) }],
    });
    await signIn(page);
    await page.goto('/invoices');
    const row = page.getByRole('row', { name: new RegExp(no) });
    await expect(row).toBeVisible();

    await expect(row.locator('.breeze-pill').first()).toHaveClass(/bg-green-300/);
    await expect(row.getByRole('button', { name: 'Create credit note' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Create debit note' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Report to ZATCA' })).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Delete invoice' })).toHaveCount(0);
    await expect(row.getByRole('checkbox')).toBeDisabled();
  });
}
