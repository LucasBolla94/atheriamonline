import { CITY_FURNITURE } from './city.js';
import { publicVenue, type VenueProp } from './venues.js';
import type { TilePos } from './tile.js';

export interface Seat extends TilePos {
  readonly id: string;
  readonly offsetX: number;
}

/** Each bench/sofa has two places; each office chair has one. */
export function seatsForProps(props: readonly VenueProp[]): readonly Seat[] {
  return props.flatMap((prop) => {
    const offsets =
      prop.art === 'office-chair' ? [0] : prop.art === 'bench' || prop.art === 'sofa' ? [0, 2] : [];
    return offsets.map((dx) => ({
      id: `${prop.x + dx}:${prop.y}`,
      x: prop.x + dx,
      y: prop.y,
      offsetX: prop.art === 'office-chair' ? 0 : dx === 0 ? 8 : -8,
    }));
  });
}
export const CITY_SEATS = seatsForProps(CITY_FURNITURE);
export function venueSeats(id: string | null): readonly Seat[] {
  return seatsForProps(publicVenue(id)?.props ?? []);
}
