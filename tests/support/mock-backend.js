import { expect } from '@playwright/test';

/**
 * Mocked backend for UI tests. Every API call (fetch/xhr) is answered here —
 * page assets pass through to the Vite dev server — so tests are deterministic
 * and need no running backend. Returns the list of API calls made.
 */

/** A successful response in the backend's envelope ({ success, data }). */
export const ok = (data, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ success: true, message: 'ok', status_code: status, data }),
});

/** Admin with no permissions object → full access in the UI. */
export const ADMIN_USER = { id: 'u1', email: 'tester@example.com', username: 'tester', isAdmin: true };

/**
 * @param routes array of { method, match(path) => boolean, respond(call) => fulfillOptions }
 */
export async function mockBackend(page, { user = ADMIN_USER, routes = [] } = {}) {
  const calls = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!['fetch', 'xhr'].includes(req.resourceType())) return route.continue();
    const url = new URL(req.url());
    let body = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    const call = { method: req.method(), path: url.pathname, query: url.searchParams, body };
    calls.push(call);

    // Login with 2FA disabled: the session is returned directly (no OTP step).
    if (call.path.endsWith('/auth/login') && call.method === 'POST') {
      return route.fulfill(
        ok({ requireOTP: false, accessToken: 'test-access-token', refreshToken: 'test-refresh-token', user, navigationMenu: [] }),
      );
    }
    for (const r of routes) {
      if (r.method === call.method && r.match(call.path)) return route.fulfill(await r.respond(call));
    }
    return route.fulfill(ok([])); // dashboard widgets and anything else
  });
  return calls;
}

/** Signs in through the real sign-in screen. */
export async function signIn(page) {
  await page.goto('/login');
  await page.getByPlaceholder('name@company.com').fill('tester@example.com');
  await page.getByPlaceholder('Enter your password').fill('secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByPlaceholder('name@company.com')).toHaveCount(0);
}

/** API calls matching a method + path suffix. */
export const callsTo = (calls, method, suffix) =>
  calls.filter((c) => c.method === method && c.path.endsWith(suffix));
