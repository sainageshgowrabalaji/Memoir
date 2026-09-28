// Photos are copied into Memoir's own folder on the phone, so they stay findable
// even if you delete them from the gallery. Nothing is uploaded anywhere.
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export class CameraBlocked extends Error {}

async function keep(uri: string): Promise<string> {
  if (Platform.OS === 'web') return uri;
  const folder = new Directory(Paths.document, 'photos');
  folder.create({ intermediates: true, idempotent: true });
  const extension = uri.split('?')[0].split('.').pop()?.toLowerCase();
  const name = `${Date.now()}.${extension && extension.length <= 4 ? extension : 'jpg'}`;
  const copy = new File(folder, name);
  await new File(uri).copy(copy);
  return copy.uri;
}

export async function pickPhoto(from: 'library' | 'camera'): Promise<string | null> {
  if (from === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new CameraBlocked('Camera access is off.');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
  const result = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  return keep(result.assets[0].uri);
}

export function deletePhoto(uri: string | null) {
  if (!uri || Platform.OS === 'web') return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone. Nothing to do.
  }
}
