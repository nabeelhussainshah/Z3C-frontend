function formatDelta(value) {
  if (value == null) return null;
  const num = parseFloat(value);
  if (isNaN(num)) return String(value);
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num}%`;
}

function deltaTone(value) {
  if (value == null || Number.isNaN(parseFloat(value))) return 'is-neutral';
  return parseFloat(value) >= 0 ? 'is-up' : 'is-down';
}

function buildStats(apiData) {
  // API shape: totalInvoices, clearedInvoices, rejectionRate each = { current, previous, deltaPercent }
  apiData = apiData?.data ?? apiData;
  const total = apiData?.totalInvoices?.current ?? apiData?.total_invoices?.current ?? null;
  const totalDelta = apiData?.totalInvoices?.deltaPercent ?? apiData?.total_invoices?.deltaPercent ?? null;
  const cleared = apiData?.clearedInvoices?.current ?? apiData?.cleared_invoices?.current ?? null;
  const clearedDelta = apiData?.clearedInvoices?.deltaPercent ?? apiData?.cleared_invoices?.deltaPercent ?? null;
  const rejectionRate = apiData?.rejectionRate?.current ?? apiData?.rejection_rate?.current ?? null;
  const rejectionRateDelta = apiData?.rejectionRate?.deltaPercent ?? apiData?.rejection_rate?.deltaPercent ?? null;

  return [
    {
      title: 'Total Invoices',
      value: total != null ? Number(total).toLocaleString() : '—',
      delta: formatDelta(totalDelta),
      deltaTone: deltaTone(totalDelta),
      icon: 'receipt_long',
      barPct: total != null ? Math.min(100, Math.round((total / 20000) * 100)) : 0,
    },
    {
      title: 'Cleared',
      value: cleared != null ? Number(cleared).toLocaleString() : '—',
      delta: formatDelta(clearedDelta),
      deltaTone: deltaTone(clearedDelta),
      icon: 'task_alt',
      iconTone: 'success',
      barTone: 'success',
      barPct: cleared != null && total != null
        ? Math.min(100, Math.round((cleared / Math.max(total, 1)) * 100))
        : 0,
    },
    {
      title: 'Rejection Rate',
      value: rejectionRate != null ? `${parseFloat(rejectionRate).toFixed(2)}%` : '—',
      delta: formatDelta(rejectionRateDelta),
      deltaTone: deltaTone(rejectionRateDelta != null ? -parseFloat(rejectionRateDelta) : null),
      icon: 'warning',
      iconTone: 'danger',
      barTone: 'danger',
      barPct: rejectionRate != null ? Math.min(100, Math.ceil(parseFloat(rejectionRate))) : 0,
    },
  ];
}

const SKELETON_CARD = () => (
  <article className="breeze-kpi is-skeleton" aria-hidden="true">
    <div className="breeze-kpi__head">
      <div className="breeze-skel h-4 w-28" />
      <div className="breeze-skel h-9 w-9 rounded-xl" />
    </div>
    <div className="breeze-kpi__value-row">
      <div className="breeze-skel h-7 w-20" />
      <div className="breeze-skel h-4 w-12" />
    </div>
    <div className="breeze-kpi__track">
      <div className="breeze-skel h-full w-2/3" />
    </div>
  </article>
);

function KpiStats({ stats: apiData, loading }) {
  if (loading) {
    return (
      <div className="breeze-kpi-grid">
        {[0, 1, 2].map((i) => <SKELETON_CARD key={i} />)}
      </div>
    );
  }

  const stats = buildStats(apiData);

  const STAT_CARD = (stat) => (
    <article key={stat.title} className="breeze-kpi">
      <div className="breeze-kpi__head">
        <p className="breeze-kpi__label">{stat.title}</p>
        <span
          className={`breeze-kpi__icon${stat.iconTone ? ` breeze-kpi__icon--${stat.iconTone}` : ''}`}
          aria-hidden="true"
        >
          <span className="material-symbols-outlined">{stat.icon}</span>
        </span>
      </div>
      <div className="breeze-kpi__value-row">
        <h3 className="breeze-kpi__value">{stat.value}</h3>
        {stat.delta && (
          <span className={`breeze-kpi__delta ${stat.deltaTone}`}>{stat.delta}</span>
        )}
      </div>
      <div className="breeze-kpi__track">
        <div
          className={`breeze-kpi__bar${stat.barTone ? ` breeze-kpi__bar--${stat.barTone}` : ''}`}
          style={{ width: `${stat.barPct}%` }}
        />
      </div>
    </article>
  );

  return (
    <div className="breeze-kpi-grid">
      {stats.map((stat) => STAT_CARD(stat))}
    </div>
  );
}

export default KpiStats;
