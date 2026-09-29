// One diary day or note, in full. Edit your words, see the to-do that came from it, other notes
// that mean something similar, or delete it.
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { domainOf } from '@/brain/links';
import { Group, NoteRow, TodoRow } from '@/components/rows';
import { Body, Button, Chip, Label } from '@/components/ui';
import { Fonts, MaxContentWidth, Radius, Space } from '@/constants/theme';
import { deleteItem, getItem, related, setTodoDone, todoForItem, updateText, type Item, type Todo } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged } from '@/lib/events';
import { dayLabel, longDate, timeLabel } from '@/lib/format';
import { deletePhoto } from '@/lib/photos';
import { syncReminders } from '@/lib/reminders';

function confirm(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) =>
    Alert.alert(message, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const c = usePalette();
  const [item, setItem] = useState<Item | null>(null);
  const [todo, setTodo] = useState<Todo | null>(null);
  const [alike, setAlike] = useState<Item[]>([]);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const found = await getItem(db, Number(id));
    if (!found) {
      setMissing(true);
      return;
    }
    setItem(found);
    setDraft(found.text);
    setNow(Date.now());
    setTodo(await todoForItem(db, found.id));
    setAlike((await related(db, found.id)).filter((other) => !other.hidden));
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function remove() {
    if (!item || !(await confirm(item.kind === 'diary' ? 'Delete this day from your diary?' : 'Delete this note?'))) return;
    deletePhoto(await deleteItem(db, item.id));
    dataChanged();
    await syncReminders(db).catch(() => 0);
    router.back();
  }

  const close = <Button label="Close" onPress={() => router.back()} style={styles.close} />;

  if (missing) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]}>
        <View style={styles.content}>
          {close}
          <Body muted>This was deleted.</Body>
        </View>
      </SafeAreaView>
    );
  }
  if (!item) return <View style={[styles.screen, { backgroundColor: c.background }]} />;

  const diary = item.kind === 'diary';
  const picture = item.photoUri ?? item.page.image;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <Label style={{ flex: 1 }}>
            {diary ? 'Diary' : item.hidden ? 'What you said' : 'Note'} · {longDate(item.createdAt)}
            {diary ? '' : `, ${timeLabel(item.createdAt)}`}
          </Label>
          {close}
        </View>

        {diary ? <Text style={[styles.dayTitle, { color: c.ink }]}>{dayLabel(item.createdAt)}</Text> : null}

        {editing ? (
          <View style={{ gap: Space.s }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              style={[styles.editor, { color: c.ink, backgroundColor: c.surface, borderColor: c.accent }]}
              accessibilityLabel="Your words"
            />
            <View style={styles.row}>
              <Button
                label="Save"
                kind="primary"
                disabled={!draft.trim()}
                onPress={async () => {
                  await updateText(db, item.id, draft);
                  setEditing(false);
                  dataChanged();
                  await load();
                }}
              />
              <Button
                label="Cancel"
                onPress={() => {
                  setDraft(item.text);
                  setEditing(false);
                }}
              />
            </View>
          </View>
        ) : (
          <Text style={[styles.text, { color: c.ink }]} selectable onPress={() => setEditing(true)}>
            {item.text}
          </Text>
        )}

        {picture ? <Image source={{ uri: picture }} style={styles.photo} contentFit="cover" /> : null}

        {item.url ? (
          <View style={[styles.link, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Text style={[styles.domain, { color: c.muted }]} numberOfLines={1}>
              {item.page.author ? `${item.page.author} · ` : ''}
              {domainOf(item.url)}
            </Text>
            {item.page.text ? (
              <Text style={[styles.caption, { color: c.body }]} selectable numberOfLines={12}>
                {item.page.text}
              </Text>
            ) : null}
            <Button
              label="Open link"
              icon="open-outline"
              style={styles.left}
              onPress={() => {
                if (Platform.OS === 'web') window.open(item.url!, '_blank', 'noopener');
                else void Linking.openURL(item.url!);
              }}
            />
          </View>
        ) : null}

        {item.note ? (
          <View style={styles.group}>
            <Label>Added later</Label>
            <Text style={[styles.body, { color: c.body }]} selectable>
              {item.note}
            </Text>
          </View>
        ) : null}

        {item.people.length ? (
          <View style={styles.row}>
            {item.people.map((p) => (
              <Chip key={p} label={p} icon="person-outline" />
            ))}
          </View>
        ) : null}

        {todo ? (
          <View style={styles.group}>
            <Label>To-do from this</Label>
            <Group>
              <TodoRow
                todo={todo}
                now={now}
                first
                onDone={async (t, done) => {
                  await setTodoDone(db, t.id, done);
                  dataChanged();
                  await syncReminders(db).catch(() => 0);
                  await load();
                }}
              />
            </Group>
          </View>
        ) : null}

        {alike.length ? (
          <View style={styles.group}>
            <Label>Like this</Label>
            <Group>
              {alike.map((other, i) => (
                <NoteRow key={other.id} item={other} first={i === 0} />
              ))}
            </Group>
          </View>
        ) : null}

        <View style={[styles.row, { marginTop: Space.m }]}>
          {!editing ? <Button label="Edit" icon="create-outline" onPress={() => setEditing(true)} /> : null}
          <Button label="Delete" kind="danger" onPress={() => void remove()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: Space.l, padding: Space.l, paddingBottom: Space.xxl * 2, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.m },
  close: { minHeight: 36 },
  dayTitle: { fontFamily: Fonts.display, fontSize: 28, lineHeight: 34 },
  text: { fontSize: 18, lineHeight: 28 },
  body: { fontSize: 16, lineHeight: 24 },
  editor: { minHeight: 160, borderWidth: 1, borderRadius: Radius.m, padding: Space.m, fontSize: 17, lineHeight: 25, textAlignVertical: 'top', outlineWidth: 0 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.l },
  link: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.l, padding: Space.l, gap: Space.s },
  domain: { fontSize: 13.5, fontWeight: '600' },
  caption: { fontSize: 15, lineHeight: 22 },
  group: { gap: Space.s },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s, alignItems: 'center' },
  left: { alignSelf: 'flex-start' },
});
