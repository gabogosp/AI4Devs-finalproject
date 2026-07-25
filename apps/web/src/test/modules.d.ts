// Declaración ambiente para jest-axe (no publica tipos propios).
declare module 'jest-axe' {
  export function axe(
    html: Element | string | Document,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  export const toHaveNoViolations: {
    toHaveNoViolations: (
      received: unknown,
    ) => { pass: boolean; message: () => string };
  };
  export function configureAxe(
    options?: Record<string, unknown>,
  ): (html: Element | string | Document) => Promise<unknown>;
}
