import {
  After,
  Before,
  BeforeAll,
  setWorldConstructor,
  World,
  type IWorldOptions,
} from '@cucumber/cucumber';
import {
  chromium,
  request,
  type APIRequestContext,
  type Browser,
  type Page,
} from '@playwright/test';
import { adminAuth } from '../../support/admin-auth';
import {
  QA_API_BASE_URL,
  QA_WEB_BASE_URL,
  verificarEntornoQA,
} from '../../support/qa-env';

const BASE = QA_API_BASE_URL;
const WEB = QA_WEB_BASE_URL;

/**
 * Chequeo de entorno **una vez por corrida**, antes del primer escenario: si la
 * API no está o no admite el `Origin` de la suite, la corrida falla con un mensaje
 * que dice qué levantar, en vez de producir asserts de dominio que mienten sobre
 * dónde está el problema (D-4).
 */
BeforeAll(async function () {
  await verificarEntornoQA();
});

/**
 * World de la aceptación cross-stack (API-level: Playwright APIRequestContext
 * contra la API real, con auth REAL vía el fixture). Aislado por escenario.
 */
export class CatalogWorld extends World {
  admin!: APIRequestContext;
  anon!: APIRequestContext;
  token = '';
  state: Record<string, unknown> = {};

  /** Browser perezoso: sólo los escenarios de UI lo levantan (US-003+). */
  private browser?: Browser;
  page?: Page;

  /** Abre una ruta del storefront en un browser real. */
  async visitar(ruta: string): Promise<Page> {
    if (!this.page) {
      this.browser = await chromium.launch();
      const ctx = await this.browser.newContext({ baseURL: WEB });
      this.page = await ctx.newPage();
    }
    await this.page.goto(ruta);
    return this.page;
  }

  async cerrarBrowser(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(CatalogWorld);

Before(async function (this: CatalogWorld) {
  this.token = await adminAuth(); // login real (fixture, ADMIN_BOOTSTRAP_TOKEN)
  this.admin = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { authorization: `Bearer ${this.token}` },
  });
  this.anon = await request.newContext({ baseURL: BASE });
  this.state = {};
});

After(async function (this: CatalogWorld) {
  await this.cerrarBrowser();
  await this.admin?.dispose();
  await this.anon?.dispose();
});
