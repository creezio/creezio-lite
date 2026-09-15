/**
 * Générateur schéma brand — SQL + TS (code marque, pas de domaine dans le kit).
 */
import type { ProductEntity, ProductModel } from "../product-model.js";

function sqlType(fieldType: string): string {
  switch (fieldType) {
    case "number":
      return "REAL";
    case "boolean":
      return "INTEGER";
    case "json":
      return "TEXT";
    default:
      return "TEXT";
  }
}

export function renderBrandSchemaSql(model: ProductModel): string {
  const out: string[] = [
    `-- Schéma brand généré depuis ProductModel (${model.brandId})`,
    `-- Ne pas déplacer dans @creezio/platform-core (ADR no-brand-domain).`,
    "",
  ];
  for (const ent of model.entities) {
    out.push(`CREATE TABLE IF NOT EXISTS ${ent.id} (`);
    out.push(`  id TEXT PRIMARY KEY,`);
    out.push(`  created_at TEXT NOT NULL,`);
    out.push(
      `  updated_at TEXT NOT NULL${ent.fields.length || ent.archivable ? "," : ""}`,
    );
    if (ent.archivable) {
      out.push(`  archived_at TEXT${ent.fields.length ? "," : ""}`);
    }
    ent.fields.forEach((f, i) => {
      const nullability = f.required ? " NOT NULL" : "";
      const comma = i < ent.fields.length - 1 ? "," : "";
      out.push(`  ${f.name} ${sqlType(f.type)}${nullability}${comma}`);
    });
    out.push(`);`);
    out.push("");
  }
  return out.join("\n");
}

export function renderBrandSchemaTs(model: ProductModel): string {
  const entitiesJson = JSON.stringify(
    model.entities.map((e: ProductEntity) => ({
      id: e.id,
      label: e.label,
      labelPlural: e.labelPlural,
      archivable: Boolean(e.archivable),
      fields: e.fields,
    })),
    null,
    2,
  );
  return `/**
 * Schéma brand ${model.brandId} — généré par creezio new-app --from-prd.
 * Source de vérité métier dans le repo marque.
 */

export type BrandFieldType = "text" | "number" | "date" | "boolean" | "ref" | "json";

export type BrandField = {
  name: string;
  type: BrandFieldType;
  required?: boolean;
  ref?: string;
  label?: string;
};

export type BrandEntity = {
  id: string;
  label: string;
  labelPlural: string;
  archivable?: boolean;
  fields: BrandField[];
};

export const BRAND_ID = ${JSON.stringify(model.brandId)} as const;
export const BRAND_NAME = ${JSON.stringify(model.brandName)} as const;
export const BRAND_TAGLINE = ${JSON.stringify(model.tagline)} as const;

export const BRAND_ENTITIES: BrandEntity[] = ${entitiesJson};

export const BRAND_ENTITY_IDS = BRAND_ENTITIES.map((e) => e.id);

export function getEntity(id: string): BrandEntity | undefined {
  return BRAND_ENTITIES.find((e) => e.id === id);
}
`;
}
