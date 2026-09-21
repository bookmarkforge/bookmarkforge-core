# Plan de super-optimización

Este plan no autoriza sacrificar seguridad, accesibilidad ni mantenibilidad por tamaño.

1. **Carga inicial:** mantener el shell y las pantallas pre-desbloqueo dentro de los presupuestos de `check:chunks`.
2. **Lazy loading:** medir antes y después de cada dependencia pesada; no introducir imports estáticos de editor, PDF, gráficos o IA en el camino crítico.
3. **Persistencia:** medir operaciones RxDB/IndexedDB con datos representativos y conservar un benchmark reproducible.
4. **Sync:** medir convergencia, reintentos y uso de memoria en dos dispositivos; cualquier mejora debe conservar tombstones, privacidad y autenticación.
5. **IA local:** registrar tamaño del modelo, tiempo de primera inferencia y memoria por dispositivo; degradar con gracia si no hay GPU.

Cada propuesta necesita una métrica, un límite, una prueba de regresión y un plan de rollback. Los gates existentes son la autoridad, no una optimización manual de un número aislado.
