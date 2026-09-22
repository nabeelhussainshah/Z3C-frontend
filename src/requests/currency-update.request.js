import { getApiUrl, defaultHeaders, handleNetworkError, HANDLED_RESPONSE_ERROR } from './api.config';

const CurrencyUpdateRequest = (token, code, jsonData) => {
  const headers = {
    ...defaultHeaders,
    'Authorization': `Bearer ${token}`
  };
  return fetch(getApiUrl(`/currencies/${code}`), {
    method: 'PATCH',
    headers: headers,
    body: jsonData
  })
    .then(async (res) => {
      if (!res.ok) {
        await handleNetworkError(res, 'Failed to update currency');
        const err = new Error('Failed to update currency');
        err[HANDLED_RESPONSE_ERROR] = true;
        throw err;
      }
      return res.json();
    })
    .catch((err) => {
      if (!err?.[HANDLED_RESPONSE_ERROR]) handleNetworkError(err, 'Currency update request failed');
      throw err;
    });
};

export default CurrencyUpdateRequest;
