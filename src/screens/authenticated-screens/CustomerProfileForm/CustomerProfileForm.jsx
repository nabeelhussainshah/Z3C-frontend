// Packages
import { Fragment, useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Select from 'react-select';
import { useAtomValue } from 'jotai';

// APIs
import { CustomerProfileCreateRequest, CustomerProfileDetailRequest, CustomerProfileTemplatesListRequest, CustomerProfileUpdateRequest } from '../../../requests';

// Utils
import { Footer } from '../../../components';
import { showToast, validateSubmissionData, decodeString, parseLoginInfo, getNormalizedModulePermissions } from '../../../utils';
import { auth, loginInfo } from '../../../atoms';

const INITIAL_FORM_DATA = {
  data: {
    // Top-level profile fields (from customer-profile-payload.txt)
    name: '',
    defaultTemplate: '',
    invoiceType: 'B2B',
    paymentTerms: '',

    // Bank details (nested in payload -> flattened for the form)
    bankName: '',
    accountName: '',
    accountNumber: '',
    iban: '',
    swiftCode: '',
  },
  validations: {
    // Fields with "*" in payload are required
    name: { isRequired: true, label: 'Profile Name' },
    paymentTerms: { isRequired: true, label: 'Payment Terms' },
    bankName: { isRequired: true, label: 'Bank Name' },
    accountName: { isRequired: true, label: 'Account Name' },
    accountNumber: { isRequired: true, label: 'Account Number' },
    iban: { isRequired: true, label: 'IBAN' },
  },
  errors: {},
};

const INVOICE_TYPE_OPTIONS = [
  { value: 'B2B', label: 'B2B' },
  { value: 'B2C', label: 'B2C' },
  { value: 'B2G', label: 'B2G' },
  { value: 'CREDIT_NOTE', label: 'CREDIT_NOTE', isDisabled: true },
  { value: 'DEBIT_NOTE', label: 'DEBIT_NOTE', isDisabled: true },
];

const SELECT_MENU_STYLES = {
  menuPortal: (base) => ({ ...base, zIndex: 60 }),
};

function CustomerProfileForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [formData, _formData] = useState({ ...INITIAL_FORM_DATA });
  const [isLoading, _isLoading] = useState(false);
  const [isProfileLoading, _isProfileLoading] = useState(false);
  const authValue = useAtomValue(auth);
  const loginInfoValue = useAtomValue(loginInfo);
  const decodedToken = useMemo(() => decodeString(authValue), [authValue]);
  const customerProfilePerms = useMemo(() => getNormalizedModulePermissions(parseLoginInfo(loginInfoValue), 'profile'), [loginInfoValue]);
  const [templateOptions, _templateOptions] = useState([]);
  const [isTemplateLoading, _isTemplateLoading] = useState(false);

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

  const handleValidateForm = () => {
    const { allValid, errors } = validateSubmissionData(formData.data, formData.validations);

    if (!allValid) {
      _formData((old) => ({
        ...old,
        errors,
      }));
    } else {
      _formData((old) => ({
        ...old,
        errors: {},
      }));
    }

    return allValid;
  };

  useEffect(() => {
    if (!decodedToken) return;

    _isTemplateLoading(true);
    CustomerProfileTemplatesListRequest(decodedToken)
      .then((response) => {
        const templatesSource =
          response?.templates ||
          response?.data?.templates ||
          response;
        const templates = Array.isArray(templatesSource) ? templatesSource : [];
        const options = templates.map((tpl) => ({
          value: tpl,
          label: tpl,
        }));
        _templateOptions(options);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to load customer profile templates:', err);
        showToast('Failed to load customer profile templates', 'error');
      })
      .finally(() => {
        _isTemplateLoading(false);
      });
  }, [decodedToken]);

  // Load existing customer profile when editing
  useEffect(() => {
    if (!decodedToken || !id) return;

    let isCancelled = false;
    _isProfileLoading(true);

    CustomerProfileDetailRequest(decodedToken, id)
      .then((response) => {
        if (isCancelled) return;

        const apiData = response?.data || response;
        if (!apiData) return;

        _formData((old) => ({
          ...old,
          data: {
            ...old.data,
            name: apiData.name || '',
            defaultTemplate: apiData.defaultTemplate || '',
            invoiceType: apiData.invoiceType || '',
            paymentTerms: apiData.paymentTerms || '',
            bankName: apiData.bankDetails?.bankName || '',
            accountName: apiData.bankDetails?.accountName || '',
            accountNumber: apiData.bankDetails?.accountNumber || '',
            iban: apiData.bankDetails?.iban || '',
            swiftCode: apiData.bankDetails?.swiftCode || '',
          },
        }));
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to load customer profile details:', err);
        showToast('Failed to load customer profile details', 'error');
      })
      .finally(() => {
        if (!isCancelled) {
          _isProfileLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [decodedToken, id]);

  const handleSubmitForm = (e) => {
    if (e) e.preventDefault();

    if (!handleValidateForm()) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    if (!decodedToken) {
      showToast('Authentication is required to submit this form', 'error');
      return;
    }

    _isLoading(true);

    // Shape the payload similar to the sample structure
    const payload = {
      name: formData.data.name,
      defaultTemplate: formData.data.defaultTemplate || undefined,
      invoiceType: formData.data.invoiceType || undefined,
      paymentTerms: formData.data.paymentTerms,
      bankDetails: {
        bankName: formData.data.bankName,
        accountName: formData.data.accountName,
        accountNumber: formData.data.accountNumber,
        iban: formData.data.iban,
        swiftCode: formData.data.swiftCode || undefined,
      },
    };

    const request = id
      ? CustomerProfileUpdateRequest(decodedToken, id, JSON.stringify(payload))
      : CustomerProfileCreateRequest(decodedToken, JSON.stringify(payload));

    request
      .then(() => {
        showToast(
          id ? 'Customer profile updated successfully!' : 'Customer profile created successfully!',
          'success'
        );
        navigate('/customer-profile');
      })
      .catch((err) => {
        showToast(
          err?.message || (id ? 'Failed to update customer profile' : 'Failed to create customer profile'),
          'error'
        );
      })
      .finally(() => {
        _isLoading(false);
      });
  };

  const handleSelectChange = (name, option) => {
    const value = option ? option.value : '';
    _formData((old) => ({
      ...old,
      data: {
        ...old.data,
        [name]: value,
      },
    }));
  };

  const goToList = () => navigate('/customer-profile');

  const inputClassName = (name) =>
    `breeze-form-input${formData.errors[name] ? ' breeze-form-input--invalid' : ''}`;

  const FIELD = ({ label, name, required, hint, children }) => (
    <div className="breeze-form-field">
      <label className="breeze-field__label" htmlFor={`customer-profile-${name}`}>
        {label}
        {required ? <span className="breeze-form-required" aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint && !formData.errors[name] ? <p className="breeze-form-hint">{hint}</p> : null}
      {formData.errors[name] ? (
        <span className="breeze-field__error" id={`customer-profile-${name}-error`}>
          {formData.errors[name]}
        </span>
      ) : null}
    </div>
  );

  const TEXT_FIELD = ({ label, name, required, placeholder, hint }) => (
    FIELD({
      label,
      name,
      required,
      hint,
      children: (
        <input
          id={`customer-profile-${name}`}
          type="text"
          name={name}
          value={formData.data[name] || ''}
          onChange={handleChangeFormData}
          placeholder={placeholder}
          aria-invalid={Boolean(formData.errors[name])}
          aria-describedby={formData.errors[name] ? `customer-profile-${name}-error` : undefined}
          className={inputClassName(name)}
        />
      ),
    })
  );

  const SELECT_FIELD = ({ label, name, required, children }) => (
    FIELD({ label, name, required, children })
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

  // *********** Render Functions ***********
  const PAGE_HEADER = () => (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <button
          type="button"
          onClick={goToList}
          className="breeze-link breeze-page__back"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          Customer Profiles
        </button>
        <h2 className="breeze-page__title">
          {id ? 'Edit Customer Profile' : 'Create Customer Profile'}
        </h2>
        <p className="breeze-page__lede">
          {id
            ? 'Update profile defaults, invoice type, and bank details'
            : 'Configure customer profile defaults and bank details'}
        </p>
      </div>
    </div>
  );

  const PROFILE_DETAILS_SECTION = () => (
    <section className="breeze-form-section">
      {SECTION_HEADER({
        icon: 'badge',
        title: 'Profile details',
        lede: 'Name the profile and set the default template, invoice type, and payment terms.',
      })}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
        {TEXT_FIELD({
          label: 'Profile Name',
          name: 'name',
          required: true,
          placeholder: 'Enter profile name',
        })}
        {SELECT_FIELD({
          label: 'Default Template',
          name: 'defaultTemplate',
          children: (
            <Select
              inputId="customer-profile-defaultTemplate"
              instanceId="customer-profile-default-template"
              isClearable
              isLoading={isTemplateLoading}
              options={templateOptions}
              value={
                formData.data.defaultTemplate
                  ? { value: formData.data.defaultTemplate, label: formData.data.defaultTemplate }
                  : null
              }
              onChange={(option) => handleSelectChange('defaultTemplate', option)}
              placeholder="Select default template..."
              classNamePrefix="breeze-rs"
              menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
              menuPosition="fixed"
              styles={SELECT_MENU_STYLES}
            />
          ),
        })}
        {SELECT_FIELD({
          label: 'Invoice Type',
          name: 'invoiceType',
          children: (
            <Select
              inputId="customer-profile-invoiceType"
              instanceId="customer-profile-invoice-type"
              isClearable={false}
              options={INVOICE_TYPE_OPTIONS}
              value={
                formData.data.invoiceType
                  ? { value: formData.data.invoiceType, label: formData.data.invoiceType }
                  : null
              }
              onChange={(option) => handleSelectChange('invoiceType', option)}
              placeholder="Select invoice type..."
              classNamePrefix="breeze-rs"
              menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
              menuPosition="fixed"
              styles={SELECT_MENU_STYLES}
            />
          ),
        })}
        {TEXT_FIELD({
          label: 'Payment Terms',
          name: 'paymentTerms',
          required: true,
          placeholder: 'e.g. Net 30',
        })}
      </div>
    </section>
  );

  const BANK_DETAILS_SECTION = () => (
    <section className="breeze-form-section">
      {SECTION_HEADER({
        icon: 'account_balance',
        title: 'Bank details',
        lede: 'Settlement account used on invoices generated from this profile.',
      })}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
        {TEXT_FIELD({
          label: 'Bank Name',
          name: 'bankName',
          required: true,
          placeholder: 'Enter bank name',
        })}
        {TEXT_FIELD({
          label: 'Account Name',
          name: 'accountName',
          required: true,
          placeholder: 'Enter account name',
        })}
        {TEXT_FIELD({
          label: 'Account Number',
          name: 'accountNumber',
          required: true,
          placeholder: 'Enter account number',
        })}
        {TEXT_FIELD({
          label: 'IBAN',
          name: 'iban',
          required: true,
          placeholder: 'Enter IBAN',
        })}
        {TEXT_FIELD({
          label: 'SWIFT Code',
          name: 'swiftCode',
          placeholder: 'Enter SWIFT code',
        })}
      </div>
    </section>
  );

  const FORM_ACTIONS = () => (
    <div className="breeze-form-actions">
      <button
        type="button"
        onClick={goToList}
        className="breeze-btn breeze-btn--outline breeze-btn--inline w-full sm:w-auto"
      >
        Cancel
      </button>
      {(!id || customerProfilePerms.update) && (
        <button
          type="submit"
          disabled={isLoading || isProfileLoading}
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
              {id ? 'Save changes' : 'Create profile'}
            </Fragment>
          )}
        </button>
      )}
    </div>
  );

  const LOADING_CARD = () => (
    <div className="breeze-form-card px-6 py-10">
      <div className="flex items-center justify-center gap-2 text-[var(--z3c-subtle)]">
        <span className="material-symbols-outlined animate-spin">sync</span>
        Loading customer profile...
      </div>
    </div>
  );

  const CUSTOMER_PROFILE_FORM = () => (
    <div className="breeze-form-card">
      <form className="breeze-form" onSubmit={handleSubmitForm} noValidate>
        {PROFILE_DETAILS_SECTION()}
        {BANK_DETAILS_SECTION()}
        {FORM_ACTIONS()}
      </form>
    </div>
  );

  const CONTENT = () => (
    <Fragment>
      <div className="breeze-page flex-1">
        {PAGE_HEADER()}
        {id && isProfileLoading ? LOADING_CARD() : CUSTOMER_PROFILE_FORM()}
      </div>
      <Footer />
    </Fragment>
  );

  return (
    <div id="customer-profile-form" className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

export default CustomerProfileForm;
