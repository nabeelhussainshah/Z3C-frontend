import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/**
 * Test cases 1B/2B: "Check compliance" and "Report to ZATCA" on a Rejected
 * invoice. When the backend refuses (409 — e.g. ZATCA onboarding not
 * completed), the user is told why, and never told it was queued.
 */

const page1 = (rows) => ok({ data: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } });
const toasts = (page) => page.locator('.toast__message');

const REJECTED = {
  _id: 'r1',
  invoiceNumber: 'INV-2026-000201',
  referenceNumber: 'REF-R1',
  status: 'REJECTED',
  invoiceType: 'B2B',
  currency: 'SAR',
  paymentType: 'CASH',
  customerId: { registrationName: 'Acme Corp' },
  totalsInCurrency: { grandTotal: 115 },
  createdAt: '2026-09-30T10:00:00.000Z',
  compliance: null,
  clearance: null,
};

const NOT_ONBOARDED =
  "ZATCA onboarding has not been completed for the 'sandbox' environment. Complete ZATCA onboarding, then try again.";

const conflict = (message) => ({
  status: 409,
  contentType: 'application/json',
  body: JSON.stringify({ success: false, message, status_code: 409, error: { code: 'Conflict' } }),
});

async function openList(page, routes) {
  const calls = await mockBackend(page, {
    routes: [...routes, { method: 'GET', match: (p) => p.endsWith('/invoices'), respond: () => page1([REJECTED]) }],
  });
  await signIn(page);
  await page.goto('/invoices');
  await expect(page.getByRole('row', { name: /INV-2026-000201/ })).toBeVisible();
  return calls;
}

const row = (page) => page.getByRole('row', { name: /INV-2026-000201/ });

for (const action of [
  { name: 'Check compliance', path: '/queue-compliance', success: 'Invoice compliance check queued successfully!' },
  { name: 'Report to ZATCA', path: '/queue-clearance', success: 'Invoice submitted to ZATCA successfully!' },
]) {
  test(`${action.name} refused by the backend shows the reason, not a success message`, async ({ page }) => {
    const calls = await openList(page, [
      { method: 'POST', match: (p) => p.endsWith(action.path), respond: () => conflict(NOT_ONBOARDED) },
    ]);

    await row(page).getByRole('button', { name: action.name }).click();

    await expect(toasts(page).filter({ hasText: NOT_ONBOARDED })).toBeVisible();
    expect(callsTo(calls, 'POST', action.path)).toHaveLength(1);
    await expect(toasts(page).filter({ hasText: action.success })).toHaveCount(0);
    await expect(toasts(page).filter({ hasText: 'Conflict. The request could not be completed.' })).toHaveCount(0);
  });

  test(`${action.name} accepted by the backend still reports success`, async ({ page }) => {
    const calls = await openList(page, [
      { method: 'POST', match: (p) => p.endsWith(action.path), respond: () => ok({ ...REJECTED, status: 'COMPLIANCE_QUEUED' }, 201) },
    ]);

    await row(page).getByRole('button', { name: action.name }).click();

    await expect(toasts(page).filter({ hasText: action.success })).toBeVisible();
    expect(callsTo(calls, 'POST', action.path)).toHaveLength(1);
  });
}
