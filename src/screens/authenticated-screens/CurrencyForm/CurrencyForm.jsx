// Packages
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';

// APIs
import { CurrencyCreateRequest, CurrencyListRequest, CurrencyUpdateRequest } from '../../../requests';

// Utils
import { auth } from '../../../atoms';
import { Footer } from '../../../components';
import { decodeString, showToast } from '../../../utils';

const INITIAL_FORM = { code: '', name: '', symbol: '', isActive: true, isBase: false };

// Only 2-decimal currencies are supported (amounts are integer 1/100 units).
const DECIMAL_PLACES = 2;

const INPUT_CLASS =
  'px-4 py-2.5 rounded-lg border border-[#e7ebf3] bg-white text-sm text-[#0d121b] focus:ring-2 focus:ring-primary focus:border-primary transition-colors dark:bg-[#161f30] dark:border-[#2a3447] dark:text-white';
const LABEL_CLASS = 'text-xs font-bold text-[#4c669a] dark:text-gray-400';

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

  // *********** Render Functions ***********

  const FIELDS = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="currency-code" className={LABEL_CLASS}>Code *</label>
        <input
          id="currency-code"
          name="code"
          type="text"
          maxLength={3}
          value={form.code}
          onChange={handleChange}
          disabled={isEdit}
          placeholder="e.g. AED"
          className={`${INPUT_CLASS} uppercase ${isEdit ? 'bg-gray-50 cursor-not-allowed' : ''}`}
        />
        {errors.code && <span className="text-xs text-tomato">{errors.code}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="currency-name" className={LABEL_CLASS}>Name *</label>
        <input
          id="currency-name"
          name="name"
          type="text"
          value={form.name}
          onChange={handleChange}
          placeholder="e.g. UAE Dirham"
          className={INPUT_CLASS}
        />
        {errors.name && <span className="text-xs text-tomato">{errors.name}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="currency-symbol" className={LABEL_CLASS}>Symbol</label>
        <input
          id="currency-symbol"
          name="symbol"
          type="text"
          value={form.symbol}
          onChange={handleChange}
          placeholder="e.g. AED"
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="currency-decimals" className={LABEL_CLASS}>Decimal places</label>
        <input
          id="currency-decimals"
          type="number"
          value={DECIMAL_PLACES}
          disabled
          className={`${INPUT_CLASS} bg-gray-50 cursor-not-allowed`}
        />
        <span className="text-xs text-[#4c669a]">Only 2-decimal currencies are supported.</span>
      </div>

      {isEdit && (
        <label className="flex items-center gap-2 text-sm text-[#0d121b] dark:text-white">
          <input
            name="isActive"
            type="checkbox"
            checked={form.isActive}
            onChange={handleChange}
            disabled={form.isBase}
            className="rounded border-[#e7ebf3] text-primary focus:ring-primary"
          />
          Active (selectable on new invoices)
          {form.isBase && <span className="text-xs text-[#4c669a]">— the base currency is always active</span>}
        </label>
      )}
    </div>
  );

  return (
    <div id="currency-form">
      <Fragment>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-1">
            <h2 className="text-[#0d121b] dark:text-white text-3xl font-black tracking-tight">
              {isEdit ? `Edit ${form.code || 'Currency'}` : 'Add Currency'}
            </h2>
            <p className="text-[#4c669a] text-base">
              Enter amounts in this currency on invoices; they are converted to SAR for ZATCA.
            </p>
          </div>

          <div className="bg-white dark:bg-[#161f30] rounded-xl border border-[#e7ebf3] dark:border-[#2a3447] shadow-sm p-6">
            {isLoading ? <p className="text-sm text-[#4c669a]">Loading currency...</p> : FIELDS()}
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate('/currencies')}
              className="px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm font-medium text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isLoading}
              className="px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Currency'}
            </button>
          </div>
        </form>
        <Footer />
      </Fragment>
    </div>
  );
}

export default CurrencyForm;
