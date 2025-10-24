'use strict';

const AWS = require('aws-sdk');

const ses = new AWS.SES({ apiVersion: '2010-12-01', region: process.env.SES_REGION || process.env.AWS_REGION });

const TURNSTILE_SECRET_KEY = (process.env.TURNSTILE_SECRET_KEY || '').toString().trim();
const THROTTLE_MAX_REQUESTS = Number(process.env.THROTTLE_MAX_REQUESTS || process.env.THROTTLE_MAX || 5);
const THROTTLE_WINDOW_SECONDS = Number(process.env.THROTTLE_WINDOW_SECONDS || process.env.THROTTLE_WINDOW || 60);
const THROTTLE_WINDOW_MS = Math.max(THROTTLE_WINDOW_SECONDS, 1) * 1000;
const MAX_PROOF_SIZE_BYTES = Number(process.env.MAX_PROOF_SIZE_BYTES || 5 * 1024 * 1024);

const recentRequests = new Map();

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const ORDER_RECIPIENT = (process.env.ORDER_RECIPIENT || '').trim();
const ORDER_SENDER = (process.env.ORDER_SENDER || ORDER_RECIPIENT).trim();
const SEND_CUSTOMER_COPY = (process.env.ORDER_SEND_CUSTOMER_COPY || '').toString().toLowerCase() === 'true';

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
      'Access-Control-Allow-Methods': 'OPTIONS,POST',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) {
    return {};
  }
  try {
    return JSON.parse(event.body);
  } catch (error) {
    throw new Error('Invalid JSON payload supplied.');
  }
}

function sanitize(value) {
  return (value || '').toString().trim();
}

function sanitizeFilename(filename) {
  const fallback = 'attachment';
  const cleaned = (filename || '').toString().replace(/[^a-z0-9._-]+/gi, '-').replace(/-{2,}/g, '-');
  const sliced = cleaned.slice(0, 120);
  return sliced || fallback;
}

function formatCurrency(amount) {
  const safe = Number(amount) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(safe);
}

function buildItemRows(items) {
  if (!Array.isArray(items) || !items.length) {
    return { html: '<p>No line items were provided.</p>', text: 'No line items were provided.' };
  }

  const rowsHtml = items
    .map((item) => {
      const name = sanitize(item.name);
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const total = Number(item.total) || unitPrice * quantity;
      const category = sanitize(item.category);
      return `
        <tr>
          <td style="padding:8px 12px;border:1px solid #ececec;">${name || 'Item'}</td>
          <td style="padding:8px 12px;border:1px solid #ececec;">${category || '—'}</td>
          <td style="padding:8px 12px;border:1px solid #ececec;">${quantity}</td>
          <td style="padding:8px 12px;border:1px solid #ececec;">${formatCurrency(unitPrice)}</td>
          <td style="padding:8px 12px;border:1px solid #ececec;">${formatCurrency(total)}</td>
        </tr>
      `;
    })
    .join('');

  const rowsText = items
    .map((item, index) => {
      const name = sanitize(item.name) || `Item ${index + 1}`;
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const total = Number(item.total) || unitPrice * quantity;
      const category = sanitize(item.category);
      return `${name}${category ? ` (${category})` : ''}\n  Qty: ${quantity}\n  Unit: ${formatCurrency(unitPrice)}\n  Line total: ${formatCurrency(total)}`;
    })
    .join('\n\n');

  const html = `
    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:10px 12px;border:1px solid #ececec;text-align:left;">Item</th>
          <th style="padding:10px 12px;border:1px solid #ececec;text-align:left;">Category</th>
          <th style="padding:10px 12px;border:1px solid #ececec;text-align:left;">Qty</th>
          <th style="padding:10px 12px;border:1px solid #ececec;text-align:left;">Unit Price</th>
          <th style="padding:10px 12px;border:1px solid #ececec;text-align:left;">Line Total</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  return { html, text: rowsText };
}

function buildEmailContent(order) {
  const orderId = sanitize(order.id) || `order-${Date.now()}`;
  const createdAt = sanitize(order.createdAt) || new Date().toISOString();
  const customer = order.customer || {};
  const delivery = order.delivery || {};
  const notes = sanitize(order.notes);
  const total = Number(order.total) || 0;

  const items = buildItemRows(order.items || []);

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111;line-height:1.5;">
      <h2 style="margin-bottom:4px;">New storefront order received</h2>
      <p style="margin:0 0 16px;">A new order was submitted via the Veyron storefront. Review the details below.</p>
      <p style="margin:0 0 8px;"><strong>Order ID:</strong> ${orderId}</p>
      <p style="margin:0 0 8px;"><strong>Submitted:</strong> ${createdAt}</p>
      <h3 style="margin:24px 0 8px;font-size:17px;">Customer</h3>
      <p style="margin:0 0 4px;"><strong>Name:</strong> ${sanitize(customer.name) || '—'}</p>
      <p style="margin:0 0 4px;"><strong>Phone:</strong> ${sanitize(customer.phone) || '—'}</p>
      <p style="margin:0 0 16px;"><strong>Email:</strong> ${sanitize(customer.email) || '—'}</p>
      <h3 style="margin:24px 0 8px;font-size:17px;">Delivery</h3>
      <p style="margin:0 0 4px;"><strong>Address:</strong> ${sanitize(delivery.address) || '—'}</p>
      <p style="margin:0 0 4px;"><strong>Date:</strong> ${sanitize(delivery.date) || '—'}</p>
      <p style="margin:0 0 16px;"><strong>Time:</strong> ${sanitize(delivery.time) || '—'}</p>
      <p style="margin:0 0 16px;"><strong>Payment:</strong> ${sanitize(order.payment) || '—'}${
        order.paymentProof || order.hasPaymentProof ? ' (proof attached)' : ''
      }</p>
      ${notes ? `<p style="margin:0 0 16px;"><strong>Notes:</strong> ${notes}</p>` : ''}
      ${items.html}
      <p style="margin:16px 0 0;font-weight:600;font-size:16px;">Order Total: ${formatCurrency(total)}</p>
    </div>
  `;

  const textLines = [
    'New storefront order received',
    `Order ID: ${orderId}`,
    `Submitted: ${createdAt}`,
    '',
    'Customer',
    `  Name: ${sanitize(customer.name) || '—'}`,
    `  Phone: ${sanitize(customer.phone) || '—'}`,
    `  Email: ${sanitize(customer.email) || '—'}`,
    '',
    'Delivery',
    `  Address: ${sanitize(delivery.address) || '—'}`,
    `  Date: ${sanitize(delivery.date) || '—'}`,
    `  Time: ${sanitize(delivery.time) || '—'}`,
    '',
    `Payment: ${sanitize(order.payment) || '—'}`,
  ];

  if (notes) {
    textLines.push('', `Notes: ${notes}`);
  }

  textLines.push('', 'Items:', items.text, '', `Order Total: ${formatCurrency(total)}`);

  if (order.paymentProof || order.hasPaymentProof) {
    textLines.push('', 'Proof of payment attached for review.');
  }

  return { orderId, html, text: textLines.join('\n') };
}

function encodeBase64(value) {
  return value.replace(/\s+/g, '').replace(/(.{76})/g, '$1\n');
}

function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return null;
  }
  if (!dataUrl.startsWith('data:')) {
    return null;
  }
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    return null;
  }
  const meta = dataUrl.slice(5, commaIndex);
  const base64Segment = dataUrl.slice(commaIndex + 1).replace(/\s/g, '');
  const isBase64 = /;base64$/i.test(meta);
  const contentType = meta.replace(/;base64$/i, '') || 'application/octet-stream';
  const base64Data = isBase64 ? base64Segment : Buffer.from(base64Segment, 'utf8').toString('base64');
  return { contentType, base64Data };
}

function buildRawEmail({ orderId, html, text, to, cc = [], attachments = [] }) {
  const safeFrom = ORDER_SENDER;
  const safeTo = to.join(', ');
  const safeCc = cc.length ? cc.join(', ') : '';
  const mixedBoundary = `----=_VeyronMixed_${Date.now()}`;
  const alternativeBoundary = `${mixedBoundary}_alt`;

  let headers = `From: ${safeFrom}\nTo: ${safeTo}\nSubject: New Veyron order: ${orderId}\nMIME-Version: 1.0\n`;
  if (safeCc) {
    headers += `Cc: ${safeCc}\n`;
  }
  headers += `Content-Type: multipart/mixed; boundary="${mixedBoundary}"\n`;

  let body = '';
  body += `\n--${mixedBoundary}\n`;
  body += `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\n\n`;
  body += `--${alternativeBoundary}\n`;
  body += 'Content-Type: text/plain; charset="UTF-8"\n';
  body += 'Content-Transfer-Encoding: 7bit\n\n';
  body += `${text}\n\n`;
  body += `--${alternativeBoundary}\n`;
  body += 'Content-Type: text/html; charset="UTF-8"\n';
  body += 'Content-Transfer-Encoding: 7bit\n\n';
  body += `${html}\n\n`;
  body += `--${alternativeBoundary}--\n`;

  attachments.forEach((attachment) => {
    body += `\n--${mixedBoundary}\n`;
    body += `Content-Type: ${attachment.contentType}; name="${attachment.filename}"\n`;
    body += 'Content-Transfer-Encoding: base64\n';
    body += `Content-Disposition: attachment; filename="${attachment.filename}"\n\n`;
    body += `${encodeBase64(attachment.base64Data)}\n`;
  });

  body += `\n--${mixedBoundary}--`;
  return headers + body;
}

async function sendEmail(order) {
  if (!ORDER_RECIPIENT || !ORDER_SENDER) {
    throw new Error('Order email routing is not configured.');
  }

  const { orderId, html, text } = buildEmailContent(order);
  const to = [ORDER_RECIPIENT];
  const ccAddresses = [];

  if (SEND_CUSTOMER_COPY && order?.customer?.email) {
    const ccValue = sanitize(order.customer.email);
    if (ccValue) {
      ccAddresses.push(ccValue);
    }
  }

  const attachments = [];
  if (order.paymentProof?.dataUrl) {
    const parsed = parseDataUrl(order.paymentProof.dataUrl);
    if (!parsed) {
      throw new Error('Invalid proof of payment attachment supplied.');
    }
    const buffer = Buffer.from(parsed.base64Data, 'base64');
    if (Number.isFinite(MAX_PROOF_SIZE_BYTES) && MAX_PROOF_SIZE_BYTES > 0 && buffer.length > MAX_PROOF_SIZE_BYTES) {
      const error = new Error('Proof of payment file exceeds the allowed size.');
      error.statusCode = 400;
      throw error;
    }
    attachments.push({
      filename: sanitizeFilename(order.paymentProof.name || `payment-proof-${orderId}`),
      contentType: parsed.contentType,
      base64Data: buffer.toString('base64'),
    });
  }

  const rawEmail = buildRawEmail({
    orderId,
    html,
    text,
    to,
    cc: ccAddresses,
    attachments,
  });

  await ses
    .sendRawEmail({
      RawMessage: {
        Data: Buffer.from(rawEmail, 'utf-8'),
      },
    })
    .promise();
}

function getClientIp(event) {
  const forwarded = sanitize(event.headers?.['x-forwarded-for']);
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return sanitize(event.requestContext?.identity?.sourceIp) || 'unknown';
}

function recordRequest(identifier) {
  if (!THROTTLE_MAX_REQUESTS || THROTTLE_MAX_REQUESTS <= 0) {
    return;
  }
  const now = Date.now();
  const entries = recentRequests.get(identifier) || [];
  const windowStart = now - THROTTLE_WINDOW_MS;
  const filtered = entries.filter((timestamp) => timestamp > windowStart);
  filtered.push(now);
  recentRequests.set(identifier, filtered);
  if (filtered.length > THROTTLE_MAX_REQUESTS) {
    const error = new Error('Too many orders submitted. Please wait before trying again.');
    error.statusCode = 429;
    error.headers = { 'Retry-After': String(Math.ceil(THROTTLE_WINDOW_MS / 1000)) };
    throw error;
  }
}

async function verifyTurnstile(token, remoteIp) {
  if (!TURNSTILE_SECRET_KEY) {
    return;
  }
  const challenge = sanitize(token);
  if (!challenge) {
    const error = new Error('Security verification is required before submitting an order.');
    error.statusCode = 400;
    throw error;
  }

  const params = new URLSearchParams();
  params.append('secret', TURNSTILE_SECRET_KEY);
  params.append('response', challenge);
  if (remoteIp && remoteIp !== 'unknown') {
    params.append('remoteip', remoteIp);
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: params,
  });

  if (!response.ok) {
    const error = new Error('Security verification failed. Please try again.');
    error.statusCode = 400;
    throw error;
  }

  const payload = await response.json();
  if (!payload.success) {
    const error = new Error('Security verification failed. Please refresh and try again.');
    error.statusCode = 400;
    throw error;
  }
}

async function handlePost(event, origin) {
  const payload = parseBody(event);
  const order = payload.order || payload;

  if (!order || typeof order !== 'object') {
    return createResponse(400, { message: 'Order payload is required.' }, {}, origin);
  }

  const remoteIp = getClientIp(event);
  recordRequest(remoteIp || 'anonymous');

  await verifyTurnstile(payload.challengeToken || payload.turnstileToken || payload['cf-turnstile-response'], remoteIp);

  const requiredFields = [
    sanitize(order.customer?.name),
    sanitize(order.customer?.phone),
    sanitize(order.delivery?.address),
    sanitize(order.delivery?.date),
    sanitize(order.delivery?.time),
    sanitize(order.payment),
  ];

  if (requiredFields.some((value) => !value)) {
    return createResponse(400, {
      message: 'Missing required order fields. Ensure contact and delivery details are provided.',
    }, {}, origin);
  }

  if (order.paymentProof && !order.hasPaymentProof) {
    order.hasPaymentProof = true;
  }

  await sendEmail(order);

  return createResponse(200, { message: 'Order forwarded to operations successfully.' }, {}, origin);
}

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin;
  const method = (event?.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return createResponse(200, { message: 'OK' }, {}, origin);
  }

  if (method !== 'POST') {
    return createResponse(405, { message: 'Method not allowed.' }, {}, origin);
  }

  try {
    return await handlePost(event, origin);
  } catch (error) {
    console.error('Failed to process order submission', error);
    const statusCode = error.statusCode || 500;
    const headers = { ...(error.headers || {}) };
    const message =
      statusCode >= 400 && statusCode < 500
        ? error.message || 'Unable to process order submission.'
        : 'Failed to forward order. Please try again later.';
    return createResponse(statusCode, { message }, headers, origin);
  }
};
