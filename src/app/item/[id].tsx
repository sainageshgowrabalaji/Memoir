import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Scope } from '@/brain/analyze';
import { CATEGORIES, type CategoryId } from '@/brain/categories';
import { domainOf, SOURCE_LABELS } from '@/brain/links';
import { describeDue } from '@/brain/reminders';
import { Body, Button, Chip, Label, Notice } from '@/components/ui';
import { Fonts, MaxContentWidth, Radius, Space } from '@/constants/theme';
import { deleteItem, getItem, makeTodo, setTodoDone, todoForItem, updateItem, type Item, type Todo } from '@/db/repo';
import { usePalette, useShelfColor } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { longDate, timeLabel } from '@/lib/format';
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
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const found = await getItem(db, Number(id));
    if (!found) {
      setMissing(true);
      return;
    }
    setItem(found);
    setTodo(await todoForItem(db, found.id));
    setNow(Date.now());
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function moveTo(category: CategoryId) {
    if (!item) return;
    await updateItem(db, item.id, { category });
    await load();
  }

  async function setScope(scope: Scope) {
    if (!item) return;
    await updateItem(db, item.id, { scope });
    await load();
  }

  async function refreshReminders() {
    const allowed = (await remindersAllowed()) || (await askForReminders());
    if (allowed) await syncReminders(db);
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
  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Label>
            {SOURCE_LABELS[item.source]} · {longDate(item.createdAt)}, {timeLabel(item.createdAt)}
          </Label>
          {close}
        </View>

        <Text style={[styles.title, { color: c.ink }]} selectable>
          {item.title}
        </Text>

        {item.photoUri ? <Image source={{ uri: item.photoUri }} style={styles.photo} contentFit="contain" /> : null}

        {item.text && item.text !== item.title ? (
          <Text style={[styles.text, { color: c.body }]} selectable>
            {item.text}
          </Text>
        ) : null}

        {item.url ? (
          <View style={[styles.link, { backgroundColor: c.surface, borderColor: c.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkDomain, { color: c.ink }]}>{domainOf(item.url)}</Text>
              <Text style={[styles.linkUrl, { color: c.muted }]} numberOfLines={1}>
                {item.url}
              </Text>
            </View>
            <Button label="Open" kind="primary" onPress={() => void Linking.openURL(item.url!)} />
          </View>
        ) : null}

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
            {CATEGORIES.map((cat) => (
              <Chip
                key={cat.id}
                label={cat.label}
                dot={shelfColor(cat.id)}
                selected={item.category === cat.id}
                onPress={() => void moveTo(cat.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.group}>
          <Label>Kind</Label>
          <View style={styles.chips}>
            <Chip label="Personal" selected={item.scope === 'personal'} onPress={() => void setScope('personal')} />
            <Chip label="Public" selected={item.scope === 'public'} onPress={() => void setScope('public')} />
          </View>
          <Body muted style={styles.small}>
            Personal is your own life and people. Public is things from the internet and social media.
          </Body>
        </View>

        {item.tags.length ? <Notice>Tagged {item.tags.join(', ')}</Notice> : null}

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
  text: { fontSize: 17, lineHeight: 26 },
  link: { flexDirection: 'row', alignItems: 'center', gap: Space.m, borderWidth: 1, borderRadius: Radius.m, padding: Space.m },
  linkDomain: { fontSize: 16, fontWeight: '600' },
  linkUrl: { fontSize: 13 },
  group: { gap: Space.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  todo: { flexDirection: 'row', alignItems: 'center', gap: Space.m, borderWidth: 1, borderRadius: Radius.m, padding: Space.m },
  todoTitle: { fontSize: 16, fontWeight: '600' },
  left: { alignSelf: 'flex-start' },
  small: { fontSize: 13.5 },
});
