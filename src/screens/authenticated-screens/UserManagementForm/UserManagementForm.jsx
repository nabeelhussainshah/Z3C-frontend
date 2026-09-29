// Packages
import { Fragment, useState, useMemo, Suspense, use, useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useNavigate, useParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';

// APIs
import { UserCreateRequest, UserDetailRequest, UserUpdateRequest } from '../../../requests';

// Utils
import { Footer, ErrorFallback } from '../../../components';
import { showToast, preventEnterSubmit, validateSubmissionData, decodeString, parseLoginInfo, getNormalizedModulePermissions } from '../../../utils';
import { auth, loginInfo } from '../../../atoms';

const PERMISSION_MODULES = ['invoice', 'customer', 'profile', 'companyProfile', 'user', 'dashboard', 'zatcaReporting', 'audit'];
const READ_ONLY_MODULES = ['dashboard', 'zatcaReporting', 'audit'];
const MODULE_LABELS = {
  invoice: 'Invoice',
  customer: 'Customer',
  profile: 'Customer Profile',
  companyProfile: 'Company Profile',
  zatcaReporting: 'ZATCA Reporting',
  audit: 'Audit Log',
  user: 'User Management',
  dashboard: 'Dashboard',
};
const CRUD_ACTIONS = ['read', 'create', 'update', 'delete'];
const USER_ROLES = ["Admin", "Manager", "Accountant", "Viewer"];

const getEmptyPermissions = () =>
  PERMISSION_MODULES.reduce((acc, module) => {
    acc[module] = { read: false, create: false, update: false, delete: false };
    return acc;
  }, {});

const getAllPermissions = () =>
  PERMISSION_MODULES.reduce((acc, module) => {
    if (READ_ONLY_MODULES.includes(module)) {
      acc[module] = { read: true, create: false, update: false, delete: false };
    } else {
      acc[module] = { read: true, create: true, update: true, delete: true };
    }
    return acc;
  }, {});

const INITIAL_FORM_DATA = {
  data: {
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    permissions: getEmptyPermissions(),
    role: 'Admin',
    isActive: true,
    isAdmin: false,
  },
  validations: {
    password: { isRequired: true, regex: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/ },
    username: { isRequired: true, label: "User Name" },
    email: { isRequired: true, regex: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/ },
  },
  errors: {},
};

function UserManagementForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const authValue = useAtomValue(auth);
  const decodedToken = useMemo(() => decodeString(authValue), [authValue]);

  const userPromise = useMemo(() => {
    if (id) {
      return UserDetailRequest(decodedToken, id).catch((err) => {
        console.error('Failed to fetch user details:', err);
        return { data: null, isError: true };
      });
    }
    return null;
  }, [id, decodedToken]);

  // *********** Render Functions ***********
  const CONTENT = () => (
    <Fragment>
      <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
        <Suspense fallback={
          <div className="breeze-page flex-1">
            <div className="breeze-form-card px-6 py-10">
              <div className="flex items-center justify-center gap-2 text-[var(--z3c-subtle)]">
                <span className="material-symbols-outlined animate-spin">sync</span>
                Loading user details...
              </div>
            </div>
          </div>
        }>
          <UserManagementFormContent
            id={id}
            userPromise={userPromise}
            decodedToken={decodedToken}
            navigate={navigate}
          />
        </Suspense>
      </ErrorBoundary>
    </Fragment>
  );

  return (
    <div id="user-management-form" className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

function UserManagementFormContent({ id, userPromise, decodedToken, navigate }) {
  const userData = userPromise ? use(userPromise) : null;
  const loginInfoValue = useAtomValue(loginInfo);
  const userPerms = useMemo(() => getNormalizedModulePermissions(parseLoginInfo(loginInfoValue), 'user'), [loginInfoValue]);
  const [formData, _formData] = useState({ ...INITIAL_FORM_DATA });
  const [isLoading, _isLoading] = useState(false);
  const [isShowPassword, _isShowPassword] = useState(false);
  const [isReadOnly, _isReadOnly] = useState(true);
  const [isShowConfirmPassword, _isShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (userData?.data) {
      const apiData = userData.data;
      _formData(old => ({
        ...old,
        data: {
          ...old.data,
          username: apiData.username || '',
          email: apiData.email || '',
          permissions: (() => {
            if (apiData.permissions && typeof apiData.permissions === 'object') {
              return PERMISSION_MODULES.reduce((acc, module) => {
                const mp = apiData.permissions[module] || {};
                const isReadOnlyModule = READ_ONLY_MODULES.includes(module);
                acc[module] = {
                  read: !!mp.read,
                  create: isReadOnlyModule ? false : !!mp.create,
                  update: isReadOnlyModule ? false : !!mp.update,
                  delete: isReadOnlyModule ? false : !!mp.delete,
                };
                return acc;
              }, {});
            }
            return getEmptyPermissions();
          })(),
          role: apiData.role && USER_ROLES.includes(apiData.role) ? apiData.role : 'Admin',
          isActive: typeof apiData.isActive === 'string'
            ? apiData.isActive === 'Yes'
            : !!apiData.isActive,
          isAdmin: typeof apiData.isAdmin === 'string'
            ? apiData.isAdmin === 'Yes'
            : !!apiData.isAdmin,
          password: '',
          confirmPassword: '',
        },
        validations: {
          ...old.validations,
          password: { isRequired: false, label: "Password" },
          confirmPassword: { isRequired: false, label: "Confirm Password" },
        },
      }));
    } else if (userData?.isError) {
      _formData({ ...INITIAL_FORM_DATA });
    } else if (!id) {
      _formData({ ...INITIAL_FORM_DATA });
    }
  }, [userData, id]);

  // *********** Handlers ***********
  const handleChangeFormData = (e) => {
    _formData(old => ({
      ...old,
      data: {
        ...old.data,
        [e.target.name]: e.target.value,
      },
    }));
  };

  const handleToggleIsActive = (e) => {
    _formData(old => ({
      ...old,
      data: { ...old.data, isActive: e.target.checked },
    }));
  };

  const handleTogglePermission = (module, action) => {
    _formData(old => ({
      ...old,
      data: {
        ...old.data,
        permissions: {
          ...old.data.permissions,
          [module]: {
            ...old.data.permissions[module],
            [action]: !old.data.permissions[module][action],
          },
        },
      },
    }));
  };

  const handleToggleModuleAll = (module, value) => {
    const isReadOnlyModule = READ_ONLY_MODULES.includes(module);
    _formData(old => ({
      ...old,
      data: {
        ...old.data,
        permissions: {
          ...old.data.permissions,
          [module]: isReadOnlyModule
            ? {
                read: value,
                create: false,
                update: false,
                delete: false,
              }
            : {
                read: value,
                create: value,
                update: value,
                delete: value,
              },
        },
      },
    }));
  };

  const handleToggleAllPermissions = (value) => {
    _formData(old => ({
      ...old,
      data: {
        ...old.data,
        permissions: value ? getAllPermissions() : getEmptyPermissions(),
      },
    }));
  };

  const handleValidateForm = () => {
    const { allValid, errors } = validateSubmissionData(formData.data, formData.validations);
    if (!allValid) {
      _formData(old => ({
        ...old,
        errors,
      }));
    } else {
      _formData(old => ({
        ...old,
        errors: {}
      }));
    }
    return allValid;
  };

  const handleSubmitForm = (e) => {
    if (e) e.preventDefault();

    if (formData.data.password && formData.data.password !== formData.data.confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    const hasAnyPermission = PERMISSION_MODULES.some((module) => {
      const mp = formData.data.permissions[module];
      return mp && (mp.read || mp.create || mp.update || mp.delete);
    });
    if (!hasAnyPermission) {
      showToast('Please grant at least one permission', 'error');
      return;
    }

    if (handleValidateForm()) {
      _isLoading(true);

      const payload = {
        username: formData.data.username,
        email: formData.data.email,
        isActive: !!formData.data.isActive,
        isAdmin: !!formData.data.isAdmin,
        role: formData.data.role || 'Admin',
        permissions: PERMISSION_MODULES.reduce((acc, module) => {
          const mp = formData.data.permissions[module] || {};
          const isReadOnlyModule = READ_ONLY_MODULES.includes(module);
          acc[module] = {
            read: !!mp.read,
            create: isReadOnlyModule ? false : !!mp.create,
            update: isReadOnlyModule ? false : !!mp.update,
            delete: isReadOnlyModule ? false : !!mp.delete,
          };
          return acc;
        }, {}),
      };
      if (formData.data.password) {
        payload.password = formData.data.password;
      }

      const request = id
        ? UserUpdateRequest(decodedToken, id, JSON.stringify(payload))
        : UserCreateRequest(decodedToken, JSON.stringify(payload));

      request
        .then(() => {
          showToast(id ? 'User updated successfully!' : 'User created successfully!', 'success');
          navigate('/user-management');
        })
        .catch((err) => {
          showToast(err?.message || (id ? 'Failed to update user' : 'Failed to create user'), 'error');
        })
        .finally(() => {
          _isLoading(false);
        });
    } else {
      showToast('Please fill in all required fields', 'error');
    }
  };

  const goToList = () => navigate('/user-management');

  const inputClassName = (name, extra = '') =>
    `breeze-form-input${formData.errors[name] ? ' breeze-form-input--invalid' : ''}${extra ? ` ${extra}` : ''}`;

  const SECTION_HEADER = ({ icon, title, lede, extra }) => (
    <div className="breeze-form-section__header flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <span className="breeze-form-section__badge" aria-hidden="true">
          <span className="material-symbols-outlined">{icon}</span>
        </span>
        <div className="min-w-0">
          <h3 className="breeze-form-section__title">{title}</h3>
          {lede ? <p className="breeze-form-section__lede">{lede}</p> : null}
        </div>
      </div>
      {extra}
    </div>
  );

  const PERMISSION_CHECKBOX = ({ checked, onChange, disabled, indeterminate, label, ariaLabel }) => (
    <label className={`breeze-check ${disabled ? 'pointer-events-none' : ''}`}>
      <input
        type="checkbox"
        className="breeze-check__box"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel || label}
        ref={indeterminate !== undefined ? (el) => {
          if (el) el.indeterminate = indeterminate;
        } : undefined}
        onChange={disabled ? undefined : onChange}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );

  const PERMISSION_ROW = (module, layout) => {
    const mp = formData.data.permissions[module] || {};
    const moduleActions = READ_ONLY_MODULES.includes(module) ? ['read'] : CRUD_ACTIONS;
    const allChecked = moduleActions.every((a) => !!mp[a]);
    const someChecked = moduleActions.some((a) => !!mp[a]);

    if (layout === 'card') {
      return (
        <div
          key={module}
          className="rounded-[14px] border border-[var(--z3c-border-card)] bg-white/40 p-4 dark:border-white/10 dark:bg-white/[0.04]"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm font-semibold text-[var(--z3c-heading)] min-w-0 dark:text-[#e8eef6]">
              {MODULE_LABELS[module]}
            </p>
            {PERMISSION_CHECKBOX({
              checked: allChecked,
              indeterminate: someChecked && !allChecked,
              label: 'All',
              onChange: (e) => handleToggleModuleAll(module, e.target.checked),
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {CRUD_ACTIONS.map((action) => (
              <div key={action} className="min-w-0">
                {READ_ONLY_MODULES.includes(module) && action !== 'read' ? (
                  <span className="text-[11px] italic text-[var(--z3c-hint)]">
                    {action.charAt(0).toUpperCase() + action.slice(1)} — N/A
                  </span>
                ) : PERMISSION_CHECKBOX({
                  checked: !!mp[action],
                  label: action.charAt(0).toUpperCase() + action.slice(1),
                  onChange: () => handleTogglePermission(module, action),
                })}
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <tr key={module} className="hover:bg-white/45 dark:hover:bg-[rgba(43,124,245,0.08)]">
        <td className="whitespace-nowrap px-3 py-3 text-sm font-medium text-[var(--z3c-heading)] md:px-4 dark:text-[#e8eef6]">
          {MODULE_LABELS[module]}
        </td>
        {CRUD_ACTIONS.map((action) => (
          <td key={action} className="px-3 py-3 text-center md:px-4">
            {READ_ONLY_MODULES.includes(module) && action !== 'read' ? (
              <span className="text-[11px] italic text-[var(--z3c-hint)]">N/A</span>
            ) : (
              <span className="inline-flex justify-center">
                {PERMISSION_CHECKBOX({
                  checked: !!mp[action],
                  ariaLabel: `${MODULE_LABELS[module]} ${action}`,
                  onChange: () => handleTogglePermission(module, action),
                })}
              </span>
            )}
          </td>
        ))}
        <td className="px-3 py-3 text-center md:px-4">
          <span className="inline-flex justify-center">
            {PERMISSION_CHECKBOX({
              checked: allChecked,
              indeterminate: someChecked && !allChecked,
              ariaLabel: `${MODULE_LABELS[module]} all permissions`,
              onChange: (e) => handleToggleModuleAll(module, e.target.checked),
            })}
          </span>
        </td>
      </tr>
    );
  };

  // *********** Render Functions ***********
  const PAGE_HEADER = () => (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <button
          type="button"
          onClick={goToList}
          className="breeze-link breeze-page__back"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          User Management
        </button>
        <h2 className="breeze-page__title">
          {id ? 'Edit User' : 'Create User'}
        </h2>
        <p className="breeze-page__lede">
          {id
            ? 'Update login details, module access, and account status'
            : 'Provision a local account with module permissions'}
        </p>
      </div>
    </div>
  );

  const ACCOUNT_SECTION = () => {
    return (
      <section className="breeze-form-section">
        {SECTION_HEADER({
          icon: 'manage_accounts',
          title: 'Account details',
          lede: 'Local username, email, and how this account authenticates.',
        })}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5">
          <div className="breeze-form-field">
            <label className="breeze-field__label" htmlFor="user-username">
              User Name
              <span className="breeze-form-required" aria-hidden="true"> *</span>
            </label>
            <input
              id="user-username"
              type="text"
              name="username"
              value={formData.data.username}
              onChange={handleChangeFormData}
              placeholder="Enter username"
              readOnly={isReadOnly}
              onFocus={() => _isReadOnly(false)}
              onBlur={() => _isReadOnly(true)}
              aria-invalid={Boolean(formData.errors.username)}
              aria-describedby={formData.errors.username ? 'user-username-error' : undefined}
              className={inputClassName('username')}
            />
            {formData.errors.username ? (
              <span className="breeze-field__error" id="user-username-error">
                {formData.errors.username}
              </span>
            ) : null}
          </div>

          <div className="breeze-form-field">
            <label className="breeze-field__label" htmlFor="user-email">
              Email
              <span className="breeze-form-required" aria-hidden="true"> *</span>
            </label>
            <input
              id="user-email"
              type="email"
              name="email"
              value={formData.data.email}
              onChange={handleChangeFormData}
              placeholder="Enter email"
              readOnly={isReadOnly}
              onFocus={() => _isReadOnly(false)}
              onBlur={() => _isReadOnly(true)}
              aria-invalid={Boolean(formData.errors.email)}
              aria-describedby={formData.errors.email ? 'user-email-error' : undefined}
              className={inputClassName('email')}
            />
            {formData.errors.email ? (
              <span className="breeze-field__error" id="user-email-error">
                {formData.errors.email}
              </span>
            ) : null}
          </div>
        </div>

      </section>
    );
  };

  const PERMISSIONS_SECTION = () => {
    return (
      <section className="breeze-form-section">
        {SECTION_HEADER({
          icon: 'admin_panel_settings',
          title: 'Permissions',
          lede: 'Grant at least one module permission for this local account.',
          extra: (
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => handleToggleAllPermissions(true)}
                className="breeze-link text-[12.5px]"
              >
                Grant All
              </button>
              <span className="text-[var(--z3c-hint)]" aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => handleToggleAllPermissions(false)}
                className="breeze-link text-[12.5px] !text-[var(--z3c-subtle)]"
              >
                Revoke All
              </button>
            </div>
          ),
        })}

        <div className="md:hidden flex flex-col gap-3">
          {PERMISSION_MODULES.map((module) => PERMISSION_ROW(module, 'card'))}
        </div>

        <div className="hidden md:block overflow-x-auto rounded-[14px] border border-[var(--z3c-border-card)] bg-white/40 dark:border-white/10 dark:bg-white/[0.04]">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-[rgba(224,237,244,0.45)] text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--z3c-subtle)] dark:bg-white/[0.04] dark:text-[#9bb6d4]">
              <tr>
                <th className="px-3 py-3 text-left md:px-4">Module</th>
                {CRUD_ACTIONS.map((action) => (
                  <th key={action} className="px-3 py-3 text-center md:px-4">
                    {action.charAt(0).toUpperCase() + action.slice(1)}
                  </th>
                ))}
                <th className="px-3 py-3 text-center md:px-4">All</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(218,231,247,0.7)] dark:divide-white/10">
              {PERMISSION_MODULES.map((module) => PERMISSION_ROW(module, 'table'))}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const SECURITY_SECTION = () => {
    const passwordRequired = !!formData.validations.password?.isRequired;

    return (
      <section className="breeze-form-section">
        {SECTION_HEADER({
          icon: 'lock',
          title: 'Security & status',
          lede: id
            ? 'Leave password blank to keep the current value.'
            : 'Set a strong password and whether this account is active.',
        })}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5">
          <div className="breeze-form-field">
            <label className="breeze-field__label" htmlFor="user-password">
              Password
              {passwordRequired ? <span className="breeze-form-required" aria-hidden="true"> *</span> : null}
            </label>
            <div className="breeze-field__control">
              <input
                id="user-password"
                type={isShowPassword ? 'text' : 'password'}
                name="password"
                value={formData.data.password}
                onChange={handleChangeFormData}
                placeholder="••••••••"
                autoComplete="new-password"
                readOnly={isReadOnly}
                onFocus={() => _isReadOnly(false)}
                onBlur={() => _isReadOnly(true)}
                aria-invalid={Boolean(formData.errors.password)}
                aria-describedby={formData.errors.password ? 'user-password-error' : undefined}
                className={inputClassName('password', 'pr-11')}
              />
              <button
                type="button"
                className="breeze-field__reveal"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => _isShowPassword((prev) => !prev)}
                aria-label={isShowPassword ? 'Hide password' : 'Show password'}
              >
                <span className="material-symbols-outlined">
                  {isShowPassword ? 'visibility' : 'visibility_off'}
                </span>
              </button>
            </div>
            {formData.errors.password ? (
              <span className="breeze-field__error" id="user-password-error">
                {formData.errors.password?.includes('valid')
                  ? 'Password should be alphanumeric with special characters'
                  : formData.errors.password}
              </span>
            ) : (
              <p className="breeze-form-hint">
                Must include upper and lower case letters, a number, and a special character.
              </p>
            )}
          </div>

          <div className="breeze-form-field">
            <label className="breeze-field__label" htmlFor="user-confirmPassword">
              Confirm Password
              {passwordRequired ? <span className="breeze-form-required" aria-hidden="true"> *</span> : null}
            </label>
            <div className="breeze-field__control">
              <input
                id="user-confirmPassword"
                type={isShowConfirmPassword ? 'text' : 'password'}
                name="confirmPassword"
                value={formData.data.confirmPassword}
                onChange={handleChangeFormData}
                placeholder="••••••••"
                autoComplete="new-password"
                className={inputClassName('confirmPassword', 'pr-11')}
              />
              <button
                type="button"
                className="breeze-field__reveal"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => _isShowConfirmPassword((prev) => !prev)}
                aria-label={isShowConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                <span className="material-symbols-outlined">
                  {isShowConfirmPassword ? 'visibility' : 'visibility_off'}
                </span>
              </button>
            </div>
            {formData.errors.confirmPassword ? (
              <span className="breeze-field__error" id="user-confirmPassword-error">
                {formData.errors.confirmPassword}
              </span>
            ) : null}
          </div>
        </div>

        <label className="breeze-check w-fit">
          <input
            type="checkbox"
            id="isActive"
            name="isActive"
            className="breeze-check__box"
            checked={formData.data.isActive}
            onChange={handleToggleIsActive}
          />
          Is Active
        </label>
      </section>
    );
  };

  const FORM_ACTIONS = () => (
    <div className="breeze-form-actions">
      <button
        type="button"
        onClick={goToList}
        className="breeze-btn breeze-btn--outline breeze-btn--inline w-full sm:w-auto"
      >
        Cancel
      </button>
      {(!id || userPerms.update) && (
        <button
          type="submit"
          disabled={isLoading || userData?.isError}
          className="breeze-btn breeze-btn--primary breeze-btn--inline w-full sm:w-auto min-w-[140px]"
        >
          {isLoading ? (
            <Fragment>
              <span className="breeze-btn__spinner" aria-hidden="true" />
              Saving...
            </Fragment>
          ) : (
            <Fragment>
              <span className="material-symbols-outlined text-[18px]">save</span>
              {id ? 'Save changes' : 'Create user'}
            </Fragment>
          )}
        </button>
      )}
    </div>
  );

  const USER_FORM = () => (
    <div className="breeze-form-card">
      <form className="breeze-form" onSubmit={handleSubmitForm} onKeyDown={preventEnterSubmit} noValidate>
        {userData?.isError && (
          <div className="breeze-alert" role="alert">
            <span className="material-symbols-outlined">error</span>
            <span>Unable to load this user. You can go back to the list and try again.</span>
          </div>
        )}
        {ACCOUNT_SECTION()}
        {PERMISSIONS_SECTION()}
        {SECURITY_SECTION()}
        {FORM_ACTIONS()}
      </form>
    </div>
  );

  const CONTENT = () => (
    <Fragment>
      <div className="breeze-page flex-1">
        {PAGE_HEADER()}
        {USER_FORM()}
      </div>
      <Footer />
    </Fragment>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {CONTENT()}
    </div>
  );
}

export default UserManagementForm;
