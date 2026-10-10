/**
 * ECOSILK ORDER RECEIVER — REVIEWED CANDIDATE, NOT DEPLOYED.
 * Sandbox testing only; not a production security sign-off.
 * Enable the Advanced Google Sheets service (identifier: Sheets).
 * Add PAYPAL_MERCHANT_ID and EXPECTED_CURRENCY=AUD to Script Properties.
 * Append Orders headers: Capture ID | Currency | PayPal Environment
 * Treat unsuccessful JSON responses as failures even though ContentService
 * cannot emit a custom non-2xx status. Independent reconciliation is required.
 *
 * ECOSILK ORDER RECEIVER — PROTOTYPE (build under KindPath Workspace,
 * migrate wholesale to Emily's own Workspace once she commits)
 *
 * WHAT THIS DOES
 * PayPal fires a webhook at this script's Web App URL whenever a
 * checkout completes. IMPORTANT DESIGN NOTE: Apps Script Web Apps
 * cannot read incoming HTTP headers, so PayPal's header-based webhook
 * signature verification is not implementable here. Instead, this
 * script treats the webhook purely as a trigger and independently
 * calls PayPal's own Orders API (using our own OAuth credentials) to
 * fetch the ground-truth order status before logging anything. We
 * never trust the webhook body's contents directly.
 *
 * SETUP (do this in order)
 * 1. Create a new Google Sheet with two tabs: "Inventory" and "Orders"
 *    (see column headers below — row 1 of each tab).
 * 2. In the Sheet: Extensions > Apps Script. Paste this file in.
 * 3. Project Settings > Script Properties — add:
 *      SHEET_ID, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV
 *    (Never hardcode the secret in the script body itself.)
 * 4. Deploy > New deployment > Web app.
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the resulting URL.
 * 5. In PayPal Developer Dashboard (SANDBOX app while prototyping),
 *    add a webhook pointing at that URL, subscribed to at minimum:
 *    CHECKOUT.ORDER.APPROVED and PAYMENT.CAPTURE.COMPLETED.
 * 6. Leave PAYPAL_ENV = 'sandbox' until Emily's own account is live.
 *    No real money or real customer data should flow through this
 *    prototype until that switch happens.
 *
 * INVENTORY TAB — row 1 headers:
 *   SKU | Name | Variant | Price | Stock
 *
 * ORDERS TAB — row 1 headers:
 *   Order ID | Date | Items (SKU x qty) | Customer Name | Email |
 *   Address | Total | Status | Tracking
 */

// ---- CONFIG ---------------------------------------------------------
// All pulled from Script Properties (Project Settings > Script Properties)
// rather than hardcoded — see setup step 3 above.
function cfg_(key) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  if (!val) throw new Error(`Missing Script Property: ${key}`);
  return val;
}
function sheetId_() { return cfg_('SHEET_ID'); }
function paypalEnv_() {
  const env = PropertiesService.getScriptProperties().getProperty('PAYPAL_ENV') || 'sandbox';
  if (env !== 'sandbox') throw new Error('Reviewed candidate is sandbox-only');
  return env;
}
function paypalApiBase_() {
  return paypalEnv_() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

// ---- ENTRY POINT ------------------------------------------------------
function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string' ||
        e.postData.contents.length > 100000) throw new Error('Invalid webhook body');
    const event = JSON.parse(e.postData.contents);

    // Orders forwarded by the Ecosilk Worker after it verified a Stripe webhook
    // signature. Authenticated by a shared secret; Stripe test mode only.
    if (event && event.source === 'ecosilk-worker') {
      assertWorkerToken_(event.token);
      const workerOrder = validateWorkerOrder_(event.order);
      lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) throw new Error('Receiver busy; reconcile this order');
      if (orderAlreadyLogged_(workerOrder.id)) return respond_('duplicate_ignored');
      recordWorkerOrder_(workerOrder);
      return respond_('ok');
    }

    const relevant = ['PAYMENT.CAPTURE.COMPLETED', 'CHECKOUT.ORDER.APPROVED'];

    if (relevant.indexOf(event.event_type) === -1) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ignored' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const orderId = extractOrderId_(event);
    if (!orderId) {
      logError_('Could not extract order id from webhook payload');
      return respond_('error');
    }

    // Ground-truth check: never trust the webhook body directly.
    // Independently ask PayPal what this order's real status is.
    const verifiedOrder = fetchOrderFromPayPal_(orderId);

    if (!verifiedOrder) {
      logError_(`Order ${orderId} — could not verify via PayPal API`);
      return respond_('error');
    }

    if (verifiedOrder.status !== 'COMPLETED') {
      // Legitimate case (e.g. CHECKOUT.ORDER.APPROVED fires before capture) —
      // not an error, just not ready to log yet.
      return respond_('not_completed');
    }

    // A script-wide lock covers duplicate read AND the single atomic write.
    // Other scripts/manual edits do not obey this lock; use one stock writer.
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('Receiver busy; reconcile this order');
    if (orderAlreadyLogged_(verifiedOrder.id)) {
      return respond_('duplicate_ignored');
    }

    recordOrder(verifiedOrder);
    return respond_('ok');

  } catch (err) {
    logError_(err);
    return respond_('error');
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function respond_(status) {
  return ContentService.createTextOutput(JSON.stringify({ status }))
    .setMimeType(ContentService.MimeType.JSON);
}

function extractOrderId_(event) {
  const resource = event.resource || {};
  // CHECKOUT.ORDER.APPROVED: resource.id is the order id.
  // PAYMENT.CAPTURE.COMPLETED: resource.id is the capture id — the order id
  // lives one level up, in supplementary_data or links; simplest reliable
  // path is resource.supplementary_data.related_ids.order_id when present,
  // falling back to resource.id (covers the ORDER.APPROVED case).
  const candidate = event.event_type === 'CHECKOUT.ORDER.APPROVED'
    ? resource.id
    : resource.supplementary_data &&
      resource.supplementary_data.related_ids &&
      resource.supplementary_data.related_ids.order_id;
  // Never send a capture ID to the Orders API as a fallback.
  return typeof candidate === 'string' && /^[A-Za-z0-9]{5,64}$/.test(candidate)
    ? candidate : null;
}

// ---- PAYPAL API (server-side, authenticated with our own credentials) ------
function getAccessToken_() {
  const url = `${paypalApiBase_()}/v1/oauth2/token`;
  const creds = Utilities.base64Encode(`${cfg_('PAYPAL_CLIENT_ID')}:${cfg_('PAYPAL_CLIENT_SECRET')}`);
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: `Basic ${creds}` },
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=client_credentials',
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    logError_(`OAuth token request failed: HTTP ${resp.getResponseCode()}`);
    return null;
  }
  return JSON.parse(resp.getContentText()).access_token;
}

function fetchOrderFromPayPal_(orderId) {
  const token = getAccessToken_();
  if (!token) return null;
  const resp = UrlFetchApp.fetch(`${paypalApiBase_()}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    logError_(`Order fetch failed for ${orderId}: HTTP ${resp.getResponseCode()}`);
    return null;
  }
  const order = JSON.parse(resp.getContentText());
  if (order.id !== orderId) throw new Error('Fetched order ID mismatch');
  return order;
}

// ---- SHEET LOGIC ---------------------------------------------------------
function orderAlreadyLogged_(orderId) {
  const ss = SpreadsheetApp.openById(sheetId_());
  const ordersSheet = ss.getSheetByName('Orders');
  if (!ordersSheet) throw new Error('Missing Orders tab');
  assertHeaders_(ordersSheet, ['Order ID', 'Date', 'Items (SKU x qty)',
    'Customer Name', 'Email', 'Address', 'Total', 'Status', 'Tracking',
    'Capture ID', 'Currency', 'PayPal Environment']);
  const last = ordersSheet.getLastRow();
  const ids = last > 1 ? ordersSheet.getRange(2, 1, last - 1, 1).getValues().flat() : [];
  return ids.indexOf(orderId) !== -1;
}

function recordOrder(verifiedOrder) {
  const ss = SpreadsheetApp.openById(sheetId_());
  const ordersSheet = ss.getSheetByName('Orders');
  const inventorySheet = ss.getSheetByName('Inventory');

  if (!ordersSheet || !inventorySheet) throw new Error('Missing Orders or Inventory tab');
  assertHeaders_(inventorySheet, ['SKU', 'Name', 'Variant', 'Price', 'Stock']);
  if (typeof Sheets === 'undefined') throw new Error('Enable Advanced Google Sheets service');
  if (verifiedOrder.status !== 'COMPLETED' ||
      !Array.isArray(verifiedOrder.purchase_units) ||
      verifiedOrder.purchase_units.length !== 1) throw new Error('Expected one completed purchase unit');
  const pu = verifiedOrder.purchase_units[0];
  const expectedCurrency = PropertiesService.getScriptProperties().getProperty('EXPECTED_CURRENCY') || 'AUD';
  const merchantId = cfg_('PAYPAL_MERCHANT_ID');
  if (!pu.payee || pu.payee.merchant_id !== merchantId) throw new Error('Payee mismatch');
  if (!pu.amount || pu.amount.currency_code !== expectedCurrency) throw new Error('Currency mismatch');
  const totalCents = cents_(pu.amount.value);
  if (totalCents <= 0) throw new Error('Invalid order total');
  const captures = pu.payments && pu.payments.captures;
  if (!Array.isArray(captures) || captures.length !== 1 ||
      captures[0].status !== 'COMPLETED') throw new Error('Expected one completed capture');
  const capture = captures[0];
  if (!capture.id || !capture.amount || capture.amount.currency_code !== expectedCurrency ||
      cents_(capture.amount.value) !== totalCents) throw new Error('Capture amount mismatch');
  const amount = totalCents / 100;
  const payer = verifiedOrder.payer || {};
  const customerName = payer.name
    ? `${payer.name.given_name || ''} ${payer.name.surname || ''}`.trim()
    : (pu.shipping && pu.shipping.name ? pu.shipping.name.full_name : '');
  const email = payer.email_address || '';

  const items = pu.items || [];
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('Missing or excessive items');
  const inventory = loadInventory_(inventorySheet);
  const quantities = {};
  let itemCents = 0;
  items.forEach(item => {
    const sku = String(item.sku || '');
    const qty = Number(item.quantity);
    if (!inventory[sku]) throw new Error(`Unknown SKU: ${sku}`);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000) throw new Error('Invalid quantity');
    if (!item.unit_amount || item.unit_amount.currency_code !== expectedCurrency ||
        cents_(item.unit_amount.value) !== inventory[sku].price) throw new Error(`Price mismatch: ${sku}`);
    quantities[sku] = (quantities[sku] || 0) + qty;
    itemCents += inventory[sku].price * qty;
  });
  const breakdown = pu.amount.breakdown;
  if (!breakdown || !breakdown.item_total ||
      breakdown.item_total.currency_code !== expectedCurrency ||
      cents_(breakdown.item_total.value) !== itemCents) throw new Error('Item total mismatch');
  let calculated = itemCents;
  ['tax_total', 'shipping', 'handling', 'insurance', 'shipping_discount', 'discount'].forEach(key => {
    if (!breakdown[key]) return;
    if (breakdown[key].currency_code !== expectedCurrency) throw new Error('Breakdown currency mismatch');
    const value = cents_(breakdown[key].value);
    calculated += /discount/.test(key) ? -value : value;
  });
  if (calculated !== totalCents) throw new Error('Total arithmetic mismatch');
  // Arithmetic is checked, but discount entitlement/shipping policy is NOT.
  // Production checkout must set trusted totals on the server.
  const itemsSummary = items.map(i => `${i.sku || i.name} x${i.quantity}`).join(', ');

  const address = pu.shipping && pu.shipping.address
    ? [pu.shipping.address.address_line_1, pu.shipping.address.address_line_2,
       pu.shipping.address.admin_area_2, pu.shipping.address.admin_area_1,
       pu.shipping.address.postal_code, pu.shipping.address.country_code]
        .filter(Boolean).join(', ')
    : '';

  const rowValues = [
    verifiedOrder.id,
    new Date().toISOString(),
    itemsSummary,
    customerName,
    email,
    address,
    amount,
    'PAID / awaiting fulfilment',
    '', // tracking — filled in manually once packed/shipped
    capture.id, expectedCurrency, paypalEnv_()
  ];
  commitLedger_(ordersSheet, inventorySheet, inventory, quantities, rowValues);

  const notifyEmail = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (notifyEmail) {
    try {
      MailApp.sendEmail(notifyEmail, `[SANDBOX] New order ${verifiedOrder.id}`, itemsSummary);
    } catch (err) {
      // Email failure cannot roll back a successfully recorded order.
      logError_(`Order ${verifiedOrder.id} recorded; notification failed`);
    }
  }
}

// ---- STRIPE ORDERS (forwarded by the Worker) ------------------------------
function assertWorkerToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('ORDER_SINK_TOKEN');
  if (!expected || expected.length < 32) throw new Error('ORDER_SINK_TOKEN missing or too short');
  const given = typeof token === 'string' ? token : '';
  let diff = given.length === expected.length ? 0 : 1;
  for (let i = 0; i < expected.length; i++) {
    diff |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) throw new Error('Unauthorised worker order');
}

function validateWorkerOrder_(order) {
  const expectedCurrency = PropertiesService.getScriptProperties().getProperty('EXPECTED_CURRENCY') || 'AUD';
  if (!order || order.livemode !== false) throw new Error('Test-mode orders only');
  if (typeof order.id !== 'string' || !/^cs_test_[A-Za-z0-9_]{8,200}$/.test(order.id)) throw new Error('Invalid session ID');
  if (typeof order.paymentId !== 'string' || !/^pi_[A-Za-z0-9_]{8,200}$/.test(order.paymentId)) throw new Error('Invalid payment ID');
  if (order.currency !== expectedCurrency) throw new Error('Currency mismatch');
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 100) throw new Error('Missing or excessive items');
  ['totalCents', 'shippingCents', 'discountCents'].forEach(key => {
    if (!Number.isSafeInteger(order[key]) || order[key] < 0) throw new Error(`Invalid ${key}`);
  });
  if (order.totalCents <= 0) throw new Error('Invalid order total');
  return order;
}

function recordWorkerOrder_(order) {
  const ss = SpreadsheetApp.openById(sheetId_());
  const ordersSheet = ss.getSheetByName('Orders');
  const inventorySheet = ss.getSheetByName('Inventory');
  if (!ordersSheet || !inventorySheet) throw new Error('Missing Orders or Inventory tab');
  assertHeaders_(ordersSheet, ['Order ID', 'Date', 'Items (SKU x qty)',
    'Customer Name', 'Email', 'Address', 'Total', 'Status', 'Tracking',
    'Capture ID', 'Currency', 'PayPal Environment']);
  assertHeaders_(inventorySheet, ['SKU', 'Name', 'Variant', 'Price', 'Stock']);
  if (typeof Sheets === 'undefined') throw new Error('Enable Advanced Google Sheets service');
  const inventory = loadInventory_(inventorySheet);
  const quantities = {};
  let itemCents = 0;
  order.items.forEach(item => {
    const sku = String(item.sku || '');
    if (!inventory[sku]) throw new Error(`Unknown SKU: ${sku}`);
    if (!Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 1000) throw new Error('Invalid quantity');
    if (item.unitCents !== inventory[sku].price) throw new Error(`Price mismatch: ${sku}`);
    quantities[sku] = (quantities[sku] || 0) + item.qty;
    itemCents += inventory[sku].price * item.qty;
  });
  if (itemCents - order.discountCents + order.shippingCents !== order.totalCents)
    throw new Error('Total arithmetic mismatch');
  const customer = order.customer || {};
  const addr = order.address || {};
  const itemsSummary = order.items.map(i => `${i.sku} x${i.qty}`).join(', ');
  const address = [addr.line1, addr.line2, addr.city, addr.state, addr.postcode, addr.country]
    .filter(Boolean).join(', ');
  const rowValues = [order.id, new Date().toISOString(), itemsSummary,
    customer.name || '', customer.email || '', address, order.totalCents / 100,
    'PAID / awaiting fulfilment', '', order.paymentId, order.currency, 'stripe-test'];
  commitLedger_(ordersSheet, inventorySheet, inventory, quantities, rowValues);

  const notifyEmail = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (notifyEmail) {
    try {
      MailApp.sendEmail(notifyEmail, `[STRIPE TEST] New order ${order.id}`, itemsSummary);
    } catch (err) {
      logError_(`Order ${order.id} recorded; notification failed`);
    }
  }
}

// ---- SHARED LEDGER HELPERS (used by every payment source) -----------------
function loadInventory_(inventorySheet) {
  const data = inventorySheet.getDataRange().getValues();
  const inventory = {};
  for (let row = 1; row < data.length; row++) {
    const sku = String(data[row][0] || '').trim();
    if (!sku) continue;
    if (inventory[sku]) throw new Error(`Duplicate inventory SKU: ${sku}`);
    const stock = Number(data[row][4]);
    if (data[row][4] === '' || !Number.isSafeInteger(stock) || stock < 0)
      throw new Error(`Invalid stock: ${sku}`);
    inventory[sku] = { row, stock, price: cents_(String(data[row][3])) };
  }
  return inventory;
}

function commitLedger_(ordersSheet, inventorySheet, inventory, quantities, rowValues) {
  const requests = [];
  Object.keys(quantities).forEach(sku => {
    const item = inventory[sku];
    if (quantities[sku] > item.stock) throw new Error(`Insufficient stock: ${sku}; payment requires review`);
    requests.push({ updateCells: {
      range: { sheetId: inventorySheet.getSheetId(), startRowIndex: item.row,
        endRowIndex: item.row + 1, startColumnIndex: 4, endColumnIndex: 5 },
      rows: [{ values: [{ userEnteredValue: { numberValue: item.stock - quantities[sku] } }] }],
      fields: 'userEnteredValue'
    } });
  });
  // Typed stringValue prevents payer-supplied text becoming a Sheets formula.
  requests.push({ appendCells: { sheetId: ordersSheet.getSheetId(),
    rows: [{ values: rowValues.map(value => ({ userEnteredValue: typeof value === 'number'
      ? { numberValue: value } : { stringValue: String(value) } })) }],
    fields: 'userEnteredValue' } });
  // Atomic within this Sheets API request: order row and all stock changes.
  Sheets.Spreadsheets.batchUpdate({ requests }, sheetId_());
}

function assertHeaders_(sheet, expected) {
  const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  if (expected.some((header, i) => actual[i] !== header))
    throw new Error(`Incorrect headers in ${sheet.getName()}`);
}

function cents_(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Invalid monetary value');
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error('Monetary value out of range');
  return cents;
}

// Run from the Apps Script editor before updating the webhook deployment.
// Read-only: checks setup and credentials, without logging credential values,
// creating orders, changing inventory or sending notification emails.
function checkSandboxReceiverSetup() {
  paypalEnv_();
  cfg_('PAYPAL_CLIENT_ID');
  cfg_('PAYPAL_CLIENT_SECRET');
  cfg_('PAYPAL_MERCHANT_ID');
  const currency = PropertiesService.getScriptProperties().getProperty('EXPECTED_CURRENCY') || 'AUD';
  if (currency !== 'AUD') throw new Error('This trial checkout expects AUD');
  const ss = SpreadsheetApp.openById(sheetId_());
  const inventory = ss.getSheetByName('Inventory');
  const orders = ss.getSheetByName('Orders');
  if (!inventory || !orders) throw new Error('Missing Inventory or Orders tab');
  assertHeaders_(inventory, ['SKU', 'Name', 'Variant', 'Price', 'Stock']);
  assertHeaders_(orders, ['Order ID', 'Date', 'Items (SKU x qty)', 'Customer Name',
    'Email', 'Address', 'Total', 'Status', 'Tracking', 'Capture ID', 'Currency',
    'PayPal Environment']);
  if (typeof Sheets === 'undefined') throw new Error('Enable Advanced Google Sheets service');
  if (!getAccessToken_()) throw new Error('PayPal sandbox OAuth check failed');
  const result = { ready: true, environment: 'sandbox', currency: 'AUD',
    ordersTabReady: true, inventoryTabReady: true, paypalCredentialsWorking: true };
  console.log(JSON.stringify(result));
  return result;
}

function logError_(err) {
  // Minimal error visibility while prototyping — check Apps Script
  // executions log (View > Executions) for full detail.
  console.error(err);
}
