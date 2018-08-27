import { randomBytes } from 'crypto'
const { newMacaroon, importMacaroon } = require('macaroon')
import BigNumber from 'bignumber.js'

export class IlpMacaroon {
  private macaroon: any
  private _expiry?: number
  private _amount?: BigNumber
  private _address?: string

  constructor(opts: { macaroon: any } | { identifier: Buffer, location: string, rootKey?: Buffer }) {
    if (opts.hasOwnProperty('macaroon')) {
      this.macaroon = opts['macaroon']
    } else {
      this.macaroon = newMacaroon(opts)
    }

    let expiry
    let amount
    let address
    for (let caveat of this.macaroon.caveats) {
      let [type, value] = Buffer.from(caveat.identifier).toString().split(' ')
      switch (type) {
        case 'expiry':
          let parsedExpiry = Date.parse(value)
          if (!expiry || parsedExpiry < expiry) {
            expiry = parsedExpiry
          } else {
            throw new Error(`Invalid macaroon: caveat attempts to extend expiry`)
          }
          break
        case 'amount':
          const parsedAmount = new BigNumber(value)
          if (!amount || parsedAmount.lt(amount)) {
            amount = parsedAmount
          } else {
            throw new Error(`Invalid macaroon: caveat attempts to increase amount`)
          }
          break
        case 'address':
          if (!address || value.indexOf(address) !== 0) {
            address = value
          } else {
            throw new Error(`Invalid macaroon: caveat attempts to change address prefix`)
          }
          break
        default:
          throw new Error(`Unexpected caveat: ${caveat}`)
      }
    }

    this._expiry = expiry
    this._amount = amount
    this._address = address
  }

  static fromBinary(binary: Buffer) {
    const macaroon = importMacaroon(binary)
    if (!macaroon.identifier) {
      throw new Error('Invalid macaroon: must have identifier')
    }
    return new IlpMacaroon({ macaroon })
  }

  get identifier(): Buffer {
    return Buffer.from(this.macaroon.identifier)
  }

  get amount(): string | undefined {
    return this._amount && this._amount.toString()
  }

  get address(): string | undefined {
    return this._address
  }

  get expiry(): Date | undefined {
    return (this._expiry === undefined ? undefined : new Date(this._expiry))
  }

  isExpired(): boolean {
    return !!this._expiry && this._expiry > Date.now()
  }

  setExpiry(expiry: Date): void {
    if (this._expiry && this._expiry <= expiry.valueOf()) {
      throw new Error('Cannot extend macaroon expiry')
    }
    this._expiry = expiry.valueOf()
    this.macaroon.addFirstPartyCaveat(`expiry ${expiry.toISOString()}`)
  }

  setAmount(amount: string): void {
    if (this._amount && this._amount.lte(amount)) {
      throw new Error('Cannot increase macaroon amount')
    }
    this._amount = new BigNumber(amount)
    this.macaroon.addFirstPartyCaveat(`amount ${amount}`)
  }

  setAddress(address: string): void {
    if (this._address && address.indexOf(this._address) !== 0) {
      throw new Error('Cannot make change the address prefix')
    }
    this._address = address
    this.macaroon.addFirstPartyCaveat(`address ${address}`)
  }

  exportBinary(): Buffer {
    return Buffer.from(this.macaroon.exportBinary())
  }

  verify(rootKey: Buffer): void {
    this.macaroon.verify(rootKey, () => { })

    if (this._expiry && this._expiry < Date.now()) {
      throw new Error('Macaroon is expired')
    }
  }
}