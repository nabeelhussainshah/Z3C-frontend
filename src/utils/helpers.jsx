// Packages
import toast, { toastConfig } from 'react-simple-toasts';
import 'react-simple-toasts/dist/style.css';
import 'react-simple-toasts/dist/theme/dark.css';
import CryptoJS from "crypto-js";

// Constants
import { TOAST_TYPES, ENCODER } from './constants';

// Toast Configuration
toastConfig({
  position: 'top-right',
  duration: 3500,
  clickClosable: true,
  maxVisibleToasts: 3,
  className: 'toast-custom',
});

// Toast Helper Function
export const showToast = (message, type = 'info', options = {}) => {
  const config = TOAST_TYPES[type] || TOAST_TYPES.info;

  return toast(message, {
    ...options,
    render: (msg) => (
      <div className={`flex items-center gap-3 px-4 py-3 ${config.bgColor} border ${config.borderColor} rounded-lg shadow-lg text-sm text-[#0d121b] dark:text-white`}>
        <span className={`material-symbols-outlined text-[20px] ${config.iconColor}`}>
          {config.icon}
        </span>
        <span>{msg}</span>
      </div>
    ),
  });
};

/**
 * Use as a form's onKeyDown: Enter in a text/number field must not submit the
 * form (saving stays an explicit click on Save). Dropdowns, checkboxes and
 * buttons keep their own Enter behaviour.
 */
const NON_TEXT_INPUT_TYPES = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'];
export const preventEnterSubmit = (e) => {
  const target = e.target;
  if (e.key === 'Enter' && target?.tagName === 'INPUT' && !NON_TEXT_INPUT_TYPES.includes(target.type)) {
    e.preventDefault();
  }
};

export const encodeString = (val, encoder = null) => {
  const encodedWith = encoder || ENCODER;
  const ciphertext = CryptoJS.AES.encrypt(val, encodedWith).toString();
  return ciphertext;
};

export const decodeString = (val, encoder = null) => {
  const decodedWith = encoder || ENCODER;
  const bytes = CryptoJS.AES.decrypt(val, decodedWith);
  const originalText = bytes.toString(CryptoJS.enc.Utf8);
  return originalText;
};

// Safely parse and normalize login info stored in the `loginInfo` atom.
// Supports both the legacy `{ user: { ... } }` envelope and a direct user object.
export const parseLoginInfo = (loginInfoValue) => {
  if (!loginInfoValue) return null;

  try {
    const parsed = JSON.parse(decodeString(loginInfoValue));
    if (!parsed) return null;

    const user = parsed.user && typeof parsed.user === 'object' ? parsed.user : parsed;
    return user && typeof user === 'object' ? user : null;
  } catch (error) {
    console.error('Failed to parse login info:', error);
    return null;
  }
};

// Normalize CRUD permissions for a specific module.
// If a permissions object is not present for a module (e.g. `user: null`),
// the user has no rights for that module.
export const getNormalizedModulePermissions = (user, moduleKey) => {
  if (!user || !moduleKey) {
    return { create: false, read: false, update: false, delete: false };
  }

  const allPermissions = user.permissions;

  // If the backend doesn't send a permissions object at all,
  // treat it as "no module-level restrictions".
  if (!allPermissions || typeof allPermissions !== 'object') {
    return { create: true, read: true, update: true, delete: true };
  }

  const modulePermissionsRaw = allPermissions[moduleKey];

  // Explicit `null` (or non-object) means "no access" for that module.
  if (modulePermissionsRaw == null || typeof modulePermissionsRaw !== 'object') {
    return { create: false, read: false, update: false, delete: false };
  }

  const modulePermissions = modulePermissionsRaw;

  return {
    create: modulePermissions.create === true,
    read: modulePermissions.read === true,
    update: modulePermissions.update === true,
    delete: modulePermissions.delete === true,
  };
};

// Convenience helper to check a single CRUD action for a module.
export const hasModulePermission = (user, moduleKey, action) => {
  const normalized = getNormalizedModulePermissions(user, moduleKey);
  if (!['create', 'read', 'update', 'delete'].includes(action)) return true;
  return Boolean(normalized[action]);
};