# Agente de impresión

El backend corre en Railway (nube) y no tiene ninguna ruta de red hacia las
impresoras del local — son IPs privadas (`192.168.x.x`) detrás del router de
cada local. Este proceso chico soluciona eso: corre en una PC del local, se
conecta HACIA AFUERA al backend (no hace falta abrir ningún puerto en el
router) y hace el último salto por TCP directo a la impresora.

Sin este proceso corriendo, "Imprimir prueba" y los tickets de cocina van a
fallar aunque la IP de la comandera esté bien cargada en el panel.

## Instalación (una vez, en una PC del local que quede siempre prendida)

1. Instalar [Node.js](https://nodejs.org/) (versión 18 o más nueva) si no está.
2. En esta carpeta:
   ```
   npm install
   ```
3. Copiar `.env.example` a `.env` y completar:
   - `BACKEND_URL`: la URL del backend en Railway (la misma que usa el frontend).
   - `AGENTE_TOKEN`: se genera desde el panel, **Catálogo → Comanderas → Agente
     de impresión → "Generar token"**. Se muestra una sola vez — copiarlo ahí
     mismo. Cada sucursal tiene el suyo.

## Arrancarlo

```
npm start
```

Deja la ventana abierta — mientras esté corriendo, el panel va a mostrar
"AGENTE CONECTADO" para esa sucursal. Se reconecta solo si se corta la
conexión a internet.

Para dejarlo corriendo sin depender de una terminal abierta (arranque
automático con la PC), hay varias opciones — no es necesario para probar hoy,
pero conviene resolverlo antes de depender de esto en producción:
- Tarea Programada de Windows ("al iniciar sesión", ejecutando `npm start` en
  esta carpeta).
- [`pm2`](https://pm2.keymetrics.io/) o [NSSM](https://nssm.cc/) para
  correrlo como servicio de Windows.

## Si algo falla

- **"AGENTE DESCONECTADO" en el panel**: revisar que el proceso esté
  corriendo y que la PC tenga internet.
- **Conecta pero la impresora no imprime**: el agente igual necesita que la
  PC donde corre tenga conectividad de red hacia la impresora — probar
  `ping <ip de la impresora>` desde esa misma PC.
- Los logs de esta ventana muestran cada intento de impresión, con la IP y el
  error si falló.
