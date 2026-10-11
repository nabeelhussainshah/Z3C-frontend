import { BASE_URL, showToast, decodeString, encodeString } from '../utils';
import { getDefaultStore } from 'jotai';
import { auth, refreshToken, isRefreshingToken } from '../atoms';

/**
 * Default headers for all API requests.
 * Override or extend per request as needed.
 */
export const defaultHeaders = {
  'Content-Type': 'application/json',
};

/**
 * HTTP status code to user-facing error message.
 */
export const HTTP_ERROR_MESSAGES = {
  400: 'Bad request. Please check your input.',
  401: 'Unauthorized. Please sign in again.',
  402: 'Payment required.',
  403: 'Forbidden. You do not have access.',
  404: 'Not found. The requested resource does not exist.',
  408: 'Request timeout. Please try again.',
  409: 'Conflict. The request could not be completed.',
  422: 'Unprocessable. Please check your data.',
  429: 'Too many requests. Please try again later.',
  500: 'Server error. Please try again later.',
  502: 'Bad gateway. Service temporarily unavailable.',
  503: 'Service unavailable. Please try again later.',
  504: 'Gateway timeout. Please try again later.',
};

/**
 * Generic network error handler: shows an error toast and logs to console.
 * For HTTP 400 and 409, parses the response body and shows the server's "message" if present.
 * For HTTP 401 with reason PERMISSIONS_UPDATED, dispatches a "permissions:updated" window
 * event so the permissions middleware can silently refresh the token and reload the page.
 * @param {Response|Error|unknown} errorOrResponse - Fetch Response (with status) or Error instance.
 * @param {string} [fallbackMessage] - Message to use when status/error message cannot be determined.
 * @returns {Promise<void>}
 */
export const handleNetworkError = async (errorOrResponse, fallbackMessage = 'Something went wrong') => {
  let message = fallbackMessage;

  if (errorOrResponse?.status !== undefined) {
    const status = errorOrResponse.status;

    // For 401, check whether this is a PERMISSIONS_UPDATED signal from the server.
    // If so, hand off to the permissions middleware via a window event and bail out silently.
    if (status === 401 && typeof errorOrResponse.json === 'function') {
      try {
        const resClone = errorOrResponse.clone();
        const data = await resClone.json();
        
        if (data?.error?.reason === 'PERMISSIONS_UPDATED') {
          window.dispatchEvent(new CustomEvent('permissions:updated'));
          return;
        }

        if (data?.error?.code === 'UnauthorizedException') {
          // Avoid intercepting the refresh token request itself
          if (errorOrResponse.url && errorOrResponse.url.includes('/auth/refresh-token')) {
            // Let it fall through to generic error message
          } else {
            const store = getDefaultStore();
            const isRefreshing = store.get(isRefreshingToken);

            if (!isRefreshing) {
              store.set(isRefreshingToken, true);

              const currentTokenStr = store.get(auth);
              const currentRefreshTokenStr = store.get(refreshToken);

              if (currentTokenStr && currentRefreshTokenStr) {
                const currentToken = decodeString(currentTokenStr);
                const currentRefreshToken = decodeString(currentRefreshTokenStr);

                try {
                  const { default: RefreshTokenRequest } = await import('./refresh-token.request');
                  const newTokens = await RefreshTokenRequest(currentToken, JSON.stringify({ refreshToken: currentRefreshToken }));
                  
                  const accessToken = newTokens?.data?.accessToken || newTokens?.accessToken;
                  const newRefresh = newTokens?.data?.refreshToken || newTokens?.refreshToken;

                  if (accessToken) store.set(auth, encodeString(accessToken));
                  if (newRefresh) store.set(refreshToken, encodeString(newRefresh));
                  
                  // Return silently to avoid showing the 401 error toast to the user
                  // during successful auto-refresh. The failed request might still throw,
                  // but we won't show the toast here.
                  return;
                } catch (refreshErr) {
                  // If refresh fails, clear tokens to log out the user
                  store.set(auth, null);
                  store.set(refreshToken, null);
                } finally {
                  store.set(isRefreshingToken, false);
                }
              } else {
                store.set(auth, null);
                store.set(refreshToken, null);
                store.set(isRefreshingToken, false);
              }
            } else {
              // It is already refreshing, so we just return silently to not spam toasts
              return;
            }
          }
        }
      } catch (_) {
        // Response body is not JSON or missing the expected shape — fall through to the
        // generic 401 message below.
      }
    }

    // For 400 and 409, use server message from response body (e.g. validation
    // errors, or why an invoice cannot be sent to ZATCA right now)
    if ((status === 400 || status === 409) && typeof errorOrResponse.json === 'function') {
      try {
        const data = await errorOrResponse.json();
        if (data?.message && typeof data.message === 'string') {
          message = data.message;
          showToast(message, 'error');
          console.error('[Network Error]', message, errorOrResponse);
          return;
        }
      } catch (_) {
        // body was not valid JSON, fall through to generic message
      }
    }
    message = HTTP_ERROR_MESSAGES[status] ?? errorOrResponse.statusText ?? fallbackMessage;
  } else if (errorOrResponse?.message) {
    message = errorOrResponse.message;
  }

  showToast(message, 'error');
  console.error('[Network Error]', message, errorOrResponse);
};

/**
 * Builds the full API URL for a given path.
 * @param {string} path - API path (e.g. '/login'). Leading slash is optional.
 * @returns {string} Full URL
 */
export const getApiUrl = (path) => {
  const base = BASE_URL.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
};

/**
 * Property set on errors thrown after handleNetworkError(res) so catch blocks skip showing toast again.
 */
export const HANDLED_RESPONSE_ERROR = '__handledByResponse';

export { BASE_URL };
