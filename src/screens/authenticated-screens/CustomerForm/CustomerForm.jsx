// Packages
import { Fragment, useState, use, useMemo, useEffect, Suspense } from 'react';
import AsyncSelect from 'react-select/async';
import { ErrorBoundary } from 'react-error-boundary';
import { useNavigate, useParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';

// APIs
import { CustomerCreateRequest, CustomerDetailRequest, CustomerUpdateRequest, CustomerProfileListRequest } from '../../../requests';

// Utils
import { auth, loginInfo } from '../../../atoms';
import { Footer, ErrorFallback } from '../../../components';
import { showToast, validateSubmissionData, decodeString, parseLoginInfo, getNormalizedModulePermissions } from '../../../utils';

const INITIAL_FORM_DATA = {
  data: {
    customerType: 'domestic',
    registrationName: '',
    registrationNameAr: '',
    email: '',
    phone: '',
    customerVAT: '',
    identificationScheme: 'OTH',
    identificationId: '',
    address: '',
    addressAr: '',
    streetName: '',
    streetNameAr: '',
    buildingNumber: '',
    citySubDivisionName: '',
    citySubDivisionNameAr: '',
    cityName: '',
    cityNameAr: '',
    postalZone: '',
    countryCode: '',
    customerProfileId: ''
  },
  validations: {
    streetName: { isRequired: true, label: 'Street Name' },
    streetNameAr: { isRequired: true, label: 'Street Name (Arabic)' },
    address: { isRequired: true, label: 'Full Address' },
    addressAr: { isRequired: true, label: 'Full Address (Arabic)' },
    buildingNumber: { isRequired: true, label: 'Building Number', regex: /^\d{4}$/ },
    cityName: { isRequired: true, label: 'City Name' },
    cityNameAr: { isRequired: true, label: 'City Name (Arabic)' },
    postalZone: { isRequired: true, regex: /^\d{5}$/, label: 'Postal Zone' },
    countryCode: { isRequired: true, exact: 2, label: 'Country Code' },
    registrationName: { isRequired: true, label: 'Registered Name' },
    registrationNameAr: { isRequired: true, label: 'Registered Name (Arabic)' },
    email: {
      isRequired: true,
      regex: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
      label: 'Email',
    },
    customerVAT: {
      isRequired: true,
      label: 'Customer VAT',
      regex: /^3\d{13}3$/,
    },
  },
  errors: {},
};

// ZATCA Other Buyer ID (BT-46) schemes offered for international customers.
// OTH is preselected — ZATCA requires OTH for buyers outside KSA, even when
// the buyer supplies a foreign VAT/CR number.
const IDENTIFICATION_SCHEME_OPTIONS = [
  { value: 'OTH', label: 'Other ID (OTH)' },
  { value: 'NAT', label: 'National ID (NAT)' },
  { value: 'IQA', label: 'Iqama Number (IQA)' },
  { value: 'PAS', label: 'Passport (PAS)' },
  { value: 'GCC', label: 'GCC ID (GCC)' },
  { value: 'TIN', label: 'Tax Identification Number (TIN)' },
];

// Format checks per ZATCA BR-KSA-F-10.
const IDENTIFICATION_ID_PATTERNS = {
  TIN: { regex: /^3\d{9}$/, hint: '10 digits starting with 3' },
  NAT: { regex: /^1\d{9}$/, hint: '10 digits starting with 1' },
  IQA: { regex: /^2\d{9}$/, hint: '10 digits starting with 2' },
  PAS: { regex: /^[A-Za-z0-9]+$/, hint: 'alphanumeric, no spaces or symbols' },
  GCC: { regex: /^[A-Za-z0-9]+$/, hint: 'alphanumeric, no spaces or symbols' },
  OTH: { regex: /^[A-Za-z0-9]+$/, hint: 'alphanumeric, no spaces or symbols' },
};

/**
 * Validation rules depend on the customer type: domestic customers keep the
 * KSA rules (VAT, 4-digit building number, 5-digit postal zone); per ZATCA
 * BR-KSA-10 international customers only need street, city and country code,
 * plus a scheme + identification ID pair instead of VAT.
 */
const getValidations = (customerType, identificationScheme) => {
  const base = { ...INITIAL_FORM_DATA.validations };
  if (customerType !== 'international') return base;

  const { customerVAT, ...rest } = base;
  const scheme = IDENTIFICATION_ID_PATTERNS[identificationScheme] || IDENTIFICATION_ID_PATTERNS.OTH;
  return {
    ...rest,
    buildingNumber: { label: 'Building Number' },
    postalZone: { label: 'Postal Zone' },
    identificationId: {
      isRequired: true,
      regex: scheme.regex,
      label: `Identification Number (${scheme.hint})`,
    },
  };
};

function CustomerForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const decodedToken = useMemo(() => decodeString(authValue), [authValue]);

  const customerPromise = useMemo(() => {
    if (id) {
      return CustomerDetailRequest(decodedToken, id).catch((err) => {
        console.error('Failed to fetch customer details:', err);
        return { data: null, isError: true };
      });
    }
    return null;
  }, [id, decodedToken]);

  // *********** Render Functions ***********
  const CONTENT = () => (
    <Fragment>
      <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
        <Suspense fallback={
          <div className="p-8 flex items-center justify-center">
            <div className="flex items-center gap-2 text-[#4c669a]">
              <span className="material-symbols-outlined animate-spin">sync</span>
              Loading customer details...
            </div>
          </div>
        }>
          <CustomerFormContent
            id={id}
            customerPromise={customerPromise}
            decodedToken={decodedToken}
            navigate={navigate}
          />
        </Suspense>
      </ErrorBoundary>
    </Fragment>
  );

  return (
    <div id="customer-form">
      {CONTENT()}
    </div>
  );
}

function CustomerFormContent({ id, customerPromise, decodedToken, navigate }) {
  const customerData = customerPromise ? use(customerPromise) : null;
  const loginInfoValue = useAtomValue(loginInfo);
  const customerPerms = useMemo(() => getNormalizedModulePermissions(parseLoginInfo(loginInfoValue), 'customer'), [loginInfoValue]);
  const [formData, _formData] = useState({ ...INITIAL_FORM_DATA });
  const [isLoading, _isLoading] = useState(false);
  const [selectedCustomerProfile, _selectedCustomerProfile] = useState(null);

  useEffect(() => {
    if (customerData?.data) {
      const apiData = customerData.data;
      const profile = apiData.customerProfile || {};
      const profileId = apiData.customerProfileId?._id || profile._id || profile.id || '';
      const profileLabel = apiData.customerProfileId?.name || profile.name || profile.profileName || '';

      _formData(old => ({
        ...old,
        data: {
          ...old.data,
          customerType: apiData.customerType || 'domestic',
          registrationName: apiData.registrationName || '',
          registrationNameAr: apiData.registrationNameAr || '',
          email: apiData.email || '',
          phone: apiData.phone || '',
          customerVAT: apiData.customerVAT || '',
          identificationScheme: apiData.identificationScheme || 'OTH',
          identificationId: apiData.identificationId || '',
          address: apiData.address || '',
          addressAr: apiData.addressAr || '',
          streetName: apiData.streetName || '',
          streetNameAr: apiData.streetNameAr || '',
          buildingNumber: apiData.buildingNumber || '',
          citySubDivisionName: apiData.citySubdivisionName || '',
          citySubDivisionNameAr: apiData.citySubdivisionNameAr || '',
          cityName: apiData.cityName || '',
          cityNameAr: apiData.cityNameAr || '',
          postalZone: apiData.postalZone || '',
          countryCode: apiData.countryCode || '',
          customerProfileId: profileId ? String(profileId) : '',
        },
      }));

      if (profileId) {
        _selectedCustomerProfile({
          value: String(profileId),
          label: profileLabel || `Profile ${profileId}`,
        });
      } else {
        _selectedCustomerProfile(null);
      }
    } else if (customerData?.isError) {
      _formData({ ...INITIAL_FORM_DATA });
    }
  }, [customerData]);

  // *********** Handlers ***********
  const handleChangeFormData = (e) => {
    let value = e.target.value;
    const isInternational = formData.data.customerType === 'international';
    if (e.target.name === 'customerVAT') {
      value = value.replace(/\D/g, '').slice(0, 15);
    } else if (e.target.name === 'postalZone') {
      // Foreign postal codes may contain letters/spaces (e.g. UK).
      value = isInternational
        ? value.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 12)
        : value.replace(/\D/g, '').slice(0, 5);
    } else if (e.target.name === 'buildingNumber') {
      value = isInternational
        ? value.slice(0, 20)
        : value.replace(/\D/g, '').slice(0, 4);
    } else if (e.target.name === 'identificationId') {
      // ZATCA: buyer IDs are alphanumeric only, no spaces or symbols.
      value = value.replace(/[^A-Za-z0-9]/g, '');
    }
    _formData(old => ({
      ...old,
      data: {
        ...old.data,
        [e.target.name]: value,
      },
    }));
  };

  const handleCustomerTypeChange = (e) => {
    const customerType = e.target.value;
    _formData(old => ({
      ...old,
      data: {
        ...old.data,
        customerType,
        // Each type carries a different identity — clear the other side so
        // stale values never leak into the payload.
        customerVAT: '',
        identificationScheme: 'OTH',
        identificationId: '',
      },
      errors: {},
    }));
  };

  const loadCustomerProfileOptions = (inputValue) => {
    if (!decodedToken) {
      return Promise.resolve([]);
    }

    return CustomerProfileListRequest(decodedToken, { limit: 50, search: inputValue })
      .then((response) => {
        const profiles = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
        return profiles.map((profile) => ({
          value: profile._id || profile.id,
          label: profile.name || profile.profileName || 'Unnamed Profile',
          data: profile,
        })).filter((option) => option.value);
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Error loading customer profiles:', error);
        return [];
      });
  };

  const handleCustomerProfileChange = (selectedOption) => {
    _selectedCustomerProfile(selectedOption);

    const profileId = selectedOption
      ? String(
        selectedOption.value ||
        selectedOption?.data?._id ||
        selectedOption?.data?.id ||
        '',
      )
      : '';

    _formData((old) => ({
      ...old,
      data: {
        ...old.data,
        customerProfileId: profileId,
      },
    }));
  };

  const handleValidateForm = () => {
    const isInternational = formData.data.customerType === 'international';
    const validations = getValidations(formData.data.customerType, formData.data.identificationScheme);
    const { allValid, errors } = validateSubmissionData(formData.data, validations);
    if (isInternational && (formData.data.countryCode || '').trim().toUpperCase() === 'SA') {
      errors.countryCode = 'Country Code must not be SA for international customers';
    }
    const finalValid = allValid && Object.keys(errors).length === 0;
    _formData(old => ({
      ...old,
      errors: finalValid ? {} : errors,
    }));
    return finalValid;
  };

  const handleSubmitForm = (e) => {
    e.preventDefault();
    if (handleValidateForm()) {
      _isLoading(true);

      const isInternational = formData.data.customerType === 'international';
      const payloadData = {
        customerType: formData.data.customerType,
        streetName: formData.data.streetName,
        streetNameAr: formData.data.streetNameAr,
        address: formData.data.address,
        addressAr: formData.data.addressAr,
        buildingNumber: formData.data.buildingNumber,
        citySubdivisionName: formData.data.citySubDivisionName,
        citySubdivisionNameAr: formData.data.citySubDivisionNameAr,
        cityName: formData.data.cityName,
        cityNameAr: formData.data.cityNameAr,
        postalZone: formData.data.postalZone,
        countryCode: formData.data.countryCode,
        // Domestic buyers are identified by KSA VAT; international buyers by
        // a scheme + ID pair. Never send the other type's identity.
        ...(isInternational
          ? {
              identificationScheme: formData.data.identificationScheme,
              identificationId: formData.data.identificationId,
            }
          : { customerVAT: formData.data.customerVAT }),
        registrationName: formData.data.registrationName,
        registrationNameAr: formData.data.registrationNameAr,
        email: formData.data.email,
        phone: formData.data.phone,
        customerProfileId: formData.data.customerProfileId || undefined,
      };

      const request = id
        ? CustomerUpdateRequest(decodedToken, id, JSON.stringify(payloadData))
        : CustomerCreateRequest(decodedToken, JSON.stringify(payloadData));

      request
        .then(() => {
          showToast(id ? 'Customer updated successfully!' : 'Customer created successfully!', 'success');
          navigate('/customer');
        })
        .catch((err) => {
          showToast(err?.message || (id ? 'Failed to update customer' : 'Failed to create customer'), 'error');
        })
        .finally(() => {
          _isLoading(false);
        });
    } else {
      showToast('Please fill in all required fields', 'error');
    }
  };

  // *********** Render Functions ***********
  const PAGE_HEADER = () => (
    <div className="flex flex-wrap justify-between items-end gap-3 mb-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[#0d121b] dark:text-white text-3xl font-black leading-tight">
          {id ? 'Edit Customer' : 'Create Customer'}
        </h1>
      </div>
    </div>
  );

  const BASIC_INFO_SECTION = () => {
    const isInternational = formData.data.customerType === 'international';
    return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Customer Type *</label>
          <select
            name="customerType"
            value={formData.data.customerType || 'domestic'}
            onChange={handleCustomerTypeChange}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          >
            <option value="domestic">Domestic (Saudi Arabia)</option>
            <option value="international">International (Outside KSA)</option>
          </select>
          {isInternational && (
            <span className="text-xs text-[#4c669a] dark:text-gray-400">
              ZATCA: foreign buyers are identified by an Other Buyer ID (scheme + number) instead of a VAT number.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Registered Name *</label>
          <input
            type="text"
            name="registrationName"
            value={formData.data.registrationName || ''}
            onChange={handleChangeFormData}
            placeholder="Ahmed Al-Saud Trading Co."
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.registrationName && (
            <span className="text-xs text-tomato">{formData.errors.registrationName}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Registered Name (Arabic)</label>
          <input
            type="text"
            name="registrationNameAr"
            value={formData.data.registrationNameAr || ''}
            onChange={handleChangeFormData}
            placeholder="شركة أحمد السعود"
            dir="rtl"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.registrationNameAr && (
            <span className="text-xs text-tomato">{formData.errors.registrationNameAr}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Email</label>
          <input
            type="email"
            name="email"
            value={formData.data.email || ''}
            onChange={handleChangeFormData}
            placeholder="ahmed@customer.sa"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.email && (
            <span className="text-xs text-tomato">{formData.errors.email}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Phone</label>
          <input
            type="text"
            name="phone"
            value={formData.data.phone || ''}
            onChange={handleChangeFormData}
            placeholder="+966 11 234 5678"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.phone && (
            <span className="text-xs text-tomato">{formData.errors.phone}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Customer Profile (Optional)</label>
          <AsyncSelect
            cacheOptions
            defaultOptions
            isClearable
            loadOptions={loadCustomerProfileOptions}
            onChange={handleCustomerProfileChange}
            value={selectedCustomerProfile}
            placeholder="Select or search customer profile..."
            classNames={{
              control: (state) =>
                `!px-2 !py-0.5 !rounded-lg !border !bg-white dark:!bg-[#161f30] !shadow-none hover:!border-primary focus:!border-primary !transition-colors ${
                  state.isFocused
                    ? '!border-primary !ring-1 !ring-primary'
                    : '!border-[#e7ebf3] dark:!border-[#2a3447]'
                }`,
              menu: () =>
                '!bg-white dark:!bg-[#161f30] !border !border-[#e7ebf3] dark:!border-[#2a3447] !rounded-lg !shadow-lg !mt-1 !z-50',
              option: (state) =>
                `!px-4 !py-2 !cursor-pointer !text-sm ${
                  state.isSelected
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
        </div>

        {!isInternational && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-[#0d121b] dark:text-white">Customer VAT *</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={15}
              name="customerVAT"
              value={formData.data.customerVAT || ''}
              onChange={handleChangeFormData}
              placeholder="330000000000003"
              className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
            />
            {formData.errors.customerVAT && (
              <span className="text-xs text-tomato">{formData.errors.customerVAT}</span>
            )}
          </div>
        )}

        {isInternational && (
          <Fragment>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[#0d121b] dark:text-white">Identification Type *</label>
              <select
                name="identificationScheme"
                value={formData.data.identificationScheme || 'OTH'}
                onChange={handleChangeFormData}
                className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
              >
                {IDENTIFICATION_SCHEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {formData.errors.identificationScheme && (
                <span className="text-xs text-tomato">{formData.errors.identificationScheme}</span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[#0d121b] dark:text-white">Identification Number *</label>
              <input
                type="text"
                name="identificationId"
                value={formData.data.identificationId || ''}
                onChange={handleChangeFormData}
                placeholder="e.g. foreign VAT / CR / passport number"
                className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
              />
              {formData.errors.identificationId && (
                <span className="text-xs text-tomato">{formData.errors.identificationId}</span>
              )}
            </div>
          </Fragment>
        )}
      </div>
    </section >
  );
  };

  const ADDRESS_DETAILS_SECTION = () => {
    const isInternational = formData.data.customerType === 'international';
    return (
    <section className="space-y-6">
      <div className="flex items-center gap-2 pb-2">
        <button className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-[#0d121b] dark:text-white text-sm font-medium rounded-lg">
          Address Details
        </button>
        {isInternational && (
          <span className="text-xs text-[#4c669a] dark:text-gray-400">
            For international customers only street, city and country code are mandatory (ZATCA BR-KSA-10).
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Row 1 */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Full Address</label>
          <input
            type="text"
            name="address"
            value={formData.data.address || ''}
            onChange={handleChangeFormData}
            placeholder="Building 1234, Prince Sultan Street, Riyadh"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.address && (
            <span className="text-xs text-tomato">{formData.errors.address}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Full Address (Arabic)</label>
          <input
            type="text"
            name="addressAr"
            value={formData.data.addressAr || ''}
            onChange={handleChangeFormData}
            placeholder="مبنى 1234، شارع الأمير سلطان، الرياض"
            dir="rtl"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.addressAr && (
            <span className="text-xs text-tomato">{formData.errors.addressAr}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Street Name</label>
          <input
            type="text"
            name="streetName"
            value={formData.data.streetName || ''}
            onChange={handleChangeFormData}
            placeholder="Prince Sultan Street"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.streetName && (
            <span className="text-xs text-tomato">{formData.errors.streetName}</span>
          )}
        </div>

        {/* Row 2 */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Street Name (Arabic)</label>
          <input
            type="text"
            name="streetNameAr"
            value={formData.data.streetNameAr || ''}
            onChange={handleChangeFormData}
            placeholder="شارع الأمير سلطان"
            dir="rtl"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.streetNameAr && (
            <span className="text-xs text-tomato">{formData.errors.streetNameAr}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Building Number{isInternational ? '' : ' *'}</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={formData.data.customerType === 'international' ? 20 : 4}
            name="buildingNumber"
            value={formData.data.buildingNumber || ''}
            onChange={handleChangeFormData}
            placeholder="1234"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.buildingNumber && (
            <span className="text-xs text-tomato">{formData.errors.buildingNumber}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">City Subdivision Name</label>
          <input
            type="text"
            name="citySubDivisionName"
            value={formData.data.citySubDivisionName || ''}
            onChange={handleChangeFormData}
            placeholder="District 5"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.citySubDivisionName && (
            <span className="text-xs text-tomato">{formData.errors.citySubDivisionName}</span>
          )}
        </div>

        {/* Row 3 */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">City Subdivision Name (Arabic)</label>
          <input
            type="text"
            name="citySubDivisionNameAr"
            value={formData.data.citySubDivisionNameAr || ''}
            onChange={handleChangeFormData}
            placeholder="الحي الخامس"
            dir="rtl"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.citySubDivisionNameAr && (
            <span className="text-xs text-tomato">{formData.errors.citySubDivisionNameAr}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">City Name *</label>
          <input
            type="text"
            name="cityName"
            value={formData.data.cityName || ''}
            onChange={handleChangeFormData}
            placeholder="Riyadh"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.cityName && (
            <span className="text-xs text-tomato">{formData.errors.cityName}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">City Name (Arabic)</label>
          <input
            type="text"
            name="cityNameAr"
            value={formData.data.cityNameAr || ''}
            onChange={handleChangeFormData}
            placeholder="الرياض"
            dir="rtl"
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.cityNameAr && (
            <span className="text-xs text-tomato">{formData.errors.cityNameAr}</span>
          )}
        </div>

        {/* Row 4 */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Postal Zone{isInternational ? '' : ' *'}</label>
          <input
            type="text"
            inputMode={isInternational ? 'text' : 'numeric'}
            maxLength={isInternational ? 12 : 5}
            name="postalZone"
            value={formData.data.postalZone || ''}
            onChange={handleChangeFormData}
            placeholder={isInternational ? 'e.g. SW1A 1AA' : '12345'}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.postalZone && (
            <span className="text-xs text-tomato">{formData.errors.postalZone}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#0d121b] dark:text-white">Country Code *</label>
          <input
            type="text"
            maxLength={2}
            name="countryCode"
            value={formData.data.countryCode || ''}
            onChange={handleChangeFormData}
            placeholder={isInternational ? 'e.g. AE' : 'SA'}
            className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {formData.errors.countryCode && (
            <span className="text-xs text-tomato">{formData.errors.countryCode}</span>
          )}
        </div>
      </div>
    </section>
  );
  };

  const FORM_ACTIONS = () => (
    <div className="flex gap-3 pt-6">
      {(!id || customerPerms.update) && (
        <button
          type="submit"
          disabled={isLoading || customerData?.isError}
          onClick={handleSubmitForm}
          className="px-6 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors shadow-md shadow-primary/20 disabled:opacity-70 disabled:cursor-not-allowed min-w-[100px]"
        >
          {isLoading ? 'SAVING...' : 'SAVE'}
        </button>
      )}
      <button
        type="button"
        onClick={() => navigate('/customer')}
        className="px-6 py-2.5 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 transition-colors"
      >
        CANCEL
      </button>
    </div>
  );

  const FORM_CONTENT = () => (
    <div className="p-6 space-y-8">
      {BASIC_INFO_SECTION()}
      {ADDRESS_DETAILS_SECTION()}
      {FORM_ACTIONS()}
    </div>
  );

  const CUSTOMER_FORM = () => (
    <div className="bg-white dark:bg-[#161f30] rounded-xl border border-[#e7ebf3] dark:border-[#2a3447] overflow-hidden">
      {FORM_CONTENT()}
    </div>
  );

  const MAIN_GRID = () => (
    <div className="grid grid-cols-1 gap-8">
      <div className="lg:col-span-12">
        {CUSTOMER_FORM()}
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

export default CustomerForm;
