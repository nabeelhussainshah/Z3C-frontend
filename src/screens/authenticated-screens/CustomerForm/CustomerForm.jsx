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
import { showToast, preventEnterSubmit, validateSubmissionData, decodeString, parseLoginInfo, getNormalizedModulePermissions } from '../../../utils';

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
          <div className="breeze-page flex-1">
            <div className="breeze-form-card px-6 py-10">
              <div className="flex items-center justify-center gap-2 text-[var(--z3c-subtle)]">
                <span className="material-symbols-outlined animate-spin">sync</span>
                Loading customer details...
              </div>
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
    <div id="customer-form" className="flex min-h-0 flex-1 flex-col">
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

  const inputClassName = (name) =>
    `breeze-form-input${formData.errors[name] ? ' breeze-form-input--invalid' : ''}`;

  const FIELD = ({ label, name, required, hint, children }) => (
    <div className="breeze-form-field">
      <label className="breeze-field__label" htmlFor={`customer-${name}`}>
        {label}
        {required ? <span className="breeze-form-required" aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint && !formData.errors[name] ? <p className="breeze-form-hint">{hint}</p> : null}
      {formData.errors[name] ? (
        <span className="breeze-field__error" id={`customer-${name}-error`}>
          {formData.errors[name]}
        </span>
      ) : null}
    </div>
  );

  const TEXT_FIELD = ({ label, name, required, type = 'text', placeholder, dir, maxLength, inputMode, hint }) => (
    FIELD({
      label,
      name,
      required,
      hint,
      children: (
        <input
          id={`customer-${name}`}
          type={type}
          name={name}
          value={formData.data[name] || ''}
          onChange={handleChangeFormData}
          placeholder={placeholder}
          dir={dir}
          maxLength={maxLength}
          inputMode={inputMode}
          aria-invalid={Boolean(formData.errors[name])}
          aria-describedby={formData.errors[name] ? `customer-${name}-error` : undefined}
          className={inputClassName(name)}
        />
      ),
    })
  );

  const SECTION_HEADER = ({ icon, title, lede }) => (
    <div className="breeze-form-section__header">
      <span className="breeze-form-section__badge" aria-hidden="true">
        <span className="material-symbols-outlined">{icon}</span>
      </span>
      <div>
        <h3 className="breeze-form-section__title">{title}</h3>
        {lede ? <p className="breeze-form-section__lede">{lede}</p> : null}
      </div>
    </div>
  );

  const PAGE_HEADER = () => (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <button
          type="button"
          onClick={() => navigate('/customer')}
          className="breeze-link breeze-page__back"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          Customers
        </button>
        <h2 className="breeze-page__title">
          {id ? 'Edit Customer' : 'Create Customer'}
        </h2>
        <p className="breeze-page__lede">
          {id
            ? 'Update bilingual legal name, tax identifiers, and ZATCA address details'
            : 'Register a buyer with bilingual legal name, VAT, and ZATCA address details'}
        </p>
      </div>
    </div>
  );

  const IDENTITY_SECTION = () => {
    const isInternational = formData.data.customerType === 'international';
    return (
      <section className="breeze-form-section">
        {SECTION_HEADER({
          icon: 'badge',
          title: 'Identity & contact',
          lede: 'Legal registered name in English and Arabic, plus primary contact details.',
        })}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
          {FIELD({
            label: 'Customer Type',
            name: 'customerType',
            required: true,
            hint: isInternational
              ? 'ZATCA: foreign buyers are identified by an Other Buyer ID (scheme + number) instead of a VAT number.'
              : null,
            children: (
              <select
                id="customer-customerType"
                name="customerType"
                value={formData.data.customerType || 'domestic'}
                onChange={handleCustomerTypeChange}
                className={inputClassName('customerType')}
              >
                <option value="domestic">Domestic (Saudi Arabia)</option>
                <option value="international">International (Outside KSA)</option>
              </select>
            ),
          })}
          {TEXT_FIELD({
            label: 'Registered Name',
            name: 'registrationName',
            required: true,
            placeholder: 'Ahmed Al-Saud Trading Co.',
          })}
          {TEXT_FIELD({
            label: 'Registered Name (Arabic)',
            name: 'registrationNameAr',
            required: true,
            placeholder: 'شركة أحمد السعود',
            dir: 'rtl',
          })}
          {TEXT_FIELD({
            label: 'Email',
            name: 'email',
            required: true,
            type: 'email',
            placeholder: 'ahmed@customer.sa',
          })}
          {TEXT_FIELD({
            label: 'Phone',
            name: 'phone',
            placeholder: '+966 11 234 5678',
          })}
        </div>
      </section>
    );
  };

  const TAX_SECTION = () => {
    const isInternational = formData.data.customerType === 'international';
    return (
      <section className="breeze-form-section">
        {SECTION_HEADER({
          icon: 'receipt_long',
          title: 'Tax & registration',
          lede: isInternational
            ? 'Other Buyer ID scheme and number, plus an optional billing profile.'
            : 'VAT number and optional billing profile.',
        })}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
          {!isInternational && TEXT_FIELD({
            label: 'Customer VAT',
            name: 'customerVAT',
            required: true,
            placeholder: '330000000000003',
            maxLength: 15,
            inputMode: 'numeric',
            hint: '15 digits, must start and end with 3',
          })}
          {isInternational && FIELD({
            label: 'Identification Type',
            name: 'identificationScheme',
            required: true,
            children: (
              <select
                id="customer-identificationScheme"
                name="identificationScheme"
                value={formData.data.identificationScheme || 'OTH'}
                onChange={handleChangeFormData}
                className={inputClassName('identificationScheme')}
              >
                {IDENTIFICATION_SCHEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ),
          })}
          {isInternational && TEXT_FIELD({
            label: 'Identification Number',
            name: 'identificationId',
            required: true,
            placeholder: 'e.g. foreign VAT / CR / passport number',
          })}
          {FIELD({
            label: 'Customer Profile',
            name: 'customerProfileId',
            children: (
              <AsyncSelect
                inputId="customer-customerProfileId"
                cacheOptions
                defaultOptions
                isClearable
                loadOptions={loadCustomerProfileOptions}
                onChange={handleCustomerProfileChange}
                value={selectedCustomerProfile}
                placeholder="Select or search customer profile..."
                classNamePrefix="breeze-rs"
                menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                menuPosition="fixed"
                styles={{
                  menuPortal: (base) => ({ ...base, zIndex: 60 }),
                }}
              />
            ),
          })}
        </div>
      </section>
    );
  };

  const ADDRESS_SECTION = () => {
    const isInternational = formData.data.customerType === 'international';
    return (
      <section className="breeze-form-section">
        {SECTION_HEADER({
          icon: 'location_on',
          title: 'Address details',
          lede: isInternational
            ? 'For international customers only street, city and country code are mandatory (ZATCA BR-KSA-10).'
            : 'ZATCA-compliant bilingual street address, city, postal zone, and country.',
        })}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
          {TEXT_FIELD({
            label: 'Full Address',
            name: 'address',
            required: true,
            placeholder: 'Building 1234, Prince Sultan Street, Riyadh',
          })}
          {TEXT_FIELD({
            label: 'Full Address (Arabic)',
            name: 'addressAr',
            required: true,
            placeholder: 'مبنى 1234، شارع الأمير سلطان، الرياض',
            dir: 'rtl',
          })}
          {TEXT_FIELD({
            label: 'Street Name',
            name: 'streetName',
            required: true,
            placeholder: 'Prince Sultan Street',
          })}
          {TEXT_FIELD({
            label: 'Street Name (Arabic)',
            name: 'streetNameAr',
            required: true,
            placeholder: 'شارع الأمير سلطان',
            dir: 'rtl',
          })}
          {TEXT_FIELD({
            label: 'Building Number',
            name: 'buildingNumber',
            required: !isInternational,
            placeholder: '1234',
            maxLength: isInternational ? 20 : 4,
            inputMode: isInternational ? 'text' : 'numeric',
            hint: isInternational ? null : 'Exactly 4 digits',
          })}
          {TEXT_FIELD({
            label: 'City Subdivision Name',
            name: 'citySubDivisionName',
            placeholder: 'District 5',
          })}
          {TEXT_FIELD({
            label: 'City Subdivision Name (Arabic)',
            name: 'citySubDivisionNameAr',
            placeholder: 'الحي الخامس',
            dir: 'rtl',
          })}
          {TEXT_FIELD({
            label: 'City Name',
            name: 'cityName',
            required: true,
            placeholder: 'Riyadh',
          })}
          {TEXT_FIELD({
            label: 'City Name (Arabic)',
            name: 'cityNameAr',
            required: true,
            placeholder: 'الرياض',
            dir: 'rtl',
          })}
          {TEXT_FIELD({
            label: 'Postal Zone',
            name: 'postalZone',
            required: !isInternational,
            placeholder: isInternational ? 'e.g. SW1A 1AA' : '12345',
            maxLength: isInternational ? 12 : 5,
            inputMode: isInternational ? 'text' : 'numeric',
            hint: isInternational ? null : 'Exactly 5 digits',
          })}
          {TEXT_FIELD({
            label: 'Country Code',
            name: 'countryCode',
            required: true,
            placeholder: isInternational ? 'e.g. AE' : 'SA',
            maxLength: 2,
            hint: isInternational ? 'ISO 2-letter code, not SA' : 'ISO 2-letter code, e.g. SA',
          })}
        </div>
      </section>
    );
  };

  const FORM_ACTIONS = () => (
    <div className="breeze-form-actions">
      <button
        type="button"
        onClick={() => navigate('/customer')}
        className="breeze-btn breeze-btn--outline breeze-btn--inline w-full sm:w-auto"
      >
        Cancel
      </button>
      {(!id || customerPerms.update) && (
        <button
          type="submit"
          disabled={isLoading || customerData?.isError}
          className="breeze-btn breeze-btn--primary breeze-btn--inline w-full sm:w-auto min-w-[140px]"
        >
          {isLoading ? (
            <Fragment>
              <span className="breeze-btn__spinner" aria-hidden="true" />
              Saving...
            </Fragment>
          ) : (
            <Fragment>
              <span className="material-symbols-outlined text-[18px]">save</span>
              {id ? 'Save changes' : 'Create customer'}
            </Fragment>
          )}
        </button>
      )}
    </div>
  );

  const CUSTOMER_FORM = () => (
    <div className="breeze-form-card">
      <form className="breeze-form" onSubmit={handleSubmitForm} onKeyDown={preventEnterSubmit} noValidate>
        {customerData?.isError && (
          <div className="breeze-alert" role="alert">
            <span className="material-symbols-outlined">error</span>
            <span>Unable to load this customer. You can go back to the list and try again.</span>
          </div>
        )}
        {IDENTITY_SECTION()}
        {TAX_SECTION()}
        {ADDRESS_SECTION()}
        {FORM_ACTIONS()}
      </form>
    </div>
  );

  const CONTENT = () => (
    <Fragment>
      <div className="breeze-page flex-1">
        {PAGE_HEADER()}
        {CUSTOMER_FORM()}
      </div>
      <Footer />
    </Fragment>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

export default CustomerForm;
