// Backup, bringing in old saves from WhatsApp and Instagram, reminders, and how to save quickly.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ImportedLink } from '@/brain/imports';
import { Body, Button, Chip, Label, Notice } from '@/components/ui';
import { Fonts, MaxContentWidth, Radius, Space } from '@/constants/theme';
import { BACKLOG_PER_DAY, countBacklog, getSetting, importLinks, promoteBacklog, setSetting } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { pickExport, restoreBackup, shareBackup } from '@/lib/backup';
import { useDb } from '@/lib/database';
import { dataChanged } from '@/lib/events';
import { longDate } from '@/lib/format';
import { readPendingPages } from '@/lib/page-sync';
import { syncReminders } from '@/lib/reminders';

type Found = { name: string; links: ImportedLink[] };

export default function SettingsScreen() {
  const db = useDb();
  const c = usePalette();
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [backlog, setBacklog] = useState(0);
  const [diaryNudge, setDiaryNudge] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'warn'; text: string } | null>(null);
  const [found, setFound] = useState<Found | null>(null);

  const load = useCallback(async () => {
    const [last, waiting, nudge] = await Promise.all([getSetting(db, 'last_backup', ''), countBacklog(db), getSetting(db, 'diary_nudge', 'on')]);
    setLastBackup(last ? Number(last) : null);
    setBacklog(waiting);
    setDiaryNudge(nudge === 'on');
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

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Text style={[styles.title, { color: c.ink }]}>Backup and more</Text>
          <Button label="Close" onPress={() => router.back()} />
        </View>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

        <View style={styles.section}>
          <Label>Backup</Label>
          <Body>
            Everything you save lives only on this phone. Keep a backup in iCloud Drive or Files, so a new phone or a
            reinstall never loses anything.
          </Body>
          <Body muted>{lastBackup ? `Last backup ${longDate(lastBackup)}.` : 'No backup yet.'}</Body>
          <View style={styles.row}>
            <Button
              label="Save a backup"
              kind="primary"
              busy={busy === 'backup'}
              onPress={() =>
                void run('backup', async () => {
                  const { items } = await shareBackup(db);
                  await setSetting(db, 'last_backup', String(Date.now()));
                  setMessage({ tone: 'success', text: `Backup made with ${items} saves. Choose "Save to Files" to keep it.` });
                })
              }
            />
            <Button
              label="Restore a backup"
              busy={busy === 'restore'}
              onPress={() =>
                void run('restore', async () => {
                  const result = await restoreBackup(db);
                  if (result.kind === 'backup') {
                    setMessage({ tone: 'success', text: `Restored ${result.added} saves.${result.skipped ? ` ${result.skipped} ${result.skipped === 1 ? 'was' : 'were'} already here.` : ''}` });
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

        <View style={styles.section}>
          <Label>Bring in old saves</Label>
          <Body>Links you sent to your own WhatsApp chat, or saved on Instagram, can all come into Memoir.</Body>
          <View style={[styles.steps, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Text style={[styles.stepTitle, { color: c.ink }]}>From WhatsApp</Text>
            <Body muted>Open the chat, tap its name, then Export Chat, then Without Media, then Save to Files.</Body>
            <Text style={[styles.stepTitle, { color: c.ink }]}>From Instagram</Text>
            <Body muted>
              Settings, then Accounts Center, then Your information and permissions, then Download your information. Pick only
              Saved, format JSON. Instagram emails you when the file is ready. Save it to Files.
            </Body>
          </View>
          {found ? (
            <View style={{ gap: Space.s }}>
              <Body>{found.links.length ? `Found ${found.links.length} links in ${found.name}.` : `No links found in ${found.name}.`}</Body>
              {found.links.length ? (
                <View style={styles.row}>
                  <Button
                    label="Bring them in"
                    kind="primary"
                    busy={busy === 'import'}
                    onPress={() =>
                      void run('import', async () => {
                        const { added, skipped } = await importLinks(db, found.links);
                        setFound(null);
                        await promoteBacklog(db);
                        setMessage({
                          tone: 'success',
                          text: `Brought in ${added} ${added === 1 ? 'link' : 'links'}${skipped ? `. ${skipped} ${skipped === 1 ? 'was' : 'were'} already saved` : ''}. ${BACKLOG_PER_DAY} come back each evening for you to check.`,
                        });
                        dataChanged();
                        await syncReminders(db).catch(() => 0);
                        void readPendingPages(db);
                      })
                    }
                  />
                  <Button label="Cancel" onPress={() => setFound(null)} />
                </View>
              ) : null}
            </View>
          ) : (
            <Button
              label="Choose the exported file"
              busy={busy === 'pick'}
              style={styles.left}
              onPress={() =>
                void run('pick', async () => {
                  const picked = await pickExport();
                  if (picked) setFound(picked);
                })
              }
            />
          )}
          {backlog ? (
            <View style={{ gap: Space.s }}>
              <Body muted>
                {backlog} old saves are waiting. {BACKLOG_PER_DAY} come back each evening.
              </Body>
              <Button
                label={`Show me ${BACKLOG_PER_DAY} more now`}
                style={styles.left}
                onPress={() =>
                  void run('more', async () => {
                    await promoteBacklog(db, new Date(), true);
                    dataChanged();
                    router.navigate('/todos');
                  })
                }
              />
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Label>Reminders</Label>
          <Body>Saved links to check come together at 8 PM. To-dos remind you when they are due.</Body>
          <Body>A diary nudge at 9:30 PM asks how your day was, unless you already wrote.</Body>
          <View style={styles.row}>
            {(['on', 'off'] as const).map((value) => (
              <Chip
                key={value}
                label={value === 'on' ? 'Diary nudge on' : 'Off'}
                selected={diaryNudge === (value === 'on')}
                onPress={async () => {
                  await setSetting(db, 'diary_nudge', value);
                  setDiaryNudge(value === 'on');
                  await syncReminders(db).catch(() => 0);
                }}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Label>Saving a reel in two taps</Label>
          <Body>In Instagram, tap Share on the reel, then Copy link. Open Memoir and tap Save it.</Body>
          <Body muted>
            To stop the iPhone asking every time, go to Settings, then Apps, then Expo Go, then Paste from Other Apps, and choose Allow.
          </Body>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: Space.xl, padding: Space.l, paddingBottom: Space.xxl * 2, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.m },
  title: { fontFamily: Fonts.serif, fontSize: 26, fontWeight: '600' },
  section: { gap: Space.s },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  steps: { borderWidth: 1, borderRadius: Radius.m, padding: Space.m, gap: 6 },
  stepTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  left: { alignSelf: 'flex-start' },
});
