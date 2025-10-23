'use strict';

const AWS = require('aws-sdk');

const dynamo = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3({ signatureVersion: 'v4' });

const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;
const URL_EXPIRY_SECONDS = Number(process.env.URL_EXPIRY_SECONDS || 900);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

function normalizeOrigin(value) {
  if (!value) return '';
  const trimmed = value.toString().trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return trimmed.replace(/\/*$/, '');
  }
}

function resolveOrigin(requestOrigin = '') {
  if (!ALLOWED_ORIGINS || ALLOWED_ORIGINS === '*') return '*';
  const allowed = ALLOWED_ORIGINS.split(',').map(normalizeOrigin).filter(Boolean);
  if (!allowed.length) return '*';
  const normalisedRequest = normalizeOrigin(requestOrigin);
  if (normalisedRequest && allowed.includes(normalisedRequest)) return normalisedRequest;
  return allowed[0];
}

function createResponse(statusCode, body, headers = {}, origin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': resolveOrigin(origin),
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
      'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new Error('Invalid JSON payload supplied.');
  }
}

function sanitizeCategory(value) {
  return (value || '').toString().trim();
}
function sanitizeId(value) {
  return (value || '').toString().trim();
}
function sanitizeFilename(filename) {
  return (filename || '').toString().replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function normalizeItem(rawItem, { status }) {
  if (!rawItem || !rawItem.id || !rawItem.category) return null;
  const now = new Date().toISOString();
  const images = Array.isArray(rawItem.images)
    ? rawItem.images.filter(Boolean).map((src) => src.toString())
    : [];
  return {
    Category: sanitizeCategory(rawItem.category),
    ProductId: sanitizeId(rawItem.id),
    Name: (rawItem.name || '').toString(),
    Description: (rawItem.description || '').toString(),
    UnitLabel: (rawItem.unitLabel || '').toString(),
    Price: Number(rawItem.price) || 0,
    Images: images.slice(0, 10),
    Status: status,
    UpdatedAt: rawItem.updatedAt || now,
  };
}

function keyOf(cat, id) {
  return `${sanitizeCategory(cat)}#${sanitizeId(id)}`;
}

/** Batch write helpers that separate PUTs and DELETEs and retry unprocessed items */
async function batchWritePut(items) {
  if (!items.length) return;
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    let pending = { RequestItems: { [TABLE_NAME]: chunk } };
    do {
      const res = await dynamo.batchWrite(pending).promise();
      const un = res.UnprocessedItems?.[TABLE_NAME] || [];
      pending = un.length ? { RequestItems: { [TABLE_NAME]: un } } : null;
    } while (pending);
  }
}

async function batchWriteDelete(keys) {
  if (!keys.length) return;
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
    let pending = { RequestItems: { [TABLE_NAME]: chunk } };
    do {
      const res = await dynamo.batchWrite(pending).promise();
      const un = res.UnprocessedItems?.[TABLE_NAME] || [];
      pending = un.length ? { RequestItems: { [TABLE_NAME]: un } } : null;
    } while (pending);
  }
}

/** --- FIXED /sync: dedupe keys, apply priority, delete first, then upsert --- */
async function handleSync(event, origin) {
  if (!TABLE_NAME) throw new Error('TABLE_NAME environment variable is not configured.');

  const payload = parseJsonBody(event);
  const published = Array.isArray(payload.published) ? payload.published : [];
  const overrides = Array.isArray(payload.overrides) ? payload.overrides : [];
  const drafts    = Array.isArray(payload.drafts)    ? payload.drafts    : [];
  const removed   = Array.isArray(payload.removed)   ? payload.removed   : [];

  // Priority: removed > overrides > published > drafts
  const upsertMap = new Map();
  const apply = (arr, status) => {
    for (const item of arr) {
      const cat = item?.category; const id = item?.id;
      if (!cat || !id) continue;
      const norm = normalizeItem({ ...item, category: cat, id }, { status });
      if (!norm) continue;
      upsertMap.set(keyOf(cat, id), norm); // last writer wins within same priority tier
    }
  };

  // Lowest → highest so later ones override earlier
  apply(drafts, 'DRAFT');
  apply(published, 'PUBLISHED');
  apply(overrides, 'PUBLISHED_OVERRIDE');

  // Any removed key must not be in upserts
  const deleteKeys = [];
  for (const item of removed) {
    if (!item?.category || !item?.id) continue;
    const k = keyOf(item.category, item.id);
    upsertMap.delete(k);
    deleteKeys.push({
      Category: sanitizeCategory(item.category),
      ProductId: sanitizeId(item.id),
    });
  }

  const putItems = Array.from(upsertMap.values());

  // Execute in two phases to avoid duplicate-key-in-batch errors
  await batchWriteDelete(deleteKeys);
  await batchWritePut(putItems);

  return createResponse(
    200,
    {
      message: 'Inventory synchronised successfully.',
      upserted: putItems.length,
      removed: deleteKeys.length,
    },
    {},
    origin
  );
}

async function handleList(event, origin) {
  if (!TABLE_NAME) throw new Error('TABLE_NAME environment variable is not configured.');
  const params = event.queryStringParameters || {};
  const category = sanitizeCategory(params.category);

  if (category) {
    const result = await dynamo
      .query({
        TableName: TABLE_NAME,
        KeyConditionExpression: '#c = :category',
        ExpressionAttributeNames: { '#c': 'Category' },
        ExpressionAttributeValues: { ':category': category },
      })
      .promise();
    return createResponse(200, { items: result.Items || [] }, {}, origin);
  }

  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await dynamo.scan({ TableName: TABLE_NAME, ExclusiveStartKey }).promise();
    (result.Items || []).forEach((item) => items.push(item));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return createResponse(200, { items }, {}, origin);
}

async function handleGet(event, origin) {
  if (!TABLE_NAME) throw new Error('TABLE_NAME environment variable is not configured.');
  const category = sanitizeCategory(event.pathParameters?.category);
  const id = sanitizeId(event.pathParameters?.id);
  if (!category || !id) return createResponse(400, { message: 'Both category and id are required.' }, {}, origin);

  const result = await dynamo
    .get({ TableName: TABLE_NAME, Key: { Category: category, ProductId: id } })
    .promise();
  if (!result.Item) return createResponse(404, { message: 'Product not found.' }, {}, origin);
  return createResponse(200, result.Item, {}, origin);
}

async function handlePut(event, origin) {
  if (!TABLE_NAME) throw new Error('TABLE_NAME environment variable is not configured.');
  const category = sanitizeCategory(event.pathParameters?.category);
  const id = sanitizeId(event.pathParameters?.id);
  if (!category || !id) return createResponse(400, { message: 'Both category and id are required.' }, {}, origin);

  const payload = parseJsonBody(event);
  const normalized = normalizeItem({ ...payload, id, category }, { status: payload.status || 'PUBLISHED' });
  if (!normalized) return createResponse(400, { message: 'Invalid product payload.' }, {}, origin);

  await dynamo.put({ TableName: TABLE_NAME, Item: normalized }).promise();
  return createResponse(200, { message: 'Product saved.', item: normalized }, {}, origin);
}

async function handleDelete(event, origin) {
  if (!TABLE_NAME) throw new Error('TABLE_NAME environment variable is not configured.');
  const category = sanitizeCategory(event.pathParameters?.category);
  const id = sanitizeId(event.pathParameters?.id);
  if (!category || !id) return createResponse(400, { message: 'Both category and id are required.' }, {}, origin);

  await dynamo.delete({ TableName: TABLE_NAME, Key: { Category: category, ProductId: id } }).promise();
  return createResponse(200, { message: 'Product deleted.' }, {}, origin);
}

async function handleUploadUrl(event, origin) {
  if (!BUCKET_NAME) throw new Error('BUCKET_NAME environment variable is not configured.');
  const category = sanitizeCategory(event.pathParameters?.category);
  const id = sanitizeId(event.pathParameters?.id);
  if (!category || !id) return createResponse(400, { message: 'Both category and id are required.' }, {}, origin);

  const payload = parseJsonBody(event);
  const originalName = sanitizeFilename((payload.filename || payload.fileName || `${Date.now()}.jpg`).toString());
  const contentType = (payload.contentType || 'image/jpeg').toString();
  const key = `catalogue/${category}/${id}/${Date.now()}-${originalName}`;

  // No ACL here (bucket has ObjectOwnership=BucketOwnerEnforced)
  const uploadUrl = await s3.getSignedUrlPromise('putObject', {
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    Expires: URL_EXPIRY_SECONDS,
  });

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const publicUrl = `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;

  return createResponse(200, { uploadUrl, publicUrl, expiresIn: URL_EXPIRY_SECONDS }, {}, origin);
}

exports.handler = async (event) => {
  try {
    const origin = event.headers?.origin || event.headers?.Origin || '';
    const routeKey = `${event.httpMethod || ''} ${event.resource || event.path}`.trim();
    switch (routeKey) {
      case 'OPTIONS /sync':
      case 'OPTIONS /products':
      case 'OPTIONS /products/{category}/{id}':
      case 'OPTIONS /products/{category}/{id}/images':
        return createResponse(200, { message: 'ok' }, {}, origin);
      case 'POST /sync':
        return await handleSync(event, origin);
      case 'GET /products':
        return await handleList(event, origin);
      case 'GET /products/{category}/{id}':
        return await handleGet(event, origin);
      case 'PUT /products/{category}/{id}':
        return await handlePut(event, origin);
      case 'DELETE /products/{category}/{id}':
        return await handleDelete(event, origin);
      case 'POST /products/{category}/{id}/images':
        return await handleUploadUrl(event, origin);
      default:
        return createResponse(404, { message: 'Route not found.' }, {}, origin);
    }
  } catch (error) {
    console.error('Admin API error', error);
    return createResponse(500, { message: 'Internal server error.', detail: error.message }, {}, event.headers?.origin || event.headers?.Origin || '');
  }
};
