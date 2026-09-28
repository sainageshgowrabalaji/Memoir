import { Colors, ShelfColors, type Palette } from '@/constants/theme';
import type { CategoryId } from '@/brain/categories';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useIsDark() {
  return useColorScheme() === 'dark';
}

export function usePalette(): Palette {
  return useIsDark() ? Colors.dark : Colors.light;
}

export function useShelfColor(): (category: CategoryId) => string {
  const dark = useIsDark();
  return (category) => ShelfColors[category][dark ? 'dark' : 'light'];
}
