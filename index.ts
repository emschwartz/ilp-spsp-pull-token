import { SpspTokenServer } from './server'
import { AmountCaveat, AddressCaveat } from './spsp-token'
import {default as fetch, Response as FetchResponse} from 'node-fetch'
import { createConnection, Connection, DataAndMoneyStream } from 'ilp-protocol-stream';
const createPlugin = require('ilp-plugin')

async function run () {
  const server = new SpspTokenServer({
    location: 'http://localhost:3000'
  })
  await server.listen(3000)

  const token = server.generateToken()
  token.addCaveat(new AmountCaveat(1000, new Date(), 60000))

  // The token is sent as a base64-encoded field in a JSON body
  // TODO should we send the token as binary and skip the JSON?
  const requestBody = JSON.stringify({
    token: token.toBytes().toString('base64')
  })

  const spspResponse = await fetch('http://localhost:3000', {
    method: 'POST',
    body: requestBody,
    headers: { 'Content-Type': 'application/json' }
  }).then(async (res: FetchResponse) => {
    if (res.ok) {
      return res.json()
    } else {
      throw new Error(`Got ${res.status} error: ${await res.text()}`)
    }
  })

  const clientConn = await createConnection({
    plugin: createPlugin(),
    destinationAccount: spspResponse.destination_account,
    sharedSecret: Buffer.from(spspResponse.shared_secret, 'base64')
  })
  clientConn.on('stream', (stream: DataAndMoneyStream) => {
    stream.setReceiveMax(99999999999)
    stream.on('money', (amount: string) => {
      console.log(`Got ${amount} pushed to us`)
    })
  })
}

run().catch((err) => console.log(err))