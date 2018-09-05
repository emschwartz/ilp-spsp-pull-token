import { createServer, Connection, Server as StreamServer } from 'ilp-protocol-stream'
const createPlugin = require('ilp-plugin')
import Koa = require('koa')
import Router = require('koa-router')
import { SpspToken, AmountCaveat, AddressCaveat } from './spsp-token'
import { TokenManager } from './token-manager'
import { randomBytes, createHmac } from 'crypto'
import fetch from 'node-fetch'
const createLogger = require('ilp-logger')
import * as assert from 'assert'

// TODO replace this with a more sensible default. This is VERY DANGEROUS
const MAX_SEND_AMOUNT = 9999999999

function deriveKey(masterKey: Buffer, keyId: Buffer): Buffer {
  const hmac = createHmac('sha256', masterKey)
  hmac.update(keyId)
  return hmac.digest()
}

export class SpspTokenServer {
  private streamServerSecret: Buffer
  private tokenSecret: Buffer
  private plugin: Plugin
  private streamServer: StreamServer
  private app: Koa
  private location: string
  private log: any
  private tokenManager: TokenManager

  constructor({masterSecret = randomBytes(32), plugin = createPlugin(), location = 'http://localhost:3000'}) {
    this.log = createLogger('ilp-spsp-pull-token:server')
    this.streamServerSecret = deriveKey(masterSecret, Buffer.from('ilp stream server secret'))
    this.tokenSecret = deriveKey(masterSecret, Buffer.from('ilp token secret'))
    this.location = location
    this.streamServer = new StreamServer({
      plugin,
      serverSecret: this.streamServerSecret
    })
    this.streamServer.on('connection', (conn: Connection) => this.tokenManager.handleConnection(conn))
    this.app = new Koa()
    const router = new Router()
    router.get('/', this.middleware())
    this.app.use(router.routes())
    this.app.use(router.allowedMethods())

    this.tokenManager = new TokenManager(this.tokenSecret)
  }

  async connect() {
    await this.streamServer.listen()
  }

  async listen(port = 3000) {
    await this.connect()
    this.app.listen(port)
  }

  middleware(): Koa.Middleware {
    return async (ctx: Koa.Context) => {
      let token
      try {
        const authHeader = ctx.request.headers.authorization
        const slice = authHeader.split(' ')
        assert.equal(slice[0], 'Bearer', 'Must include SPSP Token as the Bearer auth token')
        const tokenBinary = Buffer.from(slice[1], 'base64')
        token = SpspToken.fromBytes(tokenBinary)
        if (!token.isValid(this.tokenSecret)) {
          return ctx.throw(401, 'Invalid token')
        }
      } catch (err) {
        return ctx.throw(400, err.message)
      }

      const tokenId = token.keyId.toString('hex')
      this.tokenManager.addToken(token)

      const { destinationAccount, sharedSecret } = this.streamServer.generateAddressAndSecret(tokenId)
      this.log.info(`Generated ILP address ${destinationAccount} for token with id: ${tokenId}`)
      ctx.body = {
        destination_account: destinationAccount,
        shared_secret: sharedSecret.toString('base64')
      }
    }
  }

  generateToken(): SpspToken {
    return new SpspToken({
      location: this.location,
      rootKey: this.tokenSecret
    })
  }
}
