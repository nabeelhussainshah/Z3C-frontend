import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/**
 * Line quantity: a whole number from 1 to 1,000,000. Price and discounts are
 * per unit; the line total is (price − discount per unit) × quantity.
 */

const CUSTOMER = { _id: 'cust-1', id: 'cust-1', registrationName: 'Acme Corp', customerVAT: '300000000000003', countryCode: 'SA' };

const SAVED_INVOICE = {
  _id: 'inv-qty',
  invoiceNumber: 'INV-2026-000050',
  invoiceType: 'B2B',
  status: 'DRAFT',
  referenceNumber: 'REF-QTY',
  paymentType: 'CASH',
  paymentTerms: 'Net 30',
  vat: 15,
  currency: 'SAR',
  customerId: CUSTOMER,
  lineItems: [{ description: 'Cartons', productCode: 'CT-1', quantity: 4, price: 2550, discount_amount: 50, total: 10000 }],
};

async function mockForm(page, { invoice } = {}) {
  const calls = await mockBackend(page, {
    routes: [
      { method: 'GET', match: (p) => p.endsWith('/vat-exemption-codes'), respond: () => ok([]) },
      { method: 'GET', match: (p) => p.endsWith('/currencies'), respond: () => ok([{ code: 'SAR', name: 'Saudi Riyal' }]) },
      { method: 'GET', match: (p) => p.endsWith('/customers'), respond: () => ok([CUSTOMER]) },
      { method: 'POST', match: (p) => p.endsWith('/invoices/excl-customer'), respond: () => ok({ _id: 'inv-new' }, 201) },
      { method: 'PATCH', match: (p) => p.includes('/invoices/excl-customer/'), respond: (c) => ok({ _id: 'inv-qty', ...c.body }) },
      ...(invoice ? [{ method: 'GET', match: (p) => p.endsWith(`/invoices/${invoice._id}`), respond: () => ok(invoice) }] : []),
    ],
  });
  return calls;
}

const row = (page, i = 0) => page.getByPlaceholder('Description of product...').nth(i).locator('xpath=ancestor::tr');
// number inputs in a row: [0] qty, [1] price, [2] discount per unit, [3] discount %
const qty = (page, i = 0) => page.getByLabel(`Quantity, line ${i + 1}`);
const price = (page, i = 0) => row(page, i).locator('input[type="number"]').nth(1);
const discount = (page, i = 0) => row(page, i).locator('input[type="number"]').nth(2);
const discountPct = (page, i = 0) => row(page, i).locator('input[type="number"]').nth(3);
const lineTotal = (page, i = 0) => row(page, i).locator('td.text-right.font-bold');
const summary = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('span')]
      .filter((s) => /^(Subtotal|VAT \(|Grand Total)/.test(s.textContent))
      .map((s) => s.nextElementSibling?.textContent)
  );

async function newInvoice(page, lines = 1) {
  await page.goto('/invoices/new');
  await page.getByPlaceholder('REF-00000').fill('REF-QTY-1');
  await page.getByPlaceholder('e.g. Net 30').fill('Net 30');
  await page.getByText('Select or search customer...').click({ force: true });
  await page.keyboard.type('Acme');
  await page.getByText('Acme Corp', { exact: true }).click();
  for (let i = 0; i < lines; i++) {
    await page.getByRole('button', { name: '+ Add Item' }).click();
    await page.getByPlaceholder('Description of product...').nth(i).fill(`Item ${i + 1}`);
    await page.getByPlaceholder('Product Code').nth(i).fill(`P-${i + 1}`);
  }
}

async function choose(page, label) {
  await page.getByText('Actions', { exact: true }).click({ force: true });
  await page.getByText(label, { exact: true }).click();
}

test.describe('Line quantity on the invoice form', () => {
  test('quantity is editable and multiplies the per-unit price and discount', async ({ page }) => {
    const calls = await mockForm(page);
    await signIn(page);
    await newInvoice(page);

    await expect(qty(page)).toBeEnabled();
    await expect(qty(page)).toHaveValue('1');
    await expect(page.getByRole('columnheader', { name: 'Disc./Unit' })).toBeVisible();

    await price(page).fill('100');
    await discount(page).fill('10');
    await qty(page).fill('3');
    await expect(lineTotal(page)).toHaveText('270.00');
    expect(await summary(page)).toEqual(['270.00 SAR', '40.50 SAR', '310.50 SAR']);

    await choose(page, 'Create');
    await expect.poll(() => callsTo(calls, 'POST', '/invoices/excl-customer').length).toBe(1);
    const body = callsTo(calls, 'POST', '/invoices/excl-customer')[0].body;
    expect(body.lineItems[0]).toMatchObject({ quantity: 3, price: 10000, discount_amount: 1000 });
    expect(body.grandTotal).toBe('310.50');
  });

  test('a percentage discount stays per unit when the quantity changes', async ({ page }) => {
    await mockForm(page);
    await signIn(page);
    await newInvoice(page);

    await price(page).fill('99.99');
    await discountPct(page).fill('12.5');
    await expect(discount(page)).toHaveValue('12.5'); // 12.49875 → 12.50 per unit
    await qty(page).fill('3');
    await expect(discount(page)).toHaveValue('12.5');
    await expect(lineTotal(page)).toHaveText('262.47'); // (99.99 − 12.50) × 3
  });

  test('refuses decimals and signs in the quantity field', async ({ page }) => {
    await mockForm(page);
    await signIn(page);
    await newInvoice(page);

    await qty(page).fill('');
    await qty(page).pressSequentially('2.5');
    await expect(qty(page)).toHaveValue('25'); // "." is refused, so 2.5 cannot be entered
    await qty(page).fill('');
    await qty(page).pressSequentially('-4');
    await expect(qty(page)).toHaveValue('4');
  });

  test('an empty, zero or too large quantity blocks the invoice', async ({ page }) => {
    const calls = await mockForm(page);
    await signIn(page);
    await newInvoice(page, 2);
    await price(page, 0).fill('10');
    await price(page, 1).fill('10');

    await qty(page, 0).fill('0');
    await qty(page, 1).fill('1000001');
    await choose(page, 'Create');
    await expect(page.getByText('Quantity must be a whole number from 1 to 1,000,000 (lines 1, 2).').first()).toBeVisible();
    await expect(qty(page, 0)).toHaveClass(/border-tomato/);

    await qty(page, 0).fill('');
    await qty(page, 1).fill('2');
    await choose(page, 'Create');
    await expect(page.getByText('Quantity must be a whole number from 1 to 1,000,000 (line 1).').first()).toBeVisible();
    expect(callsTo(calls, 'POST', '/invoices/excl-customer')).toHaveLength(0);
  });

  test('a saved invoice keeps its quantity when opened and updated', async ({ page }) => {
    const calls = await mockForm(page, { invoice: SAVED_INVOICE });
    await signIn(page);
    await page.goto('/invoices/inv-qty');

    await expect(qty(page)).toHaveValue('4');
    await expect(lineTotal(page)).toHaveText('100.00'); // (25.50 − 0.50) × 4
    expect(await summary(page)).toEqual(['100.00 SAR', '15.00 SAR', '115.00 SAR']);

    await choose(page, 'Update');
    await expect.poll(() => callsTo(calls, 'PATCH', '/invoices/excl-customer/inv-qty').length).toBe(1);
    const body = callsTo(calls, 'PATCH', '/invoices/excl-customer/inv-qty')[0].body;
    expect(body.lineItems[0]).toMatchObject({ quantity: 4, price: 2550, discount_amount: 50 });
    expect(body.grandTotal).toBe('115.00');
  });
});

test('a credit note copies the original quantities', async ({ page }) => {
  const original = {
    ...SAVED_INVOICE,
    _id: 'inv-cleared',
    invoiceNumber: 'INV-2026-000051',
    status: 'CLEARED',
    totalsInCurrency: { grandTotal: 115 },
    createdAt: '2026-09-24T10:00:00.000Z',
  };
  const calls = await mockBackend(page, {
    routes: [
      {
        method: 'GET',
        match: (p) => p.endsWith('/invoices'),
        respond: () => ok({ data: [original], meta: { total: 1, page: 1, limit: 10, totalPages: 1 } }),
      },
      { method: 'POST', match: (p) => p.endsWith('/credit-note'), respond: () => ok({ _id: 'cn-1' }, 201) },
    ],
  });
  await signIn(page);
  await page.goto('/invoices');
  await page.getByRole('row', { name: /INV-2026-000051/ }).getByRole('combobox').selectOption('credit-note');

  await expect.poll(() => callsTo(calls, 'POST', '/invoices/inv-cleared/credit-note').length).toBe(1);
  expect(callsTo(calls, 'POST', '/invoices/inv-cleared/credit-note')[0].body.lineItems[0]).toMatchObject({
    quantity: 4,
    price: 2550,
    discount_amount: 50,
  });
});
