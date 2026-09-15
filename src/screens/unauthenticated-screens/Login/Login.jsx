// Packages
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSetAtom } from 'jotai';

// APIs
import { LoginRequest, VerifyOtpRequest } from '../../../requests';

// Utils
import { showToast, validateSubmissionData, encodeString, SUPPORT_EMAIL } from '../../../utils';
import { auth, loginInfo, refreshToken } from '../../../atoms';

const REMEMBERED_EMAIL_KEY = 'z3c.remembered-email';

const HERO_FEATURES = [
  { icon: 'verified_user', lines: ['Secure', 'Transactions'] },
  { icon: 'bolt', lines: ['Real-time', 'Insights'] },
  { icon: 'bar_chart', lines: ['Smarter', 'Analytics'] },
  { icon: 'groups', lines: ['Built for', 'Your Growth'] },
];

function Login() {
  const INITIAL_FORM_DATA = {
    data: {
      email: '',
      password: '',
      otp: '',
    },
    validations: {
      email: { isRequired: true, label: 'Email' },
      password: { isRequired: true, label: 'Password' },
      otp: { isRequired: true, label: 'OTP' },
    },
    errors: {},
  };

  // Email of a returning user who opted into "Remember me".
  const rememberedEmail = localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? '';

  const [formData, _formData] = useState({
    ...INITIAL_FORM_DATA,
    data: { ...INITIAL_FORM_DATA.data, email: rememberedEmail },
  });
  const [showOtpCard, _showOtpCard] = useState(false);
  const [tempToken, _tempToken] = useState('');
  const [isLoading, _isLoading] = useState(false);
  const [showPassword, _showPassword] = useState(false);
  const [error, _error] = useState(null);
  const [rememberMe, _rememberMe] = useState(Boolean(rememberedEmail));

  const setAuth = useSetAtom(auth);
  const setLoginInfo = useSetAtom(loginInfo);
  const setRefreshToken = useSetAtom(refreshToken);

  // *********** Handlers ***********

  const handleChangeFormData = (e) => {
    const { name, value } = e.target;
    if (error) _error(null);
    _formData((old) => ({
      ...old,
      data: {
        ...old.data,
        [name]: value,
      },
    }));
  };

  const handleValidateForm = () => {
    const validationsToUse = showOtpCard
      ? { otp: formData.validations.otp }
      : { email: formData.validations.email, password: formData.validations.password };

    const { allValid, errors } = validateSubmissionData(
      formData.data,
      validationsToUse
    );

    if (!allValid) {
      _formData((old) => ({
        ...old,
        errors,
      }));
    } else {
      _formData((old) => ({
        ...old,
        errors: {},
      }));
    }

    return allValid;
  };

  const handlePersistEmail = () => {
    if (rememberMe) localStorage.setItem(REMEMBERED_EMAIL_KEY, formData.data.email);
    else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!handleValidateForm()) {
      showToast('Please fill in all required fields', 'error');
      return;
    }
    _isLoading(true);
    _error(null);

    if (showOtpCard) {
      const payload = JSON.stringify({
        tempToken: tempToken,
        otpCode: formData.data.otp,
      });
      VerifyOtpRequest(payload)
        .then((result) => {
          const accessToken = result?.data?.accessToken;
          const newRefreshToken = result?.data?.refreshToken;
          const user = result?.data?.user;
          const encodedToken = encodeString(accessToken);
          const encodedUser = encodeString(JSON.stringify(user));
          setAuth(encodedToken);
          setLoginInfo(encodedUser);
          if (newRefreshToken) setRefreshToken(encodeString(newRefreshToken));
          showToast('OTP verified successful', 'success');
        })
        .catch((err) => {
          const message = err?.message ?? 'OTP verification failed.';
          _error(message);
          showToast(message, 'error');
        })
        .finally(() => {
          _isLoading(false);
        });
    } else {
      const payload = JSON.stringify({
        email: formData.data.email,
        password: formData.data.password,
      });
      LoginRequest(payload)
        .then((result) => {
          const data = result?.data ?? result;
          // When 2FA is disabled the backend returns a full session directly
          // (requireOTP === false); log the user straight in, no OTP step.
          if (data?.requireOTP === false || data?.accessToken) {
            const accessToken = data?.accessToken;
            const newRefreshToken = data?.refreshToken;
            const user = data?.user;
            setAuth(encodeString(accessToken));
            setLoginInfo(encodeString(JSON.stringify(user)));
            if (newRefreshToken) setRefreshToken(encodeString(newRefreshToken));
            handlePersistEmail();
            showToast('Login successful', 'success');
            return;
          }
          const token = data?.tempToken;
          _tempToken(token);
          _showOtpCard(true);
          handlePersistEmail();
          showToast('Please enter OTP.', 'info');
        })
        .catch((err) => {
          const message = err?.message ?? 'Login failed. Please try again.';
          _error(message);
          showToast(message, 'error');
        })
        .finally(() => {
          _isLoading(false);
        });
    }
  };

  const handleTogglePassword = () => {
    _showPassword((prev) => !prev);
  };

  const handleBackToSignIn = () => {
    _showOtpCard(false);
    _showPassword(false);
    _error(null);
    _formData((old) => ({
      ...old,
      data: { ...old.data, otp: '' },
      errors: {},
    }));
  };

  // *********** Render Functions ***********

  const HEADER = () => (
    <Fragment>
      <header className="breeze-shell breeze-header">
        <Link to="/login" aria-label="Z3C home">
          <img src="/images/primary-logo.svg" alt="Z3C" className="breeze-logo" />
        </Link>
      </header>
    </Fragment>
  );

  const HERO = () => (
    <Fragment>
      <section className="breeze-hero">
        <p className="breeze-hero__eyebrow">Fintech solutions for a smarter tomorrow</p>
        <h1 className="breeze-hero__title">Powering Financial Operations with Clarity</h1>
        <p className="breeze-hero__lede">
          Secure, scalable and intuitive platform to manage your transactions, monitor
          performance and make smarter financial decisions — all in one place.
        </p>
        <ul className="breeze-features">
          {HERO_FEATURES.map((feature) => (
            <li key={feature.icon} className="breeze-feature">
              <span className="breeze-feature__badge">
                <span className="material-symbols-outlined">{feature.icon}</span>
              </span>
              <span className="breeze-feature__label">
                {feature.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Fragment>
  );

  const ALERT = () => (
    <Fragment>
      {error && (
        <div className="breeze-alert" role="alert">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}
    </Fragment>
  );

  const FIELD = ({
    name,
    label,
    icon,
    placeholder,
    type = 'text',
    autoComplete,
    inputMode,
    maxLength,
    isRevealable = false,
  }) => {
    const fieldError = formData.errors[name];
    const inputType = isRevealable && showPassword ? 'text' : type;

    return (
      <div className="breeze-field">
        <label className="breeze-field__label" htmlFor={`login-${name}`}>
          {label}
        </label>
        <div className="breeze-field__control">
          <span className="material-symbols-outlined breeze-field__icon">{icon}</span>
          <input
            id={`login-${name}`}
            name={name}
            type={inputType}
            className={`breeze-input${isRevealable ? ' breeze-input--reveal' : ''}${
              fieldError ? ' breeze-input--invalid' : ''
            }`}
            placeholder={placeholder}
            value={formData.data[name]}
            onChange={handleChangeFormData}
            autoComplete={autoComplete}
            inputMode={inputMode}
            maxLength={maxLength}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? `login-${name}-error` : undefined}
          />
          {isRevealable && (
            <button
              type="button"
              className="breeze-field__reveal"
              onClick={handleTogglePassword}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <span className="material-symbols-outlined">
                {showPassword ? 'visibility' : 'visibility_off'}
              </span>
            </button>
          )}
        </div>
        {fieldError && (
          <span className="breeze-field__error" id={`login-${name}-error`}>
            {fieldError}
          </span>
        )}
      </div>
    );
  };

  const PASSWORD_FIELD = () =>
    FIELD({
      name: 'password',
      label: 'Password',
      icon: 'lock',
      type: 'password',
      placeholder: 'Enter your password',
      autoComplete: 'current-password',
      isRevealable: true,
    });

  const OPTIONS_ROW = () => (
    <Fragment>
      <div className="breeze-options">
        <label className="breeze-check">
          <input
            type="checkbox"
            className="breeze-check__box"
            checked={rememberMe}
            onChange={(e) => _rememberMe(e.target.checked)}
          />
          Remember me
        </label>
        <Link to="/forgot-password" className="breeze-link">
          Forgot password?
        </Link>
      </div>
    </Fragment>
  );

  const SUBMIT_BUTTON = (label, loadingLabel) => (
    <Fragment>
      <button type="submit" className="breeze-btn breeze-btn--primary" disabled={isLoading}>
        {isLoading ? (
          <Fragment>
            <span className="breeze-btn__spinner" />
            {loadingLabel}
          </Fragment>
        ) : (
          <Fragment>
            {label}
            <span className="material-symbols-outlined breeze-btn__icon">arrow_forward</span>
          </Fragment>
        )}
      </button>
    </Fragment>
  );

  const CARD_FOOTER = () => (
    <Fragment>
      <p className="breeze-card__footer">
        Don&apos;t have an account?
        {SUPPORT_EMAIL ? (
          <a className="breeze-link" href={`mailto:${SUPPORT_EMAIL}`}>
            Contact your administrator.
          </a>
        ) : (
          <span className="breeze-link" style={{ cursor: 'default' }}>
            Contact your administrator.
          </span>
        )}
      </p>
    </Fragment>
  );

  const CREDENTIALS_FORM = () => (
    <Fragment>
      {FIELD({
        name: 'email',
        label: 'Email Address',
        icon: 'mail',
        type: 'email',
        placeholder: 'name@company.com',
        autoComplete: 'email',
      })}
      {PASSWORD_FIELD()}
      {OPTIONS_ROW()}
      {SUBMIT_BUTTON('Sign In', 'Signing in...')}
    </Fragment>
  );

  const OTP_FORM = () => (
    <Fragment>
      {FIELD({
        name: 'otp',
        label: 'Verification Code',
        icon: 'pin',
        placeholder: 'Enter the 6-digit code',
        autoComplete: 'one-time-code',
        inputMode: 'numeric',
        maxLength: 6,
      })}
      <div className="breeze-options">
        <button type="button" className="breeze-link" onClick={handleBackToSignIn}>
          Back to sign in
        </button>
      </div>
      {SUBMIT_BUTTON('Verify', 'Verifying...')}
    </Fragment>
  );

  const AUTH_CARD = () => {
    const heading = showOtpCard
      ? { title: 'Verify OTP', subtitle: 'A verification code has been sent to your email address.' }
      : { title: 'Sign In', subtitle: 'Welcome back! Please sign in to your account.' };

    return (
      <Fragment>
        <div className="breeze-card">
          <h2 className="breeze-card__title">{heading.title}</h2>
          <p className="breeze-card__subtitle">{heading.subtitle}</p>
          {ALERT()}
          <form className="breeze-card__form" onSubmit={handleSubmit} noValidate>
            {showOtpCard ? OTP_FORM() : CREDENTIALS_FORM()}
          </form>
          {!showOtpCard && CARD_FOOTER()}
        </div>
      </Fragment>
    );
  };

  const FOOTER = () => (
    <Fragment>
      <footer className="breeze-shell breeze-footer">
        © {new Date().getFullYear()} Z3C. All rights reserved.
      </footer>
    </Fragment>
  );

  const LAYOUT = () => (
    <Fragment>
      <div className="breeze-auth">
        <div className="breeze-auth__backdrop" aria-hidden="true" />
        {HEADER()}
        <main className="breeze-shell breeze-main">
          {HERO()}
          {AUTH_CARD()}
        </main>
        {FOOTER()}
      </div>
    </Fragment>
  );

  return LAYOUT();
}

export default Login;
