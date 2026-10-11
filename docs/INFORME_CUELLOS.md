Identifiqué y corregí un cuello concreto de desarrollo: Apache tenía **un solo trabajador efectivo** por `ServerLimit 1`. Ahora usa dos.

Con el mismo perfil mínimo, la espera bajó de **604 ms a 11 ms** con instrumentación. Esto demuestra el bloqueo por ocupación del trabajador; no confirma la causa única del fallo histórico de Chromium.

Chromium se detuvo por **dos sondeos de salud que agotaron 3 segundos**, no por la guarda de memoria.

Documenté recursos, límites de las mediciones, comparación y pendientes en [PERFORMANCE_BOTTLENECKS.md](/Users/ale/Documents/veritas/docs/PERFORMANCE_BOTTLENECKS.md).

Cinco pruebas de guardas pasan. Desarrollo saludable, instrumentación retirada y cambios locales conservados. Sin migraciones, producción ni eliminación de sesiones. **No se acredita capacidad de aula.**