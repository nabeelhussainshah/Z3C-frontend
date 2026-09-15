// Packages
import { Fragment, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

// APIs
import { ForgotPasswordRequest, ResetPasswordRequest } from '../../../requests';

// Utils
import { showToast, validateSubmissionData, SUPPORT_EMAIL } from '../../../utils';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HERO_FEATURES = [
  { icon: 'verified_user', lines: ['Secure', 'Transactions'] },
  { icon: 'bolt', lines: ['Real-time', 'Insights'] },
  { icon: 'bar_chart', lines: ['Smarter', 'Analytics'] },
  { icon: 'groups', lines: ['Built for', 'Your Growth'] },
];

function ForgotResetPassword() {
  const navigate = useNavigate();
  const INITIAL_FORM_DATA = {
    data: {
      email: '',
      otpCode: '',
      newPassword: '',
      confirmPassword: '',
    },
    validations: {
      email: { isRequired: true, label: 'Email', regex: EMAIL_REGEX },
      otpCode: { isRequired: true, label: 'OTP Code' },
      newPassword: { isRequired: true, label: 'New Password' },
      confirmPassword: { isRequired: true, label: 'Confirm Password' },
    },
    errors: {},
  };

  const [formData, _formData] = useState(INITIAL_FORM_DATA);
  const [isOtpSend, _isOtpSend] = useState(false);
  const [tempToken, _tempToken] = useState('');
  const [isLoading, _isLoading] = useState(false);

  // *********** Handlers ***********

  const handleChangeFormData = (e) => {
    const { name, value } = e.target;
    _formData((old) => ({
      ...old,
      data: {
        ...old.data,
        [name]: value,
      },
      errors: {
        ...old.errors,
        [name]: '',
      },
    }));
  };

  const handleValidateForm = () => {
    const validationsToUse = isOtpSend
      ? {
        otpCode: formData.validations.otpCode,
        newPassword: formData.validations.newPassword,
        confirmPassword: formData.validations.confirmPassword,
      }
      : { email: formData.validations.email };

    const dataToValidate = isOtpSend
      ? {
        otpCode: formData.data.otpCode,
        newPassword: formData.data.newPassword,
        confirmPassword: formData.data.confirmPassword,
      }
      : { email: formData.data.email };

    const { allValid, errors } = validateSubmissionData(dataToValidate, validationsToUse);
    let nextErrors = { ...errors };
    let isValid = allValid;

    if (
      isOtpSend &&
      !errors.confirmPassword &&
      formData.data.newPassword !== formData.data.confirmPassword
    ) {
      nextErrors.confirmPassword = 'Confirm Password must match New Password';
      isValid = false;
    }

    _formData((old) => ({
      ...old,
      errors: nextErrors,
    }));

    return isValid;
  };

  const handleRequestOtp = () => {
    _isLoading(true);

    ForgotPasswordRequest({ email: formData.data.email.trim() })
      .then((result) => {
        const nextTempToken = result?.data?.tempToken ?? result?.tempToken;
        const successMessage =
          result?.message ??
          result?.data?.message ??
          'OTP sent successfully. Please check your email.';

        if (!nextTempToken) {
          throw new Error('Temporary token not received from forgot password response.');
        }

        _tempToken(nextTempToken);
        _isOtpSend(true);
        _formData((old) => ({
          ...old,
          data: {
            ...old.data,
            otpCode: '',
            newPassword: '',
            confirmPassword: '',
          },
          errors: {},
        }));
        showToast(successMessage, 'success');
      })
      .catch((err) => {
        showToast(err?.message || 'Failed to send OTP. Please try again.', 'error');
      })
      .finally(() => {
        _isLoading(false);
      });
  };

  const handleResetPassword = () => {
    _isLoading(true);

    ResetPasswordRequest({
      tempToken,
      newPassword: formData.data.newPassword,
      otpCode: formData.data.otpCode.trim(),
    })
      .then((result) => {
        const successMessage =
          result?.message ??
          result?.data?.message ??
          'Password reset successfully. Please sign in.';

        showToast(successMessage, 'success');
        navigate('/login');
      })
      .catch((err) => {
        showToast(err?.message || 'Failed to reset password. Please try again.', 'error');
      })
      .finally(() => {
        _isLoading(false);
      });
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (isLoading) {
      showToast('Please wait for the current request to finish', 'error');
      return;
    }

    if (!handleValidateForm()) {
      showToast('Please correct the highlighted fields', 'error');
      return;
    }

    if (isOtpSend) {
      handleResetPassword();
      return;
    }

    handleRequestOtp();
  };

  const handleUseAnotherEmail = () => {
    _isOtpSend(false);
    _tempToken('');
    _formData((old) => ({
      ...old,
      data: {
        ...old.data,
        otpCode: '',
        newPassword: '',
        confirmPassword: '',
      },
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

  const FIELD = ({
    name,
    label,
    icon,
    placeholder,
    type = 'text',
    autoComplete,
    inputMode,
    maxLength,
  }) => {
    const fieldError = formData.errors[name];

    return (
      <div className="breeze-field">
        <label className="breeze-field__label" htmlFor={`forgot-${name}`}>
          {label}
        </label>
        <div className="breeze-field__control">
          <span className="material-symbols-outlined breeze-field__icon">{icon}</span>
          <input
            id={`forgot-${name}`}
            name={name}
            type={type}
            className={`breeze-input${fieldError ? ' breeze-input--invalid' : ''}`}
            placeholder={placeholder}
            value={formData.data[name]}
            onChange={handleChangeFormData}
            autoComplete={autoComplete}
            inputMode={inputMode}
            maxLength={maxLength}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? `forgot-${name}-error` : undefined}
          />
        </div>
        {fieldError && (
          <span className="breeze-field__error" id={`forgot-${name}-error`}>
            {fieldError}
          </span>
        )}
      </div>
    );
  };

  const EMAIL_FIELD = () =>
    FIELD({
      name: 'email',
      label: 'Email Address',
      icon: 'mail',
      type: 'email',
      placeholder: 'name@company.com',
      autoComplete: 'email',
    });

  const RESET_FIELDS = () => (
    <Fragment>
      <div className="breeze-field" style={{ marginBottom: '24px' }}>
        <div className="rounded-lg border border-[#D0E0F5] bg-[#F0F7FF] p-3 flex items-start gap-2">
          <span className="material-symbols-outlined text-[#2B7CF5] text-[18px]">info</span>
          <p className="text-[13px] text-[#2A5488] leading-tight">
            OTP sent to <span className="font-semibold text-[#01285E]">{formData.data.email}</span>
          </p>
        </div>
      </div>

      {FIELD({
        name: 'otpCode',
        label: 'OTP Code',
        icon: 'pin',
        placeholder: 'Enter OTP code',
        autoComplete: 'one-time-code',
        inputMode: 'numeric',
      })}

      {FIELD({
        name: 'newPassword',
        label: 'New Password',
        icon: 'lock',
        type: 'password',
        placeholder: 'Enter new password',
        autoComplete: 'new-password',
      })}

      {FIELD({
        name: 'confirmPassword',
        label: 'Confirm Password',
        icon: 'lock',
        type: 'password',
        placeholder: 'Confirm new password',
        autoComplete: 'new-password',
      })}
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
      <div className="breeze-options">
        <Link to="/login" className="breeze-link">
          Back to sign in
        </Link>

        {isOtpSend && (
          <button
            type="button"
            onClick={handleUseAnotherEmail}
            className="breeze-link !text-[#4c669a]"
          >
            Use another email
          </button>
        )}
      </div>

      {!isOtpSend && (
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
      )}
    </Fragment>
  );

  const AUTH_CARD = () => {
    const heading = isOtpSend
      ? {
          title: 'Set a New Password',
          subtitle: 'Enter the OTP code sent to your email and choose a new password.',
        }
      : {
          title: 'Forgot Password',
          subtitle: 'Enter your email address and we will send you an OTP code to reset your password.',
        };

    return (
      <Fragment>
        <div className="breeze-card">
          <h2 className="breeze-card__title">{heading.title}</h2>
          <p className="breeze-card__subtitle">{heading.subtitle}</p>
          <form className="breeze-card__form" onSubmit={handleSubmit} noValidate>
            {/* Hidden decoy fields help prevent aggressive browser autofill on reset flows. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              tabIndex="-1"
              className="hidden"
              aria-hidden="true"
            />
            <input
              type="password"
              name="current-password"
              autoComplete="current-password"
              tabIndex="-1"
              className="hidden"
              aria-hidden="true"
            />

            {!isOtpSend ? EMAIL_FIELD() : RESET_FIELDS()}
            {SUBMIT_BUTTON(
              isOtpSend ? 'Reset Password' : 'Send OTP',
              isOtpSend ? 'Resetting Password...' : 'Sending OTP...'
            )}
          </form>
          {CARD_FOOTER()}
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

export default ForgotResetPassword;
