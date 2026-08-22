# RUNBOOK — Puesta en marcha de las comanderas en la pollería

> Checklist operativo para la visita presencial. No duplica lógica de negocio — el
> contexto completo de comanderas está en [`CLAUDE.md`](CLAUDE.md) §5 (Flujo 4) y §11.1.
> Este documento es la guía de campo para dejarlas funcionando y anotar lo que se hizo.

## 0. Qué hay que entender antes de arrancar

- El sistema **no detecta la red ni las impresoras automáticamente**. Cada comandera se
  identifica por una **IP fija cargada a mano** en el panel (Catálogo → Comanderas). El
  backend abre un socket TCP directo a `ip:puerto 9100` y manda los bytes ESC/POS — sin
  driver, sin spooler, sin descubrimiento.
- Son **4 comanderas en total**, 2 por local de venta: una en **COCINA** y una en
  **MOSTRADOR/CAJA**. Producción no tiene comandera.
- Si hoy las probaste en otra red (WiFi de prueba, otro router), es muy probable que en la
  red real de la pollería cada impresora tenga **otra IP**. El sistema no se auto-ajusta:
  hay que recargar la IP correcta en el panel.
- Nada de esto bloquea la caja: si una comandera falla, el pedido se confirma igual y el
  cajero ve un aviso de cuál no imprimió, con opción de reimprimir. Pero sin la IP
  correcta, simplemente no sale nada en papel.

## 1. Antes de salir para la pollería

- [ ] Confirmar que alguien va a loguearse en el panel como **ADMINISTRADOR** (Pablo) —
      es el único rol que puede cargar/editar IPs de comanderas.
- [ ] Llevar el manual o el menú de configuración de red de las XPRINTER XP-V320N (para
      ver/fijar la IP desde la propia impresora si hace falta).
- [ ] Si se puede, pedir de antemano al que arme la red del local (router) que reserve una
      IP fija por MAC para cada impresora (DHCP reservation). Ahorra tener que repetir
      todo esto cada vez que se corta la luz o se reinicia el router.

## 2. En la pollería, por cada local (Local 1 y Local 2)

Para cada una de las 4 comanderas:

1. [ ] Conectarla a la red del local (LAN, no WiFi de invitados) — el modelo es USB+LAN,
       usar la conexión LAN.
2. [ ] Averiguar qué IP le tocó (menú de la impresora, o lista de clientes DHCP del
       router).
3. [ ] En el panel: **Catálogo → Comanderas** → crear o editar la fila correspondiente
       (sucursal + destino COCINA/MOSTRADOR) con esa IP y el puerto (9100 salvo que la
       impresora esté configurada distinto).
4. [ ] Apretar **"Imprimir prueba"** en esa fila. Tiene que salir un ticket de prueba en
       papel. Si no sale, revisar: impresora encendida, con papel, LAN conectada (no WiFi),
       y que la IP anotada sea la que quedó realmente asignada (puede haber cambiado si se
       reinició la impresora entre el paso 2 y el 3).
5. [ ] Revisar visualmente el ticket de prueba:
       - [ ] Los acentos/ñ se ven bien (si salen símbolos raros, es la code page —
             anotarlo, se ajusta en `src/modules/comanderas/escpos.ts`, no hay que tocar
             nada en la pollería).
       - [ ] El ancho de columna se ve bien (diseñado para 48 columnas / 80mm).
       - [ ] Corta el papel correctamente al final.

## 3. Prueba de extremo a extremo (una vez las 4 IPs cargadas)

- [ ] Con un usuario CAJERO real, cargar un pedido de prueba y confirmarlo. Verificar que
      salga el ticket en **ambas** comanderas del local (COCINA y MOSTRADOR).
- [ ] Modificar ese pedido (agregar/sacar un ítem) y verificar que salga el ticket de
      **ACTUALIZACIÓN** mostrando qué cambió.
- [ ] Anular el pedido y verificar que salga el ticket de **ANULACIÓN**.
- [ ] Apagar a propósito una comandera y confirmar un pedido: verificar que igual se
      confirme el pedido, que aparezca el banner de "no se imprimió en X", y que el botón
      de **reimprimir** funcione al prenderla de nuevo.
- [ ] Repetir todo en el Local 2.

## 4. Registrar lo que quedó

Completar esta tabla con lo hecho hoy (sirve como respaldo y para el commit a GitHub):

| Local | Destino | IP cargada | Puerto | Prueba de impresión | Observaciones |
|---|---|---|---|---|---|
| Local 1 | COCINA | | 9100 | ☐ OK / ☐ Falló | |
| Local 1 | MOSTRADOR | | 9100 | ☐ OK / ☐ Falló | |
| Local 2 | COCINA | | 9100 | ☐ OK / ☐ Falló | |
| Local 2 | MOSTRADOR | | 9100 | ☐ OK / ☐ Falló | |

**Pendientes que queden abiertos después de la visita** (si los hay):

-

## 5. Después de la visita

- Si todas las IPs quedaron cargadas y probadas, marcar como resuelto el pendiente
  correspondiente en `CLAUDE.md` §11.1 ("Cargar las 4 IPs reales" y "Probar las comanderas
  contra una XP-V320N real") en el próximo commit que toque ese archivo.
- Si aparecieron problemas de acentos/formato, anotar exactamente qué carácter salió mal
  y en qué impresora — hace falta para ajustar `MAPA_CP850` en `escpos.ts`.
- Subir este documento completado a GitHub (rama de trabajo habitual del repo).
