// Where everything goes in. Type, paste a link, add a photo, or speak with the
// keyboard's mic. One Save button, and Memoir works out the rest.
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui';
import { Radius, Space } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';
import { CameraBlocked, deletePhoto, pickPhoto } from '@/lib/photos';

type Props = { onSave: (text: string, photoUri: string | null) => Promise<void>; placeholder?: string };

export function CaptureBox({ onSave, placeholder = 'Save a thought, a link, a plan, anything…' }: Props) {
  const c = usePalette();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function paste() {
    // Read only when you tap Paste, so the phone never asks about the clipboard on its own.
    const copied = (await Clipboard.getStringAsync()).trim();
    if (!copied) {
      setNote('Nothing to paste. Copy a link or text first.');
      return;
    }
    setNote('');
    setText((current) => (current.trim() ? `${current.trim()}\n${copied}` : copied));
  }

  async function addPhoto(from: 'library' | 'camera') {
    setNote('');
    try {
      const uri = await pickPhoto(from);
      if (uri) {
        deletePhoto(photo);
        setPhoto(uri);
      }
    } catch (error) {
      setNote(error instanceof CameraBlocked ? 'Camera access is off. Turn it on for Expo Go or Memoir in Settings.' : 'Could not add that photo.');
    }
  }

  async function save() {
    if (!text.trim() && !photo) return;
    setBusy(true);
    try {
      await onSave(text.trim(), photo);
      setText('');
      setPhoto(null);
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(text.trim() || photo);
  return (
    <View style={[styles.box, { backgroundColor: c.surface, borderColor: c.line }]}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        multiline
        style={[styles.input, { color: c.ink }]}
        accessibilityLabel="What do you want to save?"
      />
      {photo ? (
        <View style={styles.photoRow}>
          <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
          <Pressable
            onPress={() => {
              deletePhoto(photo);
              setPhoto(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Remove this photo"
            hitSlop={8}>
            <Text style={[styles.remove, { color: c.muted }]}>Remove photo</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.actions}>
        <View style={styles.tools}>
          <Button label="Paste" onPress={paste} style={styles.tool} />
          <Button label="Photo" onPress={() => addPhoto('library')} style={styles.tool} />
          <Button label="Camera" onPress={() => addPhoto('camera')} style={styles.tool} />
        </View>
        <Button label="Save" kind="primary" onPress={save} disabled={!ready} busy={busy} style={styles.save} />
      </View>
      <Text style={[styles.hint, { color: note ? c.danger : c.muted }]}>
        {note || 'Tip: tap the mic on your keyboard to say it instead of typing.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: Radius.l, borderWidth: StyleSheet.hairlineWidth * 2, padding: Space.m, gap: Space.s },
  input: { fontSize: 17, lineHeight: 24, minHeight: 72, maxHeight: 180, textAlignVertical: 'top', paddingHorizontal: 4, paddingTop: 4 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Space.m, paddingHorizontal: 4 },
  photo: { width: 72, height: 72, borderRadius: Radius.s },
  remove: { fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.s, flexWrap: 'wrap' },
  tools: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tool: { minHeight: 38, paddingHorizontal: 12 },
  save: { paddingHorizontal: 22 },
  hint: { fontSize: 12.5, paddingHorizontal: 4 },
});
