# Cache e Observabilidade

**TF da Aula 11 · Frontend · UNIFAAT 2026.2 · Prof. Luan Lourenço**

Este arquivo é a descrição do TF. Link deste TF (por extenso):
https://github.com/luan-tavares/unifaat-2026-frontend/tree/main/aulas/11

**Prazo de entrega: 30/11/2026** (até a próxima aula).

---

## Objetivo

Na aula o `GET /api/relatorio` ganhou **cache-aside no Redis** (HIT/MISS, TTL de
30 s e a flag `cache:ativo`) e o `nodeweb` passou a expor métricas que o
**Prometheus** coleta e o **Grafana** desenha.

No TF você faz duas coisas em cima desse mesmo projeto:

1. **Cache em outro endpoint, com invalidação** (o cache de hoje só expira
   pelo TTL; aqui ele também é apagado quando o dado muda).
2. **Observar o Nginx**: levar métricas dele para o Prometheus e para o Grafana.

Como na Aula 10, **não há app novo**: o código muda **dentro do projeto do
curso** (`src/`, `docker/` e `docker-compose.yml`), na sua branch do fork.

## Antes de começar

Atualize o projeto (veja "Já tinha o projeto? Atualizando" no README da raiz),
suba tudo e confira o que a aula entregou:

```sh
docker compose up -d --build
```

- `http://localhost:8080/api/relatorio` responde (veja o header `X-Cache`)
- `http://localhost:9090/targets` mostra o `nodeweb` como **UP**
- `http://localhost:3002` abre o Grafana (usuário `admin`)

Se algum desses não funciona, resolva antes de começar. Releia o `briefing.md`
desta aula (cache-aside, TTL, invalidação, Prometheus x Grafana).

## O que o TF pede

### 1. Cache com invalidação em outro endpoint

Crie o endpoint `GET /api/mensagens/recentes`, que devolve as **10 últimas
mensagens** do chat (tabela `messages`, ordenadas por `date`).

- ✅ **Cache-aside** no Redis, igual ao `ReportController`: pergunta ao Redis,
  se não tem (MISS) consulta o Postgres, grava com TTL e responde
- ✅ Chave própria: `report:chat-recent`; **TTL de 60 s**
- ✅ Respeita a flag `cache:ativo` (cache desligado = sempre consulta o banco)
- ✅ Header `X-Cache: HIT` ou `MISS` na resposta
- ✅ Conta no `cacheRequests` do Prometheus (use um label novo `endpoint`, sem
  quebrar o que o dashboard já usa)
- ✅ A consulta fica em um **Service** (`src/app/Services/`), nunca dentro do
  Controller

**Invalidação:** quando o worker da fila `save-message` grava uma mensagem
nova, ele **apaga a chave** `report:chat-recent` (e também `report:chat-ranking`)
com `redis.del`. Assim o próximo GET já é MISS e traz a mensagem nova, sem
esperar o TTL.

Responda no `tf.md`: **por que a invalidação fica no worker e não no
`ChatMessageEvent`?** (dica: quem grava no banco é quem sabe que o dado mudou).

### 2. Nginx no Prometheus

Hoje o Prometheus só enxerga o `nodeweb`. O Nginx, que recebe **toda** a
requisição, não aparece. Leve-o para o Grafana:

- ✅ No `default.conf.template`, uma `location = /stub_status` com
  `stub_status;`, **fechada para quem vem de fora** (o navegador em
  `localhost:8080/stub_status` precisa dar 404 ou 403; só a rede interna
  alcança)
- ✅ Um serviço novo no `docker-compose.yml` com a imagem
  `nginx/nginx-prometheus-exporter` que lê esse `stub_status` e expõe `/metrics`
- ✅ O exporter precisa **alcançar o Nginx** (que só está na `edge-network`) e
  ser **alcançado pelo Prometheus** (que só está na `data-network`): decida em
  quais redes ele entra e justifique no `tf.md`
- ✅ Um `job_name` novo no `docker/prometheus/prometheus.yml`
- ✅ Um **painel novo** no dashboard do Grafana (provisionado em
  `docker/grafana/provisioning/`) mostrando as **conexões ativas** do Nginx
  (`nginx_connections_active`) e a **taxa de requisições**
  (`rate(nginx_http_requests_total[1m])`)

Responda no `tf.md`: **o que o `stub_status` mede que o `/metrics` do
`nodeweb` não mede?** (dica: o Nginx vê requisições que nem chegam ao Node,
como arquivos estáticos).

## Regras de código

- ✅ Controller só orquestra; consulta no **Service**, cache em quem decide
  (Controller ou Service, mas igual ao `ReportController`)
- ✅ Chave e TTL em constantes nomeadas no topo do arquivo
- ✅ Booleano com prefixo `is` (`isCacheOn`)
- ✅ Sem `else` / `else if` (early return ou valor padrão antes do `if`)
- ✅ Configuração que você edita (nginx, prometheus, dashboard) em **bind
  mount**; dado gerado fica em volume
- ❌ Nada de publicar porta do exporter no host (ele só precisa das redes)
- ❌ Não commitar `.env`

## Como entregar

A branch **tem que se chamar `RA-tf-11`**: o seu RA, `-tf-` e o número do TF
com 2 dígitos. Exemplo para o RA `1234567`: `1234567-tf-11`.

**Sem a branch com esse nome, o TF vale ZERO.**

1. Fazer o **fork** do repositório do professor e clonar o **seu fork**
   (veja a documentação "Fluxo Git do aluno").
2. Atualizar o `main` e criar a branch do TF a partir dele:

```sh
git switch main
git pull --ff-only upstream main
git switch -c 1234567-tf-11
```

3. Fazer as 2 partes **no próprio projeto** e, na **raiz do repositório**,
   criar um diretório com **exatamente o mesmo nome da branch**, só com o
   `tf.md`:

```text
1234567-tf-11/
└── tf.md
```

4. Criar o `tf.md` com o seu **nome**, o seu **RA**, o seu **GitHub** (link do
   perfil, por extenso) e as **três respostas** pedidas acima (invalidação no
   worker, redes do exporter, o que o `stub_status` mede):

```text
Nome: Maria da Silva
RA: 1234567
GitHub: https://github.com/maria-silva

Invalidação no worker: ...
Redes do exporter: ...
O que o stub_status mede: ...
```

5. Commitar e enviar para o **seu fork** (sem `node_modules` e **sem o
   `.env`**):

```sh
git add -A
git commit -m "TF-11"
git push -u origin 1234567-tf-11
```

6. Abrir o **Pull Request no repositório do professor**
   (`luan-tavares/unifaat-2026-frontend`). O PR **nasce no repositório do
   professor** (o *base*) e traz a sua branch do **seu fork** (o *head*).

   **Pelo navegador** (troque `SEU-USUARIO` pelo seu usuário do GitHub):

```text
https://github.com/luan-tavares/unifaat-2026-frontend/compare/main...SEU-USUARIO:1234567-tf-11?expand=1
```

   **Ou pelo terminal** (GitHub CLI):

```sh
gh pr create \
  --repo luan-tavares/unifaat-2026-frontend \
  --base main \
  --head SEU-USUARIO:1234567-tf-11 \
  --title "TF-11 · 1234567 · Maria da Silva" \
  --body-file 1234567-tf-11/tf.md
```

   - **Título do PR:** `TF-11 · RA · Nome`
   - **Descrição:** o conteúdo do seu `tf.md`
   - **Conferir:** a página do PR mostra `luan-tavares:main ← SEU-USUARIO:1234567-tf-11`

O PR nunca será mergeado: o professor o fecha depois de corrigir. A entrega
termina no Pull Request: **não há formulário**.

## Como conferir antes de entregar

- A branch no GitHub se chama `RA-tf-11` (com o **seu** RA) e existe o
  diretório de mesmo nome com o `tf.md`
- `docker compose up -d --build` sobe tudo, sem container em *restarting*
- **Cache:** 1º `GET /api/mensagens/recentes` = `X-Cache: MISS`, 2º = `HIT`;
  mandar uma mensagem no chat e repetir o GET volta a `MISS` **antes** dos
  60 s (a invalidação funcionou)
- **Flag:** com `cache:ativo` desligado, todas as respostas são `MISS`
- **Nginx:** `localhost:8080/stub_status` **não** responde com dados;
  `http://localhost:9090/targets` mostra o job do exporter como **UP**
- **Grafana:** o painel novo mostra as conexões ativas e a taxa de requisições
  mexendo quando você navega no site
- O exporter **não** tem `ports:` no compose

## Regras gerais

- ✅ Uma branch por TF, com o nome `RA-tf-11`
- ✅ Entrega por Pull Request **aberto no repositório do professor** (título `TF-11 · RA · Nome`)
- ❌ Não commitar no `main`, nem fazer merge do PR
- ❌ Nome da branch fora do formato `RA-tf-11` = TF com nota ZERO

**Prazo:** 30/11/2026.

## Dúvidas?

Revise o `briefing.md` desta aula (cache-aside, TTL, invalidação, o modelo
pull do Prometheus e as duas redes do Docker) e a documentação "Fluxo Git do
aluno" (abas Fluxo do aluno, Comandos Git e Troubleshooting).
