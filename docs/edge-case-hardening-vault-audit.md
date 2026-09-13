# Edge-case hardening para el vault y la auditoría operativa

Estado: borrador de experto, pendiente de validación humana.
Alcance: reducir la superficie de comportamiento ambiguo en
`src/services/SecurityVault.ts`, `src/services/security/AttestationChain.ts`
y el registro de auditoría asociado.

## 1. Qué está bien y no tocar sin motivo

- Verificación de password con capa HMAC de integridad separada.
- Comparaciones sensibles en tiempo constante en los puntos críticos.
- Rate-limit con lockout explícito en unlock, verifyRateLimited y decryptShare.
- Materialización/desmaterialización de device key con decisión basada en el blob envuelto, no solo en un booleano.
- Re-firma de la cadena de attestación tras rotación de password.
- Comportamiento fail-closed en los puntos donde la clave no está disponible.

Esto es maduro en superficie. No es “reescribir desde cero”; es reducir bordes difusos.

## 2. Comportamientos que un experto marcaría como operativamente ambiguos

### 2.1 Auditoría fire-and-forget
Hay entradas de auditoría que se registran sin garantizar que el registro se haya resuelto. Esto está bien como propuesta de bajo impacto, pero convierte a la auditoría en un mecanismo cuya ausencia no es necesariamente observable ni correlacionable en prod.

Acción recomendada: dejar claro qué eventos son “auditoría de operación” y cuáles son “auditoría de seguridad”. Los de seguridad crítica deberían tener un path observable explícito (no confiar solo en que “algún día se escriban”).

### 2.2 Persistencia best-effort de la cadena de attestación
Tanto la re-firma como la persistencia de la cadena tienen degradaciones silenciosas/limitadas cuando IndexedDB falla. Eso tiene sentido para no bloquear la operación del usuario, pero también significa que la cadena puede quedar desfasada entre memoria y disco en condiciones de error.

Acción recomendada: documentar los estados de degradación aceptables y qué significa “la cadena es válida para la sesión pero no persistida”. Dejar una huella de diagnóstico explícita, no solo un warn.

### 2.3 Comportamiento heredado de trim de password
`unlock()` usa `password.trim()` y hay notas sobre compatibilidad heredada. `rotateMasterPassword()` rechaza passwords con espacios. Esto crea un efecto práctico real: un usuario puede seguir desbloqueando con algo que técnicamente no debería poder rotar sin ajuste.

Acción recomendada: documentar explícitamente la relación entre la forma de entrada del unlock y la forma canónica del password rotado. Si se quiere limpieza futura, conviene que sea una decisión consciente y no una diferencia implícita entre rutas.

### 2.4 Recuperación y rotación
El vault tiene comportamiento deliberado respecto al blob de device key, al token de verificación y a recovery. Eso está bien, pero también significa que la rotación, el borrrado y la recuperación tocan varios almacenes distintos y una falla parcial puede dejar artefactos huérfanos si no se hace un rollback ordenado.

Acción recomendada: asegurar que haya un modo de diagnóstico que permita ver qué registros están presentes tras un intento fallido de rotación o de recuperación, sin exponer secretos.

### 2.5 Observabilidad en prod sin secrets
Lo correcto desde el experto es que los logs y la auditoría no expongan material sensible. Esto debe ser explícito, no accidental. Hay que verificar que los mensajes, los contextos y los reportes externos estén diseñados para no filtar derived state, salt, nonce, tokens de sesión o fragmentos de ciphertext.

## 3. Plan concreto que propongo

1. Dejar una lista de eventos de auditoría “críticos” y otra de “operativos”.
2. Asegurar que los críticos tengan una forma de detección explícita de pérdida de registro.
3. Unificar la política de fallback en la cadena de attestación y documentar qué significa cada nivel de degradación.
4. Dejar documentada la semántica heredada de trim/espacios y el efecto sobre rotación.
5. Añadir una regla interna de revisión de logs: todo logging relacionado con criptografía o vault debe pasar por un revisor humano o regla automática que rechace outputs estructurados riesgosos.
6. Poner una puerta de validación antes de cualquier cambio en rotación, wrap/unrap y recovery, con casos de prueba que simulen fallos de persistencia, no solo caminos felices.

## 4. Qué no haría sin más contexto

- No eliminaría ni alteraría la cadena de attestación actual sin ver los casos de prueba y los flujos de rollback.
- No tocaría la política de rate-limit ni el comportamiento del vault sin un análisis de qué usuarios y flujos dependen de cada ruta.
- No movería logic de vault a la servidor sin definir bien la relación trust boundary ya existente.

## 5. Forma de validarlo

Lo razonable es:
- revisión humana de los puntos anteriores;
- runs de verificación estática y de tests rápidos antes de tocar el vault;
- y, si se modifica algo de persistencia o rotación, un drill con fallo simulado, no solo éxito.

EOF
