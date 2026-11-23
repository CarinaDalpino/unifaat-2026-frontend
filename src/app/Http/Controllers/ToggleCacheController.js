import redis from '../../../database/connections/redis.js'

/**
 * POST /api/admin/cache  { "ativo": true | false }
 * Liga ou desliga o cache do relatório gravando a flag cache:ativo no próprio Redis (sem TTL).
 */
export default async function ToggleCacheController(request, response) {
    try {
        const isActive = request.body?.ativo === true

        await redis.set('cache:ativo', isActive ? '1' : '0', 60 * 60 * 24)

        return response.json({ ativo: isActive })
    } catch (error) {
        console.error(error)

        return response.status(500).json({
            error: 'Internal server error'
        })
    }
}
