# Sistema de Gestión Pollería — Frontend Módulo 1

React 18 + TypeScript + Vite + Tailwind CSS (PWA). Consume la API del backend (`../`). Ver [CLAUDE.md](../CLAUDE.md) para el contexto completo del negocio y [PROMPT-DISENO-FRONTEND.md](../PROMPT-DISENO-FRONTEND.md) para el brief de diseño original.

El diseño visual viene de un prototipo aprobado por el cliente (`../Diseño frontend Módulo 1 Pollería/`), hecho con Claude Design. Ese archivo es solo referencia visual — la implementación real es este proyecto.

## Correr en desarrollo

```powershell
npm install
npm run dev        # levanta Vite en :5173, proxea /api y /socket.io a localhost:3000
```

Necesita el backend corriendo en `:3000` (`npm run dev` en la raíz del repo, con su `.env` de Neon).

## Usuarios del seed

Ver [README del backend](../README.md#usuarios-del-seed) — los mismos 7 usuarios están disponibles como accesos rápidos en la pantalla de login.

## Decisiones y pendientes conocidos

- **Auth**: `accessToken` en memoria (nunca localStorage), refresh vía cookie httpOnly. En dev todo es same-origin gracias al proxy de Vite. **Riesgo para producción**: la cookie de refresh tiene `sameSite:'strict'` en el backend — si frontend y backend terminan en dominios distintos (Vercel/Railway), el refresh silencioso se rompe. Requiere cambiar el backend a `sameSite:'lax'` o `'none'+secure` antes de desplegar en dominios separados.
- **Asignación de sucursal para CAJERO/ENCARGADO**: el modelo `Usuario` del backend no tiene `sucursalId` (no hay forma de saber "este cajero es de Local 1"). El frontend resuelve esto dejando elegir el local en el header (persistido en `sessionStorage`), no es una regla de negocio validada con el cliente — ver `src/features/local/ShellLocal.tsx`.
- **"Mis envíos" / "Mis recepciones"**: el backend no filtra transferencias por emisor/receptor en la query, así que el frontend trae todas las de la sucursal/rol y filtra client-side por `usuarioEmisor`/`usuarioReceptor` (username). Funciona, pero es O(n) sobre el listado completo — revisar si el volumen crece mucho.
- **Iconos PWA**: el manifest usa `favicon.svg` como ícono único (`purpose: any`). Reemplazar por PNGs 192/512 cuando haya assets de marca definitivos.
- **Fichas técnicas / Excel real**: igual que el backend, la pantalla de fichas técnicas asume la fórmula de rendimiento documentada en `CLAUDE.md` §9 — si el Excel real del cliente usa otra lógica, no afecta el frontend (solo muestra lo que el backend calcula).

## Estructura

```
src/
├── api/          — un archivo por dominio (auth, productos, stock, ingresos, produccion, transferencias, fichas, alertas, usuarios, auditoria) + client.ts (fetch wrapper con refresh) + types.ts
├── auth/         — AuthContext (sesión en memoria) + RutaProtegida (guard por rol)
├── components/ui — TecladoNumerico, Selector, PantallaExito, EncabezadoWizard, Boton, Tarjeta, BannerSinConexion (overlays y piezas compartidas del diseño)
├── lib/          — formato.ts (números/fechas es-AR), jwt.ts (decodificar payload propio), useSocket.ts (alertas en tiempo real, solo ADMINISTRADOR)
└── features/
    ├── login/       — pantalla única
    ├── produccion/  — rol PRODUCCION (celular): menú + 3 wizards + lote abierto + mis envíos
    ├── local/       — rol CAJERO/ENCARGADO (tablet): recepción ciega + historial + stock
    └── admin/       — rol ADMINISTRADOR/SOCIO (dashboard): alertas, stock, producción, transferencias, fichas técnicas, catálogo, usuarios, auditoría
```

## Control ciego (verificado en el diseño de las pantallas)

- PRODUCCIÓN nunca ve `unidadesEsperadas`/`desvioPct`/`alertaDisparada` — el backend ya no se los envía (DTO ciego), y la UI de cierre de lote no tiene ningún espacio para esos datos.
- El receptor de una transferencia nunca ve `cantidadEnviada`/`diferencia` — la respuesta de recepción es solo `{coincide}`, y la pantalla de discrepancia no revela el número real ni de qué lado está el error.
