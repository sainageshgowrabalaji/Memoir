// The same three tabs in a browser, for previewing on a computer.
import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePalette } from '@/hooks/use-palette';
import { useOpenTaskCount } from '@/hooks/use-open-task-count';

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
  const due = useOpenTaskCount();
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <TabList style={[styles.list, { backgroundColor: c.background, borderTopColor: c.line }]}>
        <TabTrigger name="index" href="/" asChild>
          <TabButton>Today</TabButton>
        </TabTrigger>
        <TabTrigger name="tasks" href="/tasks" asChild>
          <TabButton>{due ? `Tasks (${due})` : 'Tasks'}</TabButton>
        </TabTrigger>
        <TabTrigger name="journal" href="/journal" asChild>
          <TabButton>Journal</TabButton>
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  list: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, paddingBottom: 14 },
  button: { alignItems: 'center', paddingHorizontal: 18, gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  bar: { height: 3, width: 28, borderRadius: 2 },
});
