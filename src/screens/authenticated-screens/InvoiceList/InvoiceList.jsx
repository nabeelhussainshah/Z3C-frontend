// Packages
import { Fragment, useMemo, useState, Suspense, use, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel, flexRender } from '@tanstack/react-table';
import { ErrorBoundary } from 'react-error-boundary';
import { useAtomValue } from 'jotai';

// APIs
import {
  InvoiceListRequest,
  InvoiceDeleteRequest,
  InvoicePdfDownloadRequest,
  InvoiceProformaPdfDownloadRequest,
  InvoiceCreateCreditNoteRequest,
  InvoiceCreateDebitNoteRequest,
  InvoiceSubmitToZatcaRequest,
  InvoiceCheckComplianceRequest,
} from '../../../requests';

// Utils 
import { auth, loginInfo } from '../../../atoms';
import { Footer, ErrorFallback, ConfirmModal, ZatcaXmlViewer } from '../../../components';
import { DEFAULT_PAGE_SIZE, PAGINATION_PAGE_SIZES, decodeString, showToast, parseLoginInfo, getNormalizedModulePermissions, INVOICE_STATUSES, isInvoiceDeletable as canDeleteInvoice } from '../../../utils';

const STATUS_FILTER_OPTIONS = [
  'DRAFT', 'SUBMITTED', 'PENDING_SUBMISSION',
  'COMPLIANCE_QUEUED', 'COMPLIANCE_PROCESSING', 'COMPLIANCE_COMPLETED', 'COMPLIANCE_FAILED',
  'PENDING_CLEARANCE', 'CLEARANCE_QUEUED', 'CLEARANCE_PROCESSING',
  'CLEARED', 'ACCEPTED', 'REJECTED', 'FINALIZED', 'REPORTED',
];
const INVOICE_TYPE_FILTER_OPTIONS = ['B2B', 'B2C', 'B2G', 'CREDIT_NOTE', 'DEBIT_NOTE'];
const PAYMENT_TYPE_FILTER_OPTIONS = ['CASH', 'CREDIT_CARD', 'BANK_TRANSFER', 'CHECK', 'BANK_CARD', 'OTHER'];

function InvoiceList() {
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const loginInfoValue = useAtomValue(loginInfo);

  const user = useMemo(() => parseLoginInfo(loginInfoValue), [loginInfoValue]);
  const invoicePerms = useMemo(() => getNormalizedModulePermissions(user, 'invoice'), [user]);

  const [pagination, _pagination] = useState({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [sorting, _sorting] = useState([]);
  const [searchQuery, _searchQuery] = useState('');
  const [appliedSearchQuery, _appliedSearchQuery] = useState('');
  const [isFilterOpen, _isFilterOpen] = useState(false);
  const [rowSelection, _rowSelection] = useState({});
  const [isBulkDeleteModalOpen, _isBulkDeleteModalOpen] = useState(false);
  const [reloadKey, _reloadKey] = useState(0);

  // Filters state
  const [filters, _filters] = useState({
    status: '',
    invoiceType: '',
    paymentType: '',
    fromDate: '',
    toDate: '',
  });

  const invoicesPromise = useMemo(() => {
    const decodedToken = decodeString(authValue);
    const params = {
      page: pagination.pageIndex + 1,
      limit: pagination.pageSize,
      search: appliedSearchQuery || undefined,
      sortBy: sorting.length > 0 ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : undefined,
      status: filters.status || undefined,
      invoiceType: filters.invoiceType || undefined,
      paymentType: filters.paymentType || undefined,
      fromDate: filters.fromDate ? new Date(filters.fromDate).toISOString() : undefined,
      toDate: filters.toDate ? new Date(`${filters.toDate}T23:59:59`).toISOString() : undefined,
    };

    return InvoiceListRequest(decodedToken, params);
  }, [authValue, pagination.pageIndex, pagination.pageSize, appliedSearchQuery, sorting, filters, reloadKey]);

  const selectedRowCount = Object.keys(rowSelection).filter((key) => rowSelection[key]).length;

  // *********** Handlers ***********

  // A selection only covers the rows on screen, so it is cleared whenever they change.
  const clearSelectionThen = (setter) => (value) => {
    _rowSelection({});
    setter(value);
  };

  const handleFilterChange = (key, value) => {
    _rowSelection({});
    _filters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    _rowSelection({});
    _filters({
      status: '',
      invoiceType: '',
      paymentType: '',
      fromDate: '',
      toDate: '',
    });
    _pagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const applyFilters = () => {
    _pagination((prev) => ({ ...prev, pageIndex: 0 }));
    _isFilterOpen(false);
  };

  // *********** Render Functions ***********

  const TableLoadingSkeleton = () => (
    <div className="breeze-table-card">
      <div className="px-6 py-8 text-center text-sm text-[var(--z3c-subtle)]">
        <div className="flex items-center justify-center gap-2">
          <span className="material-symbols-outlined animate-spin">sync</span>
          Loading Invoices...
        </div>
      </div>
    </div>
  );

  const PAGE_HEADER = () => (
    <div>
      <h2 className="breeze-page__title">Invoices</h2>
      <p className="breeze-page__lede">Manage and track your electronic invoices</p>
    </div>
  );

  const SEARCH_FILTERS_SECTION = () => (
    <div className="breeze-toolbar">
      <div className="breeze-search">
        <div className="breeze-field__control">
          <span className="material-symbols-outlined breeze-field__icon">search</span>
          <input
            type="text"
            placeholder="Search invoices..."
            value={searchQuery}
            onChange={(e) => _searchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                _rowSelection({});
                _appliedSearchQuery(searchQuery);
                _pagination((prev) => ({ ...prev, pageIndex: 0 }));
              }
            }}
            className="breeze-input"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
        {selectedRowCount > 0 && invoicePerms.delete && (
          <button
            type="button"
            onClick={() => _isBulkDeleteModalOpen(true)}
            className="breeze-btn breeze-btn--danger-soft"
          >
            <span className="material-symbols-outlined text-[20px]">delete</span>
            Delete ({selectedRowCount})
          </button>
        )}

        <div className="relative w-full sm:w-auto">
          <button
            type="button"
            onClick={() => _isFilterOpen(!isFilterOpen)}
            className="breeze-btn breeze-btn--outline breeze-btn--inline w-full sm:w-auto"
          >
            <span className="material-symbols-outlined text-[20px]">filter_list</span>
            Filters
            <span className="material-symbols-outlined text-[16px]">
              {isFilterOpen ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {isFilterOpen && (
            <div className="breeze-panel left-0 right-0 sm:left-auto w-auto sm:w-80 max-h-[70vh] overflow-y-auto">
              <div className="space-y-4">
                <div>
                  <label className="breeze-panel__label" htmlFor="invoice-filter-status">Status</label>
                  <select
                    id="invoice-filter-status"
                    value={filters.status}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                    className="breeze-select"
                  >
                    <option value="">All</option>
                    {STATUS_FILTER_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="breeze-panel__label" htmlFor="invoice-filter-type">Invoice Type</label>
                  <select
                    id="invoice-filter-type"
                    value={filters.invoiceType}
                    onChange={(e) => handleFilterChange('invoiceType', e.target.value)}
                    className="breeze-select"
                  >
                    <option value="">All</option>
                    {INVOICE_TYPE_FILTER_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="breeze-panel__label" htmlFor="invoice-filter-payment">Payment Type</label>
                  <select
                    id="invoice-filter-payment"
                    value={filters.paymentType}
                    onChange={(e) => handleFilterChange('paymentType', e.target.value)}
                    className="breeze-select"
                  >
                    <option value="">All</option>
                    {PAYMENT_TYPE_FILTER_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="breeze-panel__label">Date Range</p>
                  <div className="space-y-2">
                    <div>
                      <label className="breeze-field__label" htmlFor="invoice-filter-from">From</label>
                      <input
                        id="invoice-filter-from"
                        type="date"
                        value={filters.fromDate}
                        onChange={(e) => handleFilterChange('fromDate', e.target.value)}
                        className="breeze-form-input"
                      />
                    </div>
                    <div>
                      <label className="breeze-field__label" htmlFor="invoice-filter-to">To</label>
                      <input
                        id="invoice-filter-to"
                        type="date"
                        value={filters.toDate}
                        onChange={(e) => handleFilterChange('toDate', e.target.value)}
                        className="breeze-form-input"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t border-[var(--z3c-divider)]">
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="breeze-link flex-1"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={applyFilters}
                    className="breeze-btn breeze-btn--primary breeze-btn--inline flex-1"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {invoicePerms.create && (
          <button
            type="button"
            onClick={() => navigate('/invoices/new')}
            className="breeze-btn breeze-btn--primary breeze-btn--inline w-full sm:w-auto"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Create Invoice
          </button>
        )}
      </div>
    </div>
  );

  const CONTENT = () => (
    <Fragment>
      <div className="breeze-page flex-1">
        {PAGE_HEADER()}
        {SEARCH_FILTERS_SECTION()}
        <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
          <Suspense fallback={<TableLoadingSkeleton />}>
            <InvoicesTableContent
              invoicesPromise={invoicesPromise}
              pagination={pagination}
              _pagination={clearSelectionThen(_pagination)}
              sorting={sorting}
              _sorting={clearSelectionThen(_sorting)}
              rowSelection={rowSelection}
              _rowSelection={_rowSelection}
              isBulkDeleteModalOpen={isBulkDeleteModalOpen}
              onBulkDeleteModalClose={() => _isBulkDeleteModalOpen(false)}
              onBulkDeleteComplete={() => {
                _isBulkDeleteModalOpen(false);
                _rowSelection({});
              }}
              refreshInvoices={() => _reloadKey((prev) => prev + 1)}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <Footer />
    </Fragment>
  );

  return (
    <div id="invoice-list" className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

function InvoicesTableContent({
  invoicesPromise,
  pagination,
  _pagination,
  sorting,
  _sorting,
  rowSelection,
  _rowSelection,
  isBulkDeleteModalOpen,
  onBulkDeleteModalClose,
  onBulkDeleteComplete,
  refreshInvoices,
}) {
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const loginInfoValue = useAtomValue(loginInfo);
  const user = useMemo(() => parseLoginInfo(loginInfoValue), [loginInfoValue]);
  const invoicePerms = useMemo(() => getNormalizedModulePermissions(user, 'invoice'), [user]);
  const decodedToken = useMemo(() => decodeString(authValue), [authValue]);
  const response = use(invoicesPromise);
  // API returns { data: [...] | { data: [], meta }, meta: { total, page, limit, totalPages } }
  const data = Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.data) ? response.data.data : [];
  const meta = response?.meta ?? response?.data?.meta ?? {};
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

  const [isDeleteModalOpen, _isDeleteModalOpen] = useState(false);
  const [selectedInvoiceId, _selectedInvoiceId] = useState(null);
  const [isDeleting, _isDeleting] = useState(false);
  const [isBulkDeleting, _isBulkDeleting] = useState(false);
  const [actionBusyId, _actionBusyId] = useState(null);
  const [isComplianceResponseModalOpen, _isComplianceResponseModalOpen] = useState(false);
  const [complianceResponseToShow, _complianceResponseToShow] = useState(null);
  const [isClearanceResponseModalOpen, _isClearanceResponseModalOpen] = useState(false);
  const [clearanceResponseToShow, _clearanceResponseToShow] = useState(null);
  // Invoice whose ZATCA XML is open in the viewer: { id, invoiceNumber }
  const [xmlInvoice, _xmlInvoice] = useState(null);
  const handleCloseXmlViewer = useCallback(() => _xmlInvoice(null), []);

  // *********** Handlers ***********

  const handleReportToZatca = useCallback(
    async (invoiceId) => {
      if (!invoiceId || actionBusyId) return;
      try {
        _actionBusyId(invoiceId);
        await InvoiceSubmitToZatcaRequest(decodedToken, invoiceId);
        showToast('Invoice submitted to ZATCA successfully!', 'success');
        refreshInvoices?.();
      } catch (err) {
        showToast(err?.message || 'Failed to submit invoice to ZATCA', 'error');
      } finally {
        _actionBusyId(null);
      }
    },
    [decodedToken, actionBusyId, refreshInvoices]
  );

  const handleCheckCompliance = useCallback(
    async (invoiceId) => {
      if (!invoiceId || actionBusyId) return;
      try {
        _actionBusyId(invoiceId);
        await InvoiceCheckComplianceRequest(decodedToken, invoiceId);
        showToast('Invoice compliance check queued successfully!', 'success');
        refreshInvoices?.();
      } catch (err) {
        showToast(err?.message || 'Failed to queue invoice compliance check', 'error');
      } finally {
        _actionBusyId(null);
      }
    },
    [decodedToken, actionBusyId, refreshInvoices]
  );

  const handleOpenDeleteModal = (invoiceId) => {
    if (!invoiceId) return;
    _selectedInvoiceId(invoiceId);
    _isDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    if (isDeleting) return;
    _isDeleteModalOpen(false);
    _selectedInvoiceId(null);
  };

  const handleOpenComplianceResponseModal = (invoice) => {
    const raw = invoice?.compliance?.zatcaResponse;
    _complianceResponseToShow(typeof raw === 'string' ? raw : raw != null ? JSON.stringify(raw) : null);
    _isComplianceResponseModalOpen(true);
  };

  const handleCloseComplianceResponseModal = () => {
    _isComplianceResponseModalOpen(false);
    _complianceResponseToShow(null);
  };

  const handleOpenClearanceResponseModal = (invoice) => {
    const raw = invoice?.clearance?.zatcaResponse;
    _clearanceResponseToShow(typeof raw === 'string' ? raw : raw != null ? JSON.stringify(raw) : null);
    _isClearanceResponseModalOpen(true);
  };

  const handleCloseClearanceResponseModal = () => {
    _isClearanceResponseModalOpen(false);
    _clearanceResponseToShow(null);
  };

  const isInvoiceDeletable = useCallback(
    (invoice) => canDeleteInvoice(invoice, invoicePerms.delete),
    [invoicePerms.delete]
  );

  const handleCloseBulkDeleteModal = () => {
    if (isBulkDeleting) return;
    onBulkDeleteModalClose?.();
  };

  const handleConfirmDelete = useCallback(() => {
    if (!selectedInvoiceId) return;

    _isDeleting(true);
    InvoiceDeleteRequest(decodedToken, selectedInvoiceId)
      .then(() => {
        showToast('Invoice deleted successfully!', 'success');
        handleCloseDeleteModal();
        refreshInvoices?.();
      })
      .catch((err) => {
        showToast(err?.message || 'Failed to delete invoice', 'error');
      })
      .finally(() => {
        _isDeleting(false);
      });
  }, [decodedToken, selectedInvoiceId, refreshInvoices]);

  const setNotePayloadForInvoice = (invoice) => {
    if (!invoice) return null;

    const {
      lineItems = [],
      vat,
      paymentType,
      paymentTerms,
      deliveryDate,
      currency,
      note,
    } = invoice;

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return null;
    }

    return {
      noteReason: 'CANCELLATION_OR_TERMINATION',
      lineItems: lineItems.map((item) => ({
        description: item.description,
        productCode: item.productCode,
        quantity: item.quantity,
        price: item.price,
        discount_amount: item.discount_amount,
        discount_percentage: item.discount_percentage,
        taxExempt: item.taxExempt,
        taxExemptReason: item.taxExemptReason,
        ...(item.taxExempt && item.taxExemptionCode && { taxExemptionCode: item.taxExemptionCode }),
      })),
      vat: vat ?? 15,
      paymentType: paymentType || 'CASH',
      paymentTerms: paymentTerms || '',
      deliveryDate: deliveryDate || '',
      currency: currency || 'SAR',
      note: note || '',
    };
  };

  const handleCreateCreditNote = useCallback(
    async (invoice) => {
      if (!invoice?._id) {
        return;
      }

      const payload = setNotePayloadForInvoice(invoice);

      if (!payload) {
        showToast('Cannot create credit note: invoice has no line items.', 'error');
        return;
      }

      try {
        await InvoiceCreateCreditNoteRequest(decodedToken, invoice._id, JSON.stringify(payload));
        showToast('Credit note created successfully!', 'success');
        refreshInvoices?.();
      } catch (error) {
        showToast(error?.message || 'Failed to create credit note', 'error');
      }
    },
    [decodedToken, refreshInvoices]
  );

  const handleCreateDebitNote = useCallback(
    async (invoice) => {
      if (!invoice?._id) {
        return;
      }

      const payload = setNotePayloadForInvoice(invoice);

      if (!payload) {
        showToast('Cannot create debit note: invoice has no line items.', 'error');
        return;
      }

      try {
        await InvoiceCreateDebitNoteRequest(decodedToken, invoice._id, JSON.stringify(payload));
        showToast('Debit note created successfully!', 'success');
        refreshInvoices?.();
      } catch (error) {
        showToast(error?.message || 'Failed to create debit note', 'error');
      }
    },
    [decodedToken, refreshInvoices]
  );

  const handleRowClick = useCallback((row, event) => {
    if (!row.original?._id) return;
    if (
      event.target.closest('input[type="checkbox"]') ||
      event.target.closest('button') ||
      event.target.closest('a')
    ) return;

    navigate(`/invoices/${row.original._id}`);
  }, [navigate]);

  const handlePrintInvoice = async (invoiceId) => {
    if (!invoiceId) return;
    try {
      const pdfBlob = await InvoicePdfDownloadRequest(decodedToken, invoiceId);
      const fileURL = window.URL.createObjectURL(pdfBlob);

      const pdfWindow = window.open(fileURL, '_blank');

      if (!pdfWindow) {
        showToast('Please allow popups to view the invoice PDF', 'error');
      }

      // Revoke the object URL after some time to free memory
      setTimeout(() => {
        window.URL.revokeObjectURL(fileURL);
      }, 10000);
    } catch (error) {
      showToast(error?.message || 'Failed to download invoice PDF', 'error');
    }
  };

  const handlePrintProformaInvoice = async (invoiceId) => {
    if (!invoiceId) return;
    try {
      const pdfBlob = await InvoiceProformaPdfDownloadRequest(decodedToken, invoiceId);
      const fileURL = window.URL.createObjectURL(pdfBlob);

      const pdfWindow = window.open(fileURL, '_blank');

      if (!pdfWindow) {
        showToast('Please allow popups to view the proforma invoice PDF', 'error');
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(fileURL);
      }, 10000);
    } catch (error) {
      showToast(error?.message || 'Failed to download proforma invoice PDF', 'error');
    }
  };

  const columns = useMemo(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            className="breeze-check__box"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            className="breeze-check__box"
            aria-label={`Select ${row.original.invoiceNumber}`}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: 'invoiceNumber',
        header: 'Invoice No.',
        enableSorting: true,
      },
      {
        accessorKey: 'referenceNumber',
        header: 'Reference No.',
        enableSorting: true,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        enableSorting: true,
        cell: ({ getValue }) => {
          const status = getValue();
          const statusConfig = INVOICE_STATUSES.find(
            (invoiceStatus) => invoiceStatus.name === status
          );
          const colorClass = statusConfig?.color || 'bg-gray-500';
          return (
            <span className={`breeze-pill text-white ${colorClass}`}>
              {status}
            </span>
          );
        },
      },
      {
        accessorKey: 'paymentTerms',
        header: 'Payment Term',
        enableSorting: true,
      },
      {
        accessorKey: 'emailSentCounter',
        header: 'Emails Sent',
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">mail</span>
            {getValue() || 0}
          </span>
        ),
      },
      {
        accessorKey: 'invoicePaid',
        header: 'Invoice Paid',
        enableSorting: true,
        cell: ({ getValue }) => {
          const paid = getValue();
          return (
            <span className={`breeze-pill ${paid === 'Yes' ? 'breeze-pill--success' : 'breeze-pill--muted'}`}>
              {paid}
            </span>
          );
        },
      },
      {
        accessorKey: 'invoiceType',
        header: 'Type',
        enableSorting: true,
      },
      {
        id: 'customerName',
        header: 'Customer',
        enableSorting: true,
        cell: ({ row }) => row.original.customerId?.registrationName || 'N/A'
      },
      {
        id: 'createdBy',
        header: 'Created By',
        enableSorting: true,
        cell: ({ row }) => row.original.createdBy?.username || 'N/A'
      },
      {
        // Grand total in the invoice's own currency, labelled with that currency.
        // (totalsInSAR is the SAR equivalent — for a USD invoice it is not a USD amount.)
        id: 'totalsInCurrency.grandTotal',
        accessorFn: (row) => row.totalsInCurrency?.grandTotal ?? row.totalsInSAR?.grandTotal,
        header: 'Grand Total',
        enableSorting: true,
        cell: ({ getValue, row }) => {
          const currency = row.original.currency || 'SAR';
          return <span className="font-bold">{getValue()?.toLocaleString()} {currency}</span>;
        },
      },
      {
        accessorKey: 'paymentType',
        header: 'Payment Type',
        enableSorting: true,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const statusConfig = INVOICE_STATUSES.find(
            (status) => status.name === row.original.status
          );
          const canDelete = isInvoiceDeletable(row.original);
          const canReportToZatca = !!statusConfig?.canSubmitToZatca;
          const canCreateCreditNote = !!statusConfig?.canCreateCreditNote;
          const canCreateDebitNote = !!statusConfig?.canCreateDebitNote;
          const canCheckCompliance = !!statusConfig?.canCheckCompliance;
          const canPrintProforma = row.original.status === 'DRAFT';
          const hasZatcaXml = [row.original.compliance, row.original.clearance].some(
            (result) => result && Object.keys(result).length > 0
          );
          const hasCompliance = row.original.compliance && Object.keys(row.original.compliance).length > 0;
          const hasClearance = row.original.clearance && Object.keys(row.original.clearance).length > 0;
          const isRowBusy = actionBusyId === row.original._id;
          const isBusy = !!actionBusyId;

          const ActionButton = ({ tooltip, label, icon, disabled, onClick, spin }) => (
            <span className="breeze-table-action-wrap" data-tooltip={tooltip}>
              <button
                type="button"
                className={`breeze-table-action${spin ? ' is-busy' : ''}`}
                aria-label={label}
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  onClick();
                }}
              >
                <span className={`material-symbols-outlined${spin ? ' animate-spin' : ''}`}>{icon}</span>
              </button>
            </span>
          );

          return (
            <div className="breeze-table-actions">
              <ActionButton
                tooltip="Print"
                label="Print invoice"
                icon="print"
                disabled={isBusy}
                onClick={() => handlePrintInvoice(row.original._id)}
              />
              {canPrintProforma && (
                <ActionButton
                  tooltip="Print Proforma"
                  label="Print proforma invoice"
                  icon="draft"
                  disabled={isBusy}
                  onClick={() => handlePrintProformaInvoice(row.original._id)}
                />
              )}
              {hasCompliance && (
                <ActionButton
                  tooltip="View Compliance Response"
                  label="View compliance response"
                  icon="fact_check"
                  disabled={isBusy}
                  onClick={() => handleOpenComplianceResponseModal(row.original)}
                />
              )}
              {hasClearance && (
                <ActionButton
                  tooltip="View ZATCA Response"
                  label="View ZATCA response"
                  icon="rule"
                  disabled={isBusy}
                  onClick={() => handleOpenClearanceResponseModal(row.original)}
                />
              )}
              {hasZatcaXml && (
                <ActionButton
                  tooltip="View ZATCA XML"
                  label="View ZATCA XML"
                  icon="code"
                  disabled={isBusy}
                  onClick={() => _xmlInvoice({ id: row.original._id, invoiceNumber: row.original.invoiceNumber })}
                />
              )}
              <ActionButton
                tooltip={canCheckCompliance ? 'Check Compliance' : 'Compliance unavailable'}
                label="Check compliance"
                icon={isRowBusy ? 'sync' : 'verified'}
                spin={isRowBusy}
                disabled={isBusy || !canCheckCompliance}
                onClick={() => handleCheckCompliance(row.original._id)}
              />
              <ActionButton
                tooltip={canReportToZatca ? 'Report to ZATCA' : 'ZATCA submission unavailable'}
                label="Report to ZATCA"
                icon={isRowBusy ? 'sync' : 'send'}
                spin={isRowBusy}
                disabled={isBusy || !canReportToZatca}
                onClick={() => handleReportToZatca(row.original._id)}
              />
              {canCreateCreditNote && (
                <ActionButton
                  tooltip="Create Credit Note"
                  label="Create credit note"
                  icon="note_add"
                  disabled={isBusy}
                  onClick={() => handleCreateCreditNote(row.original)}
                />
              )}
              {canCreateDebitNote && (
                <ActionButton
                  tooltip="Create Debit Note"
                  label="Create debit note"
                  icon="post_add"
                  disabled={isBusy}
                  onClick={() => handleCreateDebitNote(row.original)}
                />
              )}
              {canDelete && (
                <ActionButton
                  tooltip="Delete"
                  label="Delete invoice"
                  icon="delete"
                  disabled={isBusy}
                  onClick={() => handleOpenDeleteModal(row.original._id)}
                />
              )}
            </div>
          );
        },
        enableSorting: false,
      },
    ],
    [
      handlePrintInvoice,
      handleReportToZatca,
      handleCheckCompliance,
      actionBusyId,
      isInvoiceDeletable,
    ]
  );

  const normalizeLineEndings = (str) => {
    if (str == null || typeof str !== 'string') return '';
    return str
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  };

  const parseZatcaResponse = (str) => {
    if (str == null || str === '') return null;
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed === 'object' && ('valid' in parsed || 'errors' in parsed || 'warnings' in parsed || 'sdkOutput' in parsed)) {
        return {
          valid: Boolean(parsed.valid),
          errors: Array.isArray(parsed.errors) ? parsed.errors : [],
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
          sdkOutput: typeof parsed.sdkOutput === 'string' ? parsed.sdkOutput : (parsed.sdkOutput != null ? String(parsed.sdkOutput) : ''),
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  const formatZatcaResponseForDisplay = (str) => {
    if (str == null || str === '') return null;
    let out;
    try {
      const parsed = JSON.parse(str);
      out = JSON.stringify(parsed, null, 2);
    } catch {
      out = str;
    }
    return normalizeLineEndings(out);
  };

  const parseClearanceResponse = (str) => {
    if (str == null || str === '') return null;
    try {
      const parsed = typeof str === 'string' ? JSON.parse(str) : str;
      if (!parsed || typeof parsed !== 'object') return null;
      const vr = parsed.validationResults;
      if (!vr) return null;
      const extractMessages = (arr) =>
        Array.isArray(arr)
          ? arr.map((m) => ({
            code: m.code || '',
            category: m.category || '',
            message: m.message || '',
            status: m.status || '',
          }))
          : [];
      return {
        status: vr.status || '',
        clearanceStatus: parsed.clearanceStatus || '',
        infoMessages: extractMessages(vr.infoMessages),
        warningMessages: extractMessages(vr.warningMessages),
        errorMessages: extractMessages(vr.errorMessages),
      };
    } catch {
      return null;
    }
  };

  const table = useReactTable({
    data: data.length > 0 ? data : [],
    columns,
    getRowId: (row) => row._id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: _sorting,
    onRowSelectionChange: _rowSelection,
    onPaginationChange: _pagination,
    manualPagination: true,
    pageCount: paginationInfo.totalPages,
    state: {
      sorting,
      rowSelection,
      pagination,
    },
    enableRowSelection: (row) => isInvoiceDeletable(row.original),
  });

  const handleConfirmBulkDelete = useCallback(() => {
    const selectedRows = table.getSelectedRowModel().rows;
    const deletableInvoices = selectedRows
      .map((row) => row.original)
      .filter((invoice) => isInvoiceDeletable(invoice));

    if (deletableInvoices.length === 0) {
      showToast('No deletable invoices selected', 'error');
      return;
    }

    _isBulkDeleting(true);
    // Each failed request shows its own error; the summary says what happened overall.
    Promise.allSettled(deletableInvoices.map((invoice) => InvoiceDeleteRequest(decodedToken, invoice._id)))
      .then((results) => {
        const deleted = results.filter((r) => r.status === 'fulfilled').length;
        const total = results.length;
        if (deleted === total) {
          showToast(total === 1 ? 'Invoice deleted successfully!' : `${total} invoices deleted successfully!`, 'success');
        } else {
          showToast(`Deleted ${deleted} of ${total} invoices. ${total - deleted} could not be deleted.`, 'error');
        }
        onBulkDeleteComplete?.();
        refreshInvoices?.();
      })
      .finally(() => {
        _isBulkDeleting(false);
      });
  }, [decodedToken, isInvoiceDeletable, onBulkDeleteComplete, refreshInvoices, table]);

  // *********** Render Functions ***********

  const INVOICES_TABLE = () => (
    <div className="overflow-x-auto min-w-0">
      <table className="min-w-[72rem]">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`${header.column.getCanSort() ? 'cursor-pointer select-none' : ''} ${header.id === 'select' ? 'w-12' : ''} ${header.id === 'actions' ? 'is-sticky-end text-center' : ''}`}
                  onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                >
                  <div className={`flex items-center gap-2 ${header.id === 'actions' ? 'justify-center' : ''}`}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && (
                      <span className="material-symbols-outlined text-[16px]">
                        {{
                          asc: 'arrow_upward',
                          desc: 'arrow_downward',
                        }[header.column.getIsSorted()] || 'unfold_more'}
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
                No invoices found
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={(event) => handleRowClick(row, event)}
                className={`cursor-pointer ${row.getIsSelected() ? 'is-selected' : ''}`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={`${cell.column.id === 'select' ? 'w-12' : ''} ${cell.column.id === 'actions' ? 'is-sticky-end text-center' : ''}`}
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
          onChange={(e) => {
            table.setPageSize(Number(e.target.value));
          }}
          className="breeze-select"
          aria-label="Rows per page"
        >
          {PAGINATION_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
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

  const CONFIRM_DELETE_MODAL = () => (
    <ConfirmModal
      isOpen={isDeleteModalOpen}
      title="Delete invoice"
      description="Are you sure you want to delete this invoice? This action cannot be undone."
      confirmLabel="Delete"
      cancelLabel="Cancel"
      onConfirm={handleConfirmDelete}
      onCancel={handleCloseDeleteModal}
      isConfirming={isDeleting}
    />
  );

  const CONFIRM_BULK_DELETE_MODAL = () => (
    <ConfirmModal
      isOpen={isBulkDeleteModalOpen}
      title="Delete selected invoices"
      description="Are you sure you want to delete the selected invoices? Only invoices that can be deleted will be removed. This action cannot be undone."
      confirmLabel="Delete"
      cancelLabel="Cancel"
      onConfirm={handleConfirmBulkDelete}
      onCancel={handleCloseBulkDeleteModal}
      isConfirming={isBulkDeleting}
    />
  );

  const COMPLIANCE_RESPONSE_MODAL = () => {
    if (!isComplianceResponseModalOpen) return null;
    const structured = parseZatcaResponse(complianceResponseToShow);
    const fallbackContent = formatZatcaResponseForDisplay(complianceResponseToShow) ?? 'No compliance response available for this invoice.';

    const modalBody = structured ? (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--z3c-subtle)]">Status</span>
          <span
            className={`breeze-pill ${structured.valid ? 'breeze-pill--success' : 'breeze-pill--danger'}`}
          >
            {structured.valid ? 'Valid' : 'Invalid'}
          </span>
        </div>

        {structured.errors.length > 0 && (
          <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 overflow-hidden">
            <div className="px-3 py-2 bg-red-100 dark:bg-red-900/40 border-b border-red-200 dark:border-red-800/60 flex items-center gap-2">
              <span className="material-symbols-outlined text-red-600 dark:text-red-400 text-[18px]">error</span>
              <span className="text-sm font-bold text-red-800 dark:text-red-200">Errors</span>
            </div>
            <ul className="px-3 py-2 list-disc list-inside space-y-1 text-sm text-red-800 dark:text-red-200">
              {structured.errors.map((msg, i) => (
                <li key={i} className="break-words">{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {structured.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/20 overflow-hidden">
            <div className="px-3 py-2 bg-amber-100 dark:bg-amber-900/40 border-b border-amber-200 dark:border-amber-800/60 flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-[18px]">warning</span>
              <span className="text-sm font-bold text-amber-800 dark:text-amber-200">Warnings</span>
            </div>
            <ul className="px-3 py-2 list-disc list-inside space-y-1 text-sm text-amber-800 dark:text-amber-200">
              {structured.warnings.map((msg, i) => (
                <li key={i} className="break-words">{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {structured.sdkOutput ? (
          <div className="rounded-lg border border-[var(--z3c-divider)] bg-[var(--z3c-surface-field)] overflow-hidden">
            <div className="px-3 py-2 bg-[rgba(224,237,244,0.45)] border-b border-[var(--z3c-divider)] flex items-center gap-2">
              <span className="material-symbols-outlined text-[var(--z3c-subtle)] text-[18px]">terminal</span>
              <span className="text-sm font-bold text-[var(--z3c-heading)]">SDK Output</span>
            </div>
            <pre className="px-3 py-2 text-xs text-[var(--z3c-heading)] whitespace-pre-wrap break-words font-mono max-h-48 overflow-auto">
              {normalizeLineEndings(structured.sdkOutput)}
            </pre>
          </div>
        ) : null}
      </div>
    ) : (
      <pre className="text-sm text-[var(--z3c-heading)] whitespace-pre-wrap break-words font-mono bg-[var(--z3c-surface-field)] rounded-lg p-4 border border-[var(--z3c-divider)]">
        {fallbackContent}
      </pre>
    );

    return (
      <div className="breeze-modal" onClick={handleCloseComplianceResponseModal}>
        <div
          className="breeze-modal__dialog breeze-modal__dialog--wide"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="compliance-response-title"
        >
          <div className="breeze-modal__header">
            <h3 id="compliance-response-title" className="breeze-modal__title">Compliance Response</h3>
          </div>
          <div className="breeze-modal__content">
            {modalBody}
          </div>
          <div className="breeze-modal__actions">
            <button
              type="button"
              onClick={handleCloseComplianceResponseModal}
              className="breeze-btn breeze-btn--outline"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  const ZATCA_RESPONSE_MODAL = () => {
    if (!isClearanceResponseModalOpen) return null;
    const structured = parseClearanceResponse(clearanceResponseToShow);
    const fallbackContent = formatZatcaResponseForDisplay(clearanceResponseToShow) ?? 'No ZATCA response available for this invoice.';

    const MessageList = ({ messages, colorClass, bgClass, borderClass, headerBgClass, headerBorderClass, icon, title, textClass }) => (
      <div className={`rounded-lg border ${borderClass} ${bgClass} overflow-hidden`}>
        <div className={`px-3 py-2 ${headerBgClass} border-b ${headerBorderClass} flex items-center gap-2`}>
          <span className={`material-symbols-outlined ${colorClass} text-[18px]`}>{icon}</span>
          <span className={`text-sm font-bold ${textClass}`}>{title}</span>
          <span className={`ml-auto text-xs font-semibold ${textClass} opacity-70`}>{messages.length}</span>
        </div>
        <ul className="divide-y divide-current divide-opacity-10 px-0">
          {messages.map((m, i) => (
            <li key={i} className={`px-3 py-2.5 ${textClass}`}>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {m.code && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono ${headerBgClass} border ${headerBorderClass} ${textClass}`}>
                    {m.code}
                  </span>
                )}
                {m.category && (
                  <span className="text-[11px] font-medium opacity-60">{m.category}</span>
                )}
                {m.status && (
                  <span className="text-[10px] font-bold opacity-50 ml-auto">{m.status}</span>
                )}
              </div>
              <p className="text-sm break-words">{m.message}</p>
            </li>
          ))}
        </ul>
      </div>
    );

    const statusColorMap = {
      PASS: 'breeze-pill breeze-pill--success',
      WARNING: 'breeze-pill breeze-pill--warning',
      ERROR: 'breeze-pill breeze-pill--danger',
    };
    const clearanceColorMap = {
      CLEARED: 'breeze-pill breeze-pill--success',
      NOT_CLEARED: 'breeze-pill breeze-pill--danger',
    };

    const modalBody = structured ? (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {structured.clearanceStatus && (
            <div className="flex items-center gap-2">
              <span className="breeze-panel__label mb-0">Clearance</span>
              <span className={clearanceColorMap[structured.clearanceStatus] || 'breeze-pill breeze-pill--muted'}>
                {structured.clearanceStatus}
              </span>
            </div>
          )}
          {structured.status && (
            <div className="flex items-center gap-2">
              <span className="breeze-panel__label mb-0">Validation</span>
              <span className={statusColorMap[structured.status] || 'breeze-pill breeze-pill--muted'}>
                {structured.status}
              </span>
            </div>
          )}
        </div>

        {/* Error Messages */}
        {structured.errorMessages.length > 0 && (
          <MessageList
            messages={structured.errorMessages}
            colorClass="text-red-600 dark:text-red-400"
            bgClass="bg-red-50 dark:bg-red-950/30"
            borderClass="border-red-200 dark:border-red-800/60"
            headerBgClass="bg-red-100 dark:bg-red-900/40"
            headerBorderClass="border-red-200 dark:border-red-800/60"
            textClass="text-red-800 dark:text-red-200"
            icon="error"
            title="Errors"
          />
        )}

        {/* Warning Messages */}
        {structured.warningMessages.length > 0 && (
          <MessageList
            messages={structured.warningMessages}
            colorClass="text-amber-600 dark:text-amber-400"
            bgClass="bg-amber-50 dark:bg-amber-950/20"
            borderClass="border-amber-200 dark:border-amber-800/60"
            headerBgClass="bg-amber-100 dark:bg-amber-900/40"
            headerBorderClass="border-amber-200 dark:border-amber-800/60"
            textClass="text-amber-800 dark:text-amber-200"
            icon="warning"
            title="Warnings"
          />
        )}

        {/* Info Messages */}
        {structured.infoMessages.length > 0 && (
          <MessageList
            messages={structured.infoMessages}
            colorClass="text-blue-600 dark:text-blue-400"
            bgClass="bg-blue-50 dark:bg-blue-950/20"
            borderClass="border-blue-200 dark:border-blue-800/60"
            headerBgClass="bg-blue-100 dark:bg-blue-900/40"
            headerBorderClass="border-blue-200 dark:border-blue-800/60"
            textClass="text-blue-800 dark:text-blue-200"
            icon="info"
            title="Info"
          />
        )}

        {structured.errorMessages.length === 0 && structured.warningMessages.length === 0 && structured.infoMessages.length === 0 && (
          <p className="text-sm text-[var(--z3c-subtle)] italic">No messages in this response.</p>
        )}
      </div>
    ) : (
      <pre className="text-sm text-[var(--z3c-heading)] whitespace-pre-wrap break-words font-mono bg-[var(--z3c-surface-field)] rounded-lg p-4 border border-[var(--z3c-divider)]">
        {fallbackContent}
      </pre>
    );

    return (
      <div className="breeze-modal" onClick={handleCloseClearanceResponseModal}>
        <div
          className="breeze-modal__dialog breeze-modal__dialog--wide"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="zatca-response-title"
        >
          <div className="breeze-modal__header">
            <h3 id="zatca-response-title" className="breeze-modal__title">ZATCA Response</h3>
          </div>
          <div className="breeze-modal__content">
            {modalBody}
          </div>
          <div className="breeze-modal__actions">
            <button
              type="button"
              onClick={handleCloseClearanceResponseModal}
              className="breeze-btn breeze-btn--outline"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="breeze-table-card">
      {INVOICES_TABLE()}
      {PAGINATION_SECTION()}
      {CONFIRM_DELETE_MODAL()}
      {CONFIRM_BULK_DELETE_MODAL()}
      {/* On <body>: the table card's backdrop-filter would otherwise contain and clip fixed overlays. */}
      {createPortal(
        <Fragment>
          {COMPLIANCE_RESPONSE_MODAL()}
          {ZATCA_RESPONSE_MODAL()}
        </Fragment>,
        document.body
      )}
      {xmlInvoice && (
        <ZatcaXmlViewer
          key={xmlInvoice.id}
          invoiceId={xmlInvoice.id}
          invoiceNumber={xmlInvoice.invoiceNumber}
          onClose={handleCloseXmlViewer}
        />
      )}
    </div>
  );
}

export default InvoiceList;
