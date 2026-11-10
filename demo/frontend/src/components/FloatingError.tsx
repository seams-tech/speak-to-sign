import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconAlertCircle, IconX } from '@tabler/icons-react';

/**
 * The place for errors at the bottom of the screen, over the page: a column of small bars in the
 * middle. It is on document.body, so it stays in view while the page scrolls.
 */
export function FloatingErrors({ children }: { children: ReactNode }) {
  return createPortal(<div className="float-region">{children}</div>, document.body);
}

/** One error in the floating place. It stays until the visitor closes it. */
export function FloatingError({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="float-error" role="alert">
      <IconAlertCircle className="float-error-icon" size={18} stroke={1.8} aria-hidden="true" />
      <p className="float-error-text">{children}</p>
      <button type="button" className="float-error-close" aria-label="Close" onClick={onClose}>
        <IconX size={16} stroke={2} aria-hidden="true" />
      </button>
    </div>
  );
}
