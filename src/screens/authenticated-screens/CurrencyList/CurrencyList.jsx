// Packages
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';

// APIs
import { CurrencyListRequest, CurrencyDeactivateRequest, CurrencyUpdateRequest } from '../../../requests';

// Utils
import { auth, loginInfo } from '../../../atoms';
import { Footer, ConfirmModal } from '../../../components';
import { decodeString, parseLoginInfo, getNormalizedModulePermissions, showToast } from '../../../utils';

/**
 * Currency administration: the currencies selectable on invoices. SAR is the
 * base currency and cannot be deactivated. Management reuses the
 * companyProfile permissions (same as the backend guards).
 */
function CurrencyList() {
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const loginInfoValue = useAtomValue(loginInfo);
  const decodedToken = useMemo(() => decodeString(authValue), [authValue]);
  const user = useMemo(() => parseLoginInfo(loginInfoValue), [loginInfoValue]);
  const perms = useMemo(() => getNormalizedModulePermissions(user, 'companyProfile'), [user]);

  const [currencies, _currencies] = useState([]);
  const [isLoading, _isLoading] = useState(true);
  const [reloadKey, _reloadKey] = useState(0);
  const [pendingDeactivate, _pendingDeactivate] = useState(null);
  const [isUpdating, _isUpdating] = useState(false);

  // isLoading starts true for the first load; refetches after a change keep the
  // current rows on screen until the new list arrives.
  useEffect(() => {
    let cancelled = false;
    CurrencyListRequest(decodedToken, { all: true })
      .then((res) => {
        if (!cancelled) _currencies(Array.isArray(res?.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) _currencies([]);
      })
      .finally(() => {
        if (!cancelled) _isLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [decodedToken, reloadKey]);

  // Base currency first, then alphabetical.
  const rows = useMemo(
    () => [...currencies].sort((a, b) => Number(!!b.isBase) - Number(!!a.isBase) || a.code.localeCompare(b.code)),
    [currencies]
  );

  // *********** Handlers ***********

  const handleConfirmDeactivate = () => {
    if (!pendingDeactivate) return;
    _isUpdating(true);
    CurrencyDeactivateRequest(decodedToken, pendingDeactivate.code)
      .then(() => {
        showToast(`${pendingDeactivate.code} deactivated`, 'success');
        _pendingDeactivate(null);
        _reloadKey((k) => k + 1);
      })
      .catch((err) => showToast(err?.message || 'Failed to deactivate currency', 'error'))
      .finally(() => _isUpdating(false));
  };

  const handleActivate = (currency) => {
    _isUpdating(true);
    CurrencyUpdateRequest(decodedToken, currency.code, JSON.stringify({ isActive: true }))
      .then(() => {
        showToast(`${currency.code} activated`, 'success');
        _reloadKey((k) => k + 1);
      })
      .catch((err) => showToast(err?.message || 'Failed to activate currency', 'error'))
      .finally(() => _isUpdating(false));
  };

  const handleRowClick = (currency, event) => {
    if (!perms.update || !currency?.code) return;
    if (event.target.closest('button')) return;
    navigate(`/currencies/${currency.code}`);
  };

  // *********** Render Functions ***********

  const PAGE_HEADER = () => (
    <div>
      <h2 className="breeze-page__title">Currencies</h2>
      <p className="breeze-page__lede">
        Currencies available on invoices. Invoices are always reported to ZATCA in SAR.
      </p>
    </div>
  );

  const ACTIONS_SECTION = () =>
    perms.create ? (
      <div className="breeze-toolbar">
        <div className="flex flex-col sm:flex-row gap-3 sm:ms-auto">
          <button
            type="button"
            onClick={() => navigate('/currencies/new')}
            className="breeze-btn breeze-btn--primary breeze-btn--inline w-full sm:w-auto"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Add Currency
          </button>
        </div>
      </div>
    ) : null;

  const STATUS_BADGE = (currency) => {
    const isActive = currency.isActive;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${isActive
        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
        }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-600 dark:bg-green-400' : 'bg-red-600 dark:bg-red-400'
          }`}></span>
        {isActive ? 'Active' : 'Inactive'}
      </span>
    );
  };

  const ROW_ACTIONS = (currency) => (
    <div className="breeze-table-actions">
      {perms.update && (
        <span className="breeze-table-action-wrap breeze-table-action-wrap--tooltip-end" data-tooltip="Edit">
          <button
            type="button"
            onClick={() => navigate(`/currencies/${currency.code}`)}
            className="breeze-table-action"
            aria-label="Edit"
          >
            <span className="material-symbols-outlined">edit</span>
          </button>
        </span>
      )}
      {!currency.isBase && currency.isActive && perms.delete && (
        <span className="breeze-table-action-wrap breeze-table-action-wrap--tooltip-end" data-tooltip="Deactivate">
          <button
            type="button"
            onClick={() => _pendingDeactivate(currency)}
            disabled={isUpdating}
            className="breeze-table-action"
            aria-label="Deactivate"
          >
            <span className="material-symbols-outlined">block</span>
          </button>
        </span>
      )}
      {!currency.isActive && perms.update && (
        <span className="breeze-table-action-wrap breeze-table-action-wrap--tooltip-end" data-tooltip="Activate">
          <button
            type="button"
            onClick={() => handleActivate(currency)}
            disabled={isUpdating}
            className={`breeze-table-action${isUpdating ? ' is-busy' : ''}`}
            aria-label="Activate"
          >
            <span className="material-symbols-outlined">check_circle</span>
          </button>
        </span>
      )}
    </div>
  );

  const CURRENCIES_TABLE = () => (
    <div className="breeze-table-card">
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Symbol</th>
              <th>Decimals</th>
              <th>Status</th>
              <th className="text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="!text-center text-[var(--z3c-subtle)]">
                  <div className="flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined animate-spin">sync</span>
                    Loading currencies...
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="!text-center text-[var(--z3c-subtle)]">
                  No currencies found
                </td>
              </tr>
            ) : (
              rows.map((currency) => (
                <tr
                  key={currency.code}
                  onClick={(event) => handleRowClick(currency, event)}
                  className={perms.update ? 'cursor-pointer' : ''}
                >
                  <td>
                    <span className="font-medium">{currency.code}</span>
                    {currency.isBase && (
                      <span className="breeze-pill breeze-pill--primary ml-2">Base</span>
                    )}
                  </td>
                  <td>{currency.name}</td>
                  <td>{currency.symbol || '—'}</td>
                  <td>{currency.decimalPlaces}</td>
                  <td>{STATUS_BADGE(currency)}</td>
                  <td>{ROW_ACTIONS(currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const CONTENT = () => (
    <Fragment>
      <div className="breeze-page flex-1">
        {PAGE_HEADER()}
        {ACTIONS_SECTION()}
        {CURRENCIES_TABLE()}
      </div>
      <Footer />
    </Fragment>
  );

  return (
    <div id="currency-list" className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
      <ConfirmModal
        isOpen={!!pendingDeactivate}
        title="Deactivate currency"
        description={`${pendingDeactivate?.code ?? ''} will no longer be selectable on new invoices. Existing invoices are not affected.`}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDeactivate}
        onCancel={() => _pendingDeactivate(null)}
        isConfirming={isUpdating}
      />
    </div>
  );
}

export default CurrencyList;
