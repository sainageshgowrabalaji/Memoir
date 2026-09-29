// Talking to Memoir. Type, or tap the mic on the keyboard and just say it. Memoir works out whether
// it is a reminder, a list, a habit, your day or a question, does it, and says what it did. If it
// got it wrong, one tap undoes it, or moves it where you meant, and Memoir learns from that.
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon, tap, type IconName } from '@/components/ui';
import { Fonts, Radius, Space } from '@/constants/theme';
import { correct, tell, undoLast, type Reply } from '@/db/assistant';
import type { Correctable } from '@/brain/agent';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged } from '@/lib/events';
import { askForReminders, remindersAllowed, syncReminders } from '@/lib/reminders';

const KIND: Record<Reply['kind'], { icon: IconName; label: string }> = {
  todo: { icon: 'alarm-outline', label: 'Reminder' },
  event: { icon: 'calendar-outline', label: 'On your calendar' },
  list: { icon: 'basket-outline', label: 'List' },
  habit: { icon: 'repeat-outline', label: 'New habit' },
  diary: { icon: 'moon-outline', label: 'Diary' },
  done: { icon: 'checkmark-circle-outline', label: 'Done' },
  note: { icon: 'document-text-outline', label: 'Note' },
  question: { icon: 'chatbubble-ellipses-outline', label: 'Answer' },
  undo: { icon: 'arrow-undo-outline', label: 'Undone' },
  cancel: { icon: 'trash-outline', label: 'Removed' },
  move: { icon: 'time-outline', label: 'Moved' },
  unlist: { icon: 'basket-outline', label: 'List' },
  chat: { icon: 'sparkles-outline', label: 'Memoir' },
};

const SWITCH: { kind: Correctable; label: string }[] = [
  { kind: 'todo', label: 'To-do' },
  { kind: 'diary', label: 'Diary' },
  { kind: 'note', label: 'Note' },
  { kind: 'list', label: 'List' },
];

const IDEAS: { label: string; fill?: string; send?: string }[] = [
  { label: "What's on today?", send: "What's on today?" },
  { label: 'Remind me to…', fill: 'Remind me to ' },
  { label: 'Shopping list', fill: 'Buy ' },
  { label: 'How was my week?', send: 'What did I do this week?' },
];

const REMINDS = new Set<Reply['kind']>(['todo', 'event', 'habit', 'move']);

export function TellBox({ onReply }: { onReply?: (reply: Reply) => void }) {
  const db = useDb();
  const c = usePalette();
  const input = useRef<TextInput>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [said, setSaid] = useState('');
  const [switching, setSwitching] = useState(false);
  const [focused, setFocused] = useState(false);

  async function after(next: Reply) {
    setReply(next);
    setSwitching(false);
    onReply?.(next);
    dataChanged();
    if (REMINDS.has(next.kind) && !(await remindersAllowed())) await askForReminders();
    await syncReminders(db).catch(() => 0);
  }

  async function send(value = text) {
    const clean = value.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const next = await tell(db, clean);
      tap(next.kind === 'question' || next.kind === 'chat' ? 'light' : 'success');
      setSaid(clean);
      setText('');
      await after(next);
    } finally {
      setBusy(false);
    }
  }

  async function switchTo(kind: Correctable) {
    if (!reply) return;
    tap('success');
    await after(await correct(db, reply.logId, kind));
  }

  async function undo() {
    tap();
    const message = await undoLast(db);
    setReply({ logId: -1, text: message, kind: 'undo', sources: [], correctable: false });
    setSwitching(false);
    dataChanged();
    await syncReminders(db).catch(() => 0);
  }

  const ready = text.trim().length > 0;
  const look = reply ? KIND[reply.kind] : null;
  const canUndo = reply && !['question', 'chat', 'undo'].includes(reply.kind) && reply.logId > 0;

  return (
    <View style={{ gap: Space.m }}>
      <View style={[styles.box, { backgroundColor: c.surface, borderColor: focused ? c.accent : c.line, shadowColor: c.shadow }]}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Tell me anything. A reminder, a list, your day, or a question."
          placeholderTextColor={c.muted}
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="send"
          onSubmitEditing={() => void send()}
          style={[styles.input, { color: c.ink }]}
          accessibilityLabel="Tell Memoir anything"
        />
        <View style={styles.bottom}>
          <View style={styles.hint}>
            <Icon name="mic-outline" size={16} color={c.muted} />
            <Text style={[styles.hintText, { color: c.muted }]} numberOfLines={1}>
              Keyboard mic to talk
            </Text>
          </View>
          <Pressable
            onPress={() => void send()}
            disabled={!ready || busy}
            accessibilityRole="button"
            accessibilityLabel="Send"
            hitSlop={8}
            style={({ pressed }) => [styles.send, { backgroundColor: ready ? c.accent : c.sunken }, pressed && { opacity: 0.8 }]}>
            <Icon name="arrow-up" size={20} color={ready ? c.onAccent : c.faint} />
          </Pressable>
        </View>
      </View>

      {!reply && !text ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ideas} keyboardShouldPersistTaps="handled">
          {IDEAS.map((idea) => (
            <Pressable
              key={idea.label}
              onPress={() => {
                tap();
                if (idea.send) void send(idea.send);
                else if (idea.fill) {
                  setText(idea.fill);
                  input.current?.focus();
                }
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.idea, { backgroundColor: c.surface, borderColor: c.line }, pressed && { opacity: 0.7 }]}>
              <Text style={[styles.ideaText, { color: c.body }]}>{idea.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {reply && look ? (
        <View style={[styles.reply, { backgroundColor: c.accentSoft }]} accessibilityLiveRegion="polite">
          <View style={styles.replyHead}>
            <View style={[styles.kindPill, { backgroundColor: c.surface }]}>
              <Icon name={look.icon} size={14} color={c.accent} />
              <Text style={[styles.kindText, { color: c.accent }]}>{look.label}</Text>
            </View>
            <Pressable onPress={() => setReply(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={18} color={c.muted} />
            </Pressable>
          </View>
          {said && reply.kind !== 'undo' ? (
            <Text style={[styles.said, { color: c.muted }]} numberOfLines={2}>
              “{said}”
            </Text>
          ) : null}
          <Text style={[styles.replyText, { color: c.ink }]}>{reply.text}</Text>

          {reply.sources.length ? (
            <View style={{ gap: 6 }}>
              {reply.sources.slice(0, 3).map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(item.id) } })}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.source, { backgroundColor: c.surface }, pressed && { opacity: 0.7 }]}>
                  <Icon name={item.kind === 'diary' ? 'moon-outline' : 'document-text-outline'} size={15} color={c.accent} />
                  <Text style={[styles.sourceText, { color: c.body }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Icon name="chevron-forward" size={15} color={c.faint} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {canUndo || reply.correctable ? (
            <View style={styles.actions}>
              {canUndo ? <Small label="Undo" icon="arrow-undo-outline" onPress={() => void undo()} /> : null}
              {reply.correctable ? <Small label={switching ? 'It was a…' : 'Not right?'} icon="swap-horizontal-outline" onPress={() => setSwitching((s) => !s)} /> : null}
            </View>
          ) : null}
          {switching ? (
            <View style={styles.switchRow}>
              {SWITCH.filter((s) => s.kind !== reply.kind).map((s) => (
                <Pressable
                  key={s.kind}
                  onPress={() => void switchTo(s.kind)}
                  accessibilityRole="button"
                  accessibilityLabel={`It was a ${s.label}`}
                  style={({ pressed }) => [styles.switch, { backgroundColor: c.surface, borderColor: c.accent }, pressed && { opacity: 0.7 }]}>
                  <Text style={[styles.switchText, { color: c.accent }]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Small({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6} style={({ pressed }) => [styles.small, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={15} color={c.accent} />
      <Text style={[styles.smallText, { color: c.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingHorizontal: Space.l + 2,
    paddingTop: Space.m,
    paddingBottom: Space.s + 2,
    gap: Space.s,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 2,
  },
  input: { fontSize: 17, lineHeight: 23, minHeight: 56, maxHeight: 160, textAlignVertical: 'top', paddingTop: 4, outlineWidth: 0 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  hintText: { fontSize: 13, fontWeight: '500' },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  ideas: { gap: Space.s, paddingRight: Space.l },
  idea: { paddingHorizontal: 14, minHeight: 36, borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  ideaText: { fontSize: 14, fontWeight: '600' },
  reply: { borderRadius: Radius.l, padding: Space.l, gap: Space.s + 2 },
  replyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kindPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill },
  kindText: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.2 },
  said: { fontSize: 14, fontStyle: 'italic' },
  replyText: { fontFamily: Fonts.displayMedium, fontSize: 18, lineHeight: 25 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: Radius.s, paddingHorizontal: 12, paddingVertical: 9 },
  sourceText: { flex: 1, fontSize: 14.5, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: Space.l, paddingTop: 2 },
  small: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32 },
  smallText: { fontSize: 14.5, fontWeight: '600' },
  switchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  switch: { paddingHorizontal: 14, minHeight: 34, borderRadius: Radius.pill, borderWidth: 1, justifyContent: 'center' },
  switchText: { fontSize: 14, fontWeight: '700' },
});
