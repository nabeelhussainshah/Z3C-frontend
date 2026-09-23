import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/**
 * An expired login on the invoice pages: the API answers 401 UnauthorizedException,
 * the app exchanges its refresh token for a new access token and carries on,
 * instead of signing the user out.
 */

const ROW = {
  _id: 'inv-1',
  invoiceNumber: 'INV-2026-000001',
  referenceNumber: 'REF-1',
  invoiceType: 'B2B',
  status: 'DRAFT',
  currency: 'SAR',
  customerId: { registrationName: 'Acme Corp' },
  totalsInCurrency: { grandTotal: 115 },
  createdAt: '2026-09-01T10:00:00.000Z',
};

const EXPIRED = {
  status: 401,
  contentType: 'application/json',
  body: JSON.stringify({ success: false, message: 'Unauthorized', status_code: 401, error: { code: 'UnauthorizedException' } }),
};

test('an expired session on the invoice list is refreshed and the list loads', async ({ page }) => {
  let expired = false;
  const calls = await mockBackend(page, {
    routes: [
      {
        method: 'POST',
        match: (p) => p.endsWith('/auth/refresh-token'),
        respond: () => {
          expired = false;
          return ok({ accessToken: 'refreshed-access-token', refreshToken: 'test-refresh-token' }, 201);
        },
      },
      {
        method: 'GET',
        match: (p) => p.endsWith('/invoices'),
        respond: () =>
          expired ? EXPIRED : ok({ data: [ROW], meta: { total: 1, page: 1, limit: 10, totalPages: 1 } }),
      },
    ],
  });
  await signIn(page);

  expired = true; // the access token has now expired
  await page.goto('/invoices');

  await expect(page.getByText('INV-2026-000001')).toBeVisible();
  await expect(page).toHaveURL(/\/invoices$/);
  const refresh = callsTo(calls, 'POST', '/auth/refresh-token');
  expect(refresh).toHaveLength(1);
  expect(refresh[0].body).toEqual({ refreshToken: 'test-refresh-token' });
});
