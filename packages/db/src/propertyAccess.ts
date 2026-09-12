import { and, eq } from 'drizzle-orm';
import { propertyGuests, type Property } from './schema.js';
import type { Database } from './client.js';
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export async function mayEnterProperty(
  db: Executor,
  property: Property,
  visitorId: string,
): Promise<boolean> {
  if (property.municipal || property.ownerId === visitorId) return true;
  if (property.ownerId === null || property.access === 'nobody') return false;
  if (property.access === 'everyone') return true;
  const guests = await db
    .select({ id: propertyGuests.id })
    .from(propertyGuests)
    .where(
      and(eq(propertyGuests.propertyId, property.id), eq(propertyGuests.characterId, visitorId)),
    )
    .limit(1);
  return guests.length > 0;
}
