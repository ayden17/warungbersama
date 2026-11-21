'use strict';

/*
 * Open a new shop.
 *
 * One account is one database. The till already refuses to install over a
 * shop that exists, so a second customer cannot be a second user in the first
 * customer's database. Signup creates an empty database, runs the same
 * installer the desktop wizard runs, and records who owns it.
 */

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const InstallService = require('../services/install.service');
const { runWithTenant } = require('../db/tenant-context');
const { tenantConnection } = require('../db/tenant-connections');
const registry = require('./registry');

function slugFrom(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  return base || 'warung';
}

function secrets() {
  return {
    JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
    ENCRYPTION_KEY: crypto.randomBytes(16).toString('hex'),
    ENCRYPTION_IV: crypto.randomBytes(8).toString('hex'),
  };
}

function validate(input) {
  const shopName = String(input.shopName || '').trim();
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  const password = String(input.password || '');
  const errors = [];
  if (shopName.length < 2 || shopName.length > 60)
    errors.push('Shop name must be 2 to 60 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120)
    errors.push('Enter a valid email.');
  if (password.length < 8 || password.length > 72)
    errors.push('Password must be at least 8 characters.');
  return { shopName, email, password, errors };
}

async function createShop({ shopName, email, password }) {
  const checked = validate({ shopName, email, password });
  if (checked.errors.length) {
    const error = new Error(checked.errors[0]);
    error.statusCode = 400;
    throw error;
  }

  if (await registry.findByEmail(checked.email)) {
    const error = new Error('That email already has a shop. Log in instead.');
    error.statusCode = 409;
    throw error;
  }

  const slug = `${slugFrom(checked.shopName)}${crypto.randomBytes(2).toString('hex')}`;
  const tenantDb = `wb_${slug}`.slice(0, 63);
  const shopSecrets = secrets();
  const connection = tenantConnection(tenantDb);
  const tenant = {
    db: connection.db,
    connection,
    tenantDb,
    subdomain: slug,
    secrets: shopSecrets,
  };

  let installed;
  try {
    installed = await runWithTenant(tenant, () =>
      new InstallService().processInstallation({
        register_firstname: checked.shopName.slice(0, 20),
        register_lastname: 'Owner',
        register_username: checked.email,
        register_useremail: checked.email,
        register_userpassword: checked.password,
        register_companyname: checked.shopName,
        register_address: '',
        register_fullnumber: '',
        register_country: 'Indonesia',
        register_countryid: '',
        register_state: '',
        register_currency: 'IDR',
        register_timezone: 'Asia/Jakarta',
        register_license: new ObjectId().toHexString(),
        register_demo: 'yes',
        businessType: 'cafe',
      })
    );
  } catch (error) {
    await connection.db.dropDatabase().catch(() => {});
    throw error;
  }

  if (!installed || installed.status !== true) {
    await connection.db.dropDatabase().catch(() => {});
    const error = new Error((installed && installed.message) || 'The shop could not be created.');
    error.statusCode = 400;
    throw error;
  }

  try {
    const { runMigrations } = require('../db/migrations');
    await runMigrations(connection.db, require('../db/migrations/index'));
  } catch (error) {
    console.error('[saas] shop created but migrations did not finish:', error.message);
  }

  const record = {
    slug,
    shopName: checked.shopName,
    email: checked.email,
    tenantDb,
    secrets: shopSecrets,
    createdAt: new Date(),
  };
  try {
    await registry.insertShop(record);
  } catch (error) {
    await connection.db.dropDatabase().catch(() => {});
    if (error && error.code === 11000) {
      const duplicate = new Error('That email already has a shop. Log in instead.');
      duplicate.statusCode = 409;
      throw duplicate;
    }
    throw error;
  }

  return {
    slug,
    shopName: checked.shopName,
    email: checked.email,
    recoveryCodes: installed.data && installed.data.recoveryCodes,
  };
}

function tenantFromRecord(record) {
  if (!record) return null;
  const connection = tenantConnection(record.tenantDb);
  return {
    slug: record.slug,
    shopName: record.shopName,
    email: record.email,
    tenant: {
      db: connection.db,
      connection,
      tenantDb: record.tenantDb,
      subdomain: record.slug,
      secrets: record.secrets,
    },
  };
}

module.exports = { createShop, tenantFromRecord, validate, slugFrom };
