// Packages
import { Fragment, useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';

// Utils
import { loginInfo } from '../../atoms';
import { parseLoginInfo, getNormalizedModulePermissions } from '../../utils';

function formatDisplayDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function PageHeader({ from, to, onDateChange }) {
  const navigate = useNavigate();
  const loginInfoValue = useAtomValue(loginInfo);
  const user = useMemo(() => parseLoginInfo(loginInfoValue), [loginInfoValue]);
  const invoicePerms = useMemo(() => getNormalizedModulePermissions(user, 'invoice'), [user]);
  const canAccessInvoiceCreate = Boolean(invoicePerms.create);

  const [pickerOpen, _pickerOpen] = useState(false);
  const [draftFrom, _draftFrom] = useState(from ?? '');
  const [draftTo, _draftTo] = useState(to ?? '');
  const pickerRef = useRef(null);

  // Sync drafts when parent updates date range externally
  useEffect(() => {
    _draftFrom(from ?? '');
  }, [from]);
  useEffect(() => {
    _draftTo(to ?? '');
  }, [to]);

  // Close picker when clicking outside
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        _pickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  function handleApply() {
    if (draftFrom && draftTo && onDateChange) {
      onDateChange(draftFrom, draftTo);
    }
    _pickerOpen(false);
  }

  const dateLabel =
    from && to ? `${formatDisplayDate(from)} – ${formatDisplayDate(to)}` : 'Select date range';

  const TITLE_SECTION = () => (
    <div>
      <h2 className="breeze-page__title">Zatca Overview</h2>
      <p className="breeze-page__lede">
        Real-time monitoring of ZATCA Phase 2 electronic invoicing
      </p>
    </div>
  );

  const DATE_PICKER_DROPDOWN = () => (
    <div className="breeze-panel left-0 right-0 sm:left-auto w-auto sm:w-72">
      <p className="breeze-panel__label">Date Range</p>
      <div className="space-y-3">
        <div>
          <label className="breeze-field__label" htmlFor="dashboard-date-from">From</label>
          <input
            id="dashboard-date-from"
            type="date"
            value={draftFrom}
            max={draftTo || undefined}
            onChange={(e) => _draftFrom(e.target.value)}
            className="breeze-form-input"
          />
        </div>
        <div>
          <label className="breeze-field__label" htmlFor="dashboard-date-to">To</label>
          <input
            id="dashboard-date-to"
            type="date"
            value={draftTo}
            min={draftFrom || undefined}
            onChange={(e) => _draftTo(e.target.value)}
            className="breeze-form-input"
          />
        </div>
      </div>
      <div className="flex gap-2 pt-4">
        <button
          type="button"
          onClick={() => _pickerOpen(false)}
          className="breeze-btn breeze-btn--outline breeze-btn--inline flex-1"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!draftFrom || !draftTo}
          className="breeze-btn breeze-btn--primary breeze-btn--inline flex-1"
        >
          Apply
        </button>
      </div>
    </div>
  );

  const ACTIONS_SECTION = () => (
    <div className="breeze-page-actions">
      <div ref={pickerRef} className="relative w-full sm:w-auto">
        <button
          type="button"
          onClick={() => _pickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          className="breeze-btn breeze-btn--outline breeze-btn--inline w-full sm:w-auto"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            calendar_today
          </span>
          <span className="truncate min-w-0">{dateLabel}</span>
        </button>
        {pickerOpen && DATE_PICKER_DROPDOWN()}
      </div>
      {canAccessInvoiceCreate && (
        <button
          type="button"
          onClick={() => navigate('/invoices/new')}
          className="breeze-btn breeze-btn--primary breeze-btn--inline w-full sm:w-auto"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            add
          </span>
          <span>New Submission</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="breeze-toolbar items-start">
      <Fragment>
        {TITLE_SECTION()}
        {ACTIONS_SECTION()}
      </Fragment>
    </div>
  );
}

export default PageHeader;
