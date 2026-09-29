// Journal: your days in your own words, and the notes you kept. One search finds anything in
// either, by your words or by meaning, all on the phone.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseQuery } from '@/brain/query';
import { EmptyArt } from '@/components/art';
import { DiaryCard } from '@/components/diary-card';
import { Group, NoteRow, SectionTitle } from '@/components/rows';
import { Body, Icon, Notice, Screen, Segmented, Title, Toast, tap } from '@/components/ui';
import { Fonts, Radius, Space } from '@/constants/theme';
import { tellAs } from '@/db/assistant';
import { knownPeople, listDiary, listNotes, search, type Found, type Item } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged, useDataChanged } from '@/lib/events';
import { dayLabel } from '@/lib/format';

type Tab = 'diary' | 'notes';

export default function JournalScreen() {
  const db = useDb();
  const c = usePalette();
  const [tab, setTab] = useState<Tab>('diary');
  const [days, setDays] = useState<Item[]>([]);
  const [notes, setNotes] = useState<Item[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ items: Found[]; loose: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, n] = await Promise.all([listDiary(db, 120), listNotes(db, 200)]);
    setDays(d);
    setNotes(n);
  }, [db]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useDataChanged(load);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let live = true;
    const timer = setTimeout(async () => {
      const people = await knownPeople(db);
      const result = await search(db, parseQuery(q, new Date(), people), 30);
      if (live) setFound({ items: result.found.filter((f) => !f.item.hidden), loose: result.loose });
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [db, query]);

  const results = query.trim() ? found : null;
  const today = days[0] && dayLabel(days[0].createdAt) === 'Today' ? days[0] : null;
  const past = today ? days.slice(1) : days;

  return (
    <Screen>
      <View style={styles.header}>
        <Title>Journal</Title>
      </View>

      <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.line }]}>
        <Icon name="search" size={18} color={c.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your days and notes"
          placeholderTextColor={c.muted}
          returnKeyType="search"
          style={[styles.searchInput, { color: c.ink }]}
          accessibilityLabel="Search your days and notes"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="close-circle" size={18} color={c.faint} />
          </Pressable>
        ) : null}
      </View>

      {results ? (
        <View style={styles.stack}>
          {results.loose ? <Notice>Nothing matched those words exactly. These are the closest.</Notice> : null}
          {results.items.length ? (
            <Group>
              {results.items.map((f, i) => (
                <NoteRow key={f.item.id} item={f.item} first={i === 0} />
              ))}
            </Group>
          ) : (
            <Body muted style={styles.centered}>
              Nothing found. Try fewer words.
            </Body>
          )}
        </View>
      ) : (
        <>
          <Segmented
            options={[
              { key: 'diary', label: 'Diary' },
              { key: 'notes', label: 'Notes' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <Toast text={message} onDone={() => setMessage(null)} />

          {tab === 'diary' ? (
            <View style={styles.stack}>
              <DiaryCard onSaved={setMessage} />
              {past.length ? (
                past.map((entry) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(entry.id) } })}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.day, { backgroundColor: c.surface, borderColor: c.line }, pressed && { opacity: 0.8 }]}>
                    <Text style={[styles.dayTitle, { color: c.ink }]}>{dayLabel(entry.createdAt)}</Text>
                    <Text style={[styles.dayText, { color: c.body }]} numberOfLines={5}>
                      {entry.text.replace(/\n{2,}/g, '\n')}
                    </Text>
                  </Pressable>
                ))
              ) : today ? null : (
                <Empty text="Each day you write becomes a page here. Say “went to the gym and had lunch with Ravi” on Today, and it lands in your diary." />
              )}
            </View>
          ) : (
            <View style={styles.stack}>
              <AddNote
                onAdd={async (text) => {
                  const reply = await tellAs(db, text, 'note');
                  setMessage(reply.text);
                  dataChanged();
                }}
              />
              {notes.length ? (
                <View style={styles.section}>
                  <SectionTitle title={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`} />
                  <Group>
                    {notes.map((item, i) => (
                      <NoteRow key={item.id} item={item} first={i === 0} />
                    ))}
                  </Group>
                </View>
              ) : (
                <Empty text="Things worth keeping, like a wifi password, a book someone recommended, or an idea. Ask Memoir about them later." />
              )}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function AddNote({ onAdd }: { onAdd: (text: string) => Promise<void> }) {
  const c = usePalette();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(text.trim());
      tap('success');
      setText('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[styles.note, { backgroundColor: c.surface, borderColor: open ? c.accent : c.line }]}>
      <TextInput
        value={text}
        onChangeText={setText}
        onFocus={() => setOpen(true)}
        placeholder="Write a note…"
        placeholderTextColor={c.muted}
        multiline
        style={[styles.noteInput, { color: c.ink }, open && { minHeight: 80 }]}
        accessibilityLabel="Write a note"
      />
      {open ? (
        <View style={styles.noteActions}>
          <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.noteButton, { color: c.muted }]}>Close</Text>
          </Pressable>
          <Pressable onPress={() => void save()} hitSlop={8} accessibilityRole="button" disabled={!text.trim()}>
            <Text style={[styles.noteButton, { color: text.trim() ? c.accent : c.faint }]}>Save</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  const c = usePalette();
  return (
    <View style={styles.empty}>
      <EmptyArt color={c.claySoft} accent={c.accent} size={120} />
      <Body muted style={styles.centered}>
        {text}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Space.l },
  stack: { gap: Space.m },
  section: { gap: Space.s },
  search: { flexDirection: 'row', alignItems: 'center', gap: Space.s, borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: Space.l, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10, outlineWidth: 0 },
  centered: { textAlign: 'center' },
  day: { borderRadius: Radius.l, borderWidth: StyleSheet.hairlineWidth, padding: Space.l, gap: 6 },
  dayTitle: { fontFamily: Fonts.displayMedium, fontSize: 17, lineHeight: 22 },
  dayText: { fontSize: 15.5, lineHeight: 22.5 },
  note: { borderRadius: Radius.l, borderWidth: 1, paddingHorizontal: Space.l, paddingVertical: Space.s, gap: Space.s },
  noteInput: { fontSize: 16, lineHeight: 22, minHeight: 36, paddingVertical: 6, textAlignVertical: 'top', outlineWidth: 0 },
  noteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Space.xl, paddingBottom: 4 },
  noteButton: { fontSize: 15.5, fontWeight: '700' },
  empty: { alignItems: 'center', gap: Space.s, paddingVertical: Space.l, paddingHorizontal: Space.l },
});
