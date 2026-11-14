import { toast, Toaster } from 'sonner';
import { useTheme, type ThemeName } from '../showcase/theme';
import { OUTLAYER_EXECUTIONS_URL, outlayerWait, type OutlayerWait } from '../verifierTimeout';

/**
 * The page's short notes (sonner's `toast`), at the bottom in the middle, in the page's theme, or
 * in `theme` for a page with one fixed theme. The offsets over the notes app's bars are in
 * styles.css and voice.css.
 */
export function Toasts({ theme: fixed }: { theme?: ThemeName }) {
  const pageTheme = useTheme();
  const theme = fixed ?? pageTheme;
  return (
    <Toaster
      theme={theme}
      position="bottom-center"
      duration={4000}
      style={{ fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, -apple-system, sans-serif" }}
    />
  );
}

/** One toast for all OutLayer timeouts: a second timeout takes the place of the first. */
const OUTLAYER_TIMEOUT_TOAST = 'outlayer-timeout';
/** Longer than a usual toast: the visitor reads the Wallet card first. */
const OUTLAYER_TIMEOUT_TOAST_MS = 20_000;
/** The toast of a verifier that takes long. It stays until the verifier answers or the request ends. */
const OUTLAYER_BUSY_TOAST = 'outlayer-busy';

/** The OutLayer toasts are at the bottom right, so they do not cover the Wallet card or the voice bar. */
const OUTLAYER_TOAST_PLACE = {
  position: 'bottom-right',
  action: { label: 'OutLayer executions', onClick: () => window.open(OUTLAYER_EXECUTIONS_URL, '_blank', 'noopener,noreferrer') },
} as const;

/**
 * Says that OutLayer did not answer in time, with a button that opens OutLayer's list of
 * executions. So the visitor sees that the cause is OutLayer, not this app (verifierTimeout.ts).
 */
export function toastOutlayerTimeout() {
  toast.error('OutLayer timed out', {
    ...OUTLAYER_TOAST_PLACE,
    id: OUTLAYER_TIMEOUT_TOAST,
    duration: OUTLAYER_TIMEOUT_TOAST_MS,
    description: 'The verifier on OutLayer did not answer in time. This app and your recording are not the cause.',
  });
}

/**
 * One wait for the verifier of a request: after 10 s with no answer, a toast says that OutLayer
 * is busy, with the same button. The toast goes when the verifier answers or the request ends.
 */
export function watchOutlayer(): OutlayerWait {
  return outlayerWait(
    () =>
      toast.warning('OutLayer is busy', {
        ...OUTLAYER_TOAST_PLACE,
        id: OUTLAYER_BUSY_TOAST,
        duration: Infinity,
        description: 'The verifier on OutLayer takes longer than usual. This app and your recording are not the cause.',
      }),
    () => toast.dismiss(OUTLAYER_BUSY_TOAST),
  );
}
