#!/usr/bin/env node
/**
 * Gate de auditoría (AC-5, US-022): cruza el JSON de `pnpm audit
 * --audit-level=high --json` (por stdin) contra las exclusiones nominales de
 * `scripts/.audit-exclusions.json` (raíz) y decide si el árbol de
 * dependencias queda limpio.
 *
 * Cada hallazgo `high`/`critical` tiene que estar o bien AUSENTE del audit, o
 * bien cubierto por una entrada COMPLETA (los cinco campos: package,
 * advisoryId, reason, owner, reviewBy) en `.audit-exclusions.json`. Una
 * entrada incompleta hace fallar el gate igual que un hallazgo sin cubrir —
 * la nominalidad no es opcional (design.md D6).
 *
 * Este script NUNCA decide el umbral de severidad: eso vive hardcodeado en
 * la línea `--audit-level=high` del script invocador (`package.json`
 * `audit:gate`), nunca acá ni en `.audit-exclusions.json`. Es lo que impide
 * que AC-7 se viole por accidente (subir el umbral para esconder hallazgos).
 *
 * Vive fuera de la suite de tests a propósito, mismo estilo que
 * `apps/web/scripts/check-whatsapp-configured.mjs`: script Node plano, sin
 * dependencias nuevas, `console.error` + `process.exit(1)` en el camino de
 * falla.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SEVERITIES_GATED = new Set(['high', 'critical']);

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function loadExclusions() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, '.audit-exclusions.json');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`No se pudo leer ${file}: ${err.message}`);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`${file} no es JSON válido: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error(`${file} debe ser un array (vacío o con exclusiones).`);
    process.exit(1);
  }
  return parsed;
}

function findMalformed(exclusions) {
  const REQUIRED = ['package', 'advisoryId', 'reason', 'owner', 'reviewBy'];
  return exclusions.filter((entry) =>
    REQUIRED.some((field) => !entry || !entry[field]),
  );
}

function extractHighCriticalFindings(auditJson) {
  const advisories = Object.values(auditJson?.advisories ?? {});
  return advisories
    .filter((a) => SEVERITIES_GATED.has(a.severity))
    .map((a) => ({
      package: a.module_name,
      advisoryId: a.github_advisory_id ?? String(a.id),
      severity: a.severity,
      title: a.title,
    }));
}

function isExcluded(finding, exclusions) {
  return exclusions.some(
    (e) => e.package === finding.package && e.advisoryId === finding.advisoryId,
  );
}

async function main() {
  const raw = await readStdin();
  let auditJson;
  try {
    auditJson = JSON.parse(raw || '{}');
  } catch (err) {
    console.error(`El audit recibido por stdin no es JSON válido: ${err.message}`);
    process.exit(1);
  }

  const exclusions = loadExclusions();
  const malformed = findMalformed(exclusions);
  if (malformed.length > 0) {
    console.error(
      `scripts/.audit-exclusions.json tiene ${malformed.length} entrada(s) incompleta(s) ` +
        '(faltan uno o más de: package, advisoryId, reason, owner, reviewBy):',
    );
    console.error(JSON.stringify(malformed, null, 2));
    process.exit(1);
  }

  const findings = extractHighCriticalFindings(auditJson);
  const uncovered = findings.filter((f) => !isExcluded(f, exclusions));

  if (uncovered.length > 0) {
    console.error(
      `${uncovered.length} hallazgo(s) high/critical sin cubrir por ninguna exclusión nominal:`,
    );
    for (const f of uncovered) {
      console.error(`  - ${f.package} (${f.advisoryId}, ${f.severity}): ${f.title}`);
    }
    process.exit(1);
  }

  console.log(
    `OK — ${findings.length} hallazgo(s) high/critical, ${findings.length > 0 ? 'todos cubiertos por exclusión nominal' : 'ninguno'}.`,
  );
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(1);
});
