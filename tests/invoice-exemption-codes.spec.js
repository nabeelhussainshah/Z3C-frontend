import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/**
 * VAT exemption codes on invoice lines: the code dropdown and reason appear for
 * tax-exempt lines, are required for them and for every line at VAT 0%, and
 * the submitted payload carries the code.
 */

const CODES = [
  { code: 'VATEX-SA-29', category: 'E', description: 'Financial services mentioned in Article 29 of the VAT Regulations' },
  { code: 'VATEX-SA-32', category: 'Z', description: 'Export of goods' },
  { code: 'VATEX-SA-33', category: 'Z', description: 'Export of services' },
  { code: 'VATEX-SA-35', category: 'Z', description: 'Medicines and medical equipment' },
  { code: 'VATEX-SA-EDU', category: 'Z', description: 'Private education to citizen' },
  { code: 'VATEX-SA-OOS', category: 'O', description: 'Services outside scope of tax / Not subject to VAT' },
];
const COMPANY = { _id: 'cust-co', id: 'cust-co', registrationName: 'Acme Corp', customerVAT: '300000000000003', countryCode: 'SA' };
const CITIZEN = { _id: 'cust-nat', id: 'cust-nat', registrationName: 'Saudi Citizen', countryCode: 'SA', identificationScheme: 'NAT', identificationId: '1234567890' };

async function mockForm(page, { invoice } = {}) {
  const calls = await mockBackend(page, {
    routes: [
      { method: 'GET', match: (p) => p.endsWith('/vat-exemption-codes'), respond: () => ok(CODES) },
      { method: 'GET', match: (p) => p.endsWith('/currencies'), respond: () => ok([{ code: 'SAR', name: 'Saudi Riyal' }]) },
      { method: 'GET', match: (p) => p.endsWith('/customers'), respond: () => ok([COMPANY, CITIZEN]) },
      { method: 'POST', match: (p) => p.endsWith('/invoices/excl-customer'), respond: () => ok({ _id: 'inv-new' }, 201) },
      ...(invoice ? [{ method: 'GET', match: (p) => p.endsWith(`/invoices/${invoice._id}`), respond: () => ok(invoice) }] : []),
    ],
  });
  return {
    get count() {
      return callsTo(calls, 'POST', '/invoices/excl-customer').length;
    },
    at: (i) => callsTo(calls, 'POST', '/invoices/excl-customer')[i].body,
  };
}

async function newInvoice(page, { customer = 'Acme Corp', lines = 1 } = {}) {
  await page.goto('/invoices/new');
  await page.getByPlaceholder('REF-00000').fill('REF-EXEMPT-1');
  await page.getByPlaceholder('e.g. Net 30').fill('Net 30');
  await page.getByText('Select or search customer...').click({ force: true });
  await page.keyboard.type(customer.split(' ')[0]);
  await page.getByText(customer, { exact: true }).click();
  for (let i = 0; i < lines; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByPlaceholder('Description of product...').nth(i).fill(`Item ${i + 1}`);
    await page.getByPlaceholder('SKU').nth(i).fill(`P-${i + 1}`);
    await row(page, i).locator('input[type="number"]').nth(1).fill('100');
  }
}

const row = (page, i) => page.getByPlaceholder('Description of product...').nth(i).locator('xpath=ancestor::tr');
const exemptBox = (page, i) => row(page, i).getByRole('checkbox');
const codeSelect = (page, i) => page.getByLabel(`Exemption code, line ${i + 1}`);
const reasonInput = (page, i) => page.getByLabel(`Exemption reason, line ${i + 1}`);

async function choose(page, label) {
  // theme: the Actions dropdown became buttons; Create/Update is the Save (submit) button
  const theme = { Create: 'Save', Update: 'Save' }[label] ?? label;
  await page.getByRole('button', { name: theme, exact: true }).click();
}

test.describe('VAT exemption codes on invoice lines', () => {
  test('code and reason appear only for tax-exempt lines, with codes grouped by category', async ({ page }) => {
    await mockForm(page);
    await signIn(page);
    await newInvoice(page);

    await expect(codeSelect(page, 0)).toHaveCount(0);
    await exemptBox(page, 0).check();
    await expect(codeSelect(page, 0)).toBeVisible();
    await expect(reasonInput(page, 0)).toBeVisible();
    const groups = await codeSelect(page, 0).locator('optgroup').evaluateAll((els) => els.map((g) => g.label));
    expect(groups).toEqual(['Zero-rated (Z)', 'Exempt (E)', 'Out of scope (O)']);
    await expect(codeSelect(page, 0).locator('option', { hasText: 'VATEX-SA-33 — Export of services' })).toHaveCount(1);
  });

  test('choosing a code pre-fills the official text, keeps a hand-written reason, and leaves out of scope to the user', async ({ page }) => {
    await mockForm(page);
    await signIn(page);
    await newInvoice(page);
    await exemptBox(page, 0).check();

    await codeSelect(page, 0).selectOption('VATEX-SA-33');
    await expect(reasonInput(page, 0)).toHaveValue('Export of services');
    await codeSelect(page, 0).selectOption('VATEX-SA-35');
    await expect(reasonInput(page, 0)).toHaveValue('Medicines and medical equipment');
    await reasonInput(page, 0).fill('Hospital supplies');
    await codeSelect(page, 0).selectOption('VATEX-SA-32');
    await expect(reasonInput(page, 0)).toHaveValue('Hospital supplies');
    await reasonInput(page, 0).fill('');
    await codeSelect(page, 0).selectOption('VATEX-SA-OOS');
    await expect(reasonInput(page, 0)).toHaveValue('');
    await expect(reasonInput(page, 0)).toHaveAttribute('placeholder', 'Why is this out of scope?');
  });

  test('unticking hides and clears the fields; the line is submitted as standard', async ({ page }) => {
    const submitted = await mockForm(page);
    await signIn(page);
    await newInvoice(page);
    await exemptBox(page, 0).check();
    await codeSelect(page, 0).selectOption('VATEX-SA-33');
    await exemptBox(page, 0).uncheck();
    await expect(codeSelect(page, 0)).toHaveCount(0);

    await choose(page, 'Create');
    await expect.poll(() => submitted.count).toBe(1);
    const line = submitted.at(0).lineItems[0];
    expect(line.taxExempt).toBe(false);
    expect(line).not.toHaveProperty('taxExemptionCode');
  });

  test('at VAT 0% every line is exempt and needs a code and reason before the invoice is created', async ({ page }) => {
    const submitted = await mockForm(page);
    await signIn(page);
    await newInvoice(page);
    await page.locator('input[name="vat"]').fill('0');

    await expect(exemptBox(page, 0)).toBeChecked();
    await expect(exemptBox(page, 0)).toBeDisabled();
    await choose(page, 'Create');
    await expect(page.getByText('Select a VAT exemption code for tax-exempt line 1.').first()).toBeVisible();
    await expect(page.getByText('Select an exemption code', { exact: true })).toBeVisible();
    expect(submitted.count).toBe(0);

    await codeSelect(page, 0).selectOption('VATEX-SA-32');
    await choose(page, 'Create');
    await expect.poll(() => submitted.count).toBe(1);
    const body = submitted.at(0);
    expect(body.vat).toBe(0);
    expect(body.lineItems[0]).toMatchObject({ taxExempt: true, taxExemptionCode: 'VATEX-SA-32', taxExemptReason: 'Export of goods' });
  });

  test('two zero-rated codes on one invoice are blocked', async ({ page }) => {
    const submitted = await mockForm(page);
    await signIn(page);
    await newInvoice(page, { lines: 2 });
    await exemptBox(page, 0).check();
    await codeSelect(page, 0).selectOption('VATEX-SA-32');
    await exemptBox(page, 1).check();
    await codeSelect(page, 1).selectOption('VATEX-SA-33');

    await choose(page, 'Create');
    await expect(page.getByText('Use one zero-rated exemption code per invoice (found VATEX-SA-32, VATEX-SA-33).').first()).toBeVisible();
    await expect(page.getByText('One zero-rated code per invoice', { exact: true })).toHaveCount(2);
    expect(submitted.count).toBe(0);

    // Resolving the conflict on one line clears it on both lines.
    await codeSelect(page, 1).selectOption('VATEX-SA-29');
    await expect(page.getByText('One zero-rated code per invoice', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('exemption-messages')).toHaveCount(0);
  });

  test('private education needs a customer identified by national ID', async ({ page }) => {
    const submitted = await mockForm(page);
    await signIn(page);
    await newInvoice(page);
    await exemptBox(page, 0).check();
    await codeSelect(page, 0).selectOption('VATEX-SA-EDU');
    await choose(page, 'Create');
    await expect(page.getByText('VATEX-SA-EDU requires a customer identified by National ID (NAT) (ZATCA BR-KSA-49).').first()).toBeVisible();
    expect(submitted.count).toBe(0);

    await newInvoice(page, { customer: 'Saudi Citizen' });
    await exemptBox(page, 0).check();
    await codeSelect(page, 0).selectOption('VATEX-SA-EDU');
    await choose(page, 'Create');
    await expect.poll(() => submitted.count).toBe(1);
    expect(submitted.at(0).lineItems[0].taxExemptionCode).toBe('VATEX-SA-EDU');
  });

  test('an invoice saved before codes existed shows the code matching its reason', async ({ page }) => {
    await mockForm(page, {
      invoice: {
        _id: 'inv-old',
        invoiceNumber: 'INV-2026-000009',
        invoiceType: 'B2B',
        status: 'DRAFT',
        referenceNumber: 'REF-OLD',
        paymentType: 'CASH',
        paymentTerms: 'Net 30',
        vat: 15,
        currency: 'SAR',
        customerId: COMPANY,
        lineItems: [{ description: 'Crates', productCode: 'C-1', quantity: 1, price: 10000, discount_amount: 0, total: 10000, taxExempt: true, taxExemptReason: 'Export of goods' }],
      },
    });
    await signIn(page);
    await page.goto('/invoices/inv-old');
    await expect(codeSelect(page, 0)).toHaveValue('VATEX-SA-32');
    await expect(reasonInput(page, 0)).toHaveValue('Export of goods');
  });
});
