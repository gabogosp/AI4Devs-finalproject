// Seed idempotente de datos de demo (Q-C). Re-correrlo no duplica ni falla:
// usa upsert por clave natural (slug de categoría, sku de producto).
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const categories = [
  { slug: "refrigeracion", name: "Refrigeración" },
  { slug: "ferreteria", name: "Ferretería" },
  { slug: "electricidad", name: "Electricidad" },
];

// El `slug` va explícito (no derivado acá) para que el dato de demo sea estable
// entre corridas: la derivación server-side vive en el service de la API.
//
// `status` explícito para que el MVP se vea poblado apenas se siembra: la
// mayoría queda `published` (visible en el storefront) con variedad para mostrar
// los estados de la ficha — con stock, SIN stock (AC-4) y sin imagen (AC-6, el FE
// pone placeholder). Uno queda `draft` a propósito: NO aparece en el storefront y
// su slug devuelve 404 (AC-7) — además le da al admin algo para publicar en la demo.
const products = [
  { sku: "REF-001", slug: "compresor-1-4-hp", name: "Compresor 1/4 HP", price_ars_cents: 8500000, stock: 12, category: "refrigeracion", status: "published", image_url: null },
  { sku: "REF-002", slug: "gas-refrigerante-r134a-1kg", name: "Gas refrigerante R134a 1kg", price_ars_cents: 2200000, stock: 30, category: "refrigeracion", status: "published", image_url: null },
  { sku: "FER-001", slug: "taladro-percutor-650w", name: "Taladro percutor 650W", price_ars_cents: 4500000, stock: 0, category: "ferreteria", status: "published", image_url: null }, // AC-4: sin stock
  { sku: "ELE-001", slug: "cable-unipolar-2-5mm-x100m", name: "Cable unipolar 2.5mm x100m", price_ars_cents: 3800000, stock: 20, category: "electricidad", status: "draft", image_url: null }, // AC-7: draft → 404
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
      create: { ...rest, category_id: bySlug[category] },
    });
  }

  await seedAdmin();

  console.log(`Seed OK: ${categories.length} categorías, ${products.length} productos.`);
}

/**
 * Cuenta admin para el login por credenciales (US-014 T8.2, ADR-0009).
 *
 * Sólo corre si **ambas** variables están presentes. Nada de contraseña por
 * defecto en el repo: una credencial hardcodeada termina en producción sin que
 * nadie la cambie, y el panel es el blanco más valioso del sistema. Si faltan,
 * el seed no crea admin y **tampoco falla** — el resto de los datos de demo se
 * siembra igual y el bootstrap token sigue siendo el camino de entrada.
 *
 * Idempotente por `upsert` sobre el email: correrlo dos veces deja una fila.
 */
async function seedAdmin(): Promise<void> {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    console.log(
      "Seed admin omitido: faltan ADMIN_SEED_EMAIL y/o ADMIN_SEED_PASSWORD.",
    );
    return;
  }

  const normalizado = email.trim().normalize("NFKC").toLowerCase();
  const cost = Number(process.env.BCRYPT_COST ?? 12);
  const password_hash = await bcrypt.hash(password, cost);

  await prisma.customer.upsert({
    where: { email: normalizado },
    update: { password_hash, role: "admin" },
    create: {
      email: normalizado,
      name: "Administrador",
      password_hash,
      role: "admin",
    },
  });

  // Se loguea el email —dato operativo que el operador necesita confirmar— pero
  // NUNCA la contraseña ni el hash.
  console.log(`Seed admin OK: ${normalizado}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
