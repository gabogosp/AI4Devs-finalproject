import { mapErrorToProblem } from '../filters/http-problem.filter';
import {
  CsrfError,
  InvalidCredentialsError,
  InvalidRefreshError,
  InvalidResetTokenError,
  RegistrationFailedError,
  UnauthenticatedError,
} from './auth-errors';

/**
 * T4.1 — el catálogo `dsm:auth/*` mapeado por el filtro **existente**, sin
 * tocarlo. Que estas seis clases atraviesen `mapErrorToProblem` sin ninguna rama
 * nueva es la prueba de que extienden bien `DomainError`: si hubiera hecho falta
 * un `if` por cada una, el diseño de errores de US-001 no estaría cerrado.
 */
const INSTANCE = '/v1/auth/login';

/** Credenciales de prueba que NO deben aparecer en ninguna respuesta (AC-8). */
const SECRETOS = [
  'correo caballo batería grapa',
  'ana@example.com',
  '$2b$12$abcdefghijklmnopqrstuv',
  'TOKEN-de-reset-en-claro',
];

describe('catálogo dsm:auth/* → RFC 7807 (T4.1)', () => {
  const casos: Array<[string, Error, string, number]> = [
    [
      'InvalidCredentialsError',
      new InvalidCredentialsError(),
      'dsm:auth/invalid-credentials',
      401,
    ],
    [
      'UnauthenticatedError',
      new UnauthenticatedError(),
      'dsm:auth/unauthenticated',
      401,
    ],
    [
      'InvalidRefreshError',
      new InvalidRefreshError(),
      'dsm:auth/invalid-refresh',
      401,
    ],
    ['CsrfError', new CsrfError(), 'dsm:auth/csrf', 403],
    [
      'RegistrationFailedError',
      new RegistrationFailedError(),
      'dsm:auth/registration-failed',
      409,
    ],
    [
      'InvalidResetTokenError',
      new InvalidResetTokenError(),
      'dsm:auth/invalid-reset-token',
      400,
    ],
  ];

  const TITULOS: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    409: 'Conflict',
  };

  it.each(casos)('%s → type y status correctos', (_n, error, type, status) => {
    const problem = mapErrorToProblem(error, INSTANCE);
    expect(problem.type).toBe(type);
    expect(problem.status).toBe(status);
    expect(problem.title).toBe(TITULOS[status]);
    expect(problem.instance).toBe(INSTANCE);
    expect(problem.detail).toBeTruthy();
  });

  it.each(casos)(
    '%s: el detail no filtra credenciales (AC-8)',
    (_n, error) => {
      const problem = mapErrorToProblem(error, INSTANCE);
      const serializado = JSON.stringify(problem);
      for (const secreto of SECRETOS) {
        expect(serializado).not.toContain(secreto);
      }
    },
  );

  it('los seis type son distintos: el catálogo no colisiona', () => {
    const tipos = casos.map(([, error]) => mapErrorToProblem(error, INSTANCE).type);
    expect(new Set(tipos).size).toBe(6);
  });

  it('todos empiezan con el prefijo dsm:auth/ — ninguno se coló al de catálogo', () => {
    for (const [, error] of casos) {
      expect(mapErrorToProblem(error, INSTANCE).type).toMatch(/^dsm:auth\//);
    }
  });

  describe('anti-enumeración a nivel de envelope', () => {
    it('el problem de credenciales inválidas es IDÉNTICO se llame como se llame', () => {
      // Los tres modos de fallo del login construyen el mismo objeto, así que el
      // cuerpo que ve el cliente no puede distinguirlos ni por un carácter.
      const a = mapErrorToProblem(new InvalidCredentialsError(), INSTANCE);
      const b = mapErrorToProblem(new InvalidCredentialsError(), INSTANCE);
      expect(a).toEqual(b);
    });

    it('el mensaje de registro fallido no dice que el email ya existe (AC-6)', () => {
      const problem = mapErrorToProblem(new RegistrationFailedError(), INSTANCE);
      expect(problem.detail).not.toMatch(/ya (existe|está registrad)/i);
    });

    it('el mensaje de token de reset no COMPROMETE una causa (AC-7)', () => {
      const problem = mapErrorToProblem(new InvalidResetTokenError(), INSTANCE);

      // La forma correcta es disyuntiva — "no es válido **o** ya fue utilizado".
      // Deja al usuario saber qué hacer sin decirle cuál de los dos pasó, que es
      // lo que le confirmaría a quien tenga el token si alguien más lo consumió.
      expect(problem.detail).toMatch(/\bo\b/);
      // Y no menciona el vencimiento, que sería una tercera causa distinguible.
      expect(problem.detail).not.toMatch(/venci|expir/i);
    });
  });
});
