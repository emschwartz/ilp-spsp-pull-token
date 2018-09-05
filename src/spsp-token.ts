import { Reader, Writer } from 'oer-utils'
import { createHmac, randomBytes } from 'crypto'
import BigNumber from 'bignumber.js'
import * as assert from 'assert'

function hmac (key: Buffer, message: string | Buffer): Buffer {
  const h = createHmac('sha256', key)
  h.update(message)
  return h.digest()
}

export interface Serializable {
  writeTo (writer: Writer): void;
}

export class AmountCaveat implements Serializable {
  static typeId = 1
  amount: BigNumber
  startTime: Date
  duration: number
  repetitions: number

  constructor (amount: BigNumber.Value, startTime: Date | number, duration: number, repetitions = 1) {
    this.amount = new BigNumber(amount)
    this.startTime = new Date(startTime)
    this.duration = duration
    this.repetitions = repetitions
  }

  static readFrom (reader: Reader, includesTypeByte = true): AmountCaveat {
    if (includesTypeByte) {
      const typeId = reader.readUInt8()
      assert.equal(typeId, ''+AmountCaveat.typeId, `Expected caveat id: ${AmountCaveat.typeId}, got: ${typeId}`)
    }
    const contents = Reader.from(reader.readVarOctetString())
    const amount = contents.readVarUIntBigNum()
    // TODO should we accept numbers larger than uint 32?
    const startTime = new Date(parseInt(contents.readVarUInt()))
    const duration = parseInt(contents.readVarUInt())
    const repetitions = parseInt(contents.readVarUInt())

    return new AmountCaveat(
      amount,
      startTime,
      duration,
      repetitions
    )
  }

  writeTo (writer: Writer): void {
    writer.writeUInt8(AmountCaveat.typeId)
    const contents = new Writer()
    contents.writeVarUInt(this.amount)
    contents.writeVarUInt(this.startTime.valueOf())
    contents.writeVarUInt(this.duration)
    contents.writeVarUInt(this.repetitions)
    writer.writeVarOctetString(contents.getBuffer())
  }
}

export class AddressCaveat implements Serializable {
  static typeId = 2
  public addressPrefixes: string[]

  constructor (addressPrefixes: string[]) {
    this.addressPrefixes = addressPrefixes
  }

  static readFrom (reader: Reader, includesTypeByte = true): AddressCaveat {
    if (includesTypeByte) {
      const typeId = reader.readUInt8()
      assert.equal(typeId, ''+AddressCaveat.typeId, `Expected caveat id: ${AddressCaveat.typeId}, got: ${typeId}`)
    }
    const addressPrefixes: string[] = []
    const arrayLength = parseInt(reader.readVarUInt())
    for (let i = 0; i < arrayLength; i++) {
      addressPrefixes.push(reader.readVarOctetString().toString('utf8'))
    }
    return new AddressCaveat(addressPrefixes)
  }

  writeTo (writer: Writer): void {
    writer.writeUInt8(AddressCaveat.typeId)
    const contents = new Writer()
    contents.writeVarUInt(this.addressPrefixes.length)
    for (let address of this.addressPrefixes) {
      contents.writeVarOctetString(Buffer.from(address, 'utf8'))
    }
    writer.writeVarOctetString(contents.getBuffer())
  }
}

export interface TokenFromRootKey {
  location: string,
  rootKey: Buffer,
  keyId?: Buffer,
  caveats?: Serializable[]
}

export interface TokenFromSignature {
  location: string,
  signature: Buffer,
  keyId: Buffer,
  caveats?: Serializable[]
}

function hasRootKey (opts: TokenFromRootKey | TokenFromSignature): opts is TokenFromRootKey {
  return opts.hasOwnProperty('rootKey')
}

export class SpspToken {
  static version = 1
  location: string
  keyId: Buffer
  signature: Buffer
  caveats: Serializable[]

  constructor (opts: TokenFromSignature | TokenFromRootKey) {
    this.location = opts.location
    this.keyId = opts.keyId || randomBytes(16)
    if (hasRootKey(opts)) {
      this.signature = hmac(opts.rootKey, this.keyId)
      this.caveats = []
      if (opts.caveats) {
        for (let caveat of opts.caveats) {
          this.addCaveat(caveat)
        }
      }
    } else {
      this.signature = opts.signature
      this.caveats = opts.caveats || []
    }
  }

  static fromBytes (bytes: Buffer): SpspToken {
    const reader = Reader.from(bytes)
    assert.equal(reader.readUInt8(), '' + SpspToken.version, `Unknown token version. Expected: ${SpspToken.version}, got: ${bytes[0]}`)
    const signature = reader.read(32)
    const location = reader.readVarOctetString().toString('utf8')
    const keyId = reader.readVarOctetString()
    const numCaveats = reader.readVarUIntBigNum().toNumber()
    const caveats: Serializable[] = []
    for (let i = 0; i < numCaveats; i++) {
      const type = parseInt(reader.readUInt8())
      switch (type) {
        case AmountCaveat.typeId:
          caveats.push(AmountCaveat.readFrom(reader, false))
        break
        case AddressCaveat.typeId:
          caveats.push(AddressCaveat.readFrom(reader, false))
        break
        default:
          throw new Error(`Unknown caveat: ${type}`)
      }
    }
    return new SpspToken({
      location,
      signature,
      keyId,
      caveats
    })
  }

  toBytes(): Buffer {
    const writer = new Writer()
    writer.writeUInt8(SpspToken.version)
    writer.write(this.signature)
    writer.writeVarOctetString(Buffer.from(this.location, 'utf8'))
    writer.writeVarOctetString(this.keyId)

    writer.writeVarUInt(this.caveats.length)
    for (let caveat of this.caveats) {
      caveat.writeTo(writer)
    }

    return writer.getBuffer()
  }

  addCaveat(caveat: Serializable) {
    this.caveats.push(caveat)
    const caveatWriter = new Writer()
    caveat.writeTo(caveatWriter)
    const serializedCaveat = caveatWriter.getBuffer()

    this.signature = hmac(this.signature, serializedCaveat)
  }

  isValid(rootKey: Buffer) {
    const regenerated = new SpspToken({
      rootKey: rootKey,
      keyId: this.keyId,
      location: this.location,
      caveats: this.caveats
    })

    return regenerated.signature.equals(this.signature)
  }
}
