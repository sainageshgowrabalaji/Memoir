// Small building blocks used on every screen.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { Fonts, Radius, Space } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = usePalette();
  return <Text style={[styles.title, { color: c.ink }, style]} accessibilityRole="header">{children}</Text>;
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = usePalette();
  return <Text style={[styles.label, { color: c.muted }, style]}>{children}</Text>;
}

export function Body({ children, muted, style, lines }: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle>; lines?: number }) {
  const c = usePalette();
  return (
    <Text numberOfLines={lines} style={[styles.body, { color: muted ? c.muted : c.body }, style]}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>{children}</View>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Button({ label, onPress, kind = 'quiet', disabled, busy, icon, style, accessibilityLabel }: ButtonProps) {
  const c = usePalette();
  const primary = kind === 'primary';
  const danger = kind === 'danger';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || busy }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: c.accent, borderColor: c.accent }
          : danger
            ? { backgroundColor: 'transparent', borderColor: c.danger }
            : { backgroundColor: c.surface, borderColor: c.line },
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.75 },
        style,
      ]}>
      {busy ? <ActivityIndicator size="small" color={primary ? c.onAccent : c.accent} /> : icon}
      <Text style={[styles.buttonText, { color: primary ? c.onAccent : danger ? c.danger : c.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  dot,
  count,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  dot?: string;
  count?: number;
}) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? c.accentSoft : c.surface, borderColor: selected ? c.accent : c.line },
        pressed && { opacity: 0.7 },
      ]}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <Text style={[styles.chipText, { color: selected ? c.accent : c.body }]}>{label}</Text>
      {count !== undefined ? <Text style={[styles.chipCount, { color: c.muted }]}>{count}</Text> : null}
    </Pressable>
  );
}

export function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'warn' | 'danger' }) {
  const c = usePalette();
  const colors = {
    info: [c.accentSoft, c.accent],
    success: [c.successSoft, c.success],
    warn: [c.warnSoft, c.warn],
    danger: [c.dangerSoft, c.danger],
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: colors[0] }]} accessibilityLiveRegion="polite">
      <Text style={[styles.noticeText, { color: colors[1] }]}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  title: { fontFamily: Fonts.serif, fontSize: 34, fontWeight: '600', letterSpacing: -0.5 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  body: { fontSize: 15.5, lineHeight: 22 },
  card: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: Radius.l, padding: Space.l },
  button: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  chipCount: { fontSize: 13, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  notice: { borderRadius: Radius.m, paddingHorizontal: 14, paddingVertical: 10 },
  noticeText: { fontSize: 14.5, lineHeight: 20, fontWeight: '500' },
});
