// The Wallet's theme on the page. On the Community Notes page the Wallet takes the page's own
// colours: X's light theme, or X's black, Lights out, on the dark theme (the two colour blocks at
// the top of src/styles.css). SeamsWebProvider gives the theme to the Wallet's components in the
// page, and pushes it to the Wallet's frames (the sign-in menu, VoiceID, the confirmation) when
// it changes.
//
// Each page theme sends a full colour set, and has its own theme id. The Wallet frame keeps the
// colours that a push does not name: with an empty light set, a page that loads dark kept the
// black colours after a switch to light.

import { useMemo, type ReactNode } from 'react';
import type { SeamsConfigsInput } from '@seams/wallet';
import { DARK_TOKENS, LIGHT_TOKENS, SeamsWebProvider, SHAPE_PRESETS } from '@seams/wallet/react';
import type { ThemeName } from '../showcase/theme';

/**
 * The colours of one page theme, by the names of the page's CSS variables, and the Wallet's
 * card: its background, and the two steps of raised surface on it.
 */
interface PagePalette {
  card: string;
  raised: string;
  raised2: string;
  ink: string;
  muted: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentInk: string;
  /** The echo lines of the voice card: a lighter and a deeper X blue. */
  echo: string;
  echoDeep: string;
  green: string;
  gold: string;
  red: string;
}

/** X's light theme: the :root block in src/styles.css. The card is the page's white. */
const X_LIGHT: PagePalette = {
  card: '#fff', // --bg
  raised: '#f7f9f9', // --panel
  raised2: '#e8edf0', // --media
  ink: '#0f1419',
  muted: '#536471',
  line: '#eff3f4',
  lineStrong: '#cfd9de',
  accent: '#1d9bf0',
  accentInk: '#1a8cd8',
  echo: '#83c8f7',
  echoDeep: '#1674b4',
  green: '#00ba7c',
  gold: '#e2b719',
  red: '#f4212e',
};

/**
 * X's black, Lights out: the dark block in src/styles.css. The card is a step lighter than the
 * page's black (--panel), so the Wallet's cards stand out on the black page; their raised
 * surfaces are a step lighter again.
 */
const LIGHTS_OUT: PagePalette = {
  card: '#16181c', // --panel
  raised: '#202327', // --media
  raised2: '#2a2d32',
  ink: '#e7e9ea',
  muted: '#71767b',
  line: '#2f3336',
  lineStrong: '#3e4246',
  accent: '#1d9bf0',
  accentInk: '#1a8cd8',
  echo: '#8ecdf8',
  echoDeep: '#1a8cd8',
  green: '#00ba7c',
  gold: '#e2b719',
  red: '#f4212e',
};

/** The SDK's token names in the page's colours, over the SDK's own set for the same mode. */
function walletColors(base: Record<string, string>, p: PagePalette): Record<string, string> {
  return {
    ...base,
    primary: p.accent,
    primaryHover: p.accentInk,
    secondary: p.muted,
    secondaryHover: p.ink,
    accent: p.accent,

    textPrimary: p.ink,
    textSecondary: p.muted,
    textMuted: p.muted,
    textButton: '#fff',

    // The main button is X's blue button with white text, on both themes, as the page's own main
    // buttons are. The other buttons have the card's background and a line, as X's second
    // buttons do.
    buttonBackground: p.accent,
    buttonHoverBackground: p.accentInk,
    secondaryButtonBackground: p.card,
    secondaryButtonHoverBackground: p.raised,
    secondaryButtonBorder: p.lineStrong,
    secondaryButtonText: p.ink,

    colorBackground: p.card,
    surface: p.raised,
    surface2: p.raised2,
    surface3: p.raised2,
    surface4: p.line,
    txDetailsBackground: p.raised,

    hover: p.raised,
    active: p.raised2,
    focus: p.accent,

    success: p.green,
    warning: p.gold,
    error: p.red,
    info: p.accent,

    borderPrimary: p.line,
    borderSecondary: p.line,
    borderHover: p.lineStrong,

    highlightPrimary: p.accent,
    highlightHalo: p.accent,
    highlightReceiver: p.accent,
    highlightMethodName: p.ink,
    highlightAmount: p.ink,

    // The voice card (voice-capture 0.68.1): the line in X blue, its echoes in a lighter and a
    // deeper blue, and a grey Beam. Earlier cards do not read these keys.
    voiceLine: p.accent,
    voiceEcho: p.echo,
    voiceEchoDeep: p.echoDeep,
    voiceBeam: 'mono',
  };
}

/**
 * The page's X shapes, over the SDK's square preset (its bordered fields and heights): the card
 * as round as the page's dialogs and X's own (16 px), and buttons, fields, boxes and rows at
 * 12 px, so a button's corner agrees with the card's. Both themes send all of it.
 */
const X_SHAPE: Record<string, string> = {
  ...SHAPE_PRESETS.square,
  card: '16px',
  control: '12px',
  field: '12px',
  box: '12px',
  item: '12px',
  // The voice card's line (voice-capture 0.68.1): thicker than its 1 px default.
  voiceLineWidth: '2px',
  voiceEchoWidth: '1.25px',
};

type AppearanceTheme = NonNullable<NonNullable<SeamsConfigsInput['appearance']>['theme']>;

/** The Wallet's theme for each page theme. The dev card preview reads it too. */
export const WALLET_THEMES: Record<ThemeName, AppearanceTheme> = {
  dark: { id: 'lights-out', mode: 'dark', colors: walletColors(DARK_TOKENS.colors, LIGHTS_OUT), shape: X_SHAPE },
  light: { id: 'x-light', mode: 'light', colors: walletColors(LIGHT_TOKENS.colors, X_LIGHT), shape: X_SHAPE },
};

/**
 * The Wallet's theme for a page theme as the CSS variables that its components read. For a
 * Wallet card that runs in the page itself: the dev preview of the voice card (src/dev).
 */
export function walletThemeVars(theme: ThemeName): Record<string, string> {
  const { colors = {}, shape = {} } = WALLET_THEMES[theme];
  return {
    ...Object.fromEntries(Object.entries(colors).map(([key, value]) => [`--seams-colors-${key}`, value])),
    ...Object.fromEntries(Object.entries(shape).map(([key, value]) => [`--seams-shape-${key}`, value])),
  };
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
  // The SDK keeps one Wallet for a config that differs only in its appearance.
  const themedConfig = useMemo(
    () => ({ ...config, appearance: { ...config.appearance, theme: WALLET_THEMES[theme] } }),
    [config, theme],
  );

  return (
    <SeamsWebProvider config={themedConfig} theme={{ theme }}>
      {children}
    </SeamsWebProvider>
  );
}
