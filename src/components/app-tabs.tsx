// The three tabs, drawn by the phone itself: iOS tab bar on iPhone, Material bar on Android.
// Follow up shows how many saved links are still waiting for a look.
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { usePalette } from '@/hooks/use-palette';
import { useToCheckCount } from '@/hooks/use-to-check-count';

export default function AppTabs() {
  const c = usePalette();
  const toCheck = useToCheckCount();
  return (
    <NativeTabs
      backgroundColor={c.background}
      indicatorColor={c.accentSoft}
      tintColor={c.accent}
      iconColor={{ default: c.muted, selected: c.accent }}
      labelStyle={{ default: { color: c.muted }, selected: { color: c.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Memoir</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="book.pages" src={require('@/assets/images/tabIcons/journal.png')} renderingMode="template" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ask">
        <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" src={require('@/assets/images/tabIcons/ask.png')} renderingMode="template" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="todos">
        <NativeTabs.Trigger.Label>Follow up</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={toCheck === 0}>{String(toCheck)}</NativeTabs.Trigger.Badge>
        <NativeTabs.Trigger.Icon sf="checklist" src={require('@/assets/images/tabIcons/todos.png')} renderingMode="template" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
