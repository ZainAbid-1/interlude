/**
 * Design tokens for the Song Guessing Game.
 * Mirrors the Stitch reference's dark monochrome palette.
 */

export const Colors = {
  // Core surfaces
  background: '#0a0a0a',
  surface: '#131313',
  surfaceContainer: '#1f1f1f',
  surfaceContainerLow: '#1b1b1b',
  surfaceContainerHigh: '#2a2a2a',
  surfaceContainerHighest: '#353535',
  surfaceBright: '#393939',

  // Text
  onBackground: '#e2e2e2',
  onSurface: '#e2e2e2',
  onSurfaceVariant: '#c4c7c8',
  textMuted: 'rgba(255, 255, 255, 0.4)',
  textSubtle: 'rgba(255, 255, 255, 0.6)',

  // Primary
  primary: '#ffffff',
  onPrimary: '#2f3131',
  primaryContainer: '#e2e2e2',

  // Glass
  glassBg: 'rgba(30, 30, 30, 0.4)',
  glassBorder: 'rgba(255, 255, 255, 0.1)',
  glassBorderSubtle: 'rgba(255, 255, 255, 0.05)',
  glassHover: 'rgba(255, 255, 255, 0.1)',

  // Feedback
  correct: '#4ade80',
  correctBg: 'rgba(74, 222, 128, 0.15)',
  incorrect: '#f87171',
  incorrectBg: 'rgba(248, 113, 113, 0.15)',

  // Outline
  outline: '#8e9192',
  outlineVariant: '#444748',

  // Error
  error: '#ffb4ab',
  errorContainer: '#93000a',

  // Tab bar
  tabBarBg: 'rgba(19, 19, 19, 0.8)',
  tabBarBorder: 'rgba(255, 255, 255, 0.05)',
  tabInactive: 'rgba(255, 255, 255, 0.5)',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 48,
  xxl: 80,
  gutter: 20,
  containerPadding: 24,
  stackGap: 12,
} as const;

export const BorderRadius = {
  sm: 4,
  md: 8,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const Typography = {
  display: {
    fontSize: 48,
    lineHeight: 56,
    letterSpacing: -0.04 * 48,
    fontWeight: '700' as const,
  },
  headlineLg: {
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.02 * 32,
    fontWeight: '600' as const,
  },
  headlineLgMobile: {
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.02 * 24,
    fontWeight: '600' as const,
  },
  bodyLg: {
    fontSize: 18,
    lineHeight: 28,
    letterSpacing: -0.01 * 18,
    fontWeight: '400' as const,
  },
  bodyMd: {
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0,
    fontWeight: '400' as const,
  },
  labelSm: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.05 * 12,
    fontWeight: '500' as const,
  },
} as const;
