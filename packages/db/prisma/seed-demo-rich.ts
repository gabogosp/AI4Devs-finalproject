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
  /** C3a — descripción realista para la ficha pública (`description_raw`). */
  description: string;
}

// Nombres reales del rubro ferretería/plomería/electricidad/refrigeración —
// varios eligiendos a propósito para pegar con términos de búsqueda comunes
// (compresor, refrigerante, cable, taladro, pintura, manguera).
const porCategoria: Record<string, ProductoBase[]> = {
  refrigeracion: [
    { name: "Compresor 1/4 HP", price_ars: 85000, description: "Compresor hermético para heladeras y freezers domésticos, bajo consumo y arranque silencioso." },
    { name: "Compresor 1/2 HP", price_ars: 145000, description: "Compresor de mayor potencia para exhibidoras y cámaras chicas, ciclo continuo." },
    { name: "Gas refrigerante R134a 1kg", price_ars: 22000, description: "Gas refrigerante para equipos domésticos y automotrices, envase recargable de 1kg." },
    { name: "Gas refrigerante R410a 1kg", price_ars: 26000, description: "Gas ecológico para aires acondicionados split, alta eficiencia y menor presión de trabajo." },
    { name: "Termostato digital para heladera", price_ars: 18000, description: "Control de temperatura digital con sonda, reemplazo directo para heladeras comerciales." },
    { name: "Válvula de expansión termostática", price_ars: 31000, description: "Regula el flujo de refrigerante según la carga térmica, para sistemas de mediana capacidad." },
    { name: "Filtro secador de línea", price_ars: 9500, description: "Elimina humedad y partículas del circuito de refrigeración, instalación en línea de líquido." },
    { name: "Manómetro doble para carga de gas", price_ars: 42000, description: "Set de manómetros de alta y baja presión con mangueras, para diagnóstico y carga de gas." },
    { name: "Bomba de vacío 1/4 HP", price_ars: 98000, description: "Bomba de dos etapas para vacío profundo antes de la carga de gas refrigerante." },
    { name: "Cañería de cobre 3/8 x 5m", price_ars: 27500, description: "Rollo de cobre flexible para instalaciones de refrigeración y aire acondicionado." },
    { name: "Aislante térmico para cañería 2m", price_ars: 6800, description: "Espuma aislante para cañerías de cobre, evita condensación y pérdida de frío." },
    { name: "Ventilador axial para condensadora", price_ars: 21000, description: "Motoventilador de repuesto para unidades condensadoras, montaje estándar." },
    { name: "Relé de arranque para compresor", price_ars: 7200, description: "Relé de arranque PTC para compresores domésticos, repuesto de reemplazo directo." },
    { name: "Capacitor de arranque 35uF", price_ars: 5400, description: "Capacitor de arranque para motores monofásicos, uso en heladeras y equipos de aire." },
    { name: "Compresor 1 HP trifásico", price_ars: 210000, description: "Compresor de alta capacidad para cámaras frigoríficas y equipos comerciales trifásicos." },
  ],
  ferreteria: [
    { name: "Taladro percutor 650W", price_ars: 45000, description: "Taladro percutor de uso general, mandril de 13mm, ideal para mampostería y madera." },
    { name: "Taladro atornillador a batería 18V", price_ars: 62000, description: "Taladro inalámbrico con batería de litio, incluye maletín y dos velocidades." },
    { name: "Amoladora angular 115mm", price_ars: 38000, description: "Amoladora compacta para corte y desbaste de metal, disco de 115mm incluido." },
    { name: "Sierra caladora 500W", price_ars: 41000, description: "Sierra caladora con velocidad variable, para cortes curvos en madera y plástico." },
    { name: "Set de destornilladores x6", price_ars: 8500, description: "Juego de 6 destornilladores planos y phillips, mango ergonómico antideslizante." },
    { name: "Llave inglesa 10 pulgadas", price_ars: 5200, description: "Llave ajustable de acero cromado, apertura de mordaza hasta 30mm." },
    { name: "Martillo de carpintero 500g", price_ars: 4300, description: "Martillo con cabeza de acero forjado y mango de fibra de vidrio antivibración." },
    { name: "Nivel láser autonivelante", price_ars: 33000, description: "Nivel láser de línea cruzada, autonivelante, para instalaciones y alineación de muebles." },
    { name: "Cinta métrica 5m", price_ars: 2100, description: "Cinta métrica retráctil de 5 metros, carcasa de goma antigolpes." },
    { name: "Tornillos autoperforantes caja x100", price_ars: 3400, description: "Caja de 100 tornillos autoperforantes para chapa, punta broca incluida." },
    { name: "Tarugos plásticos x50", price_ars: 1800, description: "Bolsa de 50 tarugos plásticos universales para fijaciones en mampostería." },
    { name: "Pistola de silicona eléctrica", price_ars: 6900, description: "Pistola encoladora eléctrica, calienta en minutos, para barras de silicona estándar." },
    { name: "Caja de herramientas plástica 19 pulgadas", price_ars: 12500, description: "Caja organizadora con bandeja removible y cierre reforzado, 19 pulgadas." },
    { name: "Sierra circular 1200W", price_ars: 58000, description: "Sierra circular de banco/mano para cortes rectos en madera, disco de 185mm." },
    { name: "Lijadora orbital 300W", price_ars: 34000, description: "Lijadora orbital con sistema de aspiración de polvo, para acabados finos." },
  ],
  electricidad: [
    { name: "Cable unipolar 2.5mm x100m", price_ars: 38000, description: "Cable unipolar normalizado IRAM, rollo de 100m, para tomacorrientes domiciliarios." },
    { name: "Cable unipolar 4mm x100m", price_ars: 54000, description: "Cable unipolar de mayor sección, rollo de 100m, para circuitos de mayor carga." },
    { name: "Cable unipolar 6mm x100m", price_ars: 79000, description: "Cable unipolar 6mm, rollo de 100m, para alimentación de tableros y termotanques." },
    { name: "Térmica bipolar 25A", price_ars: 6400, description: "Interruptor termomagnético bipolar de 25A para protección de circuitos." },
    { name: "Disyuntor diferencial 40A", price_ars: 15800, description: "Disyuntor diferencial de 40A/30mA, protección contra descargas eléctricas." },
    { name: "Tomacorriente doble con tierra", price_ars: 3200, description: "Módulo de tomacorriente doble con puesta a tierra, línea residencial." },
    { name: "Interruptor simple", price_ars: 1900, description: "Interruptor de un punto, línea residencial, instalación embutida." },
    { name: "Ficha macho reforzada", price_ars: 1400, description: "Ficha macho de goma reforzada, uso industrial y doméstico." },
    { name: "Cinta aisladora 3M x10", price_ars: 4500, description: "Pack de 10 rollos de cinta aisladora, resistente a la humedad." },
    { name: "Portalámparas de porcelana", price_ars: 1100, description: "Portalámparas de porcelana para instalación fija, rosca E27." },
    { name: "Lámpara LED 9W luz cálida", price_ars: 1600, description: "Lámpara LED de bajo consumo, rosca E27, equivalente a 60W incandescente." },
    { name: "Tablero eléctrico 12 bocas", price_ars: 9800, description: "Tablero seccional de embutir para 12 térmicas, incluye riel DIN." },
    { name: "Caño corrugado 3/4 x25m", price_ars: 11200, description: "Caño corrugado flexible para cableado embutido, rollo de 25 metros." },
    { name: "Cable unipolar 10mm x100m", price_ars: 118000, description: "Cable unipolar de alta sección, rollo de 100m, para acometidas y cargas altas." },
    { name: "Reflector LED 50W exterior", price_ars: 8700, description: "Reflector LED apto intemperie, IP65, para iluminación exterior y galpones." },
  ],
  plomeria: [
    { name: "Caño PVC 1/2 pulgada x4m", price_ars: 4200, description: "Caño de PVC roscable para agua fría, tramo de 4 metros." },
    { name: "Caño PVC 3/4 pulgada x4m", price_ars: 5600, description: "Caño de PVC de mayor diámetro para instalaciones de agua, tramo de 4 metros." },
    { name: "Codo PVC 90° 1/2 pulgada", price_ars: 450, description: "Codo de PVC de 90 grados para cambios de dirección en cañerías de agua." },
    { name: "Llave de paso 1/2 pulgada", price_ars: 3800, description: "Llave de paso esférica de bronce, corte total del suministro de agua." },
    { name: "Canilla monocomando para cocina", price_ars: 24500, description: "Grifería monocomando de cocina con caño alto giratorio, terminación cromada." },
    { name: "Manguera de goma reforzada 20m", price_ars: 18900, description: "Manguera de riego reforzada, 20 metros, resistente a rayos UV." },
    { name: "Sifón universal para pileta", price_ars: 3100, description: "Sifón flexible universal para bacha de cocina o baño." },
    { name: "Flexible de agua 40cm", price_ars: 1500, description: "Conexión flexible de acero trenzado para artefactos sanitarios, 40cm." },
    { name: "Cinta teflón x10", price_ars: 900, description: "Pack de 10 rollos de cinta teflón para sellado de roscas." },
    { name: "Pegamento para PVC 250ml", price_ars: 2700, description: "Adhesivo de contacto para uniones de cañerías de PVC, pomo de 250ml." },
    { name: "Rejilla de piso 10x10cm", price_ars: 1200, description: "Rejilla de piso de acero inoxidable, desagüe de baño o patio." },
    { name: "Cañería de cobre 1/2 x5m", price_ars: 19800, description: "Cañería de cobre rígida para instalaciones de gas o agua, tramo de 5 metros." },
    { name: "Bomba sumergible para pozo", price_ars: 62000, description: "Bomba sumergible para extracción de agua de pozo, motor monofásico." },
  ],
  herramientas: [
    { name: "Set de llaves combinadas x12", price_ars: 22000, description: "Juego de 12 llaves combinadas de 8 a 19mm, acero al cromo vanadio." },
    { name: "Pinza de electricista aislada", price_ars: 4800, description: "Pinza universal con mango aislado hasta 1000V, uso eléctrico." },
    { name: "Multímetro digital", price_ars: 15600, description: "Multímetro digital para medición de voltaje, corriente y continuidad." },
    { name: "Soldador eléctrico 40W", price_ars: 5900, description: "Soldador de estaño de 40W, punta reemplazable, uso electrónico." },
    { name: "Estaño para soldar 100g", price_ars: 3200, description: "Rollo de estaño 60/40 con núcleo de resina, 100 gramos." },
    { name: "Compresor de aire 24L", price_ars: 145000, description: "Compresor de aire con tanque de 24 litros, para herramientas neumáticas." },
    { name: "Pistola neumática para pintar", price_ars: 28000, description: "Pistola de pintar a aire comprimido, pico de 1.4mm, uso profesional." },
    { name: "Escalera de aluminio 5 escalones", price_ars: 42000, description: "Escalera plegable de aluminio, 5 escalones, base antideslizante." },
    { name: "Carretilla reforzada", price_ars: 55000, description: "Carretilla de obra con caja reforzada y rueda neumática." },
    { name: "Guantes de trabajo reforzados", price_ars: 2400, description: "Guantes de cuero reforzado para trabajos de obra y manipulación de cargas." },
    { name: "Generador eléctrico 2000W", price_ars: 185000, description: "Generador portátil a nafta, 2000W, arranque manual, ideal para obra o emergencias." },
  ],
  pinturas: [
    { name: "Pintura látex interior 20L blanco", price_ars: 68000, description: "Látex interior blanco, balde de 20 litros, alto rendimiento y lavable." },
    { name: "Pintura esmalte sintético 1L negro", price_ars: 9800, description: "Esmalte sintético brillante color negro, para metal y madera, 1 litro." },
    { name: "Pincel de cerda 2 pulgadas", price_ars: 1600, description: "Pincel de cerda natural de 2 pulgadas, para esmaltes y barnices." },
    { name: "Rodillo de lana 22cm", price_ars: 2200, description: "Rodillo de lana de 22cm para pintura de interiores, pelo mediano." },
    { name: "Bandeja para pintura plástica", price_ars: 1400, description: "Bandeja plástica con rejilla escurridora para rodillo, tamaño estándar." },
    { name: "Lija al agua grano 220 x10", price_ars: 1900, description: "Pack de 10 hojas de lija al agua grano 220, para preparación de superficies." },
    { name: "Removedor de pintura 1L", price_ars: 4600, description: "Removedor de pintura en gel para madera y metal, 1 litro." },
    { name: "Cinta de enmascarar 24mm", price_ars: 1100, description: "Cinta de papel para enmascarar antes de pintar, 24mm x 40m." },
    { name: "Fondo antióxido 1L", price_ars: 6300, description: "Fondo antióxido para metales ferrosos, base para esmalte sintético, 1 litro." },
    { name: "Barniz marino 1L brillante", price_ars: 8900, description: "Barniz marino brillante, alta resistencia a la intemperie, 1 litro." },
    { name: "Pintura para piso epoxi 4L", price_ars: 24500, description: "Pintura epoxi bicomponente para pisos de garaje y taller, 4 litros." },
  ],
  jardin: [
    { name: "Manguera de riego 25m con boquilla", price_ars: 14500, description: "Manguera de riego de 25 metros con boquilla rociadora regulable incluida." },
    { name: "Regadera plástica 8L", price_ars: 3200, description: "Regadera plástica de 8 litros con alcachofa removible." },
    { name: "Tijera de podar profesional", price_ars: 6800, description: "Tijera de podar de acero al carbono, corte bypass, mango ergonómico." },
    { name: "Pala de jardín punta redonda", price_ars: 5400, description: "Pala de jardín con punta redonda, cabo de madera, uso general." },
    { name: "Rastrillo de metal 14 dientes", price_ars: 4900, description: "Rastrillo de metal de 14 dientes para hojas y recolección de residuos." },
    { name: "Fertilizante universal 1kg", price_ars: 3600, description: "Fertilizante granulado universal para plantas de jardín y huerta, 1kg." },
    { name: "Maceta plástica 30cm", price_ars: 2100, description: "Maceta plástica de 30cm de diámetro con plato, apta exterior." },
    { name: "Cortacésped manual", price_ars: 38000, description: "Cortacésped manual a rodillo, sin motor, ideal para jardines chicos." },
    { name: "Guantes de jardinería con puño", price_ars: 1800, description: "Guantes de jardinería con puño protector, resistentes a espinas." },
    { name: "Semillas de césped mezcla premium 1kg", price_ars: 5200, description: "Mezcla premium de semillas de césped, rápida germinación, bolsa de 1kg." },
  ],
  seguridad: [
    { name: "Casco de seguridad blanco", price_ars: 4200, description: "Casco de seguridad con arnés ajustable, homologado para obra." },
    { name: "Antiparras de protección transparentes", price_ars: 1900, description: "Antiparras de policarbonato transparente, protección UV, antiempañante." },
    { name: "Guantes de nitrilo x100", price_ars: 3800, description: "Caja de 100 guantes de nitrilo descartables, sin polvo, talle único." },
    { name: "Barbijo N95 x10", price_ars: 4500, description: "Pack de 10 barbijos N95 con válvula de exhalación, filtrado de partículas." },
    { name: "Extintor ABC 5kg", price_ars: 32000, description: "Extintor de polvo químico ABC de 5kg, para fuegos de clase A, B y C." },
    { name: "Detector de humo a pila", price_ars: 6900, description: "Detector de humo fotoeléctrico a pila, montaje en techo, alarma sonora." },
    { name: "Chaleco reflectivo talle único", price_ars: 2600, description: "Chaleco reflectivo de alta visibilidad, cinta reflectante doble banda." },
    { name: "Cinturón de seguridad para altura", price_ars: 28500, description: "Arnés/cinturón de seguridad para trabajo en altura, con enganches dobles." },
    { name: "Botiquín de primeros auxilios completo", price_ars: 9800, description: "Botiquín equipado para el hogar o el trabajo, gasas, vendas y antisépticos." },
    { name: "Cartel de señalización PVC", price_ars: 1500, description: "Cartel de señalización en PVC rígido, resistente a la intemperie." },
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
  description_raw: string;
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
        description_raw: p.description,
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
