// Today. A greeting, one place to tell Memoir anything, what today holds, and your day in a line or
// two. Nothing to learn: talk to it the way you would to a friend who keeps your notes.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HeaderArt } from '@/components/art';
import { DiaryCard } from '@/components/diary-card';
import { Group, HabitRow, SectionTitle, TodoRow } from '@/components/rows';
import { TellBox } from '@/components/tell-box';
import { Body, Button, IconButton, Screen, Title, Toast, tap } from '@/components/ui';
import { Fonts, Radius, Space } from '@/constants/theme';
import {
  dismissHabitSuggestion,
  habitSuggestion,
  habitsToday,
  loadLearned,
  moveTodo,
  setHabitDone,
  tellAs,
  type HabitToday,
} from '@/db/assistant';
import { deleteTodo, listTodos, setTodoDone, type Todo } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged, useDataChanged } from '@/lib/events';
import { syncReminders } from '@/lib/reminders';

function greeting(hour: number) {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function endOfDay(t: number, plusDays = 0) {
  const d = new Date(t);
  d.setDate(d.getDate() + plusDays);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export default function TodayScreen() {
  const db = useDb();
  const c = usePalette();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [habits, setHabits] = useState<HabitToday[]>([]);
  const [tomorrow, setTomorrow] = useState(0);
  const [anytime, setAnytime] = useState(0);
  const [suggestion, setSuggestion] = useState<{ word: string; days: number } | null>(null);
  const [times, setTimes] = useState<Record<string, [number, number]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const at = Date.now();
    const [open, closed, habitList, idea, learned] = await Promise.all([
      listTodos(db, true),
      listTodos(db, false),
      habitsToday(db, new Date(at)),
      habitSuggestion(db, new Date(at)),
      loadLearned(db),
    ]);
    // What you ticked today stays, crossed out, so the day shows what you got done.
    const doneToday = closed.filter((t) => t.doneAt !== null && t.doneAt > endOfDay(at, -1)).reverse();
    setTodos([...open.filter((t) => t.dueAt !== null && t.dueAt <= endOfDay(at)), ...doneToday]);
    setTomorrow(open.filter((t) => t.dueAt !== null && t.dueAt > endOfDay(at) && t.dueAt <= endOfDay(at, 1)).length);
    setAnytime(open.filter((t) => t.dueAt === null).length);
    setHabits(habitList.filter((h) => h.dueToday));
    setSuggestion(idea);
    setTimes(learned.times);
    setNow(at);
    setLoaded(true);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useDataChanged(load);

  async function changed() {
    dataChanged();
    await syncReminders(db).catch(() => 0);
  }

  const hour = new Date(now).getHours();
  const nothingToday = loaded && todos.length === 0 && habits.length === 0;
  const doneHabits = habits.filter((h) => h.doneToday).length;

  return (
    <Screen
      background={
        <View style={styles.art} pointerEvents="none">
          <HeaderArt hour={hour} />
        </View>
      }>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 4 }}>
          <Title>{greeting(hour)}</Title>
          <Body muted>{new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</Body>
        </View>
        <IconButton icon="settings-outline" label="Settings and backup" onPress={() => router.push('/settings')} />
      </View>

      <TellBox />
      <Toast text={message} onDone={() => setMessage(null)} />

      {suggestion ? (
        <View style={[styles.suggest, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Text style={[styles.suggestText, { color: c.ink }]}>
            You wrote about {suggestion.word} on {suggestion.days} days lately. Make it a habit you can tick each day?
          </Text>
          <View style={styles.row}>
            <Button
              label="Make it a habit"
              kind="soft"
              onPress={async () => {
                const reply = await tellAs(db, `${suggestion.word} every day`, 'habit');
                setMessage(reply.text);
                await changed();
              }}
            />
            <Button
              label="Not now"
              kind="plain"
              onPress={async () => {
                await dismissHabitSuggestion(db, suggestion.word);
                setSuggestion(null);
              }}
            />
          </View>
        </View>
      ) : null}

      <View style={{ gap: Space.s }}>
        <SectionTitle
          title="Today"
          right={
            habits.length ? (
              <Text style={[styles.count, { color: c.muted }]}>
                {doneHabits} of {habits.length} habits
              </Text>
            ) : null
          }
        />
        {nothingToday ? (
          <View style={[styles.clear, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Text style={[styles.clearTitle, { color: c.ink }]}>Nothing due today.</Text>
            <Body muted>
              {anytime
                ? `${anytime} ${anytime === 1 ? 'thing waits' : 'things wait'} on your list for whenever.`
                : 'Tell Memoir what you need to remember, and it will remind you.'}
            </Body>
          </View>
        ) : loaded ? (
          <Group>
            {todos.map((todo, i) => (
              <TodoRow
                key={`t${todo.id}`}
                todo={todo}
                now={now}
                first={i === 0}
                times={times}
                onDone={async (t, done) => {
                  await setTodoDone(db, t.id, done);
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
            {habits.map((habit, i) => (
              <HabitRow
                key={`h${habit.id}`}
                habit={habit}
                first={todos.length === 0 && i === 0}
                showWeek={false}
                onDone={async (h, done) => {
                  tap(done ? 'success' : 'light');
                  await setHabitDone(db, h.id, done);
                  await changed();
                }}
              />
            ))}
          </Group>
        ) : null}
        {loaded && (tomorrow || anytime) && !nothingToday ? (
          <Button
            label={[tomorrow ? `${tomorrow} tomorrow` : '', anytime ? `${anytime} for whenever` : ''].filter(Boolean).join(', ')}
            kind="plain"
            icon="chevron-forward"
            style={styles.left}
            onPress={() => router.navigate('/tasks')}
          />
        ) : null}
      </View>

      <DiaryCard onSaved={setMessage} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  art: { position: 'absolute', top: 0, right: 0 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.m, paddingTop: Space.xl, minHeight: 112 },
  suggest: { borderRadius: Radius.l, borderWidth: StyleSheet.hairlineWidth, padding: Space.l, gap: Space.m },
  suggestText: { fontSize: 15.5, lineHeight: 22, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.s, flexWrap: 'wrap' },
  count: { fontSize: 13, fontWeight: '600' },
  clear: { borderRadius: Radius.l, borderWidth: StyleSheet.hairlineWidth, padding: Space.l, gap: 4 },
  clearTitle: { fontFamily: Fonts.displayMedium, fontSize: 18, lineHeight: 24 },
  left: { alignSelf: 'flex-start' },
});
