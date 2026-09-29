import { getApiUrl, defaultHeaders, handleNetworkError, HANDLED_RESPONSE_ERROR } from './api.config';

/** Deactivates one or many records in a single request; resolves to { requested, deactivatedCount, deactivated, notFound, invalid }. */
const CustomerDeleteRequest = (token, ids) => {
  const headers = {
    ...defaultHeaders,
    'Authorization': `Bearer ${token}`
  };
  return fetch(getApiUrl('/customers'), {
    method: 'DELETE',
    headers: headers,
    body: JSON.stringify({ customerIds: ids }),
  })
    .then(async (res) => {
      if (!res.ok) {
        await handleNetworkError(res, 'Failed to delete customer');
        const err = new Error('Failed to delete customer');
        err[HANDLED_RESPONSE_ERROR] = true;
        throw err;
      }
      return res.json();
    })
    .catch((err) => {
      if (!err?.[HANDLED_RESPONSE_ERROR]) handleNetworkError(err, 'Customer delete request failed');
      throw err;
    });
};

export default CustomerDeleteRequest;
