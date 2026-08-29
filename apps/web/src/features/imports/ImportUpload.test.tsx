import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '@/test/server';
import { ImportUpload } from './ImportUpload';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

function csv(nombre = 'catalogo.csv', bytes = 64): File {
  return new File(['x'.repeat(bytes)], nombre, { type: 'text/csv' });
}

/** Captura las claves de idempotencia de cada `POST` que llegue. */
function capturarClaves(): string[] {
  const claves: string[] = [];
  server.use(
    http.post(`${API}/v1/admin/imports`, ({ request }) => {
      claves.push(request.headers.get('idempotency-key') ?? '');
      return HttpResponse.json({ id: ID, status: 'pending' }, { status: 202 });
    }),
  );
  return claves;
}

describe('ImportUpload — límites y esquema a la vista (AC-11, AC-4)', () => {
  it('muestra los tres límites con número ANTES de elegir archivo', () => {
    render(<ImportUpload onCreated={vi.fn()} />);

    expect(screen.getByText(/4 MiB/)).toBeInTheDocument();
    expect(screen.getByText(/5000 filas|5\.000 filas/)).toBeInTheDocument();
    expect(screen.getByText(/3 importaciones por hora/)).toBeInTheDocument();
  });

  it('documenta el esquema: columnas, separador de miles y celda vacía', () => {
    render(<ImportUpload onCreated={vi.fn()} />);

    for (const columna of ['sku', 'nombre', 'precio', 'stock', 'categoria']) {
      expect(screen.getByText(columna)).toBeInTheDocument();
    }
    expect(screen.getByText(/separador de miles se rechaza/i)).toBeInTheDocument();
    // AC-4: es lo que hace usable el archivo de sólo precios.
    expect(screen.getByText(/no cambiar ese campo/i)).toBeInTheDocument();
    // AC-9: sin este aviso, el dueño busca sus productos en el storefront.
    expect(screen.getByText(/borrador/i)).toBeInTheDocument();
  });

  it('el input es alcanzable por su etiqueta (teclado y lector de pantalla)', () => {
    render(<ImportUpload onCreated={vi.fn()} />);
    expect(screen.getByLabelText(/archivo del catálogo/i)).toBeInTheDocument();
  });
});

describe('ImportUpload — pre-validación en el cliente (sin request)', () => {
  it('una extensión distinta se rechaza SIN llamar a la API', async () => {
    const claves = capturarClaves();
    render(<ImportUpload onCreated={vi.fn()} />);

    // `userEvent.upload` HONRA el `accept` del input —igual que un navegador— así
    // que un `.txt` elegido por ahí nunca llega al componente. La defensa existe
    // para el archivo que sí llega (drag & drop, un `.xlsx` renombrado, un
    // navegador que ignora `accept`), y eso se ejerce con `fireEvent`.
    const input = screen.getByLabelText(/archivo del catálogo/i);
    fireEvent.change(input, {
      target: { files: [new File(['hola'], 'notas.txt', { type: 'text/plain' })] },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/\.csv o \.xlsx/);
    // No se gasta un viaje en un rechazo seguro.
    expect(claves).toHaveLength(0);
    expect(screen.getByRole('button', { name: /importar catálogo/i })).toBeDisabled();
  });

  it('un archivo de más de 4 MiB se rechaza SIN llamar a la API', async () => {
    const claves = capturarClaves();
    render(<ImportUpload onCreated={vi.fn()} />);

    await userEvent.upload(
      screen.getByLabelText(/archivo del catálogo/i),
      csv('gordo.csv', 4 * 1024 * 1024 + 1),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/4 MiB/);
    expect(claves).toHaveLength(0);
  });
});

describe('ImportUpload — envío (T1.2: Idempotency-Key estable por archivo)', () => {
  it('el REINTENTO del mismo archivo manda la MISMA clave', async () => {
    // El escenario real de la idempotencia: el primer envío falla sin que se sepa
    // si el servidor lo procesó, y el dueño vuelve a intentar. Con la misma clave,
    // el backend responde 200 con el trabajo original en vez de crear un segundo
    // import del mismo archivo.
    const claves: string[] = [];
    let intentos = 0;
    server.use(
      http.post(`${API}/v1/admin/imports`, ({ request }) => {
        claves.push(request.headers.get('idempotency-key') ?? '');
        intentos += 1;
        if (intentos === 1) {
          return HttpResponse.json(
            {
              type: 'dsm:catalog/internal',
              title: 'Internal Server Error',
              status: 500,
              detail: 'Ocurrió un error interno.',
              instance: '/v1/admin/imports',
            },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json({ id: ID, status: 'pending' }, { status: 202 });
      }),
    );
    render(<ImportUpload onCreated={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText(/archivo del catálogo/i), csv());
    const boton = screen.getByRole('button', { name: /importar catálogo/i });

    await userEvent.click(boton);
    await waitFor(() => expect(claves).toHaveLength(1));
    // Tras el fallo el botón vuelve a estar operable: sin eso no habría reintento.
    await waitFor(() => expect(boton).not.toBeDisabled());
    await userEvent.click(boton);
    await waitFor(() => expect(claves).toHaveLength(2));

    expect(claves[0]).toBe(claves[1]);
    expect(claves[0]).not.toBe('');
  });

  it('elegir OTRO archivo genera una clave nueva', async () => {
    const claves: string[] = [];
    server.use(
      http.post(`${API}/v1/admin/imports`, ({ request }) => {
        claves.push(request.headers.get('idempotency-key') ?? '');
        // Los dos fallan: lo que se mide es la CLAVE, y con un 202 el componente
        // queda esperando la navegación de la página y no admite otro envío.
        return HttpResponse.json(
          {
            type: 'dsm:catalog/internal',
            title: 'Internal Server Error',
            status: 500,
            detail: 'Ocurrió un error interno.',
            instance: '/v1/admin/imports',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        );
      }),
    );
    render(<ImportUpload onCreated={vi.fn()} />);
    const input = screen.getByLabelText(/archivo del catálogo/i);
    const boton = screen.getByRole('button', { name: /importar catálogo/i });

    await userEvent.upload(input, csv('uno.csv'));
    await userEvent.click(boton);
    await waitFor(() => expect(claves).toHaveLength(1));

    await userEvent.upload(input, csv('dos.csv'));
    await waitFor(() => expect(boton).not.toBeDisabled());
    await userEvent.click(boton);
    await waitFor(() => expect(claves).toHaveLength(2));

    // Reusarla haría que el segundo archivo devolviera el trabajo del primero.
    expect(claves[0]).not.toBe(claves[1]);
  });

  it('avisa el id creado y toma el valor de la RESPUESTA, no de un invento local', async () => {
    const onCreated = vi.fn();
    server.use(
      http.post(`${API}/v1/admin/imports`, () =>
        HttpResponse.json({ id: ID, status: 'pending' }, { status: 202 }),
      ),
    );
    render(<ImportUpload onCreated={onCreated} />);

    await userEvent.upload(screen.getByLabelText(/archivo del catálogo/i), csv());
    await userEvent.click(screen.getByRole('button', { name: /importar catálogo/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(ID));
  });

  it('el botón se deshabilita mientras el POST está en vuelo', async () => {
    let liberar: (() => void) | undefined;
    server.use(
      http.post(`${API}/v1/admin/imports`, async () => {
        await new Promise<void>((resolve) => {
          liberar = resolve;
        });
        return HttpResponse.json({ id: ID, status: 'pending' }, { status: 202 });
      }),
    );
    render(<ImportUpload onCreated={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText(/archivo del catálogo/i), csv());
    const boton = screen.getByRole('button', { name: /importar catálogo/i });
    await userEvent.click(boton);

    await waitFor(() => expect(screen.getByRole('button', { name: /subiendo/i })).toBeDisabled());
    // Y el input también: cambiar el archivo a mitad del envío dejaría la clave
    // apuntando a otro archivo.
    expect(screen.getByLabelText(/archivo del catálogo/i)).toBeDisabled();

    liberar?.();
  });
});

describe('ImportUpload — rechazo del servidor (AC-6)', () => {
  it('un 422 de columnas faltantes las enumera y afirma que el catálogo no se tocó', async () => {
    server.use(
      http.post(`${API}/v1/admin/imports`, () =>
        HttpResponse.json(
          {
            type: 'dsm:import/missing-columns',
            title: 'Unprocessable Entity',
            status: 422,
            detail: 'El archivo no tiene las columnas requeridas: precio.',
            instance: '/v1/admin/imports',
            errors: [{ field: 'precio', message: 'columna requerida ausente' }],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    render(<ImportUpload onCreated={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText(/archivo del catálogo/i), csv());
    await userEvent.click(screen.getByRole('button', { name: /importar catálogo/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/precio/);
    expect(alerta).toHaveTextContent(/el catálogo quedó como estaba/i);
  });

  it('un 409 dice que hay una importación en curso', async () => {
    server.use(
      http.post(`${API}/v1/admin/imports`, () =>
        HttpResponse.json(
          {
            type: 'dsm:import/already-running',
            title: 'Conflict',
            status: 409,
            detail: 'Ya hay una importación en curso.',
            instance: '/v1/admin/imports',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    render(<ImportUpload onCreated={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText(/archivo del catálogo/i), csv());
    await userEvent.click(screen.getByRole('button', { name: /importar catálogo/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/en curso/i);
  });

  it('un 429 dice cuánto esperar, leído del Retry-After', async () => {
    server.use(
      http.post(`${API}/v1/admin/imports`, () =>
        HttpResponse.json(
          {
            type: 'dsm:catalog/http-429',
            title: 'Too Many Requests',
            status: 429,
            detail: 'Too Many Requests',
            instance: '/v1/admin/imports',
          },
          {
            status: 429,
            headers: {
              'content-type': 'application/problem+json',
              'retry-after': '120',
            },
          },
        ),
      ),
    );
    render(<ImportUpload onCreated={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText(/archivo del catálogo/i), csv());
    await userEvent.click(screen.getByRole('button', { name: /importar catálogo/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/2 minutos/);
  });
});
