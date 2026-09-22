import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/**
 * Currency administration screens. SAR is the base currency: never
 * deactivatable. Access reuses the companyProfile permissions.
 */

const ALL_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, isBase: false, isActive: true },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2, isBase: true, isActive: true },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimalPlaces: 2, isBase: false, isActive: false },
];

const currencyRoutes = [
  { method: 'GET', match: (p) => p.endsWith('/currencies'), respond: () => ok(ALL_CURRENCIES) },
  { method: 'POST', match: (p) => p.endsWith('/currencies'), respond: (c) => ok({ ...c.body, isActive: true }, 201) },
  { method: 'PATCH', match: (p) => /\/currencies\/[A-Z]{3}$/.test(p), respond: (c) => ok(c.body) },
  { method: 'DELETE', match: (p) => /\/currencies\/[A-Z]{3}$/.test(p), respond: () => ok({ isActive: false }) },
];

const rowFor = (page, code) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: new RegExp(`^${code}`) }) });

test.describe('Currency administration', () => {
  test('is reachable from the sidebar and lists SAR first as the base currency', async ({ page }) => {
    await mockBackend(page, { routes: currencyRoutes });
    await signIn(page);

    await page.getByRole('link', { name: /Currencies/ }).click();
    await expect(page.getByRole('heading', { name: 'Currencies' })).toBeVisible();

    const codes = await page.locator('#currency-list tbody tr td:first-child').allTextContents();
    expect(codes.map((c) => c.replace('Base', '').trim())).toEqual(['SAR', 'GBP', 'USD']);
    await expect(rowFor(page, 'SAR').getByText('Base')).toBeVisible();
  });

  test('SAR cannot be deactivated; active currencies can; inactive ones can be re-activated', async ({ page }) => {
    await mockBackend(page, { routes: currencyRoutes });
    await signIn(page);
    await page.goto('/currencies');

    await expect(rowFor(page, 'SAR').getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
    await expect(rowFor(page, 'USD').getByRole('button', { name: 'Deactivate' })).toBeVisible();
    await expect(rowFor(page, 'GBP').getByRole('button', { name: 'Activate' })).toBeVisible();
  });

  test('deactivating asks for confirmation, then calls DELETE for that currency', async ({ page }) => {
    const calls = await mockBackend(page, { routes: currencyRoutes });
    await signIn(page);
    await page.goto('/currencies');

    await rowFor(page, 'USD').getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText('USD will no longer be selectable on new invoices')).toBeVisible();
    expect(callsTo(calls, 'DELETE', '/currencies/USD')).toHaveLength(0);

    await page.getByRole('button', { name: 'Deactivate' }).last().click();
    await expect.poll(() => callsTo(calls, 'DELETE', '/currencies/USD').length).toBe(1);
  });

  test('activating an inactive currency PATCHes isActive: true', async ({ page }) => {
    const calls = await mockBackend(page, { routes: currencyRoutes });
    await signIn(page);
    await page.goto('/currencies');

    await rowFor(page, 'GBP').getByRole('button', { name: 'Activate' }).click();
    await expect.poll(() => callsTo(calls, 'PATCH', '/currencies/GBP').length).toBe(1);
    expect(callsTo(calls, 'PATCH', '/currencies/GBP')[0].body).toEqual({ isActive: true });
  });

  test('adding a currency sends an uppercase code with decimalPlaces 2', async ({ page }) => {
    const calls = await mockBackend(page, { routes: currencyRoutes });
    await signIn(page);
    await page.goto('/currencies/new');

    await expect(page.getByLabel('Decimal places')).toHaveValue('2');
    await expect(page.getByLabel('Decimal places')).toBeDisabled();

    await page.getByLabel('Code *').fill('aed');
    await page.getByLabel('Name *').fill('UAE Dirham');
    await page.getByLabel('Symbol').fill('AED');
    await page.getByRole('button', { name: 'Add Currency' }).click();

    await expect.poll(() => callsTo(calls, 'POST', '/currencies').length).toBe(1);
    expect(callsTo(calls, 'POST', '/currencies')[0].body).toEqual({
      code: 'AED',
      name: 'UAE Dirham',
      symbol: 'AED',
      decimalPlaces: 2,
    });
    await expect(page).toHaveURL(/\/currencies$/);
  });

  test('rejects an invalid code and a missing name without calling the API', async ({ page }) => {
    const calls = await mockBackend(page, { routes: currencyRoutes });
    await signIn(page);
    await page.goto('/currencies/new');

    await page.getByLabel('Code *').fill('A1');
    await page.getByRole('button', { name: 'Add Currency' }).click();

    await expect(page.getByText('Code must be a 3-letter ISO-4217 code')).toBeVisible();
    await expect(page.getByText('Name is required')).toBeVisible();
    expect(callsTo(calls, 'POST', '/currencies')).toHaveLength(0);
  });

  test('editing SAR keeps it active: the toggle is disabled and isActive is not sent', async ({ page }) => {
    const calls = await mockBackend(page, { routes: currencyRoutes });
    await signIn(page);
    await page.goto('/currencies/SAR');

    await expect(page.getByLabel('Code *')).toHaveValue('SAR');
    await expect(page.getByLabel('Code *')).toBeDisabled();
    await expect(page.getByRole('checkbox')).toBeDisabled();

    await page.getByLabel('Name *').fill('Saudi Riyal (base)');
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect.poll(() => callsTo(calls, 'PATCH', '/currencies/SAR').length).toBe(1);
    expect(callsTo(calls, 'PATCH', '/currencies/SAR')[0].body).toEqual({ name: 'Saudi Riyal (base)', symbol: 'SAR' });
  });

  test('is hidden from users without company-profile permissions', async ({ page }) => {
    await mockBackend(page, {
      user: {
        id: 'u2',
        email: 'clerk@example.com',
        username: 'clerk',
        isAdmin: false,
        permissions: { invoice: { create: true, read: true, update: true, delete: false } },
      },
      routes: currencyRoutes,
    });
    await signIn(page);

    await expect(page.getByRole('link', { name: /Currencies/ })).toHaveCount(0);
    await page.goto('/currencies');
    await expect(page.getByRole('heading', { name: 'Currencies' })).toHaveCount(0);
  });
});
