// Packages
import { Fragment, useMemo, useState, useRef, Suspense, use, useEffect } from 'react';
import { useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel, flexRender } from '@tanstack/react-table';
import { ErrorBoundary } from 'react-error-boundary';
import Select from 'react-select';
import { useAtomValue } from 'jotai';

// APIs
import { AuditListRequest, UserListRequest } from '../../../requests';

// Utils
import { auth } from '../../../atoms';
import { Footer, ErrorFallback } from '../../../components';
import { DEFAULT_PAGE_SIZE, PAGINATION_PAGE_SIZES, decodeString } from '../../../utils';

const DETAILS_TRUNCATE_LEN = 80;
const DETAILS_SEP = ' · ';

// --- json-diff output helpers (supports both _old/_new and __old/__new)
function isDiffModified(val) {
  if (val == null || typeof val !== 'object' || Array.isArray(val)) return false;
  return ('_old' in val && '_new' in val) || ('__old' in val && '__new' in val);
}
function getOldNew(val) {
  if (val == null || typeof val !== 'object') return [undefined, undefined];
  const oldVal = val._old ?? val.__old;
  const newVal = val._new ?? val.__new;
  return [oldVal, newVal];
}
function keyKind(key) {
  if (typeof key !== 'string') return null;
  if (key.endsWith('_deleted')) return 'deleted';
  if (key.endsWith('_added')) return 'added';
  return null;
}
function keyDisplayName(key) {
  const k = keyKind(key);
  if (k === 'deleted') return key.slice(0, -8); // strip _deleted
  if (k === 'added') return key.slice(0, -6);   // strip _added
  return key;
}

function isXmlString(val) {
  return typeof val === 'string' && val.trimStart().startsWith('<?xml');
}

function isLongOrComplexValue(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'object') return true;
  if (typeof val === 'string' && (isXmlString(val) || val.length > 120)) return true;
  return false;
}

function formatDiffValue(val) {
  if (val === null) return 'null';
  if (val === undefined) return '—';
  if (typeof val === 'string') return `"${val}"`;
  if (typeof val === 'object' && !Array.isArray(val) && isDiffModified(val)) {
    const [o, n] = getOldNew(val);
    return { type: 'modified', old: o, new: n };
  }
  if (Array.isArray(val)) return { type: 'array', items: val };
  if (typeof val === 'object') return { type: 'object', value: val };
  return String(val);
}

function ComplexValueBlock({ val, colorClass }) {
  if (val === null || val === undefined) {
    return <span className={`font-mono text-xs ${colorClass}`}>{val === null ? 'null' : '—'}</span>;
  }
  if (typeof val === 'object') {
    return (
      <pre className={`mt-1 text-xs font-mono whitespace-pre-wrap break-words rounded p-2 max-h-56 overflow-auto border ${colorClass}`}>
        {JSON.stringify(val, null, 2)}
      </pre>
    );
  }
  return (
    <pre className={`mt-1 text-xs font-mono whitespace-pre-wrap break-words rounded p-2 max-h-56 overflow-auto border ${colorClass}`}>
      {String(val)}
    </pre>
  );
}

function DiffViewer({ value, depth = 0 }) {
  const indent = depth * 16;
  const fmt = formatDiffValue(value);

  if (fmt?.type === 'modified') {
    const oldVal = fmt.old;
    const newVal = fmt.new;
    const isComplex = isLongOrComplexValue(oldVal) || isLongOrComplexValue(newVal);

    if (isComplex) {
      return (
        <div className="space-y-2 w-full">
          <div>
            <span className="text-[10px] uppercase tracking-wide font-semibold text-red-500 dark:text-red-400">Previous</span>
            <ComplexValueBlock
              val={oldVal}
              colorClass="text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
            />
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide font-semibold text-emerald-600 dark:text-emerald-400">New</span>
            <ComplexValueBlock
              val={newVal}
              colorClass="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
            />
          </div>
        </div>
      );
    }

    const [oldStr, newStr] = [oldVal, newVal].map((v) =>
      v === null || v === undefined ? String(v) : typeof v === 'object' ? JSON.stringify(v) : String(v)
    );
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1">
        <span className="text-red-600 dark:text-red-400 line-through font-medium" title="Previous value">
          {oldStr}
        </span>
        <span className="text-[#4c669a] dark:text-gray-500 select-none">→</span>
        <span className="text-emerald-600 dark:text-emerald-400 font-medium" title="New value">
          {newStr}
        </span>
      </span>
    );
  }

  if (fmt?.type === 'array' && Array.isArray(fmt.items)) {
    return (
      <div className="mt-1 space-y-1">
        {fmt.items.map((item, i) => {
          if (Array.isArray(item) && item.length >= 2) {
            const [op, val] = item;
            const isDel = op === '-';
            const isAdd = op === '+';
            const isMod = op === '~';
            return (
              <div key={i} className="flex items-start gap-2 font-mono text-xs" style={{ paddingLeft: indent + 8 }}>
                <span
                  className={`shrink-0 w-5 text-center rounded ${
                    isDel ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : ''
                  } ${isAdd ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : ''} ${
                    isMod ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : ''
                  } ${op === ' ' ? 'text-gray-400 dark:text-gray-500' : ''}`}
                >
                  {op}
                </span>
                <div className="min-w-0 flex-1">
                  <DiffViewer value={val} depth={depth + 1} />
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="font-mono text-xs" style={{ paddingLeft: indent + 8 }}>
              <DiffViewer value={item} depth={depth + 1} />
            </div>
          );
        })}
      </div>
    );
  }

  if (fmt?.type === 'object' && fmt.value && typeof fmt.value === 'object' && !Array.isArray(fmt.value)) {
    const entries = Object.entries(fmt.value);
    return (
      <div className="mt-1 space-y-1.5" style={{ paddingLeft: indent }}>
        {entries.map(([k, v]) => {
          const kind = keyKind(k);
          const displayKey = keyDisplayName(k);
          const isDeleted = kind === 'deleted';
          const isAdded = kind === 'added';
          const valFmt = formatDiffValue(v);
          const isNestedObj = valFmt?.type === 'object' || valFmt?.type === 'array';
          return (
            <div key={k} className="font-mono text-xs">
              <div className="flex items-start gap-2 flex-wrap">
                <span
                  className={`shrink-0 font-semibold ${
                    isDeleted ? 'text-red-600 dark:text-red-400' : ''
                  } ${isAdded ? 'text-emerald-600 dark:text-emerald-400' : ''} ${
                    !isDeleted && !isAdded ? 'text-[#0d121b] dark:text-gray-200' : ''
                  }`}
                >
                  {displayKey}
                  {isDeleted && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-red-500 dark:text-red-400 font-normal">
                      removed
                    </span>
                  )}
                  {isAdded && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-emerald-500 dark:text-emerald-400 font-normal">
                      added
                    </span>
                  )}
                  <span className="text-gray-400 dark:text-gray-500 mx-0.5">:</span>
                </span>
                <div className="min-w-0 flex-1 break-words">
                  {isNestedObj ? <DiffViewer value={v} depth={depth + 1} /> : null}
                  {!isNestedObj && isDiffModified(v) ? <DiffViewer value={v} depth={depth + 1} /> : null}
                  {!isNestedObj && !isDiffModified(v) && (
                    <span
                      className={
                        isDeleted ? 'text-red-600/90 dark:text-red-400/90' : isAdded ? 'text-emerald-600/90 dark:text-emerald-400/90' : 'text-[#374151] dark:text-gray-400'
                      }
                    >
                      {typeof v === 'object' && v !== null ? <DiffViewer value={v} depth={depth + 1} /> : String(v)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (typeof value === 'object' && value !== null) {
    return (
      <pre className="mt-1 text-xs font-mono whitespace-pre-wrap break-words rounded p-2 max-h-56 overflow-auto border text-[#374151] dark:text-gray-300 bg-[#f8fafc] dark:bg-[#0f172a] border-[#e2e8f0] dark:border-[#334155]">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  if (typeof value === 'string' && (isXmlString(value) || value.length > 120)) {
    return (
      <pre className="mt-1 text-xs font-mono whitespace-pre-wrap break-words rounded p-2 max-h-56 overflow-auto border text-[#374151] dark:text-gray-300 bg-[#f8fafc] dark:bg-[#0f172a] border-[#e2e8f0] dark:border-[#334155]">
        {value}
      </pre>
    );
  }
  return <span className="text-[#374151] dark:text-gray-400">{String(value)}</span>;
}

function getMergedDetails(row) {
  if (!row) return '';
  const { activityDescription, newValue } = row;
  const parts = [];
  // if (activityName != null && String(activityName).trim()) parts.push(String(activityName).trim());
  if (activityDescription != null && String(activityDescription).trim()) parts.push(String(activityDescription).trim());
  if (newValue != null) {
    const v = typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue);
    if (v.trim()) parts.push(v.trim());
  }
  if (parts.length === 0) {
    const fallback = row.details ?? row.metadata ?? row.extra ?? '';
    return typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
  }
  return parts.join(DETAILS_SEP);
}

function formatTimestamp(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).replace(',', '');
  } catch {
    return String(value);
  }
}

function toISOStartOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function toISOEndOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function AuditLogging() {
  const authValue = useAtomValue(auth);
  const [pagination, _pagination] = useState({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [sorting, _sorting] = useState([{ id: 'createdAt', desc: true }]);
  const [searchQuery, _searchQuery] = useState('');
  const [appliedSearchQuery, _appliedSearchQuery] = useState('');
  const [fromDate, _fromDate] = useState('');
  const [toDate, _toDate] = useState('');
  const [selectedUserId, _selectedUserId] = useState(null);
  const [selectedModule, _selectedModule] = useState(null);
  const [selectedAction, _selectedAction] = useState(null);
  const [moduleOptions, _moduleOptions] = useState([]);
  const [actionOptions, _actionOptions] = useState([]);
  const [filterDrawerOpen, _filterDrawerOpen] = useState(false);
  const [detailsModal, _detailsModal] = useState(null);
  const [reloadKey, _reloadKey] = useState(0);

  // Fetch users list for the filter dropdown.
  // Re-fetch if authValue (token) changes, e.g., after a token refresh.
  const usersPromise = useMemo(() => {
    const token = decodeString(authValue);
    return token
      ? UserListRequest(token, { limit: 200 })
      : Promise.resolve({ data: [] });
  }, [authValue]);

  const auditPromise = useMemo(() => {
    const decodedToken = decodeString(authValue);
    if (!decodedToken) return Promise.resolve({ data: [], meta: { total: 0, page: 1, limit: DEFAULT_PAGE_SIZE, totalPages: 0 } });

    const sort = sorting.length > 0 ? sorting[0] : { id: 'createdAt', desc: true };
    const params = {
      page: pagination.pageIndex + 1,
      limit: pagination.pageSize,
      search: appliedSearchQuery || undefined,
      sortBy: sort.id,
      sortOrder: sort.desc ? 'desc' : 'asc',
      userId: selectedUserId?.value || undefined,
      entityType: selectedModule?.value || undefined,
      action: selectedAction?.value || undefined,
      fromDate: fromDate ? toISOStartOfDay(fromDate) : undefined,
      toDate: toDate ? toISOEndOfDay(toDate) : undefined,
    };

    return AuditListRequest(decodedToken, params);
  }, [authValue, pagination.pageIndex, pagination.pageSize, appliedSearchQuery, sorting, fromDate, toDate, selectedUserId, selectedModule, selectedAction, reloadKey]);

  const TableLoadingSkeleton = () => (
    <div className="breeze-table-card">
      <div className="px-6 py-8 text-center text-sm text-[var(--z3c-subtle)]">
        <div className="flex items-center justify-center gap-2">
          <span className="material-symbols-outlined animate-spin">sync</span>
          Loading audit logs...
        </div>
      </div>
    </div>
  );

  const PAGE_HEADER = () => (
    <div>
      <h2 className="breeze-page__title">Audit Logging</h2>
      <p className="breeze-page__lede">View and filter system audit logs</p>
    </div>
  );

  const hasActiveFilters = Boolean(
    selectedUserId || selectedModule || selectedAction || fromDate || toDate || appliedSearchQuery
  );

  const applySearch = () => {
    _appliedSearchQuery(searchQuery);
    _pagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const clearFilters = () => {
    _fromDate('');
    _toDate('');
    _selectedUserId(null);
    _selectedModule(null);
    _selectedAction(null);
    _searchQuery('');
    _appliedSearchQuery('');
    _pagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const FILTERS_SECTION = () => (
    <div className="breeze-toolbar">
      <div className="breeze-search">
        <div className="breeze-field__control">
          <span className="material-symbols-outlined breeze-field__icon">search</span>
          <input
            type="text"
            placeholder="Search audit logs..."
            value={searchQuery}
            onChange={(e) => _searchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            className="breeze-input"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
        <button
          type="button"
          onClick={() => _filterDrawerOpen(true)}
          className="breeze-btn breeze-btn--outline breeze-btn--inline w-full sm:w-auto"
          title="Filters"
        >
          <span className="material-symbols-outlined text-[20px]">filter_list</span>
          Filters
          {hasActiveFilters && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[rgba(43,124,245,0.14)] text-[var(--z3c-primary)] text-xs font-bold px-1.5">
              •
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => _reloadKey((k) => k + 1)}
          className="breeze-icon-btn self-center sm:self-auto"
          title="Refresh"
          aria-label="Refresh audit logs"
        >
          <span className="material-symbols-outlined">refresh</span>
        </button>
      </div>
    </div>
  );

  const FILTER_DRAWER = () => (
    <>
      <div
        className={`fixed inset-0 z-40 bg-[rgba(1,40,94,0.32)] backdrop-blur-sm transition-opacity duration-200 ${filterDrawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => _filterDrawerOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-[var(--z3c-border-card)] bg-[var(--z3c-surface-card)] shadow-[var(--z3c-shadow-card)] backdrop-blur-md transition-transform duration-200 ease-out ${
          filterDrawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Audit log filters"
      >
        <div className="flex items-center justify-between border-b border-[var(--z3c-divider)] px-5 py-4 sm:px-6">
          <h3 className="breeze-modal__title">Filters</h3>
          <button
            type="button"
            onClick={() => _filterDrawerOpen(false)}
            className="breeze-icon-btn"
            aria-label="Close filters"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
          <div className="breeze-form-field">
            <label className="breeze-field__label" htmlFor="audit-filter-from">From Date</label>
            <input
              id="audit-filter-from"
              type="date"
              value={fromDate}
              onChange={(e) => {
                _fromDate(e.target.value);
                _pagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
              className="breeze-form-input"
            />
          </div>
          <div className="breeze-form-field">
            <label className="breeze-field__label" htmlFor="audit-filter-to">To Date</label>
            <input
              id="audit-filter-to"
              type="date"
              value={toDate}
              onChange={(e) => {
                _toDate(e.target.value);
                _pagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
              className="breeze-form-input"
            />
          </div>
          <div className="w-full">
            <Suspense fallback={<div className="h-[var(--z3c-control-h)] rounded-[var(--z3c-radius-control)] border border-[var(--z3c-border-field)] bg-[var(--z3c-surface-field)]" />}>
              <UserFilterAsync
                usersPromise={usersPromise}
                selectedUserId={selectedUserId}
                _selectedUserId={_selectedUserId}
                onApply={() => _pagination((prev) => ({ ...prev, pageIndex: 0 }))}
              />
            </Suspense>
          </div>
          <div className="breeze-form-field">
            <label className="breeze-field__label" htmlFor="audit-filter-module">Filter by Module</label>
            <Select
              inputId="audit-filter-module"
              placeholder="All modules"
              isClearable
              value={selectedModule}
              onChange={(v) => {
                _selectedModule(v);
                _pagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
              options={moduleOptions}
              classNamePrefix="breeze-rs"
            />
          </div>
          <div className="breeze-form-field">
            <label className="breeze-field__label" htmlFor="audit-filter-action">Filter by Action</label>
            <Select
              inputId="audit-filter-action"
              placeholder="All actions"
              isClearable
              value={selectedAction}
              onChange={(v) => {
                _selectedAction(v);
                _pagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
              options={actionOptions}
              classNamePrefix="breeze-rs"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-[var(--z3c-divider)] bg-[rgba(224,237,244,0.45)] p-5 sm:p-6">
          <button
            type="button"
            onClick={() => _filterDrawerOpen(false)}
            className="breeze-btn breeze-btn--primary breeze-btn--inline w-full"
          >
            Done
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="breeze-btn breeze-btn--outline w-full"
          >
            Clear all
          </button>
        </div>
      </div>
    </>
  );

  const CONTENT = () => (
    <Fragment>
      {FILTER_DRAWER()}
      <div className="breeze-page flex-1">
        {PAGE_HEADER()}
        {FILTERS_SECTION()}
        <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
          <Suspense fallback={<TableLoadingSkeleton />}>
            <AuditTableContent
              auditPromise={auditPromise}
              usersPromise={usersPromise}
              pagination={pagination}
              sorting={sorting}
              _sorting={_sorting}
              _pagination={_pagination}
              onDetails={(row) => _detailsModal(row)}
              onAuditDataLoaded={(data) => {
                const modules = [...new Set((data || []).map((r) => r.entityType).filter(Boolean))];
                const actions = [...new Set((data || []).map((r) => r.action).filter(Boolean))];
                _moduleOptions((prev) => {
                  const byValue = new Map(prev.map((o) => [o.value, o]));
                  modules.forEach((m) => { if (!byValue.has(m)) byValue.set(m, { value: m, label: m }); });
                  return [...byValue.values()].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
                });
                _actionOptions((prev) => {
                  const byValue = new Map(prev.map((o) => [o.value, o]));
                  actions.forEach((a) => { if (!byValue.has(a)) byValue.set(a, { value: a, label: a }); });
                  return [...byValue.values()].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
                });
              }}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <Footer />
      {detailsModal != null && (
        <DetailsModal
          row={detailsModal}
          onClose={() => _detailsModal(null)}
        />
      )}
    </Fragment>
  );

  return (
    <div id="audit-logging" className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

function UserFilterAsync({ usersPromise, selectedUserId, _selectedUserId, onApply }) {
  const res = use(usersPromise);
  const options = useMemo(() => {
    const list = res?.data || [];
    return list.map((u) => ({
      value: u._id,
      label: u.username || u.email || u._id,
    }));
  }, [res]);

  return (
    <div className="breeze-form-field">
      <label className="breeze-field__label" htmlFor="audit-filter-user">Filter by User</label>
      <Select
        inputId="audit-filter-user"
        placeholder="All users"
        isClearable
        value={selectedUserId}
        onChange={(v) => {
          _selectedUserId(v);
          onApply?.();
        }}
        options={options}
        classNamePrefix="breeze-rs"
      />
    </div>
  );
}

function DetailsModal({ row, onClose }) {
  const activityDescription = row?.activityDescription != null ? String(row.activityDescription).trim() : '';
  const ipAddress = row?.ipAddress != null ? String(row.ipAddress).trim() : '';
  const newValue = row?.newValue;
  const hasStructuredDiff = newValue != null && typeof newValue === 'object' && !Array.isArray(newValue);
  const fallbackStr = getMergedDetails(row);

  return (
    <div className="breeze-modal" onClick={onClose}>
      <div
        className="breeze-modal__dialog breeze-modal__dialog--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-details-title"
      >
        <div className="breeze-modal__header flex items-center justify-between gap-3">
          <h3 id="audit-details-title" className="breeze-modal__title">Details</h3>
          <button
            type="button"
            onClick={onClose}
            className="breeze-icon-btn shrink-0"
            aria-label="Close details"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="breeze-modal__content">
          {activityDescription && (
            <p className="mb-4 pb-3 border-b border-[var(--z3c-divider)] text-sm text-[var(--z3c-subtle)]">
              {activityDescription}
            </p>
          )}
          {ipAddress && (
            <p className="mb-4 text-sm text-[var(--z3c-subtle)]">
              <span className="mr-1 font-semibold text-[var(--z3c-heading)]">IP Address:</span>
              <span className="font-mono">{ipAddress}</span>
            </p>
          )}
          {hasStructuredDiff ? (
            <div className="rounded-[var(--z3c-radius-control)] border border-[var(--z3c-border-field)] bg-[rgba(255,255,255,0.42)] p-4">
              <div className="mb-3 flex flex-wrap gap-3 text-[10px] uppercase tracking-wide text-[var(--z3c-hint)]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-4 rounded border border-red-200 bg-red-100 dark:border-red-800 dark:bg-red-900/50" />
                  Previous / removed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-4 rounded border border-emerald-200 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/50" />
                  New / added
                </span>
              </div>
              <DiffViewer value={newValue} depth={0} />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--z3c-heading)]">
              {fallbackStr || 'No details'}
            </pre>
          )}
        </div>
        <div className="breeze-modal__actions">
          <button
            type="button"
            onClick={onClose}
            className="breeze-btn breeze-btn--outline"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AuditTableContent({ auditPromise, usersPromise, pagination, sorting, _sorting, _pagination, onDetails, onAuditDataLoaded }) {
  const response = use(auditPromise);
  const usersResponse = use(usersPromise);
  const data = Array.isArray(response?.data) ? response.data : [];
  const onAuditDataLoadedRef = useRef(onAuditDataLoaded);
  onAuditDataLoadedRef.current = onAuditDataLoaded;
  useEffect(() => {
    if (data.length > 0 && onAuditDataLoadedRef.current) onAuditDataLoadedRef.current(data);
  }, [data]);

  const usersMap = useMemo(() => {
    const list = usersResponse?.data ?? [];
    return list.reduce((acc, u) => {
      if (u._id) acc[u._id] = u.email || u.username || u.name || u._id;
      return acc;
    }, {});
  }, [usersResponse]);
  const meta = response?.meta ?? {};
  const total = meta.total ?? 0;
  const page = meta.page ?? 1;
  const limit = meta.limit ?? DEFAULT_PAGE_SIZE;
  const totalPages = meta.totalPages ?? (Math.ceil(total / limit) || 1);

  const paginationInfo = {
    totalCount: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };

  const columns = useMemo(
    () => [
      {
        accessorKey: 'createdAt',
        id: 'createdAt',
        header: 'Timestamp',
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="text-xs sm:text-sm whitespace-nowrap">{formatTimestamp(getValue())}</span>
        ),
      },
      {
        id: 'user',
        header: 'User',
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original?.user ?? row.original?.userId;
          const rawId = typeof u === 'object' ? u?._id : u;
          const email = typeof u === 'object'
            ? (u?.email || u?.username || u?.name || (rawId && usersMap[rawId]) || rawId)
            : (usersMap[rawId] || rawId);
          return <span className="font-medium">{email || '-'}</span>;
        },
      },
      {
        accessorKey: 'entityType',
        header: 'Module',
        enableSorting: true,
        cell: ({ getValue }) => (
          <span>{getValue() ?? '-'}</span>
        ),
      },
      {
        accessorKey: 'action',
        header: 'Action',
        enableSorting: true,
        cell: ({ getValue }) => (
          <span>{getValue() ?? '-'}</span>
        ),
      },
      {
        id: 'details',
        header: 'Details',
        enableSorting: false,
        cell: ({ row }) => {
          const str = getMergedDetails(row.original);
          const truncated = str.length > DETAILS_TRUNCATE_LEN ? `${str.slice(0, DETAILS_TRUNCATE_LEN)}…` : str;
          const hasMore = str.length > DETAILS_TRUNCATE_LEN;

          return (
            <div className="max-w-md whitespace-normal">
              <span className="break-all text-[var(--z3c-subtle)]">
                {truncated || '-'}
              </span>
              {hasMore && (
                <button
                  type="button"
                  onClick={() => onDetails(row.original)}
                  className="breeze-link ml-2 text-sm"
                >
                  View
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [onDetails, usersMap]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: _sorting,
    onPaginationChange: _pagination,
    manualPagination: true,
    manualSorting: true,
    pageCount: totalPages,
    state: {
      sorting,
      pagination,
    },
  });

  const TABLE = () => (
    <div className="overflow-x-auto">
      <table className="min-w-[720px]">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''}
                  onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                >
                  <div className="flex items-center gap-2">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && (
                      <span className="material-symbols-outlined text-[16px]">
                        {{ asc: 'arrow_upward', desc: 'arrow_downward' }[header.column.getIsSorted()] || 'unfold_more'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="!text-center text-[var(--z3c-subtle)]">
                No audit logs found
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cell.column.id === 'details' ? '!whitespace-normal' : ''}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const PAGINATION_SECTION = () => (
    <div className="breeze-pager">
      <div className="breeze-pager__size">
        <span>Showing</span>
        <select
          value={pagination.pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
          className="breeze-select"
          aria-label="Rows per page"
        >
          {PAGINATION_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </div>
      <div className="breeze-pager__nav overflow-x-auto max-w-full">
        <button
          type="button"
          onClick={() => table.setPageIndex(0)}
          disabled={!paginationInfo.hasPreviousPage}
          className="breeze-pagebtn"
          aria-label="First page"
        >
          <span className="material-symbols-outlined">first_page</span>
        </button>
        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!paginationInfo.hasPreviousPage}
          className="breeze-pagebtn"
          aria-label="Previous page"
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <div className="flex items-center gap-1">
          {Array.from({ length: Math.min(5, paginationInfo.totalPages) }, (_, i) => {
            let pageNum;
            if (paginationInfo.totalPages <= 5) {
              pageNum = i + 1;
            } else if (pagination.pageIndex + 1 <= 3) {
              pageNum = i + 1;
            } else if (pagination.pageIndex + 1 >= paginationInfo.totalPages - 2) {
              pageNum = paginationInfo.totalPages - 4 + i;
            } else {
              pageNum = pagination.pageIndex - 1 + i;
            }
            return (
              <button
                type="button"
                key={pageNum}
                onClick={() => table.setPageIndex(pageNum - 1)}
                className={`breeze-pagebtn ${pagination.pageIndex + 1 === pageNum ? 'is-current' : ''}`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!paginationInfo.hasNextPage}
          className="breeze-pagebtn"
          aria-label="Next page"
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
        <button
          type="button"
          onClick={() => table.setPageIndex(paginationInfo.totalPages - 1)}
          disabled={!paginationInfo.hasNextPage}
          className="breeze-pagebtn"
          aria-label="Last page"
        >
          <span className="material-symbols-outlined">last_page</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="breeze-table-card">
      {TABLE()}
      {PAGINATION_SECTION()}
    </div>
  );
}

export default AuditLogging;
