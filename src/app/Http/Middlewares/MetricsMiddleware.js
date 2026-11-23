import { httpDuration } from '../../../utils/metrics.js'

/**
 * Mede a duração de cada requisição e guarda no histograma (method, route, status).
 * O label route é o padrão da rota (/api/relatorio), nunca a URL com ids: cada valor novo de label
 * vira uma série nova no Prometheus.
 */
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
