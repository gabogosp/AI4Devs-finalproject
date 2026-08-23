'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppErrorException, type AppError } from '@/lib/http/errors';
import { setOnSessionLost } from '@/lib/http/customerSession';
import { accountService, type Customer } from './accountService';
import { hasSessionHint, setSessionHint, type SessionState } from './sessionState';

interface SessionContextValue {
  state: SessionState;
  /** La llama el formulario de login/registro tras un alta exitosa. */
  onAuthenticated: (customer: Customer) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Holder del estado de sesión (`frontend-standards` §9.3). Es `'use client'` y
 * **hoja**: el layout que lo monta sigue siendo Server Component, porque los
 * children pasados como prop se renderizan en servidor igual.
 *
 * Bootstrap perezoso (OQ-FE-4): sin la marca `dsm.session` no se toca la red.
 * El visitante anónimo no paga un request, no consume rate-limit y el header no
 * parpadea.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ kind: 'unknown' });

  const onAuthenticated = useCallback((customer: Customer) => {
    setSessionHint(true);
    setState({ kind: 'authenticated', customer });
  }, []);

  const logout = useCallback(async () => {
    try {
      await accountService.logout();
    } catch {
      // Se traga a propósito y NO se re-lanza: desde la perspectiva del cliente
      // la sesión se cerró, así que rechazar obligaría a cada caller a manejar
      // un error de algo que, para él, salió bien.
      //
      // Lo que sí se pierde: si el backend no recibió el logout, el refresh
      // token sigue vivo del lado del servidor hasta que expire. Por eso su TTL
      // es una decisión de seguridad y no una comodidad — un logout que no
      // llega deja una ventana del tamaño de ese TTL.
    } finally {
      // Se limpia SIEMPRE, aunque el backend falle: dejar la marca puesta
      // haría que la próxima carga intente `/auth/me` contra una sesión que el
      // usuario ya quiso cerrar.
      setSessionHint(false);
      setState({ kind: 'anonymous' });
    }
  }, []);

  useEffect(() => {
    // El mutator avisa cuando el refresh falló: la sesión se perdió de verdad.
    setOnSessionLost(() => {
      setSessionHint(false);
      setState({ kind: 'anonymous' });
    });
  }, []);

  useEffect(() => {
    let vigente = true;

    if (!hasSessionHint()) {
      setState({ kind: 'anonymous' });
      return;
    }

    setState({ kind: 'authenticating' });
    accountService
      .me()
      .then((customer) => {
        if (vigente) setState({ kind: 'authenticated', customer });
      })
      .catch((e: unknown) => {
        if (!vigente) return;
        const error: AppError =
          e instanceof AppErrorException
            ? e.appError
            : { kind: 'network', message: 'No pudimos verificar tu sesión' };

        if (error.kind === 'unauthorized' || error.kind === 'forbidden') {
          // La marca mentía: la sesión ya no existe. Se borra para que la
          // próxima carga no vuelva a preguntar.
          setSessionHint(false);
          setState({ kind: 'anonymous' });
          return;
        }
        // Fallo de red: NO es anónimo. Se conserva la marca y el header no
        // muestra "Ingresar", que le diría al cliente algo que no sabemos.
        setState({ kind: 'error', error });
      });

    return () => {
      vigente = false;
    };
  }, []);

  const value = useMemo(
    () => ({ state, onAuthenticated, logout }),
    [state, onAuthenticated, logout],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession debe usarse dentro de <SessionProvider>');
  }
  return ctx;
}
