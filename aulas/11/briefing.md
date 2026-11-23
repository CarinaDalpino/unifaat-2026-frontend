Briefing para produção audiovisual e de conteúdo
Aula Completa
2026.2



Professor: Luan Tavares Lourenço
Disciplina: Frontend


Aula:
1☐ 2☐ 3☐ 4☐ 5☐ 6☐ 7☐ 8☐ 9☐ 10☐ 11☒ 12☐ 13☐ 14☐ 15☐ 16☐


Título da aula:

Cache e Observabilidade


Opção do TA:  Vídeo ☐Texto ☒

1 - Introdução

Ao longo do semestre construímos, aula a aula, as peças de uma aplicação web: servidor de arquivos estáticos e DOM, CSS, Vite e formulários, API com Axios, TypeScript, React com estados e efeitos, Docker com Nginx, Elasticsearch, filas e WebSockets. Cada aula acrescentou **uma caixa** ao desenho. Esta aula não traz uma tecnologia nova isolada: ela **junta as caixas num mapa só** e responde a pergunta que define uma arquitetura: **o que fica onde, e por quê**.

A aula tem quatro movimentos. Primeiro, o **mapa**: o caminho de uma requisição do navegador até o dado, com o papel de cada container. Segundo, a **segmentação da rede**: em vez de um único *network* em que todo container enxerga todos os outros, usamos **dois networks** e deixamos cada container só onde precisa estar. Terceiro, o **cache com Redis**: o que fazer quando a mesma pergunta pesada chega mil vezes. Quarto, a **observabilidade**: Prometheus e Grafana para **enxergar** o que o sistema faz enquanto a sala inteira o usa.

Fechamos com uma demonstração em que **a sala vira o tráfego**: cada aluno dispara requisições para a aplicação rodando no notebook do professor, pela rede da sala, e o painel no projetor mostra a latência subir, o cache entrar e a latência cair.

Os exemplos usam o projeto do curso (`_web.js`, `app/Http`, `database/connections`, `docker-compose.yml`).

2 - O Mapa da Arquitetura

2.1 - Uma Requisição, do Navegador ao Dado

Uma arquitetura é, antes de tudo, um **desenho de caminhos**: por onde passa cada pedido e quem responde por quê. No nosso projeto, uma requisição comum percorre este caminho:

```text
 Navegador          Nginx            nodeweb              Redis / Postgres
 ┌─────────┐      ┌────────┐      ┌───────────┐      ┌──────────────────────┐
 │ React   │─────►│ :8080  │─────►│ Express   │─────►│ cache? → Redis       │
 │ Axios   │◄─────│ proxy  │◄─────│ :3000     │◄─────│ senão  → Postgres    │
 └─────────┘      └────────┘      └─────┬─────┘      └──────────────────────┘
                                        │ dispatch (só quando há trabalho pesado)
                                  ┌─────▼─────┐      ┌───────────────┐
                                  │ RabbitMQ  │─────►│ worker        │──► Elasticsearch
                                  └───────────┘      └───────────────┘
```

Repare que a resposta ao navegador **não espera** o trecho de baixo: o que é pesado ou demorado sai do ciclo HTTP (Aula 10). Quem decide o que entra no caminho **síncrono** (o navegador espera) e o que vai para o **assíncrono** (a fila resolve depois) é o arquiteto, não a tecnologia.

2.2 - Quem Faz o Quê

Cada caixa tem **uma responsabilidade**, e a aula em que ela apareceu:

| Container | Responsabilidade | Aula |
| --- | --- | --- |
| `nginx` | porta de entrada: arquivos estáticos, repassa o resto ao Node e o `Upgrade` ao websocket | Docker/Nginx |
| `nodeweb` | API e views: valida, consulta, responde | API |
| `nodeworker` | executa jobs pesados fora do ciclo HTTP | Filas / 10 |
| `nodewebsocket` | mantém os túneis dos clients e distribui eventos | 10 |
| `nodecommand` | comandos de linha (migração, seed) | 07 |
| `rabbitmq` | entrega jobs (fila) e notificações (exchange) | Filas / 10 |
| `postgres` | dado oficial, relacional | Banco de dados |
| `elasticsearch` | busca textual | 07 |
| `redis` | cache em memória na frente do banco | **11** |
| `prometheus` e `grafana` | coletar e mostrar as métricas | **11** |

2.3 - Duas Perguntas Que Guiam o Desenho

Quase toda decisão de arquitetura desta disciplina responde a uma de duas perguntas:

- **O navegador precisa esperar por isso?** Se não, vira job (fila + worker). Se sim, tem que ser **rápido**, e é aí que entra o cache;
- **Quem precisa enxergar quem?** O navegador enxerga o Nginx. O Nginx enxerga o Node. O Node enxerga os dados. **Ninguém de fora** precisa enxergar o banco. É a pergunta da próxima seção.

3 - Redes Docker: Segmentando a Arquitetura

3.1 - O Problema de Uma Rede Só

Hoje todos os containers do `docker-compose.yml` estão no mesmo *network*, o `app-network`. Isso significa que **qualquer container alcança qualquer outro** pelo nome: o Nginx consegue falar direto com o Postgres, o RabbitMQ e o Elasticsearch, mesmo que isso **nunca** faça sentido. Se um container for comprometido, o caminho até os dados está aberto.

A regra da segmentação é o **princípio do menor privilégio** aplicado à rede: cada container só enxerga o que precisa para trabalhar.

3.2 - Dois Networks: Borda e Dados

Dividimos a rede em duas, e os containers entram **só onde precisam**, ou **nas duas** quando fazem a ponte:

```text
        ┌──────────────── edge-network ────────────────┐
        │   nginx        grafana                       │
        │                                              │
        │          nodeweb      nodewebsocket          │  ◄── nas DUAS redes
        └───────────────────┬──────────────────────────┘
        ┌───────────────────┴──── data-network ────────┐
        │   nodeweb  nodewebsocket  nodeworker  nodecommand
        │   postgres  elasticsearch  rabbitmq  redis  prometheus  grafana
        └──────────────────────────────────────────────┘
```

| | edge-network | data-network |
| --- | --- | --- |
| `nginx` | sim | **não** |
| `nodeweb` e `nodewebsocket` | sim | sim (**ponte**) |
| `nodeworker` e `nodecommand` | não | sim |
| `postgres`, `elasticsearch`, `rabbitmq`, `redis` | **não** | sim |
| `prometheus` | não | sim |
| `grafana` | sim (o professor abre) | sim (consulta o Prometheus) |

O `nodeweb` e o `nodewebsocket` estão nas duas porque **recebem** do Nginx (borda) e **consultam** os dados (rede de dados). Eles são a **ponte**. O Nginx, ao contrário, **nunca** aparece na rede de dados.

3.3 - No docker-compose.yml

Cada serviço lista os *networks* em que entra, e o **alias** (o nome pelo qual os outros o encontram) é definido **por network**:

```yaml
services:

  nginx-container:
    build:
      context: .
      dockerfile: docker/nginx/Dockerfile
    ports:
      - "${NGNIX_WEB_PORT}:${NGINX_PORT}"
    networks:
      - edge-network                      # só a borda

  nodeweb-container:
    build:
      context: .
      dockerfile: docker/node-web/Dockerfile
    networks:
      edge-network:                       # o nginx chega aqui
        aliases:
          - nodeweb_host
      data-network:                       # e daqui o nodeweb chega aos dados
        aliases:
          - nodeweb_host

  postgres-container:
    image: postgres:18
    ports:
      - "${POSTGRES_PORT}:5432"           # porta publicada no host (seção 3.5)
    networks:
      data-network:                       # só a rede de dados
        aliases:
          - postgres_host

  redis-container:
    image: redis:7.4-alpine
    restart: unless-stopped
    ports:
      - "${REDIS_HOST_PORT:-6375}:6379"   # do host: localhost:6375; na rede: redis_host:6379
    networks:
      data-network:
        aliases:
          - redis_host

networks:
  edge-network:
    driver: bridge
  data-network:
    driver: bridge
```

3.4 - Provando Que Funciona

O teste é simples: de dentro do Nginx, o nome do banco **não existe**:

```bash
# o nginx está só na borda: não resolve o nome do postgres
docker compose exec nginx-container ping -c 1 postgres_host
# ping: bad address 'postgres_host'

# o nginx enxerga o nodeweb (mesma rede)
docker compose exec nginx-container ping -c 1 nodeweb_host
```

Dois cuidados importantes:

- o **alias vale por network**: um nome só é resolvido por quem compartilha **alguma** rede com o container;
- **`depends_on` não isola nada**: ele só controla a **ordem de subida**. Quem isola é o *network*.

3.5 - Network Não é Porta Publicada

Segmentar a rede protege o tráfego **entre containers**. Já o `ports:` do compose **publica a porta na máquina** (o *host*), e isso vale **independente do network**. No nosso projeto várias portas estão publicadas **de propósito**, para o professor enxergar cada peça:

| Porta no host | Container | Para quê |
| --- | --- | --- |
| `8080` (`NGNIX_WEB_PORT`) | `nginx` | a aplicação |
| `5172` | `nodevitehmr` | Vite em modo desenvolvimento |
| `6789` (`POSTGRES_PORT`) | `postgres` | DBeaver, `psql` |
| `5672` e `15672` | `rabbitmq` | AMQP e painel de administração |
| `6375` (`REDIS_HOST_PORT`) | `redis` | `redis-cli`, RedisInsight |
| `3002` (`GRAFANA_PORT`) | `grafana` | o painel |
| `9090` (`PROMETHEUS_PORT`) | `prometheus` | *Status > Targets* e consultas PromQL |

Isso tem um custo: qualquer pessoa que alcance o seu notebook pela rede da sala consegue conectar nessas portas, e o **Redis não tem senha**. O network não impede, porque o `ports:` abre uma porta **do host** para dentro do container.

Para um banco ficar mesmo **inacessível de fora**, o caminho é **não ter `ports:`**: o acesso interno continua pelo network (`postgres_host:5432`) e só o acesso externo some. O Elasticsearch do projeto já é assim, de propósito:

```yaml
  elasticsearch-container:
    image: elasticsearch:8.15.0
    # sem "ports": só a data-network alcança o Elasticsearch
    networks:
      data-network:
        aliases:
          - elasticsearch_host
```

Em produção o raciocínio é o mesmo: publica-se só o que precisa ser alcançado de fora (o Nginx), e todo o resto fica **só na rede interna**.

4 - Cache com Redis

4.1 - O Problema: a Mesma Pergunta, o Mesmo Custo

O chat da Aula 10 passa a **gravar cada mensagem** no Postgres (seção 4.5), e a tela de ranking mostra **quem mais mandou mensagem**. Para montar isso, o Postgres precisa **varrer a tabela `messages` inteira** e agrupar por nome. Com poucas mensagens é barato; com dezenas de milhares de linhas, já pesa quando muita gente pede ao mesmo tempo. O problema não é fazê-la **uma vez**: é que **a resposta é a mesma** para todo mundo, e a consulta cara é repetida a cada requisição.

A saída é guardar a resposta pronta **em memória**, e servir dela enquanto ela ainda vale. É o **cache**.

4.2 - O Que é o Redis

O **Redis** é um banco **chave-valor em memória**. Como tudo fica na RAM, a leitura é de microssegundos. Ele não substitui o Postgres: o dado **oficial** continua lá. O Redis guarda **cópias** que se pode perder e refazer.

| Comando | O que faz |
| --- | --- |
| `SET chave valor EX 30` | grava o valor e **expira** em 30 segundos (TTL) |
| `GET chave` | devolve o valor, ou nada se não existe ou expirou |
| `DEL chave` | apaga a chave (**invalidação**) |
| `INCR chave` | soma 1 atomicamente (contadores) |

4.3 - O Padrão Cache-Aside

O padrão mais comum chama-se **cache-aside**: a **aplicação** decide o que consultar, e o cache fica "ao lado" do banco:

```text
  requisição
      │
      ▼
  existe no Redis? ──── sim (HIT) ───► responde direto do Redis
      │
     não (MISS)
      │
      ▼
  consulta o Postgres ─► grava no Redis com TTL ─► responde
```

Na primeira requisição (MISS) o custo é o do banco, mais o da gravação no Redis. Nas seguintes, **dentro do TTL**, o Postgres nem é tocado (HIT).

4.4 - TTL e Invalidação

Cache guarda uma **cópia**, e cópia envelhece. Existem duas defesas:

- **TTL** (*time to live*): a chave **expira sozinha** depois de N segundos. Limita **por quanto tempo** o dado pode ficar velho;
- **Invalidação**: ao **escrever** o dado (criar uma tarefa, concluir uma tarefa), apaga-se a chave (`DEL`) e a próxima leitura refaz o cache. Pode ser feita no próprio controller, ou por um **job/evento** depois da gravação, usando a fila que já conhecemos.

Não existe TTL "certo": ele é um **trade-off** entre dado fresco e carga no banco. Um relatório que muda pouco aceita 30 segundos; um saldo bancário não aceita cache nenhum.

4.5 - As Mensagens do Chat: Tabela, Job e Fila

Antes do cache, precisamos do **dado**. Uma *migration* cria a tabela `messages` com `ip`, `name`, `message` e `date`:

```js
// src/database/migrations/004_create_messages_table.js
export async function up(db) {
  await db.query(`
    CREATE TABLE messages (
      id SERIAL PRIMARY KEY,
      ip VARCHAR(45) NOT NULL,
      name VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export async function down(db) {
  await db.query(`
    DROP TABLE messages
  `)
}
```

Rodando o comando de migração no container efêmero:

```bash
docker compose run --rm nodecommand-container migrate
```

Quem **grava** não é o websocket. É a regra da Aula 10: o websocket só conecta e distribui, e o que persiste vai para um **worker pelo mesmo RabbitMQ**. O Event faz o `dispatch` de um job na fila `save-message`, e um worker dedicado consome só essa fila:

```js
// src/app/Events/Chat/ChatMessageEvent.js (acrescentar, depois do notify)
await SaveMessageJob.dispatch('save-message', { ip: ipOf(context.socket), name, message, sentAt })
```

```js
// src/app/Jobs/SaveMessageJob.js
import { createJob } from '../../utils/job.js'
import MessageModel from '../Models/MessageModel.js'

export default createJob({
    name: 'SaveMessageJob',
    handle: async (payload) => {
        const { ip, name, message, sentAt } = payload

        await MessageModel.create({ ip, name, message, date: new Date(sentAt) })

        console.log(`Mensagem de ${name} (${ip}) salva no Postgres`)
    }
})
```

No compose, um segundo worker da **mesma imagem** recebe o argumento `--queue save-message` no `command`, e o worker de antes continua na fila `default`:

```yaml
  nodeworkersavemessage-container:
    build:
      context: .
      dockerfile: docker/node-worker/Dockerfile
    command: ["--queue", "save-message"]   # argumento do entrypoint: a fila deste worker
    networks:
      data-network:
        aliases:
          - nodeworkersavemessage_host
```

Uma pegadinha: o `dispatch` fechava a conexão do RabbitMQ ao terminar, o que serve a um controller (processo curto). No websocket a conexão **já está aberta** (ele assina o exchange), e fechá-la derrubaria o chat inteiro. Por isso o `dispatch` agora só fecha a conexão que **ele mesmo abriu** (`rabbit.isConnected()`).

Para o ranking pesar, precisa de volume de dados. Um seed grande:

```sql
INSERT INTO messages (ip, name, message, date)
SELECT '192.168.0.' || (1 + n % 50),
       'Aluno ' || (1 + n % 40),
       'mensagem ' || n,
       NOW() - (n || ' seconds')::interval
  FROM generate_series(1, 50000) AS n;
```

4.6 - O Redis no Projeto

O container entra no `data-network` (seção 3.3), com a porta `6375` publicada no host para inspecionar com `redis-cli -p 6375`. A conexão fica junto das outras, em `database/connections`. Ela **conecta só no primeiro uso**: importar o módulo não derruba o processo se o Redis estiver fora, e a mesma conexão é reaproveitada.

```js
// src/database/connections/redis.js
import { configDotenv } from 'dotenv'
import { createClient } from 'redis'

export default (() => {
    configDotenv({
        quiet: true
    })

    const isDocker = process.env.IS_DOCKER === 'true'
    const redisHost = process.env.REDIS_HOST || (isDocker ? 'redis_host' : 'localhost')
    const redisPort = process.env.REDIS_PORT || '6379'

    const client = createClient({
        url: `redis://${redisHost}:${redisPort}`
    })

    client.on('error', (error) => {
        console.error('Redis:', error.message)
    })

    // Conecta só no primeiro uso; se falhar, a próxima chamada tenta de novo
    let connecting = null

    const connect = () => {
        connecting = connecting ?? client.connect().catch((error) => {
            connecting = null
            throw error
        })

        return connecting
    }

    const get = async (key) => {
        await connect()
        return client.get(key)
    }

    // ttlSeconds: a chave expira sozinha (o TTL do cache)
    const set = async (key, value, ttlSeconds) => {
        await connect()
        return client.set(key, value, { expiration: { type: 'EX', value: ttlSeconds } })
    }

    const del = async (key) => {
        await connect()
        return client.del(key)
    }

    return { get, set, del }
})()
```

No `docker-compose.yml`, o `nodeweb`, o `nodecommand` e os workers ganham `REDIS_HOST: redis_host` e `REDIS_PORT: 6379` no `environment` e entram no `depends_on` do Redis. A variável do **host** se chama `REDIS_HOST_PORT` (e não `REDIS_PORT`) para não colidir com a porta **interna** que os apps usam.

4.7 - A Rota Pesada com Cache-Aside

A rota `GET /api/relatorio` devolve o ranking do chat, com o interruptor `cache:ativo` (uma chave no próprio Redis) que o professor liga e desliga **sem reiniciar nada**. Sem `else`: cada desvio sai com `return`. A consulta cara fica num *service*:

```js
// src/app/Services/ChatReportService.js
import { QueryTypes } from 'sequelize'
import sequelize from '../../database/connections/sequelize.js'

export default {
    async ranking() {
        return sequelize.query(
            `SELECT name,
                    COUNT(*) AS total,
                    MAX(date) AS last_message_at
               FROM messages
              GROUP BY name
              ORDER BY total DESC
              LIMIT 10`,
            { type: QueryTypes.SELECT }
        )
    }
}
```

```js
// src/app/Http/Controllers/ReportController.js
import redis from '../../../database/connections/redis.js'
import ChatReportService from '../../Services/ChatReportService.js'
import { cacheRequests } from '../../../utils/metrics.js'

const CACHE_KEY = 'report:chat-ranking'
const CACHE_TTL_SECONDS = 30

export default async function ReportController(request, response) {
    try {
        const isCacheOn = (await redis.get('cache:ativo')) === '1'

        if (isCacheOn) {
            const cached = await redis.get(CACHE_KEY)

            if (cached) {
                cacheRequests.inc({ result: 'hit' })
                response.set('X-Cache', 'HIT')
                return response.json(JSON.parse(cached))
            }
        }

        const ranking = await ChatReportService.ranking()

        if (isCacheOn) {
            await redis.set(CACHE_KEY, JSON.stringify(ranking), CACHE_TTL_SECONDS)
        }

        cacheRequests.inc({ result: 'miss' })
        response.set('X-Cache', 'MISS')
        return response.json(ranking)
    } catch (error) {
        console.error(error)

        return response.status(500).json({
            error: 'Internal server error'
        })
    }
}
```

O header `X-Cache: HIT` ou `MISS` diz **de onde veio a resposta**: o botão do chat (seção 6.2) o usa para contar os acertos. Com o cache **desligado**, toda requisição conta como *miss* e vai ao Postgres. Com ele **ligado**, só a primeira de cada janela de 30 segundos vai ao banco.

O interruptor é protegido por um segredo da variável de ambiente (`ADMIN_TOKEN`), para os alunos não o desligarem. Sem `ADMIN_TOKEN` configurado, **ninguém** entra:

```js
// src/app/Http/Middlewares/AdminMiddleware.js
export default function AdminMiddleware(request, response, next) {
    const token = process.env.ADMIN_TOKEN

    if (!token || request.headers['x-admin-token'] !== token) {
        return response.status(401).json({ error: 'Unauthorized' })
    }

    return next()
}
```

```js
// src/app/Http/Controllers/ToggleCacheController.js
import redis from '../../../database/connections/redis.js'

export default async function ToggleCacheController(request, response) {
    try {
        const isActive = request.body?.ativo === true

        // a flag vale por 24 h; depois expira e o cache volta a ficar desligado
        await redis.set('cache:ativo', isActive ? '1' : '0', 60 * 60 * 24)

        return response.json({ ativo: isActive })
    } catch (error) {
        console.error(error)

        return response.status(500).json({
            error: 'Internal server error'
        })
    }
}
```

```js
// src/routes/router.js (acrescentar)
router.get('/api/relatorio', ReportController);
router.post('/api/admin/cache', AdminMiddleware, ToggleCacheController);
```

O professor liga e desliga do terminal, na frente da sala:

```bash
# liga o cache
curl -X POST http://localhost:8080/api/admin/cache -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"ativo": true}'

# desliga o cache
curl -X POST http://localhost:8080/api/admin/cache -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"ativo": false}'

# confere o estado: 1 = ligado, 0 = desligado, vazio = nunca ligado (vale desligado)
redis-cli -p 6375 get cache:ativo
```

5 - Observabilidade

5.1 - Enxergar Para Decidir

O conceito de observabilidade já foi visto em outra aula; aqui ele serve a um propósito concreto: **provar** que a decisão de arquitetura funcionou. Dizer "o cache deixa mais rápido" é opinião. Mostrar no painel a latência **antes e depois** é evidência. Três números bastam para a demonstração:

- **quantas requisições por segundo** chegam (taxa);
- **quanto elas demoram** (latência, em percentil);
- **quantas foram servidas pelo cache** (taxa de acerto, o *hit ratio*).

5.2 - Prometheus × Grafana

São duas peças com papéis diferentes:

| | Prometheus | Grafana |
| --- | --- | --- |
| Papel | **coleta e guarda** as métricas | **mostra** as métricas |
| Como funciona | a cada N segundos faz `GET /metrics` no nodeweb (modelo *pull*) e grava | consulta o Prometheus (*data source*) e desenha gráficos |
| Guarda dado? | sim, séries temporais (valor + horário) | **não** |
| Linguagem | PromQL | usa o PromQL do Prometheus |

O fluxo: o `nodeweb` **expõe** o `/metrics`, o Prometheus **coleta**, o Grafana **desenha**.

5.3 - Expondo as Métricas no Express

A biblioteca `prom-client` cria as métricas e formata o texto que o Prometheus lê. As métricas ficam **na memória do processo** `nodeweb` (poucos números, que só crescem), e o Prometheus **vem buscá-las**. Duas métricas próprias: um **histograma** da duração das requisições e um **contador** de acertos e erros do cache.

```js
// src/utils/metrics.js
import { Registry, Histogram, Counter, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();

// métricas do processo Node (memória, CPU, event loop)
collectDefaultMetrics({ register });

export const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP em segundos',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register]
});

export const cacheRequests = new Counter({
    name: 'cache_requests_total',
    help: 'Consultas ao cache, por resultado (hit ou miss)',
    labelNames: ['result'],
    registers: [register]
});
```

Um middleware mede cada requisição, e a rota `/metrics` entrega o texto. Cuidado com o *label* `route`: ele usa o **padrão da rota** (`/api/relatorio`), nunca a URL com ids, porque cada valor novo de *label* vira uma **série nova** e a memória cresceria sem parar:

```js
// src/app/Http/Middlewares/MetricsMiddleware.js
import { httpDuration } from '../../../utils/metrics.js'

export default function MetricsMiddleware(request, response, next) {
    const stopTimer = httpDuration.startTimer()

    response.on('finish', () => {
        const route = request.route ? request.baseUrl + request.route.path : 'outras'

        stopTimer({
            method: request.method,
            route: route,
            status: response.statusCode
        })
    })

    return next()
}
```

```js
// src/app/Http/Controllers/MetricsController.js
import { register } from '../../../utils/metrics.js'

export default async function MetricsController(request, response) {
    response.set('Content-Type', register.contentType)

    return response.end(await register.metrics())
}
```

```js
// src/routes/router.js (acrescentar)
router.use(MetricsMiddleware);
router.get('/metrics', MetricsController);
```

5.4 - O /metrics Não Pode Ser Público

O Nginx repassa ao Node **tudo que não é arquivo estático**, e isso inclui o `/metrics`: qualquer pessoa na sala conseguiria lê-lo pelo navegador. A correção é **bloquear no Nginx**. O Prometheus **não passa pelo Nginx**: ele coleta direto no `nodeweb`, pelo `data-network`.

```nginx
# default.conf.template (antes do "location /")
location = /metrics {
    return 404;  # o Prometheus coleta direto no nodeweb, pela data-network
}
```

5.5 - Prometheus e Grafana no Compose

Os dois containers entram no compose; as configurações ficam em arquivos montados como pasta do seu PC, para o painel subir **pronto**, sem clicar em nada. O histórico do Prometheus e o banco interno do Grafana (usuários e senha) ficam em **volumes**, para sobreviverem a um `docker compose down`:

```yaml
# docker/prometheus/prometheus.yml
global:
  scrape_interval: 5s              # coleta a cada 5 segundos

scrape_configs:
  - job_name: nodeweb
    metrics_path: /metrics
    static_configs:
      - targets: ["nodeweb_host:3000"]   # alias do nodeweb na data-network (não passa pelo nginx)
```

```yaml
# docker-compose.yml (acrescentar)
  prometheus-container:
    image: prom/prometheus:v3.5.0
    restart: unless-stopped
    depends_on:
      - nodeweb-container
    ports:
      - "${PROMETHEUS_PORT:-9090}:9090"
    volumes:
      - ./docker/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml   # configuração (lê)
      - prometheus-volume:/prometheus                                       # as séries (escreve)
    networks:
      data-network:
        aliases:
          - prometheus_host

  grafana-container:
    image: grafana/grafana:12.1.0
    restart: unless-stopped
    env_file:
      - .env
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-admin}
      POSTGRES_HOST: postgres_host
      POSTGRES_PORT: 5432
    ports:
      - "${GRAFANA_PORT:-3002}:3000"
    volumes:
      - ./docker/grafana/provisioning:/etc/grafana/provisioning   # fontes de dados e dashboard
      - grafana-volume:/var/lib/grafana                           # usuários, senha, preferências
    networks:
      edge-network:
        aliases:
          - grafana_host
      data-network:
        aliases:
          - grafana_host

volumes:
  prometheus-volume:
  grafana-volume:
```

O Grafana está nos **dois** networks: na borda, porque o professor o abre no navegador; nos dados, porque ele precisa alcançar o Prometheus e o Postgres. O acesso é `http://localhost:3002`, com usuário `admin` e a senha de `GRAFANA_PASSWORD` (padrão `admin`; ela só vale se definida **antes** da primeira subida, porque depois fica gravada no `grafana-volume`).

O Grafana **não guarda nada** das métricas: ele só consulta. As **fontes de dados** são criadas na subida, por *provisioning*: o Prometheus (as métricas) e o Postgres (as mensagens do chat):

```yaml
# docker/grafana/provisioning/datasources/datasources.yml
apiVersion: 1

datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://prometheus_host:9090
    isDefault: true

  - name: Postgres
    uid: postgres
    type: grafana-postgresql-datasource
    access: proxy
    url: postgres_host:5432
    user: $POSTGRES_USER
    jsonData:
      database: $POSTGRES_DB
      sslmode: disable
    secureJsonData:
      password: $POSTGRES_PASSWORD
```

O dashboard também vem pronto, em JSON (`docker/grafana/provisioning/dashboards/cache-observabilidade.json`). **Cada painel é uma consulta que escrevemos**, apontando para uma das duas fontes: **PromQL** para o Prometheus e **SQL** para o Postgres.

5.6 - As Consultas do Painel

O dashboard tem seis painéis. Os quatro primeiros usam PromQL no Prometheus; os dois últimos usam SQL no Postgres:

```text
# requisições por segundo (média do último minuto)
sum(rate(http_request_duration_seconds_count[1m]))

# latência p95: o tempo abaixo do qual ficam 95% das requisições
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))

# taxa de acerto do cache (0 a 1)
sum(rate(cache_requests_total{result="hit"}[1m])) / sum(rate(cache_requests_total[1m]))

# hits e misses por segundo (um gráfico com as duas linhas)
sum(rate(cache_requests_total[1m])) by (result)
```

```sql
-- mensagens por minuto (fonte Postgres)
SELECT date_trunc('minute', date) AS time, COUNT(*) AS mensagens
  FROM messages
 GROUP BY 1
 ORDER BY 1;

-- log das mensagens do chat: as últimas gravadas pelo job save-message
SELECT date, name, ip, message FROM messages ORDER BY date DESC LIMIT 100;
```

A latência aparece como **p95** e não como média porque a média **esconde as requisições lentas**: se 95 requisições levam 10 ms e 5 levam 2 segundos, a média parece aceitável, mas 5% dos usuários sentiram uma lentidão enorme. O histograma guarda a **contagem por faixa de tempo** (*buckets*), e é isso que permite calcular o percentil.

Duas perguntas que costumam surgir: o **Prometheus não lê `stderr` nem recebe nada**: quem busca é ele (*pull*), no `/metrics`; e os contadores **não são zerados** quando ele coleta: o valor acumulado fica na memória do `nodeweb`, e o histórico fica no disco do Prometheus (`prometheus-volume`). Se o `nodeweb` reiniciar, o contador volta a zero, e o `rate()` trata isso como reinício.

6 - A Demonstração: a Sala Vira o Tráfego

6.1 - O Roteiro

Todos os alunos abrem a aplicação pelo IP do notebook do professor na rede da sala. O painel do Grafana fica no projetor. O roteiro tem três atos:

1. **Cache desligado:** a sala toda clica em "disparar 50 requisições". A taxa de requisições sobe, a latência p95 dispara, a taxa de acerto do cache fica em **zero**, e o Postgres é martelado a cada clique;
2. **Cache ligado:** o professor liga o interruptor (`curl` da seção 4.7). Nada mais muda: o mesmo botão, o mesmo código. A taxa de acerto sobe, a latência **despenca**, o Postgres respira;
3. **A prova de que network não é porta:** cada aluno tenta, do próprio notebook, conectar na porta do Redis (`6375`) do notebook do professor. A conexão **funciona**, porque o `ports:` abriu a porta no host (seção 3.5), mesmo com o Redis na `data-network`. Para fechar, tira-se o `ports:`.

6.2 - O Botão no React

O botão fica **dentro do chat**, abaixo da lista de quem está online. Ele dispara 50 requisições de uma vez e mostra o resumo na tela de **cada aluno**: quantas deram certo, quantas vieram do cache (pelo header `X-Cache`) e o tempo médio. Segue as convenções do código React do curso: só `const`, booleano com `is`, e o *handler* de clique **explícito**.

```tsx
// src/resources/js/components/LoadButton.tsx
import { useState } from "react"
import axios from "axios"

type Result = { ms: number, isHit: boolean } | null

type Summary = {
    ok: number
    errors: number
    hits: number
    averageMs: number
}

const TOTAL_REQUESTS = 50

// Uma requisição ao ranking do chat: devolve o tempo (ms) e se veio do cache (header X-Cache), ou null se falhou
async function measure(): Promise<Result> {
    const start = performance.now()

    try {
        const response = await axios.get("/api/relatorio")

        return { ms: performance.now() - start, isHit: response.headers["x-cache"] === "HIT" }
    } catch {
        return null
    }
}

export function LoadButton() {
    const [isLoading, setIsLoading] = useState(false)
    const [summary, setSummary] = useState<Summary | null>(null)

    // Clique: dispara TOTAL_REQUESTS requisições de uma vez e resume o resultado na tela
    async function aoDispararRequisicoes() {
        setIsLoading(true)

        const results = await Promise.all(Array.from({ length: TOTAL_REQUESTS }, () => measure()))
        const done = results.filter((result): result is NonNullable<Result> => result !== null)
        const total = done.reduce((sum, result) => sum + result.ms, 0)
        const average = done.length > 0 ? total / done.length : 0

        setSummary({
            ok: done.length,
            errors: TOTAL_REQUESTS - done.length,
            hits: done.filter(result => result.isHit).length,
            averageMs: Math.round(average)
        })
        setIsLoading(false)
    }

    return (
        <div className="card mt-3">
            <div className="card-header"><strong>Carga na API</strong></div>

            <div className="card-body d-flex flex-column gap-2">
                <button className="btn btn-warning" type="button" disabled={isLoading} onClick={aoDispararRequisicoes}>
                    {isLoading ? "Disparando..." : `Disparar ${TOTAL_REQUESTS} requisições`}
                </button>

                {summary && (
                    <small className="text-muted">
                        {summary.ok} ok · {summary.errors} erros · {summary.hits} do cache · média de {summary.averageMs} ms
                    </small>
                )}
            </div>
        </div>
    )
}
```

O navegador limita as conexões simultâneas ao mesmo servidor (6 em HTTP/1.1), então as 50 requisições são **enfileiradas pelo próprio navegador**: o efeito de uma sala inteira disparando ao mesmo tempo vem da **soma** dos alunos, não de um aluno só.

6.3 - Cuidados Com a Rede da Sala

A demonstração depende da rede, e três coisas costumam dar errado:

- **Isolamento de clientes (*client isolation*):** muitos Wi-Fi bloqueiam a comunicação entre aparelhos, e os alunos não alcançam o notebook do professor. **Teste com o celular antes da aula**;
- **HTTP, não HTTPS:** o certificado do `mkcert` só é confiável no notebook do professor. Nos aparelhos dos alunos o navegador mostra aviso. Serve-se em HTTP na porta da sala;
- **Firewall:** libere **só** a porta do Nginx (e a do Grafana, se for abri-lo para a sala). O Grafana do projetor tem login de administrador e não deve ficar aberto aos alunos.

7 - Juntando Tudo

7.1 - O Quadro Geral

```text
 Navegador (sala toda)      edge-network                 data-network
 ┌──────────────────┐   ┌─────────────────┐   ┌─────────────────────────────────┐
 │ React            │──►│ nginx           │   │                    ┌─ redis     │
 │ botão "disparar" │   │   └──► nodeweb ─┼───┼─► (ponte) ─────────┼─ postgres  │
 └──────────────────┘   │        :3000    │   │       │            └─ elastic   │
                        │ grafana ◄───────┼───┼───────┼─ prometheus             │
                        └─────────────────┘   │       └─ rabbitmq ─► worker     │
                                              └─────────────────────────────────┘
```

7.2 - Resumo da Aula

- uma **arquitetura** é o desenho dos caminhos de uma requisição e a decisão de **o que fica onde**; o que o navegador precisa esperar fica no caminho **síncrono**, o resto vai para a fila e o **worker**;
- cada container tem **uma responsabilidade**: Nginx na porta de entrada, `nodeweb` na API, worker no pesado, websocket nas conexões, bancos nos dados;
- a **segmentação de rede** segue o menor privilégio: **dois networks** (`edge-network` e `data-network`), cada container só onde precisa, e o `nodeweb` nas duas como **ponte**; o Nginx não enxerga o banco;
- o **alias** é resolvido **por network**, e o `depends_on` **não isola** nada: só ordena a subida;
- **network não é porta publicada**: o `ports:` expõe a porta na máquina independente do network; para o banco ficar inacessível de fora, remove-se o `ports:`;
- o **Redis** é um banco chave-valor **em memória**; o padrão **cache-aside** consulta o cache primeiro (*hit*) e, no *miss*, vai ao Postgres, grava no Redis com **TTL** e responde;
- o cache guarda **cópias**: o **TTL** limita quanto tempo o dado pode envelhecer e a **invalidação** (`DEL` ao escrever) o refaz na hora; o TTL é um **trade-off** entre frescor e carga no banco;
- o **Prometheus** coleta (*pull* no `/metrics`) e guarda séries temporais; o **Grafana** não guarda nada, só **consulta o Prometheus e desenha**;
- a latência é mostrada em **percentil (p95)** a partir de um **histograma**, porque a média esconde as requisições lentas;
- o `/metrics` é bloqueado no **Nginx** (`return 404`) e o Prometheus coleta **direto** no `nodeweb`, pela rede de dados;
- na demonstração a **sala vira o tráfego**: com o cache desligado a latência sobe e a taxa de acerto é zero; ligado, a taxa de acerto sobe e a latência cai; a decisão de arquitetura é **provada** no painel.

Questões do TA:


QUESTÃO 1

Na arquitetura do curso, uma requisição `GET /api/relatorio` feita pelo navegador percorre, nesta ordem:

A) navegador → `nodeweb` → Nginx → Postgres, e o Nginx devolve a resposta ao navegador.

B) navegador → `nodeworker` → Redis → `nodeweb`, porque todo relatório é um job.

C) navegador → `nodewebsocket` → RabbitMQ → Postgres, porque a resposta volta por um evento.

D) navegador → Nginx → `nodeweb` → Redis (se houver cache) ou Postgres, e a resposta volta pelo mesmo caminho; o worker e o websocket não participam, pois não há job nem evento nessa rota.

E) navegador → Nginx → RabbitMQ → `nodeworker`, e o navegador espera o worker terminar para receber a resposta.

Gabarito: D

Misturar as alternativas? ( x) Sim (  ) Não


QUESTÃO 2

O projeto passa a ter dois networks: `edge-network` (Nginx, `nodeweb`, `nodewebsocket`, Grafana) e `data-network` (`nodeweb`, `nodewebsocket`, worker, bancos, RabbitMQ, Redis, Prometheus e Grafana). Sobre essa segmentação, é correto afirmar que:

A) O Nginx continua enxergando o Postgres, porque todos os containers do mesmo `docker-compose.yml` compartilham a rede, independente dos networks declarados.

B) O Nginx alcança o `nodeweb` pela `edge-network`, mas não resolve o nome `postgres_host`, porque não compartilha nenhum network com o banco; o `nodeweb`, ligado nos dois, faz a ponte.

C) Basta declarar `depends_on: postgres-container` no `nodeweb` para que o Nginx fique impedido de alcançar o banco.

D) O `nodeweb` precisa ser duplicado em dois containers, um por network, porque um container só pode participar de um network.

E) O alias `postgres_host` é global: o Nginx o resolve mesmo estando em outro network, e a segmentação só vale para endereços IP.

Gabarito: B

Misturar as alternativas? ( x) Sim (  ) Não


QUESTÃO 3

Depois de criar o `data-network`, o Postgres continua com `ports: - "5432:5432"` no compose. Um aluno, no notebook dele e na mesma rede Wi-Fi, tenta conectar na porta `5432` do IP do notebook do professor. É correto afirmar que:

A) A conexão é recusada, porque o Postgres está num network interno e nenhum aparelho de fora o alcança.

B) A conexão só funcionaria se o aluno também estivesse dentro do `data-network`.

C) O `ports:` só tem efeito para containers que estão na `edge-network`; no `data-network` ele é ignorado.

D) A conexão é recusada, porque o aluno não consegue resolver o nome `postgres_host`.

E) A conexão funciona, porque `ports:` publica a porta na máquina (host) independente do network; para o banco ficar inacessível de fora é preciso remover o `ports:`, e o acesso entre containers continua pelo network.

Gabarito: E

Misturar as alternativas? ( x) Sim (  ) Não


QUESTÃO 4

No padrão cache-aside usado em `ReportController`, o fluxo correto de uma requisição é:

A) O Postgres atualiza o Redis automaticamente a cada consulta, e a aplicação lê sempre do Redis, sem nunca falar com o banco.

B) Em caso de *hit*, a aplicação ainda consulta o Postgres para validar o valor do cache antes de responder.

C) A aplicação consulta o Redis; em *hit* responde direto dele sem tocar no Postgres; em *miss* consulta o Postgres, grava o resultado no Redis com TTL e responde.

D) Com o cache, o TTL deixa de ser necessário, porque o Redis sempre sabe quando o dado mudou no Postgres.

E) Em *miss* a aplicação responde erro 404, e o cliente tenta de novo depois que outra requisição popular o cache.

Gabarito: C

Misturar as alternativas? ( x) Sim (  ) Não


QUESTÃO 5

Sobre TTL e invalidação do cache, é correto afirmar que:

A) O TTL limita por quanto tempo um dado pode ficar velho; para o cache refletir uma mudança **antes** de expirar, é preciso invalidar (apagar a chave) quando o dado é escrito, o que pode ser feito no controller ou por um job depois da gravação.

B) Quanto maior o TTL, mais atualizado fica o dado, porque o Redis o renova com mais calma.

C) Invalidar o cache significa reiniciar o container do Redis.

D) O TTL é o tempo máximo que o Redis leva para responder; se passar disso, a requisição falha.

E) Um TTL de zero segundo é a configuração mais eficiente, pois o cache nunca guarda dado velho e ainda assim evita consultas ao banco.

Gabarito: A

Misturar as alternativas? ( x) Sim (  ) Não


QUESTÃO 6

Sobre o papel do Prometheus e do Grafana na stack do curso, é correto afirmar que:

A) O Grafana coleta as métricas do `nodeweb` e as guarda; o Prometheus apenas desenha os gráficos.

B) O `nodeweb` envia as métricas ao Prometheus a cada requisição (modelo *push*), e o Grafana lê direto do `nodeweb`.

C) Os dois guardam métricas, e a diferença é que o Prometheus é visual e o Grafana é de linha de comando.

D) O Prometheus faz `GET /metrics` no `nodeweb` a cada intervalo e guarda a série temporal; o Grafana não guarda métrica nenhuma, apenas consulta o Prometheus como fonte de dados e desenha os gráficos.

E) O Prometheus só funciona se o `/metrics` passar pelo Nginx, e o Grafana só funciona se estiver na mesma rede do Redis.

Gabarito: D

Misturar as alternativas? ( x) Sim (  ) Não


QUESTÃO 7

O Nginx repassa ao `nodeweb` tudo que não é arquivo estático. Sobre o endpoint `/metrics`, é correto afirmar que:

A) O Prometheus precisa passar pelo Nginx para coletar, e por isso o `/metrics` deve ficar público.

B) Sem proteção ele ficaria público pelo Nginx; bloqueia-se no Nginx (`location = /metrics { return 404; }`) e o Prometheus continua coletando, porque acessa o `nodeweb` direto pela `data-network`, sem passar pelo Nginx.

C) O `/metrics` só existe dentro do Grafana, por isso não há o que proteger no Nginx.

D) Basta renomear a rota para `/m`; assim ninguém descobre e não é preciso bloquear nada.

E) Bloquear o `/metrics` no Nginx impede o Prometheus de coletar, e por isso o endpoint deve ficar aberto.

Gabarito: B

Misturar as alternativas? ( x) Sim (  ) Não


QUESTÃO 8

O painel mostra a latência como **p95**, calculada a partir de um histograma, e não apenas como média. A razão é que:

A) A média esconde as requisições lentas; o histograma guarda a contagem por faixa de tempo (*buckets*) e o `histogram_quantile(0.95, ...)` mostra o tempo abaixo do qual ficam 95% das requisições, revelando a cauda lenta que parte dos usuários sentiu.

B) O p95 é sempre menor do que a média, e por isso o gráfico fica mais bonito no projetor.

C) O Prometheus não consegue calcular médias, então o p95 é a única consulta possível.

D) O p95 é o tempo da 95ª requisição disparada, o que permite acompanhar a sala aluno por aluno.

E) O p95 descarta as 5% requisições mais rápidas, para que só as lentas apareçam no painel.

Gabarito: A

Misturar as alternativas? ( x) Sim (  ) Não


QUESTÃO 9

Na demonstração, a rota `/api/relatorio` roda primeiro com o cache desligado e depois ligado, com a sala toda disparando requisições. Sobre o que o painel mostra, é correto afirmar que:

A) A taxa de acerto do cache sobe mesmo com o cache desligado, porque o Redis guarda as respostas automaticamente.

B) A latência cai porque o Grafana passa a guardar as respostas em cache quando o professor liga o interruptor.

C) Com o cache desligado toda requisição conta como *miss* (acerto em zero) e vai ao Postgres, e a latência p95 sobe; ligado, só a primeira requisição de cada janela de TTL vai ao banco e as demais são *hit*, a taxa de acerto sobe e a latência cai, sem mudar o código do front.

D) Com o TTL de 30 segundos, todas as requisições continuam sendo *miss*, e a única diferença é a carga no Redis.

E) O cache só ajuda se cada aluno pedir um relatório diferente, porque a chave é montada com o RA de quem pede.

Gabarito: C

Misturar as alternativas? ( x) Sim (  ) Não
