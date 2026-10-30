// Generates the merchant's ES256 signing key for Cart Mandates.
//   pnpm keys:gen > merchant-key.pem     (then put it in the server .env as MERCHANT_SIGNING_KEY)
// Never commit the output. *.pem is gitignored.
import { exportPKCS8, exportSPKI } from "jose";
import { generateSigningKeyPair } from "../../packages/mandates/src/index";

const { privateKey, publicKey } = await generateSigningKeyPair();
console.log(await exportPKCS8(privateKey as CryptoKey));
console.error("Public key (register with buyers, safe to share):\n" + (await exportSPKI(publicKey as CryptoKey)));
