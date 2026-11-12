// Dev only: the demo's Wallet theme as the CSS variables that the voice card reads, for the
// pages that run the local packages/voice-capture card (served at /__voice-capture/).

import type { CSSProperties } from 'react';
import { WALLET_THEMES } from '../seams/walletTheme';
import type { ThemeName } from '../showcase/theme';

export function cardThemeVariables(theme: ThemeName): CSSProperties {
  const { colors = {}, shape = {} } = WALLET_THEMES[theme] as { colors?: object; shape?: object };
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(colors)) variables[`--seams-colors-${name}`] = String(value);
  for (const [name, value] of Object.entries(shape)) variables[`--seams-shape-${name}`] = String(value);
  return variables as CSSProperties;
}
