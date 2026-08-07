import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// config.ts corre configuracionR2() al importarse — hay que fijar las env
// vars ANTES del import para que quede "configurado: true". Se limpian en
// afterAll para no filtrarle un R2 "configurado" a otros archivos de test
// que compartan el proceso (fileParallelism:false en vitest.config.ts).
const VARS_R2 = {
  R2_ACCOUNT_ID: 'cuenta123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  R2_BUCKET: 'polleria-remitos',
  R2_URL_PUBLICA: 'https://fotos.limonychimi.com.ar/',
};
Object.assign(process.env, VARS_R2);

const { subirAR2 } = await import('../../src/lib/almacenamiento');

afterAll(() => {
  for (const clave of Object.keys(VARS_R2)) delete process.env[clave];
});

// Firma AWS Signature V4 a mano para subir a R2 (CLAUDE.md: fotos de remito,
// storage externo). No probamos contra R2 real (no hay credenciales en CI),
// pero sí que el PUT que se arma es el que R2/S3 espera: URL, método, y los
// headers que entran en la firma.

describe('subirAR2 — arma el PUT firmado correctamente', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sube al endpoint de R2 con method PUT, el body y el content-type correctos', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await subirAR2({
      buffer: Buffer.from('contenido de la foto'),
      nombreArchivo: '1234-abcdef.jpg',
      contentType: 'image/jpeg',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://cuenta123.r2.cloudflarestorage.com/polleria-remitos/1234-abcdef.jpg');
    expect(opciones.method).toBe('PUT');
    expect(opciones.body).toEqual(Buffer.from('contenido de la foto'));
    expect((opciones.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
  });

  it('firma con Authorization: AWS4-HMAC-SHA256 y el scope de credencial correcto', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await subirAR2({ buffer: Buffer.from('x'), nombreArchivo: 'a.png', contentType: 'image/png' });

    const [, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opciones.headers as Record<string, string>;

    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(headers.Authorization).toContain('/auto/s3/aws4_request');
    expect(headers.Authorization).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date');
    expect(headers.Authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    // x-amz-date en formato ISO básico (sin guiones ni dos puntos)
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('la firma es el hash SHA-256 del contenido, no un placeholder', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await subirAR2({ buffer: Buffer.from('contenido A'), nombreArchivo: 'a.jpg', contentType: 'image/jpeg' });
    const firmaA = (fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers[
      'x-amz-content-sha256'
    ];

    fetchMock.mockClear();
    await subirAR2({ buffer: Buffer.from('contenido B'), nombreArchivo: 'a.jpg', contentType: 'image/jpeg' });
    const firmaB = (fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers[
      'x-amz-content-sha256'
    ];

    expect(firmaA).toHaveLength(64);
    expect(firmaA).not.toBe(firmaB); // distinto contenido → distinto hash
  });

  it('devuelve la URL pública sin barra duplicada, aunque R2_URL_PUBLICA tenga barra final', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const url = await subirAR2({
      buffer: Buffer.from('x'),
      nombreArchivo: 'foto-1.jpg',
      contentType: 'image/jpeg',
    });

    // R2_URL_PUBLICA se cargó con barra final arriba; config.ts la recorta al leerla.
    expect(url).toBe('https://fotos.limonychimi.com.ar/foto-1.jpg');
  });

  it('si R2 responde error, lanza con el status y no devuelve una URL falsa', async () => {
    fetchMock.mockResolvedValue(new Response('Access Denied', { status: 403 }));

    await expect(
      subirAR2({ buffer: Buffer.from('x'), nombreArchivo: 'a.jpg', contentType: 'image/jpeg' }),
    ).rejects.toThrow(/403/);
  });
});
