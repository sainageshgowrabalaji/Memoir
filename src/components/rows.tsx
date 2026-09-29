// The rows every list in Memoir is made of: a to-do, a habit, a list item, a note. Each sits in a
// soft card with its neighbours, with one round tick on the left, so every list reads the same way.
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { moveChoices } from '@/brain/reminders';
import { CheckCircle, Icon, tap } from '@/components/ui';
import { Radius, Space } from '@/constants/theme';
import type { HabitToday } from '@/db/assistant';
import type { Item, Todo } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { dayLabel, timeLabel } from '@/lib/format';

/** Rows grouped in one soft card. */
export function Group({ children }: { children: ReactNode }) {
  const c = usePalette();
  return <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.line, shadowColor: c.shadow }]}>{children}</View>;
}

/** A small heading over a group, with an optional count or action on the right. */
export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  const c = usePalette();
  return (
    <View style={styles.sectionTitle}>
      <Text style={[styles.sectionText, { color: c.muted }]}>{title.toUpperCase()}</Text>
      {right}
    </View>
  );
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "7:00 PM", "Tomorrow, 9:00 AM", "Fri, 3:00 PM", "Oct 28", or how late it is. */
export function dueText(dueAt: number | null, now: number): { text: string; late: boolean } {
  if (dueAt === null) return { text: '', late: false };
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY);
  const time = timeLabel(dueAt);
  if (dueAt < now) {
    if (days === 0) return { text: `Earlier today, ${time}`, late: true };
    const late = -days;
    return { text: late === 1 ? 'Yesterday' : `${late} days late`, late: true };
  }
  if (days === 0) return { text: time, late: false };
  if (days === 1) return { text: `Tomorrow, ${time}`, late: false };
  const d = new Date(dueAt);
  if (days < 7) return { text: `${d.toLocaleDateString([], { weekday: 'short' })}, ${time}`, late: false };
  return { text: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), late: false };
}

type TodoRowProps = {
  todo: Todo & { repeat?: string | null };
  now: number;
  first?: boolean;
  times?: Record<string, [number, number]>;
  onDone: (todo: Todo, done: boolean) => void;
  onMove?: (todo: Todo, at: number) => void;
  onDelete?: (todo: Todo) => void;
};

/** A to-do. Tap the circle when it is done. Tap the words to move it or delete it. */
export function TodoRow({ todo, now, first, times, onDone, onMove, onDelete }: TodoRowProps) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  const done = todo.doneAt !== null;
  const due = dueText(todo.dueAt, now);
  const canEdit = !done && (onMove || onDelete);
  return (
    <View style={[styles.rowWrap, !first && { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.row}>
        <CheckCircle done={done} onPress={() => onDone(todo, !done)} label={done ? `Mark ${todo.title} not done` : `Mark ${todo.title} done`} />
        <Pressable
          onPress={() => {
            if (!canEdit) return;
            tap();
            setOpen((o) => !o);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${todo.title}${due.text ? `, ${due.text}` : ''}`}
          accessibilityHint={canEdit ? 'Shows ways to move or delete it' : undefined}
          style={styles.main}>
          <Text style={[styles.title, { color: done ? c.muted : c.ink }, done && styles.struck]} numberOfLines={2}>
            {todo.title}
          </Text>
          {due.text || todo.repeat ? (
            <View style={styles.metaRow}>
              {due.text ? <Text style={[styles.meta, { color: due.late && !done ? c.clay : c.muted }]}>{due.text}</Text> : null}
              {todo.repeat ? <Icon name="repeat" size={13} color={c.muted} /> : null}
            </View>
          ) : null}
        </Pressable>
        {canEdit ? <Icon name={open ? 'chevron-up' : 'ellipsis-horizontal'} size={16} color={c.faint} /> : null}
      </View>
      {open ? (
        <View style={styles.tray}>
          {onMove
            ? moveChoices(now, times).map((choice) => (
                <TrayButton
                  key={choice.key}
                  label={choice.label}
                  onPress={() => {
                    setOpen(false);
                    onMove(todo, choice.at);
                  }}
                />
              ))
            : null}
          {onDelete ? (
            <TrayButton
              label="Delete"
              danger
              onPress={() => {
                setOpen(false);
                onDelete(todo);
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function TrayButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      style={({ pressed }) => [styles.trayButton, { backgroundColor: danger ? c.dangerSoft : c.sunken }, pressed && { opacity: 0.7 }]}>
      <Text style={[styles.trayText, { color: danger ? c.danger : c.body }]}>{label}</Text>
    </Pressable>
  );
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function scheduleText(h: { days: number[]; hour: number | null; minute: number }): string {
  const days =
    h.days.length === 7 ? 'Every day' : h.days.join() === '1,2,3,4,5' ? 'Weekdays' : h.days.join() === '0,6' ? 'Weekends' : h.days.map((d) => DAY_NAMES[d]).join(', ');
  if (h.hour === null) return days;
  return `${days}, ${new Date(2000, 0, 1, h.hour, h.minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** A habit: tick for today, when it is planned, the run of days kept, and the last seven days. */
export function HabitRow({
  habit,
  first,
  onDone,
  onStop,
  showWeek = true,
}: {
  habit: HabitToday;
  first?: boolean;
  onDone: (habit: HabitToday, done: boolean) => void;
  onStop?: (habit: HabitToday) => void;
  showWeek?: boolean;
}) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.rowWrap, !first && { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.row}>
        <CheckCircle done={habit.doneToday} onPress={() => onDone(habit, !habit.doneToday)} label={`${habit.name} today`} />
        <Pressable
          onPress={() => {
            if (!onStop) return;
            tap();
            setOpen((o) => !o);
          }}
          accessibilityRole="button"
          style={styles.main}>
          <Text style={[styles.title, { color: c.ink }]} numberOfLines={2}>
            {habit.name}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, { color: c.muted }]}>{scheduleText(habit)}</Text>
            {habit.streak > 1 ? (
              <Text style={[styles.meta, { color: c.accent }]}>
                {'  ·  '}
                {habit.streak} days in a row
              </Text>
            ) : null}
          </View>
        </Pressable>
        {showWeek ? (
          <View style={styles.week} accessibilityLabel={`Done ${habit.week.filter(Boolean).length} of the last 7 days`}>
            {habit.week.map((on, i) => (
              <View key={i} style={[styles.weekDot, { backgroundColor: on ? c.success : c.sunken }]} />
            ))}
          </View>
        ) : null}
      </View>
      {open && onStop ? (
        <View style={styles.tray}>
          <TrayButton
            label="Stop this habit"
            danger
            onPress={() => {
              setOpen(false);
              onStop(habit);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/** One thing on a list, like "milk". */
export function ListItemRow({ text, done, first, onToggle, onDelete }: { text: string; done: boolean; first?: boolean; onToggle: () => void; onDelete: () => void }) {
  const c = usePalette();
  return (
    <View style={[styles.row, styles.rowWrap, !first && { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <CheckCircle done={done} onPress={onToggle} label={done ? `Put ${text} back` : `Tick ${text}`} />
      <Text style={[styles.title, styles.main, { color: done ? c.muted : c.ink }, done && styles.struck]} numberOfLines={2}>
        {text}
      </Text>
      <Pressable onPress={onDelete} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${text}`}>
        <Icon name="close" size={17} color={c.faint} />
      </Pressable>
    </View>
  );
}

/** A note or a diary day: the first lines in your words, and when. */
export function NoteRow({ item, first, when = 'day' }: { item: Item; first?: boolean; when?: 'day' | 'time' }) {
  const c = usePalette();
  const words = item.text.replace(/\s+/g, ' ').trim() || item.title;
  const stamp = when === 'day' ? dayLabel(item.createdAt) : timeLabel(item.createdAt);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(item.id) } })}
      accessibilityRole="button"
      style={({ pressed }) => [styles.note, !first && { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}>
      <Text style={[styles.noteText, { color: c.ink }]} numberOfLines={3}>
        {words}
      </Text>
      <View style={styles.metaRow}>
        {item.url ? <Icon name="link" size={13} color={c.muted} /> : null}
        {item.photoUri ? <Icon name="image-outline" size={13} color={c.muted} /> : null}
        <Text style={[styles.meta, { color: c.muted }]}>{stamp}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: Radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space.m + 2,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 1,
  },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, minHeight: 28 },
  sectionText: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.8 },
  rowWrap: { paddingVertical: Space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.m },
  main: { flex: 1, gap: 3 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '500' },
  struck: { textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { fontSize: 13, fontWeight: '500' },
  tray: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s, paddingTop: Space.m, paddingLeft: 40 },
  trayButton: { paddingHorizontal: 12, minHeight: 34, borderRadius: Radius.pill, justifyContent: 'center' },
  trayText: { fontSize: 13.5, fontWeight: '600' },
  week: { flexDirection: 'row', gap: 3 },
  weekDot: { width: 7, height: 7, borderRadius: 4 },
  note: { paddingVertical: Space.m + 2, gap: 6 },
  noteText: { fontSize: 15.5, lineHeight: 22 },
});
