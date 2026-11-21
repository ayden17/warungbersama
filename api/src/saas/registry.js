'use strict';

/*
 * The list of shops this process can open.
 *
 * A shop's sales live in their own database. This collection only remembers
 * which email owns which database, so a sign-in on the shared address can
 * find the right one. It is not a shop: nothing a till sells is stored here.
 */

const mongoose = require('mongoose');

const CONTROL_DB = 'warung_control';

function client() {
  const connection = mongoose.connection;
  if (!connection || connection.readyState !== 1) {
    throw new Error('The database is not ready yet');
  }
  return typeof connection.getClient === 'function' ? connection.getClient() : connection.client;
}

function shops() {
  return client().db(CONTROL_DB).collection('shops');
}

let indexesReady = null;

function ensureIndexes() {
  if (!indexesReady) {
    indexesReady = shops()
      .createIndexes([
        { key: { email: 1 }, unique: true, name: 'email' },
        { key: { slug: 1 }, unique: true, name: 'slug' },
      ])
      .catch((error) => {
        indexesReady = null;
        throw error;
      });
  }
  return indexesReady;
}

async function insertShop(shop) {
  await ensureIndexes();
  await shops().insertOne(shop);
}

async function findByEmail(email) {
  const value = String(email || '')
    .trim()
    .toLowerCase();
  if (!value) return null;
  return shops().findOne({ email: value });
}

async function findBySlug(slug) {
  const value = String(slug || '')
    .trim()
    .toLowerCase();
  if (!value) return null;
  return shops().findOne({ slug: value });
}

module.exports = {
  CONTROL_DB,
  ensureIndexes,
  insertShop,
  findByEmail,
  findBySlug,
};
