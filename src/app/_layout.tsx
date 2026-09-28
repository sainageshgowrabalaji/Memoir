import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { useIsDark } from '@/hooks/use-palette';
import { DatabaseProvider } from '@/lib/database';
import { configureNotifications } from '@/lib/reminders';

void SplashScreen.preventAutoHideAsync();

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
    // Tapping a reminder opens the to-do list.
    const subscription = Notifications.addNotificationResponseReceivedListener(() => router.navigate('/todos'));
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider value={theme}>
      <DatabaseProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="item/[id]" options={{ presentation: 'modal' }} />
        </Stack>
      </DatabaseProvider>
    </ThemeProvider>
  );
}
