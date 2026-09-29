// Small building blocks used on every screen, so every page feels the same: soft cards, pill
// buttons, one heading font, gentle feedback when you tap.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, MaxContentWidth, Radius, Space } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** A light tap you can feel, on phones that have it. */
export function tap(kind: 'light' | 'success' = 'light') {
  if (Platform.OS === 'web') return;
  if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function Icon({ name, size = 20, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const c = usePalette();
  return <Ionicons name={name} size={size} color={color ?? c.muted} style={style} />;
}

/** Every screen: the paper background, safe from the notch, centered on wide screens. */
export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  background,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom')[];
  background?: ReactNode;
}) {
  const c = usePalette();
  return (
    <SafeAreaView edges={edges} style={[styles.screen, { backgroundColor: c.background }]}>
      {background}
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = usePalette();
  return (
    <Text style={[styles.title, { color: c.ink }, style]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = usePalette();
  return (
    <Text style={[styles.heading, { color: c.ink }, style]} accessibilityRole="header">
      {children}
    </Text>
  );
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

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  const c = usePalette();
  const look = [styles.card, { backgroundColor: c.surface, borderColor: c.line, shadowColor: c.shadow }, style];
  if (!onPress) return <View style={look}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [look, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'soft' | 'quiet' | 'plain' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  wide?: boolean;
};

export function Button({ label, onPress, kind = 'quiet', icon, disabled, busy, style, accessibilityLabel, wide }: ButtonProps) {
  const c = usePalette();
  const look = {
    primary: { bg: c.accent, fg: c.onAccent, border: c.accent },
    soft: { bg: c.accentSoft, fg: c.accent, border: c.accentSoft },
    quiet: { bg: c.surface, fg: c.ink, border: c.line },
    plain: { bg: 'transparent', fg: c.accent, border: 'transparent' },
    danger: { bg: 'transparent', fg: c.danger, border: 'transparent' },
  }[kind];
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || busy }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        kind === 'plain' || kind === 'danger' ? styles.buttonPlain : null,
        wide && styles.wide,
        { backgroundColor: look.bg, borderColor: look.border },
        (disabled || busy) && { opacity: 0.45 },
        pressed && styles.pressed,
        style,
      ]}>
      {busy ? <ActivityIndicator size="small" color={look.fg} /> : icon ? <Icon name={icon} size={18} color={look.fg} /> : null}
      <Text style={[styles.buttonText, { color: look.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, tone = 'quiet', size = 40 }: { icon: IconName; onPress: () => void; label: string; tone?: 'quiet' | 'accent'; size?: number }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tone === 'accent' ? c.accent : c.surface, borderColor: tone === 'accent' ? c.accent : c.line },
        pressed && styles.pressed,
      ]}>
      <Icon name={icon} size={size * 0.48} color={tone === 'accent' ? c.onAccent : c.ink} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  dot,
  count,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  dot?: string;
  count?: number;
  icon?: IconName;
}) {
  const c = usePalette();
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              tap();
              onPress();
            }
          : undefined
      }
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? c.accent : c.surface, borderColor: selected ? c.accent : c.line },
        pressed && styles.pressed,
      ]}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      {icon ? <Icon name={icon} size={15} color={selected ? c.onAccent : c.muted} /> : null}
      <Text style={[styles.chipText, { color: selected ? c.onAccent : c.body }]}>{label}</Text>
      {count !== undefined ? <Text style={[styles.chipCount, { color: selected ? c.onAccent : c.muted }]}>{count}</Text> : null}
    </Pressable>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** Two or three choices side by side, one selected, like a light switch with more positions. */
export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string; count?: number }[]; value: K; onChange: (key: K) => void }) {
  const c = usePalette();
  return (
    <View style={[styles.segmented, { backgroundColor: c.sunken }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              tap();
              onChange(o.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && { backgroundColor: c.surface, shadowColor: c.shadow, ...styles.segmentOn }]}>
            <Text style={[styles.segmentText, { color: on ? c.ink : c.muted }]}>{o.label}</Text>
            {o.count ? (
              <View style={[styles.segmentCount, { backgroundColor: on ? c.clay : c.faint }]}>
                <Text style={[styles.segmentCountText, { color: c.surface }]}>{o.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The round tick used for both to-dos and links to check: tap it when it is done. */
export function CheckCircle({ done, onPress, label }: { done: boolean; onPress: () => void; label: string }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={() => {
        tap(done ? 'light' : 'success');
        onPress();
      }}
      hitSlop={12}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={label}
      style={[styles.check, { borderColor: done ? c.success : c.faint, backgroundColor: done ? c.success : 'transparent' }]}>
      {done ? <Icon name="checkmark" size={16} color={c.surface} /> : null}
    </Pressable>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'warn' | 'danger' }) {
  const c = usePalette();
  const colors = {
    info: [c.accentSoft, c.accent],
    success: [c.successSoft, c.success],
    warn: [c.claySoft, c.clay],
    danger: [c.dangerSoft, c.danger],
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: colors[0] }]} accessibilityLiveRegion="polite">
      <Text style={[styles.noticeText, { color: colors[1] }]}>{children}</Text>
    </View>
  );
}

/** A short message after you do something. After five seconds `onDone` is called to clear it. */
export function Toast({ text, tone = 'success', onDone }: { text: string | null; tone?: 'success' | 'info'; onDone: () => void }) {
  const c = usePalette();
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(onDone, 5000);
    return () => clearTimeout(timer);
  }, [text, onDone]);
  if (!text) return null;
  return (
    <View style={[styles.toast, { backgroundColor: tone === 'success' ? c.successSoft : c.accentSoft }]} accessibilityLiveRegion="polite">
      <Icon name={tone === 'success' ? 'checkmark-circle' : 'information-circle'} size={18} color={tone === 'success' ? c.success : c.accent} />
      <Text style={[styles.toastText, { color: tone === 'success' ? c.success : c.accent }]}>{text}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: Space.xl, paddingHorizontal: 20, paddingTop: Space.l, paddingBottom: 140, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  title: { fontFamily: Fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  heading: { fontFamily: Fonts.display, fontSize: 21, lineHeight: 27, letterSpacing: -0.2 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  body: { fontSize: 15.5, lineHeight: 22 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.l,
    padding: Space.l,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 1,
  },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  button: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  buttonPlain: { paddingHorizontal: 6, minHeight: 36 },
  wide: { alignSelf: 'stretch' },
  buttonText: { fontSize: 15.5, fontWeight: '600' },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 36,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  chipCount: { fontSize: 13, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  segmented: { flexDirection: 'row', borderRadius: Radius.pill, padding: 4 },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 40, borderRadius: Radius.pill },
  segmentOn: { shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 1 },
  segmentText: { fontSize: 15, fontWeight: '600' },
  segmentCount: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentCountText: { fontSize: 12.5, fontWeight: '700' },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  notice: { borderRadius: Radius.m, paddingHorizontal: 14, paddingVertical: 11 },
  noticeText: { fontSize: 14.5, lineHeight: 20, fontWeight: '500' },
  toast: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: Radius.m, paddingHorizontal: 14, paddingVertical: 11 },
  toastText: { flex: 1, fontSize: 14.5, lineHeight: 20, fontWeight: '500' },
});
