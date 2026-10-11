# Contrato: Chromium contra el backend real

Activación: 10-10-2026 22:34:18 UTC (11-10-2026 00:34:18 Madrid).
Límite de trabajo: 11-10-2026 00:04:18 UTC, noventa minutos.

Validar el recorrido editorial con un Chromium y un escritor ficticio contra
Apache/PHP/MariaDB reales en `/opt/veritas-dev`, proyecto `inkgroove-dev`, con
la configuración existente de dos workers. Producir evidencia reproducible o
bloqueo concreto, avanzando autónomamente entre checkpoints.

Leer AGENTS, DEVELOPMENT, INFORME_GOAL y los informes de rendimiento, capacidad,
privacidad y concurrencia. Conservar todos los informes/cambios; añadir checkpoints
a ESTADO_GOAL sin borrar el historial. Confirmar configuración/procesos efectivos,
estado inicial y guardas. Sólo runners documentados; sin ensayos en paralelo,
cambio de workers o recursos del host.

Presupuesto **nuevo de 600 segundos acumulados de actividad de ensayo**, independiente
del diagnóstico cerrado: incluye fixtures, navegador, verificaciones del servidor
y repeticiones. Registrar inicio/fin/consumo por fase con contador persistente.
Máximo dos intentos; una pasada correcta basta. Segundo intento sólo después de
corregir mínimamente un fallo demostrado. Al agotar presupuesto, sólo limpieza
e informe. Ante cualquier guarda, detener, limpiar y documentar; sin eludirla
ni reintentar esa carga.

Inventario previo y manifiesto propio de todos los recursos. Historial propio
máximo 2.000 eventos válidos, incluido lo añadido por el recorrido. Sin datos
reales, carga concurrente de cinco/treinta usuarios ni API simulada. Autenticación,
aplicación y base reales. Comprobar apertura fría, escritura, guardado, moviola
sin cambiar borrador y reapertura conservando texto/eventos. Escritura durante
carga sólo si se observa esa ventana; si no, pendiente. Verificar todos los HMAC
propios y sello/frontera si se crea una versión.

Usar 10 Mbit/s y 40 ms si lo permite el runner y documentar condiciones efectivas.
Medir editor disponible, métricas completas y guardado separadamente. Publicar
muestras individuales y su número, sin medianas/p95 insuficientes. Es recorrido
funcional, no capacidad. Sólo cambios mínimos ante fallo reproducido y pruebas
pertinentes; sin migraciones ni funcionalidades. Preservar privacidad, recuperación,
contenido, métricas, eventos y firmas; no repetir suites completas vigentes.

Sin producción/SiteGround, configuración global, claves, datos reales, commits,
push, correo o publicaciones; no ampliar permisos ni imprimir credenciales,
cookies o claves. Limpiar sólo recursos del manifiesto; identificar residuos
sin atribución cierta. Cierre en INFORME_CHROMIUM_REAL con revisión/cambios,
recorrido, mediciones, presupuesto, guardas, integridad, limpieza, salud y prioridad.
Completar sólo con evidencia, limpieza verificada y dev saludable; de otro modo,
bloqueo explícito y requisitos para resolverlo. Safari con teclado físico,
treinta alumnos y preparación de beta permanecen pendientes.
