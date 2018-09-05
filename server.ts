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

  constructor({masterSecret = randomBytes(32), plugin = createPlugin(), location = 'http://localhost:3000'}) {
    this.log = createLogger('ilp-spsp-token-server')
    this.streamServerSecret = deriveKey(masterSecret, Buffer.from('ilp stream server secret'))
    this.tokenSecret = deriveKey(masterSecret, Buffer.from('ilp token secret'))
    this.location = location
    this.streamServer = new StreamServer({
      plugin,
      serverSecret: this.streamServerSecret
    })
    this.streamServer.on('connection', (conn: Connection) => this.handleConnection(conn))
    this.app = new Koa()
    const router = new Router()
    router.get('/', this.middleware())
    this.app.use(router.routes())
    this.app.use(router.allowedMethods())
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
        console.log(slice)
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
      // tokens[tokenId] = token

      const { destinationAccount, sharedSecret } = this.streamServer.generateAddressAndSecret(tokenId)
      this.log.info(`Generated ILP address ${destinationAccount} for token with id: ${token.keyId.toString('hex')}`)
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

  private async handleConnection(conn: Connection): Promise<void> {
    if (!conn.connectionTag) {
      return conn.end()
    }
    this.log.debug(`Got connection for token: ${conn.connectionTag}`)

    // Check that we have a token that corresponds to this connection
    // const token = tokens[conn.connectionTag]
    // if (!token) {
    //   return conn.end()
    // }

    // Only necessary because of the stream server pushing money bug
    // this should be connected and ready to go when the event is fired
    await conn.connect()

    // TODO should the server create the stream? or should the client create it and ask for a specific amount of money?
    const stream = conn.createStream()
    stream.on('outgoing_money', (amount: string) => {
      this.log.debug(`Sent ${amount} to ${conn.destinationAccount} for token: ${conn.connectionTag}`)
      // TODO adjust how much more the token can send
    })

    // TODO base the amount on the token max
    stream.setSendMax(MAX_SEND_AMOUNT)
    await stream.sendTotal(1000)
    console.log('sent money')
  }
}
