import { getApiUrl, defaultHeaders, handleNetworkError, HANDLED_RESPONSE_ERROR } from './api.config';

const CurrencyCreateRequest = (token, jsonData) => {
  const headers = {
    ...defaultHeaders,
    'Authorization': `Bearer ${token}`
  };
  return fetch(getApiUrl('/currencies'), {
    method: 'POST',
    headers: headers,
    body: jsonData
  })
    .then(async (res) => {
      if (!res.ok) {
        await handleNetworkError(res, 'Failed to create currency');
        const err = new Error('Failed to create currency');
        err[HANDLED_RESPONSE_ERROR] = true;
        throw err;
      }
      return res.json();
    })
    .catch((err) => {
      if (!err?.[HANDLED_RESPONSE_ERROR]) handleNetworkError(err, 'Currency create request failed');
      throw err;
    });
};

export default CurrencyCreateRequest;
