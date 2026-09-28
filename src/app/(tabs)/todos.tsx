// Follow up: the reels and links you saved to look at, and the things you said you would do.
// Memoir keeps nudging about both until they are done.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { describeDue } from '@/brain/reminders';
import { CheckRow } from '@/components/check-row';
import { Body, Button, Label, Notice, Title } from '@/components/ui';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { listTodos, listToCheck, remindLater, saveCapture, setChecked, setTodoDone, type Item, type Todo } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged, useDataChanged } from '@/lib/events';
import { openSaved } from '@/lib/open-link';
import { askForReminders, remindersAllowed, syncReminders } from '@/lib/reminders';

export default function FollowUpScreen() {
  const db = useDb();
  const c = usePalette();
  const [due, setDue] = useState<Item[]>([]);
  const [later, setLater] = useState<Item[]>([]);
  const [open, setOpen] = useState<Todo[]>([]);
  const [done, setDone] = useState<Todo[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const [text, setText] = useState('');
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const at = new Date();
    const [checks, openTodos, doneTodos, permitted] = await Promise.all([
      listToCheck(db, at),
      listTodos(db, true),
      listTodos(db, false),
      remindersAllowed(),
    ]);
    setDue(checks.due);
    setLater(checks.later);
    setOpen(openTodos);
    setDone(doneTodos);
    setNow(at.getTime());
    setAllowed(permitted || Platform.OS === 'web');
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // Opening the list also tops the reminders back up.
      void syncReminders(db).catch(() => 0);
    }, [load, db]),
  );
  useDataChanged(load);

  async function changed() {
    await syncReminders(db).catch(() => 0);
    dataChanged();
  }

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await saveCapture(db, { text: text.trim() }, new Date(), true);
      setText('');
      if (!allowed) setAllowed(await askForReminders());
      await changed();
    } finally {
      setBusy(false);
    }
  }

  const checkActions = {
    now,
    onOpen: (item: Item) => void openSaved(db, item),
    onDone: async (item: Item) => {
      await setChecked(db, item.id, true);
      await changed();
    },
    onLater: async (item: Item, at: number) => {
      await remindLater(db, item.id, at);
      await changed();
    },
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 4 }}>
          <Title>Follow up</Title>
          <Body muted>Reels and links you saved to look at, and things you said you would do. Memoir keeps reminding you until they are done.</Body>
        </View>

        {!allowed ? (
          <View style={{ gap: Space.s }}>
            <Notice tone="warn">Reminders are off, so Memoir cannot nudge you.</Notice>
            <Button
              label="Turn on reminders"
              onPress={async () => {
                const ok = await askForReminders();
                setAllowed(ok);
                if (ok) await syncReminders(db);
              }}
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: c.ink }]}>To check</Text>
            {due.length ? <Text style={[styles.count, { color: c.muted }]}>{due.length}</Text> : null}
          </View>
          {due.length === 0 ? (
            <Body muted>
              {later.length ? 'Nothing due right now. The others come back at the time you picked.' : 'All caught up. Copy a reel link in Instagram and open Memoir to save it.'}
            </Body>
          ) : (
            due.map((item) => <CheckRow key={item.id} item={item} {...checkActions} />)
          )}
          {later.length ? (
            <View style={{ gap: Space.s }}>
              <Pressable onPress={() => setShowLater((v) => !v)} accessibilityRole="button" hitSlop={8}>
                <Label>
                  {showLater ? 'Hide' : 'Show'} later ({later.length})
                </Label>
              </Pressable>
              {showLater ? later.map((item) => <CheckRow key={item.id} item={item} {...checkActions} />) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: c.ink }]}>To do</Text>
            {open.length ? <Text style={[styles.count, { color: c.muted }]}>{open.length}</Text> : null}
          </View>
          <View style={[styles.addRow, { backgroundColor: c.surface, borderColor: c.line }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              onSubmitEditing={() => void add()}
              placeholder="Call Ravi on Friday at 6 pm"
              placeholderTextColor={c.muted}
              returnKeyType="done"
              style={[styles.input, { color: c.ink }]}
              accessibilityLabel="Add a to-do"
            />
            <Button label="Add" kind="primary" onPress={() => void add()} disabled={!text.trim()} busy={busy} />
          </View>

          {open.length === 0 ? (
            <Body muted>Nothing to do. Try “I want to renew my passport next month” on the Memoir tab, or type one above.</Body>
          ) : (
            <View style={styles.list}>
              {open.map((todo) => {
                const dueText = describeDue(todo.dueAt, now);
                const dueColor = dueText.tone === 'overdue' ? c.danger : dueText.tone === 'soon' ? c.accent : c.muted;
                return (
                  <TodoRow
                    key={todo.id}
                    todo={todo}
                    detail={dueText.text}
                    detailColor={dueColor}
                    onToggle={async () => {
                      await setTodoDone(db, todo.id, true);
                      await changed();
                    }}
                  />
                );
              })}
            </View>
          )}

          {done.length ? (
            <View style={{ gap: Space.s }}>
              <Pressable onPress={() => setShowDone((v) => !v)} accessibilityRole="button" hitSlop={8}>
                <Label>
                  {showDone ? 'Hide' : 'Show'} done ({done.length})
                </Label>
              </Pressable>
              {showDone ? (
                <View style={styles.list}>
                  {done.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      detail="Done"
                      detailColor={c.success}
                      onToggle={async () => {
                        await setTodoDone(db, todo.id, false);
                        await changed();
                      }}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function TodoRow({ todo, detail, detailColor, onToggle }: { todo: Todo; detail: string; detailColor: string; onToggle: () => void }) {
  const c = usePalette();
  const isDone = todo.doneAt !== null;
  return (
    <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.line }]}>
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isDone }}
        accessibilityLabel={isDone ? `Mark ${todo.title} as not done` : `Mark ${todo.title} as done`}
        style={[styles.check, { borderColor: isDone ? c.success : c.muted, backgroundColor: isDone ? c.success : 'transparent' }]}>
        {isDone ? <Text style={[styles.tick, { color: c.surface }]}>✓</Text> : null}
      </Pressable>
      <Pressable
        style={styles.rowText}
        disabled={todo.itemId === null}
        onPress={() => todo.itemId !== null && router.push({ pathname: '/item/[id]', params: { id: String(todo.itemId) } })}
        accessibilityRole="button">
        <Text style={[styles.todoTitle, { color: isDone ? c.muted : c.ink }, isDone && styles.struck]}>{todo.title}</Text>
        <Text style={[styles.due, { color: detailColor }]}>{detail}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: Space.xl, padding: Space.l, paddingBottom: 120, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  section: { gap: Space.m },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: Space.s },
  sectionTitle: { fontSize: 20, fontWeight: '700' },
  count: { fontSize: 16, fontWeight: '600' },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.l,
    paddingLeft: Space.m + 2,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: { flex: 1, fontSize: 17, minHeight: 40 },
  list: { gap: Space.s },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.m,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.m,
    padding: Space.m + 2,
  },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tick: { fontSize: 15, fontWeight: '800', marginTop: -1 },
  rowText: { flex: 1, gap: 2 },
  todoTitle: { fontSize: 16.5, fontWeight: '600', lineHeight: 22 },
  struck: { textDecorationLine: 'line-through' },
  due: { fontSize: 13.5, fontWeight: '600' },
});
