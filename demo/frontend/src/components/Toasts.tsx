import { toast, Toaster } from 'sonner';
import { useTheme, type ThemeName } from '../showcase/theme';
import { OUTLAYER_EXECUTIONS_URL } from '../verifierTimeout';

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

/**
 * Says that OutLayer did not answer in time, with a button that opens OutLayer's list of
 * executions. So the visitor sees that the cause is OutLayer, not this app (verifierTimeout.ts).
 */
export function toastOutlayerTimeout() {
  toast.error('OutLayer timed out', {
    id: OUTLAYER_TIMEOUT_TOAST,
    duration: OUTLAYER_TIMEOUT_TOAST_MS,
    description: 'The verifier on OutLayer did not answer in time. This app and your recording are not the cause.',
    action: { label: 'OutLayer executions', onClick: () => window.open(OUTLAYER_EXECUTIONS_URL, '_blank', 'noopener,noreferrer') },
  });
}
