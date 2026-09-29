import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/**
 * Behaviour the Breeze theme must keep (or restore) from before the re-skin:
 * ZATCA pop-ups fully on screen, invoices reported to ZATCA never deletable,
 * bulk deletes that say what happened, and Enter never saving a form.
 */

const page1 = (rows) => ok({ data: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } });
const toasts = (page) => page.locator('.toast__message');

const invoiceRow = (over) => ({
  invoiceType: 'B2B',
  currency: 'SAR',
  paymentType: 'CASH',
  customerId: { registrationName: 'Acme Corp' },
  totalsInCurrency: { grandTotal: 115 },
  createdAt: '2026-09-29T10:00:00.000Z',
  compliance: null,
  clearance: null,
  ...over,
});
const clearanceRecord = { invoiceXml: '<Invoice/>', zatcaResponse: { clearanceStatus: 'CLEARED' }, processedAt: '2026-09-29T10:05:00.000Z' };
const DRAFT = invoiceRow({ _id: 'd1', invoiceNumber: 'INV-2026-000101', referenceNumber: 'REF-D1', status: 'DRAFT' });
const DRAFT_2 = invoiceRow({ _id: 'd2', invoiceNumber: 'INV-2026-000102', referenceNumber: 'REF-D2', status: 'DRAFT' });
const COMPLIANT = invoiceRow({ _id: 'c1', invoiceNumber: 'INV-2026-000103', referenceNumber: 'REF-C1', status: 'COMPLIANCE_COMPLETED', compliance: { invoiceXml: '<Invoice/>', zatcaResponse: { valid: true, errors: [], warnings: [] } } });
const ZATCA_REJECTED = invoiceRow({ _id: 'r1', invoiceNumber: 'INV-2026-000104', referenceNumber: 'REF-R1', status: 'REJECTED', clearance: { ...clearanceRecord, zatcaResponse: { clearanceStatus: 'NOT_CLEARED' } } });
const CLEARED = invoiceRow({ _id: 'x1', invoiceNumber: 'INV-2026-000105', referenceNumber: 'REF-X1', status: 'CLEARED', compliance: { invoiceXml: '<Invoice/>', zatcaResponse: { valid: true, errors: [], warnings: [] } }, clearance: clearanceRecord });
const REPORTED = invoiceRow({ _id: 'p1', invoiceNumber: 'INV-2026-000106', referenceNumber: 'REF-P1', invoiceType: 'B2C', status: 'REPORTED', clearance: { ...clearanceRecord, zatcaResponse: { reportingStatus: 'REPORTED' } } });
const ALL_ROWS = [DRAFT, DRAFT_2, COMPLIANT, ZATCA_REJECTED, CLEARED, REPORTED];

const listRow = (page, number) => page.getByRole('row', { name: new RegExp(number) });

async function openInvoiceList(page, { rows = ALL_ROWS, routes = [] } = {}) {
  const calls = await mockBackend(page, {
    routes: [
      ...routes,
      { method: 'GET', match: (p) => p.endsWith('/invoices'), respond: () => page1(rows) },
      { method: 'GET', match: (p) => /\/invoices\/[^/]+\/xml$/.test(p), respond: () => ok({ invoiceId: 'x1', invoiceNumber: 'INV-2026-000105', documents: [] }) },
    ],
  });
  await signIn(page);
  await page.goto('/invoices');
  await expect(listRow(page, 'INV-2026-000101')).toBeVisible();
  return calls;
}

/**
 * A pop-up is really on top of the page: its backdrop covers the sidebar and
 * top bar (it is not confined to a card), and its Close button can be clicked
 * (not clipped or covered). Checking the dialog's box alone is not enough — a
 * card with overflow:hidden clips a dialog whose box still looks on screen.
 */
async function expectOnTopOfPage(page, dialog) {
  const { width, height } = page.viewportSize();
  for (const [x, y] of [[5, 5], [width - 5, 5], [5, height - 5], [width - 5, height - 5]]) {
    const pageChrome = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('header, aside, nav, footer'), [x, y]);
    expect(pageChrome, `page chrome is uncovered at (${x}, ${y})`).toBe(false);
  }
  await dialog.getByRole('button', { name: 'Close' }).first().click({ trial: true, timeout: 3000 });
}

test.describe('Invoice deletion never touches ZATCA-reported invoices', () => {
  test('only a draft that was never reported offers Delete or can be selected for bulk delete', async ({ page }) => {
    await openInvoiceList(page);
    for (const inv of [DRAFT, DRAFT_2]) {
      await expect(listRow(page, inv.invoiceNumber).getByRole('button', { name: 'Delete invoice' })).toHaveCount(1);
      await expect(listRow(page, inv.invoiceNumber).getByRole('checkbox')).toBeEnabled();
    }
    for (const inv of [COMPLIANT, ZATCA_REJECTED, CLEARED, REPORTED]) {
      await expect(listRow(page, inv.invoiceNumber).getByRole('button', { name: 'Delete invoice' })).toHaveCount(0);
      await expect(listRow(page, inv.invoiceNumber).getByRole('checkbox')).toBeDisabled();
    }
  });

  test('selecting all only picks the deletable invoices, and only they are sent for deletion', async ({ page }) => {
    const calls = await openInvoiceList(page, {
      routes: [{ method: 'DELETE', match: (p) => /\/invoices\/[^/]+$/.test(p), respond: () => ok({ message: 'Invoice deleted successfully' }) }],
    });
    await page.locator('thead').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Delete (2)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => calls.filter((c) => c.method === 'DELETE').map((c) => c.path).sort()).toEqual([
      '/api/v1/invoices/d1',
      '/api/v1/invoices/d2',
    ]);
  });

  test('a partly failed bulk delete says so, reloads the list and clears the selection', async ({ page }) => {
    const calls = await openInvoiceList(page, {
      routes: [
        { method: 'DELETE', match: (p) => p.endsWith('/invoices/d1'), respond: () => ok({ message: 'Invoice deleted successfully' }) },
        {
          method: 'DELETE',
          match: (p) => p.endsWith('/invoices/d2'),
          respond: () => ({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Can only delete draft invoices' }) }),
        },
      ],
    });
    const listLoads = () => callsTo(calls, 'GET', '/invoices').length;
    const loadsBefore = listLoads();
    await listRow(page, DRAFT.invoiceNumber).getByRole('checkbox').check();
    await listRow(page, DRAFT_2.invoiceNumber).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Delete (2)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(toasts(page).filter({ hasText: 'Deleted 1 of 2 invoices' })).toBeVisible();
    await expect.poll(listLoads).toBeGreaterThan(loadsBefore);
    await expect(page.getByRole('button', { name: /Delete \(\d+\)/ })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('changing the search clears the selection, so Delete never counts rows you cannot see', async ({ page }) => {
    await openInvoiceList(page);
    await listRow(page, DRAFT.invoiceNumber).getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: 'Delete (1)' })).toBeVisible();
    await page.getByPlaceholder('Search invoices...').fill('REF');
    await page.getByPlaceholder('Search invoices...').press('Enter');
    await expect(page.getByRole('button', { name: /Delete \(\d+\)/ })).toHaveCount(0);
  });
});

test.describe('ZATCA pop-ups are fully on screen', () => {
  test('the ZATCA XML viewer opened from the invoice list', async ({ page }) => {
    await openInvoiceList(page);
    await listRow(page, CLEARED.invoiceNumber).getByRole('button', { name: 'View ZATCA XML' }).click();
    const dialog = page.getByRole('dialog', { name: /ZATCA XML/ });
    await expect(dialog).toBeVisible();
    await expectOnTopOfPage(page, dialog);
  });

  test('the compliance response opened from the invoice list', async ({ page }) => {
    await openInvoiceList(page);
    await listRow(page, CLEARED.invoiceNumber).getByRole('button', { name: 'View compliance response' }).click();
    const dialog = page.locator('.breeze-modal__dialog').filter({ hasText: /compliance/i });
    await expect(dialog).toBeVisible();
    await expectOnTopOfPage(page, dialog);
  });

  test('the ZATCA response opened from the invoice list', async ({ page }) => {
    await openInvoiceList(page);
    await listRow(page, CLEARED.invoiceNumber).getByRole('button', { name: 'View ZATCA response' }).click();
    const dialog = page.locator('.breeze-modal__dialog').filter({ hasText: /ZATCA Response/i });
    await expect(dialog).toBeVisible();
    await expectOnTopOfPage(page, dialog);
  });
});

const CUSTOMERS = [
  { _id: 'cu1', registrationName: 'Acme Corp', email: 'a@acme.test', customerVAT: '300000000000003', isActive: true },
  { _id: 'cu2', registrationName: 'Beta Trading', email: 'b@beta.test', customerVAT: '310000000000003', isActive: true },
];
const PROFILES = [
  { _id: 'pr1', name: 'Standard B2B', invoiceType: 'B2B', isActive: true },
  { _id: 'pr2', name: 'Retail B2C', invoiceType: 'B2C', isActive: true },
];

test.describe('Bulk deactivation of customers and customer profiles', () => {
  for (const c of [
    { name: 'customers', path: '/customer', api: '/customers', rows: CUSTOMERS, key: 'customerIds', label: 'customers', first: 'Acme Corp' },
    { name: 'customer profiles', path: '/customer-profile', api: '/customer-profiles', rows: PROFILES, key: 'customerProfileIds', label: 'customer profiles', first: 'Standard B2B' },
  ]) {
    test(`${c.name}: one request with every ID, and the result is reported`, async ({ page }) => {
      const calls = await mockBackend(page, {
        routes: [
          { method: 'GET', match: (p) => p.endsWith(c.api), respond: () => page1(c.rows) },
          {
            method: 'DELETE',
            match: (p) => p.endsWith(c.api),
            respond: () =>
              ok({ message: 'Deactivated 1 of 2', requested: 2, deactivatedCount: 1, deactivated: [c.rows[0]._id], notFound: [c.rows[1]._id], invalid: [] }),
          },
        ],
      });
      await signIn(page);
      await page.goto(c.path);
      await expect(page.getByText(c.first)).toBeVisible();
      const loadsBefore = callsTo(calls, 'GET', c.api).length;

      await page.locator('thead').getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Delete (2)' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

      await expect.poll(() => callsTo(calls, 'DELETE', c.api).length).toBe(1);
      expect(callsTo(calls, 'DELETE', c.api)[0].body).toEqual({ [c.key]: [c.rows[0]._id, c.rows[1]._id] });
      expect(calls.filter((x) => x.method === 'DELETE' && x.path !== `/api/v1${c.api}`)).toHaveLength(0);
      await expect(toasts(page).filter({ hasText: `Deleted 1 of 2 ${c.label}` })).toBeVisible();
      await expect.poll(() => callsTo(calls, 'GET', c.api).length).toBeGreaterThan(loadsBefore);
      await expect(page.getByRole('button', { name: /Delete \(\d+\)/ })).toHaveCount(0);
    });
  }
});

test.describe('A selection only covers the rows on screen', () => {
  for (const c of [
    { name: 'customers', path: '/customer', api: '/customers', rows: CUSTOMERS, search: 'Search customers...' },
    { name: 'customer profiles', path: '/customer-profile', api: '/customer-profiles', rows: PROFILES, search: /Search/ },
  ]) {
    test(`${c.name}: changing the search clears the selection`, async ({ page }) => {
      await mockBackend(page, { routes: [{ method: 'GET', match: (p) => p.endsWith(c.api), respond: () => page1(c.rows) }] });
      await signIn(page);
      await page.goto(c.path);
      await page.locator('tbody').getByRole('checkbox').first().check();
      await expect(page.getByRole('button', { name: 'Delete (1)' })).toBeVisible();
      const search = page.getByPlaceholder(c.search);
      await search.fill('Acme');
      await search.press('Enter');
      await expect(page.getByRole('button', { name: /Delete \(\d+\)/ })).toHaveCount(0);
    });
  }
});

test.describe('Enter never saves a form', () => {
  for (const f of [
    { name: 'customer', path: '/customer/new', create: '/customers', field: (p) => p.getByPlaceholder('Ahmed Al-Saud Trading Co.') },
    { name: 'customer profile', path: '/customer-profile/new', create: '/customer-profiles', field: (p) => p.locator('form input[type="text"]').first() },
    { name: 'user', path: '/user-management/new', create: '/users', field: (p) => p.getByPlaceholder('Enter username') },
  ]) {
    test(`${f.name} form`, async ({ page }) => {
      const calls = await mockBackend(page);
      await signIn(page);
      await page.goto(f.path);
      await f.field(page).click(); // some fields stay read-only until focused (autofill guard)
      await f.field(page).fill('Typed then Enter');
      await f.field(page).press('Enter');
      await page.waitForTimeout(500);
      // Neither saved nor validated: Enter did not submit the form at all.
      expect(callsTo(calls, 'POST', f.create)).toHaveLength(0);
      await expect(page.locator('.breeze-field__error')).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${f.path}$`));
    });
  }
});

const FORM_CUSTOMER = { _id: 'cust-1', id: 'cust-1', registrationName: 'Acme Corp', customerVAT: '300000000000003', countryCode: 'SA' };

async function newValidInvoice(page, extraRoutes = []) {
  const calls = await mockBackend(page, {
    routes: [
      ...extraRoutes,
      { method: 'GET', match: (p) => p.endsWith('/vat-exemption-codes'), respond: () => ok([]) },
      { method: 'GET', match: (p) => p.endsWith('/currencies'), respond: () => ok([{ code: 'SAR', name: 'Saudi Riyal' }]) },
      { method: 'GET', match: (p) => p.endsWith('/customers'), respond: () => ok([FORM_CUSTOMER]) },
      { method: 'POST', match: (p) => p.endsWith('/invoices/excl-customer'), respond: () => ok({ _id: 'inv-new' }, 201) },
      { method: 'POST', match: (p) => p.endsWith('/queue-compliance'), respond: () => ok({ queued: true }, 201) },
    ],
  });
  await signIn(page);
  await page.goto('/invoices/new');
  await page.getByPlaceholder('REF-00000').fill('REF-ENTER-1');
  await page.getByPlaceholder('e.g. Net 30').fill('Net 30');
  await page.getByText('Select or search customer...').click({ force: true });
  await page.keyboard.type('Acme');
  await page.getByText('Acme Corp', { exact: true }).click();
  await page.getByPlaceholder('Description of product...').fill('Consulting');
  await page.getByPlaceholder('SKU').fill('C-1');
  await page.getByPlaceholder('Description of product...').locator('xpath=ancestor::tr').locator('input[type="number"]').nth(1).fill('100');
  return calls;
}

test.describe('Invoice form', () => {
  test('Enter in a field does not save the invoice; the Save button still does', async ({ page }) => {
    const calls = await newValidInvoice(page);
    for (const field of [page.getByLabel('Quantity, line 1'), page.getByPlaceholder('Description of product...'), page.getByPlaceholder('REF-00000')]) {
      await field.press('Enter');
    }
    await page.waitForTimeout(500);
    expect(callsTo(calls, 'POST', '/invoices/excl-customer')).toHaveLength(0);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => callsTo(calls, 'POST', '/invoices/excl-customer').length).toBe(1);
  });

  test('Enter still picks a customer in the customer search', async ({ page }) => {
    await mockBackend(page, {
      routes: [
        { method: 'GET', match: (p) => p.endsWith('/vat-exemption-codes'), respond: () => ok([]) },
        { method: 'GET', match: (p) => p.endsWith('/currencies'), respond: () => ok([{ code: 'SAR', name: 'Saudi Riyal' }]) },
        { method: 'GET', match: (p) => p.endsWith('/customers'), respond: () => ok([FORM_CUSTOMER]) },
      ],
    });
    await signIn(page);
    await page.goto('/invoices/new');
    await page.getByText('Select or search customer...').click({ force: true });
    await page.keyboard.type('Acme');
    await expect(page.getByText('Acme Corp', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByPlaceholder('300000000000003')).toHaveValue('300000000000003');
  });

  test('Check Compliance on a new invoice leaves the form, so it cannot be created twice', async ({ page }) => {
    const calls = await newValidInvoice(page);
    await page.getByRole('button', { name: 'Check Compliance', exact: true }).click();
    await expect.poll(() => callsTo(calls, 'POST', '/queue-compliance').length).toBe(1);
    await expect(page).toHaveURL(/\/invoices$/);
    expect(callsTo(calls, 'POST', '/invoices/excl-customer')).toHaveLength(1);
  });

  test('Print Invoice on a new invoice continues on the saved invoice, so a second click prints it instead of creating another', async ({ page }) => {
    const saved = {
      _id: 'inv-new', invoiceNumber: 'INV-2026-000200', invoiceType: 'B2B', status: 'DRAFT', referenceNumber: 'REF-ENTER-1',
      paymentType: 'CASH', paymentTerms: 'Net 30', vat: 15, currency: 'SAR', customerId: FORM_CUSTOMER,
      lineItems: [{ description: 'Consulting', productCode: 'C-1', quantity: 1, price: 10000, discount_amount: 0, total: 10000 }],
    };
    const pdf = { status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' };
    const calls = await newValidInvoice(page, [
      { method: 'GET', match: (p) => p.endsWith('/invoices/inv-new'), respond: () => ok(saved) },
      { method: 'GET', match: (p) => p.endsWith('/invoices/inv-new/pdf'), respond: () => pdf },
      { method: 'PATCH', match: (p) => p.includes('/invoices/excl-customer/inv-new'), respond: (c) => ok({ ...saved, ...c.body }) },
    ]);
    page.context().on('page', (popup) => popup.close().catch(() => {}));
    await page.getByRole('button', { name: 'Print Invoice', exact: true }).click();
    await expect(page).toHaveURL(/\/invoices\/inv-new$/);
    await expect(page.getByPlaceholder('REF-00000')).toHaveValue('REF-ENTER-1');
    await page.getByRole('button', { name: 'Print Invoice', exact: true }).click();
    await expect.poll(() => callsTo(calls, 'GET', '/invoices/inv-new/pdf').length).toBe(2);
    expect(callsTo(calls, 'POST', '/invoices/excl-customer')).toHaveLength(1);
  });

  test('Payment Terms is marked as required', async ({ page }) => {
    await newValidInvoice(page);
    await expect(page.locator('label', { hasText: 'Payment Terms' })).toContainText('*');
  });
});
