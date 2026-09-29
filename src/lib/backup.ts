// Moving Memoir's data in and out as one file: a backup you keep in iCloud Drive or Files, and
// bringing a backup back. Files are picked with the phone's own picker and shared with its own
// share sheet, so you choose where they go. Nothing is uploaded by Memoir itself.
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strFromU8 } from 'fflate';
import { Platform } from 'react-native';

import { exportData, importData, isBackup, type BackupData } from '@/db/repo';
import type { Db } from '@/db/schema';

type Picked = { name: string; bytes: Uint8Array };

async function pickFile(): Promise<Picked | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if (Platform.OS === 'web' && asset.file) return { name: asset.name, bytes: new Uint8Array(await asset.file.arrayBuffer()) };
  return { name: asset.name, bytes: await new File(asset.uri).bytes() };
}

// ------------------------------------------------------------ backup

function stamp(now: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Writes everything, photos included, to one file and opens the share sheet to keep it somewhere safe. */
export async function shareBackup(db: Db): Promise<{ items: number }> {
  const now = new Date();
  const data: BackupData & { photos?: Record<string, string> } = await exportData(db, now);
  const photos: Record<string, string> = {};
  if (Platform.OS !== 'web') {
    for (const row of data.items) {
      const uri = row.photo_uri ? String(row.photo_uri) : null;
      if (!uri) continue;
      try {
        photos[uri] = await new File(uri).base64();
      } catch {
        // A photo that is gone is simply left out.
      }
    }
  }
  data.photos = photos;
  const json = JSON.stringify(data);
  const name = `memoir-backup-${stamp(now)}.json`;

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return { items: data.items.length };
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Keep your Memoir backup' });
  return { items: data.items.length };
}

export type RestoreResult = { kind: 'backup'; added: number; skipped: number } | { kind: 'none' } | { kind: 'not-a-backup' };

/** Brings back a backup file. Anything already in Memoir is skipped, so nothing is doubled. */
export async function restoreBackup(db: Db): Promise<RestoreResult> {
  const picked = await pickFile();
  if (!picked) return { kind: 'none' };
  let data: unknown;
  try {
    data = JSON.parse(strFromU8(picked.bytes));
  } catch {
    return { kind: 'not-a-backup' };
  }
  if (!isBackup(data)) return { kind: 'not-a-backup' };
  const photos = (data as { photos?: Record<string, string> }).photos ?? {};
  const folder = Platform.OS === 'web' ? null : new Directory(Paths.document, 'photos');
  folder?.create({ intermediates: true, idempotent: true });
  let n = 0;
  const photoFor = (oldUri: string) => {
    const base64 = photos[oldUri];
    if (!folder || !base64) return null;
    const ext = oldUri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const file = new File(folder, `restored-${Date.now()}-${n++}.${ext.length <= 4 ? ext : 'jpg'}`);
    file.create();
    file.write(base64, { encoding: 'base64' });
    return file.uri;
  };
  const { added, skipped } = await importData(db, data, photoFor);
  return { kind: 'backup', added, skipped };
}
