/**
 * Product catalog from ipdokan.com's public API (GET /api/products).
 *
 * Returns data in the same shape the old WooCommerce service did, so the bot
 * and the Mini App use it unchanged. IDs:
 *   - product / package: 24-char hex strings from ipdokan.com
 *   - package "short id": last 6 hex chars, used inside Telegram buttons
 *     (callback_data is limited to 64 bytes); resolved within its product
 *   - category: 6-char hash of the category name
 *   - location: ipdokan's own location id (e.g. "125")
 *
 * syncToStore() mirrors products into Brand (one per product) and Plan (one
 * per package), so admins can upload stock for them in the admin panel.
 */
const axios = require("axios");
const crypto = require("crypto");
const Brand = require("../models/Brand");
const Plan = require("../models/Plan");

const BASE_URL = (process.env.IPDOKAN_URL || "https://ipdokan.com").replace(/\/$/, "");
const CACHE_TTL = 60 * 1000;

let cache = { products: null, at: 0, pending: null };

function categoryId(name) {
  return crypto.createHash("sha1").update(String(name || "")).digest("hex").slice(0, 6);
}

/** Short package id for Telegram buttons. Old numeric ids pass through. */
function shortId(id) {
  const s = String(id ?? "");
  return s.length > 12 ? s.slice(-6) : s;
}

function categoryEmoji(name) {
  const n = String(name).toUpperCase();
  if (n.includes("DISCOUNT")) return "⚡";
  if (n.includes("RESIDENTIAL") || n.includes("STATIC")) return "🔒";
  if (n.includes("ISP")) return "🏠";
  if (n.includes("PRIVATE") || n.includes("DATACENTER")) return "🛡️";
  if (n.includes("SERVER") || n.includes("VPS")) return "🖥️";
  if (n.includes("GB")) return "🌐";
  return "📁";
}

/** Packages that can be bought online (price-on-request ones need a human). */
function buyableVariants(p) {
  return (p.variants || []).filter((v) => !v.priceOnRequest);
}

async function fetchProducts(forceRefresh = false) {
  if (!forceRefresh && cache.products && Date.now() - cache.at < CACHE_TTL) return cache.products;
  if (cache.pending) return cache.pending;
  cache.pending = axios
    .get(`${BASE_URL}/api/products`, { timeout: 15000, headers: { Accept: "application/json" } })
    .then((res) => {
      const products = (res.data?.products || []).filter((p) => !p.priceOnRequest);
      cache = { products, at: Date.now(), pending: null };
      return products;
    })
    .catch((err) => {
      cache.pending = null;
      console.error("[ipdokan API Error]:", err.response?.status || "", err.message);
      // Serve the last good copy rather than failing the whole menu
      if (cache.products) return cache.products;
      throw err;
    });
  return cache.pending;
}

async function findRawProduct(productId) {
  const products = await fetchProducts();
  return products.find((x) => x.id === String(productId)) || null;
}

/** Finds a package by full id or by its short (suffix) id. */
function findRawVariant(product, variantId) {
  const vid = String(variantId ?? "");
  if (!product || !vid || vid === "0") return null;
  const list = buyableVariants(product);
  const exact = list.find((v) => v.id === vid);
  if (exact) return exact;
  if (vid.length < 6) return null;
  const matches = list.filter((v) => v.id.endsWith(vid));
  return matches.length === 1 ? matches[0] : null;
}

function locationsOf(p) {
  return (p.locationOptions || []).map((l) => ({
    id: String(l.id),
    name: l.name,
    stock: l.stock ?? null,
    inStock: l.stock == null || l.stock > 0,
  }));
}

function summarize(p) {
  const variants = buyableVariants(p);
  return {
    id: p.id,
    name: p.name,
    price: p.priceBdt,
    image: p.imageUrl || "",
    inStock: (p.available ?? 0) > 0,
    hasVariations: variants.length > 0,
    variationsCount: variants.length,
    hasLocations: (p.locationOptions || []).length > 0,
  };
}

function formatVariant(p, v) {
  return {
    id: v.id,
    shortId: shortId(v.id),
    productId: p.id,
    name: v.name,
    price: String(v.priceBdt ?? ""),
    stockQuantity: v.available ?? null,
    stockStatus: (v.available ?? 0) > 0 ? "instock" : "outofstock",
    inStock: (v.available ?? 0) > 0,
    ips: v.ips ?? null,
    chooseLocation: Boolean(v.chooseLocation) && (p.locationOptions || []).length > 0,
  };
}

async function getCategories(forceRefresh = false) {
  const products = await fetchProducts(forceRefresh);
  const byName = new Map();
  for (const p of products) {
    const name = p.category || "Other";
    byName.set(name, (byName.get(name) || 0) + 1);
  }
  return [...byName].map(([name, count]) => ({
    id: categoryId(name),
    name,
    slug: categoryId(name),
    count,
    parent: 0,
    emoji: categoryEmoji(name),
  }));
}

async function getProductsByCategory(catId, forceRefresh = false) {
  const products = await fetchProducts(forceRefresh);
  return products.filter((p) => categoryId(p.category || "Other") === String(catId)).map(summarize);
}

/** WooCommerce-shaped product (what resolveItem / the handlers read) plus locations. */
async function getProduct(productId) {
  const p = await findRawProduct(productId);
  if (!p) {
    const err = new Error(`Product ${productId} not found on ipdokan.com`);
    err.status = 404;
    throw err;
  }
  return {
    id: p.id,
    name: p.name,
    price: String(p.priceBdt ?? ""),
    stock_status: (p.available ?? 0) > 0 ? "instock" : "outofstock",
    stock_quantity: p.available ?? null,
    images: p.imageUrl ? [{ src: p.imageUrl }] : [],
    short_description: p.description || "",
    category: p.category || "",
    categoryId: categoryId(p.category || "Other"),
    instantDelivery: Boolean(p.instantDelivery),
    locations: locationsOf(p),
  };
}

async function getProductVariations(productId, forceRefresh = false) {
  const products = await fetchProducts(forceRefresh);
  const p = products.find((x) => x.id === String(productId));
  if (!p) return [];
  return buyableVariants(p)
    .map((v) => formatVariant(p, v))
    .sort((a, b) => parseFloat(a.price || 0) - parseFloat(b.price || 0));
}

/** One package by full or short id, or null. */
async function getVariation(productId, variantId) {
  const p = await findRawProduct(productId);
  const v = findRawVariant(p, variantId);
  return v ? formatVariant(p, v) : null;
}

async function getLocation(productId, locationId) {
  const p = await findRawProduct(productId);
  return p ? locationsOf(p).find((l) => l.id === String(locationId)) || null : null;
}

/** Upserts the Brand for an ipdokan product and the Plan for each of its packages. */
async function syncProduct(p) {
  const brandFields = {
    name: p.name,
    ipdokanProductId: p.id,
    description: [p.category, p.description].filter(Boolean).join(" · ").slice(0, 500),
    locations: (p.locationOptions || []).map((l) => ({ id: String(l.id), name: l.name })),
    emoji: categoryEmoji(p.category || ""),
  };
  const brand =
    (await Brand.findOneAndUpdate({ ipdokanProductId: p.id }, { $set: brandFields }, { new: true })) ||
    (await Brand.findOneAndUpdate({ name: p.name }, { $set: brandFields }, { new: true })) ||
    (await Brand.create({ ...brandFields, isActive: true }));

  const plans = [];
  const variants = buyableVariants(p);
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const planFields = {
      brandId: brand._id,
      label: v.name,
      price: Number(v.priceBdt) || 0,
      currency: "BDT",
      ipdokanVariantId: v.id,
      chooseLocation: Boolean(v.chooseLocation) && (p.locationOptions || []).length > 0,
      displayOrder: i,
    };
    const plan =
      (await Plan.findOneAndUpdate({ ipdokanVariantId: v.id }, { $set: planFields }, { new: true })) ||
      (await Plan.findOneAndUpdate({ brandId: brand._id, label: v.name }, { $set: planFields }, { new: true })) ||
      (await Plan.create({ ...planFields, isActive: true }));
    plans.push(plan);
  }
  return { brand, plans };
}

/** Mirrors the whole ipdokan.com catalog into Brand / Plan. */
async function syncToStore() {
  const products = await fetchProducts(true);
  let brands = 0;
  let plans = 0;
  for (const p of products) {
    const r = await syncProduct(p);
    brands++;
    plans += r.plans.length;
  }
  return { brands, plans };
}

/** Brand + Plan for one package (creates them if the sync hasn't run yet). */
async function ensureBrandPlan(productId, variantId) {
  const p = await findRawProduct(productId);
  if (!p) return { brand: null, plan: null };
  const v = findRawVariant(p, variantId);
  let plan = v ? await Plan.findOne({ ipdokanVariantId: v.id }) : null;
  let brand = await Brand.findOne({ ipdokanProductId: p.id });
  if (!brand || (v && !plan)) {
    const r = await syncProduct(p);
    brand = r.brand;
    plan = v ? r.plans.find((x) => x.ipdokanVariantId === v.id) || null : null;
  }
  return { brand, plan };
}

function clearProductCache() {
  cache = { products: null, at: 0, pending: null };
}

module.exports = {
  getCategories,
  getProductsByCategory,
  getProduct,
  getProductVariations,
  getVariation,
  getLocation,
  syncToStore,
  ensureBrandPlan,
  clearProductCache,
  categoryId,
  shortId,
};
