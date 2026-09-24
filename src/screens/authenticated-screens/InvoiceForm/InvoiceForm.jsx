// Packages
import { Fragment, useState, useMemo, Suspense, use, useEffect, useCallback } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useNavigate, useParams } from 'react-router-dom';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import { useAtomValue } from 'jotai';

// APIs
import { InvoiceCreateRequest, InvoiceDetailRequest, InvoiceUpdateRequest, InvoiceCheckComplianceRequest, InvoiceSubmitToZatcaRequest, InvoicePdfDownloadRequest, InvoiceProformaPdfDownloadRequest, CustomerListRequest, CurrencyListRequest, VatExemptionCodesRequest } from '../../../requests';

// Utils
import { Footer, ErrorFallback, ZatcaXmlViewer } from '../../../components';
import { showToast, validateSubmissionData, decodeString, INVOICE_STATUSES, parseLoginInfo, getNormalizedModulePermissions, OUT_OF_SCOPE_CODE, isVatZero, groupExemptionCodes, matchExemptionCodeByText, nextExemptionReason, validateLineExemptions } from '../../../utils';
import { auth, loginInfo } from '../../../atoms';

const INITIAL_FORM_DATA = {
  data: {
    status: '',
    invoiceNumber: '',
    invoiceType: 'B2B',
    customerId: null,
    referenceNumber: '',
    paymentType: '',
    paymentTerms: '',
    customerCategory: 'corporate',
    deliveryDate: '',
    // Customer fields (matched with registration fields)
    registrationName: '',
    registrationNameAr: '',
    email: '',
    phone: '',
    customerVAT: '',
    customerType: 'domestic',
    identificationScheme: '',
    identificationId: '',
    streetName: '',
    streetNameAr: '',
    address: '',
    addressAr: '',
    buildingNumber: '',
    citySubdivisionName: '',
    citySubdivisionNameAr: '',
    cityName: '',
    cityNameAr: '',
    postalZone: '',
    countryCode: 'SA',
    // Note
    note: '',
    vat: 15,
    // Invoice currency. exchangeRate = SAR per 1 unit; only used when currency is not SAR.
    currency: 'SAR',
    exchangeRate: '',
  },
  validations: {
    referenceNumber: { isRequired: true, label: 'Reference Number' },
    customerId: { isRequired: true, label: 'Customer' },
    paymentTerms: { isRequired: true, label: 'Payment Terms' },
    // deliveryDate: { isRequired: true, label: 'Delivery Date' },
    vat: { isRequired: true, isNumber: true, label: 'VAT' }
  },
  errors: {},
};

const INITIAL_LINE_ITEM = {
  description: '',
  productCode: '',
  quantity: 1,
  price: '',
  discount_amount: 0,
  discount_percentage: 0,
  taxExempt: false,
  taxExemptReason: '',
  taxExemptionCode: '',
};

// Line quantity: a whole number from 1 to 1,000,000 (same limits as the backend).
const MAX_LINE_QUANTITY = 1_000_000;
const isValidQuantity = (value) => {
  const n = Number(value);
  return String(value).trim() !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_LINE_QUANTITY;
};
// Keys an integer quantity field must not accept.
const NON_INTEGER_KEYS = ['.', ',', 'e', 'E', '-', '+'];

/** Validation message for the exchange rate, or null when valid or not applicable (SAR). */
const getExchangeRateError = ({ currency, exchangeRate }) => {
  if (!currency || currency === 'SAR') return null;
  const raw = String(exchangeRate ?? '').trim();
  if (!raw) return `Exchange rate is required for ${currency}`;
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) return 'Exchange rate must be a number with up to 6 decimal places';
  if (!(Number(raw) > 0)) return 'Exchange rate must be greater than 0';
  return null;
};

function InvoiceForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const decodedToken = useMemo(() => decodeString(authValue), [authValue]);

  // *********** Render Functions ***********
  const invoicePromise = useMemo(() => {
    if (id) {
      return InvoiceDetailRequest(decodedToken, id).catch((err) => {
        console.error('Failed to fetch invoice details:', err);
        return { data: null, isError: true };
      });
    }
    return null;
  }, [id, decodedToken]);

  const CONTENT = () => (
    <Fragment>
      <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
        <Suspense fallback={
          <div className="p-8 flex items-center justify-center">
            <div className="flex items-center gap-2 text-[#4c669a]">
              <span className="material-symbols-outlined animate-spin">sync</span>
              Loading invoice details...
            </div>
          </div>
        }>
          <InvoiceFormContent
            id={id}
            invoicePromise={invoicePromise}
            decodedToken={decodedToken}
            navigate={navigate}
          />
        </Suspense>
      </ErrorBoundary>
    </Fragment>
  );

  return (
    <div id="invoice-form">
      {CONTENT()}
    </div>
  );
}

function InvoiceFormContent({ id, invoicePromise, decodedToken, navigate }) {
  const invoiceData = invoicePromise ? use(invoicePromise) : null;
  const loginInfoValue = useAtomValue(loginInfo);
  const invoicePerms = useMemo(() => getNormalizedModulePermissions(parseLoginInfo(loginInfoValue), 'invoice'), [loginInfoValue]);
  const [formData, _formData] = useState({ ...INITIAL_FORM_DATA });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isXmlViewerOpen, _isXmlViewerOpen] = useState(false);
  const handleCloseXmlViewer = useCallback(() => _isXmlViewerOpen(false), []);
  // A saved invoice that has been compliance-checked or submitted has ZATCA XML.
  const hasZatcaXml =
    !!id && [invoiceData?.data?.compliance, invoiceData?.data?.clearance].some((r) => r && Object.keys(r).length > 0);

  // ZATCA VAT exemption codes for the line items' exemption dropdown.
  const [exemptionCodes, _exemptionCodes] = useState([]);
  useEffect(() => {
    VatExemptionCodesRequest(decodedToken)
      .then((res) => _exemptionCodes(Array.isArray(res?.data) ? res.data : []))
      .catch(() => {
        // The request helper already surfaced the error.
      });
  }, [decodedToken]);
  // Validation feedback for the exemption fields: per line, and invoice-wide messages.
  const [exemptionErrors, _exemptionErrors] = useState({});
  const [exemptionMessages, _exemptionMessages] = useState([]);
  // Lines whose quantity is invalid (highlighted), and the message shown under the table.
  const [quantityErrorLines, _quantityErrorLines] = useState([]);
  const [quantityMessage, _quantityMessage] = useState('');

  // Active currencies for the Currency dropdown; SAR is always available.
  const [currencies, _currencies] = useState([{ code: 'SAR', name: 'Saudi Riyal' }]);
  useEffect(() => {
    CurrencyListRequest(decodedToken)
      .then((res) => {
        const list = Array.isArray(res?.data) ? res.data : [];
        if (list.length) _currencies(list);
      })
      .catch(() => {
        // Keep the SAR-only fallback; the request helper already surfaced the error.
      });
  }, [decodedToken]);

  const currencyCode = formData.data.currency || 'SAR';
  const isForeignCurrency = currencyCode !== 'SAR';
  // Keep an existing invoice's currency selectable even if it was deactivated since.
  const currencyOptions = currencies.some((c) => c.code === currencyCode)
    ? currencies
    : [...currencies, { code: currencyCode, name: '' }];

  const currentStatusConfig = INVOICE_STATUSES.find((status) => status.name === formData.data.status);
  const canEditInvoice = (!id || currentStatusConfig?.canEdit) && (!id || invoicePerms.update);
  const canSubmitToZatca = !id || currentStatusConfig?.canSubmitToZatca;
  const canCheckComplianceForExistingInvoice = !!currentStatusConfig?.canCheckCompliance;
  const canCheckComplianceForDraft = !!INVOICE_STATUSES.find((status) => status.name === 'DRAFT')?.canCheckCompliance;
  const canCheckComplianceAction = id ? canCheckComplianceForExistingInvoice : canCheckComplianceForDraft;

  const getItemNetTotal = (item) => {
    const qty = Number(item.quantity) || 0;
    const priceCents = Math.round((Number(item.price) || 0) * 100);
    const discountAmtCents = Math.round((Number(item.discount_amount) || 0) * 100);

    // Formula: (price - discount_amount) × qty
    // discount_amount is always synced from discount_percentage when percentage is used
    const discountedPriceCents = priceCents - discountAmtCents;
    return Math.max(0, discountedPriceCents * qty) / 100;
  };

  const [lineItems, _lineItems] = useState([]);

  // At VAT 0% every line is tax exempt (the checkbox is locked on).
  const vatIsZero = isVatZero(formData.data.vat);
  const isLineExempt = (item) => vatIsZero || !!item.taxExempt;
  // Lines saved before codes existed get the code matching their reason text.
  const lineExemptionCode = (item) =>
    item.taxExemptionCode ||
    (item.taxExemptReason ? matchExemptionCodeByText(exemptionCodes, item.taxExemptReason)?.code ?? '' : '');

  const totals = useMemo(() => {
    const totalCents = lineItems.reduce(
      (acc, item) => acc + Math.round(getItemNetTotal(item) * 100),
      0
    );
    const taxableCents = lineItems.reduce(
      (acc, item) => item.taxExempt ? acc : acc + Math.round(getItemNetTotal(item) * 100),
      0
    );
    const subtotal = (totalCents / 100).toFixed(2);
    const vatPercentage = Number(formData.data.vat);
    const vatCents = Math.round(taxableCents * (vatPercentage / 100));
    const vatAmount = (vatCents / 100).toFixed(2);
    const grandTotal = ((totalCents + vatCents) / 100).toFixed(2);

    return { subtotal, vatAmount, grandTotal };
  }, [lineItems, formData.data.vat]);

  useEffect(() => {
    if (invoiceData?.data) {
      const apiData = invoiceData.data;
      const customer = apiData.customerId || {};
      _formData(old => ({
        ...old,
        data: {
          ...old.data,
          invoiceNumber: apiData.invoiceNumber || '',
          invoiceType: apiData.invoiceType || '',
          referenceNumber: apiData.referenceNumber || '',
          paymentType: apiData.paymentType || '',
          paymentTerms: apiData.paymentTerms || '',
          deliveryDate: apiData.deliveryDate ? new Date(apiData.deliveryDate).toISOString().split('T')[0] : '',
          // Customer fields from nested customerId object
          customerId: customer._id ? String(customer._id) : null,
          registrationName: customer.registrationName || '',
          registrationNameAr: customer.registrationNameAr || '',
          email: customer.email || '',
          phone: customer.phone || '',
          customerVAT: customer.customerVAT || '',
          customerType: customer.customerType || 'domestic',
          identificationScheme: customer.identificationScheme || '',
          identificationId: customer.identificationId || '',
          address: customer.address || '',
          addressAr: customer.addressAr || '',
          streetName: customer.streetName || '',
          streetNameAr: customer.streetNameAr || '',
          buildingNumber: customer.buildingNumber || '',
          citySubdivisionName: customer.citySubdivisionName || '',
          citySubdivisionNameAr: customer.citySubdivisionNameAr || '',
          cityName: customer.cityName || '',
          cityNameAr: customer.cityNameAr || '',
          postalZone: customer.postalZone || '',
          countryCode: customer.countryCode || 'SA',
          note: apiData.note || '',
          vat: apiData.vat,
          currency: (apiData.currency || 'SAR').toUpperCase(),
          exchangeRate:
            apiData.currency && apiData.currency.toUpperCase() !== 'SAR' && apiData.exchangeRate != null
              ? String(apiData.exchangeRate)
              : '',
          status: apiData.status || '',
        },
      }));

      if (apiData.lineItems) {
        _lineItems(apiData.lineItems.map(item => ({
          description: item.description || '',
          productCode: item.productCode || '',
          quantity: item.quantity || 1,
          // API returns price and discount_amount in minor units (cents/halala) of the invoice currency; convert to major units
          price: item.price ? item.price / 100 : 0,
          discount_amount: item.discount_amount ? item.discount_amount / 100 : 0,
          discount_percentage: item.discount_percentage || 0,
          taxExempt: item.taxExempt || false,
          taxExemptReason: item.taxExemptReason || '',
          taxExemptionCode: item.taxExemptionCode || '',
        })));
      }
    } else if (invoiceData?.isError) {
      _formData({ ...INITIAL_FORM_DATA });
      _lineItems([]);
    }
  }, [invoiceData]);

  // *********** Handlers ***********
  const handleChangeFormData = (e) => {
    const { name, value } = e.target;
    _formData((old) => ({
      ...old,
      data: {
        ...old.data,
        [name]: value,
      },
    }));
  };

  // Changing currency clears the exchange rate: a rate belongs to one currency,
  // so a previously entered rate must never carry over to another currency.
  const handleCurrencyChange = (e) => {
    const nextCurrency = e.target.value;
    _formData((old) => ({
      ...old,
      data: { ...old.data, currency: nextCurrency, exchangeRate: '' },
      errors: { ...old.errors, exchangeRate: undefined },
    }));
  };

  const handleCustomerChange = (selectedOption) => {
    if (selectedOption) {
      const customer = selectedOption.data;
      _formData((old) => ({
        ...old,
        data: {
          ...old.data,
          customerId: String(customer._id || customer.id || ''),
          registrationName: customer.registrationName || '',
          registrationNameAr: customer.registrationNameAr || '',
          email: customer.email || '',
          phone: customer.phone || '',
          customerVAT: customer.customerVAT || '',
          customerType: customer.customerType || 'domestic',
          identificationScheme: customer.identificationScheme || '',
          identificationId: customer.identificationId || '',
          streetName: customer.streetName || '',
          streetNameAr: customer.streetNameAr || '',
          address: customer.address || '',
          addressAr: customer.addressAr || '',
          buildingNumber: customer.buildingNumber || '',
          citySubdivisionName: customer.citySubdivisionName || '',
          citySubdivisionNameAr: customer.citySubdivisionNameAr || '',
          cityName: customer.cityName || '',
          cityNameAr: customer.cityNameAr || '',
          postalZone: customer.postalZone || '',
          countryCode: customer.countryCode || 'SA',
        },
      }));
    } else {
      _formData((old) => ({
        ...old,
        data: {
          ...old.data,
          customerId: null,
          registrationName: '',
          registrationNameAr: '',
          email: '',
          phone: '',
          customerVAT: '',
          customerType: 'domestic',
          identificationScheme: '',
          identificationId: '',
          streetName: '',
          streetNameAr: '',
          address: '',
          addressAr: '',
          buildingNumber: '',
          citySubdivisionName: '',
          citySubdivisionNameAr: '',
          cityName: '',
          cityNameAr: '',
          postalZone: '',
          countryCode: 'SA',
        },
      }));
    }
  };

  const loadCustomerOptions = (inputValue) => {
    return CustomerListRequest(decodedToken, { limit: 1000, search: inputValue })
      .then((response) => {
        return response.data.map((customer) => ({
          value: customer.id,
          label: customer.registrationName,
          data: customer,
        }));
      })
      .catch((error) => {
        console.error('Error loading customers:', error);
        return [];
      });
  };

  const handleValidateLineItems = () => {
    // Check if lineItems array is empty
    if (!lineItems || lineItems.length === 0) {
      return { allValid: false, errors: { empty: 'Line items should not be empty' } };
    }

    const validationData = {
      description: { isRequired: true },
      productCode: { isRequired: true },
      price: { isRequired: true, isNumber: true },
    };

    // Quantity: a whole number from 1 to 1,000,000
    const badQuantity = lineItems.flatMap((it, i) => (isValidQuantity(it.quantity) ? [] : [i]));
    const quantityRuleMessage =
      badQuantity.length > 0
        ? `Quantity must be a whole number from 1 to 1,000,000 (line${badQuantity.length > 1 ? 's' : ''} ${badQuantity.map((i) => i + 1).join(', ')}).`
        : '';
    _quantityErrorLines(badQuantity);
    _quantityMessage(quantityRuleMessage);

    let allValid = true;
    const lineItemErrors = {};

    // ZATCA VAT exemption rules (code + reason for exempt lines and at VAT 0%)
    const exemption = validateLineExemptions({
      lineItems: lineItems.map((it) => ({
        ...it,
        taxExempt: isLineExempt(it),
        taxExemptionCode: lineExemptionCode(it),
      })),
      vat: formData.data.vat,
      codes: exemptionCodes,
      identificationScheme: formData.data.identificationScheme,
    });

    // Validate each line item
    lineItems.forEach((item, index) => {
      const { allValid: itemValid, errors: itemErrors } = validateSubmissionData(
        item,
        validationData
      );

      const errors = { ...itemErrors };

      // discount_percentage must not exceed 100%
      const discountPct = Number(item.discount_percentage) || 0;
      if (discountPct > 100) {
        errors.discount_percentage = 'Discount percentage cannot exceed 100%';
      }

      Object.assign(errors, exemption.lineErrors[index]);
      if (badQuantity.includes(index)) errors.quantity = 'Invalid quantity';

      if (!itemValid || Object.keys(errors).length > 0) {
        allValid = false;
        lineItemErrors[index] = errors;
      }
    });

    _exemptionErrors(exemption.lineErrors);
    _exemptionMessages(exemption.messages);
    if (quantityRuleMessage) {
      allValid = false;
      lineItemErrors.quantityRule = quantityRuleMessage;
    }
    if (exemption.messages.length > 0) {
      allValid = false;
      lineItemErrors.exemption = exemption.messages.join(' ');
    }

    return { allValid, errors: lineItemErrors };
  };

  const getLineItemsErrorMessage = (lineItemErrors) => {
    // Handle empty line items case
    if (lineItemErrors.empty) {
      return lineItemErrors.empty;
    }

    const missingFields = new Set();

    Object.values(lineItemErrors).forEach((errors) => {
      if (typeof errors === 'object' && errors !== null) {
        Object.keys(errors).forEach((field) => {
          // Exemption and quantity problems are described by their own messages.
          if (field === 'taxExemptionCode' || field === 'taxExemptReason' || field === 'quantity') return;
          missingFields.add(field);
        });
      }
    });

    const fieldNames = Array.from(missingFields).map(field => {
      // Convert camelCase to Title Case
      return field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, ' $1');
    });

    return [
      lineItemErrors.quantityRule,
      lineItemErrors.exemption,
      fieldNames.length > 0 ? `Line items have missing ${fieldNames.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' ');
  };

  const handleValidateForm = () => {
    const { allValid, errors } = validateSubmissionData(
      formData.data,
      formData.validations
    );

    const validationErrors = { ...errors };
    let isValid = allValid;

    const exchangeRateError = getExchangeRateError(formData.data);
    if (exchangeRateError) {
      validationErrors.exchangeRate = exchangeRateError;
      isValid = false;
    }

    if (!isValid) {
      _formData((old) => ({
        ...old,
        errors: validationErrors,
      }));
    } else {
      _formData((old) => ({
        ...old,
        errors: {},
      }));
    }

    return isValid;
  };

  const handleValidateAll = () => {
    // Run both validations in parallel
    const formValidation = handleValidateForm();
    const lineItemsValidation = handleValidateLineItems();

    const formValid = formValidation;
    const lineItemsValid = lineItemsValidation.allValid;

    // Show toast messages for each error type
    if (!formValid) {
      showToast('Please fill in all required fields', 'error');
    }

    if (!lineItemsValid) {
      const errorMessage = getLineItemsErrorMessage(lineItemsValidation.errors);
      showToast(errorMessage, 'error');
    }

    return formValid && lineItemsValid;
  };

  const setSubmitPayload = (useCents = false) => {
    return {
      referenceNumber: formData.data.referenceNumber,
      customerId: String(formData.data.customerId || ''),
      paymentType: formData.data.paymentType || 'CASH',
      paymentTerms: formData.data.paymentTerms,
      deliveryDate: formData.data.deliveryDate,
      invoiceType: formData.data.invoiceType || 'B2B',
      vat: Number(formData.data.vat),
      note: formData.data.note,
      currency: currencyCode,
      ...(isForeignCurrency && { exchangeRate: Number(formData.data.exchangeRate) }),
      grandTotal: totals.grandTotal,
      lineItems: lineItems.map((item) => {
        const price = Number(item.price) || 0;
        const discountAmount = Number(item.discount_amount) || 0;
        const exempt = isLineExempt(item);
        const code = lineExemptionCode(item);
        return {
          description: item.description,
          productCode: item.productCode,
          quantity: Number(item.quantity),
          // Round to integer minor units: e.g. 19.99 * 100 === 1998.9999999999998
          // in floating point, which the backend (@IsInt) rejects.
          price: useCents ? Math.round(price * 100) || 0 : price,
          discount_amount: useCents ? Math.round(discountAmount * 100) || 0 : discountAmount,
          discount_percentage: Number(item.discount_percentage) || 0,
          taxExempt: exempt,
          taxExemptReason: exempt ? (item.taxExemptReason || '').trim() : '',
          ...(exempt && code && { taxExemptionCode: code }),
        };
      }),
    };
  };

  const handleSubmitForm = async (e) => {
    if (e) e.preventDefault();

    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    // Validate both form and line items in parallel
    if (!handleValidateAll()) {
      return;
    }

    try {
      setIsSubmitting(true);
      const payloadData = setSubmitPayload(true);

      if (id) {
        await InvoiceUpdateRequest(decodedToken, id, JSON.stringify(payloadData));
      } else {
        await InvoiceCreateRequest(decodedToken, JSON.stringify(payloadData));
      }

      showToast(id ? 'Invoice updated successfully!' : 'Invoice created successfully!', 'success');
      navigate('/invoices');
    } catch (err) {
      showToast(
        err?.message || (id ? 'Failed to update invoice' : 'Failed to create invoice'),
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleCreateInvoice = async () => {
    const payloadData = setSubmitPayload(true);
    const response = await InvoiceCreateRequest(decodedToken, JSON.stringify(payloadData));
    const createdInvoiceId =
      response?.data?._id ||
      response?._id ||
      response?.id;

    if (!createdInvoiceId) {
      throw new Error('Invoice created but ID was not returned from server');
    }

    return createdInvoiceId;
  };

  const handleUpdateInvoice = async () => {
    const payloadData = setSubmitPayload(true);
    await InvoiceUpdateRequest(decodedToken, id, JSON.stringify(payloadData));
    return id;
  };

  const handleSubmitToZatca = async (invoiceId) => {
    const targetId = invoiceId || id;
    if (!targetId) {
      throw new Error('Invoice ID is required to submit to ZATCA');
    }
    await InvoiceSubmitToZatcaRequest(decodedToken, targetId);
    return targetId;
  };

  const handleCheckCompliance = async () => {
    if (!id) return;

    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    try {
      setIsSubmitting(true);
      await InvoiceCheckComplianceRequest(decodedToken, id);
      showToast('Invoice compliance check queued successfully!', 'success');
    } catch (error) {
      showToast(error?.message || 'Failed to queue invoice compliance check', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintInvoice = async () => {
    if (!id) return;

    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    try {
      setIsSubmitting(true);
      const pdfBlob = await InvoicePdfDownloadRequest(decodedToken, id);
      const fileURL = window.URL.createObjectURL(pdfBlob);
      const pdfWindow = window.open(fileURL, '_blank');

      if (!pdfWindow) {
        showToast('Please allow popups to view the invoice PDF', 'error');
      } else {
        showToast('Invoice PDF opened in a new tab', 'success');
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(fileURL);
      }, 10000);
    } catch (error) {
      showToast(error?.message || 'Failed to download invoice PDF', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateAndSubmitToZatca = async () => {
    if (!id) return;

    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    if (!handleValidateAll()) {
      return;
    }

    try {
      setIsSubmitting(true);
      await handleUpdateInvoice();
      await handleSubmitToZatca(id);
      showToast('Invoice updated and submitted to ZATCA successfully!', 'success');
      navigate('/invoices');
    } catch (error) {
      showToast(error?.message || 'Failed to update and submit invoice to ZATCA', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAndSubmitToZatca = async () => {
    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    if (!handleValidateAll()) {
      return;
    }

    try {
      setIsSubmitting(true);
      const createdInvoiceId = await handleCreateInvoice();
      await handleSubmitToZatca(createdInvoiceId);
      showToast('Invoice created and submitted to ZATCA successfully!', 'success');
      navigate('/invoices');
    } catch (error) {
      showToast(error?.message || 'Failed to create and submit invoice to ZATCA', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateAndPrintInvoice = async () => {
    if (!id) return;

    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    if (!handleValidateAll()) {
      return;
    }

    try {
      setIsSubmitting(true);
      await handleUpdateInvoice();
      const pdfBlob = await InvoicePdfDownloadRequest(decodedToken, id);
      const fileURL = window.URL.createObjectURL(pdfBlob);
      const pdfWindow = window.open(fileURL, '_blank');

      if (!pdfWindow) {
        showToast('Please allow popups to view the invoice PDF', 'error');
      } else {
        showToast('Invoice updated and PDF opened in a new tab', 'success');
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(fileURL);
      }, 10000);
    } catch (error) {
      showToast(error?.message || 'Failed to update invoice and download PDF', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAndPrintInvoice = async () => {
    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    if (!handleValidateAll()) {
      return;
    }

    try {
      setIsSubmitting(true);
      const createdInvoiceId = await handleCreateInvoice();
      const pdfBlob = await InvoicePdfDownloadRequest(decodedToken, createdInvoiceId);
      const fileURL = window.URL.createObjectURL(pdfBlob);
      const pdfWindow = window.open(fileURL, '_blank');

      if (!pdfWindow) {
        showToast('Please allow popups to view the invoice PDF', 'error');
      } else {
        showToast('Invoice created and PDF opened in a new tab', 'success');
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(fileURL);
      }, 10000);
    } catch (error) {
      showToast(error?.message || 'Failed to create invoice and download PDF', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintProformaInvoice = async () => {
    if (!id) return;

    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    try {
      setIsSubmitting(true);
      const pdfBlob = await InvoiceProformaPdfDownloadRequest(decodedToken, id);
      const fileURL = window.URL.createObjectURL(pdfBlob);
      const pdfWindow = window.open(fileURL, '_blank');

      if (!pdfWindow) {
        showToast('Please allow popups to view the proforma invoice PDF', 'error');
      } else {
        showToast('Proforma invoice PDF opened in a new tab', 'success');
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(fileURL);
      }, 10000);
    } catch (error) {
      showToast(error?.message || 'Failed to download proforma invoice PDF', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateAndPrintProformaInvoice = async () => {
    if (!id) return;

    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    if (!handleValidateAll()) {
      return;
    }

    try {
      setIsSubmitting(true);
      await handleUpdateInvoice();
      const pdfBlob = await InvoiceProformaPdfDownloadRequest(decodedToken, id);
      const fileURL = window.URL.createObjectURL(pdfBlob);
      const pdfWindow = window.open(fileURL, '_blank');

      if (!pdfWindow) {
        showToast('Please allow popups to view the proforma invoice PDF', 'error');
      } else {
        showToast('Invoice updated and proforma PDF opened in a new tab', 'success');
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(fileURL);
      }, 10000);
    } catch (error) {
      showToast(error?.message || 'Failed to update invoice and download proforma PDF', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAndPrintProformaInvoice = async () => {
    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    if (!handleValidateAll()) {
      return;
    }

    try {
      setIsSubmitting(true);
      const createdInvoiceId = await handleCreateInvoice();
      const pdfBlob = await InvoiceProformaPdfDownloadRequest(decodedToken, createdInvoiceId);
      const fileURL = window.URL.createObjectURL(pdfBlob);
      const pdfWindow = window.open(fileURL, '_blank');

      if (!pdfWindow) {
        showToast('Please allow popups to view the proforma invoice PDF', 'error');
      } else {
        showToast('Invoice created and proforma PDF opened in a new tab', 'success');
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(fileURL);
      }, 10000);
    } catch (error) {
      showToast(error?.message || 'Failed to create invoice and download proforma PDF', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateAndCheckCompliance = async () => {
    if (!id) return;

    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    if (!handleValidateAll()) {
      return;
    }

    try {
      setIsSubmitting(true);
      await handleUpdateInvoice();
      await InvoiceCheckComplianceRequest(decodedToken, id);
      showToast('Invoice updated and compliance check queued successfully!', 'success');
    } catch (error) {
      showToast(
        error?.message || 'Failed to update invoice and queue compliance check',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAndCheckCompliance = async () => {
    if (isSubmitting) {
      showToast('Please wait for the previous request to complete', 'error');
      return;
    }

    if (!handleValidateAll()) {
      return;
    }

    try {
      setIsSubmitting(true);
      const createdInvoiceId = await handleCreateInvoice();
      await InvoiceCheckComplianceRequest(decodedToken, createdInvoiceId);
      showToast('Invoice created and compliance check queued successfully!', 'success');
    } catch (error) {
      showToast(
        error?.message || 'Failed to create invoice and queue compliance check',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // const handleCreateAndSubmitToZatca = async () => {
  //   if (isLoading) {
  //     showToast('Please wait for the previous request to complete', 'error');
  //     return;
  //   }

  //   // Validate both form and line items in parallel
  //   if (!handleValidateAll()) {
  //     return;
  //   }

  //   try {
  //     _isLoading(true);
  //     const payloadData = setSubmitPayload(true);
  //     const response = await InvoiceCreateRequest(decodedToken, JSON.stringify(payloadData));
  //     const createdInvoiceId =
  //       response?.data?._id ||
  //       response?._id ||
  //       response?.id;

  //     if (!createdInvoiceId) {
  //       throw new Error('Invoice created but ID was not returned from server');
  //     }

  //     await InvoiceSubmitToZatcaRequest(decodedToken, createdInvoiceId);
  //     showToast('Invoice created and submitted to ZATCA successfully!', 'success');
  //     navigate('/invoices');
  //   } catch (error) {
  //     showToast(error?.message || 'Failed to create and submit invoice to ZATCA', 'error');
  //   } finally {
  //     _isLoading(false);
  //   }
  // };

  // const handleUpdateAndSubmitToZatca = async () => {
  //   if (isLoading) {
  //     showToast('Please wait for the previous request to complete', 'error');
  //     return;
  //   }

  //   // Validate both form and line items in parallel
  //   if (!handleValidateAll()) {
  //     return;
  //   }

  //   try {
  //     _isLoading(true);
  //     const payloadData = setSubmitPayload(true);
  //     await InvoiceUpdateRequest(decodedToken, id, JSON.stringify(payloadData));
  //     await InvoiceSubmitToZatcaRequest(decodedToken, id);
  //     showToast('Invoice updated and submitted to ZATCA successfully!', 'success');
  //     navigate('/invoices');
  //   } catch (error) {
  //     showToast(error?.message || 'Failed to update and submit invoice to ZATCA', 'error');
  //   } finally {
  //     _isLoading(false);
  //   }
  // };

  const handleAddLineItem = () => {
    _lineItems((old) => [...old, { ...INITIAL_LINE_ITEM }]);
  };


  // const handleUpdateAndPrintPdf = async () => {
  //   if (!id) return;

  //   if (isLoading) {
  //     showToast('Please wait for the previous request to complete', 'error');
  //     return;
  //   }

  //   if (!handleValidateAll()) {
  //     return;
  //   }

  //   try {
  //     _isLoading(true);
  //     const payloadData = setSubmitPayload(true);
  //     await InvoiceUpdateRequest(decodedToken, id, JSON.stringify(payloadData));
  //     const pdfBlob = await InvoicePdfDownloadRequest(decodedToken, id);
  //     const fileURL = window.URL.createObjectURL(pdfBlob);
  //     const pdfWindow = window.open(fileURL, '_blank');

  //     if (!pdfWindow) {
  //       showToast('Please allow popups to view the invoice PDF', 'error');
  //     } else {
  //       showToast('Invoice updated and PDF opened in a new tab', 'success');
  //     }

  //     setTimeout(() => {
  //       window.URL.revokeObjectURL(fileURL);
  //     }, 10000);
  //   } catch (error) {
  //     showToast(error?.message || 'Failed to update invoice and download PDF', 'error');
  //   } finally {
  //     _isLoading(false);
  //   }
  // };

  // const handleCreateAndPrintPdf = async () => {
  //   if (isLoading) {
  //     showToast('Please wait for the previous request to complete', 'error');
  //     return;
  //   }

  //   if (!handleValidateAll()) {
  //     return;
  //   }

  //   try {
  //     _isLoading(true);
  //     const payloadData = setSubmitPayload(true);
  //     const response = await InvoiceCreateRequest(decodedToken, JSON.stringify(payloadData));
  //     const createdInvoiceId =
  //       response?.data?._id ||
  //       response?._id ||
  //       response?.id;

  //     if (!createdInvoiceId) {
  //       throw new Error('Invoice created but ID was not returned from server');
  //     }

  //     const pdfBlob = await InvoicePdfDownloadRequest(decodedToken, createdInvoiceId);
  //     const fileURL = window.URL.createObjectURL(pdfBlob);
  //     const pdfWindow = window.open(fileURL, '_blank');

  //     if (!pdfWindow) {
  //       showToast('Please allow popups to view the invoice PDF', 'error');
  //     } else {
  //       showToast('Invoice created and PDF opened in a new tab', 'success');
  //     }

  //     setTimeout(() => {
  //       window.URL.revokeObjectURL(fileURL);
  //     }, 10000);
  //   } catch (error) {
  //     showToast(error?.message || 'Failed to create invoice and download PDF', 'error');
  //   } finally {
  //     _isLoading(false);
  //   }
  // };

  const handleFormatLineItemNumericValues = (field, value) => {
    if (value === '') return '';

    if (field === 'quantity') {
      // Whole numbers only: reject (rather than strip) anything else, so a
      // pasted "2.5" is not turned into 25.
      return /^\d*$/.test(value) ? value : null;
    }

    if (['price', 'discount_amount', 'discount_percentage'].includes(field)) {
      // Allow only digits and at most one decimal point
      let sanitized = value.replace(/[^\d.]/g, '');
      const parts = sanitized.split('.');

      if (parts.length > 2) {
        // More than one dot - keep only the first dot and digits
        sanitized = parts[0] + '.' + parts.slice(1).join('');
      }

      // Limit to 2 decimal places if there is a dot
      if (sanitized.includes('.')) {
        const [intPart, decimalPart] = sanitized.split('.');
        sanitized = `${intPart}.${decimalPart.slice(0, 2)}`;
      }

      // Cap discount_percentage at 100%
      if (field === 'discount_percentage') {
        const num = parseFloat(sanitized);
        if (!Number.isNaN(num) && num > 100) {
          sanitized = '100';
        }
      }

      return sanitized;
    }

    return value;
  };

  const handleChangeLineItem = (index, field, value) => {
    if (field === 'quantity' && quantityErrorLines.includes(index)) {
      _quantityErrorLines((old) => old.filter((i) => i !== index));
    }
    if (field === 'taxExemptionCode' || field === 'taxExempt') {
      // A code change can resolve problems spanning lines (e.g. mixed codes):
      // clear them all; they are re-checked on submit.
      _exemptionErrors({});
      _exemptionMessages([]);
    } else if (exemptionErrors[index]) {
      _exemptionErrors((old) => {
        const next = { ...old };
        delete next[index];
        return next;
      });
    }
    _lineItems((old) =>
      old.map((item, i) => {
        if (i !== index) return item;

        // Unticking "Tax exempt" hides and clears the exemption fields.
        if (field === 'taxExempt' && !value) {
          return { ...item, taxExempt: false, taxExemptionCode: '', taxExemptReason: '' };
        }
        // Choosing a code pre-fills the reason with its official text.
        if (field === 'taxExemptionCode') {
          return {
            ...item,
            taxExemptionCode: value,
            taxExemptReason: nextExemptionReason(exemptionCodes, lineExemptionCode(item), value, item.taxExemptReason),
          };
        }

        // A rejected quantity keystroke/paste leaves the line unchanged.
        if (field === 'quantity' && handleFormatLineItemNumericValues(field, value) === null) return item;

        // Format/Sanitize numeric values or use raw value for other fields
        const formattedValue = field === 'taxExempt'
          ? value
          : (field === 'quantity' || field === 'price' || field === 'discount_amount' || field === 'discount_percentage')
            ? handleFormatLineItemNumericValues(field, value)
            : value;

        // Discounts are per unit, so they depend on the unit price, not the quantity.
        const price = field === 'price'
          ? (formattedValue === '' ? 0 : Number(formattedValue) || 0)
          : (Number(item.price) || 0);

        // Work in integer cents for accurate 2-decimal math
        const priceCents = Math.round(price * 100);

        // Handle discount_amount change - percentage is based on unit price
        if (field === 'discount_amount') {
          const discountAmount = formattedValue;
          const discountAmountCents = Math.round((Number(discountAmount) || 0) * 100);
          const discountPercentage = priceCents > 0
            ? (discountAmountCents / priceCents) * 100
            : 0;
          return {
            ...item,
            discount_amount: discountAmount,
            discount_percentage: parseFloat(discountPercentage.toFixed(2)).toString() || '0',
          };
        }

        // Handle discount_percentage change - amount is based on unit price
        if (field === 'discount_percentage') {
          const discountPercentage = formattedValue;
          const discountPctNum = Math.min(Number(discountPercentage) || 0, 100);
          const discountAmountCents = priceCents > 0
            ? Math.round(priceCents * (discountPctNum / 100))
            : 0;
          const discountAmount = discountAmountCents / 100;
          return {
            ...item,
            discount_percentage: String(discountPctNum) === String(Number(discountPercentage) || 0) ? discountPercentage : String(discountPctNum),
            discount_amount: parseFloat(discountAmount.toFixed(2)).toString() || '0',
          };
        }

        // Handle quantity or price change - recalculate discount_amount from percentage based on new unit price
        if (field === 'quantity' || field === 'price') {
          const updatedItem = {
            ...item,
            [field]: formattedValue,
          };
          const currentDiscountPercentage = Number(item.discount_percentage) || 0;
          if (currentDiscountPercentage > 0) {
            const newPrice = field === 'price'
              ? (formattedValue === '' ? 0 : Number(formattedValue) || 0)
              : price;
            const newPriceCents = Math.round(newPrice * 100);
            const recalculatedDiscountAmountCents = newPriceCents > 0
              ? Math.round(newPriceCents * (currentDiscountPercentage / 100))
              : 0;
            updatedItem.discount_amount = parseFloat((recalculatedDiscountAmountCents / 100).toFixed(2)).toString() || '0';
          }
          return updatedItem;
        }

        // Default case - just update the field
        return {
          ...item,
          [field]: formattedValue,
        };
      })
    );
  };

  const handleRemoveLineItem = (index) => {
    _lineItems((old) => old.filter((_, i) => i !== index));
  };

  // *********** Render Functions ***********
  const PAGE_HEADER = () => (
    <div className="flex flex-wrap justify-between items-end gap-3 mb-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[#0d121b] dark:text-white text-3xl font-black leading-tight">
          {id ? 'Edit Invoice' : 'Create Invoice'}
        </h1>
        <p className="text-[#4c669a] dark:text-gray-400 text-base font-normal">
          {id ? 'Update and manage your compliant tax invoice.' : 'Create compliant tax invoices or bulk process via XML/PDF.'}
        </p>
      </div>
    </div>
  );

  const INVOICE_DETAILS_SECTION = () => (
    <section>
      <h3 className="text-[#0d121b] dark:text-white text-base font-bold mb-4 flex items-center gap-2">
        <span className="size-2 rounded-full bg-primary"></span> Invoice Details / تفاصيل الفاتورة
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Row 1 */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Invoice Number</label>
          <input
            name="invoiceNumber"
            type="text"
            disabled={true}
            value={formData.data.invoiceNumber}
            onChange={() => { }}
            // onChange={handleChangeFormData}
            placeholder="Auto-generated field"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
          />
          {formData.errors.invoiceNumber && (
            <span className="text-xs text-tomato">{formData.errors.invoiceNumber}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Invoice Type</label>
          <select
            name="invoiceType"
            value={formData.data.invoiceType || 'B2B'}
            onChange={handleChangeFormData}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white pr-8 text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors appearance-none dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
          >
            <option value="B2B">B2B</option>
            <option value="B2C">B2C</option>
            <option value="B2G">B2G</option>
            <option value="CREDIT_NOTE" disabled>CREDIT_NOTE</option>
            <option value="DEBIT_NOTE" disabled>DEBIT_NOTE</option>
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Reference Number *</label>
          <input
            name="referenceNumber"
            type="text"
            value={formData.data.referenceNumber}
            onChange={handleChangeFormData}
            placeholder="REF-00000"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
          />
          {formData.errors.referenceNumber && (
            <span className="text-xs text-tomato">{formData.errors.referenceNumber}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Payment Type</label>
          <select
            name="paymentType"
            value={formData.data.paymentType}
            onChange={handleChangeFormData}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white pr-8 text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors appearance-none dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
          >
            <option value="">Select payment type...</option>
            <option value="CASH">CASH</option>
            <option value="CREDIT_CARD">CREDIT CARD</option>
            <option value="BANK_TRANSFER">BANK TRANSFER</option>
            <option value="CHECK">CHECK</option>
            <option value="BANK_CARD">BANK CARD</option>
          </select>
          {formData.errors.paymentType && (
            <span className="text-xs text-tomato">{formData.errors.paymentType}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Payment Terms *</label>
          <input
            name="paymentTerms"
            type="text"
            value={formData.data.paymentTerms}
            onChange={handleChangeFormData}
            placeholder="e.g. Net 30"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
          />
          {formData.errors.paymentTerms && (
            <span className="text-xs text-tomato">{formData.errors.paymentTerms}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Delivery Date</label>
          <input
            name="deliveryDate"
            type="date"
            value={formData.data.deliveryDate}
            onChange={handleChangeFormData}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="invoice-currency" className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Currency</label>
          <select
            id="invoice-currency"
            name="currency"
            value={currencyCode}
            onChange={handleCurrencyChange}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white pr-8 text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors appearance-none dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
          >
            {currencyOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name ? `${c.code} — ${c.name}` : c.code}
              </option>
            ))}
          </select>
        </div>

        {isForeignCurrency && (
          <div className="flex flex-col gap-2">
            <label htmlFor="invoice-exchange-rate" className="text-xs font-bold text-[#4c669a] dark:text-gray-400">
              Exchange Rate (SAR per 1 {currencyCode}) *
            </label>
            <input
              id="invoice-exchange-rate"
              name="exchangeRate"
              type="number"
              min="0"
              step="0.000001"
              inputMode="decimal"
              value={formData.data.exchangeRate}
              onChange={handleChangeFormData}
              placeholder="e.g. 3.75"
              className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
            />
            {formData.errors.exchangeRate && (
              <span className="text-xs text-tomato">{formData.errors.exchangeRate}</span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Note</label>
          <input
            name="note"
            type="text"
            value={formData.data.note}
            onChange={handleChangeFormData}
            placeholder="Internal note"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">VAT (%) *</label>
          <input
            name="vat"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={formData.data.vat}
            onChange={handleChangeFormData}
            placeholder="15"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white"
          />
          {formData.errors.vat && (
            <span className="text-xs text-tomato">{formData.errors.vat}</span>
          )}
        </div>
      </div>
    </section>
  );

  const BUYER_INFO_SECTION = () => (
    <section>
      <h3 className="text-[#0d121b] dark:text-white text-base font-bold mb-4 flex items-center gap-2">
        <span className="size-2 rounded-full bg-primary"></span> Buyer Information / معلومات المشتري
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Registered Name (AsyncSelect) */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Registered Name *</label>
          <AsyncSelect
            cacheOptions
            defaultOptions
            loadOptions={loadCustomerOptions}
            onChange={handleCustomerChange}
            value={
              formData.data.registrationName
                ? { label: formData.data.registrationName, value: formData.data.registrationName }
                : null
            }
            placeholder="Select or search customer..."
            classNames={{
              control: (state) =>
                `!px-2 !py-0.5 !rounded-lg !border !bg-white dark:!bg-[#161f30] !shadow-none hover:!border-primary focus:!border-primary !transition-colors ${state.isFocused ? '!border-primary !ring-1 !ring-primary' : '!border-[#e7ebf3] dark:!border-[#2a3447]'
                }`,
              menu: () => '!bg-white dark:!bg-[#161f30] !border !border-[#e7ebf3] dark:!border-[#2a3447] !rounded-lg !shadow-lg !mt-1 !z-50',
              option: (state) =>
                `!px-4 !py-2 !cursor-pointer !text-sm ${state.isSelected
                  ? '!bg-primary !text-white'
                  : state.isFocused
                    ? '!bg-gray-50 dark:!bg-gray-800 !text-[#0d121b] dark:!text-white'
                    : '!text-[#0d121b] dark:!text-white'
                }`,
              input: () => '!text-sm !text-[#0d121b] dark:!text-white',
              singleValue: () => '!text-sm !text-[#0d121b] dark:!text-white',
              placeholder: () => '!text-sm !text-[#4c669a]',
            }}
          />
          {formData.errors.customerId && (
            <span className="text-xs text-tomato">{formData.errors.customerId}</span>
          )}
        </div>

        {/* Email */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Email</label>
          <input
            name="email"
            type="email"
            value={formData.data.email}
            onChange={handleChangeFormData}
            placeholder="customer@example.com"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
          {formData.errors.email && (
            <span className="text-xs text-tomato">{formData.errors.email}</span>
          )}
        </div>

        {/* Phone */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Phone</label>
          <input
            name="phone"
            type="text"
            value={formData.data.phone}
            onChange={handleChangeFormData}
            placeholder="+966 11 234 5678"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* Customer Type (read-only — managed on the customer record) */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Customer Type</label>
          <input
            name="customerType"
            type="text"
            value={formData.data.customerType === 'international' ? 'International (Outside KSA)' : 'Domestic (Saudi Arabia)'}
            disabled
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* VAT (domestic buyers) */}
        {formData.data.customerType !== 'international' && (
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Customer VAT</label>
            <input
              name="customerVAT"
              type="text"
              value={formData.data.customerVAT}
              onChange={handleChangeFormData}
              placeholder="300000000000003"
              disabled={!!formData.data.customerId}
              className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
            />
          </div>
        )}

        {/* Other Buyer ID (international buyers) */}
        {formData.data.customerType === 'international' && (
          <Fragment>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Identification Type</label>
              <input
                name="identificationScheme"
                type="text"
                value={formData.data.identificationScheme}
                disabled
                className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Identification Number</label>
              <input
                name="identificationId"
                type="text"
                value={formData.data.identificationId}
                disabled
                className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
              />
            </div>
          </Fragment>
        )}

        {/* Registration Name Arabic */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Registered Name (AR)</label>
          <input
            name="registrationNameAr"
            type="text"
            value={formData.data.registrationNameAr}
            onChange={handleChangeFormData}
            placeholder="شركة أكمي"
            dir="rtl"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* Street Name */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Street Name</label>
          <input
            name="streetName"
            type="text"
            value={formData.data.streetName}
            onChange={handleChangeFormData}
            placeholder="Prince Sultan Street"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* Street Name Arabic */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Street Name (AR)</label>
          <input
            name="streetNameAr"
            type="text"
            value={formData.data.streetNameAr}
            onChange={handleChangeFormData}
            placeholder="شارع الأمير سلطان"
            dir="rtl"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* Address */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Address</label>
          <input
            name="address"
            type="text"
            value={formData.data.address}
            onChange={handleChangeFormData}
            placeholder="Building 1234, Prince Sultan Street, Riyadh"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* Address Arabic */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Address (AR)</label>
          <input
            name="addressAr"
            type="text"
            value={formData.data.addressAr}
            onChange={handleChangeFormData}
            placeholder="مبنى 1234، شارع الأمير سلطان، الرياض"
            dir="rtl"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* Building Number */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Building Number</label>
          <input
            name="buildingNumber"
            type="text"
            value={formData.data.buildingNumber}
            onChange={handleChangeFormData}
            placeholder="1234"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* City Subdivision */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">District</label>
          <input
            name="citySubdivisionName"
            type="text"
            value={formData.data.citySubdivisionName}
            onChange={handleChangeFormData}
            placeholder="District 5"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* City Subdivision Arabic */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">District (AR)</label>
          <input
            name="citySubdivisionNameAr"
            type="text"
            value={formData.data.citySubdivisionNameAr}
            onChange={handleChangeFormData}
            placeholder="الحي الخامس"
            dir="rtl"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* City Name */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">City</label>
          <input
            name="cityName"
            type="text"
            value={formData.data.cityName}
            onChange={handleChangeFormData}
            placeholder="Riyadh"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* City Name Arabic */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">City (AR)</label>
          <input
            name="cityNameAr"
            type="text"
            value={formData.data.cityNameAr}
            onChange={handleChangeFormData}
            placeholder="الرياض"
            dir="rtl"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* Postal Zone */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Postal Zone</label>
          <input
            name="postalZone"
            type="text"
            value={formData.data.postalZone}
            onChange={handleChangeFormData}
            placeholder="12345"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>

        {/* Country Code */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400">Country Code</label>
          <input
            name="countryCode"
            type="text"
            value={formData.data.countryCode}
            onChange={handleChangeFormData}
            placeholder="SA"
            disabled={!!formData.data.customerId}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white disabled:bg-gray-50 dark:disabled:bg-[#0a0e1a] disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>
      </div>
    </section>
  );


  const LINE_ITEMS_SECTION = () => {
    const calculateTotal = (item) => {
      return getItemNetTotal(item).toFixed(2);
    };

    return (
      <section>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-[#0d121b] dark:text-white text-base font-bold flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary"></span> Line Items / الأصناف
          </h3>
          <button
            type="button"
            onClick={handleAddLineItem}
            className="text-primary text-xs font-bold flex items-center gap-1 hover:underline"
          >
            + Add Item
          </button>
        </div>
        <div className="border border-[#e7ebf3] dark:border-[#2a3447] rounded-lg overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#f5f6f8] dark:bg-[#161f30] text-[#4c669a] dark:text-gray-400 font-bold uppercase text-[10px]">
              <tr>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 w-28">Product Code</th>
                <th className="px-4 py-3 w-24">Qty</th>
                <th className="px-4 py-3 w-28">Price ({currencyCode})</th>
                <th className="px-4 py-3 w-28" title="Discount per unit">Disc./Unit</th>
                <th className="px-4 py-3 w-24">Disc. %</th>
                <th className="px-4 py-3 w-24">Tax Exempt</th>
                <th className="px-4 py-3 min-w-[16rem]">Exemption Code / Reason</th>
                <th className="px-4 py-3 w-28 text-right">Total</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e7ebf3] dark:divide-[#2a3447] dark:text-white">
              {lineItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400 italic">
                    No line items added. Click "Add Item" to add one.
                  </td>
                </tr>
              ) : (
                lineItems.map((item, index) => (
                  <tr key={index}>
                    <td className="px-4 py-3">
                      <input
                        className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 dark:text-white"
                        type="text"
                        value={item.description}
                        onChange={(e) =>
                          handleChangeLineItem(index, 'description', e.target.value)
                        }
                        placeholder="Description of product..."
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 dark:text-white"
                        type="text"
                        value={item.productCode}
                        onChange={(e) =>
                          handleChangeLineItem(index, 'productCode', e.target.value)
                        }
                        placeholder="Product Code"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        aria-label={`Quantity, line ${index + 1}`}
                        // No up/down spinner: in this narrow column it covered the digits and
                        // a click on it silently changed the quantity.
                        className={`w-full min-w-[4.5rem] bg-transparent p-0 text-sm focus:ring-0 dark:text-white [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${quantityErrorLines.includes(index) ? 'border border-tomato rounded px-1' : 'border-none'}`}
                        type="number"
                        min="1"
                        max={MAX_LINE_QUANTITY}
                        step="1"
                        inputMode="numeric"
                        value={item.quantity}
                        onKeyDown={(e) => {
                          if (NON_INTEGER_KEYS.includes(e.key)) e.preventDefault();
                        }}
                        onChange={(e) => handleChangeLineItem(index, 'quantity', e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 dark:text-white"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.price}
                        onChange={(e) =>
                          handleChangeLineItem(index, 'price', e.target.value)
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 dark:text-white"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.discount_amount}
                        onChange={(e) =>
                          handleChangeLineItem(index, 'discount_amount', e.target.value)
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 dark:text-white"
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={item.discount_percentage}
                        onChange={(e) =>
                          handleChangeLineItem(index, 'discount_percentage', e.target.value)
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isLineExempt(item)}
                        disabled={vatIsZero}
                        title={vatIsZero ? 'VAT is 0%: every line is tax exempt' : undefined}
                        onChange={(e) =>
                          handleChangeLineItem(index, 'taxExempt', e.target.checked)
                        }
                        className="w-4 h-4 rounded border-[#e7ebf3] dark:border-[#2a3447] text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </td>
                    <td className="px-4 py-3 align-top">
                      {isLineExempt(item) && (
                        <div className="flex flex-col gap-1.5 min-w-[16rem]">
                          <select
                            aria-label={`Exemption code, line ${index + 1}`}
                            value={lineExemptionCode(item)}
                            onChange={(e) => handleChangeLineItem(index, 'taxExemptionCode', e.target.value)}
                            className={`w-full rounded border px-2 py-1 text-xs bg-white dark:bg-[#161f30] dark:text-white ${exemptionErrors[index]?.taxExemptionCode ? 'border-tomato' : 'border-[#e7ebf3] dark:border-[#2a3447]'}`}
                          >
                            <option value="">Select exemption code…</option>
                            {groupExemptionCodes(exemptionCodes).map((group) => (
                              <optgroup key={group.category} label={group.label}>
                                {group.codes.map((c) => (
                                  <option key={c.code} value={c.code}>
                                    {c.code} — {c.description}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          {exemptionErrors[index]?.taxExemptionCode && (
                            <span className="text-[11px] text-tomato">{exemptionErrors[index].taxExemptionCode}</span>
                          )}
                          <input
                            aria-label={`Exemption reason, line ${index + 1}`}
                            type="text"
                            value={item.taxExemptReason}
                            onChange={(e) => handleChangeLineItem(index, 'taxExemptReason', e.target.value)}
                            placeholder={lineExemptionCode(item) === OUT_OF_SCOPE_CODE ? 'Why is this out of scope?' : 'Exemption reason'}
                            className={`w-full rounded border px-2 py-1 text-xs bg-transparent dark:text-white ${exemptionErrors[index]?.taxExemptReason ? 'border-tomato' : 'border-[#e7ebf3] dark:border-[#2a3447]'}`}
                          />
                          {exemptionErrors[index]?.taxExemptReason && (
                            <span className="text-[11px] text-tomato">{exemptionErrors[index].taxExemptReason}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      {calculateTotal(item)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleRemoveLineItem(index)}
                        className="text-red-500 hover:text-red-700 dark:hover:text-red-400"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {formData.errors.lineItems && (
          <span className="text-xs text-tomato mt-2 block">{formData.errors.lineItems}</span>
        )}
        {quantityMessage && (
          <span className="text-xs text-tomato mt-2 block" data-testid="quantity-message">{quantityMessage}</span>
        )}
        {exemptionMessages.length > 0 && (
          <ul className="mt-2 space-y-1" data-testid="exemption-messages">
            {exemptionMessages.map((message) => (
              <li key={message} className="text-xs text-tomato">{message}</li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  const FORM_CONTENT = () => (
    <form
      className="p-6 space-y-8 max-h-[calc(100vh-320px)] overflow-y-auto"
      onSubmit={handleSubmitForm}
    >
      {INVOICE_DETAILS_SECTION()}
      {BUYER_INFO_SECTION()}
      {LINE_ITEMS_SECTION()}
    </form>
  );


  const FOOTER_ACTION_BAR = () => {
    const isDraftOrNew = !id || formData.data.status === 'DRAFT' || formData.data.status === '';
    const zatcaXmlOptions = hasZatcaXml ? [{ value: 'view-zatca-xml', label: 'View ZATCA XML' }] : [];

    const editModeOptions = [
      { value: 'create', label: id ? 'Update' : 'Create' },
      ...(canCheckComplianceAction
        ? [
          {
            value: 'create-check-compliance',
            label: id ? 'Update and Check Compliance' : 'Create and Check Compliance',
          },
        ]
        : []),
      ...(canSubmitToZatca
        ? [
          {
            value: 'create-report-zatca',
            label: id ? 'Update and Report to ZATCA' : 'Create and Report to ZATCA',
          },
        ]
        : []),
      {
        value: 'print-report-pdf',
        label: id ? 'Update and Print Pdf' : 'Create and Print Pdf',
      },
      ...(isDraftOrNew
        ? [
          {
            value: 'print-proforma-pdf',
            label: id ? 'Update and Print Proforma' : 'Create and Print Proforma',
          },
        ]
        : []),
      ...zatcaXmlOptions,
      { value: 'cancel', label: 'Cancel' },
    ];
    const viewModeOptions = [
      { value: 'print-report-pdf', label: 'Print Pdf' },
      ...(isDraftOrNew
        ? [{ value: 'print-proforma-pdf', label: 'Print Proforma' }]
        : []),
      ...(canCheckComplianceAction
        ? [{ value: 'check-compliance', label: 'Check Compliance' }]
        : []),
      ...zatcaXmlOptions,
      { value: 'cancel', label: 'Cancel' },
    ];
    const actionOptions = canEditInvoice ? editModeOptions : viewModeOptions;

    return (
      <Fragment>
        <div className="bg-[#f5f6f8] dark:bg-[#0a0e1a] border-t border-[#e7ebf3] dark:border-[#2a3447] p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex gap-8">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-[#4c669a] uppercase">Subtotal</span>
                <span className="text-lg font-bold dark:text-white">{totals.subtotal} {currencyCode}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-primary uppercase">VAT ({formData.data.vat}%)</span>
                <span className="text-lg font-bold dark:text-white">{totals.vatAmount} {currencyCode}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-[#0d121b] dark:text-gray-300 uppercase">Grand Total</span>
                <span className="text-2xl font-black text-primary">{totals.grandTotal} {currencyCode}</span>
              </div>
            </div>

            {/* Actions Select (react-select, text remains 'Actions') */}
            <div className="w-full md:w-80">
              <label className="sr-only">Invoice actions</label>
              <div className="relative">
                <Select
                  instanceId="invoice-actions"
                  placeholder="Actions"
                  isSearchable={false}
                  isClearable={false}
                  value={null}
                  onChange={(option) => {
                    if (!option) return;

                    else if (option.value === 'cancel') {
                      navigate('/invoices');
                      return;
                    }
                    else if (option.value === 'create-report-zatca') {
                      if (id) {
                        handleUpdateAndSubmitToZatca();
                      } else {
                        handleCreateAndSubmitToZatca();
                      }
                      return;
                    }
                    else if (option.value === 'create-check-compliance') {
                      if (id) {
                        handleUpdateAndCheckCompliance();
                      } else {
                        handleCreateAndCheckCompliance();
                      }
                      return;
                    }
                    else if (option.value === 'print-report-pdf') {
                      if (id) {
                        if (canEditInvoice) {
                          handleUpdateAndPrintInvoice();
                        } else {
                          handlePrintInvoice();
                        }
                      } else {
                        handleCreateAndPrintInvoice();
                      }
                      return;
                    }
                    else if (option.value === 'print-proforma-pdf') {
                      if (id) {
                        if (canEditInvoice) {
                          handleUpdateAndPrintProformaInvoice();
                        } else {
                          handlePrintProformaInvoice();
                        }
                      } else {
                        handleCreateAndPrintProformaInvoice();
                      }
                      return;
                    }
                    else if (option.value === 'check-compliance') {
                      handleCheckCompliance();
                      return;
                    }
                    else if (option.value === 'view-zatca-xml') {
                      _isXmlViewerOpen(true);
                      return;
                    }
                    else {
                      handleSubmitForm();
                    }
                  }}
                  isDisabled={isSubmitting || invoiceData?.isError}
                  options={actionOptions}
                  classNamePrefix="react-select"
                  className="react-select-container"
                  styles={{
                    control: (base, state) => ({
                      ...base,
                      minHeight: '2.5rem',
                      borderRadius: '0.5rem',
                      borderColor: '#2563eb',
                      boxShadow: state.isFocused ? '0 0 0 2px rgba(37, 99, 235, 0.4)' : 'none',
                      '&:hover': { borderColor: '#2563eb' },
                      backgroundColor: 'transparent',
                    }),
                    placeholder: (base) => ({
                      ...base,
                      fontWeight: 700,
                      fontSize: '0.875rem',
                      color: '#2563eb',
                    }),
                    singleValue: (base) => ({
                      ...base,
                      fontWeight: 700,
                      fontSize: '0.875rem',
                      color: '#2563eb',
                    }),
                    menu: (base) => ({
                      ...base,
                      zIndex: 30,
                      minWidth: '20rem',
                    }),
                    option: (base, state) => ({
                      ...base,
                      color:
                        state.data.value === 'cancel'
                          ? '#f87171' // Tailwind red-400
                          : base.color,
                    }),
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-[11px] text-[#4c669a] dark:text-gray-400 bg-white/50 dark:bg-black/20 p-2 rounded border border-dashed border-[#e7ebf3] dark:border-[#2a3447]">
          <span className="material-symbols-outlined text-[16px]">info</span>
          Validation required before submission. Fields must match Phase 2 technical specifications.
        </div>
        {isXmlViewerOpen && (
          <ZatcaXmlViewer invoiceId={id} invoiceNumber={formData.data.invoiceNumber} onClose={handleCloseXmlViewer} />
        )}
      </Fragment>
    );
  };

  const MANUAL_ENTRY_FORM = () => (
    <div className="bg-white dark:bg-[#161f30] rounded-xl border border-[#e7ebf3] dark:border-[#2a3447]">
      {FORM_CONTENT()}
      {FOOTER_ACTION_BAR()}
    </div>
  );

  const MAIN_GRID = () => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <div className="lg:col-span-12">
        {MANUAL_ENTRY_FORM()}
      </div>
    </div>
  );

  const MAIN_CONTENT = () => (
    <div className="p-8 space-y-8">
      {PAGE_HEADER()}
      {MAIN_GRID()}
    </div>
  );

  const CONTENT = () => (
    <Fragment>
      {MAIN_CONTENT()}
      <Footer />
    </Fragment>
  );

  return (
    <div>
      {CONTENT()}
    </div>
  );
}

export default InvoiceForm;
