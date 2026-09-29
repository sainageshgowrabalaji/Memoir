// Memoir's look. Warm paper by day and a soft warm dusk by night, both easy on the eyes: no pure
// white, no pure black, low glare. One sage green for anything you can press, one clay for things
// waiting on you, and an earthy color per shelf. Headings use Fraunces, a soft serif.

import { Platform } from 'react-native';

import type { CategoryId } from '@/brain/categories';

export const Colors = {
  light: {
    background: '#F2ECE2',
    surface: '#FAF6EF',
    sunken: '#E9E1D4',
    ink: '#2A241E',
    body: '#4B433A',
    muted: '#8C8173',
    faint: '#B9AE9F',
    line: '#E2D8C8',
    accent: '#3F6B63',
    accentSoft: '#DCE6DF',
    onAccent: '#FBF8F2',
    clay: '#B8653F',
    claySoft: '#F1DDCF',
    danger: '#A8432F',
    dangerSoft: '#F3DCD5',
    success: '#4F7A55',
    successSoft: '#DDE9DA',
    warn: '#B8653F',
    warnSoft: '#F1DDCF',
    shadow: '#6B5A45',
  },
  dark: {
    background: '#1C1916',
    surface: '#26221D',
    sunken: '#2F2A24',
    ink: '#F2E9DB',
    body: '#DCCFBD',
    muted: '#A39583',
    faint: '#6F6456',
    line: '#3A342C',
    accent: '#9CC2B4',
    accentSoft: '#2D3B36',
    onAccent: '#1C1916',
    clay: '#E3A07A',
    claySoft: '#3E2C22',
    danger: '#E88E7A',
    dangerSoft: '#3A231D',
    success: '#9CC39A',
    successSoft: '#26332A',
    warn: '#E3A07A',
    warnSoft: '#3E2C22',
    shadow: '#000000',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };

// Earthy, muted hues per shelf, readable on both backgrounds.
export const ShelfColors: Record<CategoryId, { light: string; dark: string }> = {
  people: { light: '#C0714F', dark: '#E7A283' },
  work: { light: '#5B7896', dark: '#9DB6CF' },
  money: { light: '#5E8A6B', dark: '#9CC4A5' },
  health: { light: '#B8606E', dark: '#E39AA5' },
  learning: { light: '#7E6BA8', dark: '#B7A8DA' },
  travel: { light: '#4E8C94', dark: '#8FC3C9' },
  food: { light: '#C0913A', dark: '#E6C27A' },
  shopping: { light: '#A66B94', dark: '#D6A3C6' },
  fun: { light: '#CF7C58', dark: '#EDAB8C' },
  ideas: { light: '#8A9A4B', dark: '#C0CD86' },
  home: { light: '#8C7B6B', dark: '#C4B4A3' },
  notes: { light: '#8F8A83', dark: '#BDB6AC' },
};

export const Fonts = {
  /** Fraunces, loaded in the root layout. Falls back to the phone's serif until it is ready. */
  display: 'Fraunces_600SemiBold',
  displayMedium: 'Fraunces_500Medium',
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' }),
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui, -apple-system, "Segoe UI", sans-serif' }),
};

export const Space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const Radius = { s: 12, m: 16, l: 22, xl: 28, pill: 999 } as const;
export const MaxContentWidth = 640;
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
