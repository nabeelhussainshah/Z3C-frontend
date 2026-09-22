import { getApiUrl, defaultHeaders, handleNetworkError, HANDLED_RESPONSE_ERROR } from './api.config';

const CurrencyDeactivateRequest = (token, code) => {
  const headers = {
    ...defaultHeaders,
    'Authorization': `Bearer ${token}`
  };
  return fetch(getApiUrl(`/currencies/${code}`), {
    method: 'DELETE',
    headers: headers,
  })
    .then(async (res) => {
      if (!res.ok) {
        await handleNetworkError(res, 'Failed to deactivate currency');
        const err = new Error('Failed to deactivate currency');
        err[HANDLED_RESPONSE_ERROR] = true;
        throw err;
      }
      return res.json();
    })
    .catch((err) => {
      if (!err?.[HANDLED_RESPONSE_ERROR]) handleNetworkError(err, 'Currency deactivate request failed');
      throw err;
    });
};

export default CurrencyDeactivateRequest;
