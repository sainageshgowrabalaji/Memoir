// The same three tabs in a browser, for previewing on a computer.
import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePalette } from '@/hooks/use-palette';

function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const c = usePalette();
  return (
    <Pressable {...props} style={styles.button}>
      <Text style={[styles.label, { color: isFocused ? c.accent : c.muted }]}>{children}</Text>
      <View style={[styles.bar, { backgroundColor: isFocused ? c.accent : 'transparent' }]} />
    </Pressable>
  );
}

export default function AppTabs() {
  const c = usePalette();
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <TabList style={[styles.list, { backgroundColor: c.background, borderTopColor: c.line }]}>
        <TabTrigger name="index" href="/" asChild>
          <TabButton>Memoir</TabButton>
        </TabTrigger>
        <TabTrigger name="ask" href="/ask" asChild>
          <TabButton>Ask</TabButton>
        </TabTrigger>
        <TabTrigger name="todos" href="/todos" asChild>
          <TabButton>To-dos</TabButton>
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  list: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, paddingTop: 8, paddingBottom: 12 },
  button: { alignItems: 'center', paddingHorizontal: 18, gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  bar: { height: 3, width: 28, borderRadius: 2 },
});
