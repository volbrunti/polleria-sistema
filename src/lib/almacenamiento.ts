// Subida de archivos a Cloudflare R2 (API S3-compatible). Firma el PUT a
// mano con AWS Signature V4 en vez de traer el SDK de AWS entero: es UNA
// sola operación (PUT, payload chico, sin multipart ni lecturas firmadas —
// el bucket es público, igual que hoy el disco local se sirve sin auth por
// /uploads/), y el protocolo de firma no cambia hace años.
//
// Si `config.r2.configurado` es false, el llamador tiene que usar el
// fallback de disco local (ver ingresos.routes.ts) — este módulo no lo hace
// solo para no mezclar las dos responsabilidades.

import crypto from 'node:crypto';
import { config } from '../config';

function hmac(clave: Buffer | string, datos: string): Buffer {
  return crypto.createHmac('sha256', clave).update(datos, 'utf8').digest();
}

function sha256Hex(datos: Buffer | string): string {
  return crypto.createHash('sha256').update(datos).digest('hex');
}

const REGION = 'auto';
const SERVICIO = 's3';

export async function subirAR2(params: {
  buffer: Buffer;
  nombreArchivo: string;
  contentType: string;
}): Promise<string> {
  const { r2 } = config;
  if (!r2.configurado) throw new Error('R2 no está configurado');

  const host = `${r2.accountId}.r2.cloudflarestorage.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20260807T153000Z
  const fecha = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(params.buffer);
  const canonicalUri = `/${encodeURIComponent(r2.bucket)}/${encodeURIComponent(params.nombreArchivo)}`;
  const canonicalHeaders =
    `content-type:${params.contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${fecha}/${REGION}/${SERVICIO}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kFecha = hmac(`AWS4${r2.secretAccessKey}`, fecha);
  const kRegion = hmac(kFecha, REGION);
  const kServicio = hmac(kRegion, SERVICIO);
  const kFirma = hmac(kServicio, 'aws4_request');
  const firma = hmac(kFirma, stringToSign).toString('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${r2.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${firma}`;

  const respuesta = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      'Content-Type': params.contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
    body: params.buffer,
  });

  if (!respuesta.ok) {
    const texto = await respuesta.text().catch(() => '');
    throw new Error(`R2 respondió ${respuesta.status}: ${texto.slice(0, 300)}`);
  }

  return `${r2.urlPublica}/${params.nombreArchivo}`;
}
