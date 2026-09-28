import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { useIsDark } from '@/hooks/use-palette';
import { DatabaseProvider, useDb } from '@/lib/database';
import { dataChanged } from '@/lib/events';
import { promoteBacklog } from '@/db/repo';
import { readPendingPages } from '@/lib/page-sync';
import { configureNotifications, syncReminders } from '@/lib/reminders';

void SplashScreen.preventAutoHideAsync();

/** Work that runs quietly while the app is open: reading saved links, keeping reminders topped up. */
function Background() {
  const db = useDb();
  useEffect(() => {
    const catchUp = async () => {
      // A few old saves from the backlog come back each day.
      await promoteBacklog(db).catch(() => 0);
      void readPendingPages(db);
      await syncReminders(db).catch(() => 0);
      dataChanged();
    };
    void catchUp();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void catchUp();
    });
    return () => sub.remove();
  }, [db]);
  return null;
}

export default function RootLayout() {
  const dark = useIsDark();
  const palette = dark ? Colors.dark : Colors.light;
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, background: palette.background, card: palette.background, text: palette.ink, border: palette.line, primary: palette.accent },
  };

  useEffect(() => {
    configureNotifications();
    void SplashScreen.hideAsync();
    if (Platform.OS === 'web') return;
    // Tapping a reminder opens where it belongs: Follow up for to-dos and links, Home for the diary.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      router.navigate(url === '/' ? '/' : '/todos');
    });
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider value={theme}>
      <DatabaseProvider>
        <Background />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="item/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        </Stack>
      </DatabaseProvider>
    </ThemeProvider>
  );
}
