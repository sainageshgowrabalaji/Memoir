// One saved thing in a list. Shelf, source and time on top, then the title,
// a line of the note if it says more, the link's site, a photo, and the people in it.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CATEGORY_BY_ID } from '@/brain/categories';
import { domainOf, SOURCE_LABELS } from '@/brain/links';
import { Radius, Space } from '@/constants/theme';
import type { Item } from '@/db/repo';
import { usePalette, useShelfColor } from '@/hooks/use-palette';
import { timeLabel } from '@/lib/format';

export function ItemCard({ item, matched, close, showDay }: { item: Item; matched?: string[]; close?: boolean; showDay?: string }) {
  const c = usePalette();
  const shelf = useShelfColor();
  const extra = item.text.replace(item.url ?? '', '').trim();
  const showExtra = extra && extra.toLowerCase() !== item.title.toLowerCase() && !item.title.endsWith('…');
  // A matched word that is already one of the people shown would appear twice.
  const names = new Set(item.people.map((p) => p.toLowerCase()));
  const words = (matched ?? []).filter((m) => !names.has(m.toLowerCase()));
  const meta = [CATEGORY_BY_ID[item.category]?.label ?? 'Notes', item.source !== 'me' ? SOURCE_LABELS[item.source] : null, showDay ?? timeLabel(item.createdAt)]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(item.id) } })}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${meta}`}
      style={({ pressed }) => [styles.card, { backgroundColor: c.surface, borderColor: c.line }, pressed && { opacity: 0.8 }]}>
      <View style={styles.row}>
        <View style={styles.main}>
          <View style={styles.metaRow}>
            <View style={[styles.dot, { backgroundColor: shelf(item.category) }]} />
            <Text style={[styles.meta, { color: c.muted }]} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          <Text style={[styles.title, { color: c.ink }]} numberOfLines={2}>
            {item.title}
          </Text>
          {showExtra ? (
            <Text style={[styles.extra, { color: c.body }]} numberOfLines={2}>
              {extra}
            </Text>
          ) : null}
          {item.url ? (
            <Text style={[styles.link, { color: c.accent }]} numberOfLines={1}>
              {domainOf(item.url)}
            </Text>
          ) : null}
          {item.people.length || words.length || close ? (
            <View style={styles.tags}>
              {item.people.map((p) => (
                <Text key={`p-${p}`} style={[styles.tag, { backgroundColor: c.sunken, color: c.body }]}>
                  {p}
                </Text>
              ))}
              {close ? (
                <Text style={[styles.tag, { backgroundColor: c.accentSoft, color: c.accent }]}>Similar meaning</Text>
              ) : null}
              {words.map((m) => (
                <Text key={`m-${m}`} style={[styles.tag, { backgroundColor: c.accentSoft, color: c.accent }]}>
                  {m}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
        {item.photoUri ? <Image source={{ uri: item.photoUri }} style={styles.thumb} contentFit="cover" transition={150} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.m, borderWidth: StyleSheet.hairlineWidth * 2, padding: Space.m + 2 },
  row: { flexDirection: 'row', gap: Space.m },
  main: { flex: 1, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  meta: { fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  title: { fontSize: 16.5, lineHeight: 22, fontWeight: '600' },
  extra: { fontSize: 14.5, lineHeight: 20 },
  link: { fontSize: 13.5, fontWeight: '500' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { fontSize: 12.5, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  thumb: { width: 64, height: 64, borderRadius: Radius.s },
});
