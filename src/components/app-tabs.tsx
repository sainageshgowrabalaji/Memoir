// The three tabs, drawn by the phone itself: iOS tab bar on iPhone, Material bar on Android.
// Today is where you talk to Memoir, Tasks holds to-dos, lists and habits, Journal your days and notes.
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { usePalette } from '@/hooks/use-palette';
import { useOpenTaskCount } from '@/hooks/use-open-task-count';

export default function AppTabs() {
  const c = usePalette();
  const due = useOpenTaskCount();
  return (
    <NativeTabs
      backgroundColor={c.background}
      indicatorColor={c.accentSoft}
      tintColor={c.accent}
      iconColor={{ default: c.muted, selected: c.accent }}
      labelStyle={{ default: { color: c.muted }, selected: { color: c.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sun.max" src={require('@/assets/images/tabIcons/today.png')} renderingMode="template" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks">
        <NativeTabs.Trigger.Label>Tasks</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={due === 0}>{String(due)}</NativeTabs.Trigger.Badge>
        <NativeTabs.Trigger.Icon sf="checklist" src={require('@/assets/images/tabIcons/todos.png')} renderingMode="template" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="journal">
        <NativeTabs.Trigger.Label>Journal</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="book.closed" src={require('@/assets/images/tabIcons/journal.png')} renderingMode="template" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
