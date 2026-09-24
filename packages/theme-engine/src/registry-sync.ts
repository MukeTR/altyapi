import { newId } from "@altyapi/commerce-core";
import { and, eq, isNull, sectionDefinitions, withPlatformTx, type Database } from "@altyapi/database";
import { definitionJsonSchema, SECTION_DEFINITIONS } from "./sections/definitions";

/** Upserts the built-in section registry into section_definitions (store_id null). Idempotent. */
export async function syncBuiltinSectionDefinitions(db: Database): Promise<void> {
  await withPlatformTx(db, async (tx) => {
    for (const def of SECTION_DEFINITIONS) {
      const schema = definitionJsonSchema(def);
      const values = {
        name: def.name,
        category: def.category,
        propsSchema: schema.props,
        blockSchemas: schema.blocks,
        defaults: schema.defaults,
        contentBindings: def.contentBindings,
        allowedPageTypes: def.allowedIn,
        renderer: def.renderer,
      };
      const existing = await tx.query.sectionDefinitions.findFirst({
        where: and(isNull(sectionDefinitions.storeId), eq(sectionDefinitions.type, def.type), eq(sectionDefinitions.version, def.version)),
      });
      if (existing) await tx.update(sectionDefinitions).set(values).where(eq(sectionDefinitions.id, existing.id));
      else await tx.insert(sectionDefinitions).values({ id: newId(), storeId: null, type: def.type, version: def.version, ...values });
    }
  });
}
