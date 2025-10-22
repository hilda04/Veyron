'use strict';

const AWS = require('aws-sdk');

const ses = new AWS.SES({ apiVersion: '2010-12-01', region: process.env.SES_REGION || process.env.AWS_REGION });

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const ORDER_RECIPIENT = (process.env.ORDER_RECIPIENT || '').trim();
const ORDER_SENDER = (process.env.ORDER_SENDER || ORDER_RECIPIENT).trim();
const SEND_CUSTOMER_COPY = (process.env.ORDER_SEND_CUSTOMER_COPY || '').toString().toLowerCase() === 'true';

function normalizeOrigin(value) {
  if (!value) return '';
  const trimmed = value.toString().trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    return trimmed.replace(/\/*$/, '');
  }
}

function resolveOrigin(requestOrigin = '') {
  if (!ALLOWED_ORIGINS || ALLOWED_ORIGINS === '*') {
    return '*';
  }
  const allowed = ALLOWED_ORIGINS.split(',')
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
  if (!allowed.length) {
    return '*';
  }
  const normalisedRequest = normalizeOrigin(requestOrigin);
  if (normalisedRequest && allowed.includes(normalisedRequest)) {
    return normalisedRequest;
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
      <p style="margin:0 0 16px;"><strong>Payment:</strong> ${sanitize(order.payment) || '—'}</p>
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

  return { orderId, html, text: textLines.join('\n') };
}

async function sendEmail(order) {
  if (!ORDER_RECIPIENT || !ORDER_SENDER) {
    throw new Error('Order email routing is not configured.');
  }

  const { orderId, html, text } = buildEmailContent(order);
  const destination = {
    ToAddresses: [ORDER_RECIPIENT],
  };

  if (SEND_CUSTOMER_COPY && order?.customer?.email) {
    const cc = sanitize(order.customer.email);
    if (cc) {
      destination.CcAddresses = [cc];
    }
  }

  const params = {
    Source: ORDER_SENDER,
    Destination: destination,
    Message: {
      Subject: {
        Data: `New Veyron order: ${orderId}`,
      },
      Body: {
        Html: {
          Data: html,
        },
        Text: {
          Data: text,
        },
      },
    },
  };

  await ses.sendEmail(params).promise();
}

async function handlePost(event, origin) {
  const payload = parseBody(event);
  const order = payload.order || payload;

  if (!order || typeof order !== 'object') {
    return createResponse(400, { message: 'Order payload is required.' }, {}, origin);
  }

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
    return createResponse(500, { message: 'Failed to forward order. Please try again later.' }, {}, origin);
  }
};
