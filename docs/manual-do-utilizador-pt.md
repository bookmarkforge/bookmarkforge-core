# Manual do utilizador — BookmarkForge v1

**Versão:** 1.0.0 · **Última atualização:** setembro de 2026 · **Licença:** MIT

---

## 1. Introdução

O BookmarkForge é uma aplicação de conhecimento pessoal **local-first** que lhe permite guardar marcadores, tomar notas, organizar o seu conhecimento com gráficos interativos, usar IA diretamente no seu navegador e sincronizar entre dispositivos sem depender de servidores centrais.

**O que torna o BookmarkForge único:**

- **Os seus marcadores, notas e documentos vivem no seu navegador** (IndexedDB/RxDB). O conteúdo do cofre não é enviado para o BookmarkForge; se utilizar um fornecedor externo de IA, este recebe apenas o que enviar explicitamente através dessa função.
- **Cifragem de ponta a ponta** com AES-GCM e Argon2id. Nem mesmo os programadores podem ler o seu cofre.
- **IA local** que funciona offline e sem enviar os seus dados para terceiros.
- **Sincronização P2P** entre os seus dispositivos sem servidores centrais.
- **Sem subscrição.** Pague uma vez e é seu para sempre.

---

## 2. Primeiros passos

### 2.1 Requisitos

- Navegador moderno: Chrome, Edge, Firefox, Safari (16+)
- 8 GB de RAM recomendados
- GPU básica para IA local (WebGPU)
- Ligação à internet (para a configuração inicial e sincronização; opcional para uso offline)

### 2.2 Instalação

1. Abra [bookmarkforgeapp.com](https://bookmarkforgeapp.com)
2. Clique em **"Install App"** ou **"Add to Home Screen"**
3. A aplicação instala-se como PWA (Progressive Web App)
4. Também pode utilizá-la como extensão de navegador

### 2.3 Configuração inicial

1. **Palavra-passe principal:** Mínimo 12 caracteres. Recomenda-se uma frase de passe.
   - Deriva a sua chave AES-GCM com Argon2id (KDF obrigatório desde ADR-019)
   - **A sua palavra-passe é a ÚNICA chave.** Se a perder, não há recuperação.
2. **Frase de recuperação:** Guarde as 24 palavras num local seguro.
3. **Device ID:** Gerado automaticamente. Utilizado para ativar licenças Pro.

### 2.4 O bookmarklet

Arraste o botão **"Save to Forge"** para a barra de marcadores do seu navegador. Sempre que estiver numa página web, clique nele para a guardar como marcador.

---

## 3. Funcionalidades principais

### 3.1 Marcadores

- **Lista virtualizada** que lida com 100.000+ itens sem atraso
- **Pesquisa profunda:** pesquisa no texto completo de páginas guardadas
- **Coleções inteligentes:** auto-organização por etiqueta
- **Import/Export:** de Notion, Evernote, Chrome, ou exporte como .bmf, Markdown, PDF
- **Free:** 2.500 marcadores, pesquisa inteligente incluída e sem limite de dispositivos. Aos 2.500, os seus dados permanecem disponíveis para leitura, pesquisa e export; apenas os novos guardados ficam em pausa. **Pro:** marcadores ilimitados.

### 3.2 Editor de notas

Editor baseado em blocos com:
- Comandos `/` para inserção rápida de blocos
- Arrastar e largar
- LaTeX para matemática
- Diagramas Mermaid para gráficos
- Destaque de sintaxe para 50+ linguagens
- **AI Copilot** para assistência em tempo real

### 3.3 Gráfico de conhecimento

Visualização interativa 3D/2D das suas notas:
- Filtre por etiqueta, data ou "Força de conexão"
- Visualize semelhanças semânticas entre notas não relacionadas
- Explore como as suas ideias se conectam ao longo do tempo

### 3.4 Flashcards

- Algoritmo modificado tipo Anki de **Repetição Espaçada (SRK)**
- Rastreia a sua "curva de esquecimento" para mostrar cartões no momento perfeito
- Suporta oclusão de imagens e exclusão de texto
- **Disponível apenas em Pro**

### 3.5 Comandos de voz

Motor de voz para ação:
- Diga "Hey BMF, encontra as minhas notas de Biologia"
- Diga "Guarda esta página"
- Funciona 100% offline através da Web Speech API

### 3.6 Omnibar (Ctrl+K)

O cérebro da aplicação:
- Matemática, conversão de unidades
- Pesquisa simultânea de marcadores e notas
- Digite `>` para comandos do sistema

---

## 4. IA no BookmarkForge

### 4.1 IA com a sua própria chave API (Free)

- Utiliza Gemini, OpenAI, Anthropic, ou qualquer fornecedor compatível
- Paga o custo dos tokens diretamente ao seu fornecedor
- A aplicação encaminha dinamicamente os pedidos para o modelo ótimo
- **Cache semântico local:** se fizer perguntas semelhantes, utiliza 0 tokens de API

### 4.2 IA Local — WebLLM/Ollama (Pro)

- Executa modelos de IA completos (como Llama 3.2, Qwen 2.5) diretamente no seu navegador
- Utiliza a sua placa gráfica (WebGPU)
- **Sem ligação à internet** necessária para funcionar
- Quantização de 4 bits (q4f16) para executar em hardware modesto
- **Sem custos de tokens** e sem envio de dados para terceiros

### 4.3 Chat RAG sobre os seus dados (Pro)

- A IA "lê" as suas notas locais antes de responder
- Responde com base no seu conhecimento específico
- Arquitetura híbrida com cache semântico local
- Se fizer perguntas semelhantes, a aplicação utiliza 0 tokens e 0 chamadas API

### 4.4 Agentes especialistas (Pro)

- Agentes especializados em diferentes domínios
- Automatizam tarefas complexas de análise

---

## 5. Sincronização P2P

### 5.1 Requisitos

- Ambos os dispositivos na mesma rede Wi-Fi
- O firewall deve permitir WebRTC
- IDs de sincronização correspondentes

### 5.2 Configuração

1. Vá a **Definições > Sincronização**
2. Ative "Ativar sincronização P2P"
3. Certifique-se de que ambos os dispositivos estão na mesma rede
4. Confirme que os IDs de sincronização correspondem

### 5.3 Resolução de problemas

| Problema | Solução |
|---|---|
| Sincronização a falhar | Verifique se ambos os dispositivos estão no mesmo Wi-Fi |
| Firewall a bloquear WebRTC | Configure o firewall para permitir WebRTC |
| IDs de sincronização não correspondem | Reinicie a Sala de Sincronização |
| Ligação lenta | Verifique a latência da rede |

---

## 6. Segurança e privacidade

### 6.1 Cifragem

- **AES-GCM** com chaves derivadas por **Argon2id** (versão 4)
- As chaves nunca são armazenadas em texto claro
- Derivadas em tempo real e existem apenas na memória (RAM)
- Utiliza a API SubtleCrypto nativa do navegador

### 6.2 Palavra-passe principal

- Mínimo 12 caracteres
- Não existe funcionalidade "Esqueci a palavra-passe"
- A sua palavra-passe é a ÚNICA chave
- Se a perder, **não podemos ajudar**
- Guarde sempre uma cópia de segurança .bmf num local seguro

### 6.3 Recuperação

- Exporte o seu cofre como ficheiro `.bmf` a qualquer momento
- Formato: JSON cifrado com a sua chave principal
- Guarde-o em segurança (USB, disco externo, cloud cifrado)
- Para restaurar: vá a **Definições > Restaurar** e selecione o seu ficheiro .bmf
- A restauração requer a sua palavra-passe principal

### 6.4 Política de privacidade

- **Zero-knowledge:** os programadores têm conhecimento zero das suas chaves ou dados
- Sem Google Analytics, sem telemetria, sem pixels de rastreamento
- Sem servidores centrais a armazenar os seus dados
- RGPD por design
- O servidor de licenças valida a sua licença sem aceder ao seu cofre

### 6.5 Validação de licenças

- A licença Pro é validada localmente após um handshake inicial
- Sem rastreamento constante
- Prova de licença assinada com RSA-PSS (SHA-256, salt 32)
- Re-validação a cada 48 horas quando conectado
- Provas com mais de 30 dias são rejeitadas pelo servidor de entitlement

---

## 7. Free vs Pro

### 7.1 Tabela comparativa

| Funcionalidade | Free | Pro |
|---|---|--- |
| Preço | $0 | $79 (vitalício) |
| Marcadores | 2.500 | Ilimitados |
| Dispositivos | Sem limite (cada dispositivo tem o seu cofre) | Até 5 + sincronização P2P |
| IA com chave própria | ✅ | ✅ |
| IA Local (WebLLM/Ollama) | ❌ | ✅ |
| Chat RAG sobre os seus dados | ❌ | ✅ |
| Flashcards + PDF/OCR | ❌ | ✅ |
| Exportação avançada (10+ formatos) | ❌ | ✅ |
| Cifragem local do cofre (AES-GCM) | ✅ | ✅ |
| Suporte | Comunidade | E-mail 48h |
| Descontos v2/v3 | ❌ | 60% de desconto |

### 7.2 Como atualizar para Pro

1. Vá a **Definições > Subscrição**
2. Clique em **"Get Pro Lifetime"**
3. Será redirecionado para Whop para pagamento
4. Após a compra, a aplicação ativa-se automaticamente
5. A licença é validada pelo servidor e assinada localmente

**Early Bird:** Os primeiros 200 compradores pagam $59 (esgotado ou até 2026-12-31). O preço regular é $79.

### 7.3 Atualizações futuras (v2, v3)

- Os proprietários de v1 pagam um **desconto de 60%** em versões principais futuras
- v2 para novos: $89. v2 para proprietários v1: $35
- v3 para novos: $99. v3 para proprietários v1: $39
- Os proprietários de v1 **mantêm v1 funcional para sempre**

---

## 8. Importar e exportar

### Nota sobre Pocket

A importação reconhece exportações HTML (`ril_export.html`) e CSV do Pocket. Antes de guardar qualquer coisa, a aplicação mostra uma pré-visualização com links, datas e etiquetas. O estado lido/arquivado é preservado; se o limite Free for atingido na importação, o resultado indica honestamente quantos itens foram importados e que o limite foi atingido, em vez de contar o restante como ignorado.

### 8.1 Importar

Vá a **Definições > Importar**:
- **HTML/JSON de Notion ou Evernote**
- **Exportação de marcadores do Chrome**
- **Cópia de segurança .bmf**

### 8.2 Exportar

- **.bmf:** Cópia de segurança completa cifrada
- **Markdown:** Notas em formato legível
- **PDF:** Exporte notas como documentos PDF
- **JSON:** Dados estruturados

### 8.3 Cópia de segurança e restauração

- Exporte regularmente o seu cofre como .bmf
- Guarde-o num local seguro
- Para restaurar: vá a **Definições > Restaurar** e selecione o seu ficheiro .bmf
- A restauração requer a sua palavra-passe principal

---

## 9. Resolução de problemas

### 9.1 A aplicação não carrega

1. Limpe a cache do navegador
2. Atualize o Chrome/Edge para a versão mais recente
3. Verifique se o seu disco está cheio
4. Desative extensões em conflito (bloqueadores de anúncios bloqueiam por vezes IndexedDB)

### 9.2 Sincronização a falhar

1. Certifique-se de que ambos os dispositivos estão no mesmo Wi-Fi
2. Verifique se o firewall permite WebRTC
3. Confirme que os IDs de sincronização correspondem
4. Reinicie a Sala de Sincronização se necessário

### 9.3 IA alucina ou responde incorretamente

1. A IA pode cometer erros — utilize os links "Fontes" no Chat para verificar
2. Ajuste a "Temperatura" nas definições de IA
3. Se utilizar IA local, verifique se o modelo está carregado corretamente

### 9.4 Extensões não guardam

1. Atualize a página que está a tentar guardar
2. Certifique-se de que está ligado ao BookmarkForge noutro separador
3. Reinstale o bookmarklet

### 9.5 Desempenho lento

1. Vá a Definições > Avançado e execute "Otimização da base de dados"
2. Verifique o Diagnóstico do Sistema para utilização de CPU
3. A virtualização lida com listas grandes, mas notas pesadas podem afetar a RAM

### 9.6 Base de dados corrompida

1. Utilize "Diagnóstico do Sistema" para verificar a integridade
2. Se estiver corrompida, restaure da sua última cópia de segurança .bmf

### 9.7 Licença Pro não funciona

1. Verifique se a sua ligação à internet funciona (validação periódica necessária)
2. Tente re-validar em **Definições > Licença > Re-validar**
3. Se o problema persistir, contacte **bookmarkforge@proton.me**
4. Reembolsável dentro de 30 dias via Whop

### 9.8 Erro de licença: SIGNING_KEY_INVALID

Este erro indica que o servidor não está configurado corretamente. Não é um problema do utilizador. Contacte o suporte.

---

## 10. Configuração avançada

Para configurações avançadas de implementação, auto-hospedagem e API do servidor,
consulte a documentação interna ou contacte o suporte.

> A validação de licenças é realizada exclusivamente no servidor.
> O BookmarkForge requer uma licença válida para aceder a funcionalidades Pro.

---

## 11. FAQ

**É gratuito?**
A aplicação principal é local-first e gratuita. As funcionalidades avançadas de IA e sincronização P2P requerem uma licença Pro.

**Posso utilizá-lo no telemóvel?**
Sim. Instale como PWA via Chrome (Android) ou Safari (iOS). Suporta acesso offline e notificações push.

**Onde estão os meus ficheiros?**
No armazenamento interno do navegador (IndexedDB). Pode exportá-los como .bmf, Markdown ou PDF a qualquer momento.

**Funciona sem internet?**
100%. Todas as funcionalidades (Editor, Marcadores, Gráfico, IA Local, Pesquisa) funcionam sem ligação à internet.

**Consome muitos tokens de API?**
Não. A aplicação utiliza um algoritmo de Cache Semântico Local. Se fizer variações da mesma pergunta, utiliza 0 tokens de API.

**Consumo de bateria?**
A IA local utiliza WebGPU. Em portáteis, pode consumir bateria mais rapidamente. Desative a IA local nas definições para poupar bateria.

---

## 12. Suporte

| Nível | Canal | Tempo de resposta |
|---|---|---|
| **Free** | Comunidade — Docs + /help + GitHub Discussions | Best effort |
| **Pro** | E-mail — bookmarkforge@proton.me | 48h (dias úteis) |

**Nota de segurança:** O seu cofre está cifrado. Não podemos ver os seus dados. Palavra-passe perdida = dados perdidos. O suporte nunca pedirá a sua palavra-passe ou frase de recuperação.

---

## 13. Legal

- **Licença do código:** MIT-or-later
- **Marca:** BookmarkForge e as suas marcas estão protegidas (ver `TRADEMARKS.md`)
- **Preços:** Congelados em `docs/pricing-decision.md`. Todos os preços são vitalícios versão 1.
- **Reembolsos:** 30 dias via Whop. Política de reembolso completa.
- **Privacidade:** Ver `docs/ROPA.md` para o registo de tratamento de dados pessoais sob RGPD.

---

*Última atualização: setembro de 2026 · Versão 1.0.0*
