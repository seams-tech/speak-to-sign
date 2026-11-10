// The Wallet's theme on the page. On the dark theme of the Community Notes page the Wallet takes
// the page's own colours: X's black, Lights out (the dark block in src/styles.css). On the light
// theme it keeps the SDK's light colours. The Wallet's components in the page take the theme
// from SeamsWebProvider, and the Wallet's frames (the sign-in menu, the confirmation) take it
// from `seams.config.setAppearance`.

import { useEffect, type ReactNode } from 'react';
import type { SeamsConfigsInput } from '@seams/wallet';
import { SeamsWebProvider, SHAPE_PRESETS, useSeams } from '@seams/wallet/react';
import type { ThemeName } from '../showcase/theme';

// The values of the dark block in src/styles.css, by the SDK's token names.
const BG = '#000'; // --bg
const INK = '#e7e9ea'; // --ink
const ON_INK = '#0f1419'; // --on-ink
const INK_HOVER = '#d7dbdc'; // --ink-hover
const MUTED = '#71767b'; // --muted
const LINE = '#2f3336'; // --line
const LINE_STRONG = '#3e4246'; // --line-strong
const PANEL = '#16181c'; // --panel
const MEDIA = '#202327'; // --media
const ACCENT = '#1d9bf0'; // --accent
const ACCENT_INK = '#1a8cd8'; // --accent-ink

const LIGHTS_OUT_COLORS: Record<string, string> = {
  primary: ACCENT,
  primaryHover: ACCENT_INK,
  secondary: MUTED,
  secondaryHover: INK,
  accent: ACCENT,

  textPrimary: INK,
  textSecondary: MUTED,
  textMuted: MUTED,
  textButton: ON_INK,

  // The main button is the page's ink button: light, with dark text. The other buttons are
  // black with a line, as X's second buttons are.
  buttonBackground: INK,
  buttonHoverBackground: INK_HOVER,
  secondaryButtonBackground: BG,
  secondaryButtonHoverBackground: PANEL,
  secondaryButtonBorder: LINE_STRONG,
  secondaryButtonText: INK,

  colorBackground: BG,
  surface: PANEL,
  passkeyHaloBackground: PANEL,
  surface2: MEDIA,
  surface3: MEDIA,
  surface4: LINE,
  txDetailsBackground: PANEL,

  hover: PANEL,
  active: MEDIA,
  focus: ACCENT,

  success: '#00ba7c', // --green
  warning: '#e2b719', // --gold
  error: '#f4212e', // --red
  info: ACCENT,

  borderPrimary: LINE,
  borderSecondary: LINE,
  borderHover: LINE_STRONG,

  highlightPrimary: ACCENT,
  highlightRow: 'rgba(29, 155, 240, 0.12)',
  highlightHalo: ACCENT,
  highlightReceiver: ACCENT,
  highlightMethodName: INK,
  highlightAmount: INK,
};

type Appearance = NonNullable<SeamsConfigsInput['appearance']>;

function walletAppearance(theme: ThemeName): Appearance {
  return {
    locale: 'en',
    theme:
      theme === 'dark'
        ? { id: 'lights-out', mode: 'dark', colors: LIGHTS_OUT_COLORS, shape: { ...SHAPE_PRESETS.square } }
        : { id: 'light', mode: 'light' },
  };
}

/** Sends the theme to the Wallet's frames, at the start and on each change. */
function WalletFrameTheme({ theme }: { theme: ThemeName }) {
  const { seams, loginState } = useSeams();
  const signedIn = loginState?.isLoggedIn ?? false;

  useEffect(() => {
    try {
      seams.config.setAppearance(walletAppearance(theme));
    } catch {
      // The frame is not there yet. The config's appearance holds until the next change.
    }
  }, [seams, theme, signedIn]);

  return null;
}

/** SeamsWebProvider with the Wallet's theme for the page's theme. */
export function ThemedSeamsProvider({
  config,
  theme,
  children,
}: {
  config: SeamsConfigsInput;
  theme: ThemeName;
  children: ReactNode;
}) {
  return (
    <SeamsWebProvider
      config={config}
      theme={{
        theme,
        tokens: { dark: { colors: LIGHTS_OUT_COLORS, shape: SHAPE_PRESETS.square } },
      }}
    >
      <WalletFrameTheme theme={theme} />
      {children}
    </SeamsWebProvider>
  );
}
