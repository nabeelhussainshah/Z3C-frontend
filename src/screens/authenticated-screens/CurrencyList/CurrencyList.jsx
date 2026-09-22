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

  // *********** Render Functions ***********

  const PAGE_HEADER = () => (
    <div className="flex flex-wrap justify-between items-end gap-4">
      <div className="space-y-1">
        <h2 className="text-[#0d121b] dark:text-white text-3xl font-black tracking-tight">Currencies</h2>
        <p className="text-[#4c669a] text-base">
          Currencies available on invoices. Invoices are always reported to ZATCA in SAR.
        </p>
      </div>
      {perms.create && (
        <button
          onClick={() => navigate('/currencies/new')}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20 w-full sm:w-auto"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          Add Currency
        </button>
      )}
    </div>
  );

  const STATUS_BADGE = (currency) =>
    currency.isActive ? (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Active
      </span>
    ) : (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        Inactive
      </span>
    );

  const ROW_ACTIONS = (currency) => (
    <div className="flex items-center justify-end gap-3">
      {perms.update && (
        <button
          onClick={() => navigate(`/currencies/${currency.code}`)}
          className="text-primary text-sm font-bold hover:underline"
        >
          Edit
        </button>
      )}
      {!currency.isBase && currency.isActive && perms.delete && (
        <button
          onClick={() => _pendingDeactivate(currency)}
          disabled={isUpdating}
          className="text-tomato text-sm font-bold hover:underline disabled:opacity-50"
        >
          Deactivate
        </button>
      )}
      {!currency.isActive && perms.update && (
        <button
          onClick={() => handleActivate(currency)}
          disabled={isUpdating}
          className="text-primary text-sm font-bold hover:underline disabled:opacity-50"
        >
          Activate
        </button>
      )}
    </div>
  );

  const CURRENCIES_TABLE = () => (
    <div className="bg-white dark:bg-[#161f30] rounded-xl border border-[#e7ebf3] dark:border-[#2a3447] shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-[#f8f9fc] dark:bg-[#1a253a] text-[#4c669a] dark:text-gray-400 text-xs font-bold uppercase tracking-wider">
            <tr>
              <th className="px-6 py-4">Code</th>
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Symbol</th>
              <th className="px-6 py-4">Decimals</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e7ebf3] dark:divide-[#2a3447]">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-[#4c669a]">
                  Loading currencies...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-[#4c669a]">
                  No currencies found
                </td>
              </tr>
            ) : (
              rows.map((currency) => (
                <tr key={currency.code} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-6 py-4 text-sm font-bold text-[#0d121b] dark:text-white">
                    {currency.code}
                    {currency.isBase && (
                      <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-primary/10 text-primary">
                        Base
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-[#0d121b] dark:text-white">{currency.name}</td>
                  <td className="px-6 py-4 text-sm text-[#0d121b] dark:text-white">{currency.symbol || '—'}</td>
                  <td className="px-6 py-4 text-sm text-[#0d121b] dark:text-white">{currency.decimalPlaces}</td>
                  <td className="px-6 py-4 text-sm">{STATUS_BADGE(currency)}</td>
                  <td className="px-6 py-4 text-sm">{ROW_ACTIONS(currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div id="currency-list">
      <Fragment>
        <div className="p-8 space-y-6">
          {PAGE_HEADER()}
          {CURRENCIES_TABLE()}
        </div>
        <Footer />
      </Fragment>
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
