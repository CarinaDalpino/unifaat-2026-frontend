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

    // Conecta só no primeiro uso (importar o módulo não derruba o processo se o Redis estiver fora).
    // Uma conexão por processo: quem chegar depois reaproveita a mesma promessa; se falhar, tenta de novo.
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
