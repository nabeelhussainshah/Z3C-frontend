import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';
import { ZATCA_VAT_RATES, vatRateError } from '../src/utils/vat-exemptions.js';

/**
 * ZATCA accepts invoice VAT of 15%, 5% or 0% only (BR-KSA-84 rejects any other
 * rate). A 10% invoice used to be saved and queued, then rejected by ZATCA; the
 * form now stops it before anything is sent.
 */

test.describe('VAT rate helper', () => {
  test('allows only the ZATCA rates', () => {
    expect(ZATCA_VAT_RATES).toEqual([15, 5, 0]);
    for (const vat of [15, '15', 5, '5', 0, '0', '15.00']) expect(vatRateError(vat)).toBe('');
    for (const vat of [10, '10', 12.5, '14.99', 16, 100])
      expect(vatRateError(vat)).toBe('VAT must be 15%, 5% or 0% (ZATCA accepts no other rate)');
  });

  test('leaves an empty value to the required check', () => {
    expect([vatRateError(''), vatRateError(null), vatRateError(undefined)]).toEqual(['', '', '']);
  });
});

const CUSTOMER = { _id: 'cust-co', id: 'cust-co', registrationName: 'Acme Corp', customerVAT: '300000000000003', countryCode: 'SA' };

async function openNewInvoice(page) {
  const calls = await mockBackend(page, {
    routes: [
      { method: 'GET', match: (p) => p.endsWith('/vat-exemption-codes'), respond: () => ok([]) },
      { method: 'GET', match: (p) => p.endsWith('/currencies'), respond: () => ok([{ code: 'SAR', name: 'Saudi Riyal' }]) },
      { method: 'GET', match: (p) => p.endsWith('/customers'), respond: () => ok([CUSTOMER]) },
      { method: 'POST', match: (p) => p.endsWith('/invoices/excl-customer'), respond: () => ok({ _id: 'inv-new' }, 201) },
    ],
  });
  await signIn(page);
  await page.goto('/invoices/new');
  await page.getByPlaceholder('REF-00000').fill('REF-VAT-1');
  await page.getByPlaceholder('e.g. Net 30').fill('Net 30');
  await page.getByText('Select or search customer...').click({ force: true });
  await page.keyboard.type('Acme');
  await page.getByText('Acme Corp', { exact: true }).click();
  await page.getByPlaceholder('Description of product...').fill('Item 1');
  await page.getByPlaceholder('SKU').fill('P-1');
  await page.getByPlaceholder('Description of product...').locator('xpath=ancestor::tr').locator('input[type="number"]').nth(1).fill('100');
  return calls;
}

test('a VAT rate other than 15, 5 or 0 is refused before the invoice is sent', async ({ page }) => {
  const calls = await openNewInvoice(page);
  await page.locator('input[name="vat"]').fill('10');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('VAT must be 15%, 5% or 0% (ZATCA accepts no other rate)').first()).toBeVisible();
  expect(callsTo(calls, 'POST', '/invoices/excl-customer')).toHaveLength(0);
});

for (const vat of ['15', '5']) {
  test(`VAT ${vat}% is accepted`, async ({ page }) => {
    const calls = await openNewInvoice(page);
    await page.locator('input[name="vat"]').fill(vat);
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect.poll(() => callsTo(calls, 'POST', '/invoices/excl-customer').length).toBe(1);
    expect(callsTo(calls, 'POST', '/invoices/excl-customer')[0].body.vat).toBe(Number(vat));
  });
}
