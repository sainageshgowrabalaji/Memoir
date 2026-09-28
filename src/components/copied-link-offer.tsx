// The quickest way to save a reel without a share button: in Instagram tap Share, then Copy link,
// then open Memoir. Memoir notices a link is waiting and offers to save it with one tap.
//
// Noticing a link does not read it, so the iPhone shows no paste prompt just for opening the app.
// The link is only read when you tap Save. After saving, the clipboard is cleared so the same
// link is not offered again.
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { Radius, Space } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

// "Not now" hides the offer until you next come back to the app.
let dismissed = false;

export function CopiedLinkOffer({ onSave }: { onSave: (link: string) => Promise<void> }) {
  const c = usePalette();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (Platform.OS !== 'ios' || dismissed) {
      setVisible(false);
      return;
    }
    setVisible(await Clipboard.hasUrlAsync().catch(() => false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void check();
    }, [check]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') dismissed = false;
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [check]);

  if (!visible) return null;

  async function save() {
    setBusy(true);
    try {
      const link = ((await Clipboard.getUrlAsync()) ?? (await Clipboard.getStringAsync())).trim();
      if (link) {
        await onSave(link);
        await Clipboard.setStringAsync('');
      }
      setVisible(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.box, { backgroundColor: c.accentSoft, borderColor: c.accent }]}>
      <Text style={[styles.title, { color: c.ink }]}>You copied a link</Text>
      <Text style={[styles.body, { color: c.body }]}>Save it, and Memoir reads what it is and reminds you to check it tonight.</Text>
      <View style={styles.actions}>
        <Button label="Save it" kind="primary" onPress={() => void save()} busy={busy} />
        <Button
          label="Not now"
          onPress={() => {
            dismissed = true;
            setVisible(false);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: Radius.l, borderWidth: 1.5, padding: Space.l, gap: Space.s },
  title: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 14.5, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: Space.s, marginTop: 4 },
});
