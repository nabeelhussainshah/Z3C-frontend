// Packages
import { useEffect, useMemo } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { NavLink } from 'react-router-dom';

// APIs
import { LogoutRequest } from '../../requests';

// Utils
import { auth, loginInfo, refreshToken } from '../../atoms';
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

function Sidebar({ isOpen = false, onClose = () => {} }) {
  const [token, _token] = useAtom(auth);
  const loginInfoValue = useAtomValue(loginInfo);
  const setLoginInfo = useSetAtom(loginInfo);
  const setRefreshToken = useSetAtom(refreshToken);
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

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const handleChange = () => {
      if (media.matches) onClose();
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const clearAllAuthAtoms = () => {
    _token(null);
    setLoginInfo(null);
    setRefreshToken(null);
  };

  const handleLogout = () => {
    if (decodedToken) {
      LogoutRequest(decodedToken)
        .finally(() => {
          clearAllAuthAtoms();
        });
    } else {
      clearAllAuthAtoms();
    }
  };

  const LOGO_SECTION = () => (
    <NavLink to="/dashboard" className="breeze-sidenav__brand" aria-label="Z3C home" onClick={onClose}>
      <img
        src="/images/primary-logo.svg"
        alt="Z3C"
        className="breeze-logo max-w-full object-contain object-left"
      />
    </NavLink>
  );

  const NAVIGATION_SECTION = () => (
    <nav className="breeze-sidenav__nav" aria-label="Primary">
      {filteredNavigation.map((item) => (
        <NavLink
          key={item.label}
          to={item.path}
          onClick={onClose}
          className="breeze-sidenav__link"
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
      className="breeze-sidenav__logout"
    >
      <span className="material-symbols-outlined">logout</span>
      <span>Logout</span>
    </button>
  );

  return (
    <>
      {isOpen && (
        <div
          className="breeze-sidenav-overlay lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`breeze-sidenav ${isOpen ? 'is-open' : ''}`}
        aria-label="Application sidebar"
      >
        <button
          type="button"
          className="breeze-sidenav__close"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
        {LOGO_SECTION()}
        {NAVIGATION_SECTION()}
        {LOGOUT_SECTION()}
      </aside>
    </>
  );
}

export default Sidebar;
