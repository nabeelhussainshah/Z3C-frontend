import { getApiUrl, defaultHeaders, handleNetworkError, HANDLED_RESPONSE_ERROR } from './api.config';

/** ZATCA VAT exemption codes: [{ code, category, description }]. */
const VatExemptionCodesRequest = async (token) => {
  try {
    const res = await fetch(getApiUrl('/vat-exemption-codes'), {
      method: 'GET',
      headers: { ...defaultHeaders, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      await handleNetworkError(res, 'Failed to fetch VAT exemption codes');
      const err = new Error('Failed to fetch VAT exemption codes');
      err[HANDLED_RESPONSE_ERROR] = true;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (!err?.[HANDLED_RESPONSE_ERROR]) handleNetworkError(err, 'VAT exemption codes request failed');
    throw err;
  }
};

export default VatExemptionCodesRequest;
