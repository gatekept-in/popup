# Shopify FAQ + Order Tracking Popup

Embeddable popup for Shopify stores with:

- FAQ accordion
- Order tracking form
- Order-number + phone verification through a private backend
- AWB extraction from Shopify fulfillment tracking, note attributes, or `awb:` tags
- Shiprocket tracking URL response

## Run locally

```bash
cp .env.example .env
npm run dev
```

If `npm` is not available, run:

```bash
node server.js
```

Open `http://localhost:8787`.

For deployment, set `HOST=0.0.0.0` if your host requires binding to all interfaces.

## Required credentials

Set these on the server, not in Shopify theme code.

### Option A: OAuth app from the Shopify Dev Dashboard

Use this if Shopify sent you to the developer dashboard and you installed the app there.

```bash
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_API_KEY=your_client_id
SHOPIFY_API_SECRET=your_client_secret
SHOPIFY_SCOPES=read_orders
APP_URL=https://support.gatekept.in
SHIPROCKET_TRACKING_URL_TEMPLATE=https://shiprocket.co/tracking/{awb}
```

In the Shopify Dev Dashboard, set:

- **App URL**: `https://support.gatekept.in/auth/shopify`
- **Allowed redirection URL**: `https://support.gatekept.in/auth/callback`
- **Scopes**: `read_orders`

Then visit this once in your browser:

```text
https://support.gatekept.in/auth/shopify?shop=your-store.myshopify.com
```

After Shopify redirects back successfully, the backend saves the offline access token in `data/shopify-tokens.json`.

### Option B: Custom app Admin API token

Use this only if Shopify gives you an Admin API token starting with `shpat_`.

```bash
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx
SHOPIFY_API_VERSION=2026-04
SHIPROCKET_TRACKING_URL_TEMPLATE=https://shiprocket.co/tracking/{awb}
```

The Shopify token needs permission to read orders. Use the Admin API access token, usually starting with `shpat_`.

Do not use the app client secret, usually starting with `shpss_`, in this project. If a secret was shared in chat or exposed anywhere public, rotate it in Shopify.

Your customer-facing domain can stay `gatekept.in`, but the Admin API domain is usually the store's `myshopify.com` domain.

## Why this needs a hosted backend

Shopify theme snippets run in the shopper's browser. That means any secret placed directly in Liquid or JavaScript can be viewed by customers.

This project is split into two parts:

1. A small browser widget that goes into Shopify.
2. A private backend server that talks to Shopify Admin API, verifies the phone number, finds the AWB, and returns only the Shiprocket tracking link.

The "hosted popup server domain" is the public URL where that backend is deployed, for example a Render/Railway/Fly.io URL or a subdomain like `support.gatekept.in`.

After deployment, the Shopify snippet loads:

```liquid
<script src="https://support.gatekept.in/widget.js" defer></script>
```

and sends tracking requests to:

```text
https://support.gatekept.in/api/track-order
```

## Add to Shopify

1. Host this project somewhere public, for example Render, Fly.io, Railway, or your own server.
2. Edit `snippets/shopify-faq-popup.liquid` and replace `https://YOUR-POPUP-SERVER-DOMAIN.com`.
3. Add the snippet to your Shopify theme, usually before `</body>` in `layout/theme.liquid`:

```liquid
{% render 'shopify-faq-popup' %}
```

## How AWB lookup works

The backend checks the matching Shopify order and tries these sources in order:

1. `fulfillments[].tracking_number` / `tracking_numbers[]`
2. Order note attributes with names containing `awb` or `tracking`
3. Order tags like `awb:123456789`

If Shiprocket syncs AWB into Shopify fulfillments, no separate Shiprocket API credential is needed for lookup.
