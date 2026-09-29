import { test, expect } from '@playwright/test';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/** Creating and editing a (local) dashboard user: the payload the users API receives. */

const noPermissions = {
  invoice: { read: false, create: false, update: false, delete: false },
  customer: { read: false, create: false, update: false, delete: false },
  profile: { read: false, create: false, update: false, delete: false },
  companyProfile: { read: false, create: false, update: false, delete: false },
  user: { read: false, create: false, update: false, delete: false },
  dashboard: { read: false, create: false, update: false, delete: false },
  zatcaReporting: { read: false, create: false, update: false, delete: false },
  audit: { read: false, create: false, update: false, delete: false },
};

// Fields stay read-only until focused (an autofill guard), so click before typing.
async function type(locator, value) {
  await locator.click();
  await locator.fill(value);
}

test('creating a user sends the username, email, password and chosen permissions', async ({ page }) => {
  const calls = await mockBackend(page, {
    routes: [{ method: 'POST', match: (p) => p.endsWith('/users'), respond: () => ok({ _id: 'u-new' }, 201) }],
  });
  await signIn(page);
  await page.goto('/user-management/new');

  await type(page.getByPlaceholder('Enter username'), 'jdoe');
  await type(page.getByPlaceholder('Enter email'), 'jdoe@example.com');
  const [password, confirm] = [page.locator('input[name="password"]'), page.locator('input[name="confirmPassword"]')];
  await type(password, 'Test-Pass1!');
  await type(confirm, 'Test-Pass1!');
  await page.getByLabel('Invoice read', { exact: true }).check();
  await page.getByLabel('Invoice create', { exact: true }).check();
  await page.getByLabel('Dashboard read', { exact: true }).check();
  await page.getByRole('button', { name: 'Create user' }).click();

  await expect.poll(() => callsTo(calls, 'POST', '/users').length).toBe(1);
  expect(callsTo(calls, 'POST', '/users')[0].body).toEqual({
    username: 'jdoe',
    email: 'jdoe@example.com',
    password: 'Test-Pass1!',
    isActive: true,
    isAdmin: false,
    role: 'Admin',
    permissions: {
      ...noPermissions,
      invoice: { read: true, create: true, update: false, delete: false },
      dashboard: { read: true, create: false, update: false, delete: false },
    },
  });
});

test('editing a user keeps their permissions and sends no password unless one is entered', async ({ page }) => {
  const stored = {
    _id: 'u9',
    username: 'jdoe',
    email: 'jdoe@example.com',
    isActive: true,
    isAdmin: false,
    role: 'Accountant',
    permissions: { invoice: { read: true, create: true, update: true, delete: false }, audit: { read: true } },
  };
  const calls = await mockBackend(page, {
    routes: [
      { method: 'GET', match: (p) => p.endsWith('/users/u9'), respond: () => ok(stored) },
      { method: 'PATCH', match: (p) => p.endsWith('/users/u9'), respond: (c) => ok({ ...stored, ...c.body }) },
    ],
  });
  await signIn(page);
  await page.goto('/user-management/u9');
  await expect(page.getByPlaceholder('Enter username')).toHaveValue('jdoe');
  await expect(page.getByLabel('Invoice update', { exact: true })).toBeChecked();

  await type(page.getByPlaceholder('Enter username'), 'jdoe2');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect.poll(() => callsTo(calls, 'PATCH', '/users/u9').length).toBe(1);
  expect(callsTo(calls, 'PATCH', '/users/u9')[0].body).toEqual({
    username: 'jdoe2',
    email: 'jdoe@example.com',
    isActive: true,
    isAdmin: false,
    role: 'Accountant',
    permissions: {
      ...noPermissions,
      invoice: { read: true, create: true, update: true, delete: false },
      audit: { read: true, create: false, update: false, delete: false },
    },
  });
});
