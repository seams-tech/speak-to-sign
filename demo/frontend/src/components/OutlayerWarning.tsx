// A pill in the nav of the notes page: OutLayer may be busy, so a voice check can take long. It
// links to OutLayer's list of executions, where a person sees how long the runs take now. The
// page has no status of OutLayer, so the pill says "may be", and a person can close it. It stays
// closed until the page loads again.
//
// The toasts for one slow or failed check are in Toasts.tsx (`watchOutlayer`,
// `toastOutlayerTimeout`).

import { useState } from 'react';
import { OUTLAYER_EXECUTIONS_URL } from '../verifierTimeout';
import { NavWarning } from './NavWarning';

/** `shown`: the place in the nav is free for the pill (the notes page: the sheet covers the hero). */
export function OutlayerWarning({ shown }: { shown: boolean }) {
  const [closed, setClosed] = useState(false);
  if (closed || !shown) return null;
  return (
    <NavWarning
      long="OutLayer may be busy, voice signing may be slow"
      short="OutLayer may be busy"
      link={{ href: OUTLAYER_EXECUTIONS_URL, text: 'Executions' }}
      enter
      onClose={() => setClosed(true)}
    />
  );
}
