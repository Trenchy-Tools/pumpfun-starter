"use client"

/**
 * Solana keys in the browser (demo mode): make a wallet, read a pasted secret, turn a stored secret into a signer.
 * The only chain-specific piece of the browser kit; the pons starter's twin (signer-evm.ts) does the same with a viem
 * account. Transactions are signed with the Keypair this returns (`tx.sign([kp])`), exactly as on the server.
 */
import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"

/** A new wallet: base58 public key + base58 64-byte secret (the wallet-file format). */
export function generateKey(): { publicKey: string; privateKey: string } {
  const kp = Keypair.generate()
  return { publicKey: kp.publicKey.toBase58(), privateKey: bs58.encode(kp.secretKey) }
}

/** A pasted base58 secret → its normalized form and public key. Throws "Not a valid base58 secret key". */
export function parseSecret(secret: string): { publicKey: string; privateKey: string } {
  let kp: Keypair
  try {
    kp = Keypair.fromSecretKey(bs58.decode(secret.trim()))
  } catch {
    throw new Error("Not a valid base58 secret key")
  }
  return { publicKey: kp.publicKey.toBase58(), privateKey: bs58.encode(kp.secretKey) }
}

/** The signer of a stored secret. Checks that the secret really is the key of `publicKey`. */
export function signerOf(publicKey: string, privateKey: string): Keypair {
  const kp = Keypair.fromSecretKey(bs58.decode(privateKey))
  if (kp.publicKey.toBase58() !== publicKey) throw new Error(`The stored key of ${publicKey.slice(0, 8)}… does not match its address`)
  return kp
}

/** A Solana address (base58, 32–44 characters). */
export const isAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim())
