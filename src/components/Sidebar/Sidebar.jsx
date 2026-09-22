// Packages
import { useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { NavLink } from 'react-router-dom';

// APIs
import { LogoutRequest } from '../../requests';

// Utils
import { auth, loginInfo } from '../../atoms';
import { decodeString, parseLoginInfo, getNormalizedModulePermissions } from '../../utils';

const navigation = [
  { label: 'Dashboard', icon: 'dashboard', path: '/dashboard', permissionKey: 'dashboard' },
  // { label: 'Company Profile', icon: 'business', path: '/company-profile', permissionKey: 'companyProfile' },
  { label: 'Customer', icon: 'people', path: '/customer', permissionKey: 'customer' },
  { label: 'Customer Profiles', icon: 'account_balance', path: '/customer-profile', permissionKey: 'profile' },
  { label: 'Invoices', icon: 'description', path: '/invoices', permissionKey: 'invoice' },
  { label: 'Currencies', icon: 'currency_exchange', path: '/currencies', permissionKey: 'companyProfile' },
  { label: 'User Management', icon: 'manage_accounts', path: '/user-management', permissionKey: 'user' },
  { label: 'Zatca Reports', icon: 'summarize', path: '/zatca-reports', permissionKey: 'zatcaReporting' },
  { label: 'Audit Logging', icon: 'history', path: '/audit-logging', permissionKey: 'audit' },
];

function Sidebar() {
  const [token, _token] = useAtom(auth);
  const loginInfoValue = useAtomValue(loginInfo);
  const decodedToken = useMemo(() => decodeString(token), [token]);
  const user = useMemo(() => parseLoginInfo(loginInfoValue), [loginInfoValue]);

  const filteredNavigation = useMemo(() => {
    if (!user) return navigation;

    return navigation.filter((item) => {
      if (!item.permissionKey) return true;
      const perms = getNormalizedModulePermissions(user, item.permissionKey);
      return perms.read;
    });
  }, [user]);

  const handleLogout = () => {
    if (decodedToken) {
      LogoutRequest(decodedToken)
        .finally(() => {
          _token(null);
        });
    } else {
      _token(null);
    }
  };

  const LOGO_SECTION = () => (
    <div className="flex items-center gap-3 mb-8">
      <div className="bg-primary p-2 rounded-lg text-white">
        <span className="material-symbols-outlined">shield_with_heart</span>
      </div>
      <div className="flex flex-col">
        <h1 className="text-[#0d121b] dark:text-white text-base font-bold leading-none">ZATCA Hub</h1>
        <p className="text-[#4c669a] text-xs font-normal">Phase 2 Compliant</p>
      </div>
    </div>
  );

  const NAVIGATION_SECTION = () => (
    <nav className="flex flex-col gap-1">
      {filteredNavigation.map((item) => (
        <NavLink
          key={item.label}
          to={item.path}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm cursor-pointer ${isActive
              ? 'bg-primary/10 text-primary font-semibold'
              : 'text-[#4c669a] dark:text-[#a0aec0] font-medium hover:bg-gray-100 dark:hover:bg-gray-800'
            }`
          }
        >
          <span className="material-symbols-outlined">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  const LOGOUT_SECTION = () => (
    <button
      type="button"
      onClick={handleLogout}
      className="mt-6 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30 transition-colors"
    >
      <span className="material-symbols-outlined">logout</span>
      <span>Logout</span>
    </button>
  );

  const SIDEBAR_CONTENT = () => (
    <div className="p-6 flex flex-col h-full">
      {LOGO_SECTION()}
      {NAVIGATION_SECTION()}
      {LOGOUT_SECTION()}
    </div>
  );

  return (
    <aside className="w-64 border-r border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] hidden lg:flex flex-col">
      {SIDEBAR_CONTENT()}
    </aside>
  );
}

export default Sidebar;
