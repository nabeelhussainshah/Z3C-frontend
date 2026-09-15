import { useEffect } from 'react';
import { createPortal } from 'react-dom';

function ConfirmModal({
  isOpen,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  isConfirming = false,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isConfirming) onCancel?.();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isConfirming, onCancel]);

  if (!isOpen) return null;

  const handleCancel = () => {
    if (isConfirming) return;
    onCancel?.();
  };

  const handleConfirm = () => {
    if (isConfirming) return;
    onConfirm?.();
  };

  return createPortal(
    <div className="breeze-modal" onClick={handleCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby={description ? 'confirm-modal-description' : undefined}
        className="breeze-modal__dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="breeze-modal__body">
          <div className="breeze-modal__icon" aria-hidden="true">
            <span className="material-symbols-outlined">warning</span>
          </div>
          <div>
            <h3 id="confirm-modal-title" className="breeze-modal__title">
              {title}
            </h3>
            {description ? (
              <p id="confirm-modal-description" className="breeze-modal__description">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="breeze-modal__actions">
          <button
            type="button"
            onClick={handleCancel}
            className="breeze-btn breeze-btn--outline"
            disabled={isConfirming}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="breeze-btn breeze-btn--danger"
            disabled={isConfirming}
          >
            {isConfirming ? (
              <>
                <span className="breeze-btn__spinner" aria-hidden="true" />
                Processing...
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ConfirmModal;
