// "How was your day?" One entry per day, and anything you add later that day joins it. Writing
// "called Amma" here also ticks the to-do "Call Amma". The keyboard's mic works too, so you can talk.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ShelfMark } from '@/components/art';
import { Button, Heading, tap } from '@/components/ui';
import { Radius, Space } from '@/constants/theme';
import { tellAs } from '@/db/assistant';
import { diaryFor, type Item } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged, useDataChanged } from '@/lib/events';
import { syncReminders } from '@/lib/reminders';

export function DiaryCard({ onSaved }: { onSaved?: (message: string) => void }) {
  const db = useDb();
  const c = usePalette();
  const [entry, setEntry] = useState<Item | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

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
      const reply = await tellAs(db, text, 'diary');
      tap('success');
      setText('');
      setWriting(false);
      onSaved?.(reply.text);
      dataChanged();
      await syncReminders(db).catch(() => 0);
    } finally {
      setBusy(false);
    }
  }

  const preview = entry ? entry.text.replace(/\s+/g, ' ') : 'A line or two is enough. What did you do, who did you meet?';

  return (
    <Pressable
      onPress={() => {
        if (writing) return;
        tap();
        setWriting(true);
      }}
      accessibilityRole="button"
      accessibilityLabel={entry ? 'Add to today’s diary' : 'Write about your day'}
      style={[styles.card, { backgroundColor: c.claySoft }]}>
      <View style={styles.head}>
        <ShelfMark category="diary" color={c.clay} size={38} />
        <View style={{ flex: 1, gap: 2 }}>
          <Heading>{entry ? 'Your day so far' : 'How was your day?'}</Heading>
          {!writing ? (
            <Text style={[styles.sub, { color: c.body }]} numberOfLines={3}>
              {preview}
            </Text>
          ) : null}
        </View>
      </View>

      {writing ? (
        <View style={{ gap: Space.s }}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder={entry ? 'Add to today…' : 'Went to the gym, lunch with Ravi, finished the demo…'}
            placeholderTextColor={c.muted}
            style={[styles.input, { color: c.ink, backgroundColor: c.surface }]}
            accessibilityLabel="Write about your day"
          />
          <View style={styles.actions}>
            {entry ? (
              <Button label="Read today" kind="plain" onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(entry.id) } })} />
            ) : (
              <View />
            )}
            <View style={styles.row}>
              <Button
                label="Cancel"
                kind="plain"
                onPress={() => {
                  setWriting(false);
                  setText('');
                }}
              />
              <Button label="Save" kind="primary" onPress={() => void save()} disabled={!text.trim()} busy={busy} />
            </View>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.l, padding: Space.l, gap: Space.m },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.m },
  sub: { fontSize: 15, lineHeight: 21 },
  input: { minHeight: 96, borderRadius: Radius.m, padding: Space.m, fontSize: 16, lineHeight: 22, textAlignVertical: 'top', outlineWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
});
