Informe y herramientas preparados en [CAPACITY_AND_STORAGE.md](/Users/ale/Documents/veritas/docs/CAPACITY_AND_STORAGE.md).

- **Último nivel estable: 5 escritores + profesor**, en el perfil HTTP corto.
- Con 30, todas las solicitudes fueron 200, pero p95 de eventos alcanzó **1,711 s**. No se ejecutaron 60/90/150.
- Historial de 25.000 eventos: **172,4 MB de HTML**. SQL ficticio: **236,7 → 5,78 MB gzip**.
- Verificados **41.192 HMAC y tres versiones**. Chromium quedó detenido por las guardas; su experiencia completa sigue pendiente.

Fixtures, cookies, exportación e instrumentación retirados. Las sesiones anónimas no inventariadas se conservaron bajo caducidad normal. **inkgroove-dev está saludable**, con portada y `/up` en 200.

Cambios locales conservados. Sin cambios en producción ni capacidad de treinta alumnos o equivalencia con SiteGround acreditadas.