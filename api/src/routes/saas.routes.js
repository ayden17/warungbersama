'use strict';

const express = require('express');
const { createShop } = require('../saas/provision');
const registry = require('../saas/registry');
const { COOKIE } = require('../saas/scope');

const router = express.Router();

router.post('/signup', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.password !== body.passwordConfirm) {
      return res.status(400).json({
        type: 'error',
        message: 'The two passwords do not match.',
        data: null,
      });
    }
    const shop = await createShop({
      shopName: body.shopName,
      email: body.email,
      password: body.password,
    });
    res.cookie(COOKIE, shop.slug, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
    return res.status(201).json({
      type: 'success',
      message: 'Your shop is ready.',
      data: {
        slug: shop.slug,
        shopName: shop.shopName,
        email: shop.email,
        recoveryCodes: shop.recoveryCodes || [],
      },
    });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status === 500) console.error('[saas] signup failed:', error);
    return res.status(status).json({
      type: 'error',
      message: status === 500 ? 'The shop could not be created.' : error.message,
      data: null,
    });
  }
});

router.get('/whoami', async (req, res) => {
  const slug = req.cookies && req.cookies[COOKIE];
  const shop = slug ? await registry.findBySlug(slug) : null;
  res.json({
    type: 'success',
    data: shop ? { slug: shop.slug, shopName: shop.shopName, email: shop.email } : null,
  });
});

module.exports = router;
