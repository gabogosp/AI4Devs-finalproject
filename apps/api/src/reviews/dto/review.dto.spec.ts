import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertReviewDto, ModerateReviewDto } from './review.dto';

/**
 * T4 (US-025) — mismo patrón que
 * `account/dto/update-profile.dto.spec.ts`: `plainToInstance` + `validate`
 * es exactamente lo que hace el `ValidationPipe` global.
 */
const violacionesUpsert = async (payload: unknown) =>
  validate(plainToInstance(UpsertReviewDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const violacionesModerate = async (payload: unknown) =>
  validate(plainToInstance(ModerateReviewDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('UpsertReviewDto', () => {
  it('rating 0: violación (AC-9)', async () => {
    expect(await violacionesUpsert({ rating: 0, comment: null })).not.toHaveLength(0);
  });

  it('rating 6: violación (AC-9)', async () => {
    expect(await violacionesUpsert({ rating: 6, comment: null })).not.toHaveLength(0);
  });

  it('rating 1: sin violación (borde inferior)', async () => {
    expect(await violacionesUpsert({ rating: 1, comment: null })).toHaveLength(0);
  });

  it('rating 5: sin violación (borde superior)', async () => {
    expect(await violacionesUpsert({ rating: 5, comment: null })).toHaveLength(0);
  });

  it('comment ausente: sin violación (AC-2 — el texto es opcional)', async () => {
    expect(await violacionesUpsert({ rating: 4 })).toHaveLength(0);
  });

  it('comment de más de 2000 caracteres: violación', async () => {
    expect(
      await violacionesUpsert({ rating: 4, comment: 'a'.repeat(2001) }),
    ).not.toHaveLength(0);
  });
});

describe('ModerateReviewDto', () => {
  it('hidden true/false: sin violación', async () => {
    expect(await violacionesModerate({ hidden: true })).toHaveLength(0);
    expect(await violacionesModerate({ hidden: false })).toHaveLength(0);
  });

  it('campo extra: violación por forbidNonWhitelisted', async () => {
    expect(
      await violacionesModerate({ hidden: true, comment: 'no debería aceptarse' }),
    ).not.toHaveLength(0);
  });
});
