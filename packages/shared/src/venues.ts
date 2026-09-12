import { INTERIOR_ROWS } from './interior.js';

/** Permanent city scenery: these objects are not inventory items or sale listings. */
export const VENUE_PROP_NAMES = [
  'plant',
  'bench',
  'sofa',
  'coffee-table',
  'cafe-counter',
  'bookshelf',
  'meeting-table',
  'office-chair',
  'desk',
  'noticeboard',
  'planter',
  'lectern',
] as const;
export type VenuePropName = (typeof VENUE_PROP_NAMES)[number];
export const VENUE_IDS = [
  'city-hall',
  'central-lounge',
  'creative-hub',
  'market-hall',
  'events-hall',
  'studio',
  'terrace',
  'boardroom',
] as const;
export type VenueId = (typeof VENUE_IDS)[number];
export interface VenueProp {
  readonly art: VenuePropName;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
const sizes: Record<VenuePropName, readonly [number, number]> = {
  plant: [1, 1],
  bench: [3, 1],
  sofa: [3, 1],
  'coffee-table': [3, 1],
  'cafe-counter': [4, 2],
  bookshelf: [2, 1],
  'meeting-table': [6, 3],
  'office-chair': [1, 1],
  desk: [3, 2],
  noticeboard: [2, 1],
  planter: [3, 1],
  lectern: [1, 1],
};
function prop(art: VenuePropName, x: number, y: number): VenueProp {
  const [width, height] = sizes[art];
  return { art, x, y, width, height };
}
export interface PublicVenue {
  readonly id: VenueId;
  readonly floor: 'oak' | 'stone' | 'tile';
  readonly wall: 'cream' | 'teal' | 'rose';
  readonly props: readonly VenueProp[];
  readonly rows: readonly string[];
}
function venue(
  id: VenueId,
  floor: PublicVenue['floor'],
  wall: PublicVenue['wall'],
  props: readonly VenueProp[],
): PublicVenue {
  const rows = INTERIOR_ROWS.map((row) => [...row]);
  for (const item of props)
    for (let y = item.y; y < item.y + item.height; y++)
      for (let x = item.x; x < item.x + item.width; x++) {
        if (rows[y]?.[x] !== 'd' || ((x === 9 || x === 10) && y >= 12))
          throw new Error(
            `Invalid or overlapping public furniture: ${id}/${item.art} at ${x},${y}`,
          );
        rows[y]![x] = 'o';
      }
  return { id, floor, wall, props, rows: rows.map((row) => row.join('')) };
}
export const PUBLIC_VENUES: Readonly<Record<VenueId, PublicVenue>> = {
  'central-lounge': venue('central-lounge', 'tile', 'teal', [
    prop('cafe-counter', 3, 3),
    prop('bookshelf', 13, 3),
    prop('noticeboard', 8, 3),
    prop('plant', 17, 3),
    prop('plant', 2, 9),
    prop('sofa', 4, 8),
    prop('sofa', 12, 8),
    prop('coffee-table', 4, 10),
    prop('coffee-table', 12, 10),
    prop('plant', 17, 11),
  ]),
  studio: venue('studio', 'stone', 'teal', [
    prop('meeting-table', 7, 5),
    ...[
      [8, 4],
      [11, 4],
      [6, 5],
      [6, 7],
      [13, 5],
      [13, 7],
      [8, 8],
      [11, 8],
    ].map(([x, y]) => prop('office-chair', x!, y!)),
    prop('plant', 3, 3),
    prop('plant', 16, 3),
    prop('bookshelf', 3, 10),
    prop('noticeboard', 14, 10),
  ]),
  terrace: venue('terrace', 'stone', 'cream', [
    prop('planter', 2, 2),
    prop('planter', 14, 2),
    ...[
      [4, 4],
      [12, 4],
      [4, 10],
      [12, 10],
    ].map(([x, y]) => prop('bench', x!, y!)),
    prop('coffee-table', 4, 6),
    prop('coffee-table', 12, 6),
    ...[
      [4, 8],
      [6, 8],
      [12, 8],
      [14, 8],
    ].map(([x, y]) => prop('office-chair', x!, y!)),
    prop('plant', 2, 12),
    prop('plant', 17, 12),
  ]),
  boardroom: venue('boardroom', 'tile', 'teal', [
    prop('meeting-table', 7, 5),
    ...[7, 8, 9, 10, 11, 12].flatMap((x) => [
      prop('office-chair', x, 4),
      prop('office-chair', x, 8),
    ]),
    ...[
      [6, 5],
      [6, 7],
      [13, 5],
      [13, 7],
    ].map(([x, y]) => prop('office-chair', x!, y!)),
    prop('desk', 3, 10),
    prop('noticeboard', 14, 10),
    prop('lectern', 3, 3),
    prop('plant', 16, 3),
  ]),
  'city-hall': venue('city-hall', 'stone', 'cream', [
    prop('cafe-counter', 7, 3),
    prop('noticeboard', 3, 3),
    prop('noticeboard', 14, 3),
    prop('bench', 3, 8),
    prop('bench', 13, 8),
    prop('desk', 7, 9),
    prop('plant', 3, 12),
    prop('plant', 16, 12),
  ]),
  'creative-hub': venue('creative-hub', 'tile', 'rose', [
    prop('desk', 3, 4),
    prop('desk', 12, 4),
    prop('office-chair', 4, 6),
    prop('office-chair', 13, 6),
    prop('bookshelf', 3, 9),
    prop('sofa', 12, 10),
    prop('noticeboard', 8, 3),
    prop('plant', 16, 11),
  ]),
  'events-hall': venue('events-hall', 'stone', 'rose', [
    prop('lectern', 9, 3),
    prop('plant', 3, 3),
    prop('plant', 16, 3),
    ...[3, 8, 13].flatMap((x) => [prop('bench', x, 7), prop('bench', x, 10)]),
  ]),
  'market-hall': venue('market-hall', 'tile', 'cream', [
    ...[3, 12].flatMap((x) => [prop('cafe-counter', x, 3), prop('cafe-counter', x, 9)]),
    prop('noticeboard', 8, 3),
    prop('plant', 2, 12),
    prop('plant', 17, 12),
  ]),
};
export function isVenueId(value: string): value is VenueId {
  return Object.prototype.hasOwnProperty.call(PUBLIC_VENUES, value);
}
export function publicVenue(id: string | null | undefined): PublicVenue | null {
  return id && isVenueId(id) ? PUBLIC_VENUES[id] : null;
}
