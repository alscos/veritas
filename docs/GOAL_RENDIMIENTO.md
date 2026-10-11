# Contrato del goal de rendimiento

Activación: **10-10-2026, 16:20:12 UTC (18:20:12 Madrid)**. Límite absoluto:
18:20:12 UTC. Checkout `main`, base
`04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0`, con trabajo local previo conservado.

Cerrar el diagnóstico y las mejoras viables de rendimiento de InkGroove en
desarrollo, con pruebas e informe para decidir el siguiente paso hacia un piloto
pequeño. Continuar autónomamente entre checkpoints, sin esperar «sigue».

Leer primero AGENTS.md, DEVELOPMENT, CAPACITY_AND_STORAGE y los informes de
rendimiento, privacidad y concurrencia. Revisar cambios locales y diagnóstico
reciente; conservar el trabajo anterior. No repetir ensayos concluidos ni
confundir herramientas preparadas con resultados comprobados. Mantener
ESTADO_GOAL con fecha, checkpoint, evidencia, pendientes y bloqueos.

Identificar recursos reales, HTTP, KeepAlive, workers, PHP/OPcache, SQL, bloqueos
y coste de generador/navegador. Separar mediciones de hipótesis. Aplicar sólo
correcciones pequeñas y compatibles justificadas por evidencia; comparar con
condiciones equivalentes y validar lo afectado, reutilizando pruebas vigentes.

Editar aquí; ejecutar remotamente con el flujo documentado exclusivamente en
`/opt/veritas-dev`, proyecto `inkgroove-dev`. Pruebas secuenciales, guardas
intactas. Máximo treinta escritores: prohibidos 60/90/150. La carga adicional
del diagnóstico no puede superar **diez minutos acumulados, incluidos los
ensayos anteriores**. Si no se puede determinar el presupuesto restante, no
ejecutar nueva carga. Si una guarda para, registrar la causa y continuar sólo
sin esa carga. Máximo dos horas desde activación y tres experimentos correctivos;
detener antes si se comprueba el objetivo, se agotan caminos válidos o hace falta
decisión externa. El límite temporal no obliga a consumirlo.

Preservar contenido, eventos, recuperación, métricas, HMAC, firmas y fronteras.
Sin migraciones, rediseño de almacenamiento ni funciones ajenas al rendimiento.
Sin producción, SiteGround, configuración global, claves ni datos reales;
sin commits, push, publicación, correo o compras. No mostrar secretos ni ampliar
permisos. Limpiar sólo fixtures e instrumentación propios inventariados.

Actualizar PERFORMANCE_BOTTLENECKS y redactar INFORME_GOAL con causas, cambios,
comparaciones, pruebas, capacidad acreditada, limitaciones, estado dev y siguiente
tarea. Separar HTTP de navegador completo, real de simulado y cinco usuarios de
treinta alumnos. No declarar preparada la beta ni equivalencia con SiteGround.

Cerrar con evidencia, validación pertinente, limpieza comprobada y dev saludable;
o presentar bloqueo concreto, estado seguro y lo necesario para resolverlo.
