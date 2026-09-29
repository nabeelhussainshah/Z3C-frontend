import { test, expect } from '@playwright/test';

test('loads the sign-in screen', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/ZATCA Compliance Dashboard/i);
  await expect(page.getByRole('heading', { name: 'Sign in' }).first()).toBeVisible();
  await expect(page.getByPlaceholder('name@company.com')).toBeVisible();
  await expect(page.getByPlaceholder('Enter your password')).toBeVisible();
});
