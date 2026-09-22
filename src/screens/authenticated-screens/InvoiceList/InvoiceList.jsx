// Packages
import { Fragment, useMemo, useState, Suspense, use, useCallback } from 'react';
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
import { DEFAULT_PAGE_SIZE, PAGINATION_PAGE_SIZES, decodeString, showToast, parseLoginInfo, getNormalizedModulePermissions, INVOICE_STATUSES } from '../../../utils';

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
  const [isActionsOpen, _isActionsOpen] = useState(false);
  const [rowSelection, _rowSelection] = useState({});
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

  const selectedRowCount = Object.keys(rowSelection).length;

  // *********** Handlers ***********

  const handleFilterChange = (key, value) => {
    _filters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
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
    <div className="bg-white dark:bg-[#161f30] rounded-xl border border-[#e7ebf3] dark:border-[#2a3447] shadow-sm overflow-hidden">
      <div className="px-6 py-8 text-center text-sm text-[#4c669a]">
        <div className="flex items-center justify-center gap-2">
          <span className="material-symbols-outlined animate-spin">sync</span>
          Loading Invoices...
        </div>
      </div>
    </div>
  );

  const PAGE_HEADER = () => (
    <div className="flex flex-wrap justify-between items-end gap-4">
      <div className="space-y-1">
        <h2 className="text-[#0d121b] dark:text-white text-3xl font-black tracking-tight">
          Invoices
        </h2>
        <p className="text-[#4c669a] text-base">Manage and track your electronic invoices</p>
      </div>
    </div>
  );

  const SEARCH_FILTERS_SECTION = () => (
    <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
      <div className="flex-1 max-w-md">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#4c669a] text-[20px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search invoices..."
            value={searchQuery}
            onChange={(e) => _searchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                _appliedSearchQuery(searchQuery);
                _pagination((prev) => ({ ...prev, pageIndex: 0 }));
              }
            }}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white placeholder:text-[#4c669a] focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {selectedRowCount > 0 && (
          // Temporarily hidden actions dropdown
          <div className="relative opacity-0">
            <button
              onClick={() => _isActionsOpen(!isActionsOpen)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-primary bg-primary/10 text-sm font-medium text-primary hover:bg-primary/20 transition-colors w-full sm:w-auto"
            >
              <span className="material-symbols-outlined text-[20px]">checklist</span>
              Actions ({selectedRowCount})
              <span className="material-symbols-outlined text-[16px]">
                {isActionsOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {isActionsOpen && (
              <div className="absolute right-0 mt-2 z-30 w-48 bg-white dark:bg-[#161f30] rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] shadow-lg z-20">
                <div className="py-1">
                  <button className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <span className="material-symbols-outlined text-[18px]">send</span>
                    Submit to ZATCA
                  </button>
                  <button className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <span className="material-symbols-outlined text-[18px]">mail</span>
                    Send Email
                  </button>
                  <button className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Export Selected
                  </button>
                  <button className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <span className="material-symbols-outlined text-[18px]">print</span>
                    Print
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <button
            onClick={() => _isFilterOpen(!isFilterOpen)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm font-medium text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors w-full sm:w-auto"
          >
            <span className="material-symbols-outlined text-[20px]">filter_list</span>
            Filters
            <span className="material-symbols-outlined text-[16px]">
              {isFilterOpen ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {isFilterOpen && (
            <div className="absolute right-0 mt-2 z-30 w-72 bg-white dark:bg-[#161f30] rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] shadow-lg">
              <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400 uppercase tracking-wider">Status</label>
                  <select
                    value={filters.status}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#0f1323] text-sm text-[#0d121b] dark:text-white py-2 px-3"
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
                  <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400 uppercase tracking-wider">Invoice Type</label>
                  <select
                    value={filters.invoiceType}
                    onChange={(e) => handleFilterChange('invoiceType', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#0f1323] text-sm text-[#0d121b] dark:text-white py-2 px-3"
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
                  <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400 uppercase tracking-wider">Payment Type</label>
                  <select
                    value={filters.paymentType}
                    onChange={(e) => handleFilterChange('paymentType', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#0f1323] text-sm text-[#0d121b] dark:text-white py-2 px-3"
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
                  <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400 uppercase tracking-wider">Date Range</label>
                  <div className="mt-1 space-y-2">
                    <div>
                      <label className="text-[10px] text-[#4c669a] dark:text-gray-500">From</label>
                      <input
                        type="date"
                        value={filters.fromDate}
                        onChange={(e) => handleFilterChange('fromDate', e.target.value)}
                        className="w-full rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#0f1323] text-sm text-[#0d121b] dark:text-white py-2 px-3"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#4c669a] dark:text-gray-500">To</label>
                      <input
                        type="date"
                        value={filters.toDate}
                        onChange={(e) => handleFilterChange('toDate', e.target.value)}
                        className="w-full rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#0f1323] text-sm text-[#0d121b] dark:text-white py-2 px-3"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t border-[#e7ebf3] dark:border-[#2a3447]">
                  <button
                    onClick={resetFilters}
                    className="flex-1 px-3 py-2 text-sm font-medium text-[#4c669a] hover:text-[#0d121b] dark:hover:text-white transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    onClick={applyFilters}
                    className="flex-1 px-3 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
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
            onClick={() => navigate('/invoices/new')}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20 w-full sm:w-auto"
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
      <div className="p-8 space-y-6">
        {PAGE_HEADER()}
        {SEARCH_FILTERS_SECTION()}
        <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
          <Suspense fallback={<TableLoadingSkeleton />}>
            <InvoicesTableContent
              invoicesPromise={invoicesPromise}
              pagination={pagination}
              _pagination={_pagination}
              sorting={sorting}
              _sorting={_sorting}
              rowSelection={rowSelection}
              _rowSelection={_rowSelection}
              refreshInvoices={() => _reloadKey((prev) => prev + 1)}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <Footer />
    </Fragment>
  );

  return (<div id="invoice-list">{CONTENT()}</div>);
}

function InvoicesTableContent({
  invoicesPromise,
  pagination,
  _pagination,
  sorting,
  _sorting,
  rowSelection,
  _rowSelection,
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
            className="w-4 h-4 rounded border-[#e7ebf3] dark:border-[#2a3447] text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            className="w-4 h-4 rounded border-[#e7ebf3] dark:border-[#2a3447] text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
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
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold text-white ${colorClass}`}>
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
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${paid === 'Yes' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
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
          const canDelete = invoicePerms.delete && !!statusConfig?.canDelete;
          const canReportToZatca = !!statusConfig?.canSubmitToZatca;
          const canCreateCreditNote = !!statusConfig?.canCreateCreditNote;
          const canCreateDebitNote = !!statusConfig?.canCreateDebitNote;
          const canCheckCompliance = !!statusConfig?.canCheckCompliance;
          const canPrintProforma = row.original.status === 'DRAFT';
          const hasZatcaXml = [row.original.compliance, row.original.clearance].some(
            (result) => result && Object.keys(result).length > 0
          );

          const isBusy = !!actionBusyId;

          const handleChange = (e) => {
            const value = e.target.value;
            if (!value) return;

            if (value === 'view') {
              navigate(`/invoices/${row.original._id}`);
            } else if (value === 'print') {
              handlePrintInvoice(row.original._id);
            } else if (value === 'print-proforma') {
              handlePrintProformaInvoice(row.original._id);
            } else if (value === 'compliance-response') {
              handleOpenComplianceResponseModal(row.original);
            } else if (value === 'clearance-response') {
              handleOpenClearanceResponseModal(row.original);
            } else if (value === 'view-xml') {
              _xmlInvoice({ id: row.original._id, invoiceNumber: row.original.invoiceNumber });
            } else if (value === 'credit-note') {
              handleCreateCreditNote(row.original);
            } else if (value === 'debit-note') {
              handleCreateDebitNote(row.original);
            } else if (value === 'delete') {
              handleOpenDeleteModal(row.original._id);
            } else if (value === 'report-zatca') {
              handleReportToZatca(row.original._id);
            } else if (value === 'check-compliance') {
              handleCheckCompliance(row.original._id);
            }

            // reset back to placeholder
            e.target.value = '';
          };

          return (
            <select
              defaultValue=""
              onChange={handleChange}
              disabled={isBusy}
              style={{ width: '227px' }}
              className="px-3 py-1.5 text-sm rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="" disabled>
                {isBusy ? '...' : 'Action'}
              </option>
              <option value="view">View</option>
              <option value="print">Print</option>
              {canPrintProforma && (
                <option value="print-proforma">Print Proforma</option>
              )}
              {(row.original.compliance && Object.keys(row.original.compliance).length > 0) && (
                <option value="compliance-response">View Compliance Response</option>
              )}
              {(row.original.clearance && Object.keys(row.original.clearance).length > 0) && (
                <option value="clearance-response">View ZATCA Response</option>
              )}
              {hasZatcaXml && <option value="view-xml">View ZATCA XML</option>}
              {canReportToZatca && <option value="report-zatca">Report to ZATCA</option>}
              {canCheckCompliance && <option value="check-compliance">Check Compliance</option>}
              {canCreateCreditNote && <option value="credit-note">Create Credit Note </option>}
              {canCreateDebitNote && <option value="debit-note">Create Debit Note</option>}
              {canDelete && <option value="delete">Delete</option>}
            </select>
          );
        },
        enableSorting: false,
      },
    ],
    [
      navigate,
      handleOpenDeleteModal,
      handleOpenComplianceResponseModal,
      handleOpenClearanceResponseModal,
      invoicePerms,
      handleCreateCreditNote,
      handleCreateDebitNote,
      handleReportToZatca,
      handleCheckCompliance,
      actionBusyId,
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
    enableRowSelection: true,
  });

  // *********** Render Functions ***********

  const INVOICES_TABLE = () => (
    <div className="overflow-x-auto">
      <table className="w-full text-left min-w-[1400px]">
        <thead className="bg-[#f8f9fc] dark:bg-[#1a253a] text-[#4c669a] dark:text-gray-400 text-xs font-bold uppercase tracking-wider">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`px-6 py-4 ${header.column.getCanSort() ? 'cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800' : ''} transition-colors ${header.id === 'select' ? 'w-12' : ''} ${header.id === 'actions' ? 'sticky right-0 bg-[#f8f9fc] dark:bg-[#1a253a] z-20 w-24 text-right' : ''}`}
                  onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                >
                  <div className="flex items-center gap-2">
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
        <tbody className="divide-y divide-[#e7ebf3] dark:divide-[#2a3447]">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-8 text-center text-sm text-[#4c669a]">
                No invoices found
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${row.getIsSelected() ? 'bg-primary/5 dark:bg-primary/10' : ''}`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={`px-6 py-4 text-sm text-[#0d121b] dark:text-white ${cell.column.id === 'select' ? 'w-12' : ''} ${cell.column.id === 'actions'
                      ? 'sticky right-0 bg-white dark:bg-[#161f30] z-20 w-32 text-right'
                      : ''
                      }`}
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
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 bg-[#f8f9fc] dark:bg-[#1a253a] border-t border-[#e7ebf3] dark:border-[#2a3447]">
      <div className="flex items-center gap-2 text-sm text-[#4c669a] dark:text-gray-400">
        <span>Showing</span>
        <select
          value={pagination.pageSize}
          onChange={(e) => {
            table.setPageSize(Number(e.target.value));
          }}
          className="px-2 py-1 rounded border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-[#0d121b] dark:text-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
        >
          {PAGINATION_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => table.setPageIndex(0)}
          disabled={!paginationInfo.hasPreviousPage}
          className="px-3 py-1.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">first_page</span>
        </button>
        <button
          onClick={() => table.previousPage()}
          disabled={!paginationInfo.hasPreviousPage}
          className="px-3 py-1.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
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
                key={pageNum}
                onClick={() => table.setPageIndex(pageNum - 1)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${pagination.pageIndex + 1 === pageNum
                  ? 'bg-primary text-white'
                  : 'border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => table.nextPage()}
          disabled={!paginationInfo.hasNextPage}
          className="px-3 py-1.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
        </button>
        <button
          onClick={() => table.setPageIndex(paginationInfo.totalPages - 1)}
          disabled={!paginationInfo.hasNextPage}
          className="px-3 py-1.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-sm text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">last_page</span>
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

  const COMPLIANCE_RESPONSE_MODAL = () => {
    if (!isComplianceResponseModalOpen) return null;
    const structured = parseZatcaResponse(complianceResponseToShow);
    const fallbackContent = formatZatcaResponseForDisplay(complianceResponseToShow) ?? 'No compliance response available for this invoice.';

    const modalBody = structured ? (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#4c669a] dark:text-gray-400">Status</span>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${structured.valid
              ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
              }`}
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
          <div className="rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-[#f8f9fc] dark:bg-[#0f1323] overflow-hidden">
            <div className="px-3 py-2 bg-[#e7ebf3] dark:bg-[#1a253a] border-b border-[#e7ebf3] dark:border-[#2a3447] flex items-center gap-2">
              <span className="material-symbols-outlined text-[#4c669a] dark:text-gray-400 text-[18px]">terminal</span>
              <span className="text-sm font-bold text-[#0d121b] dark:text-white">SDK Output</span>
            </div>
            <pre className="px-3 py-2 text-xs text-[#0d121b] dark:text-gray-200 whitespace-pre-wrap break-words font-mono max-h-48 overflow-auto">
              {normalizeLineEndings(structured.sdkOutput)}
            </pre>
          </div>
        ) : null}
      </div>
    ) : (
      <pre className="text-sm text-[#0d121b] dark:text-gray-200 whitespace-pre-wrap break-words font-mono bg-[#f8f9fc] dark:bg-[#0f1323] rounded-lg p-4 border border-[#e7ebf3] dark:border-[#2a3447]">
        {fallbackContent}
      </pre>
    );

    return (
      <Fragment>
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={handleCloseComplianceResponseModal}
        />
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-[#161f30] shadow-2xl border border-[#e7ebf3] dark:border-[#2a3447]">
            <div className="px-6 py-4 border-b border-[#e7ebf3] dark:border-[#2a3447] flex-shrink-0">
              <h3 className="text-lg font-bold text-[#0d121b] dark:text-white">Compliance Response</h3>
            </div>
            <div className="px-6 py-4 overflow-auto flex-1 min-h-0">
              {modalBody}
            </div>
            <div className="px-6 py-4 flex justify-end border-t border-[#e7ebf3] dark:border-[#2a3447] bg-[#f8f9fc] dark:bg-[#1a253a] rounded-b-2xl flex-shrink-0">
              <button
                type="button"
                onClick={handleCloseComplianceResponseModal}
                className="inline-flex justify-center rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] px-4 py-2.5 text-sm font-medium text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </Fragment>
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
      PASS: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
      WARNING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      ERROR: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };
    const clearanceColorMap = {
      CLEARED: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
      NOT_CLEARED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };

    const modalBody = structured ? (
      <div className="space-y-4">
        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-3">
          {structured.clearanceStatus && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#4c669a] dark:text-gray-400 uppercase tracking-wide">Clearance</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${clearanceColorMap[structured.clearanceStatus] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'}`}>
                {structured.clearanceStatus}
              </span>
            </div>
          )}
          {structured.status && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#4c669a] dark:text-gray-400 uppercase tracking-wide">Validation</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${statusColorMap[structured.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'}`}>
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
          <p className="text-sm text-[#4c669a] dark:text-gray-400 italic">No messages in this response.</p>
        )}
      </div>
    ) : (
      <pre className="text-sm text-[#0d121b] dark:text-gray-200 whitespace-pre-wrap break-words font-mono bg-[#f8f9fc] dark:bg-[#0f1323] rounded-lg p-4 border border-[#e7ebf3] dark:border-[#2a3447]">
        {fallbackContent}
      </pre>
    );

    return (
      <Fragment>
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={handleCloseClearanceResponseModal}
        />
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-[#161f30] shadow-2xl border border-[#e7ebf3] dark:border-[#2a3447]">
            <div className="px-6 py-4 border-b border-[#e7ebf3] dark:border-[#2a3447] flex-shrink-0">
              <h3 className="text-lg font-bold text-[#0d121b] dark:text-white">ZATCA Response</h3>
            </div>
            <div className="px-6 py-4 overflow-auto flex-1 min-h-0">
              {modalBody}
            </div>
            <div className="px-6 py-4 flex justify-end border-t border-[#e7ebf3] dark:border-[#2a3447] bg-[#f8f9fc] dark:bg-[#1a253a] rounded-b-2xl flex-shrink-0">
              <button
                type="button"
                onClick={handleCloseClearanceResponseModal}
                className="inline-flex justify-center rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] px-4 py-2.5 text-sm font-medium text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </Fragment>
    );
  };

  return (
    <div className="bg-white dark:bg-[#161f30] rounded-xl border border-[#e7ebf3] dark:border-[#2a3447] shadow-sm overflow-hidden">
      {INVOICES_TABLE()}
      {PAGINATION_SECTION()}
      {CONFIRM_DELETE_MODAL()}
      {COMPLIANCE_RESPONSE_MODAL()}
      {ZATCA_RESPONSE_MODAL()}
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
