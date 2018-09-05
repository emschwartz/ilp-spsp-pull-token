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

  // The server generates the original token
  const token = server.generateToken()

  // The server, account-holder, and 3rd parties can all add caveats
  token.addCaveat(new AmountCaveat(1000, new Date(), 60000))

  // The account-holder would provide the token to a 3rd party service that is requesting money
  console.log(`Generated token: ${token.toBytes().toString('base64')}`)

  // The service requesting payment sends the token as the
  // Authorization token for the SPSP endpoint
  // and the server responds with a standard SPSP response
  const spspResponse = await fetch(token.location, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token.toBytes().toString('base64')}`}
  }).then(async (res: FetchResponse) => {
    if (res.ok) {
      return res.json()
    } else {
      throw new Error(`Got ${res.status} error: ${await res.text()}`)
    }
  })

  // The service requesting money opens a STREAM connection
  // and the server pushes money to it
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