// Packages
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';

// APIs
import { CurrencyCreateRequest, CurrencyListRequest, CurrencyUpdateRequest } from '../../../requests';

// Utils
import { auth } from '../../../atoms';
import { Footer } from '../../../components';
import { decodeString, preventEnterSubmit, showToast } from '../../../utils';

const INITIAL_FORM = { code: '', name: '', symbol: '', isActive: true, isBase: false };

// Only 2-decimal currencies are supported (amounts are integer 1/100 units).
const DECIMAL_PLACES = 2;

/** Create (/currencies/new) or edit (/currencies/:code) a currency. */
function CurrencyForm() {
  const { code: routeCode } = useParams();
  const isEdit = Boolean(routeCode);
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const decodedToken = useMemo(() => decodeString(authValue), [authValue]);

  const [form, _form] = useState({ ...INITIAL_FORM });
  const [errors, _errors] = useState({});
  const [isLoading, _isLoading] = useState(isEdit);
  const [isSubmitting, _isSubmitting] = useState(false);

  // There is no single-currency endpoint; load the full list and pick one.
  useEffect(() => {
    if (!isEdit) return;
    CurrencyListRequest(decodedToken, { all: true })
      .then((res) => {
        const found = (res?.data ?? []).find((c) => c.code === routeCode.toUpperCase());
        if (!found) {
          showToast(`Currency ${routeCode.toUpperCase()} not found`, 'error');
          navigate('/currencies');
          return;
        }
        _form({
          code: found.code,
          name: found.name ?? '',
          symbol: found.symbol ?? '',
          isActive: found.isActive !== false,
          isBase: !!found.isBase,
        });
      })
      .catch(() => navigate('/currencies'))
      .finally(() => _isLoading(false));
  }, [isEdit, routeCode, decodedToken, navigate]);

  // *********** Handlers ***********

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    _form((old) => ({ ...old, [name]: type === 'checkbox' ? checked : value }));
  };

  const validate = () => {
    const next = {};
    if (!isEdit && !/^[A-Za-z]{3}$/.test(form.code.trim())) {
      next.code = 'Code must be a 3-letter ISO-4217 code (e.g. AED)';
    }
    if (!form.name.trim()) next.name = 'Name is required';
    _errors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isSubmitting || !validate()) return;
    _isSubmitting(true);

    const request = isEdit
      ? CurrencyUpdateRequest(
          decodedToken,
          form.code,
          JSON.stringify({
            name: form.name.trim(),
            symbol: form.symbol.trim(),
            // The base currency cannot be deactivated (enforced by the API too).
            ...(!form.isBase && { isActive: form.isActive }),
          })
        )
      : CurrencyCreateRequest(
          decodedToken,
          JSON.stringify({
            code: form.code.trim().toUpperCase(),
            name: form.name.trim(),
            ...(form.symbol.trim() && { symbol: form.symbol.trim() }),
            decimalPlaces: DECIMAL_PLACES,
          })
        );

    request
      .then(() => {
        showToast(isEdit ? 'Currency updated' : 'Currency added', 'success');
        navigate('/currencies');
      })
      .catch((err) => showToast(err?.message || 'Failed to save currency', 'error'))
      .finally(() => _isSubmitting(false));
  };

  const goToList = () => navigate('/currencies');

  const inputClassName = (name, extra = '') =>
    `breeze-form-input${errors[name] ? ' breeze-form-input--invalid' : ''}${extra ? ` ${extra}` : ''}`;

  // *********** Render Functions ***********

  const FIELD = ({ label, name, htmlFor, required, hint, children }) => (
    <div className="breeze-form-field">
      <label className="breeze-field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="breeze-form-required"> *</span> : null}
      </label>
      {children}
      {hint && !errors[name] ? <p className="breeze-form-hint">{hint}</p> : null}
      {errors[name] ? (
        <span className="breeze-field__error" id={`${htmlFor}-error`}>
          {errors[name]}
        </span>
      ) : null}
    </div>
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
          onClick={goToList}
          className="breeze-link breeze-page__back"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          Currencies
        </button>
        <h2 className="breeze-page__title">
          {isEdit ? `Edit ${form.code || 'Currency'}` : 'Add Currency'}
        </h2>
        <p className="breeze-page__lede">
          Enter amounts in this currency on invoices; they are converted to SAR for ZATCA.
        </p>
      </div>
    </div>
  );

  const CURRENCY_DETAILS_SECTION = () => (
    <section className="breeze-form-section">
      {SECTION_HEADER({
        icon: 'payments',
        title: 'Currency details',
        lede: 'ISO code, display name, and symbol used when entering invoice amounts.',
      })}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
        {FIELD({
          label: 'Code',
          name: 'code',
          htmlFor: 'currency-code',
          required: true,
          children: (
            <input
              id="currency-code"
              name="code"
              type="text"
              maxLength={3}
              value={form.code}
              onChange={handleChange}
              disabled={isEdit}
              placeholder="e.g. AED"
              aria-invalid={Boolean(errors.code)}
              aria-describedby={errors.code ? 'currency-code-error' : undefined}
              className={inputClassName('code', `uppercase${isEdit ? ' breeze-form-input--locked' : ''}`)}
            />
          ),
        })}
        {FIELD({
          label: 'Name',
          name: 'name',
          htmlFor: 'currency-name',
          required: true,
          children: (
            <input
              id="currency-name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. UAE Dirham"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'currency-name-error' : undefined}
              className={inputClassName('name')}
            />
          ),
        })}
        {FIELD({
          label: 'Symbol',
          name: 'symbol',
          htmlFor: 'currency-symbol',
          children: (
            <input
              id="currency-symbol"
              name="symbol"
              type="text"
              value={form.symbol}
              onChange={handleChange}
              placeholder="e.g. AED"
              className={inputClassName('symbol')}
            />
          ),
        })}
        {FIELD({
          label: 'Decimal places',
          name: 'decimals',
          htmlFor: 'currency-decimals',
          hint: 'Only 2-decimal currencies are supported.',
          children: (
            <input
              id="currency-decimals"
              type="number"
              value={DECIMAL_PLACES}
              disabled
              className="breeze-form-input breeze-form-input--locked"
            />
          ),
        })}
        {isEdit && (
          <div className="breeze-form-field sm:col-span-2">
            <label className={`breeze-check w-fit ${form.isBase ? 'pointer-events-none' : ''}`}>
              <input
                name="isActive"
                type="checkbox"
                checked={form.isActive}
                onChange={handleChange}
                disabled={form.isBase}
                className="breeze-check__box"
              />
              Active (selectable on new invoices)
            </label>
            {form.isBase ? (
              <p className="breeze-form-hint">The base currency is always active.</p>
            ) : null}
          </div>
        )}
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
      <button
        type="submit"
        disabled={isSubmitting || isLoading}
        className="breeze-btn breeze-btn--primary breeze-btn--inline w-full sm:w-auto min-w-[140px]"
      >
        {isSubmitting ? (
          <Fragment>
            <span className="breeze-btn__spinner" aria-hidden="true" />
            Saving...
          </Fragment>
        ) : (
          <Fragment>
            <span className="material-symbols-outlined text-[18px]">save</span>
            {isEdit ? 'Save Changes' : 'Add Currency'}
          </Fragment>
        )}
      </button>
    </div>
  );

  const LOADING_CARD = () => (
    <div className="breeze-form-card px-6 py-10">
      <div className="flex items-center justify-center gap-2 text-[var(--z3c-subtle)]">
        <span className="material-symbols-outlined animate-spin">sync</span>
        Loading currency...
      </div>
    </div>
  );

  const CURRENCY_FORM = () => (
    <div className="breeze-form-card">
      <form className="breeze-form" onSubmit={handleSubmit} onKeyDown={preventEnterSubmit} noValidate>
        {CURRENCY_DETAILS_SECTION()}
        {FORM_ACTIONS()}
      </form>
    </div>
  );

  const CONTENT = () => (
    <Fragment>
      <div className="breeze-page flex-1">
        {PAGE_HEADER()}
        {isEdit && isLoading ? LOADING_CARD() : CURRENCY_FORM()}
      </div>
      <Footer />
    </Fragment>
  );

  return (
    <div id="currency-form" className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

export default CurrencyForm;
