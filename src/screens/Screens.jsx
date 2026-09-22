// Packages
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';

// Utils
import '../utils';
import { auth, loginInfo } from '../atoms';
import { Sidebar, Header } from '../components';
import { parseLoginInfo, getNormalizedModulePermissions } from '../utils';

// Unauthenticated Screens
import { Login, ForgotResetPassword } from './unauthenticated-screens';

// Authenticated Screens
import {
  Dashboard,
  CompanyProfileList,
  CompanyProfileForm,
  InvoiceList,
  InvoiceForm,
  CurrencyList,
  CurrencyForm,
  CustomerList,
  CustomerForm,
  CustomerProfileList,
  CustomerProfileForm,
  UserManagementList,
  UserManagementForm,
  ZatcaReports,
  AuditLogging,
} from './authenticated-screens';

function Screens() {
  const authValue = useAtomValue(auth);
  const loginInfoValue = useAtomValue(loginInfo);
  const [isMounted, _isMounted] = useState(false);
  const isAuthenticated = Boolean(authValue);

  const user = useMemo(() => parseLoginInfo(loginInfoValue), [loginInfoValue]);

  const getPerms = (moduleKey) => getNormalizedModulePermissions(user, moduleKey);

  useEffect(() => {
    _isMounted(true);
  }, []);

  const AUTHENTICATED_LAYOUT = () => {
    const dashboardPerms = getPerms('dashboard');
    const companyProfilePerms = getPerms('companyProfile');
    const invoicePerms = getPerms('invoice');
    const customerPerms = getPerms('customer');
    const userPerms = getPerms('user');
    const customerProfilePerms = getPerms('profile');
    const zatcaReportsPerms = getPerms('zatcaReporting');
    const auditPerms = getPerms('audit');
    const defaultAuthorizedPath = dashboardPerms.read
      ? '/dashboard'
      : customerPerms.read
        ? '/customer'
        : customerProfilePerms.read
          ? '/customer-profile'
          : invoicePerms.read
            ? '/invoices'
            : userPerms.read
              ? '/user-management'
              : zatcaReportsPerms.read
                ? '/zatca-reports'
                : auditPerms.read
                  ? '/audit-logging'
                  : '/login';

    return (
      <div className="min-h-screen bg-[#f5f6f8] dark:bg-[#0f1323] text-[#0d121b] dark:text-[#f8f9fc]">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 flex flex-col overflow-y-auto">
            <Header />
            <Routes>
              {dashboardPerms.read && (
                <Route path="/dashboard" element={<Dashboard />} />
              )}

              <Route path="/zatca-reports" element={<ZatcaReports />} />

              {auditPerms.read && (
                <Route path="/audit-logging" element={<AuditLogging />} />
              )}

              {customerProfilePerms.read && (
                <>
                  <Route path="/customer-profile" element={<CustomerProfileList />} />
                  {customerProfilePerms.create && (
                    <Route path="/customer-profile/new" element={<CustomerProfileForm />} />
                  )}
                  <Route path="/customer-profile/:id" element={<CustomerProfileForm />} />
                </>
              )}

              {companyProfilePerms.read && (
                <>
                  <Route path="/company-profile" element={<CompanyProfileList />} />
                  {companyProfilePerms.create && (
                    <Route path="/company-profile/new" element={<CompanyProfileForm />} />
                  )}
                  <Route path="/company-profile/:id" element={<CompanyProfileForm />} />
                </>
              )}

              {invoicePerms.read && (
                <>
                  <Route path="/invoices" element={<InvoiceList />} />
                  {invoicePerms.create && (
                    <Route path="/invoices/new" element={<InvoiceForm />} />
                  )}
                  <Route path="/invoices/:id" element={<InvoiceForm />} />
                </>
              )}

              {/* Currency management reuses the companyProfile permissions (as the API does). */}
              {companyProfilePerms.read && (
                <>
                  <Route path="/currencies" element={<CurrencyList />} />
                  {companyProfilePerms.create && (
                    <Route path="/currencies/new" element={<CurrencyForm />} />
                  )}
                  {companyProfilePerms.update && (
                    <Route path="/currencies/:code" element={<CurrencyForm />} />
                  )}
                </>
              )}

              {customerPerms.read && (
                <>
                  <Route path="/customer" element={<CustomerList />} />
                  {customerPerms.create && (
                    <Route path="/customer/new" element={<CustomerForm />} />
                  )}
                  <Route path="/customer/:id" element={<CustomerForm />} />
                </>
              )}

              {userPerms.read && (
                <>
                  <Route path="/user-management" element={<UserManagementList />} />
                  {userPerms.create && (
                    <Route path="/user-management/new" element={<UserManagementForm />} />
                  )}
                  <Route path="/user-management/:id" element={<UserManagementForm />} />
                </>
              )}

              <Route path="*" element={<Navigate to={defaultAuthorizedPath} replace />} />
            </Routes>
          </main>
        </div>
      </div>
    );
  };

  const UNAUTHENTICATED_LAYOUT = () => (
    <div className="min-h-screen bg-[#f5f6f8] dark:bg-[#0f1323] text-[#0d121b] dark:text-[#f8f9fc]">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotResetPassword />} />
        <Route path="/reset-password" element={<Navigate to="/forgot-password" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </div>
  );

  const CONTENT = () => {
    if (!isMounted) {
      // Avoid flashing the login screen briefly on initial render
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#f5f6f8] dark:bg-[#0f1323] text-[#0d121b] dark:text-[#f8f9fc]">
          <span className="text-sm text-slate-600 dark:text-slate-300">
            Loading your workspace...
          </span>
        </div>
      );
    }

    return (
      <Fragment>
        {isAuthenticated ? AUTHENTICATED_LAYOUT() : UNAUTHENTICATED_LAYOUT()}
      </Fragment>
    );
  };

  return CONTENT();
}

export default Screens;
