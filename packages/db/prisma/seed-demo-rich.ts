// Seed idempotente de catálogo "rico" para la fase de prueba visual/local —
// ~100 productos con variedad real de categorías, precio, stock y estado, para
// ejercitar búsqueda, filtro por categoría, paginación y los estados de la
// ficha (con stock / sin stock / borrador) mucho mejor que los 4 productos del
// seed canónico (`seed.ts`).
//
// Mismo idioma que `seed.ts`: upsert por clave natural (slug de categoría, sku
// de producto) — correrlo de nuevo no duplica ni falla, y no toca ni borra los
// 4 productos del seed canónico (SKUs distintos, sin colisión).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { slug: "refrigeracion", name: "Refrigeración" },
  { slug: "ferreteria", name: "Ferretería" },
  { slug: "electricidad", name: "Electricidad" },
  { slug: "plomeria", name: "Plomería" },
  { slug: "herramientas", name: "Herramientas" },
  { slug: "pinturas", name: "Pinturas" },
  { slug: "jardin", name: "Jardín" },
  { slug: "seguridad", name: "Seguridad" },
];

interface ProductoBase {
  name: string;
  /** Precio base en ARS, sin centavos — se multiplica x100 al sembrar. */
  price_ars: number;
}

// Nombres reales del rubro ferretería/plomería/electricidad/refrigeración —
// varios eligiendos a propósito para pegar con términos de búsqueda comunes
// (compresor, refrigerante, cable, taladro, pintura, manguera).
const porCategoria: Record<string, ProductoBase[]> = {
  refrigeracion: [
    { name: "Compresor 1/4 HP", price_ars: 85000 },
    { name: "Compresor 1/2 HP", price_ars: 145000 },
    { name: "Gas refrigerante R134a 1kg", price_ars: 22000 },
    { name: "Gas refrigerante R410a 1kg", price_ars: 26000 },
    { name: "Termostato digital para heladera", price_ars: 18000 },
    { name: "Válvula de expansión termostática", price_ars: 31000 },
    { name: "Filtro secador de línea", price_ars: 9500 },
    { name: "Manómetro doble para carga de gas", price_ars: 42000 },
    { name: "Bomba de vacío 1/4 HP", price_ars: 98000 },
    { name: "Cañería de cobre 3/8 x 5m", price_ars: 27500 },
    { name: "Aislante térmico para cañería 2m", price_ars: 6800 },
    { name: "Ventilador axial para condensadora", price_ars: 21000 },
    { name: "Relé de arranque para compresor", price_ars: 7200 },
    { name: "Capacitor de arranque 35uF", price_ars: 5400 },
    { name: "Compresor 1 HP trifásico", price_ars: 210000 },
  ],
  ferreteria: [
    { name: "Taladro percutor 650W", price_ars: 45000 },
    { name: "Taladro atornillador a batería 18V", price_ars: 62000 },
    { name: "Amoladora angular 115mm", price_ars: 38000 },
    { name: "Sierra caladora 500W", price_ars: 41000 },
    { name: "Set de destornilladores x6", price_ars: 8500 },
    { name: "Llave inglesa 10 pulgadas", price_ars: 5200 },
    { name: "Martillo de carpintero 500g", price_ars: 4300 },
    { name: "Nivel láser autonivelante", price_ars: 33000 },
    { name: "Cinta métrica 5m", price_ars: 2100 },
    { name: "Tornillos autoperforantes caja x100", price_ars: 3400 },
    { name: "Tarugos plásticos x50", price_ars: 1800 },
    { name: "Pistola de silicona eléctrica", price_ars: 6900 },
    { name: "Caja de herramientas plástica 19 pulgadas", price_ars: 12500 },
    { name: "Sierra circular 1200W", price_ars: 58000 },
    { name: "Lijadora orbital 300W", price_ars: 34000 },
  ],
  electricidad: [
    { name: "Cable unipolar 2.5mm x100m", price_ars: 38000 },
    { name: "Cable unipolar 4mm x100m", price_ars: 54000 },
    { name: "Cable unipolar 6mm x100m", price_ars: 79000 },
    { name: "Térmica bipolar 25A", price_ars: 6400 },
    { name: "Disyuntor diferencial 40A", price_ars: 15800 },
    { name: "Tomacorriente doble con tierra", price_ars: 3200 },
    { name: "Interruptor simple", price_ars: 1900 },
    { name: "Ficha macho reforzada", price_ars: 1400 },
    { name: "Cinta aisladora 3M x10", price_ars: 4500 },
    { name: "Portalámparas de porcelana", price_ars: 1100 },
    { name: "Lámpara LED 9W luz cálida", price_ars: 1600 },
    { name: "Tablero eléctrico 12 bocas", price_ars: 9800 },
    { name: "Caño corrugado 3/4 x25m", price_ars: 11200 },
    { name: "Cable unipolar 10mm x100m", price_ars: 118000 },
    { name: "Reflector LED 50W exterior", price_ars: 8700 },
  ],
  plomeria: [
    { name: "Caño PVC 1/2 pulgada x4m", price_ars: 4200 },
    { name: "Caño PVC 3/4 pulgada x4m", price_ars: 5600 },
    { name: "Codo PVC 90° 1/2 pulgada", price_ars: 450 },
    { name: "Llave de paso 1/2 pulgada", price_ars: 3800 },
    { name: "Canilla monocomando para cocina", price_ars: 24500 },
    { name: "Manguera de goma reforzada 20m", price_ars: 18900 },
    { name: "Sifón universal para pileta", price_ars: 3100 },
    { name: "Flexible de agua 40cm", price_ars: 1500 },
    { name: "Cinta teflón x10", price_ars: 900 },
    { name: "Pegamento para PVC 250ml", price_ars: 2700 },
    { name: "Rejilla de piso 10x10cm", price_ars: 1200 },
    { name: "Cañería de cobre 1/2 x5m", price_ars: 19800 },
    { name: "Bomba sumergible para pozo", price_ars: 62000 },
  ],
  herramientas: [
    { name: "Set de llaves combinadas x12", price_ars: 22000 },
    { name: "Pinza de electricista aislada", price_ars: 4800 },
    { name: "Multímetro digital", price_ars: 15600 },
    { name: "Soldador eléctrico 40W", price_ars: 5900 },
    { name: "Estaño para soldar 100g", price_ars: 3200 },
    { name: "Compresor de aire 24L", price_ars: 145000 },
    { name: "Pistola neumática para pintar", price_ars: 28000 },
    { name: "Escalera de aluminio 5 escalones", price_ars: 42000 },
    { name: "Carretilla reforzada", price_ars: 55000 },
    { name: "Guantes de trabajo reforzados", price_ars: 2400 },
    { name: "Generador eléctrico 2000W", price_ars: 185000 },
  ],
  pinturas: [
    { name: "Pintura látex interior 20L blanco", price_ars: 68000 },
    { name: "Pintura esmalte sintético 1L negro", price_ars: 9800 },
    { name: "Pincel de cerda 2 pulgadas", price_ars: 1600 },
    { name: "Rodillo de lana 22cm", price_ars: 2200 },
    { name: "Bandeja para pintura plástica", price_ars: 1400 },
    { name: "Lija al agua grano 220 x10", price_ars: 1900 },
    { name: "Removedor de pintura 1L", price_ars: 4600 },
    { name: "Cinta de enmascarar 24mm", price_ars: 1100 },
    { name: "Fondo antióxido 1L", price_ars: 6300 },
    { name: "Barniz marino 1L brillante", price_ars: 8900 },
    { name: "Pintura para piso epoxi 4L", price_ars: 24500 },
  ],
  jardin: [
    { name: "Manguera de riego 25m con boquilla", price_ars: 14500 },
    { name: "Regadera plástica 8L", price_ars: 3200 },
    { name: "Tijera de podar profesional", price_ars: 6800 },
    { name: "Pala de jardín punta redonda", price_ars: 5400 },
    { name: "Rastrillo de metal 14 dientes", price_ars: 4900 },
    { name: "Fertilizante universal 1kg", price_ars: 3600 },
    { name: "Maceta plástica 30cm", price_ars: 2100 },
    { name: "Cortacésped manual", price_ars: 38000 },
    { name: "Guantes de jardinería con puño", price_ars: 1800 },
    { name: "Semillas de césped mezcla premium 1kg", price_ars: 5200 },
  ],
  seguridad: [
    { name: "Casco de seguridad blanco", price_ars: 4200 },
    { name: "Antiparras de protección transparentes", price_ars: 1900 },
    { name: "Guantes de nitrilo x100", price_ars: 3800 },
    { name: "Barbijo N95 x10", price_ars: 4500 },
    { name: "Extintor ABC 5kg", price_ars: 32000 },
    { name: "Detector de humo a pila", price_ars: 6900 },
    { name: "Chaleco reflectivo talle único", price_ars: 2600 },
    { name: "Cinturón de seguridad para altura", price_ars: 28500 },
    { name: "Botiquín de primeros auxilios completo", price_ars: 9800 },
    { name: "Cartel de señalización PVC", price_ars: 1500 },
  ],
};

const PREFIJOS: Record<string, string> = {
  refrigeracion: "REF",
  ferreteria: "FER",
  electricidad: "ELE",
  plomeria: "PLO",
  herramientas: "HER",
  pinturas: "PIN",
  jardin: "JAR",
  seguridad: "SEG",
};

function slugify(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Stock determinístico por índice, cíclico sobre 6 posiciones — da variedad
 * real (AC visual: "sin stock" / bajo / alto) sin `Math.random()` (rompería la
 * idempotencia: dos corridas del seed deben upsertear los MISMOS valores).
 */
function stockPorIndice(i: number): number {
  const ciclo = [0, 3, 8, 25, 60, 150];
  return ciclo[i % ciclo.length]!;
}

/** ~1 de cada 9 queda en `draft` — mismo criterio que el seed canónico (uno de cuatro). */
function statusPorIndice(i: number): "published" | "draft" {
  return i % 9 === 8 ? "draft" : "published";
}

interface ProductoSembrado {
  sku: string;
  slug: string;
  name: string;
  price_ars_cents: number;
  stock: number;
  status: string;
  category: string;
  image_url: string | null;
}

function construirCatalogo(): ProductoSembrado[] {
  const productos: ProductoSembrado[] = [];
  let indiceGlobal = 0;
  for (const categoria of Object.keys(porCategoria)) {
    const base = porCategoria[categoria]!;
    const prefijo = PREFIJOS[categoria]!;
    base.forEach((p, i) => {
      const numero = String(i + 1).padStart(3, "0");
      productos.push({
        sku: `${prefijo}-DEMO-${numero}`,
        slug: `${slugify(p.name)}-demo-${prefijo.toLowerCase()}-${numero}`,
        name: p.name,
        price_ars_cents: p.price_ars * 100,
        stock: stockPorIndice(indiceGlobal),
        status: statusPorIndice(indiceGlobal),
        category: categoria,
        image_url: null,
      });
      indiceGlobal += 1;
    });
  }
  return productos;
}

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

  const productos = construirCatalogo();
  for (const p of productos) {
    const { category, ...rest } = p;
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: { ...rest, category_id: bySlug[category] },
      create: { ...rest, category_id: bySlug[category] },
    });
  }

  const sinStock = productos.filter((p) => p.stock === 0).length;
  const draft = productos.filter((p) => p.status === "draft").length;
  console.log(
    `Seed demo-rich OK: ${categories.length} categorías, ${productos.length} productos ` +
      `(${sinStock} sin stock, ${draft} en borrador).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
