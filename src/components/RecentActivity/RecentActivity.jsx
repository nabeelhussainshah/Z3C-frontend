// Packages
import { Fragment } from 'react';

const STATUS_PILL = {
  CLEARED: 'breeze-pill breeze-pill--success',
  ACCEPTED: 'breeze-pill breeze-pill--success',
  REPORTED: 'breeze-pill breeze-pill--primary',
  REJECTED: 'breeze-pill breeze-pill--danger',
  PENDING: 'breeze-pill breeze-pill--warning',
};

function getPillClass(status) {
  const key = String(status ?? '').toUpperCase();
  return STATUS_PILL[key] ?? 'breeze-pill breeze-pill--muted';
}

function formatAmount(value) {
  if (value == null) return '—';
  const num = parseFloat(value);
  if (isNaN(num)) return String(value);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).replace(',', '');
  } catch {
    return String(value);
  }
}

function normalizeSubmission(s) {
  return {
    invoice: s.invoiceNumber ?? s.invoice_number ?? s.invoiceNo ?? s.invoice ?? '—',
    customer: s.customerName ?? s.customer_name ?? s.customer ?? '—',
    amount: formatAmount(s.amountSAR ?? s.totalAmount ?? s.total_amount ?? s.amount),
    date: formatDate(s.submissionDate ?? s.submittedAt ?? s.submitted_at ?? s.date ?? s.createdAt),
    status: String(s.status ?? '').toUpperCase(),
  };
}

const SKELETON_ROW = () => (
  <tr>
    {[0, 1, 2, 3, 4].map((i) => (
      <td key={i}>
        <span className="breeze-skel h-4 w-full" />
      </td>
    ))}
  </tr>
);

function RecentActivity({ submissions, loading, showViewAll = false, onViewAll }) {
  const list = Array.isArray(submissions) ? submissions : (submissions?.data?.data ?? submissions?.data ?? []);
  const rows = Array.isArray(list) ? list.map(normalizeSubmission) : [];

  const TABLE_HEADER = () => (
    <thead>
      <tr>
        <th>Invoice #</th>
        <th>Customer</th>
        <th>Amount (SAR)</th>
        <th>Submission Date</th>
        <th>Status</th>
      </tr>
    </thead>
  );

  const TABLE_ROW = (row) => (
    <tr key={`${row.invoice}-${row.date}`}>
      <td className="font-semibold">{row.invoice}</td>
      <td>{row.customer}</td>
      <td>{row.amount}</td>
      <td className="text-[var(--z3c-subtle)]">{row.date}</td>
      <td>
        <span className={getPillClass(row.status)}>
          {row.status || '—'}
        </span>
      </td>
    </tr>
  );

  const TABLE_BODY = () => (
    <tbody>
      {loading
        ? [0, 1, 2, 3, 4].map((i) => <SKELETON_ROW key={i} />)
        : rows.length > 0
          ? rows.map((row) => TABLE_ROW(row))
          : (
            <tr>
              <td colSpan={5} className="text-center text-[var(--z3c-subtle)]">
                No recent submissions
              </td>
            </tr>
          )
      }
    </tbody>
  );

  const HEADER_SECTION = () => (
    <div className="breeze-table-card__header">
      <h4 className="breeze-table-card__title">Recent Submissions</h4>
      {showViewAll && (
        <button type="button" onClick={onViewAll} className="breeze-link">
          View All
        </button>
      )}
    </div>
  );

  return (
    <div className="breeze-table-card">
      <Fragment>
        {HEADER_SECTION()}
        <div className="overflow-x-auto">
          <table>
            {TABLE_HEADER()}
            {TABLE_BODY()}
          </table>
        </div>
      </Fragment>
    </div>
  );
}

export default RecentActivity;
