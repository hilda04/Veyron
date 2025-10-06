'use strict';

const AWS = require('aws-sdk');

const dynamo = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3({ signatureVersion: 'v4' });

const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;
const URL_EXPIRY_SECONDS = Number(process.env.URL_EXPIRY_SECONDS || 900);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

function resolveOrigin(requestOrigin = '') {
  if (!ALLOWED_ORIGINS || ALLOWED_ORIGINS === '*') {
    return '*';
  }
  const allowed = ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowed.length) {
    return '*';
  }
  if (requestOrigin && allowed.includes(requestOrigin)) {
    return requestOrigin;
  }
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
  } catch (error) {
    throw new Error('Invalid JSON payload supplied.');
  }
}

function sanitizeCategory(value) {
  return (value || '').toString().trim();
}

function sanitizeId(value) {
  return (value || '').toString().trim();
}

function normalizeItem(rawItem, { status }) {
  if (!rawItem || !rawItem.id || !rawItem.category) {
    return null;
  }
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

async function batchWriteRequests(requests) {
  if (!requests.length) return;
  const chunks = [];
  for (let i = 0; i < requests.length; i += 25) {
    chunks.push(requests.slice(i, i + 25));
  }
  for (const chunk of chunks) {
    const params = {
      RequestItems: {
        [TABLE_NAME]: chunk,
      },
    };
    // Retry on unprocessed items
    let pending = params;
    do {
      const response = await dynamo.batchWrite(pending).promise();
      const unprocessed = response.UnprocessedItems || {};
      const nextChunk = unprocessed[TABLE_NAME];
      if (nextChunk && nextChunk.length) {
        pending = { RequestItems: { [TABLE_NAME]: nextChunk } };
      } else {
        pending = null;
      }
    } while (pending);
  }
}

async function handleSync(event, origin) {
  if (!TABLE_NAME) {
    throw new Error('TABLE_NAME environment variable is not configured.');
  }
  const payload = parseJsonBody(event);
  const upsertItems = [];
  const deleteItems = [];

  const published = Array.isArray(payload.published) ? payload.published : [];
  const overrides = Array.isArray(payload.overrides) ? payload.overrides : [];
  const drafts = Array.isArray(payload.drafts) ? payload.drafts : [];
  const removed = Array.isArray(payload.removed) ? payload.removed : [];

  published.forEach((item) => {
    const normalized = normalizeItem(item, { status: 'PUBLISHED' });
    if (normalized) {
      upsertItems.push({ PutRequest: { Item: normalized } });
    }
  });

  overrides.forEach((item) => {
    const normalized = normalizeItem(item, { status: 'PUBLISHED_OVERRIDE' });
    if (normalized) {
      upsertItems.push({ PutRequest: { Item: normalized } });
    }
  });

  drafts.forEach((item) => {
    const normalized = normalizeItem(item, { status: 'DRAFT' });
    if (normalized) {
      upsertItems.push({ PutRequest: { Item: normalized } });
    }
  });

  removed.forEach((item) => {
    if (!item || !item.category || !item.id) return;
    deleteItems.push({
      DeleteRequest: {
        Key: {
          Category: sanitizeCategory(item.category),
          ProductId: sanitizeId(item.id),
        },
      },
    });
  });

  await batchWriteRequests([...upsertItems, ...deleteItems]);

  return createResponse(200, {
    message: 'Inventory synchronised successfully.',
    upserted: upsertItems.length,
    removed: deleteItems.length,
  }, {}, origin);
}

async function handleList(event, origin) {
  if (!TABLE_NAME) {
    throw new Error('TABLE_NAME environment variable is not configured.');
  }
  const params = event.queryStringParameters || {};
  const category = sanitizeCategory(params.category);

  if (category) {
    const result = await dynamo
      .query({
        TableName: TABLE_NAME,
        KeyConditionExpression: '#c = :category',
        ExpressionAttributeNames: {
          '#c': 'Category',
        },
        ExpressionAttributeValues: {
          ':category': category,
        },
      })
      .promise();
    return createResponse(200, { items: result.Items || [] }, {}, origin);
  }

  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await dynamo
      .scan({
        TableName: TABLE_NAME,
        ExclusiveStartKey,
      })
      .promise();
    (result.Items || []).forEach((item) => items.push(item));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return createResponse(200, { items }, {}, origin);
}

async function handleGet(event, origin) {
  const category = sanitizeCategory(event.pathParameters?.category);
  const id = sanitizeId(event.pathParameters?.id);
  if (!TABLE_NAME) {
    throw new Error('TABLE_NAME environment variable is not configured.');
  }
  if (!category || !id) {
    return createResponse(400, { message: 'Both category and id are required.' }, {}, origin);
  }
  const result = await dynamo
    .get({
      TableName: TABLE_NAME,
      Key: {
        Category: category,
        ProductId: id,
      },
    })
    .promise();
  if (!result.Item) {
    return createResponse(404, { message: 'Product not found.' }, {}, origin);
  }
  return createResponse(200, result.Item, {}, origin);
}

async function handlePut(event, origin) {
  const category = sanitizeCategory(event.pathParameters?.category);
  const id = sanitizeId(event.pathParameters?.id);
  if (!TABLE_NAME) {
    throw new Error('TABLE_NAME environment variable is not configured.');
  }
  if (!category || !id) {
    return createResponse(400, { message: 'Both category and id are required.' }, {}, origin);
  }
  const payload = parseJsonBody(event);
  const normalized = normalizeItem(
    {
      ...payload,
      id,
      category,
    },
    { status: payload.status || 'PUBLISHED' }
  );
  if (!normalized) {
    return createResponse(400, { message: 'Invalid product payload.' }, {}, origin);
  }
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: normalized,
    })
    .promise();
  return createResponse(200, { message: 'Product saved.', item: normalized }, {}, origin);
}

async function handleDelete(event, origin) {
  const category = sanitizeCategory(event.pathParameters?.category);
  const id = sanitizeId(event.pathParameters?.id);
  if (!TABLE_NAME) {
    throw new Error('TABLE_NAME environment variable is not configured.');
  }
  if (!category || !id) {
    return createResponse(400, { message: 'Both category and id are required.' }, {}, origin);
  }
  await dynamo
    .delete({
      TableName: TABLE_NAME,
      Key: {
        Category: category,
        ProductId: id,
      },
    })
    .promise();
  return createResponse(200, { message: 'Product deleted.' }, {}, origin);
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function handleUploadUrl(event, origin) {
  if (!BUCKET_NAME) {
    throw new Error('BUCKET_NAME environment variable is not configured.');
  }
  const category = sanitizeCategory(event.pathParameters?.category);
  const id = sanitizeId(event.pathParameters?.id);
  if (!category || !id) {
    return createResponse(400, { message: 'Both category and id are required.' }, {}, origin);
  }
  const payload = parseJsonBody(event);
  const originalName = sanitizeFilename((payload.fileName || `${Date.now()}.jpg`).toString());
  const contentType = (payload.contentType || 'image/jpeg').toString();
  const key = `catalogue/${category}/${id}/${Date.now()}-${originalName}`;

  const uploadUrl = await s3.getSignedUrlPromise('putObject', {
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    Expires: URL_EXPIRY_SECONDS,
    ACL: 'public-read',
  });

  const region = process.env.AWS_REGION;
  const publicUrl = region
    ? `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`
    : `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;

  return createResponse(200, {
    uploadUrl,
    publicUrl,
    expiresIn: URL_EXPIRY_SECONDS,
  }, {}, origin);
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
    return createResponse(500, {
      message: 'Internal server error.',
      detail: error.message,
    }, {}, event.headers?.origin || event.headers?.Origin || '');
  }
};
