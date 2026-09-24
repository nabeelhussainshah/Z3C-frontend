import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/**
 * Multi-currency invoice form. The backend is mocked with request routing so
 * these tests are deterministic: login goes through the real sign-in screen
 * (2FA disabled → session returned directly), then the invoice form talks to
 * mocked /currencies, /customers and /invoices endpoints. Submitted payloads
 * are captured and asserted.
 */

const CURRENCIES = [
  { code: 'SAR', name: 'Saudi Riyal', decimalPlaces: 2, isBase: true, isActive: true },
  { code: 'USD', name: 'US Dollar', decimalPlaces: 2, isBase: false, isActive: true },
  { code: 'EUR', name: 'Euro', decimalPlaces: 2, isBase: false, isActive: true },
  { code: 'GBP', name: 'British Pound', decimalPlaces: 2, isBase: false, isActive: true },
];

const CUSTOMER = {
  id: 'cust-1',
  _id: 'cust-1',
  registrationName: 'Acme Corp',
  customerVAT: '300000000000003',
  countryCode: 'SA',
  cityName: 'Riyadh',
};

/** Mocks the invoice-form endpoints; returns the captured create payloads. */
async function mockInvoiceBackend(page, { invoiceList = [] } = {}) {
  const calls = await mockBackend(page, {
    routes: [
      { method: 'GET', match: (p) => p.endsWith('/currencies'), respond: () => ok(CURRENCIES) },
      { method: 'GET', match: (p) => p.endsWith('/customers'), respond: () => ok([CUSTOMER]) },
      {
        method: 'POST',
        match: (p) => p.endsWith('/invoices/excl-customer'),
        respond: () => ok({ _id: 'inv-new', invoiceNumber: 'INV-2026-000100' }, 201),
      },
      {
        method: 'GET',
        match: (p) => p.endsWith('/invoices'),
        respond: () => ok({ data: invoiceList, meta: { total: invoiceList.length, page: 1, limit: 10, totalPages: 1 } }),
      },
    ],
  });
  // Live view of submitted create payloads
  return {
    get length() {
      return callsTo(calls, 'POST', '/invoices/excl-customer').length;
    },
    at: (i) => callsTo(calls, 'POST', '/invoices/excl-customer')[i].body,
  };
}

async function openNewInvoice(page) {
  await page.goto('/invoices/new');
  await expect(page.getByLabel('Currency')).toBeVisible();
}

/** Fills the required header fields, the customer and one line item. */
async function fillValidInvoice(page, { price = '100' } = {}) {
  await page.getByPlaceholder('REF-00000').fill('REF-E2E-1');
  await page.getByPlaceholder('e.g. Net 30').fill('Net 30');
  // react-select overlays its input on the placeholder, so the click is forced.
  await page.getByText('Select or search customer...').click({ force: true });
  await page.keyboard.type('Acme');
  await page.getByText('Acme Corp', { exact: true }).click();

  await page.getByRole('button', { name: '+ Add Item' }).click();
  const row = page.getByPlaceholder('Description of product...').locator('xpath=ancestor::tr');
  await page.getByPlaceholder('Description of product...').fill('Consulting services');
  await page.getByPlaceholder('Product Code').fill('C-1');
  // number inputs in a row: [0] qty, [1] price, [2] discount per unit, [3] discount %
  await row.locator('input[type="number"]').nth(1).fill(price);
}

async function chooseAction(page, label) {
  await page.getByText('Actions', { exact: true }).click({ force: true }); // react-select placeholder
  await page.getByText(label, { exact: true }).click();
}

const rateField = (page) => page.getByLabel(/Exchange Rate \(SAR per 1/);

test.describe('Invoice form — multi-currency', () => {
  test('SAR is the default and shows no exchange-rate field', async ({ page }) => {
    await mockInvoiceBackend(page);
    await signIn(page);
    await openNewInvoice(page);

    await expect(page.getByLabel('Currency')).toHaveValue('SAR');
    await expect(rateField(page)).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Price (SAR)' })).toBeVisible();
  });

  test('lists the currencies returned by the API', async ({ page }) => {
    await mockInvoiceBackend(page);
    await signIn(page);
    await openNewInvoice(page);

    const options = await page.getByLabel('Currency').locator('option').allTextContents();
    expect(options).toEqual(['SAR — Saudi Riyal', 'USD — US Dollar', 'EUR — Euro', 'GBP — British Pound']);
  });

  test('selecting a foreign currency reveals the rate field and relabels amounts; SAR hides it again', async ({ page }) => {
    await mockInvoiceBackend(page);
    await signIn(page);
    await openNewInvoice(page);

    await page.getByLabel('Currency').selectOption('USD');
    await expect(page.getByLabel('Exchange Rate (SAR per 1 USD) *')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Price (USD)' })).toBeVisible();
    await expect(page.getByText('0.00 USD').first()).toBeVisible();

    await page.getByLabel('Currency').selectOption('SAR');
    await expect(rateField(page)).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Price (SAR)' })).toBeVisible();
  });

  test('changing currency clears a previously entered rate', async ({ page }) => {
    await mockInvoiceBackend(page);
    await signIn(page);
    await openNewInvoice(page);

    await page.getByLabel('Currency').selectOption('USD');
    await rateField(page).fill('3.75');
    await page.getByLabel('Currency').selectOption('EUR');
    await expect(page.getByLabel('Exchange Rate (SAR per 1 EUR) *')).toHaveValue('');
  });

  test('a foreign-currency invoice cannot be submitted without a valid rate', async ({ page }) => {
    const submitted = await mockInvoiceBackend(page);
    await signIn(page);
    await openNewInvoice(page);
    await fillValidInvoice(page);
    await page.getByLabel('Currency').selectOption('USD');

    await chooseAction(page, 'Create');
    await expect(page.getByText('Exchange rate is required for USD')).toBeVisible();

    await rateField(page).fill('3.7512345');
    await chooseAction(page, 'Create');
    await expect(page.getByText('Exchange rate must be a number with up to 6 decimal places')).toBeVisible();

    await rateField(page).fill('0');
    await chooseAction(page, 'Create');
    await expect(page.getByText('Exchange rate must be greater than 0')).toBeVisible();

    expect(submitted.length).toBe(0);
  });

  test('submits currency, exchange rate and integer minor-unit amounts (19.99 → 1999)', async ({ page }) => {
    const submitted = await mockInvoiceBackend(page);
    await signIn(page);
    await openNewInvoice(page);
    await fillValidInvoice(page, { price: '19.99' });
    await page.getByLabel('Currency').selectOption('USD');
    await rateField(page).fill('3.75');

    await chooseAction(page, 'Create');
    await expect.poll(() => submitted.length).toBe(1);

    const body = submitted.at(0);
    expect(body.currency).toBe('USD');
    expect(body.exchangeRate).toBe(3.75);
    expect(body.lineItems[0].price).toBe(1999); // not 1998.9999999999998
    expect(Number.isInteger(body.lineItems[0].price)).toBe(true);
    // 19.99 + 15% VAT (round(1999 × 0.15) = 300) = 22.99, in the invoice currency
    expect(body.grandTotal).toBe('22.99');
  });

  test('a SAR invoice submits currency SAR and no exchange rate', async ({ page }) => {
    const submitted = await mockInvoiceBackend(page);
    await signIn(page);
    await openNewInvoice(page);
    await fillValidInvoice(page, { price: '100' });

    await chooseAction(page, 'Create');
    await expect.poll(() => submitted.length).toBe(1);

    expect(submitted.at(0).currency).toBe('SAR');
    expect(submitted.at(0)).not.toHaveProperty('exchangeRate');
    expect(submitted.at(0).lineItems[0].price).toBe(10000);
    expect(submitted.at(0).grandTotal).toBe('115.00');
  });
});

test.describe('Invoice list — currency-aware totals', () => {
  test('shows each invoice total in its own currency (not the SAR equivalent)', async ({ page }) => {
    const base = {
      invoiceNumber: 'INV-1',
      referenceNumber: 'REF-1',
      invoiceType: 'B2B',
      status: 'DRAFT',
      customerId: { registrationName: 'Acme Corp' },
      createdAt: '2026-09-01T10:00:00.000Z',
    };
    await mockInvoiceBackend(page, {
      invoiceList: [
        { ...base, _id: 'a', currency: 'USD', totalsInCurrency: { grandTotal: 115 }, totalsInSAR: { grandTotal: 431.25 } },
        { ...base, _id: 'b', invoiceNumber: 'INV-2', currency: 'SAR', totalsInCurrency: { grandTotal: 230 }, totalsInSAR: { grandTotal: 230 } },
      ],
    });
    await signIn(page);
    await page.goto('/invoices');

    await expect(page.getByText('115 USD')).toBeVisible();
    await expect(page.getByText('230 SAR')).toBeVisible();
    await expect(page.getByText('431.25 USD')).toHaveCount(0);
  });
});
