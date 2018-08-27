import { IlpMacaroon } from './macaroon'
import { randomBytes } from 'crypto'

const rootKey = randomBytes(32)
const macaroon = new IlpMacaroon({
  identifier: Buffer.from('some key id'),
  location: 'http://localhost:3000',
  rootKey
})
macaroon.setAmount('10')
macaroon.setExpiry(new Date(Date.now() + 30000))
macaroon.setAddress('test.connector.account')

console.log(macaroon)
console.log(macaroon.exportBinary().toString('hex'))
console.log(macaroon.verify(rootKey))