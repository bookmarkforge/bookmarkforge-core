# Manual do utilizador — BookmarkForge v1

**Versão:** 1.0.0 · **Última atualização:** setembro de 2026 · **Licença:** AGPL-3.0

## 1. Visão geral

O BookmarkForge guarda marcadores, notas e documentos numa coleção pessoal de conhecimento. O conteúdo do seu cofre permanece no armazenamento local do navegador e não é enviado para o BookmarkForge. Se utilizar um fornecedor externo de IA, este recebe apenas os dados que enviar explicitamente para essa função.

O cofre é cifrado localmente com AES-GCM e a chave é derivada da palavra-passe principal através de Argon2id. A palavra-passe é essencial e não pode ser recuperada pelo suporte.

## 2. Primeiros passos

1. Abra [bookmarkforge.com](https://bookmarkforge.com).
2. Instale a PWA quando o navegador oferecer essa opção ou use a aplicação web diretamente.
3. Crie uma palavra-passe principal com pelo menos 12 caracteres.
4. Guarde as 24 palavras de recuperação num local seguro.
5. Exporte regularmente uma cópia `.bmf` cifrada.

Depois do primeiro carregamento, o BookmarkForge pode ser usado offline. O bookmarklet e as extensões guardam rapidamente a página aberta.

## 3. Marcadores e pesquisa

- Guarde o URL, o título, a data e as etiquetas da página.
- A pesquisa inteligente por palavras e significado está incluída no plano Free.
- O Free permite **1.000 marcadores** e não tem limite de dispositivos. Sem a sincronização Pro, cada dispositivo mantém, no entanto, o seu próprio cofre.
- Ao chegar aos 1.000 itens, nada é apagado: leitura, pesquisa e exportação continuam disponíveis. Apenas os novos guardados ficam pausados.
- O Pro remove o limite e sincroniza até três dispositivos através de P2P.

## 4. Importar do Pocket

Abra **Definições → Importar** e selecione `ril_export.html` ou um CSV exportado do Pocket. O formato é detetado e, antes de guardar, é apresentada uma pré-visualização com o número de ligações, datas disponíveis e etiquetas.

Os estados lido, não lido e arquivado são preservados. Se a importação atingir o limite Free, o resultado indica quantos itens foram importados e que o limite foi atingido; os restantes não são contados como ignorados.

## 5. Notas, IA e sincronização

O editor permite criar notas estruturadas, tabelas e ligações entre documentos. Na IA com a sua própria chave API aplicam-se as condições do fornecedor e o pagamento é feito diretamente a esse fornecedor.

A IA local com WebLLM/Ollama, o chat sobre os seus dados, os cartões de estudo e a sincronização P2P são funções Pro. A sincronização P2P pode exigir a mesma rede Wi-Fi ou um serviço de sinalização configurado.

## 6. Cópias de segurança e recuperação

- Crie uma cópia `.bmf` antes de uma migração ou operação importante.
- Guarde várias cópias em locais diferentes.
- A reposição exige a palavra-passe principal.
- Uma palavra-passe perdida não pode ser substituída pelo suporte sem frase de recuperação ou cópia válida.

## 7. Free e Pro

| Função | Free | Pro |
|---|---|---|
| Marcadores | 1.000 | Ilimitados |
| Dispositivos | Sem limite, cofres separados | Até 3 com P2P |
| Pesquisa inteligente | Incluída | Incluída |
| IA com chave própria | Sim | Sim |
| IA local e chat RAG | Não | Sim |
| Exportação JSON/HTML e `.bmf` | Sim | Sim |
| Pagamento | Gratuito | Licença v1 paga uma vez |

Ative o Pro em **Definições → Pro** através do checkout Whop. A ativação contacta o serviço de licenças; o seu cofre não é transferido.

## 8. Resolução de problemas

- **A aplicação não carrega:** atualize o navegador, verifique o espaço disponível e desative extensões problemáticas.
- **O guardado é recusado:** consulte o contador Free; aos 1.000, exporte, elimine um item ou ative o Pro.
- **A sincronização falha:** verifique a rede, a firewall e os IDs dos dispositivos.
- **A licença não ativa:** confirme a ligação e envie o código de erro ao suporte, nunca a palavra-passe ou a frase de recuperação.

## 9. Privacidade e suporte

O conteúdo do cofre permanece local por predefinição. Pagamentos, licenças, IA remota, sinalização P2P e eventuais relatórios de erros tratam apenas os dados técnicos necessários, de acordo com os respetivos consentimentos e condições.

Suporte: `bookmarkforge@proton.me`. O suporte nunca pedirá a palavra-passe nem a frase de recuperação.

*Última atualização: setembro de 2026 · Versão 1.0.0*