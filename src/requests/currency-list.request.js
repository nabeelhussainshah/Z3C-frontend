import { getApiUrl, defaultHeaders, handleNetworkError, HANDLED_RESPONSE_ERROR } from './api.config';

/**
 * Lists currencies. Active currencies by default (for the invoice form);
 * pass { all: true } to include inactive ones (currency administration).
 */
const CurrencyListRequest = async (token, params = {}) => {
  const url = getApiUrl(`/currencies${params.all ? '?all=true' : ''}`);

  const headers = {
    ...defaultHeaders,
    Authorization: `Bearer ${token}`,
  };

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: headers,
    });
    if (!res.ok) {
      await handleNetworkError(res, 'Failed to fetch currencies');
      const err = new Error('Failed to fetch currencies');
      err[HANDLED_RESPONSE_ERROR] = true;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (!err?.[HANDLED_RESPONSE_ERROR]) handleNetworkError(err, 'Currencies list request failed');
    throw err;
  }
};

export default CurrencyListRequest;
