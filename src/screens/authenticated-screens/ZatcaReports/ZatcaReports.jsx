// Packages
import { Fragment, useState, useMemo } from 'react';
import { useAtomValue } from 'jotai';
// APIs
import { ZatcaReportDownloadRequest } from '../../../requests';

//Utils
import { auth } from '../../../atoms';
import { Footer } from '../../../components';
import { showToast, decodeString } from '../../../utils';

const STATUS_GUIDE = [
  {
    label: 'All (Cleared or Reported)',
    description: 'Invoices that are either cleared or reported to ZATCA',
  },
  {
    label: 'Cleared',
    description: 'Only invoices with ZATCA clearance status',
  },
  {
    label: 'Reported',
    description: 'Only invoices that have been reported to ZATCA',
  },
  {
    label: 'Not Reported',
    description: 'Invoices that have not been cleared or reported (no ZATCA response)',
  },
];

function ZatcaReports() {
  const authValue = useAtomValue(auth);
  const decodedToken = useMemo(() => decodeString(authValue), [authValue]);
  const [filters, _filters] = useState({
    fromDate: '',
    toDate: '',
    zatcaStatus: '',
  });
  const [isLoading, setIsLoading] = useState(false);

  // *********** Handlers ***********
  const handleDownloadReport = async () => {
    if (!filters.fromDate || !filters.toDate) {
      showToast('From Date and To Date are required to download the report', 'error');
      return;
    }

    if (isLoading) {
      showToast('Please wait for the previous download to complete', 'error');
      return;
    }

    try {
      setIsLoading(true);
      const excelBlob = await ZatcaReportDownloadRequest(decodedToken, filters);
      // Ensure correct MIME type and force download with .xlsx filename
      const typedBlob =
        excelBlob && excelBlob.type
          ? excelBlob
          : new Blob([excelBlob], {
              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });

      const fileURL = window.URL.createObjectURL(typedBlob);
      const link = document.createElement('a');

      const from = filters.fromDate || 'ALL';
      const to = filters.toDate || 'ALL';
      const status = filters.zatcaStatus || 'ALL';
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

      link.href = fileURL;
      link.download = `zatca-invoice-report_${from}_to_${to}_${status}_${timestamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showToast('Excel report download started', 'success');

      setTimeout(() => {
        window.URL.revokeObjectURL(fileURL);
      }, 10000);
    } catch (error) {
      showToast(error?.message || 'Failed to download ZATCA report', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // *********** Render Functions ***********
  const PAGE_HEADER = () => (
    <div>
      <h2 className="breeze-page__title">ZATCA Invoice Reporting</h2>
      <p className="breeze-page__lede">
        Export invoice reports by date range and ZATCA status.
      </p>
    </div>
  );

  const FILTERS_CARD = () => (
    <div className="breeze-form-card">
      <form
        className="breeze-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleDownloadReport();
        }}
        noValidate
      >
        <section className="breeze-form-section">
          <div className="breeze-form-section__header">
            <span className="breeze-form-section__badge" aria-hidden="true">
              <span className="material-symbols-outlined">filter_alt</span>
            </span>
            <div>
              <h3 className="breeze-form-section__title">Export Filters</h3>
              <p className="breeze-form-section__lede">
                Choose a date range and status, then download an Excel report organized by month.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-5 items-end">
            <div className="breeze-form-field">
              <label className="breeze-field__label" htmlFor="zatca-report-from-date">
                From Date
                <span className="breeze-form-required" aria-hidden="true"> *</span>
              </label>
              <input
                id="zatca-report-from-date"
                type="date"
                required
                className="breeze-form-input"
                value={filters.fromDate}
                onChange={(e) =>
                  _filters((prev) => ({
                    ...prev,
                    fromDate: e.target.value,
                  }))
                }
              />
            </div>

            <div className="breeze-form-field">
              <label className="breeze-field__label" htmlFor="zatca-report-to-date">
                To Date
                <span className="breeze-form-required" aria-hidden="true"> *</span>
              </label>
              <input
                id="zatca-report-to-date"
                type="date"
                required
                className="breeze-form-input"
                value={filters.toDate}
                onChange={(e) =>
                  _filters((prev) => ({
                    ...prev,
                    toDate: e.target.value,
                  }))
                }
              />
            </div>

            <div className="breeze-form-field">
              <label className="breeze-field__label" htmlFor="zatca-report-status">
                ZATCA Status
              </label>
              <select
                id="zatca-report-status"
                className="breeze-select"
                value={filters.zatcaStatus || ''}
                onChange={(e) =>
                  _filters((prev) => ({
                    ...prev,
                    zatcaStatus: e.target.value,
                  }))
                }
              >
                <option value="" disabled>
                  ZATCA Status
                </option>
                <option value="ALL">All (Cleared or Reported)</option>
                <option value="CLEARED">Cleared</option>
                <option value="REPORTED">Reported</option>
                <option value="NOT_REPORTED">Not Reported</option>
              </select>
            </div>

            <div className="breeze-form-field">
              <button
                type="submit"
                className="breeze-btn breeze-btn--primary breeze-btn--inline w-full min-w-0"
                disabled={isLoading || !filters.fromDate || !filters.toDate}
              >
                {isLoading ? (
                  <Fragment>
                    <span className="breeze-btn__spinner" aria-hidden="true" />
                    Downloading...
                  </Fragment>
                ) : (
                  <Fragment>
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Download
                  </Fragment>
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="breeze-form-section">
          <div className="breeze-form-section__header">
            <span className="breeze-form-section__badge" aria-hidden="true">
              <span className="material-symbols-outlined">info</span>
            </span>
            <div>
              <h3 className="breeze-form-section__title">Status Options</h3>
              <p className="breeze-form-section__lede">
                This report exports invoices based on the selected filters. The exported file
                is organized by month with a separate sheet for each month.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {STATUS_GUIDE.map((item) => (
              <div
                key={item.label}
                className="rounded-[12px] border border-[var(--z3c-border-card)] bg-white/40 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <p className="m-0 text-[13px] font-semibold text-[var(--z3c-heading)]">
                  {item.label}
                </p>
                <p className="mt-1 mb-0 text-[12.5px] leading-[18px] text-[var(--z3c-subtle)]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </form>
    </div>
  );

  const CONTENT = () => (
    <Fragment>
      <div className="breeze-page flex-1">
        {PAGE_HEADER()}
        {FILTERS_CARD()}
      </div>
      <Footer />
    </Fragment>
  );

  return (
    <div id="zatca-reports" className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

export default ZatcaReports;
