/**
 * The city, and every house somebody is currently standing in.
 *
 * A player is in exactly one **realm**: the city, or the inside of one house.
 * Each realm is its own `World` — its own map, its own crowd, its own chat —
 * which means everything that already worked in the city works inside a house
 * without a single rule being written twice.
 *
 * A house's world is made when somebody walks in and thrown away when the last
 * person leaves, so an empty house costs nothing at all. What is *in* the house
 * is not here: furniture belongs to the API, and the browser asks it. The world
 * server only needs to know where the walls are.
 */
import { HOUSE_ROWS, INTERIOR_ROWS } from '@atheriam/shared';
import { GameMap } from './map.js';
import { World } from './world.js';

/** The name of a realm: the city, or one house. */
export type RealmId = 'city' | `house:${string}` | `property:${string}` | `booking:${string}`;

export function houseRealm(houseId: string): RealmId {
  return `house:${houseId}`;
}

/** The id of the house a realm is, or null for the city. */
export function houseIdOf(realm: RealmId): string | null {
  return realm.startsWith('house:') ? realm.slice('house:'.length) : null;
}

/** Every house is the same room inside. It is read-only, so one is enough. */
const houseMap = new GameMap(HOUSE_ROWS);
const propertyMap = new GameMap(INTERIOR_ROWS);
export function propertyRealm(id: string): RealmId {
  return `property:${id}`;
}
export function propertyIdOf(realm: RealmId): string | null {
  return realm.startsWith('property:') ? realm.slice('property:'.length) : null;
}

export function bookingRealm(id: string): RealmId {
  return `booking:${id}`;
}
export function bookingIdOf(realm: RealmId): string | null {
  return realm.startsWith('booking:') ? realm.slice('booking:'.length) : null;
}

export class Realms {
  /** The city. It always exists, whether or not anybody is in it. */
  readonly city: World;
  private readonly houses = new Map<RealmId, World>();

  constructor(city: World) {
    this.city = city;
  }

  /**
   * The world for this realm, making it if somebody is walking in.
   *
   * Houses hold few people, so they are given a small limit of their own: a
   * house with two hundred people in it is not a house.
   */
  get(realm: RealmId, bookingCapacity?: number): World {
    if (realm === 'city') return this.city;

    const existing = this.houses.get(realm);
    if (existing !== undefined) return existing;

    const booking = bookingIdOf(realm) !== null;
    if (booking && (!Number.isInteger(bookingCapacity) || bookingCapacity! < 1))
      throw new Error('A meeting realm needs an authorized capacity');
    const made = new World(booking || realm.startsWith('property:') ? propertyMap : houseMap, {
      maxPlayers: booking ? bookingCapacity! : realm.startsWith('property:') ? 40 : 20,
    });
    this.houses.set(realm, made);
    return made;
  }

  /** Forget a house nobody is in. An empty house should cost nothing. */
  forgetIfEmpty(realm: RealmId): void {
    if (realm === 'city') return;
    const world = this.houses.get(realm);
    if (world === undefined || world.playerCount > 0) return;
    this.houses.delete(realm);
  }

  /** How many houses are occupied right now. For the log line and the tests. */
  get occupiedHouses(): number {
    return this.houses.size;
  }

  /** Every world that currently exists, so the tick can advance all of them. */
  all(): World[] {
    return [this.city, ...this.houses.values()];
  }
}
