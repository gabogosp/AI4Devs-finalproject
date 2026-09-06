import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

/**
 * T3 (US-024) — el borde de `PATCH /v1/me` ejercido sin HTTP, mismo patrón
 * que `reports/dto/reports-query.dto.spec.ts`: `plainToInstance` + `validate`
 * es exactamente lo que hace el `ValidationPipe` global (whitelist +
 * forbidNonWhitelisted + transform).
 */
const violaciones = async (payload: unknown) =>
  validate(plainToInstance(UpdateProfileDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('UpdateProfileDto', () => {
  it('nombre no vacío + avatar_url null: sin violaciones (AC-3)', async () => {
    expect(
      await violaciones({ name: 'Ana María Pérez', avatar_url: null }),
    ).toHaveLength(0);
  });

  it('avatar_url http/https válida: sin violaciones (AC-2)', async () => {
    expect(
      await violaciones({
        name: 'Ana',
        avatar_url: 'https://cdn.example.com/ana.jpg',
      }),
    ).toHaveLength(0);
    expect(
      await violaciones({ name: 'Ana', avatar_url: 'http://cdn.example.com/ana.jpg' }),
    ).toHaveLength(0);
  });

  it('nombre vacío: violación (AC-4)', async () => {
    expect(await violaciones({ name: '', avatar_url: null })).not.toHaveLength(0);
  });

  it('nombre sólo espacios: violación tras trim (AC-4)', async () => {
    expect(await violaciones({ name: '   ', avatar_url: null })).not.toHaveLength(0);
  });

  it('nombre de más de 120 caracteres: violación', async () => {
    expect(
      await violaciones({ name: 'a'.repeat(121), avatar_url: null }),
    ).not.toHaveLength(0);
  });

  it('avatar_url no es una URL: violación (AC-5)', async () => {
    expect(
      await violaciones({ name: 'Ana', avatar_url: 'no-es-url' }),
    ).not.toHaveLength(0);
  });

  it('avatar_url con esquema ftp: violación (AC-5)', async () => {
    expect(
      await violaciones({ name: 'Ana', avatar_url: 'ftp://cdn.example.com/ana.jpg' }),
    ).not.toHaveLength(0);
  });

  it('email en el body: violación por forbidNonWhitelisted (AC-6)', async () => {
    expect(
      await violaciones({
        name: 'Ana',
        avatar_url: null,
        email: 'otro@example.com',
      }),
    ).not.toHaveLength(0);
  });
});
