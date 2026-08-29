import { parseContract } from '@/lib/http/contract';
import {
  confirmPasswordReset,
  getCurrentCustomer,
  loginCustomer,
  logoutCustomer,
  refreshSession,
  registerCustomer,
  requestPasswordReset,
} from '@/api/generated/endpoints';
import {
  ConfirmPasswordResetBody,
  GetCurrentCustomerResponse,
  LoginCustomerResponse,
  RefreshSessionResponse,
  RegisterCustomerResponse,
  RequestPasswordResetBody,
} from '@/api/generated/zod';
import type {
  Customer,
  LoginRequest,
  RegisterRequest,
  ResetConfirm,
  ResetRequest,
} from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO (`frontend-standards` §3.1/§3.2). Nunca a mano.
 */
export type { Customer, LoginRequest, RegisterRequest, ResetConfirm, ResetRequest };

/**
 * Capa de servicio de la cuenta del cliente (US-014). Lo único escrito a mano:
 * la red va por las operaciones **generadas** y la respuesta se valida con el
 * schema Zod **generado** (§3.3).
 *
 * Todos los métodos marcan `session: 'customer'`, que es lo que hace que la
 * llamada salga same-origin y con cookies (ADR-0013, T0.4). Sin la marca, la
 * llamada iría al API directo y la cookie no volvería.
 *
 * Ningún componente importa `@/api/generated/endpoints`: el repositorio esconde
 * el HTTP (§11.5). Ese límite lo verifica el `Verify` de T1.1 con un grep sobre
 * `apps/web/**`.
 */
const conSesion = { session: 'customer' } as const;

export const accountService = {
  /** AC-1: alta con sesión activa inmediata, sin verificación de email. */
  async register(input: RegisterRequest): Promise<Customer> {
    const res = await registerCustomer(input, conSesion);
    return parseContract(RegisterCustomerResponse, res.data).customer;
  },

  /** AC-2. Los tres fallos posibles llegan como el mismo 401 (AC-5). */
  async login(input: LoginRequest): Promise<Customer> {
    const res = await loginCustomer(input, conSesion);
    return parseContract(LoginCustomerResponse, res.data).customer;
  },

  /**
   * AC-3. El 204 no trae cuerpo, así que no hay contrato que validar — parsear
   * un cuerpo vacío fallaría por la forma, no por el hecho.
   */
  async logout(): Promise<void> {
    await logoutCustomer(conSesion);
  },

  /**
   * Renovación explícita. El uso normal es `refreshOnce()` de
   * `lib/http/customerSession`, que coalesce las concurrentes (T0.6): llamar
   * esto en paralelo es exactamente lo que el backend lee como reuso de token.
   */
  async refresh(): Promise<Customer> {
    const res = await refreshSession(conSesion);
    return parseContract(RefreshSessionResponse, res.data).customer;
  },

  /** El destino de la sesión: quién soy según el servidor, no según el cliente. */
  async me(): Promise<Customer> {
    const res = await getCurrentCustomer(conSesion);
    // `me` devuelve el cliente plano, no envuelto: es la forma del contrato.
    return parseContract(GetCurrentCustomerResponse, res.data);
  },

  /**
   * AC-11: el backend responde 202 **siempre**, exista o no la cuenta. La UI no
   * puede decir "te mandamos un mail" sólo si existía, porque eso convertiría
   * el formulario en un oráculo de qué emails están registrados.
   */
  async requestReset(input: ResetRequest): Promise<void> {
    parseContract(RequestPasswordResetBody, input);
    await requestPasswordReset(input, conSesion);
  },

  /** AC-4/AC-7: token de un solo uso; vencido, usado e inexistente dan el mismo 400. */
  async confirmReset(input: ResetConfirm): Promise<void> {
    parseContract(ConfirmPasswordResetBody, input);
    await confirmPasswordReset(input, conSesion);
  },
};
