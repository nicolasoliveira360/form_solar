# Formulário de captação — Integradores solares

Site-formulário multi-etapas (capa + 6 perguntas + agradecimento) em HTML, CSS e JavaScript puro. Sem frameworks e sem build.

```
public/index.html   estrutura e textos de todas as telas
public/style.css    identidade visual (cores, Lato, layout responsivo)
public/script.js    lógica: etapas, validação, envio, localStorage, UTMs, funil
public/assets/      logo.png (você adiciona) + logo-placeholder.svg
functions/api/capi.js   Cloudflare Pages Function: POST /api/capi (API de Conversões da Meta,
                        guarda o token e aplica o hash)
```

## Como rodar

**Só o site (sem a API de Conversões):** na pasta `public/`, rode um destes comandos e abra `http://localhost:8080`:

```bash
python -m http.server 8080
# ou
npx serve -l 8080
```

Abrir o `index.html` direto (`file://`) também funciona, mas alguns navegadores o tratam de forma restrita.

**Site + API de Conversões, como em produção:** crie um arquivo `.dev.vars` na raiz (ele não vai para o Git) com `META_ACCESS_TOKEN=...` e, se quiser, `META_TEST_EVENT_CODE=...`, e rode `npx wrangler pages dev public`.

**Publicar:** o projeto é um **Cloudflare Pages** conectado ao Git. Cada push na `main` publica sozinho (ver "API de Conversões" abaixo). Para publicar à mão: `npx wrangler pages deploy public --project-name NOME`.

Para testar UTMs: `http://localhost:8080/?utm_source=facebook&utm_medium=cpc&utm_campaign=teste`

## Logo

Salve a logo em `assets/logo.png`. Ela é exibida com 40px de altura, no topo, à esquerda. Enquanto o arquivo não existir, aparece `assets/logo-placeholder.svg`.

## Configuração (topo do `script.js`)

| Constante | O que faz |
|---|---|
| `WEBHOOK_URL` | Para onde o formulário envia o lead. Hoje é `"/api/lead"` (função do Cloudflare que repassa ao Twenty CRM, ver abaixo). Com `"COLE_AQUI"` o envio é simulado. |
| `CAL_LINK` / `CAL_NAMESPACE` / `CAL_ELEMENT_ID` | Agenda do Cal.com exibida (incorporação inline) para leads **qualificados** depois do envio. Nome e resumo do lead já vão preenchidos. Leads não qualificados não veem a agenda. |
| `WEBHOOK_AS_TEXT_PLAIN` | Mude para `true` se o seu webhook der erro de CORS (ex.: Zapier). O corpo segue sendo JSON. |

> Enquanto `WEBHOOK_URL` for `"COLE_AQUI"`, o envio é **simulado** (o payload aparece no console do navegador) para você testar o fluxo.

## Twenty CRM

O lead segue este caminho: formulário → `POST /api/lead` (`functions/api/lead.js`) → webhook do workflow **"Novo lead do formulário (site)"** no Twenty, que cria **Empresa**, **Pessoa** (e-mail, WhatsApp, ligada à empresa) e **Oportunidade** (ligada às duas).

- A URL do webhook do Twenty fica só no servidor: crie a variável **`TWENTY_WEBHOOK_URL`** (como Secret) no Cloudflare Pages. A URL aparece no gatilho do workflow, no editor do Twenty. Sem ela, `/api/lead` responde 500 e o lead vê "Ops, algo deu errado". Depois de criar a variável, faça um novo deploy.
- Lead qualificado entra na etapa **Screening**; os demais, em **New**.
- Campos criados na Oportunidade: Cidade/UF, Instalações por mês, Origem dos clientes, Investimento mensal em marketing, Lead qualificado, UTM source/medium/campaign/content/term e URL da página.
- Para rodar tudo local, ponha `TWENTY_WEBHOOK_URL=...` no `.dev.vars` e use `npx wrangler pages dev public`.

## Webhook: o que é enviado

`POST` com `Content-Type: application/json`:

```json
{
  "nome": "João Silva",
  "whatsapp": "(11) 99999-8888",
  "email": "joao@solartech.com.br",
  "empresa": "Solar Tech",
  "cidade_uf": "Campinas/SP",
  "instalacoes_mes": "6 a 15",
  "origem_clientes": "Indicação",
  "investimento_mensal": "R$ 2.000 a R$ 5.000",
  "qualificado": "sim",
  "data_hora": "2026-01-15T14:32:10.000Z",
  "url_pagina": "https://seusite.com/?utm_source=facebook",
  "utm_source": "facebook",
  "utm_medium": "",
  "utm_campaign": "",
  "utm_content": "",
  "utm_term": ""
}
```

- **Qualificação:** `"qualificado": "sim"` quando o lead faz **6+ instalações/mês** (qualquer opção além de "Até 5") **e** pode investir **R$ 2.000+** (qualquer opção além de "Até R$ 2.000"). Caso contrário, `"não"`. A regra está na função `isQualified` do `script.js`.
- **UTMs:** lidos da URL quando a página carrega e guardados no localStorage, então continuam sendo enviados mesmo se a página recarregar sem os parâmetros.
- **Falhas:** se o envio falhar (erro de rede, resposta fora de 2xx ou mais de 15s), tenta mais uma vez. Se falhar de novo, mostra "Ops, algo deu errado. Tente novamente." e o botão volta a funcionar.

## Funil e Meta Pixel

O código base do pixel (ID `1874281433734075`) está no `<head>` do `index.html` e dispara o `PageView`. Os eventos do funil passam pela função `track` do `script.js`, que também escreve no console (`window.funnelEvents` guarda o histórico).

| Evento do funil | Evento enviado à Meta |
|---|---|
| `ViewForm` | `PageView` (código base) |
| `FormSubmitted` | `Lead` |
| `FormSubmittedQualified` | `LeadQualificado` (personalizado) |
| `ViewScheduling` | `ViewContent` |
| `SchedulingConfirmed` | `Schedule` |

Para validar, use a extensão Meta Pixel Helper ou a aba Teste de eventos do Gerenciador de Eventos.

### API de Conversões (servidor)

Cada evento da tabela (menos o `PageView`) é enviado **duas vezes com o mesmo `event_id`**: pelo pixel, no navegador, e por `functions/api/capi.js`, no servidor. A Meta deduplica e conta uma vez só. O servidor acrescenta IP, user agent, `fbp`/`fbc` e os dados do lead (`em`, `ph`, `fn`, `ln`, `ct`, `st`, `country`, `external_id`), normalizados e com hash SHA-256.

O **token de acesso fica só no servidor**. Nunca coloque no `script.js` ou no `index.html`.

Publicação no **Cloudflare Pages** conectado ao Git. Na criação do projeto: Framework preset **None**, Build command vazio e **Build output directory `public`**. A pasta `functions/` na raiz do repositório é publicada automaticamente (o upload por arrastar e soltar ignora as funções):

1. Em *Settings > Variables and Secrets* do projeto, crie `META_PIXEL_ID` e `META_ACCESS_TOKEN` (como segredo). Opcionais: `ALLOWED_ORIGIN` (ex.: `https://seusite.com`) e `META_TEST_EVENT_CODE`. As variáveis só valem em deploys novos.
2. O token é gerado em Gerenciador de Eventos > pixel > Configurações > API de Conversões > *Gerar token de acesso*.
3. Para testar, preencha `META_TEST_EVENT_CODE` com o código da aba *Teste de eventos*; os eventos do servidor aparecem lá como "Servidor". **Remova a variável antes de rodar a campanha.**
4. Se o front-end e a função estiverem em domínios diferentes, troque `CAPI_ENDPOINT` no topo do `script.js` pela URL completa.

Sem a função no ar (ex.: abrindo o `index.html` direto), o pixel continua funcionando e o console mostra um aviso "API de Conversões não enviou ...".

## Como editar os textos

- **Capa, perguntas, opções, agradecimento (título fixo):** `index.html`. Cada tela é uma `<section class="screen" data-step="N">`.
- **Mensagens de erro, textos da tela final e mensagem do WhatsApp:** `script.js` (procure por `validators` e `onSuccess`).
- **Cores:** variáveis no começo do `style.css` (`--navy`, `--orange`, `--orange-hover`, `--yellow`, `--gray`).

Se mudar as opções de **instalações** ou **investimento**, atualize também as listas `INSTALACOES` e `INVESTIMENTO` no `script.js` (a ordem define a qualificação).

## Comportamento

- Perguntas de múltipla escolha avançam sozinhas 300ms após o clique. Na última (investimento), o clique dispara o envio.
- Campos de texto avançam com o botão "Continuar" ou Enter.
- As respostas ficam no `localStorage` (chave `solarForm.v1`); se a página recarregar, o lead volta de onde parou. O armazenamento é apagado após o envio com sucesso.
- Para recomeçar durante os testes: DevTools → Application → Local Storage → apague `solarForm.v1`, ou rode `localStorage.clear()` no console.
