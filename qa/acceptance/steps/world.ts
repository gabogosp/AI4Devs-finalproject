import {
  After,
  Before,
  setWorldConstructor,
  World,
  type IWorldOptions,
} from '@cucumber/cucumber';
import { request, type APIRequestContext } from '@playwright/test';
import { adminAuth } from '../../support/admin-auth';

const BASE = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';

/**
 * World de la aceptación cross-stack (API-level: Playwright APIRequestContext
 * contra la API real, con auth REAL vía el fixture). Aislado por escenario.
 */
export class CatalogWorld extends World {
  admin!: APIRequestContext;
  anon!: APIRequestContext;
  token = '';
  state: Record<string, unknown> = {};

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
  await this.admin?.dispose();
  await this.anon?.dispose();
});
