import jwt from 'jsonwebtoken';
import { adminAuthWithSource } from './admin-auth';

/**
 * Smoke del fixture de auth. Reporta **qué rama resolvió**: un OK que no
 * distingue login-real de fallback minteado es justamente el verde que puede
 * tapar una costura rota (testing-standards §14.2).
 *
 * `--require-real` exige la rama de login real (lo que corre CI y lo que usa el
 * Verify de T1.2 cuando la API está arriba).
 */
const REQUIRE_REAL = process.argv.includes('--require-real');

async function main(): Promise<void> {
  const { token, source } = await adminAuthWithSource();

  const decoded = jwt.decode(token) as { role?: string } | null;
  if (!decoded || decoded.role !== 'admin') {
    console.error('FAIL: el token no tiene claim role=admin');
    process.exit(1);
  }

  if (REQUIRE_REAL && source !== 'real-login') {
    console.error(
      `FAIL: se exigía la rama de login real y se resolvió por "${source}".`,
    );
    process.exit(1);
  }

  console.log(
    `OK: JWT role=admin obtenido vía ${source} (${token.slice(0, 24)}…)`,
  );
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
