'use client';

import { useEffect } from 'react';
import { useCartContext } from './CartProvider';
import { CartItemRow } from './CartItemRow';
import { CartSummary } from './CartSummary';
import { CartEmptyState } from './CartEmptyState';

/**
 * Composición de los **cuatro** estados del carrito, explícita y no un
 * `if (data)` que los cubra a todos (`frontend-standards.md` §11.9).
 *
 * Es un Client Component porque no puede ser otra cosa: `client.ts` **lanza** si
 * una llamada con sesión sale del servidor (US-014 `design.md` D3), y el carrito
 * es dato personalizado por definición — si se renderizara en servidor, Next
 * podría dejarlo en la Data Cache y servírselo a otra persona. La contraparte es
 * el `noindex` de la página: un carrito no es contenido público.
 */
export function CartPage() {
  const { state, reload, setQuantity, remove } = useCartContext();

  useEffect(() => {
    // El badge del layout ya dispara la lectura al montar; `reload` es
    // single-flight, así que abrir la página no agrega un segundo GET.
    void reload();
  }, [reload]);

  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <h1 className="text-2xl font-semibold">Tu carrito</h1>
        <div aria-busy="true" aria-live="polite" className="mt-6 flex flex-col gap-4">
          <span className="sr-only">Cargando tu carrito…</span>
          {[0, 1].map((i) => (
            <div key={i} data-testid="cart-skeleton" className="h-24 animate-pulse rounded-md bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  const cart = state.kind === 'ready' ? state.cart : state.cart;

  return (
    <div className="mx-auto max-w-5xl p-4">
      {state.kind === 'error' && (
        <div role="alert" className="mb-4 flex flex-col items-start gap-2 rounded-md border border-border bg-surface p-4">
          <p className="text-sm">{state.error.message}</p>
          {/* El carrito previo sigue a la vista debajo: un fallo de red no puede
              parecer un carrito borrado. */}
          <button
            type="button"
            onClick={() => void reload()}
            className="min-h-[44px] text-sm font-medium text-primary underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {!cart || cart.items.length === 0 ? (
        <CartEmptyState />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Tu carrito</h1>
          <div className="mt-6 grid gap-8 md:grid-cols-[2fr_1fr]">
            <ul className="flex flex-col">
              {cart.items.map((item) => (
                <CartItemRow
                  key={item.slug}
                  item={item}
                  mutating={
                    state.kind === 'ready' && state.mutatingSlugs.includes(item.slug)
                  }
                  conflict={state.kind === 'ready' ? state.conflicts[item.slug] : undefined}
                  onSetQuantity={setQuantity}
                  onRemove={remove}
                />
              ))}
            </ul>
            <CartSummary cart={cart} />
          </div>
        </>
      )}
    </div>
  );
}
