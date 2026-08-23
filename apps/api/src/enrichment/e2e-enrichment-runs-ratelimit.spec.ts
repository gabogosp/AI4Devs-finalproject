import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { adminToken } from '../../test/e2e-app';

/**
 * T4.2 (parte de rate-limit) — `POST /v1/admin/enrichment/runs` bajo presupuesto agotado.
 *
 * Vive en su propio archivo por una razón técnica: el `@Throttle` del controller lee el tope
 * de `process.env` **al cargar la clase** (los decoradores se evalúan antes del contenedor),
 * así que bajarlo requiere setear la variable antes del primer `import` del módulo. Por eso
 * acá el módulo se carga con `await import()` dentro del `beforeAll`, y los imports estáticos
 * son sólo de tipos.
 *
 * Lo que se protege: esta es la única superficie de la API donde un request de más cuesta
 * **plata** (llamadas pagas al proveedor de IA). Sin tope, un script —o un panel con un botón
 * que reintenta— puede quemar la cuota del mes en minutos.
 */
describe('POST /v1/admin/enrichment/runs — rate-limit (e2e-enrichment-runs-ratelimit)', () => {
  const ruta = '/v1/admin/enrichment/runs';
  const LIMITE = 2;
  let app: INestApplication;

  beforeAll(async () => {
    // Antes de cargar el módulo: el decorador captura este valor.
    process.env.ENRICHMENT_RATE_LIMIT_MAX = String(LIMITE);
    process.env.ENRICHMENT_RATE_LIMIT_TTL_MS = '60000';
    // `X-Forwarded-For` aísla el cubo por test; sin esto todos comparten 127.0.0.1 y el orden
    // de ejecución decide quién pasa.
    process.env.TRUST_PROXY_HOPS = '1';
    // Sin proveedor no hay corrida: el runner queda `disabled` y ninguna de estas llamadas
    // toca el catálogo de las otras suites. Lo que se prueba es el borde, no el barrido.
    process.env.ENRICHMENT_ENABLED = 'false';

    const [
      { AppConfigModule },
      { PrismaModule },
      { CatalogEventsModule },
      { configureApp },
      { EnrichmentModule },
    ] = await Promise.all([
      import('../config/config.module'),
      import('../prisma/prisma.module'),
      import('../observability/catalog-events.module'),
      import('../bootstrap'),
      import('./enrichment.module'),
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, CatalogEventsModule, EnrichmentModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.ENRICHMENT_RATE_LIMIT_MAX;
    delete process.env.ENRICHMENT_RATE_LIMIT_TTL_MS;
    delete process.env.TRUST_PROXY_HOPS;
    delete process.env.ENRICHMENT_ENABLED;
  });

  const post = (ip: string) =>
    request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .send({});

  it('el POST N+1 devuelve 429 con Retry-After y RateLimit-*', async () => {
    const ip = '10.30.0.1';

    const dentro = [];
    for (let i = 0; i < LIMITE; i += 1) dentro.push((await post(ip)).status);
    // Dentro del presupuesto la respuesta es del handler (202) o el 409/503 del estado del
    // runner — lo que importa es que NO es 429.
    expect(dentro.every((c) => c !== 429)).toBe(true);

    const excedido = await post(ip);

    expect(excedido.status).toBe(429);
    expect(excedido.headers['content-type']).toContain('application/problem+json');
    expect(excedido.headers['retry-after']).toBeDefined();
    expect(excedido.headers['ratelimit-limit']).toBe(String(LIMITE));
    expect(excedido.headers['ratelimit-remaining']).toBe('0');
    expect(excedido.headers['ratelimit-reset']).toBeDefined();
    expect(excedido.body.status).toBe(429);
  });

  it('el cubo es por IP: otro cliente no hereda el bloqueo del anterior', async () => {
    const quemada = '10.30.0.2';
    for (let i = 0; i <= LIMITE; i += 1) await post(quemada);
    expect((await post(quemada)).status).toBe(429);

    // El dueño desde otra red no puede quedar bloqueado por lo que hizo un tercero.
    expect((await post('10.30.0.3')).status).not.toBe(429);
  });

  it('el GET /status NO gasta el presupuesto del POST', async () => {
    // El panel consulta el estado en loop mientras corre un run: si las lecturas gastaran el
    // cubo del POST, mirar la barra de progreso dejaría al dueño sin poder disparar nada.
    const ip = '10.30.0.4';
    for (let i = 0; i < 20; i += 1) {
      await request(app.getHttpServer())
        .get('/v1/admin/enrichment/status')
        .set('Authorization', `Bearer ${adminToken()}`)
        .set('X-Forwarded-For', ip)
        .expect(200);
    }

    expect((await post(ip)).status).not.toBe(429);
  });
});
