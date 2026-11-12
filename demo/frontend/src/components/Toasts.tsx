import { Toaster } from 'sonner';
import { useTheme } from '../showcase/theme';

/**
 * The page's short notes (sonner's `toast`), at the bottom in the middle, in the page's theme. The
 * offsets over the notes app's bars are in styles.css and voice.css.
 */
export function Toasts() {
  const theme = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-center"
      duration={4000}
      style={{ fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, -apple-system, sans-serif" }}
    />
  );
}
