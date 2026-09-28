// "How was your day?" on the home screen. One entry per day, and anything you add later that day
// joins it. The keyboard's mic works here too, so you can just talk.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui';
import { Fonts, Radius, Space } from '@/constants/theme';
import { diaryFor, writeDiary, type Item } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged, useDataChanged } from '@/lib/events';
import { syncReminders } from '@/lib/reminders';

export function DiaryCard() {
  const db = useDb();
  const c = usePalette();
  const [entry, setEntry] = useState<Item | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  const load = useCallback(async () => {
    setEntry(await diaryFor(db, new Date()));
  }, [db]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useDataChanged(load);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const { todo } = await writeDiary(db, text);
      setText('');
      setWriting(false);
      setSaid(todo ? `Saved. Also added a to-do: ${todo.title}.` : 'Saved to today.');
      await syncReminders(db).catch(() => 0);
      dataChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: c.ink }]}>How was your day?</Text>
        {entry && !writing ? (
          <Pressable onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(entry.id) } })} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.link, { color: c.accent }]}>Open</Text>
          </Pressable>
        ) : null}
      </View>

      {entry && !writing ? (
        <Text style={[styles.entry, { color: c.body }]} numberOfLines={4}>
          {entry.text}
        </Text>
      ) : null}

      {writing ? (
        <View style={{ gap: Space.s }}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder="What did you do, who did you meet, what did you learn?"
            placeholderTextColor={c.muted}
            style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.background }]}
            accessibilityLabel="Write about your day"
          />
          <View style={styles.actions}>
            <Button label="Save" kind="primary" onPress={() => void save()} disabled={!text.trim()} busy={busy} />
            <Button
              label="Cancel"
              onPress={() => {
                setWriting(false);
                setText('');
              }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            label={entry ? 'Add to today' : 'Write a line'}
            onPress={() => {
              setSaid('');
              setWriting(true);
            }}
          />
          {said ? <Text style={[styles.said, { color: c.success }]}>{said}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: Radius.l, padding: Space.l, gap: Space.s },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontFamily: Fonts.serif, fontSize: 20, fontWeight: '600' },
  link: { fontSize: 15, fontWeight: '700' },
  entry: { fontSize: 15.5, lineHeight: 22 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: Radius.m, padding: Space.m, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.s, flexWrap: 'wrap' },
  said: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
});
