// Packages
import { Fragment, useMemo, useState, Suspense, use, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel, flexRender } from '@tanstack/react-table';
import { ErrorBoundary } from 'react-error-boundary';
import { useAtomValue } from 'jotai';

// APIs
import { CustomerListRequest, CustomerDeleteRequest } from '../../../requests';

// Utils
import { auth, loginInfo } from '../../../atoms';
import { Footer, ErrorFallback, ConfirmModal } from '../../../components';
import { DEFAULT_PAGE_SIZE, PAGINATION_PAGE_SIZES, decodeString, showToast, parseLoginInfo, getNormalizedModulePermissions } from '../../../utils';

function CustomerList() {
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const loginInfoValue = useAtomValue(loginInfo);

  const user = useMemo(() => parseLoginInfo(loginInfoValue), [loginInfoValue]);
  const customerPerms = useMemo(() => getNormalizedModulePermissions(user, 'customer'), [user]);

  const [pagination, _pagination] = useState({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [sorting, _sorting] = useState([]);
  const [searchQuery, _searchQuery] = useState('');
  const [appliedSearchQuery, _appliedSearchQuery] = useState('');
  const [isFilterOpen, _isFilterOpen] = useState(false);
  const [, _isActionsOpen] = useState(false);
  const [rowSelection, _rowSelection] = useState({});
  const [reloadKey, _reloadKey] = useState(0);

  // Filters state
  const [filters, _filters] = useState({
    isActive: '',
  });

  const customersPromise = useMemo(() => {
    const decodedToken = decodeString(authValue);
    const params = {
      page: pagination.pageIndex + 1,
      limit: pagination.pageSize,
      search: appliedSearchQuery || undefined,
      sortBy: sorting.length > 0 ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : undefined,
      isActive: filters.isActive !== '' ? filters.isActive === 'true' : undefined,
    };

    return CustomerListRequest(decodedToken, params);
  }, [authValue, pagination.pageIndex, pagination.pageSize, appliedSearchQuery, sorting, filters, reloadKey]);

  // *********** Handlers ***********

  const handleFilterChange = (key, value) => {
    _filters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    _filters({ isActive: '' });
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
          Loading Customers...
        </div>
      </div>
    </div>
  );

  const PAGE_HEADER = () => (
    <div className="flex flex-wrap justify-between items-end gap-4">
      <div className="space-y-1">
        <h2 className="text-[#0d121b] dark:text-white text-3xl font-black tracking-tight">
          Customers
        </h2>
        <p className="text-[#4c669a] text-base">Manage your customer information and records</p>
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
            placeholder="Search customers..."
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
            <div className="absolute right-0 mt-2 z-30 w-64 bg-white dark:bg-[#161f30] rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] shadow-lg">
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-bold text-[#4c669a] dark:text-gray-400 uppercase tracking-wider">Status</label>
                  <select
                    value={filters.isActive}
                    onChange={(e) => handleFilterChange('isActive', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#0f1323] text-sm text-[#0d121b] dark:text-white py-2 px-3"
                  >
                    <option value="">All</option>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
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

        {customerPerms.create && (
          <button
            onClick={() => navigate('/customer/new')}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20 w-full sm:w-auto"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Create Customer
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
            <CustomersTableContent
              customersPromise={customersPromise}
              pagination={pagination}
              sorting={sorting}
              rowSelection={rowSelection}
              _sorting={_sorting}
              _pagination={_pagination}
              _rowSelection={_rowSelection}
              refreshCustomers={() => _reloadKey((prev) => prev + 1)}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <Footer />
    </Fragment>
  );

  return (
    <div id="customer-list">
      {CONTENT()}
    </div>
  );
};

function CustomersTableContent({
  customersPromise,
  pagination,
  sorting,
  rowSelection,
  _pagination,
  _sorting,
  _rowSelection,
  refreshCustomers,
}) {
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const loginInfoValue = useAtomValue(loginInfo);
  const user = useMemo(() => parseLoginInfo(loginInfoValue), [loginInfoValue]);
  const customerPerms = useMemo(() => getNormalizedModulePermissions(user, 'customer'), [user]);
  const decodedToken = useMemo(() => decodeString(authValue), [authValue]);
  const response = use(customersPromise);
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
  const [selectedCustomerId, _selectedCustomerId] = useState(null);
  const [isDeleting, _isDeleting] = useState(false);

  // *********** Handlers ***********

  const handleOpenDeleteModal = (customerId) => {
    if (!customerId) return;
    _selectedCustomerId(customerId);
    _isDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    if (isDeleting) return;
    _isDeleteModalOpen(false);
    _selectedCustomerId(null);
  };

  const handleConfirmDelete = useCallback(() => {
    if (!selectedCustomerId) return;

    _isDeleting(true);
    CustomerDeleteRequest(decodedToken, selectedCustomerId)
      .then(() => {
        showToast('Customer deleted successfully!', 'success');
        _isDeleteModalOpen(false);
        _selectedCustomerId(null);
        refreshCustomers?.();
      })
      .catch((err) => {
        showToast(err?.message || 'Failed to delete customer', 'error');
      })
      .finally(() => {
        _isDeleting(false);
      });
  }, [decodedToken, selectedCustomerId, refreshCustomers]);

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
        accessorKey: 'registrationName',
        header: 'Registered Name',
        enableSorting: true,
      },
      {
        accessorKey: 'streetName',
        header: 'Street',
        enableSorting: true,
      },
      {
        accessorKey: 'buildingNumber',
        header: 'Building',
        enableSorting: true,
      },
      {
        accessorKey: 'citySubdivisionName',
        header: 'District',
        enableSorting: true,
      },
      {
        accessorKey: 'cityName',
        header: 'City',
        enableSorting: true,
      },
      {
        accessorKey: 'postalZone',
        header: 'Postal Zone',
        enableSorting: true,
      },
      {
        accessorKey: 'email',
        header: 'Email',
        enableSorting: true,
        cell: ({ getValue }) => (
          <a href={`mailto:${getValue()}`} className="text-primary hover:underline">{getValue()}</a>
        ),
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        enableSorting: true,
      },
      {
        accessorKey: 'customerVAT',
        header: 'Customer VAT',
        enableSorting: true,
        // International customers have no KSA VAT — show their Other Buyer ID instead.
        cell: ({ getValue, row }) => (
          <span className="font-mono text-xs">
            {getValue() ||
              (row.original.identificationId
                ? `${row.original.identificationScheme || 'OTH'}: ${row.original.identificationId}`
                : '—')}
          </span>
        ),
      },
      {
        accessorKey: 'isActive',
        header: 'Status',
        enableSorting: true,
        cell: ({ getValue }) => {
          const isActive = getValue();
          return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
              isActive
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                isActive ? 'bg-green-600 dark:bg-green-400' : 'bg-red-600 dark:bg-red-400'
              }`}></span>
              {isActive ? 'Active' : 'Inactive'}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const isActive = row.original.isActive;
          const canEdit = customerPerms.update;
          const canDelete = customerPerms.delete && isActive;

          if (!canEdit && !canDelete) return null;

          const handleChange = (e) => {
            const value = e.target.value;
            if (!value) return;

            if (value === 'edit') {
              navigate(`/customer/${row.original._id}`);
            } else if (value === 'delete') {
              handleOpenDeleteModal(row.original._id);
            }

            e.target.value = '';
          };

          return (
            <select
              defaultValue=""
              onChange={handleChange}
              className="px-3 py-1.5 text-sm rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-[#0d121b] dark:text-white focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer"
            >
              <option value="" disabled>
                Action
              </option>
              {canEdit && <option value="edit">Edit</option>}
              {canDelete && <option value="delete">Delete</option>}
            </select>
          );
        },
        enableSorting: false,
      },
    ],
    [navigate, handleOpenDeleteModal, customerPerms]
  );

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

  const CUSTOMER_TABLE = () => (
    <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1400px]">
        <thead className="bg-[#f8f9fc] dark:bg-[#1a253a] text-[#4c669a] dark:text-gray-400 text-xs font-bold uppercase tracking-wider">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`px-6 py-4 ${
                    header.column.getCanSort()
                      ? 'cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800'
                      : ''
                  } transition-colors ${header.id === 'select' ? 'w-12' : ''} ${
                    header.id === 'actions'
                      ? 'sticky right-0 bg-[#f8f9fc] dark:bg-[#1a253a] z-20 w-32 text-right'
                      : ''
                  }`}
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
                No customers found
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
                    className={`px-6 py-4 text-sm text-[#0d121b] dark:text-white ${
                      cell.column.id === 'select' ? 'w-12' : ''
                    } ${
                      cell.column.id === 'actions'
                        ? 'sticky right-0 bg-white dark:bg-[#161f30] z-10 w-32 text-right'
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
      title="Delete customer"
      description="Are you sure you want to delete this customer? This action cannot be undone."
      confirmLabel="Delete"
      cancelLabel="Cancel"
      onConfirm={handleConfirmDelete}
      onCancel={handleCloseDeleteModal}
      isConfirming={isDeleting}
    />
  );

  return (
    <div className="bg-white dark:bg-[#161f30] rounded-xl border border-[#e7ebf3] dark:border-[#2a3447] shadow-sm overflow-hidden">
      {CUSTOMER_TABLE()}
      {PAGINATION_SECTION()}
      {CONFIRM_DELETE_MODAL()}
    </div>
  );
}

export default CustomerList;
