/** Stable addresses shared by map generation, property sales and the client. */
export interface CityBuilding {
  readonly id: string;
  readonly cityId: string;
  readonly name: string;
  readonly kind: 'public' | 'commercial';
  readonly use: 'hall' | 'lounge' | 'creative' | 'market' | 'events' | 'shop';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly entrance: { readonly x: number; readonly y: number };
  /** Integer minor units. Only the server may authorize a purchase. */
  readonly priceMinor: string;
  readonly style: 'teal' | 'coral' | 'blue' | 'sand' | 'lilac';
}

export const STARTER_CITY = {
  id: 'atheriam-central',
  name: 'Atheriam Central',
  size: 160,
  spawn: { x: 80, y: 85 },
  square: { x: 66, y: 66, width: 28, height: 28 },
  fountain: { x: 79, y: 77, width: 2, height: 2 },
} as const;

function building(
  id: string,
  name: string,
  use: CityBuilding['use'],
  x: number,
  y: number,
  style: CityBuilding['style'],
  priceMinor = '0',
): CityBuilding {
  const width = use === 'shop' ? 12 : 16;
  const height = use === 'shop' ? 10 : 12;
  return {
    id,
    name,
    use,
    cityId: STARTER_CITY.id,
    kind: use === 'shop' ? 'commercial' : 'public',
    x,
    y,
    width,
    height,
    entrance: { x: x + Math.floor(width / 2), y: y + height },
    priceMinor,
    style,
  };
}

/** Five municipal venues, ten individually owned commercial addresses. */
export const CITY_BUILDINGS: readonly CityBuilding[] = [
  building('city-hall', 'City Hall', 'hall', 53, 43, 'sand'),
  building('creative-hub', 'Creative Hub', 'creative', 74, 39, 'lilac'),
  building('events-hall', 'Events Hall', 'events', 95, 43, 'blue'),
  building('central-lounge', 'Central Lounge', 'lounge', 46, 69, 'coral'),
  building('market-hall', 'Market Hall', 'market', 98, 69, 'teal'),
  ...[36, 57, 80, 103, 126].flatMap((y, i) => [
    building(
      `west-${i + 1}`,
      `${i + 1} Park Avenue`,
      'shop',
      20,
      y,
      (['teal', 'sand', 'coral', 'blue', 'lilac'] as const)[i]!,
      '25000',
    ),
    building(
      `east-${i + 1}`,
      `${i + 1} Lake Avenue`,
      'shop',
      128,
      y,
      (['coral', 'blue', 'lilac', 'teal', 'sand'] as const)[i]!,
      '25000',
    ),
  ]),
];

export function cityBuilding(id: string): CityBuilding | undefined {
  return CITY_BUILDINGS.find((entry) => entry.id === id);
}

/** A door occupies two tiles in front of the facade, never inside its walls. */
export function buildingAtEntrance(x: number, y: number): CityBuilding | undefined {
  return CITY_BUILDINGS.find(
    (entry) => y === entry.entrance.y && (x === entry.entrance.x || x === entry.entrance.x - 1),
  );
}

export const LOUNGE_ROOMS = [
  { id: 'studio', name: 'The Studio', capacity: 8 },
  { id: 'terrace', name: 'The Terrace', capacity: 12 },
  { id: 'boardroom', name: 'The Boardroom', capacity: 16 },
] as const;

/** Fixed outdoor furniture; the world and renderer use the same footprints. */
export const CITY_FURNITURE = [
  { art: 'bench', x: 72, y: 72, width: 3, height: 1 },
  { art: 'bench', x: 85, y: 72, width: 3, height: 1 },
  { art: 'bench', x: 68, y: 81, width: 3, height: 1 },
  { art: 'bench', x: 89, y: 81, width: 3, height: 1 },
  { art: 'bench', x: 72, y: 91, width: 3, height: 1 },
  { art: 'bench', x: 85, y: 91, width: 3, height: 1 },
  { art: 'planter', x: 72, y: 70, width: 3, height: 1 },
  { art: 'planter', x: 85, y: 70, width: 3, height: 1 },
  { art: 'planter', x: 67, y: 77, width: 3, height: 1 },
  { art: 'planter', x: 90, y: 77, width: 3, height: 1 },
] as const;
