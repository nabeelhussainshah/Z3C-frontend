// Packages
import { Fragment, useMemo } from 'react';
import { Chart } from 'react-google-charts';

import { useTheme } from '../../contexts/ThemeContext';

/**
 * Transforms the API trends array into Google Charts ColumnChart format.
 * Accepts either an array or wrapped response { data: { data: [...] } }.
 * Expects items shaped as: { date, cleared, reported }
 */
function buildChartData(trends) {
  const list = Array.isArray(trends) ? trends : (trends?.data?.data ?? trends?.data ?? []);
  if (!Array.isArray(list) || list.length === 0) return null;

  const hasReported = list.some((t) => t.reported != null);
  const header = hasReported ? ['Date', 'Cleared', 'Reported'] : ['Date', 'Cleared'];

  const rows = list.map((t) => {
    const raw = t.date ?? t.submittedAt ?? t.day ?? '';
    let label = raw;
    try {
      const d = new Date(raw);
      if (!isNaN(d)) {
        const day = d.getDate();
        const month = d.toLocaleString('default', { month: 'short' });
        label = `${day} ${month}`;
      }
    } catch { /* keep raw */ }

    const cleared = Number(t.cleared ?? t.clearedCount ?? 0);
    if (hasReported) {
      return [label, cleared, Number(t.reported ?? t.reportedCount ?? 0)];
    }
    return [label, cleared];
  });

  return [header, ...rows];
}

function getChartOptions(isDark) {
  const axis = isDark ? '#9bb6d4' : '#33639B';
  const grid = isDark ? 'rgba(255,255,255,0.08)' : '#DAE7F7';

  return {
    title: '',
    chartArea: {
      width: '78%',
      height: '70%',
      left: 48,
      top: 16,
      right: 16,
      bottom: 48,
    },
    hAxis: {
      title: '',
      textStyle: { color: axis, fontSize: 10, fontName: 'Inter' },
      gridlines: { color: 'transparent' },
    },
    vAxis: {
      title: '',
      textStyle: { color: axis, fontSize: 10, fontName: 'Inter' },
      gridlines: { color: grid },
      baselineColor: grid,
    },
    legend: { position: 'none' },
    colors: ['#2B7CF5', '#B4D7EE'],
    backgroundColor: 'transparent',
    isStacked: false,
    bar: { groupWidth: '68%' },
  };
}

function TrendChart({ trends, loading }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const chartData = buildChartData(trends);
  const hasReported = chartData && chartData[0]?.length === 3;
  const options = useMemo(() => getChartOptions(isDark), [isDark]);

  const HEADER_SECTION = () => (
    <div className="breeze-chart-card__header">
      <div>
        <h4 className="breeze-chart-card__title">Submission Trends</h4>
        <p className="breeze-chart-card__lede">Daily submission volume</p>
      </div>
      <div className="breeze-legend">
        <div className="breeze-legend__item">
          <span className="breeze-legend__dot breeze-legend__dot--cleared" aria-hidden="true" />
          <span>Cleared</span>
        </div>
        {hasReported && (
          <div className="breeze-legend__item">
            <span className="breeze-legend__dot breeze-legend__dot--reported" aria-hidden="true" />
            <span>Reported</span>
          </div>
        )}
      </div>
    </div>
  );

  const CHART_SECTION = () => {
    if (loading) {
      return (
        <div className="breeze-chart-card__empty" aria-hidden="true">
          <div className="breeze-skel h-full w-full rounded-xl" />
        </div>
      );
    }

    if (!chartData) {
      return (
        <div className="breeze-chart-card__empty">
          No trend data available
        </div>
      );
    }

    return (
      <div className="breeze-chart-card__canvas">
        <Chart
          chartType="ColumnChart"
          width="100%"
          height="100%"
          data={chartData}
          options={options}
        />
      </div>
    );
  };

  return (
    <div className="breeze-chart-card">
      <Fragment>
        {HEADER_SECTION()}
        {CHART_SECTION()}
      </Fragment>
    </div>
  );
}

export default TrendChart;
