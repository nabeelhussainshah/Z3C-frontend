// Packages
import { Fragment, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useAtomValue } from 'jotai';

// Atoms
import { loginInfo } from '../../atoms';

// Utils
import { useTheme } from '../../contexts/ThemeContext';
import { decodeString } from '../../utils';

function Header({ onMenuOpen = () => {} }) {
  const { theme, toggleTheme } = useTheme();
  const loginInfoValue = useAtomValue(loginInfo);

  const user = useMemo(() => {
    try {
      if (!loginInfoValue) return null;
      return JSON.parse(decodeString(loginInfoValue));
    } catch (error) {
      console.error('Failed to parse user info:', error);
      return null;
    }
  }, [loginInfoValue]);

  const userName = user?.username || user?.fullName || user?.name || 'Guest';
  const userRole = user?.role || user?.userRole || 'Administrator';

  const ACTIONS_SECTION = () => (
    <div className="breeze-topbar__actions">
      <button type="button" className="breeze-icon-btn hidden sm:grid" aria-label="Notifications">
        <span className="material-symbols-outlined">notifications</span>
        <span className="breeze-icon-btn__badge" aria-hidden="true" />
      </button>
      <button type="button" className="breeze-icon-btn hidden sm:grid" aria-label="Settings">
        <span className="material-symbols-outlined">settings</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleTheme();
        }}
        className="breeze-icon-btn"
        aria-label="Toggle theme"
      >
        <span className="material-symbols-outlined">
          {theme === 'light' ? 'dark_mode' : 'light_mode'}
        </span>
      </button>
      <div className="breeze-topbar__divider" aria-hidden="true" />
      <div className="breeze-user">
        <div className="breeze-user__meta hidden sm:block">
          <p className="breeze-user__name">{userName}</p>
          <p className="breeze-user__role">{userRole}</p>
        </div>
        <div
          className="breeze-user__avatar"
          style={{
            backgroundImage: `url("${user?.profilePicture || '/images/profile_pic.png'}")`,
          }}
          role="img"
          aria-label="User avatar"
        />
      </div>
    </div>
  );

  const HEADER_CONTENT = () => (
    <Fragment>
      <div className="breeze-topbar__brand gap-2">
        <button
          type="button"
          className="breeze-icon-btn lg:hidden"
          onClick={onMenuOpen}
          aria-label="Open navigation"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <NavLink to="/dashboard" className="lg:hidden" aria-label="Z3C home">
          <img src="/images/primary-logo.svg" alt="Z3C" className="breeze-logo" />
        </NavLink>
      </div>
      {ACTIONS_SECTION()}
    </Fragment>
  );

  return (
    <header className="breeze-topbar sticky top-0 z-20">
      {HEADER_CONTENT()}
    </header>
  );
}

export default Header;
