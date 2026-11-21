'use strict';

/*
 * Point this request at one shop.
 *
 * The browser is on one address for every customer. The shop is chosen by the
 * cookie written at signup, or by the email on a sign-in. Pages that exist
 * before an account, the landing page and the sign-up form, are served with
 * no shop in scope.
 */

const { enableMultiTenant, runWithTenant } = require('../db/tenant-context');
const registry = require('./registry');
const { tenantFromRecord } = require('./provision');

const COOKIE = 'wb_shop';
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function enabled() {
  return process.env.WARUNG_SAAS === '1';
}

function isVerify(path) {
  return path === '/users/verify' || path === '/api/users/verify';
}

function isPublicPage(req) {
  const path = req.path || '';
  if (req.method === 'POST' && (path === '/api/saas/signup' || path === '/saas/signup'))
    return true;
  if (req.method === 'GET' && (path === '/api/saas/whoami' || path === '/saas/whoami')) return true;
  if (path === '/' || path === '/public' || path === '/public/') return true;
  if (/\.(css|js|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|json|txt|webmanifest)$/i.test(path))
    return true;
  if (/\/(index|signup|login|forgotpassword|error-404|error-500|error-email)\.html$/i.test(path))
    return true;
  if (
    path.startsWith('/public/static') ||
    path.startsWith('/static') ||
    path.startsWith('/style') ||
    path.startsWith('/script') ||
    path.startsWith('/fonts') ||
    path.startsWith('/images')
  )
    return true;
  return false;
}

function remember(res, slug) {
  res.cookie(COOKIE, slug, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: YEAR_MS,
  });
}

async function shopFor(req) {
  const named = (req.cookies && req.cookies[COOKIE]) || req.get('x-warung-shop');
  if (named) {
    const bySlug = await registry.findBySlug(named);
    if (bySlug) return bySlug;
  }
  if (req.method === 'POST' && isVerify(req.path)) {
    const id = String((req.body && (req.body.username || req.body.email)) || '')
      .trim()
      .toLowerCase();
    if (id.includes('@')) return registry.findByEmail(id);
  }
  return null;
}

function scope(req, res, next) {
  if (!enabled()) return next();
  enableMultiTenant(true);

  shopFor(req)
    .then((record) => {
      const opened = tenantFromRecord(record);
      if (opened) {
        if (!req.cookies || req.cookies[COOKIE] !== opened.slug) remember(res, opened.slug);
        return runWithTenant(opened.tenant, () => next());
      }
      if (isPublicPage(req)) {
        req.saasPublic = true;
        return next();
      }
      if (req.method === 'POST' && isVerify(req.path)) {
        return res.status(404).json({
          type: 'error',
          message: 'No shop is registered for that email. Create one first.',
          data: 'incorrect',
        });
      }
      if (req.path.startsWith('/api') || req.path.startsWith('/users')) {
        return res.status(401).json({
          type: 'error',
          message: 'Create a shop before using the till.',
          data: null,
        });
      }
      req.saasPublic = true;
      return next();
    })
    .catch((error) => {
      console.error('[saas] could not choose a shop:', error.message);
      if (!res.headersSent) {
        res
          .status(503)
          .json({ type: 'error', message: 'The shop list is unavailable.', data: null });
      }
    });
}

module.exports = { scope, enabled, COOKIE };
