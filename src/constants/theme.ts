// Memoir's look. Warm paper and ink, one indigo for anything you can press,
// and a quiet color dot per shelf. Every color has a dark-mode twin.

import { Platform } from 'react-native';

import type { CategoryId } from '@/brain/categories';

export const Colors = {
  light: {
    background: '#FAF8F4',
    surface: '#FFFFFF',
    sunken: '#F2EFE9',
    ink: '#1C1B22',
    body: '#3A3845',
    muted: '#6E6B7B',
    line: '#E6E2DA',
    accent: '#4B4FC4',
    accentSoft: '#ECECFB',
    onAccent: '#FFFFFF',
    danger: '#B42318',
    dangerSoft: '#FDECEA',
    success: '#1E7A4C',
    successSoft: '#E4F3EA',
    warn: '#9A5B00',
    warnSoft: '#FBF0DC',
  },
  dark: {
    background: '#121118',
    surface: '#1B1A23',
    sunken: '#16151D',
    ink: '#F1F0F6',
    body: '#CFCDD9',
    muted: '#9A97AA',
    line: '#2A2833',
    accent: '#8E92F5',
    accentSoft: '#23234A',
    onAccent: '#0E0E24',
    danger: '#F07A72',
    dangerSoft: '#2A1614',
    success: '#5CC98E',
    successSoft: '#12261B',
    warn: '#E7B45C',
    warnSoft: '#2A2110',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };

// One calm hue per shelf, readable on both backgrounds.
export const ShelfColors: Record<CategoryId, { light: string; dark: string }> = {
  people: { light: '#C2410C', dark: '#FB923C' },
  work: { light: '#1D4ED8', dark: '#7AA2F7' },
  money: { light: '#047857', dark: '#34D399' },
  health: { light: '#BE123C', dark: '#FB7185' },
  learning: { light: '#6D28D9', dark: '#A78BFA' },
  travel: { light: '#0E7490', dark: '#22D3EE' },
  food: { light: '#B45309', dark: '#FBBF24' },
  shopping: { light: '#A21CAF', dark: '#E879F9' },
  fun: { light: '#DB2777', dark: '#F472B6' },
  ideas: { light: '#4D7C0F', dark: '#A3E635' },
  home: { light: '#57534E', dark: '#D6D3D1' },
  notes: { light: '#6B7280', dark: '#9CA3AF' },
};

export const Fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' }),
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui, -apple-system, "Segoe UI", sans-serif' }),
};

export const Space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const Radius = { s: 10, m: 14, l: 20, pill: 999 } as const;
export const MaxContentWidth = 720;
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
