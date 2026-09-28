import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { describeDue } from '@/brain/reminders';
import { Body, Button, Label, Notice, Title } from '@/components/ui';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { listTodos, saveCapture, setTodoDone, type Todo } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { askForReminders, remindersAllowed, syncReminders } from '@/lib/reminders';

export default function TodosScreen() {
  const db = useDb();
  const c = usePalette();
  const [open, setOpen] = useState<Todo[]>([]);
  const [done, setDone] = useState<Todo[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [text, setText] = useState('');
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const [openTodos, doneTodos, permitted] = await Promise.all([listTodos(db, true), listTodos(db, false), remindersAllowed()]);
    setOpen(openTodos);
    setDone(doneTodos);
    setNow(Date.now());
    setAllowed(permitted || Platform.OS === 'web');
    // Opening the list also tops the reminders back up.
    if (permitted) void syncReminders(db);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await saveCapture(db, { text: text.trim() }, new Date(), true);
      setText('');
      if (!allowed) setAllowed(await askForReminders());
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(todo: Todo) {
    await setTodoDone(db, todo.id, todo.doneAt === null);
    await load();
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 4 }}>
          <Title>To-dos</Title>
          <Body muted>Anything you say you want to do lands here. Memoir keeps reminding you until it is done.</Body>
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

        {open.length === 0 ? (
          <Body muted style={{ paddingVertical: Space.l }}>
            Nothing on your list. Try “I want to renew my passport next month” on the Memoir tab, or type one above.
          </Body>
        ) : (
          <View style={styles.list}>
            {open.map((todo) => {
              const due = describeDue(todo.dueAt, now);
              const dueColor = due.tone === 'overdue' ? c.danger : due.tone === 'soon' ? c.accent : c.muted;
              return (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  detail={due.text}
                  detailColor={dueColor}
                  onToggle={() => void toggle(todo)}
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
                  <TodoRow key={todo.id} todo={todo} detail="Done" detailColor={c.success} onToggle={() => void toggle(todo)} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
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
  content: { gap: Space.l, padding: Space.l, paddingBottom: 120, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
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
