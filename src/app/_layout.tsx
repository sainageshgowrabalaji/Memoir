import { Fraunces_500Medium, Fraunces_600SemiBold, useFonts } from '@expo-google-fonts/fraunces';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { useIsDark } from '@/hooks/use-palette';
import { DatabaseProvider, useDb } from '@/lib/database';
import { dataChanged } from '@/lib/events';
import { configureNotifications, syncReminders } from '@/lib/reminders';

void SplashScreen.preventAutoHideAsync();

/** Keeps reminders topped up while the app is open, and refreshes screens when a new day starts. */
function Background() {
  const db = useDb();
  useEffect(() => {
    const catchUp = async () => {
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
  // The heading font. If it cannot load, the phone's own serif is used and nothing else changes.
  const [fontsLoaded, fontError] = useFonts({ Fraunces_500Medium, Fraunces_600SemiBold });
  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    configureNotifications();
    if (Platform.OS === 'web') return;
    // Tapping a reminder opens where it belongs: Tasks for to-dos, Today for the rest.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      router.navigate(url === '/tasks' ? '/tasks' : '/');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

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
