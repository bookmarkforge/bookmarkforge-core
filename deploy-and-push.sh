#!/bin/bash
# Script para hacer push a GitHub y deploy a Vercel independientemente del CI

set -e

echo "======================================"
echo "1. Push a GitHub"
echo "======================================"

git push

echo ""
echo "✅ Push a GitHub completado"
echo ""
echo "======================================"
echo "2. Deploy a Vercel (independientemente del CI)"
echo "======================================"

vercel --prod

echo ""
echo "✅ Deploy a Vercel completado"
echo ""
echo "======================================"
echo "Proceso completado"
echo "======================================"
