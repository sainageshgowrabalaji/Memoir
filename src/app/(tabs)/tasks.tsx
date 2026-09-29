// Tasks: your to-dos by when they are due, your lists, and your habits. Each tab has one box at the
// top that understands plain words ("call the bank at 5", "read 20 minutes before bed").
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyArt } from '@/components/art';
import { Group, HabitRow, ListItemRow, SectionTitle, TodoRow } from '@/components/rows';
import { Body, Button, Icon, Screen, Segmented, Title, Toast, tap } from '@/components/ui';
import { Radius, Space } from '@/constants/theme';
import { learnList, splitItems } from '@/brain/agent';
import {
  addToList,
  archiveHabit,
  clearDone,
  deleteList,
  habitsToday,
  listItemsOf,
  listNames,
  loadLearned,
  moveTodo,
  saveLearned,
  setHabitDone,
  setListItemDone,
  startList,
  tellAs,
  type HabitToday,
  type ListItem,
} from '@/db/assistant';
import { deleteTodo, listTodos, setTodoDone, type Todo } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged, useDataChanged } from '@/lib/events';
import { askForReminders, remindersAllowed, syncReminders } from '@/lib/reminders';

type Tab = 'todo' | 'lists' | 'habits';

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Open to-dos in the groups people think in: late, today, tomorrow, this week, later, anytime. */
function grouped(todos: Todo[], now: number) {
  const today = startOfDay(now);
  const groups: { title: string; data: Todo[] }[] = [
    { title: 'Late', data: [] },
    { title: 'Today', data: [] },
    { title: 'Tomorrow', data: [] },
    { title: 'This week', data: [] },
    { title: 'Later', data: [] },
    { title: 'Anytime', data: [] },
  ];
  for (const t of todos) {
    if (t.dueAt === null) groups[5].data.push(t);
    else if (t.dueAt < now && t.dueAt < today) groups[0].data.push(t);
    else if (t.dueAt < today + DAY) groups[1].data.push(t);
    else if (t.dueAt < today + 2 * DAY) groups[2].data.push(t);
    else if (t.dueAt < today + 7 * DAY) groups[3].data.push(t);
    else groups[4].data.push(t);
  }
  return groups.filter((g) => g.data.length);
}

export default function TasksScreen() {
  const db = useDb();
  const c = usePalette();
  const params = useLocalSearchParams<{ show?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.show ?? 'todo');
  const [open, setOpen] = useState<Todo[]>([]);
  const [done, setDone] = useState<Todo[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [lists, setLists] = useState<{ list: string; items: ListItem[] }[]>([]);
  const [habits, setHabits] = useState<HabitToday[]>([]);
  const [times, setTimes] = useState<Record<string, [number, number]>>({});
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [o, d, names, h, learned] = await Promise.all([listTodos(db, true), listTodos(db, false), listNames(db), habitsToday(db), loadLearned(db)]);
    setOpen(o);
    setDone(d.slice(0, 20));
    setLists(await Promise.all(names.map(async (n) => ({ list: n.list, items: await listItemsOf(db, n.list) }))));
    setHabits(h);
    setTimes(learned.times);
    setNow(Date.now());
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      if (params.show) setTab(params.show);
      void load();
    }, [load, params.show]),
  );
  useDataChanged(load);

  async function changed() {
    dataChanged();
    await syncReminders(db).catch(() => 0);
  }

  async function add(kind: 'todo' | 'habit', text: string) {
    const reply = await tellAs(db, text, kind);
    setMessage(reply.text);
    if (!(await remindersAllowed())) await askForReminders();
    await changed();
  }

  const lateOrToday = open.filter((t) => t.dueAt !== null && t.dueAt < startOfDay(now) + DAY).length;

  return (
    <Screen>
      <View style={styles.header}>
        <Title>Tasks</Title>
      </View>
      <Segmented
        options={[
          { key: 'todo', label: 'To do', count: lateOrToday },
          { key: 'lists', label: 'Lists' },
          { key: 'habits', label: 'Habits' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Toast text={message} onDone={() => setMessage(null)} />

      {tab === 'todo' ? (
        <View style={styles.stack}>
          <AddBox placeholder="Add a to-do, like “call the bank at 5”" onAdd={(text) => add('todo', text)} />
          {open.length === 0 ? (
            <Empty title="All clear" text="Nothing to do. Add something above, or tell Memoir on Today." />
          ) : (
            grouped(open, now).map((group) => (
              <View key={group.title} style={styles.section}>
                <SectionTitle title={group.title} right={<Text style={[styles.count, { color: group.title === 'Late' ? c.clay : c.muted }]}>{group.data.length}</Text>} />
                <Group>
                  {group.data.map((todo, i) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      now={now}
                      first={i === 0}
                      times={times}
                      onDone={async (t, isDone) => {
                        await setTodoDone(db, t.id, isDone);
                        await changed();
                      }}
                      onMove={async (t, at) => {
                        await moveTodo(db, t.id, at);
                        await changed();
                      }}
                      onDelete={async (t) => {
                        await deleteTodo(db, t.id);
                        await changed();
                      }}
                    />
                  ))}
                </Group>
              </View>
            ))
          )}
          {done.length ? (
            <View style={styles.section}>
              <Button label={showDone ? 'Hide done' : `Done lately (${done.length})`} kind="plain" icon={showDone ? 'chevron-up' : 'chevron-down'} style={styles.left} onPress={() => setShowDone((s) => !s)} />
              {showDone ? (
                <Group>
                  {done.map((todo, i) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      now={now}
                      first={i === 0}
                      onDone={async (t, isDone) => {
                        await setTodoDone(db, t.id, isDone);
                        await changed();
                      }}
                    />
                  ))}
                </Group>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {tab === 'lists' ? (
        <View style={styles.stack}>
          {lists.length === 0 ? (
            <Empty title="No lists yet" text="Say “add milk and eggs to the shopping list” on Today, or start one below." />
          ) : (
            lists.map(({ list, items }) => (
              <ListCard
                key={list}
                name={list}
                items={items}
                onAdd={async (text) => {
                  const words = splitItems(text);
                  await addToList(db, list, words);
                  await saveLearned(db, learnList(await loadLearned(db), words, list));
                  dataChanged();
                }}
                onToggle={async (item) => {
                  tap(item.doneAt ? 'light' : 'success');
                  await setListItemDone(db, item.id, item.doneAt === null);
                  dataChanged();
                }}
                onDelete={async (item) => {
                  await db.runAsync('DELETE FROM list_items WHERE id = ?', [item.id]);
                  dataChanged();
                }}
                onDeleteList={async () => {
                  await deleteList(db, list);
                  setMessage(`Deleted your ${list} list.`);
                  dataChanged();
                }}
                onClear={async () => {
                  await clearDone(db, list);
                  dataChanged();
                }}
              />
            ))
          )}
          <NewList
            onCreate={async (name) => {
              await startList(db, name);
              dataChanged();
            }}
          />
        </View>
      ) : null}

      {tab === 'habits' ? (
        <View style={styles.stack}>
          <AddBox placeholder="New habit, like “read before bed”" onAdd={(text) => add('habit', text)} />
          {habits.length === 0 ? (
            <Empty title="No habits yet" text="Something you want to do every day or on certain days. Memoir reminds you and keeps your streak." />
          ) : (
            <Group>
              {habits.map((habit, i) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  first={i === 0}
                  onDone={async (h, isDone) => {
                    tap(isDone ? 'success' : 'light');
                    await setHabitDone(db, h.id, isDone);
                    await changed();
                  }}
                  onStop={async (h) => {
                    await archiveHabit(db, h.id);
                    setMessage(`Stopped "${h.name}".`);
                    await changed();
                  }}
                />
              ))}
            </Group>
          )}
          {habits.length ? <Body muted style={styles.note}>The dots are the last seven days. Tap a habit to stop it.</Body> : null}
        </View>
      ) : null}
    </Screen>
  );
}

/** One line to add something, with a plus that turns into a send arrow. */
function AddBox({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => Promise<void> }) {
  const c = usePalette();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(text.trim());
      tap('success');
      setText('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[styles.add, { backgroundColor: c.surface, borderColor: c.line }]}>
      <Icon name="add" size={20} color={c.accent} />
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        style={[styles.addInput, { color: c.ink }]}
        accessibilityLabel={placeholder}
      />
      {text.trim() ? (
        <Pressable onPress={() => void submit()} accessibilityRole="button" accessibilityLabel="Add" hitSlop={8} style={[styles.addSend, { backgroundColor: c.accent }]}>
          <Icon name="arrow-up" size={17} color={c.onAccent} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ListCard({
  name,
  items,
  onAdd,
  onToggle,
  onDelete,
  onClear,
  onDeleteList,
}: {
  name: string;
  items: ListItem[];
  onAdd: (text: string) => Promise<void>;
  onToggle: (item: ListItem) => Promise<void>;
  onDelete: (item: ListItem) => Promise<void>;
  onClear: () => Promise<void>;
  onDeleteList: () => Promise<void>;
}) {
  const c = usePalette();
  const [text, setText] = useState('');
  const openCount = items.filter((i) => i.doneAt === null).length;
  const ticked = items.length - openCount;
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  return (
    <View style={styles.section}>
      <SectionTitle title={title} right={<Text style={[styles.count, { color: c.muted }]}>{openCount} left</Text>} />
      <Group>
        {items.map((item, i) => (
          <ListItemRow key={item.id} text={item.text} done={item.doneAt !== null} first={i === 0} onToggle={() => void onToggle(item)} onDelete={() => void onDelete(item)} />
        ))}
        <View style={[styles.listAdd, items.length ? { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth } : null]}>
          <Icon name="add" size={18} color={c.faint} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Add to ${name}`}
            placeholderTextColor={c.faint}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={async () => {
              if (!text.trim()) return;
              await onAdd(text.trim());
              setText('');
            }}
            style={[styles.addInput, { color: c.ink }]}
            accessibilityLabel={`Add to the ${name} list`}
          />
        </View>
      </Group>
      <View style={styles.listActions}>
        {ticked ? <Button label={`Clear ${ticked} ticked`} kind="plain" onPress={() => void onClear()} /> : null}
        {openCount === 0 ? <Button label="Delete list" kind="danger" onPress={() => void onDeleteList()} /> : null}
      </View>
    </View>
  );
}

function NewList({ onCreate }: { onCreate: (name: string) => void | Promise<void> }) {
  const c = usePalette();
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <Button label="Start a new list" icon="add" style={styles.left} onPress={() => setOpen(true)} />;
  return (
    <View style={[styles.add, { backgroundColor: c.surface, borderColor: c.accent }]}>
      <TextInput
        value={name}
        onChangeText={setName}
        autoFocus
        placeholder="Name it, like packing or gifts"
        placeholderTextColor={c.muted}
        returnKeyType="done"
        onSubmitEditing={() => {
          const clean = name.trim().toLowerCase().replace(/\s*list$/, '');
          if (clean) void onCreate(clean);
          setName('');
          setOpen(false);
        }}
        style={[styles.addInput, { color: c.ink }]}
        accessibilityLabel="New list name"
      />
      <Button label="Cancel" kind="plain" onPress={() => setOpen(false)} />
    </View>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  const c = usePalette();
  return (
    <View style={styles.empty}>
      <EmptyArt color={c.claySoft} accent={c.accent} size={130} />
      <Text style={[styles.emptyTitle, { color: c.ink }]}>{title}</Text>
      <Body muted style={{ textAlign: 'center' }}>
        {text}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Space.l },
  stack: { gap: Space.l },
  section: { gap: Space.s },
  count: { fontSize: 13, fontWeight: '700' },
  left: { alignSelf: 'flex-start' },
  listActions: { flexDirection: 'row', gap: Space.l, flexWrap: 'wrap' },
  note: { fontSize: 13.5, paddingHorizontal: 4 },
  add: { flexDirection: 'row', alignItems: 'center', gap: Space.s, borderRadius: Radius.pill, borderWidth: 1, paddingLeft: Space.l, paddingRight: 6, minHeight: 50 },
  addInput: { flex: 1, fontSize: 16, paddingVertical: 12, outlineWidth: 0 },
  addSend: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  listAdd: { flexDirection: 'row', alignItems: 'center', gap: Space.m, paddingLeft: 5 },
  empty: { alignItems: 'center', gap: Space.s, paddingVertical: Space.xl, paddingHorizontal: Space.l },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
});
