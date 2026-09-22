import { getApiUrl, defaultHeaders, handleNetworkError, HANDLED_RESPONSE_ERROR } from './api.config';

/** ZATCA XML of an invoice: compliance check, submitted and ZATCA-stamped XML. */
const InvoiceZatcaXmlRequest = (token, invoiceId) => {
  const headers = {
    ...defaultHeaders,
    Authorization: `Bearer ${token}`,
  };
  return fetch(getApiUrl(`/invoices/${invoiceId}/xml`), {
    method: 'GET',
    headers,
  })
    .then(async (res) => {
      if (!res.ok) {
        await handleNetworkError(res, 'Failed to load the ZATCA XML');
        const err = new Error('Failed to load the ZATCA XML');
        err[HANDLED_RESPONSE_ERROR] = true;
        throw err;
      }
      return res.json();
    })
    .catch((err) => {
      if (!err?.[HANDLED_RESPONSE_ERROR]) handleNetworkError(err, 'ZATCA XML request failed');
      throw err;
    });
};

export default InvoiceZatcaXmlRequest;
