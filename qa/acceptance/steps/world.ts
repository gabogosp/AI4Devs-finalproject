import {
  After,
  Before,
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

const BASE = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';
const WEB = process.env.QA_WEB_BASE_URL ?? 'http://localhost:3100';

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
