// Store del token de sesión admin, desacoplado del cliente HTTP. La sesión
// (Fase 4) lo setea; el cliente lo lee para inyectar el header Authorization.
// US-014 endurecerá el mecanismo (cookie httpOnly) sin tocar al cliente.
let authToken: string | null = null;

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(token: string | null): void {
  authToken = token;
}
