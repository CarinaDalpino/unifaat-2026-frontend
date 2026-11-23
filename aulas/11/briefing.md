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
    networks:
      data-network:                       # só a rede de dados
        aliases:
          - postgres_host

  redis-container:
    image: redis:7.4-alpine
    restart: unless-stopped
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

Segmentar a rede protege o tráfego **entre containers**. Já o `ports:` do compose **publica a porta na máquina** (o *host*), e isso vale **independente do network**. Hoje o `docker-compose.yml` publica o `5432` do Postgres e as portas `5672` e `15672` do RabbitMQ: qualquer um que alcance o seu notebook pela rede da sala consegue conectar nelas.

Para o banco ficar mesmo **inacessível de fora**, não basta o network: é preciso **remover o `ports:`** dele. O acesso interno continua funcionando pelo network (`postgres_host:5432`); só o acesso externo some. É o mesmo raciocínio que já usamos no Elasticsearch, que **não tem `ports:`** de propósito.

```yaml
  postgres-container:
    image: postgres:18
    # sem "ports": só a data-network alcança o banco
    networks:
      data-network:
        aliases:
          - postgres_host
```

4 - Cache com Redis

4.1 - O Problema: a Mesma Pergunta, o Mesmo Custo

Imagine uma tela de relatório que mostra **quantas tarefas cada usuário tem e quantas concluiu**. Para montar isso, o Postgres precisa **varrer a tabela `tasks` inteira** e agrupar. Se a tabela tem meio milhão de linhas, é uma consulta cara. O problema não é fazê-la **uma vez**: é que **a resposta é a mesma** para todo mundo, e a consulta cara é repetida a cada requisição.

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

4.5 - O Redis no Projeto

O container entra no `data-network` (seção 3.3). A conexão fica junto das outras, em `database/connections`:

```js
// src/database/connections/redis.js
import { createClient } from 'redis';
import { configDotenv } from 'dotenv';

configDotenv({
    quiet: true
});

const host = process.env.REDIS_HOST || 'localhost';
const port = process.env.REDIS_PORT || '6379';

const client = createClient({
    url: `redis://${host}:${port}`
});

client.on('error', (error) => {
    console.error('Redis:', error.message);
});

await client.connect();

export default client;
```

No `docker-compose.yml`, o `nodeweb` ganha `REDIS_HOST: redis_host` e `REDIS_PORT: 6379` no `environment`, e entra no `depends_on` do Redis.

4.6 - A Rota Pesada com Cache-Aside

A rota `GET /api/relatorio` faz a agregação, com o interruptor `cache:ativo` (uma chave no próprio Redis) que o professor liga e desliga **sem reiniciar nada**. Sem `else`: cada desvio sai com `return`.

```js
// src/app/Http/Controllers/ReportController.js
import { QueryTypes } from 'sequelize';
import sequelize from '../../../database/connections/sequelize.js';
import redis from '../../../database/connections/redis.js';
import { cacheRequests } from '../../../utils/metrics.js';

const CACHE_KEY = 'report:tasks-by-user';
const CACHE_TTL_SECONDS = 30;

export default async function ReportController(request, response) {
    const isCacheOn = (await redis.get('cache:ativo')) === '1';

    if (isCacheOn) {
        const cached = await redis.get(CACHE_KEY);

        if (cached) {
            cacheRequests.inc({ result: 'hit' });
            return response.json(JSON.parse(cached));
        }
    }

    cacheRequests.inc({ result: 'miss' });

    // a consulta cara: varre a tabela inteira e agrupa
    const report = await sequelize.query(
        `SELECT id_user,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE is_done) AS concluidas
           FROM tasks
          GROUP BY id_user
          ORDER BY total DESC
          LIMIT 10`,
        { type: QueryTypes.SELECT }
    );

    if (isCacheOn) {
        await redis.set(CACHE_KEY, JSON.stringify(report), { EX: CACHE_TTL_SECONDS });
    }

    return response.json(report);
}
```

Com o cache **desligado**, toda requisição conta como *miss* e vai ao Postgres. Com ele **ligado**, só a primeira de cada janela de 30 segundos vai ao banco.

Para a consulta ser realmente pesada, a tabela precisa de volume. Um seed grande (ajuste o intervalo de `id_user` para ids que existem na tabela `users`):

```sql
INSERT INTO tasks (name, is_done, id_user, created_at, updated_at)
SELECT 'Tarefa ' || n, (n % 3 = 0), 1 + (n % 20), NOW(), NOW()
  FROM generate_series(1, 500000) AS n;
```

E o interruptor, protegido por um segredo da variável de ambiente (`ADMIN_TOKEN`) para os alunos não o desligarem:

```js
// src/app/Http/Middlewares/AdminMiddleware.js
export default function AdminMiddleware(request, response, next) {
    if (request.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) {
        return response.status(401).json({ error: 'Unauthorized' });
    }

    return next();
}
```

```js
// src/app/Http/Controllers/ToggleCacheController.js
import redis from '../../../database/connections/redis.js';

export default async function ToggleCacheController(request, response) {
    const isActive = request.body.ativo === true;

    await redis.set('cache:ativo', isActive ? '1' : '0');

    return response.json({ ativo: isActive });
}
```

O professor liga e desliga do terminal, na frente da sala:

```bash
# liga o cache
curl -X POST http://localhost:8080/api/admin/cache -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"ativo": true}'

# desliga o cache
curl -X POST http://localhost:8080/api/admin/cache -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"ativo": false}'
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

A biblioteca `prom-client` cria as métricas e formata o texto que o Prometheus lê. Duas métricas próprias: um **histograma** da duração das requisições e um **contador** de acertos e erros do cache.

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

Um middleware mede cada requisição, e a rota `/metrics` entrega o texto:

```js
// src/app/Http/Middlewares/MetricsMiddleware.js
import { httpDuration } from '../../../utils/metrics.js';

export default function MetricsMiddleware(request, response, next) {
    const stopTimer = httpDuration.startTimer();

    response.on('finish', () => {
        const route = request.route?.path || 'outras';

        stopTimer({
            method: request.method,
            route: route,
            status: response.statusCode
        });
    });

    return next();
}
```

```js
// src/routes/router.js (acrescentar)
import { register } from '../utils/metrics.js';
import MetricsMiddleware from '../app/Http/Middlewares/MetricsMiddleware.js';

router.use(MetricsMiddleware);

router.get('/metrics', async (request, response) => {
    response.set('Content-Type', register.contentType);
    return response.end(await register.metrics());
});
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

Os dois containers entram no compose; as configurações ficam em arquivos montados como volume, para o painel subir **pronto**, sem clicar em nada:

```yaml
# docker/prometheus/prometheus.yml
global:
  scrape_interval: 5s              # coleta a cada 5 segundos

scrape_configs:
  - job_name: nodeweb
    static_configs:
      - targets: ["nodeweb_host:3000"]   # nome do alias na data-network
```

```yaml
# docker-compose.yml (acrescentar)
  prometheus-container:
    image: prom/prometheus:v3.5.0
    restart: unless-stopped
    volumes:
      - ./docker/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
    networks:
      data-network:
        aliases:
          - prometheus_host

  grafana-container:
    image: grafana/grafana:12.1.0
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    ports:
      - "${GRAFANA_PORT}:3000"
    volumes:
      - ./docker/grafana/provisioning:/etc/grafana/provisioning
    networks:
      - edge-network
      - data-network
```

```yaml
# docker/grafana/provisioning/datasources/prometheus.yml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus_host:9090
    isDefault: true
```

O Grafana está nos **dois** networks: na borda, porque o professor o abre no navegador; nos dados, porque ele precisa alcançar o Prometheus.

5.6 - As Consultas do Painel

O painel tem três gráficos, cada um com uma consulta em PromQL:

```text
# requisições por segundo (média do último minuto)
sum(rate(http_request_duration_seconds_count[1m]))

# latência p95: o tempo abaixo do qual ficam 95% das requisições
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))

# taxa de acerto do cache (0 a 1)
sum(rate(cache_requests_total{result="hit"}[1m])) / sum(rate(cache_requests_total[1m]))
```

A latência aparece como **p95** e não como média porque a média **esconde as requisições lentas**: se 95 requisições levam 10 ms e 5 levam 2 segundos, a média parece aceitável, mas 5% dos usuários sentiram uma lentidão enorme. O histograma guarda a **contagem por faixa de tempo** (*buckets*), e é isso que permite calcular o percentil.

6 - A Demonstração: a Sala Vira o Tráfego

6.1 - O Roteiro

Todos os alunos abrem a aplicação pelo IP do notebook do professor na rede da sala. O painel do Grafana fica no projetor. O roteiro tem três atos:

1. **Cache desligado:** a sala toda clica em "disparar 50 requisições". A taxa de requisições sobe, a latência p95 dispara, a taxa de acerto do cache fica em **zero**, e o Postgres é martelado a cada clique;
2. **Cache ligado:** o professor liga o interruptor (`curl` da seção 4.6). Nada mais muda: o mesmo botão, o mesmo código. A taxa de acerto sobe, a latência **despenca**, o Postgres respira;
3. **A prova de segmentação:** cada aluno tenta, do próprio notebook, conectar na porta `5432` do notebook do professor. Com o `ports:` removido (seção 3.5), a conexão é **recusada**: só o Nginx é alcançável de fora.

6.2 - O Botão no React

O front dispara 50 requisições de uma vez e mostra o resumo na tela de **cada aluno**. Segue as convenções do código React do curso: só `const`, booleano com `is`, e o *handler* de clique **explícito**.

```tsx
// src/resources/js/components/LoadButton.tsx
import { useState } from 'react';
import axios from 'axios';

type Summary = {
    ok: number;
    errors: number;
    average: number;
};

const TOTAL_REQUESTS = 50;

// devolve o tempo da requisição em ms, ou null se falhou
const measure = async (): Promise<number | null> => {
    const start = performance.now();

    try {
        await axios.get('/api/relatorio');
        return performance.now() - start;
    } catch (error) {
        return null;
    }
};

export default function LoadButton() {
    const [isLoading, setIsLoading] = useState(false);
    const [summary, setSummary] = useState<Summary | null>(null);

    const handleClick = async () => {
        setIsLoading(true);

        const results = await Promise.all(
            Array.from({ length: TOTAL_REQUESTS }, () => measure())
        );

        const times = results.filter((time): time is number => time !== null);
        const total = times.reduce((sum, time) => sum + time, 0);
        const average = times.length > 0 ? total / times.length : 0;

        setSummary({
            ok: times.length,
            errors: TOTAL_REQUESTS - times.length,
            average: Math.round(average)
        });

        setIsLoading(false);
    };

    return (
        <div>
            <button onClick={handleClick} disabled={isLoading}>
                {isLoading ? 'Disparando...' : `Disparar ${TOTAL_REQUESTS} requisições`}
            </button>

            {summary && (
                <p>{summary.ok} ok, {summary.errors} erros, média de {summary.average} ms</p>
            )}
        </div>
    );
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
