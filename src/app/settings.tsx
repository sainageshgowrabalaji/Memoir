// Settings: reminders, what Memoir has learned about the way you talk, and backup. Everything here
// is about this phone only. Nothing is sent anywhere.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Label, Notice } from '@/components/ui';
import { Fonts, MaxContentWidth, Radius, Space } from '@/constants/theme';
import { forgetLearned, learnedSummary } from '@/db/assistant';
import { getSetting, setSetting } from '@/db/repo';
import { HELP_TEXT } from '@/brain/agent';
import { usePalette } from '@/hooks/use-palette';
import { restoreBackup, shareBackup } from '@/lib/backup';
import { useDb } from '@/lib/database';
import { dataChanged } from '@/lib/events';
import { longDate } from '@/lib/format';
import { askForReminders, remindersAllowed, syncReminders } from '@/lib/reminders';

export default function SettingsScreen() {
  const db = useDb();
  const c = usePalette();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [brief, setBrief] = useState(true);
  const [nudge, setNudge] = useState(true);
  const [learned, setLearned] = useState<string[]>([]);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'warn'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [ok, b, n, summary, last] = await Promise.all([
      remindersAllowed(),
      getSetting(db, 'morning_brief', 'on'),
      getSetting(db, 'diary_nudge', 'on'),
      learnedSummary(db),
      getSetting(db, 'last_backup', ''),
    ]);
    setAllowed(ok);
    setBrief(b === 'on');
    setNudge(n === 'on');
    setLearned(summary.lines);
    setLastBackup(last ? Number(last) : null);
  }, [db]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    try {
      await work();
    } catch {
      setMessage({ tone: 'warn', text: 'That did not work. Please try again.' });
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function toggle(key: 'morning_brief' | 'diary_nudge', on: boolean) {
    await setSetting(db, key, on ? 'on' : 'off');
    if (key === 'morning_brief') setBrief(on);
    else setNudge(on);
    await syncReminders(db).catch(() => 0);
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Text style={[styles.title, { color: c.ink }]}>Settings</Text>
          <Button label="Close" onPress={() => router.back()} />
        </View>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Label>Reminders</Label>
          {allowed === false && Platform.OS !== 'web' ? (
            <View style={{ gap: Space.s }}>
              <Body>Reminders are off for Memoir. Turn them on so it can nudge you when things are due.</Body>
              <Button
                label="Turn on reminders"
                kind="primary"
                style={styles.left}
                onPress={async () => {
                  if (await askForReminders()) await syncReminders(db).catch(() => 0);
                  await load();
                }}
              />
            </View>
          ) : null}
          <Toggle
            title="Morning brief"
            text="At 8 AM, what today holds. What is due, your habits, and anything waiting on your list."
            value={brief}
            onChange={(on) => void toggle('morning_brief', on)}
          />
          <View style={[styles.divider, { backgroundColor: c.line }]} />
          <Toggle
            title="Evening diary nudge"
            text="At 9:30 PM, a gentle “how was your day?”, skipped once you have written."
            value={nudge}
            onChange={(on) => void toggle('diary_nudge', on)}
          />
          <Body muted style={styles.small}>
            To-dos remind you when they are due, then again a day, three days and a week later until you tick them. Habits remind you at their time.
          </Body>
        </View>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Label>What Memoir has learned about you</Label>
          {learned.length ? (
            learned.map((line) => (
              <Body key={line} style={styles.small}>
                • {line}
              </Body>
            ))
          ) : (
            <Body muted>Nothing yet. When you tap “Not right?” on a reply, or move a reminder you set for “evening”, Memoir learns what you meant.</Body>
          )}
          <Body muted style={styles.small}>
            It learns only from you, on this phone. Nothing is uploaded, and no one else&apos;s data is mixed in.
          </Body>
          {learned.length ? (
            <Button
              label="Forget what it learned"
              kind="danger"
              style={styles.left}
              onPress={() =>
                void run('forget', async () => {
                  await forgetLearned(db);
                  setMessage({ tone: 'success', text: 'Forgotten. Memoir starts fresh with the way you talk.' });
                })
              }
            />
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Label>Backup</Label>
          <Body>
            Everything lives only on this phone. Keep a backup in iCloud Drive or Files, so a new phone never loses anything.
          </Body>
          <Body muted style={styles.small}>
            {lastBackup ? `Last backup ${longDate(lastBackup)}.` : 'No backup yet.'}
          </Body>
          <View style={styles.row}>
            <Button
              label="Save a backup"
              kind="primary"
              busy={busy === 'backup'}
              onPress={() =>
                void run('backup', async () => {
                  const { items } = await shareBackup(db);
                  await setSetting(db, 'last_backup', String(Date.now()));
                  setMessage({ tone: 'success', text: `Backup made with ${items} notes and diary days, plus your to-dos, lists and habits. Choose “Save to Files” to keep it.` });
                })
              }
            />
            <Button
              label="Restore"
              busy={busy === 'restore'}
              onPress={() =>
                void run('restore', async () => {
                  const result = await restoreBackup(db);
                  if (result.kind === 'backup') {
                    setMessage({ tone: 'success', text: `Restored ${result.added} things.${result.skipped ? ` ${result.skipped} were already here.` : ''}` });
                    dataChanged();
                    await syncReminders(db).catch(() => 0);
                  } else if (result.kind === 'not-a-backup') {
                    setMessage({ tone: 'warn', text: 'That file is not a Memoir backup.' });
                  }
                })
              }
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Label>Talking to Memoir</Label>
          <Body style={styles.small}>{HELP_TEXT}</Body>
          <Body muted style={styles.small}>
            To talk instead of typing, tap the text box on Today, then the mic on the keyboard. On iPhone, dictation works without the internet once your
            language is downloaded in Settings, General, Keyboard.
          </Body>
          <Body muted style={styles.small}>
            You can also say “move the dentist to Friday”, “delete the gym reminder”, “mark call dad as done”, “remove milk from the shopping list”, or just
            “undo”.
          </Body>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Toggle({ title, text, value, onChange }: { title: string; text: string; value: boolean; onChange: (on: boolean) => void }) {
  const c = usePalette();
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.toggleTitle, { color: c.ink }]}>{title}</Text>
        <Text style={[styles.toggleText, { color: c.muted }]}>{text}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.accent, false: c.sunken }} thumbColor={Platform.OS === 'android' ? c.surface : undefined} accessibilityLabel={title} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: Space.l, padding: Space.l, paddingBottom: Space.xxl * 2, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.m, paddingTop: Space.s },
  title: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 36 },
  card: { borderRadius: Radius.l, borderWidth: StyleSheet.hairlineWidth, padding: Space.l, gap: Space.m },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  left: { alignSelf: 'flex-start' },
  small: { fontSize: 14.5, lineHeight: 21 },
  divider: { height: StyleSheet.hairlineWidth },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Space.m },
  toggleTitle: { fontSize: 16, fontWeight: '600' },
  toggleText: { fontSize: 14, lineHeight: 19 },
});
