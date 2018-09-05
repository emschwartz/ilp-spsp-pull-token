import { SpspToken, AmountCaveat } from './spsp-token'
import { Connection, DataAndMoneyStream } from 'ilp-protocol-stream'
import BigNumber from 'bignumber.js'
import * as assert from 'assert'
const createLogger = require('ilp-logger')

interface TokenRecord {
  periodStart: number,
  periodDuration: number,
  periodSendMax: BigNumber,
  totalSentInPeriod: BigNumber,
  periodsLeft: number,
  expired: boolean
}

function updateRecordTimePeriod (record: TokenRecord) {
  const numPeriodsSinceStart = Math.floor((Date.now() - record.periodStart) / record.periodDuration)
  const periodStart = record.periodStart + (numPeriodsSinceStart * record.periodDuration)
  const periodsLeft = record.periodsLeft - numPeriodsSinceStart
  record.periodStart = periodStart
  record.totalSentInPeriod = new BigNumber(0)
  if (periodsLeft < 0) {
    record.periodsLeft = 0
    record.expired = true
  } else {
    record.periodsLeft = periodsLeft
  }
}

export class TokenManager {
  private tokens: {[key: string]: TokenRecord}
  private rootKey: Buffer
  private log: any

  constructor(rootKey: Buffer) {
    this.tokens = {}
    this.rootKey = rootKey
    this.log = createLogger('ilp-spsp-pull-token:manager')
  }

  addToken(token: SpspToken) {
    assert(token.isValid(this.rootKey), 'Invalid token')

    if (this.tokens[token.keyId.toString('hex')]) {
      throw new Error('Multiple entries per token not yet implemented')
    }

    if (token.caveats.length > 1) {
      throw new Error('Multiple caveats not yet implemented')
    }

    // TODO handle multiple caveats
    const caveat = token.caveats[0]
    if (caveat instanceof AmountCaveat) {
      this.tokens[token.keyId.toString('hex')] = {
        periodStart: caveat.startTime.valueOf(),
        periodDuration: caveat.duration,
        periodsLeft: caveat.repetitions - 1,
        periodSendMax: new BigNumber(caveat.amount),
        totalSentInPeriod: new BigNumber(0),
        expired: false
      }

      updateRecordTimePeriod(this.tokens[token.keyId.toString('hex')])

      this.log.debug(`Added record for token: ${token.keyId.toString('hex')}:`, JSON.stringify(this.tokens[token.keyId.toString('hex')]))
    }
  }

  async handleConnection(conn: Connection) {
    const keyId = conn.connectionTag
    if (!keyId) {
      return conn.destroy(new Error('Unexpected connection'))
    }

    this.log.debug(`Got connection for token: ${keyId}`)

    if (!this.tokens[keyId]) {
      this.log.error(`No token record with id: ${keyId}, closing connection`)
      return conn.end()
    }

    updateRecordTimePeriod(this.tokens[keyId])
    const record = this.tokens[keyId]

    // TODO prevent or handle multiple simultaneous connections

    // Only necessary because of a bug in stream where it emits "connect"
    // before it is really ready to send money
    await conn.connect()
    this.log.debug(`Connection connected`)
    const stream = conn.createStream()

    stream.on('outgoing_money', (amount: string) => {
      updateRecordTimePeriod(this.tokens[keyId])
      this.tokens[keyId].totalSentInPeriod = this.tokens[keyId].totalSentInPeriod.plus(amount)
      this.log.debug(`Sent ${amount} for token ${keyId}. Total sent during period: ${new Date(this.tokens[keyId].periodStart).toISOString()}: ${this.tokens[keyId].totalSentInPeriod}`)
    })

    this.updateAmountToSend(keyId, stream)
    setTimeout(() => {
      this.updateAmountToSend(keyId, stream)
      // TODO only have one timer going per server
      const interval = setInterval(() => {
        this.updateAmountToSend(keyId, stream)
        if (this.tokens[keyId].periodsLeft <= 0) {
          clearInterval(interval)
        }
      }, record.periodDuration)
    }, record.periodDuration - (Date.now() - record.periodStart))
  }

  updateAmountToSend(keyId: string, stream: DataAndMoneyStream) {
    updateRecordTimePeriod(this.tokens[keyId])
    const record = this.tokens[keyId]
    let amountLeftToSendInPeriod
    if (record.expired) {
      amountLeftToSendInPeriod = new BigNumber(0)
    } else {
      amountLeftToSendInPeriod = record.periodSendMax.minus(record.totalSentInPeriod)
    }
    const newSendMax = amountLeftToSendInPeriod.plus(stream.totalSent)
    this.log.debug(`Amount left to send in period starting ${new Date(record.periodStart).toISOString()}: ${amountLeftToSendInPeriod}. Setting sendMax to ${newSendMax}`)
    stream.setSendMax(newSendMax)
  }
}