# Sync to Public Repository

Este script sincroniza los cambios del repo privado (`bookmarkforge-2026`) al público (`bookmarkforge-core`).

## 📋 ¿Qué hace?

1. Ejecuta `export-public-repo.mjs` para generar versión Open Core
2. **Verifica la exportación con `check-open-core-export.mjs`** (aborta si hay código Pro)
3. Inicializa git en el directorio de exportación
4. Configura el remote del repo público
5. Hace commit de los cambios
6. Hace push al repo público

## 🚀 Uso

### Manual

```bash
node scripts/sync-to-public-repo.mjs
```

### Automático (Git Hook)

Puedes configurar este script para que se ejecute automáticamente después de cada push:

```bash
# En Windows PowerShell
$env:EDITOR="notepad"
git config --local core.hooksPath .githooks

# En Windows Git Bash
export EDITOR="notepad"
git config --local core.hooksPath .githooks
```

Luego crea el archivo `.githooks/post-push` con:

```bash
#!/bin/bash
node scripts/sync-to-public-repo.mjs
```

**⚠️ IMPORTANTE:** Solo usa el hook automático si estás seguro de que cada push debe sincronizarse al público.

## 🔒 Seguridad

- El script usa `--force` en el push para sobrescribir el repo público
- Solo exporta código Core MIT, excluyendo implementaciones Pro
- No incluye secretos ni claves API
- Requiere que `export-public-repo.mjs` esté configurado correctamente

## 📁 Directorios

- **Private repo**: `bookmark7` (local) → `bookmarkforge-2026` (GitHub)
- **Export dir**: `bookmark7-public-export` (temporal)
- **Public repo**: `bookmarkforge-core` (GitHub)

## ⚠️ Precauciones

1. **No ejecutes el script si**: No quieres sincronizar cambios al público
2. **Verifica el export**: El export puede tardar varios minutos
3. **Confirma cambios**: Revisa qué cambios estás enviando antes de push
4. **Usa branches**: Para testing, usa branches en ambos repos

## 🔄 Flujo de trabajo recomendado

### Desarrollo normal

```bash
# 1. Hacer cambios en bookmark7
git add .
git commit -m "feat: new feature"
git push origin main
```

### Sincronizar al público

```bash
# 2. Ejecutar script de sincronización
node scripts/sync-to-public-repo.mjs
```

### Solo cuando quieras actualizar el público

No uses el hook automático si sincronizas al público manualmente. Esto te da control sobre cuándo actualizar el repo público.

## 🐛 Troubleshooting

### Error: "Not in the correct repository"

Asegúrate de estar en el repo `bookmarkforge-2026`:
```bash
git remote get-url origin
```

### Error: "Open Core export failed"

Verifica que `export-public-repo.mjs` funcione:
```bash
node scripts/export-public-repo.mjs --out ../bookmark7-public-export
```

### Error: "Push failed"

Verifica que tengas permisos de push en `bookmarkforge-core`:
- El repo debe ser público
- Tu usuario de GitHub debe tener permisos de escritura
- Debes estar autenticado en GitHub con SSH o token

## 📝 Notas

- El script sobrescribe completamente el repo público (`--force`)
- El histórico del repo público será diferente del privado
- Los commits en el público tendrán mensajes genéricos de sync
- Para mantener un buen histórico, sincroniza solo cuando haya cambios importantes
