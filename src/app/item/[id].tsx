// One saved thing, in full. For a reel or link: who posted it, the caption exactly as written,
// one tap back to it, and whether you have checked it yet. Plus your own note, the shelf,
// a to-do, and other things you saved that are like it.
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Scope } from '@/brain/analyze';
import { CATEGORIES, type CategoryId } from '@/brain/categories';
import { domainOf, SOURCE_LABELS } from '@/brain/links';
import { describeDue, laterChoices } from '@/brain/reminders';
import { ItemCard } from '@/components/item-card';
import { Body, Button, Chip, Label, Notice } from '@/components/ui';
import { Fonts, MaxContentWidth, Radius, Space } from '@/constants/theme';
import {
  deleteItem,
  getItem,
  makeTodo,
  related,
  remindLater,
  retryPage,
  setChecked,
  setNote,
  setTodoDone,
  todoForItem,
  updateItem,
  type Item,
  type Todo,
} from '@/db/repo';
import { usePalette, useShelfColor } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged } from '@/lib/events';
import { longDate, soonLabel, timeLabel } from '@/lib/format';
import { openSaved } from '@/lib/open-link';
import { readPendingPages } from '@/lib/page-sync';
import { deletePhoto } from '@/lib/photos';
import { askForReminders, remindersAllowed, syncReminders } from '@/lib/reminders';

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
  const shelfColor = useShelfColor();
  const [item, setItem] = useState<Item | null>(null);
  const [todo, setTodo] = useState<Todo | null>(null);
  const [missing, setMissing] = useState(false);
  const [alike, setAlike] = useState<Item[]>([]);
  const [now, setNow] = useState(0);
  const [note, setNoteText] = useState('');
  const [editing, setEditing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [showShelves, setShowShelves] = useState(false);

  const load = useCallback(async () => {
    const found = await getItem(db, Number(id));
    if (!found) {
      setMissing(true);
      return;
    }
    setItem(found);
    setNoteText(found.note);
    setTodo(await todoForItem(db, found.id));
    setAlike(await related(db, found.id));
    setNow(Date.now());
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refreshReminders() {
    const allowed = (await remindersAllowed()) || (await askForReminders());
    if (allowed) await syncReminders(db);
    dataChanged();
  }

  async function remove() {
    if (!item || !(await confirm('Delete this from Memoir?'))) return;
    deletePhoto(await deleteItem(db, item.id));
    await refreshReminders();
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

  const due = todo ? describeDue(todo.dueAt, now) : null;
  const picture = item.photoUri ?? item.page.image;
  const yours = item.text.replace(item.url ?? '', '').trim();
  const isLink = Boolean(item.url);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <Label style={{ flex: 1 }}>
            {SOURCE_LABELS[item.source]} · {longDate(item.createdAt)}, {timeLabel(item.createdAt)}
          </Label>
          {close}
        </View>

        <Text style={[styles.title, { color: c.ink }]} selectable>
          {item.title}
        </Text>

        {isLink ? (
          <View style={[styles.linkBox, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Pressable onPress={() => void openSaved(db, item).then(load)} accessibilityRole="link" style={styles.linkHead}>
              {picture ? <Image source={{ uri: picture }} style={[styles.linkThumb, { backgroundColor: c.sunken }]} contentFit="cover" /> : null}
              <View style={{ flex: 1, gap: 2 }}>
                {item.page.author ? <Text style={[styles.author, { color: c.ink }]}>{item.page.author}</Text> : null}
                <Text style={[styles.domain, { color: c.muted }]} numberOfLines={1}>
                  {domainOf(item.url!)}
                </Text>
              </View>
            </Pressable>
            <Button
              label={item.source === 'instagram' ? 'Open in Instagram' : item.source === 'youtube' ? 'Open in YouTube' : 'Open link'}
              kind="primary"
              onPress={() => void openSaved(db, item).then(load)}
            />
            {item.page.text ? (
              <View style={{ gap: 6 }}>
                <Label>{item.source === 'instagram' || item.source === 'tiktok' ? 'Caption' : 'What the page says'}</Label>
                <Text style={[styles.caption, { color: c.body }]} selectable>
                  {item.page.title && item.page.title !== item.title ? `${item.page.title}\n\n` : ''}
                  {item.page.text}
                </Text>
              </View>
            ) : item.page.status === 'pending' ? (
              <Body muted>Memoir reads what this is as soon as the phone is online.</Body>
            ) : item.page.status === 'failed' ? (
              <View style={{ gap: Space.s }}>
                <Body muted>Memoir couldn&apos;t read this one, so the link above is the way back to it. Add a note below so you remember why you saved it.</Body>
              </View>
            ) : null}
          </View>
        ) : picture ? (
          <Image source={{ uri: picture }} style={styles.photo} contentFit="contain" />
        ) : null}

        {isLink ? (
          <View style={styles.group}>
            <Label>Follow up</Label>
            <Text style={[styles.status, { color: item.checkState === 'checked' ? c.success : item.checkState === 'to_check' ? c.warn : c.muted }]}>
              {item.checkState === 'checked' && item.checkedAt
                ? `Checked ${longDate(item.checkedAt)}`
                : item.checkState === 'to_check'
                  ? item.checkAfter && item.checkAfter > now
                    ? `Reminding you ${soonLabel(item.checkAfter, now)}`
                    : 'Not checked yet. Memoir reminds you in the evening.'
                  : 'Not on your list'}
            </Text>
            <View style={styles.chips}>
              {item.checkState === 'to_check' ? (
                <Chip
                  label="Mark as checked"
                  onPress={async () => {
                    await setChecked(db, item.id, true);
                    await refreshReminders();
                    await load();
                  }}
                />
              ) : null}
              <Chip label={item.checkState === 'to_check' ? 'Later' : 'Remind me to check again'} selected={choosing} onPress={() => setChoosing((v) => !v)} />
            </View>
            {choosing ? (
              <View style={styles.chips}>
                {laterChoices(now).map((choice) => (
                  <Chip
                    key={choice.key}
                    label={choice.label}
                    onPress={async () => {
                      setChoosing(false);
                      await remindLater(db, item.id, choice.at);
                      await refreshReminders();
                      await load();
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {yours && yours !== item.title ? (
          <View style={styles.group}>
            <Label>{isLink ? 'What you wrote' : 'Note'}</Label>
            <Text style={[styles.text, { color: c.body }]} selectable>
              {yours}
            </Text>
          </View>
        ) : null}

        <View style={styles.group}>
          <Label>Your note</Label>
          {editing ? (
            <View style={{ gap: Space.s }}>
              <TextInput
                value={note}
                onChangeText={setNoteText}
                multiline
                autoFocus
                placeholder={isLink ? 'Why did you save this? What do you want to try?' : 'Add anything'}
                placeholderTextColor={c.muted}
                style={[styles.noteInput, { color: c.ink, backgroundColor: c.surface, borderColor: c.line }]}
                accessibilityLabel="Your note"
              />
              <View style={styles.chips}>
                <Button
                  label="Save note"
                  kind="primary"
                  onPress={async () => {
                    await setNote(db, item.id, note);
                    setEditing(false);
                    dataChanged();
                    await load();
                  }}
                />
                <Button
                  label="Cancel"
                  onPress={() => {
                    setNoteText(item.note);
                    setEditing(false);
                  }}
                />
              </View>
            </View>
          ) : item.note ? (
            <Pressable onPress={() => setEditing(true)} accessibilityRole="button" accessibilityHint="Edit your note">
              <Text style={[styles.text, { color: c.body }]}>{item.note}</Text>
            </Pressable>
          ) : (
            <Button label={isLink ? 'Add why you saved it' : 'Add a note'} onPress={() => setEditing(true)} style={styles.left} />
          )}
        </View>

        {item.people.length ? (
          <View style={styles.group}>
            <Label>People</Label>
            <View style={styles.chips}>
              {item.people.map((p) => (
                <Chip key={p} label={p} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.group}>
          <Label>To-do</Label>
          {todo ? (
            <View style={[styles.todo, { backgroundColor: c.surface, borderColor: c.line }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.todoTitle, { color: c.ink }]}>{todo.title}</Text>
                <Text style={{ color: todo.doneAt ? c.success : due?.tone === 'overdue' ? c.danger : c.muted, fontWeight: '600' }}>
                  {todo.doneAt ? 'Done' : due?.text}
                </Text>
              </View>
              <Button
                label={todo.doneAt ? 'Reopen' : 'Mark done'}
                onPress={async () => {
                  await setTodoDone(db, todo.id, todo.doneAt === null);
                  await refreshReminders();
                  await load();
                }}
              />
            </View>
          ) : (
            <Button
              label="Make it a to-do"
              onPress={async () => {
                await makeTodo(db, item);
                await refreshReminders();
                await load();
              }}
              style={styles.left}
            />
          )}
        </View>

        <View style={styles.group}>
          <Label>Shelf</Label>
          <View style={styles.chips}>
            {(showShelves ? CATEGORIES : CATEGORIES.filter((cat) => cat.id === item.category)).map((cat) => (
              <Chip
                key={cat.id}
                label={cat.label}
                dot={shelfColor(cat.id)}
                selected={item.category === cat.id}
                onPress={async () => {
                  if (!showShelves) {
                    setShowShelves(true);
                    return;
                  }
                  await updateItem(db, item.id, { category: cat.id as CategoryId });
                  setShowShelves(false);
                  dataChanged();
                  await load();
                }}
              />
            ))}
            {!showShelves ? <Chip label="Move" onPress={() => setShowShelves(true)} /> : null}
          </View>
        </View>

        <View style={styles.group}>
          <Label>Kind</Label>
          <View style={styles.chips}>
            {(['personal', 'public'] as Scope[]).map((scope) => (
              <Chip
                key={scope}
                label={scope === 'personal' ? 'Personal' : 'Public'}
                selected={item.scope === scope}
                onPress={async () => {
                  await updateItem(db, item.id, { scope });
                  await load();
                }}
              />
            ))}
          </View>
        </View>

        {item.tags.length ? <Notice>Tagged {item.tags.join(', ')}</Notice> : null}

        {alike.length ? (
          <View style={styles.group}>
            <Label>Like this</Label>
            {alike.map((other) => (
              <ItemCard key={other.id} item={other} showDay={longDate(other.createdAt)} />
            ))}
          </View>
        ) : null}

        {isLink && item.page.status === 'failed' ? (
          <Button
            label="Try reading it again"
            onPress={async () => {
              await retryPage(db, item.id);
              await readPendingPages(db);
              await load();
            }}
            style={styles.left}
          />
        ) : null}

        <Button label="Delete" kind="danger" onPress={() => void remove()} style={[styles.left, { marginTop: Space.l }]} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: Space.l, padding: Space.l, paddingBottom: Space.xxl * 2, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.m },
  close: { minHeight: 36 },
  title: { fontFamily: Fonts.serif, fontSize: 26, lineHeight: 32, fontWeight: '600' },
  photo: { width: '100%', aspectRatio: 1, borderRadius: Radius.l },
  linkBox: { borderWidth: 1, borderRadius: Radius.l, padding: Space.m + 2, gap: Space.m },
  linkHead: { flexDirection: 'row', alignItems: 'center', gap: Space.m },
  linkThumb: { width: 64, height: 84, borderRadius: Radius.s },
  author: { fontSize: 16, fontWeight: '700' },
  domain: { fontSize: 13.5 },
  caption: { fontSize: 16, lineHeight: 24 },
  status: { fontSize: 15, fontWeight: '600' },
  text: { fontSize: 17, lineHeight: 26 },
  noteInput: { minHeight: 90, borderWidth: 1, borderRadius: Radius.m, padding: Space.m, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' },
  group: { gap: Space.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  todo: { flexDirection: 'row', alignItems: 'center', gap: Space.m, borderWidth: 1, borderRadius: Radius.m, padding: Space.m },
  todoTitle: { fontSize: 16, fontWeight: '600' },
  left: { alignSelf: 'flex-start' },
});
