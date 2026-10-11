import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/**
 * User Management list, Status filter (test case 1C): "All" must list inactive
 * users too, so it asks the users API for isActive=all — omitting the filter
 * makes the API default to active users only.
 */

const USERS = [
  { _id: 'u1', username: 'active.user', email: 'active@example.com', role: 'Admin', isActive: true },
  { _id: 'u2', username: 'inactive.user', email: 'inactive@example.com', role: 'Viewer', isActive: false },
];

/** Answers GET /users like the API: isActive=true/false filters, all (or anything else) lists everyone. */
const usersRoute = {
  method: 'GET',
  match: (p) => p.endsWith('/users'),
  respond: ({ query }) => {
    const isActive = query.get('isActive');
    const data =
      isActive === 'true' || isActive === null
        ? USERS.filter((u) => u.isActive)
        : isActive === 'false'
          ? USERS.filter((u) => !u.isActive)
          : USERS;
    return ok({ data, total: data.length, page: 1, limit: 20, totalPages: 1 });
  },
};

const lastStatusQuery = (calls) => callsTo(calls, 'GET', '/users').at(-1)?.query.get('isActive');

const statusSelect = (page) => page.locator('label:has-text("Status") + select');

test('the default "All" status lists active and inactive users', async ({ page }) => {
  const calls = await mockBackend(page, { routes: [usersRoute] });
  await signIn(page);
  await page.goto('/user-management');

  await expect(page.getByText('inactive.user')).toBeVisible();
  await expect(page.getByText('active.user', { exact: true })).toBeVisible();
  expect(lastStatusQuery(calls)).toBe('all');
});

test('Status filter: Inactive, Active, then back to All', async ({ page }) => {
  const calls = await mockBackend(page, { routes: [usersRoute] });
  await signIn(page);
  await page.goto('/user-management');
  await page.getByRole('button', { name: /Filters/ }).click();

  await statusSelect(page).selectOption('false');
  await expect.poll(() => lastStatusQuery(calls)).toBe('false');
  await expect(page.getByText('inactive.user')).toBeVisible();
  await expect(page.getByText('active.user', { exact: true })).toHaveCount(0);

  await statusSelect(page).selectOption('true');
  await expect.poll(() => lastStatusQuery(calls)).toBe('true');
  await expect(page.getByText('active.user', { exact: true })).toBeVisible();
  await expect(page.getByText('inactive.user')).toHaveCount(0);

  await statusSelect(page).selectOption({ label: 'All' });
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => lastStatusQuery(calls)).toBe('all');
  await expect(page.getByText('inactive.user')).toBeVisible();
  await expect(page.getByText('active.user', { exact: true })).toBeVisible();
});

test('Reset returns the Status filter to All, including inactive users', async ({ page }) => {
  const calls = await mockBackend(page, { routes: [usersRoute] });
  await signIn(page);
  await page.goto('/user-management');
  await page.getByRole('button', { name: /Filters/ }).click();

  await statusSelect(page).selectOption('true');
  await expect.poll(() => lastStatusQuery(calls)).toBe('true');
  await page.getByRole('button', { name: 'Reset' }).click();

  await expect.poll(() => lastStatusQuery(calls)).toBe('all');
  await expect(page.getByText('inactive.user')).toBeVisible();
});
