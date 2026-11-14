// A warning pill in the nav of a demo page: an icon, one sentence, an optional link and a close
// button. NearAiWarning and OutlayerWarning fill it.
//
// A wide nav shows the sentence, a middle one the short words, and a phone the icon only: a tap
// on the icon opens the sentence under the nav (navWarning.css).

import { useState } from 'react';
import { IconAlertTriangle, IconExternalLink, IconX } from '@tabler/icons-react';
import './navWarning.css';

export interface NavWarningLink {
  href: string;
  /** The words of the link, for example "Executions". */
  text: string;
}

export function NavWarning({
  long,
  short,
  link,
  enter,
  onClose,
}: {
  /** The sentence of the warning. */
  long: string;
  /** The words for a narrow nav. */
  short: string;
  /** A link after the words. It opens in a new tab. */
  link?: NavWarningLink;
  /** True for a warning that comes in while the page shows: it fades in. */
  enter?: boolean;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = (
    <button type="button" className="nav-warning-close" aria-label="Close this warning" onClick={onClose}>
      <IconX size={14} stroke={2.2} aria-hidden="true" />
    </button>
  );
  const out = link && (
    <a className="nav-warning-link" href={link.href} target="_blank" rel="noopener noreferrer">
      <span>{link.text}</span>
      <IconExternalLink size={14} stroke={2} aria-hidden="true" />
    </a>
  );
  return (
    <span className="nav-warning" data-open={open || undefined} data-enter={enter || undefined}>
      <span className="nav-warning-pill">
        <button type="button" className="nav-warning-words" title={long} aria-expanded={open} onClick={() => setOpen(!open)}>
          <IconAlertTriangle size={15} stroke={2} aria-hidden="true" />
          <span className="nav-warning-long" role="status">
            {long}
          </span>
          <span className="nav-warning-short" aria-hidden="true">
            {short}
          </span>
        </button>
        {out}
        {close}
      </span>
      <span className="nav-warning-pop">
        <span aria-hidden="true">
          {long} {out}
        </span>
        {close}
      </span>
    </span>
  );
}
