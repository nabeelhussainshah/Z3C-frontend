// Packages
import { Fragment, useMemo, useState, Suspense, use, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel, flexRender } from '@tanstack/react-table';
import { ErrorBoundary } from 'react-error-boundary';
import { useAtomValue } from 'jotai';

// APIs
import { UserListRequest } from '../../../requests';

// Utils
import { auth, loginInfo } from '../../../atoms';
import { Footer, ErrorFallback } from '../../../components';
import { DEFAULT_PAGE_SIZE, PAGINATION_PAGE_SIZES, decodeString, parseLoginInfo, getNormalizedModulePermissions } from '../../../utils';

const USER_ROLE_FILTERS = ['Admin', 'Accountant', 'Manager', 'Viewer'];

function UserManagementList() {
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const loginInfoValue = useAtomValue(loginInfo);

  const user = useMemo(() => parseLoginInfo(loginInfoValue), [loginInfoValue]);
  const userPerms = useMemo(() => getNormalizedModulePermissions(user, 'user'), [user]);

  const [pagination, _pagination] = useState({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [sorting, _sorting] = useState([]);
  const [searchQuery, _searchQuery] = useState('');
  const [appliedSearchQuery, _appliedSearchQuery] = useState('');
  const [isFilterOpen, _isFilterOpen] = useState(false);
  const [reloadKey, _reloadKey] = useState(0);

  // Filters state
  const [filters, _filters] = useState({
    isActive: '',
    role: '',
  });

  const usersPromise = useMemo(() => {
    const decodedToken = decodeString(authValue);
    const params = {
      page: pagination.pageIndex + 1,
      limit: pagination.pageSize,
      search: appliedSearchQuery || undefined,
      sortBy: sorting.length > 0 ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : undefined,
      isActive: filters.isActive !== '' ? filters.isActive === 'true' : undefined,
      role: filters.role || undefined,
    };

    return UserListRequest(decodedToken, params);
  }, [authValue, pagination.pageIndex, pagination.pageSize, appliedSearchQuery, sorting, filters, reloadKey]);

  // *********** Handlers ***********

  const handleFilterChange = (key, value) => {
    _filters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    _filters({ isActive: '', role: '' });
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
          Loading Users...
        </div>
      </div>
    </div>
  );

  const PAGE_HEADER = () => (
    <div>
      <h2 className="breeze-page__title">User Management</h2>
      <p className="breeze-page__lede">Manage users, roles and access permissions</p>
    </div>
  );

  const SEARCH_FILTERS_SECTION = () => (
    <div className="breeze-toolbar">
      <div className="breeze-search">
        <div className="breeze-field__control">
          <span className="material-symbols-outlined breeze-field__icon">search</span>
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => _searchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                _appliedSearchQuery(searchQuery);
                _pagination((prev) => ({ ...prev, pageIndex: 0 }));
              }
            }}
            className="breeze-input"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative">
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
            <div className="breeze-panel">
              <div className="space-y-4">
                <div>
                  <label className="breeze-panel__label">Status</label>
                  <select
                    value={filters.isActive}
                    onChange={(e) => handleFilterChange('isActive', e.target.value)}
                    className="breeze-select"
                  >
                    <option value="">All</option>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="breeze-panel__label">Role</label>
                  <select
                    value={filters.role}
                    onChange={(e) => handleFilterChange('role', e.target.value)}
                    className="breeze-select"
                  >
                    <option value="">All</option>
                    {USER_ROLE_FILTERS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
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

        {userPerms.create && (
          <button
            type="button"
            onClick={() => navigate('/user-management/new')}
            className="breeze-btn breeze-btn--primary breeze-btn--inline w-full sm:w-auto"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Create User
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
            <UsersTableContent
              usersPromise={usersPromise}
              pagination={pagination}
              sorting={sorting}
              _sorting={_sorting}
              _pagination={_pagination}
              refreshUsers={() => _reloadKey((prev) => prev + 1)}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <Footer />
    </Fragment>
  );

  return (
    <div id="user-management-list" className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

function UsersTableContent({
  usersPromise,
  pagination,
  sorting,
  _pagination,
  _sorting,
}) {
  const navigate = useNavigate();
  const response = use(usersPromise);
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

  const handleRowClick = useCallback((row, event) => {
    if (!row.original?._id) return;
    if (event.target.closest('a')) return;

    navigate(`/user-management/${row.original._id}`);
  }, [navigate]);

  const columns = useMemo(
    () => [
      {
        accessorKey: 'username',
        header: 'User Name',
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue() || '-'}</span>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        enableSorting: true,
        cell: ({ getValue }) => (
          <a
            href={`mailto:${getValue()}`}
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline"
          >
            {getValue()}
          </a>
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
        accessorKey: 'createdAt',
        header: 'Created At',
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="text-xs">{getValue()}</span>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated At',
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="text-xs">{getValue()}</span>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: data.length > 0 ? data : [],
    columns,
    getRowId: (row) => row._id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: _sorting,
    onPaginationChange: _pagination,
    manualPagination: true,
    pageCount: paginationInfo.totalPages,
    state: {
      sorting,
      pagination,
    },
  });

  // *********** Render Functions ***********

  const USER_TABLE = () => (
    <div className="overflow-x-auto">
      <table>
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
                No users found
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={(event) => handleRowClick(row, event)}
                className="cursor-pointer"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
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

      <div className="breeze-pager__nav">
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
      {USER_TABLE()}
      {PAGINATION_SECTION()}
    </div>
  );
}

export default UserManagementList;
