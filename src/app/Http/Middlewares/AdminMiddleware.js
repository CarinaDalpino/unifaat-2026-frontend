/**
 * Rotas do professor (ligar e desligar o cache): exige o segredo ADMIN_TOKEN, do .env, no header x-admin-token.
 * Sem ADMIN_TOKEN configurado, ninguém entra.
 */
export default function AdminMiddleware(request, response, next) {
    const token = process.env.ADMIN_TOKEN

    if (!token || request.headers['x-admin-token'] !== token) {
        return response.status(401).json({ error: 'Unauthorized' })
    }

    return next()
}
