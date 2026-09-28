import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_BY_ID, type CategoryId } from '@/brain/categories';
import type { Scope } from '@/brain/analyze';
import { CaptureBox } from '@/components/capture-box';
import { CopiedLinkOffer } from '@/components/copied-link-offer';
import { DiaryCard } from '@/components/diary-card';
import { ItemCard } from '@/components/item-card';
import { Body, Chip, Label, Notice, Title } from '@/components/ui';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { countToCheck, fromYourPast, interests, listItems, saveCapture, shelves, type Item, type Shelf } from '@/db/repo';
import { usePalette, useShelfColor } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dataChanged, useDataChanged } from '@/lib/events';
import { ago, byDay, longDate } from '@/lib/format';
import { savedMessage } from '@/lib/messages';
import { readPendingPages } from '@/lib/page-sync';
import { askForReminders, remindersAllowed, syncReminders } from '@/lib/reminders';

type Filter = { scope?: Scope; category?: CategoryId; kind?: 'diary' };

export default function HomeScreen() {
  const db = useDb();
  const c = usePalette();
  const shelfColor = useShelfColor();
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Shelf[]>([]);
  const [past, setPast] = useState<Item | null>(null);
  const [filter, setFilter] = useState<Filter>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [today, setToday] = useState('');
  const [toCheck, setToCheck] = useState(0);
  const [lately, setLately] = useState<Awaited<ReturnType<typeof interests>> | null>(null);

  const load = useCallback(async () => {
    const [list, shelfCounts, memory, waiting] = await Promise.all([
      listItems(db, { scope: filter.scope ?? null, category: filter.category ?? null, kind: filter.kind ?? null, limit: 200 }),
      shelves(db),
      fromYourPast(db),
      countToCheck(db),
    ]);
    setLately(await interests(db));
    setItems(list);
    setToCheck(waiting);
    setCounts(shelfCounts);
    setPast(memory);
    setToday(longDate(Date.now()));
    setLoaded(true);
  }, [db, filter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useDataChanged(load);

  async function save(text: string, photoUri: string | null) {
    const saved = await saveCapture(db, { text, photoUri });
    let remindersOn = true;
    if (saved.todo || saved.item.checkState === 'to_check') {
      remindersOn = (await remindersAllowed()) || (await askForReminders());
      if (remindersOn) await syncReminders(db);
    }
    setMessage(savedMessage(saved, remindersOn, Date.now()));
    dataChanged();
    // Read the reel or page now, while you are still here. The card fills in when it is done.
    if (saved.item.page.status === 'pending') void readPendingPages(db);
  }

  const total = counts.reduce((sum, s) => sum + s.count, 0);
  const top = counts.filter((s) => s.category !== 'notes').slice(0, 3).map((s) => CATEGORY_BY_ID[s.category].label);
  const sections = useMemo(() => byDay(items), [items]);
  const filtered = Boolean(filter.scope || filter.category || filter.kind);

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Title>Memoir</Title>
          <Body muted>{today || ' '}</Body>
        </View>
        <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Backup and help" hitSlop={10}>
          <Text style={[styles.more, { color: c.accent }]}>Backup</Text>
        </Pressable>
      </View>
      <CopiedLinkOffer onSave={(link) => save(link, null)} />
      <CaptureBox onSave={save} />
      {message ? <Notice tone="success">{message}</Notice> : null}

      {toCheck > 0 ? (
        <Pressable
          onPress={() => router.navigate('/todos')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.waiting, { backgroundColor: c.warnSoft, borderColor: c.warn }, pressed && { opacity: 0.8 }]}>
          <Text style={[styles.waitingText, { color: c.warn }]}>
            {toCheck === 1 ? '1 saved link is waiting for you to check it' : `${toCheck} saved links are waiting for you to check them`}
          </Text>
          <Text style={[styles.waitingGo, { color: c.warn }]}>Open</Text>
        </Pressable>
      ) : null}

      {!filtered ? <DiaryCard /> : null}

      {total >= 5 && top.length ? (
        <View style={{ gap: 2 }}>
          <Body muted style={styles.insight}>
            You save most about {joinAnd(top)}.
          </Body>
          {lately && (lately.tags.length || lately.authors.length) ? (
            <Body muted style={styles.insight}>
              Lately into {[...lately.tags.slice(0, 3).map((t) => `#${t}`), ...lately.authors.slice(0, 2)].join('  ')}
            </Body>
          ) : null}
        </View>
      ) : null}

      {total > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All" selected={!filtered} onPress={() => setFilter({})} />
          <Chip label="Personal" selected={filter.scope === 'personal'} onPress={() => setFilter({ scope: 'personal' })} />
          <Chip label="Public" selected={filter.scope === 'public'} onPress={() => setFilter({ scope: 'public' })} />
          <Chip label="Diary" selected={filter.kind === 'diary'} onPress={() => setFilter({ kind: 'diary' })} />
          {counts.map((s) => (
            <Chip
              key={s.category}
              label={CATEGORY_BY_ID[s.category].label}
              count={s.count}
              dot={shelfColor(s.category)}
              selected={filter.category === s.category}
              onPress={() => setFilter({ category: s.category })}
            />
          ))}
        </ScrollView>
      ) : null}

      {past && !filtered ? (
        <View style={styles.past}>
          <Label>From your past · {ago(past.createdAt)}</Label>
          <ItemCard item={past} />
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: c.background }]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <View style={[styles.dayHeader, { backgroundColor: c.background }]}>
            <Label>{section.title}</Label>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ItemCard item={item} />
          </View>
        )}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: c.ink }]}>{filtered ? 'Nothing on this shelf yet.' : 'Your first memory goes here.'}</Text>
              {!filtered ? (
                <Body muted>
                  Copy a reel link in Instagram and open Memoir, write down what a friend recommended, or say “Remind me to call Amma on
                  Sunday at 7 pm”. Memoir sorts it, reads what a reel is about, and keeps reminding you until you have looked at it.
                </Body>
              ) : null}
            </View>
          ) : null
        }
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

function joinAnd(words: string[]) {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Space.l, paddingBottom: 120, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { gap: Space.l, paddingTop: Space.l, paddingBottom: Space.s },
  insight: { fontSize: 14.5 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.m },
  more: { fontSize: 15, fontWeight: '700', paddingTop: 10 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: Space.m, borderWidth: 1, borderRadius: Radius.m, padding: Space.m },
  waitingText: { flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  waitingGo: { fontSize: 15, fontWeight: '800' },
  chips: { gap: 8, paddingRight: Space.l },
  past: { gap: Space.s },
  dayHeader: { paddingTop: Space.l, paddingBottom: Space.s },
  cardWrap: { marginBottom: Space.s + 2 },
  empty: { gap: Space.s, paddingVertical: Space.xl },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
});
