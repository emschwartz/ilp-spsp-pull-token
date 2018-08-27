import { createServer, Connection } from 'ilp-protocol-stream'
const createPlugin = require('ilp-plugin')
import Koa = require('koa')
import Router = require('koa-router')
import BodyParser = require('koa-bodyparser')
import { IlpMacaroon } from './macaroon'
import { randomBytes, createHmac } from 'crypto'
import fetch from 'node-fetch'

// TODO replace this with a more sensible default. This is VERY DANGEROUS
const MAX_SEND_AMOUNT = 9999999999

function deriveKey(masterKey: Buffer, keyId: Buffer): Buffer {
  const hmac = createHmac('sha256', masterKey)
  hmac.update(keyId)
  return hmac.digest()
}

async function run(masterKey = randomBytes(32), port = 3000) {
  const streamServerSecret = deriveKey(masterKey, Buffer.from('ilp stream server secret'))
  const macaroonSecret = deriveKey(masterKey, Buffer.from('ilp macaroon secret'))

  function createMacaroon(opts: { amount: string, address?: string, expiry?: Date, location?: string }): IlpMacaroon {
    const identifier = randomBytes(16)
    const rootKey = deriveKey(macaroonSecret, identifier)
    const macaroon = new IlpMacaroon({
      identifier,
      location: opts.location || '',
      rootKey
    })
    if (opts.address) {
      macaroon.setAddress(opts.address)
    }
    if (opts.amount) {
      macaroon.setAmount(opts.amount)
    }
    if (opts.expiry) {
      macaroon.setExpiry(opts.expiry)
    }

    return macaroon
  }
  const testMacaroon = createMacaroon({
    amount: '100',
    address: 'private.moneyd.',
    expiry: new Date(Date.now() + 30000),
    location: 'http://localhost:3000'
  })

  // TODO track how much has been spent from each macaroon
  // TODO make sure that multiple concurrent requests can't take too much money
  const macaroons: { [key: string]: IlpMacaroon } = {}

  console.log('Connecting to ILP plugin...')
  const streamServer = await createServer({
    plugin: createPlugin(),
    serverSecret: streamServerSecret
  })
  streamServer.on('connection', (conn: Connection) => {
    if (!conn.connectionTag) {
      return conn.end()
    }

    // Check that we have a macaroon that corresponds to this connection
    const macaroon = macaroons[conn.connectionTag]
    if (!macaroon) {
      return conn.end()
    }

    // Check if the macaroon is valid
    if (macaroon.isExpired()) {
      return conn.end()
    }
    // TODO make the Connection expose the destinationAccount
    if (macaroon.address && (!conn['destinationAccount'] || !conn['destinationAccount']!.startsWith(macaroon.address))) {
      return conn.end()
    }

    // Send the amount of money determined by the
    const stream = conn.createStream()
    // TODO don't send more than there is left for the macaroon
    stream.setSendMax(macaroon.amount || MAX_SEND_AMOUNT)
  })

  const app = new Koa()
  const router = new Router()
  router.post('/', async (ctx: Koa.Context) => {
    let macaroon
    try {
      const body = ctx.request.body! as any
      const macaroonBinary = Buffer.from(body.macaroon, 'hex')
      macaroon = IlpMacaroon.fromBinary(macaroonBinary)
      const rootKey = deriveKey(macaroonSecret, macaroon.identifier)
      macaroon.verify(rootKey)
    } catch (err) {
      return ctx.throw(400, err.message)
    }

    const macaroonId = macaroon.identifier.toString('hex')
    macaroons[macaroonId] = macaroon

    const { destinationAccount, sharedSecret } = streamServer.generateAddressAndSecret(macaroonId)
    ctx.body = {
      destinationAccount,
      sharedSecret: sharedSecret.toString('hex')
    }
  })
  app.use(BodyParser({}))
  app.use(router.routes())
  app.use(router.allowedMethods())
  app.listen(port)
  console.log(`Macaroon server listening on port: ${port}`)

  const response = await fetch('http://localhost:3000', {
    method: 'POST',
    body: JSON.stringify({
      macaroon: testMacaroon.exportBinary().toString('hex')
    }),
    headers: { 'Content-Type': 'application/json' }
  })
  console.log('response was:', await response.json())
}

run().catch(err => console.log(err))
