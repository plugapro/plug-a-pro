# Pay@ Integration — Deployment Guide

Three files need to be copied into the Next.js app source directory and deployed to Vercel.

---

## Files to copy

| This staging file | → Copy to (inside your Next.js project) |
|---|---|
| `lib/payat/token.ts` | `lib/payat/token.ts` |
| `lib/payat/rtp.ts` | `lib/payat/rtp.ts` |
| `app/api/payat/webhook/route.ts` | `app/api/payat/webhook/route.ts` |

---

## Environment variables (must be in Vercel)

All of these should already be set. Double-check before deploying.

```
PAYAT_CLIENT_ID=client-419d4859-fa0c-4e62-b7d5-6ff8916e707d
PAYAT_CLIENT_SECRET=b2d8b4f8-c27a-4103-b30c-030b9ae46a4f
PAYAT_TOKEN_URL=https://go.payat.co.za/yapi/oauth/token
PAYAT_API_BASE=https://go.payat.co.za/yapi/v1
PAYAT_MERCHANT_ID=418856
PAYAT_MERCHANT_IDENTIFIER=plug-a-pro   ← confirm this with Pay@ support
PAYAT_WEBHOOK_SECRET=bffebe00d0c1f4be102fe6d024388e0182fc3a1457962813313c12638008e25b
```

---

## Deploy steps

```bash
# 1. Copy files into your Next.js project
cp lib/payat/token.ts       /path/to/your/nextjs-app/lib/payat/token.ts
cp lib/payat/rtp.ts         /path/to/your/nextjs-app/lib/payat/rtp.ts
mkdir -p /path/to/your/nextjs-app/app/api/payat/webhook
cp app/api/payat/webhook/route.ts  /path/to/your/nextjs-app/app/api/payat/webhook/route.ts

# 2. Deploy to Vercel
cd /path/to/your/nextjs-app
vercel --prod
```

---

## After deploying

1. Go to https://go.payat.co.za
2. Navigate to your merchant webhook settings
3. Click **Test Webhook** — it should now return ✅ 200
4. The webhook URL is: `https://plug-a-pro-main.vercel.app/api/payat/webhook`

---

## Outstanding items (need Pay@ to action)

- **KYC verification**: RTP creation returns 403 until the merchant account KYC is `VERIFIED`.
  Contact Pay@ support to confirm status.
- **merchantIdentifier**: Confirm that `plug-a-pro` is the correct registered identifier,
  or ask Pay@ to register it if it isn't.
- **Simulated environment**: The account appears to be in sandbox/simulated mode.
  Ask Pay@ to activate it for live payments or provide a proper sandbox environment.
