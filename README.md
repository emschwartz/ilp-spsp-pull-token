# Pull Payments over ILP/SPSP
> The beginnings of a retail payment experience on Interledger

## Overview

This repo implements a demo Pull Payment SPSP Server. It enables users to create tokens that allow merchants to pull money from the user's account, up to user-specified limits.

### Why Pull Payments?

Pull payments are useful for retail payments because they:
- Allow users to pay, even if their device is not connected to the internet
- Do not require the user's device to maintain a persistent ILP connection in order to pay
- Are similar to the credit card flow people are used to
- Fit better into the W3C Web Payments API than push-based payments

### Differences with Credit Cards

Credit cards are insecure because the tokens users hand out to merchants allow the merchant to withdraw an almost unlimited amount of money from the user's account. Furthermore, the card number is, in most cases, not tied to the specific merchant so a hack of the merchant's database of card numbers means the compromise of many user accounts.

In contrast, this method for pull payments limits the scope of each merchant token in a number of important ways.

### Caveated Tokens

This implementation allows tokens to be limited in the following ways:
- Amount of money the token can be used to withdraw
- Expiration date
- Tying the token to a specific merchant ILP address

These caveats can be added by the token creator, and further limitations can be added by subsequent merchants or 3rd parties. All of the limitations are checked before the SPSP server pushes the money to the merchant.

The method for adding caveats is inspired by [Macaroons](https://ai.google/research/pubs/pub41892).

### Relationship with SPSP

This server implements the [Simple Payment Setup Protocol (SPSP)](https://github.com/interledger/rfcs/blob/master/0009-simple-payment-setup-protocol/0009-simple-payment-setup-protocol.md), with one addition. The token is sent as a Bearer authorization token in the standard HTTP `Authorization` header. The server's response is a normal SPSP response, but when the client (in this case the merchant) connects, the server will push money to the client.

## Trying It Out

- Clone the repo
- `npm install`
- `node index.js` (or `DEBUG=ilp-spsp*` to see more details)

## Futher Work
- TLS Over ILP - HTTPS is only used to exchange the shared secret and address. TLS over ILP would enable these payments to be made using only an ILP connection.
- Data Over ILP - The SPSP spec still recommends returning metadata about the receiver in the SPSP response. Should this data be sent over ILP instead?
- Streaming Receipts - See [interledger/rfcs#421](https://github.com/interledger/rfcs/issues/421). What public keys should we use to sign the receipts? What PKI should we leverage (CAs and X.509 certs, Handshake.org, or something else)?
- Receipt Format - Should we use JSON-LD and a schema.org schema for the receipt? Is having a standardized format for the receipt contents important for this use case?
- Updating the Auth Token Mid-Connection - Providing a way to update the auth token being used mid-stream would enable a user to continuously update the token to enable use cases like what Ben demoed in Laser Beer.
- Bundling vs Layering - How many features should be bundled together in one protocol for retail payments over ILP, or should we think about the token authorization, SPSP, and the streaming receipt as three separate protocols?
- QR Code / NFC / Laser - Implement various means of transmitting the auth token.

## Contributing

I'm looking for collaborators to help flesh out these ideas!
