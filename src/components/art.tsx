// Abstract shapes that give Memoir its feel: soft blobs behind the greeting that change color with
// the time of day, and a small mark for each shelf. Drawn, not pictures, so they stay sharp and light.
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import type { CategoryId } from '@/brain/categories';
import { useIsDark } from '@/hooks/use-palette';

const BLOBS = [
  'M44.6,-58.8C57.1,-48.7,66,-34.2,70.2,-18.4C74.4,-2.6,74,14.5,66.9,28.2C59.8,41.9,46,52.2,31,59.5C16,66.8,-0.2,71.1,-16.4,68.6C-32.6,66.1,-48.8,56.8,-59.5,43C-70.2,29.2,-75.4,10.9,-72.8,-5.8C-70.2,-22.5,-59.8,-37.6,-46.4,-47.8C-33,-58,-16.5,-63.3,0.2,-63.6C16.9,-63.9,33.9,-59.2,44.6,-58.8Z',
  'M39.9,-51.6C50.9,-40.4,58.5,-26.7,62.1,-11.6C65.7,3.5,65.3,20,57.8,32.4C50.3,44.8,35.7,53.1,20.1,58.6C4.5,64.1,-12.2,66.8,-27.1,61.5C-42,56.2,-55.1,42.9,-62.4,27C-69.7,11.1,-71.2,-7.4,-65,-22.6C-58.8,-37.8,-44.9,-49.7,-30.3,-60C-15.7,-70.3,-0.4,-79,13.2,-76.5C26.8,-74,28.9,-62.8,39.9,-51.6Z',
  'M52.3,-61.9C66.4,-50.2,75.6,-32.6,77.4,-14.7C79.2,3.2,73.6,21.4,63.3,35.8C53,50.2,38,60.8,21.5,66.4C5,72,-13,72.6,-28.9,66.4C-44.8,60.2,-58.6,47.2,-66.9,31.2C-75.2,15.2,-78,-3.8,-72.6,-19.9C-67.2,-36,-53.6,-49.2,-38.6,-60.7C-23.6,-72.2,-7.2,-82,8.9,-82.3C25,-82.6,38.2,-73.6,52.3,-61.9Z',
];

type Mood = { a: string; b: string; c: string };

/** Morning is warm sand and peach, the afternoon sage, the evening clay and lavender, the night dusky blue. */
export function moodFor(hour: number, dark: boolean): Mood {
  const light: Record<string, Mood> = {
    morning: { a: '#EBC38F', b: '#E6A589', c: '#B9C9A8' },
    day: { a: '#B9CDB9', b: '#E3CFA3', c: '#9FC1C4' },
    evening: { a: '#E1A184', b: '#C6B3D8', c: '#A9BDD4' },
    night: { a: '#AEB9D6', b: '#C5B5D9', c: '#9DC0BF' },
  };
  const night: Record<string, Mood> = {
    morning: { a: '#6B5236', b: '#6A4638', c: '#4A5A44' },
    day: { a: '#3F5647', b: '#5E5236', c: '#35585B' },
    evening: { a: '#6A4232', b: '#4E4466', c: '#3C4C63' },
    night: { a: '#39456A', b: '#4B3F66', c: '#2F5352' },
  };
  const key = hour < 5 ? 'night' : hour < 11 ? 'morning' : hour < 17 ? 'day' : hour < 21 ? 'evening' : 'night';
  return (dark ? night : light)[key];
}

/** Soft overlapping blobs for the top of a screen. */
export function HeaderArt({ hour, width = 260, height = 220 }: { hour: number; width?: number; height?: number }) {
  const dark = useIsDark();
  const m = moodFor(hour, dark);
  return (
    <Svg width={width} height={height} viewBox="0 0 260 220" pointerEvents="none">
      <G transform="translate(170 70) rotate(12) scale(0.95)">
        <Path d={BLOBS[0]} fill={m.a} opacity={dark ? 0.75 : 0.7} />
      </G>
      <G transform="translate(222 150) rotate(-24) scale(0.62)">
        <Path d={BLOBS[1]} fill={m.b} opacity={dark ? 0.7 : 0.65} />
      </G>
      <G transform="translate(96 150) rotate(40) scale(0.34)">
        <Path d={BLOBS[2]} fill={m.c} opacity={dark ? 0.8 : 0.75} />
      </G>
      <Circle cx={128} cy={46} r={7} fill={m.b} opacity={0.9} />
      <Path d="M150 190 C 175 172, 205 172, 232 190" stroke={m.c} strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.9} />
    </Svg>
  );
}

/** A small abstract mark per shelf, in its color, for the shelf tiles. */
export function ShelfMark({ category, color, size = 44 }: { category: CategoryId | 'diary'; color: string; size?: number }) {
  const shapes: Record<string, React.ReactNode> = {
    people: (
      <>
        <Circle cx={17} cy={24} r={11} fill={color} opacity={0.9} />
        <Circle cx={29} cy={22} r={11} fill={color} opacity={0.45} />
      </>
    ),
    work: (
      <>
        <Rect x={9} y={14} width={26} height={20} rx={5} fill={color} opacity={0.85} />
        <Rect x={16} y={9} width={12} height={7} rx={3} fill={color} opacity={0.45} />
      </>
    ),
    money: (
      <>
        <Circle cx={22} cy={22} r={13} fill={color} opacity={0.35} />
        <Circle cx={22} cy={22} r={7} fill={color} opacity={0.95} />
      </>
    ),
    health: <Path d="M22 35 C 8 26, 8 12, 16 11 C 19 11, 21 13, 22 15 C 23 13, 25 11, 28 11 C 36 12, 36 26, 22 35 Z" fill={color} opacity={0.9} />,
    learning: (
      <>
        <Path d="M8 14 L22 9 L36 14 L22 19 Z" fill={color} opacity={0.95} />
        <Path d="M13 18 L13 28 C 18 33, 26 33, 31 28 L31 18 L22 22 Z" fill={color} opacity={0.5} />
      </>
    ),
    travel: (
      <>
        <Path d="M6 32 L17 16 L25 26 L30 20 L38 32 Z" fill={color} opacity={0.85} />
        <Circle cx={31} cy={12} r={4} fill={color} opacity={0.5} />
      </>
    ),
    food: (
      <>
        <Path d="M8 22 A 14 14 0 0 0 36 22 Z" fill={color} opacity={0.9} />
        <Path d="M16 16 C 16 12, 20 12, 20 8 M 24 16 C 24 12, 28 12, 28 8" stroke={color} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.5} />
      </>
    ),
    shopping: (
      <>
        <Rect x={10} y={16} width={24} height={20} rx={5} fill={color} opacity={0.85} />
        <Path d="M16 17 C 16 9, 28 9, 28 17" stroke={color} strokeWidth={2.6} fill="none" opacity={0.5} />
      </>
    ),
    fun: (
      <>
        <Path d="M22 7 L26 18 L37 18 L28 25 L31 36 L22 29 L13 36 L16 25 L7 18 L18 18 Z" fill={color} opacity={0.85} />
      </>
    ),
    ideas: (
      <>
        <Circle cx={22} cy={19} r={10} fill={color} opacity={0.9} />
        <Rect x={18} y={30} width={8} height={5} rx={2} fill={color} opacity={0.5} />
      </>
    ),
    home: (
      <>
        <Path d="M8 21 L22 9 L36 21 L36 35 L8 35 Z" fill={color} opacity={0.8} />
        <Rect x={19} y={25} width={6} height={10} rx={2} fill={color} opacity={0.45} />
      </>
    ),
    notes: (
      <>
        <Rect x={11} y={8} width={22} height={28} rx={5} fill={color} opacity={0.45} />
        <Path d="M16 17 H28 M16 23 H28 M16 29 H23" stroke={color} strokeWidth={2.4} strokeLinecap="round" opacity={0.95} />
      </>
    ),
    diary: (
      <>
        <Path d="M30 8 A 14 14 0 1 0 36 26 A 11 11 0 1 1 30 8 Z" fill={color} opacity={0.9} />
        <Circle cx={13} cy={12} r={2.2} fill={color} opacity={0.6} />
        <Circle cx={9} cy={20} r={1.6} fill={color} opacity={0.5} />
      </>
    ),
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 44 44" pointerEvents="none">
      {shapes[category] ?? shapes.notes}
    </Svg>
  );
}

/** A quiet shape for empty lists, so an empty page still feels finished. */
export function EmptyArt({ color, accent, size = 120 }: { color: string; accent: string; size?: number }) {
  return (
    <Svg width={size} height={size * 0.75} viewBox="0 0 160 120" pointerEvents="none">
      <G transform="translate(70 62) rotate(-8) scale(0.62)">
        <Path d={BLOBS[1]} fill={color} opacity={0.55} />
      </G>
      <Circle cx={118} cy={34} r={12} fill={accent} opacity={0.5} />
      <Path d="M20 100 C 50 86, 90 86, 140 100" stroke={accent} strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.6} />
    </Svg>
  );
}
