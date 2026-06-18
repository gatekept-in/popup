import http from "node:http";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
loadDotEnv();

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN || "";
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || "read_orders";
const APP_URL = (process.env.APP_URL || `http://${HOST}:${PORT}`).replace(/\/$/, "");
const SHIPROCKET_TRACKING_URL_TEMPLATE =
  process.env.SHIPROCKET_TRACKING_URL_TEMPLATE || "https://shiprocket.co/tracking/{awb}";
const TOKEN_STORE_PATH = join(__dirname, "data", "shopify-tokens.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      sendCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/track-order") {
      await handleTrackOrder(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/shopify") {
      await handleShopifyAuth(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/callback") {
      await handleShopifyCallback(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    const pathname = url.pathname === "/" ? "/demo.html" : url.pathname;
    const publicRoot = resolve(__dirname, "public");
    const publicPath = resolve(publicRoot, pathname.replace(/^\/+/, ""));

    if (publicPath !== publicRoot && !publicPath.startsWith(`${publicRoot}${sep}`)) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const file = await readFile(publicPath);
    res.writeHead(200, {
      "content-type": contentTypes[extname(publicPath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    console.error(error);
    sendJson(res, 500, { error: "Something went wrong. Please try again." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`FAQ/order popup server running at http://${HOST}:${PORT}`);
});

async function handleTrackOrder(req, res) {
  const body = await readJson(req);
  const orderNumber = String(body.orderNumber || "").trim();
  const phone = String(body.phone || "").trim();

  if (!orderNumber || !phone) {
    sendJson(res, 400, { error: "Please enter both order number and phone number." });
    return;
  }

  const accessToken = await getShopifyAccessToken(SHOPIFY_SHOP_DOMAIN);
  if (!SHOPIFY_SHOP_DOMAIN || !accessToken) {
    sendJson(res, 503, {
      error: "Order tracking is not connected yet. Authorize the Shopify app first."
    });
    return;
  }

  const order = await findShopifyOrder(orderNumber, accessToken);

  if (!order) {
    sendJson(res, 404, { error: "We could not find that order number." });
    return;
  }

  if (!orderPhoneMatches(order, phone)) {
    sendJson(res, 403, {
      error: "That phone number does not match the order. Please check and try again."
    });
    return;
  }

  const awb = findAwb(order);

  if (!awb) {
    sendJson(res, 404, {
      error: "We found your order, but tracking is not available yet."
    });
    return;
  }

  sendJson(res, 200, {
    orderNumber: order.name || orderNumber,
    awb,
    trackingUrl: SHIPROCKET_TRACKING_URL_TEMPLATE.replace("{awb}", encodeURIComponent(awb))
  });
}

async function handleShopifyAuth(req, res, url) {
  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    sendHtml(res, 500, "Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET on the server.");
    return;
  }

  const shop = normalizeShopDomain(url.searchParams.get("shop") || SHOPIFY_SHOP_DOMAIN);
  if (!isValidShopDomain(shop)) {
    sendHtml(res, 400, "Missing or invalid shop domain. Use /auth/shopify?shop=your-store.myshopify.com");
    return;
  }

  const state = crypto.randomBytes(20).toString("hex");
  const redirectUri = `${APP_URL}/auth/callback`;
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", SHOPIFY_API_KEY);
  authUrl.searchParams.set("scope", SHOPIFY_SCOPES);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  res.writeHead(302, {
    "set-cookie": `shopify_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    "location": authUrl.toString()
  });
  res.end();
}

async function handleShopifyCallback(req, res, url) {
  const shop = normalizeShopDomain(url.searchParams.get("shop"));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = getCookie(req, "shopify_oauth_state");

  if (!isValidShopDomain(shop) || !code || !state || !cookieState || state !== cookieState) {
    sendHtml(res, 400, "Shopify authorization failed validation.");
    return;
  }

  if (!verifyShopifyHmac(url.searchParams)) {
    sendHtml(res, 400, "Shopify authorization HMAC was invalid.");
    return;
  }

  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "accept": "application/json"
    },
    body: new URLSearchParams({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code
    })
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Shopify token exchange failed ${tokenResponse.status}: ${text}`);
  }

  const payload = await tokenResponse.json();
  await saveShopifyAccessToken(shop, payload.access_token);

  sendHtml(res, 200, `
    <h1>Shopify connected</h1>
    <p>The tracking popup can now read orders for ${escapeHtml(shop)}.</p>
  `);
}

async function findShopifyOrder(orderNumber, accessToken) {
  const cleanNumber = orderNumber.replace(/^#/, "");
  const namesToTry = [`#${cleanNumber}`, cleanNumber];

  for (const name of namesToTry) {
    const params = new URLSearchParams({
      status: "any",
      name,
      limit: "1",
      fields: [
        "id",
        "name",
        "phone",
        "customer",
        "shipping_address",
        "billing_address",
        "fulfillments",
        "note_attributes",
        "tags"
      ].join(",")
    });

    const response = await shopifyFetch(`/orders.json?${params.toString()}`, accessToken);
    const order = response.orders?.[0];
    if (order) return order;
  }

  return null;
}

async function shopifyFetch(path, accessToken) {
  const url = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Shopify API ${response.status}: ${message}`);
  }

  return response.json();
}

function orderPhoneMatches(order, submittedPhone) {
  const submitted = normalizePhone(submittedPhone);
  if (!submitted) return false;

  const candidates = [
    order.phone,
    order.customer?.phone,
    order.customer?.default_address?.phone,
    order.shipping_address?.phone,
    order.billing_address?.phone
  ]
    .map(normalizePhone)
    .filter(Boolean);

  return candidates.some((candidate) => {
    const shortest = Math.min(candidate.length, submitted.length, 10);
    return shortest >= 8 && candidate.slice(-shortest) === submitted.slice(-shortest);
  });
}

function findAwb(order) {
  const fulfillmentTracking = (order.fulfillments || [])
    .flatMap((fulfillment) => [
      fulfillment.tracking_number,
      ...(fulfillment.tracking_numbers || [])
    ])
    .filter(Boolean);

  if (fulfillmentTracking.length) return String(fulfillmentTracking[0]).trim();

  const awbAttribute = (order.note_attributes || []).find((attribute) => {
    const name = String(attribute.name || "").toLowerCase();
    return name.includes("awb") || name.includes("tracking");
  });

  if (awbAttribute?.value) return String(awbAttribute.value).trim();

  const awbTag = String(order.tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .find((tag) => /^awb[:=_-]/i.test(tag));

  return awbTag ? awbTag.replace(/^awb[:=_-]/i, "").trim() : "";
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

async function getShopifyAccessToken(shop) {
  if (SHOPIFY_ADMIN_ACCESS_TOKEN) return SHOPIFY_ADMIN_ACCESS_TOKEN;
  const tokens = await readTokenStore();
  return tokens[normalizeShopDomain(shop)]?.accessToken || "";
}

async function saveShopifyAccessToken(shop, accessToken) {
  const tokens = await readTokenStore();
  tokens[shop] = {
    accessToken,
    savedAt: new Date().toISOString()
  };

  await mkdir(join(__dirname, "data"), { recursive: true });
  await writeFile(TOKEN_STORE_PATH, JSON.stringify(tokens, null, 2));
}

async function readTokenStore() {
  try {
    return JSON.parse(await readFile(TOKEN_STORE_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function verifyShopifyHmac(searchParams) {
  const hmac = searchParams.get("hmac");
  if (!hmac || !SHOPIFY_API_SECRET) return false;

  const message = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  return safeEqual(digest, hmac);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeShopDomain(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function isValidShopDomain(shop) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}

function getCookie(req, name) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((cookie) => cookie.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

function loadDotEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(res, statusCode, payload) {
  sendCors(res);
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><body>${html}</body></html>`);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
