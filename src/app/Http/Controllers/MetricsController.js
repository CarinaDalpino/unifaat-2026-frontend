import { register } from '../../../utils/metrics.js'

/**
 * GET /metrics: o texto que o Prometheus busca a cada 5 s. NÃO é público: o nginx responde 404 a quem vem de fora
 * (location = /metrics) e o Prometheus coleta direto no nodeweb, pela data-network.
 */
export default async function MetricsController(request, response) {
    response.set('Content-Type', register.contentType)

    return response.end(await register.metrics())
}
