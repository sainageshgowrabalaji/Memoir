import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_BY_ID, type CategoryId } from '@/brain/categories';
import type { Scope } from '@/brain/analyze';
import { CaptureBox } from '@/components/capture-box';
import { ItemCard } from '@/components/item-card';
import { Body, Chip, Label, Notice, Title } from '@/components/ui';
import { MaxContentWidth, Space } from '@/constants/theme';
import { fromYourPast, listItems, saveCapture, shelves, type Item, type Shelf } from '@/db/repo';
import { usePalette, useShelfColor } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { ago, byDay, longDate } from '@/lib/format';
import { savedMessage } from '@/lib/messages';
import { askForReminders, remindersAllowed, syncReminders } from '@/lib/reminders';

type Filter = { scope?: Scope; category?: CategoryId };

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

  const load = useCallback(async () => {
    const [list, shelfCounts, memory] = await Promise.all([
      listItems(db, { scope: filter.scope ?? null, category: filter.category ?? null, limit: 200 }),
      shelves(db),
      fromYourPast(db),
    ]);
    setItems(list);
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

  async function save(text: string, photoUri: string | null) {
    const saved = await saveCapture(db, { text, photoUri });
    let remindersOn = true;
    if (saved.todo) {
      remindersOn = (await remindersAllowed()) || (await askForReminders());
      if (remindersOn) await syncReminders(db);
    }
    setMessage(savedMessage(saved, remindersOn, Date.now()));
    await load();
  }

  const total = counts.reduce((sum, s) => sum + s.count, 0);
  const top = counts.filter((s) => s.category !== 'notes').slice(0, 3).map((s) => CATEGORY_BY_ID[s.category].label);
  const sections = useMemo(() => byDay(items), [items]);
  const filtered = Boolean(filter.scope || filter.category);

  const header = (
    <View style={styles.header}>
      <View>
        <Title>Memoir</Title>
        <Body muted>{today || ' '}</Body>
      </View>
      <CaptureBox onSave={save} />
      {message ? <Notice tone="success">{message}</Notice> : null}

      {total >= 5 && top.length ? (
        <Body muted style={styles.insight}>
          You save most about {top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}` : top[0]}.
        </Body>
      ) : null}

      {total > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All" selected={!filtered} onPress={() => setFilter({})} />
          <Chip label="Personal" selected={filter.scope === 'personal'} onPress={() => setFilter({ scope: 'personal' })} />
          <Chip label="Public" selected={filter.scope === 'public'} onPress={() => setFilter({ scope: 'public' })} />
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
                  Paste an Instagram link, write down what a friend recommended, or say “Remind me to call Amma on Sunday at 7 pm”.
                  Memoir sorts it, and you can ask for it later in your own words.
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Space.l, paddingBottom: 120, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { gap: Space.l, paddingTop: Space.l, paddingBottom: Space.s },
  insight: { fontSize: 14.5 },
  chips: { gap: 8, paddingRight: Space.l },
  past: { gap: Space.s },
  dayHeader: { paddingTop: Space.l, paddingBottom: Space.s },
  cardWrap: { marginBottom: Space.s + 2 },
  empty: { gap: Space.s, paddingVertical: Space.xl },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
});
