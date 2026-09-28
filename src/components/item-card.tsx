// One saved thing in a list. Shelf, source and time on top, then the title, a line of your note
// (or the reel's caption), the link's site and who posted it, a picture, the people in it, and a
// "To check" badge until you have looked at a saved link.
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
  const yours = [item.text.replace(item.url ?? '', '').trim(), item.note].filter(Boolean).join(' · ');
  const extra = yours || item.page.text.replace(/\s+/g, ' ').trim();
  const showExtra = extra && !extra.toLowerCase().startsWith(item.title.replace(/…$/, '').toLowerCase());
  const picture = item.photoUri ?? item.page.image;
  const site = item.url ? [domainOf(item.url), item.page.author].filter(Boolean).join('  ·  ') : '';
  // A matched word that is already one of the people shown would appear twice.
  const names = new Set(item.people.map((p) => p.toLowerCase()));
  const words = (matched ?? []).filter((m) => !names.has(m.toLowerCase()));
  const meta = [item.kind === 'diary' ? 'Diary' : (CATEGORY_BY_ID[item.category]?.label ?? 'Notes'), item.source !== 'me' ? SOURCE_LABELS[item.source] : null, showDay ?? timeLabel(item.createdAt)]
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
          {site ? (
            <Text style={[styles.link, { color: c.accent }]} numberOfLines={1}>
              {site}
            </Text>
          ) : null}
          {item.people.length || words.length || close || item.checkState === 'to_check' ? (
            <View style={styles.tags}>
              {item.checkState === 'to_check' ? (
                <Text style={[styles.tag, { backgroundColor: c.warnSoft, color: c.warn }]}>To check</Text>
              ) : null}
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
        {picture ? (
          <Image source={{ uri: picture }} style={[styles.thumb, { backgroundColor: c.sunken }]} contentFit="cover" transition={150} />
        ) : null}
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
  thumb: { width: 64, height: 80, borderRadius: Radius.s },
});
