// Packages
import { Fragment, useState, useEffect, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';

// APIs
import {
  DashboardKpiStatsRequest,
  DashboardSubmissionTrendsRequest,
  DashboardRecentSubmissionsRequest,
} from '../../../requests';

// Utils
import { auth, loginInfo } from '../../../atoms';
import { decodeString, parseLoginInfo, getNormalizedModulePermissions } from '../../../utils';
import {
  PageHeader,
  KpiStats,
  TrendChart,
  RecentActivity,
  Footer,
} from '../../../components';

function getDefaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

function Dashboard() {
  const authValue = useAtomValue(auth);
  const loginInfoValue = useAtomValue(loginInfo);
  const navigate = useNavigate();

  const invoicePerms = useMemo(
    () => getNormalizedModulePermissions(parseLoginInfo(loginInfoValue), 'invoice'),
    [loginInfoValue]
  );

  const [dateRange, _dateRange] = useState(getDefaultDateRange);
  const [kpiStats, _kpiStats] = useState(null);
  const [trends, _trends] = useState(null);
  const [recentSubmissions, _recentSubmissions] = useState(null);
  const [loadingKpi, _loadingKpi] = useState(true);
  const [loadingTrends, _loadingTrends] = useState(true);
  const [loadingRecent, _loadingRecent] = useState(true);

  useEffect(() => {
    const token = decodeString(authValue);
    if (!token) return;

    _loadingKpi(true);
    DashboardKpiStatsRequest(token, { from: dateRange.from, to: dateRange.to })
      .then((data) => _kpiStats(data))
      .catch(() => {})
      .finally(() => _loadingKpi(false));

    _loadingTrends(true);
    DashboardSubmissionTrendsRequest(token, { from: dateRange.from, to: dateRange.to })
      .then((res) => _trends(Array.isArray(res) ? res : (res?.data?.data ?? res?.data ?? [])))
      .catch(() => {})
      .finally(() => _loadingTrends(false));

    _loadingRecent(true);
    DashboardRecentSubmissionsRequest(token, { limit: 5 })
      .then((res) => _recentSubmissions(Array.isArray(res) ? res : (res?.data?.data ?? res?.data ?? [])))
      .catch(() => {})
      .finally(() => _loadingRecent(false));
  }, [authValue, dateRange.from, dateRange.to]);

  // *********** Render Functions ***********

  const MAIN_CONTENT = () => (
    <div className="breeze-page flex-1">
      <PageHeader
        from={dateRange.from}
        to={dateRange.to}
        onDateChange={(from, to) => _dateRange({ from, to })}
      />
      <KpiStats stats={kpiStats} loading={loadingKpi} />
      <TrendChart trends={trends} loading={loadingTrends} />
      <RecentActivity
        submissions={recentSubmissions}
        loading={loadingRecent}
        showViewAll={invoicePerms.read}
        onViewAll={() => navigate('/invoices')}
      />
    </div>
  );

  const CONTENT = () => (
    <Fragment>
      {MAIN_CONTENT()}
      <Footer />
    </Fragment>
  );

  return (
    <div id="dashboard" className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

export default Dashboard;
