// Seed idempotente de datos de demo (Q-C). Re-correrlo no duplica ni falla:
// usa upsert por clave natural (slug de categoría, sku de producto).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { slug: "refrigeracion", name: "Refrigeración" },
  { slug: "ferreteria", name: "Ferretería" },
  { slug: "electricidad", name: "Electricidad" },
];

// El `slug` va explícito (no derivado acá) para que el dato de demo sea estable
// entre corridas: la derivación server-side vive en el service de la API.
const products = [
  { sku: "REF-001", slug: "compresor-1-4-hp", name: "Compresor 1/4 HP", price_ars_cents: 8500000, stock: 12, category: "refrigeracion" },
  { sku: "REF-002", slug: "gas-refrigerante-r134a-1kg", name: "Gas refrigerante R134a 1kg", price_ars_cents: 2200000, stock: 30, category: "refrigeracion" },
  { sku: "FER-001", slug: "taladro-percutor-650w", name: "Taladro percutor 650W", price_ars_cents: 4500000, stock: 8, category: "ferreteria" },
  { sku: "ELE-001", slug: "cable-unipolar-2-5mm-x100m", name: "Cable unipolar 2.5mm x100m", price_ars_cents: 3800000, stock: 20, category: "electricidad" },
];

async function main() {
  const bySlug: Record<string, string> = {};
  for (const c of categories) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: c,
    });
    bySlug[c.slug] = row.id;
  }

  for (const p of products) {
    const { category, ...rest } = p;
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: { ...rest, category_id: bySlug[category] },
      create: { ...rest, category_id: bySlug[category], status: "draft" },
    });
  }

  console.log(`Seed OK: ${categories.length} categorías, ${products.length} productos.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
