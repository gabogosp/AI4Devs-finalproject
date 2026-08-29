'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { isAppError, type AppError } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { copyDeRechazo, SIN_IMPACTO } from './importErrorCopy';
import { importsService } from './importsService';

/**
 * Límites que el backend aplica (`IMPORT_MAX_FILE_BYTES`, `IMPORT_MAX_ROWS`,
 * `IMPORT_RATE_LIMIT_MAX`). Se muestran **antes** de elegir el archivo: el dueño
 * se tiene que enterar del tope por la pantalla, no por un 413 después de esperar
 * la subida de 4 MiB.
 */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILAS = 5_000;
const MAX_POR_HORA = 3;
const EXTENSIONES = ['.csv', '.xlsx'] as const;

export interface ImportUploadProps {
  /** Se llama con el id del trabajo creado; la ruta y el respaldo del id son de la página. */
  onCreated: (id: string) => void;
}

type EstadoEnvio =
  | { kind: 'idle' }
  | { kind: 'enviando' }
  | { kind: 'rechazado'; mensaje: string; deServidor: boolean };

/** Pre-validación local: evita el viaje obviamente perdido, no reemplaza al servidor. */
function motivoLocal(file: File): string | null {
  const nombre = file.name.toLowerCase();
  if (!EXTENSIONES.some((ext) => nombre.endsWith(ext))) {
    return 'El archivo tiene que ser .csv o .xlsx.';
  }
  if (file.size > MAX_BYTES) {
    return 'El archivo pesa más de 4 MiB. Partilo en dos y subilos de a uno.';
  }
  return null;
}

/**
 * Selección y envío del archivo (AC-6, AC-11).
 *
 * La `Idempotency-Key` se genera **al elegir el archivo** y vive en el estado del
 * componente, no en el submit: es lo que hace que un reintento del mismo archivo
 * devuelva 200 con el mismo trabajo en vez de crear un segundo import
 * (`api-standards` §10). Elegir otro archivo genera una clave nueva.
 */
export function ImportUpload({ onCreated }: ImportUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [clave, setClave] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoEnvio>({ kind: 'idle' });

  const elegir = useCallback((elegido: File | null) => {
    setFile(elegido);
    // Clave nueva por archivo: reusarla entre archivos distintos haría que el
    // segundo devolviera el trabajo del primero.
    setClave(elegido ? crypto.randomUUID() : null);
    const motivo = elegido ? motivoLocal(elegido) : null;
    setEstado(
      motivo ? { kind: 'rechazado', mensaje: motivo, deServidor: false } : { kind: 'idle' },
    );
  }, []);

  const enviar = useCallback(async () => {
    if (!file || !clave) return;
    const motivo = motivoLocal(file);
    if (motivo) {
      setEstado({ kind: 'rechazado', mensaje: motivo, deServidor: false });
      return;
    }

    setEstado({ kind: 'enviando' });
    track('import_upload_submitted', {
      size_bytes: file.size,
      ext: file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv',
    });

    try {
      const creado = await importsService.create(file, clave);
      onCreated(creado.id);
    } catch (error) {
      const appError: AppError = isAppError(error)
        ? error.appError
        : { kind: 'server', message: 'No se pudo subir el archivo' };
      track('import_upload_rejected', {
        problem_type: 'problemType' in appError ? appError.problemType ?? '' : '',
        status: appError.kind,
      });
      setEstado({
        kind: 'rechazado',
        mensaje: copyDeRechazo(appError),
        deServidor: true,
      });
    }
  }, [file, clave, onCreated]);

  const enviando = estado.kind === 'enviando';
  /**
   * Un rechazo **local** deshabilita el botón: si ya sabemos que el archivo no
   * sirve, dejar el botón activo invita a un viaje que va a fallar. Un rechazo del
   * **servidor** no lo deshabilita, porque ahí el reintento es legítimo (es lo que
   * la `Idempotency-Key` hace seguro).
   */
  const rechazoLocal = estado.kind === 'rechazado' && !estado.deServidor;
  const nombre = useMemo(() => file?.name ?? '', [file]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="archivo-import" className="font-medium">
          Archivo del catálogo (.csv o .xlsx)
        </label>
        <input
          id="archivo-import"
          type="file"
          accept=".csv,.xlsx"
          disabled={enviando}
          onChange={(e) => elegir(e.target.files?.[0] ?? null)}
        />
        {nombre ? <p className="text-sm">Elegido: {nombre}</p> : null}
      </div>

      <Button onClick={enviar} disabled={!file || enviando || rechazoLocal}>
        {enviando ? 'Subiendo…' : 'Importar catálogo'}
      </Button>

      {estado.kind === 'rechazado' ? (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p>{estado.mensaje}</p>
          {/* La mitad de AC-6 que tranquiliza: el archivo se rechazó y el catálogo
              quedó intacto. Sólo aplica cuando el rechazo vino del servidor. */}
          {estado.deServidor ? <p>{SIN_IMPACTO}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 text-sm">
        <h2 className="font-medium">Antes de subir</h2>
        <ul className="list-disc pl-5">
          <li>
            Máximo <strong>4 MiB</strong> por archivo y <strong>{MAX_FILAS} filas</strong>.
          </li>
          <li>
            Hasta <strong>{MAX_POR_HORA} importaciones por hora</strong>.
          </li>
          <li>
            Columnas obligatorias: <code>sku</code>, <code>nombre</code>,{' '}
            <code>precio</code>, <code>stock</code>, <code>categoria</code>. Opcionales:{' '}
            <code>descripcion</code>, <code>imagen_url</code>.
          </li>
          <li>
            El precio va en pesos con hasta dos decimales (<code>1234,56</code>).{' '}
            <strong>El separador de miles se rechaza</strong>: <code>1.234</code> es ambiguo.
          </li>
          <li>
            En un producto que <strong>ya existe</strong>, una celda vacía significa{' '}
            <strong>«no cambiar ese campo»</strong>: así se puede subir un archivo que sólo
            ajusta precios sin tocar el stock.
          </li>
          <li>
            Los productos nuevos entran como <strong>borrador</strong>: se publican desde el
            listado, uno por uno.
          </li>
        </ul>
      </div>
    </section>
  );
}
