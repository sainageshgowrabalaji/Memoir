import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { parseQuery, type Query } from '@/brain/query';
import { ItemCard } from '@/components/item-card';
import { Body, Button, Chip, Label, Notice, Title } from '@/components/ui';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { knownPeople, search, type Found } from '@/db/repo';
import { usePalette } from '@/hooks/use-palette';
import { useDb } from '@/lib/database';
import { dayLabel } from '@/lib/format';

const EXAMPLES = [
  'That reel about a hiking trail',
  'Links I saved last week',
  'What did Amma say about Diwali',
  'Photos from yesterday',
  'The recipe from March',
  'Something about saving money',
];

type Answer = { question: string; query: Query; found: Found[]; loose: boolean };

export default function AskScreen() {
  const db = useDb();
  const c = usePalette();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q) return;
      setBusy(true);
      try {
        const query = parseQuery(q, new Date(), await knownPeople(db));
        const result = await search(db, query);
        setAnswer({ question: q, query, ...result });
      } finally {
        setBusy(false);
      }
    },
    [db],
  );

  // Coming back to this tab re-runs the question, so a deleted item never lingers here.
  useFocusEffect(
    useCallback(() => {
      if (answer) void ask(answer.question);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ask]),
  );

  const header = (
    <View style={styles.header}>
      <View style={{ gap: 4 }}>
        <Title>Ask</Title>
        <Body muted>Find anything you saved, in your own words. It all stays on this phone.</Body>
      </View>
      <View style={[styles.searchRow, { backgroundColor: c.surface, borderColor: c.line }]}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => void ask(question)}
          placeholder="I remember saving…"
          placeholderTextColor={c.muted}
          returnKeyType="search"
          style={[styles.input, { color: c.ink }]}
          accessibilityLabel="What are you looking for?"
        />
        <Button label="Ask" kind="primary" onPress={() => void ask(question)} disabled={!question.trim()} busy={busy} />
      </View>

      {!answer ? (
        <View style={styles.examples}>
          <Label>Try asking</Label>
          <View style={styles.exampleChips}>
            {EXAMPLES.map((example) => (
              <Chip
                key={example}
                label={example}
                onPress={() => {
                  setQuestion(example);
                  void ask(example);
                }}
              />
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.summary}>
          <Text style={[styles.count, { color: c.ink }]}>
            {answer.found.length === 0
              ? 'Nothing found'
              : answer.found.length === 1
                ? 'Here it is'
                : `Found ${answer.found.length} things`}
          </Text>
          {answer.query.understood.length ? (
            <View style={styles.exampleChips}>
              {answer.query.understood.map((u) => (
                <Chip key={u} label={u} selected />
              ))}
            </View>
          ) : null}
          {answer.loose ? (
            <Notice tone="warn">Nothing matched all of that exactly, so these are the closest things you saved.</Notice>
          ) : null}
          {answer.found.length === 0 ? (
            <Body muted>Try fewer words, or words you might have used when you saved it.</Body>
          ) : null}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: c.background }]}>
      <FlatList
        data={answer?.found ?? []}
        keyExtractor={(f) => String(f.item.id)}
        ListHeaderComponent={header}
        renderItem={({ item: f, index }) => (
          <View style={styles.cardWrap}>
            {f.close && (index === 0 || !answer?.found[index - 1].close) ? (
              <Label style={styles.closeLabel}>Close in meaning</Label>
            ) : null}
            <ItemCard item={f.item} matched={f.matched} close={f.close} showDay={dayLabel(f.item.createdAt)} />
          </View>
        )}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Space.l, paddingBottom: 120, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { gap: Space.l, paddingTop: Space.l, paddingBottom: Space.m },
  searchRow: {
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
  examples: { gap: Space.s },
  exampleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summary: { gap: Space.m },
  count: { fontSize: 18, fontWeight: '700' },
  cardWrap: { marginBottom: Space.s + 2 },
  closeLabel: { marginTop: Space.m, marginBottom: Space.s },
});
