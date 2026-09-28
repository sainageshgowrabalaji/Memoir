// One saved link on the "To check" list, with what it is and three quick actions:
// open it (which counts as checked), mark it done without opening, or remind me later.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { domainOf } from '@/brain/links';
import { laterChoices } from '@/brain/reminders';
import { Button, Chip } from '@/components/ui';
import { Radius, Space } from '@/constants/theme';
import type { Item } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { ago, soonLabel } from '@/lib/format';

type Props = {
  item: Item;
  now: number;
  onOpen: (item: Item) => void;
  onDone: (item: Item) => void;
  onLater: (item: Item, at: number) => void;
};

export function CheckRow({ item, now, onOpen, onDone, onLater }: Props) {
  const c = usePalette();
  const [choosing, setChoosing] = useState(false);
  const picture = item.photoUri ?? item.page.image;
  const who = [item.page.author, item.url ? domainOf(item.url) : null].filter(Boolean).join('  ·  ');
  const caption = item.page.text.replace(/\s+/g, ' ').trim();
  const yours = [item.text.replace(item.url ?? '', '').trim(), item.note].filter(Boolean).join(' · ');
  const snoozed = item.checkAfter && item.checkAfter > now;
  const when = snoozed ? `Reminding you ${soonLabel(item.checkAfter!, now)}` : `Saved ${ago(item.createdAt, now)}`;

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
      <Pressable
        onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(item.id) } })}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${who}`}
        style={styles.row}>
        {picture ? <Image source={{ uri: picture }} style={[styles.thumb, { backgroundColor: c.sunken }]} contentFit="cover" transition={150} /> : null}
        <View style={styles.main}>
          <Text style={[styles.title, { color: c.ink }]} numberOfLines={2}>
            {item.title}
          </Text>
          {who ? (
            <Text style={[styles.who, { color: c.accent }]} numberOfLines={1}>
              {who}
            </Text>
          ) : null}
          {yours && yours.toLowerCase() !== item.title.toLowerCase() ? (
            <Text style={[styles.yours, { color: c.ink }]} numberOfLines={2}>
              “{yours}”
            </Text>
          ) : null}
          {caption && !caption.startsWith(item.title.replace(/…$/, '')) ? (
            <Text style={[styles.caption, { color: c.body }]} numberOfLines={2}>
              {caption}
            </Text>
          ) : null}
          {item.page.status === 'pending' ? (
            <Text style={[styles.when, { color: c.muted }]}>Reading it when you are online…</Text>
          ) : item.page.status === 'failed' && !caption ? (
            <Text style={[styles.when, { color: c.muted }]}>Couldn&apos;t read this one. Open it to see.</Text>
          ) : null}
          <Text style={[styles.when, { color: snoozed ? c.accent : c.muted }]}>{when}</Text>
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Button label="Open" kind="primary" onPress={() => onOpen(item)} accessibilityLabel={`Open ${item.title}`} />
        <Button label="Done" onPress={() => onDone(item)} accessibilityLabel={`Mark ${item.title} as checked`} />
        <Button label="Later" onPress={() => setChoosing((v) => !v)} accessibilityLabel={`Remind me later about ${item.title}`} />
      </View>
      {choosing ? (
        <View style={styles.choices}>
          {laterChoices(now).map((choice) => (
            <Chip
              key={choice.key}
              label={choice.label}
              onPress={() => {
                setChoosing(false);
                onLater(item, choice.at);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.m, borderWidth: StyleSheet.hairlineWidth * 2, padding: Space.m + 2, gap: Space.m },
  row: { flexDirection: 'row', gap: Space.m },
  thumb: { width: 72, height: 96, borderRadius: Radius.s },
  main: { flex: 1, gap: 4 },
  title: { fontSize: 16.5, lineHeight: 22, fontWeight: '600' },
  who: { fontSize: 13.5, fontWeight: '600' },
  caption: { fontSize: 14, lineHeight: 19 },
  yours: { fontSize: 14, lineHeight: 19, fontStyle: 'italic' },
  when: { fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  actions: { flexDirection: 'row', gap: Space.s },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
