// Offline tests only. No Google, PayPal, email or inventory network calls.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/ecosilk-order-receiver-reviewed.gs', 'utf8');
const headers = ['Order ID', 'Date', 'Items (SKU x qty)', 'Customer Name', 'Email',
  'Address', 'Total', 'Status', 'Tracking', 'Capture ID', 'Currency', 'PayPal Environment'];
function setup() {
  const inventory = [['SKU', 'Name', 'Variant', 'Price', 'Stock'], ['ESG', 'Shopping Bag', 'Sea Green', 12.99, 20]];
  const rows = [headers.slice()];
  const state = { inventory, rows, writes: 0, failBatch: false, lockBusy: false, released: 0 };
  function sheet(name, data, id) {
    return { getName: () => name, getSheetId: () => id, getLastRow: () => data.length,
      getDataRange: () => ({ getValues: () => data.map(row => row.slice()) }),
      getRange: (r, c, count, width) => ({ getValues: () => data.slice(r - 1, r - 1 + count)
        .map(row => row.slice(c - 1, c - 1 + width)) }) };
  }
  const sheets = { Inventory: sheet('Inventory', inventory, 1), Orders: sheet('Orders', rows, 2) };
  const props = { SHEET_ID: 'sheet', PAYPAL_ENV: 'sandbox', PAYPAL_MERCHANT_ID: 'MERCHANT', EXPECTED_CURRENCY: 'AUD' };
  const context = {
    console: { error: () => {}, log: () => {} }, Date, JSON, Math, Number, String, Object, Array,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props[key] }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => sheets[name] }) },
    LockService: { getScriptLock: () => { let held = false; return {
      tryLock: () => (held = !state.lockBusy), hasLock: () => held,
      releaseLock: () => { held = false; state.released++; }
    }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text =>
      ({ setMimeType: () => JSON.parse(text) }) },
    MailApp: { sendEmail: () => { throw new Error('simulated mail failure'); } },
    Sheets: { Spreadsheets: { batchUpdate: body => {
      if (state.failBatch) throw new Error('simulated atomic failure');
      state.writes++;
      for (const request of body.requests) {
        if (request.updateCells) {
          const update = request.updateCells;
          inventory[update.range.startRowIndex][4] = update.rows[0].values[0].userEnteredValue.numberValue;
        } else {
          rows.push(request.appendCells.rows[0].values.map(cell => {
            const val = cell.userEnteredValue;
            return Object.hasOwn(val, 'numberValue') ? val.numberValue : val.stringValue;
          }));
        }
      }
    } } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const order = { id: 'ORDER12345', status: 'COMPLETED', payer: {
    name: { given_name: '=IMPORTXML("bad")', surname: 'Tester' }, email_address: 'test@example.com'
  }, purchase_units: [{ payee: { merchant_id: 'MERCHANT' },
    amount: { currency_code: 'AUD', value: '36.93', breakdown: {
      item_total: { currency_code: 'AUD', value: '25.98' },
      shipping: { currency_code: 'AUD', value: '10.95' }
    } },
    items: [{ sku: 'ESG', name: 'Shopping Bag', quantity: '2',
      unit_amount: { currency_code: 'AUD', value: '12.99' } }],
    payments: { captures: [{ id: 'CAPTURE12345', status: 'COMPLETED',
      amount: { currency_code: 'AUD', value: '36.93' } }] }
  }] };
  context.fetchOrderFromPayPal_ = () => order;
  const post = event => context.doPost({ postData: { contents: JSON.stringify(event) } });
  const event = { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {
    id: 'CAPTURE12345', supplementary_data: { related_ids: { order_id: 'ORDER12345' } }
  } };
  return { context, state, sheets, order, event, post, props };
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
test('Completed capture records order and stock together', () => {
  const t = setup(); assert.equal(t.post(t.event).status, 'ok');
  assert.equal(t.state.writes, 1); assert.equal(t.state.inventory[1][4], 18);
  assert.equal(t.state.rows[1][9], 'CAPTURE12345'); assert.equal(t.state.released, 1);
});
test('Replay and approved event do not decrement twice', () => {
  const t = setup(); t.post(t.event);
  assert.equal(t.post(t.event).status, 'duplicate_ignored');
  assert.equal(t.post({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER12345' } }).status, 'duplicate_ignored');
  assert.equal(t.state.writes, 1);
});
test('Capture ID is never used as an order fallback', () => {
  const t = setup(); delete t.event.resource.supplementary_data;
  assert.equal(t.post(t.event).status, 'error'); assert.equal(t.state.writes, 0);
});
test('Uncaptured approved order is not fulfilled', () => {
  const t = setup(); t.order.status = 'APPROVED';
  assert.equal(t.post(t.event).status, 'not_completed'); assert.equal(t.state.writes, 0);
});
for (const [name, mutate] of [
  ['Pending capture', t => t.order.purchase_units[0].payments.captures[0].status = 'PENDING'],
  ['Wrong merchant', t => t.order.purchase_units[0].payee.merchant_id = 'OTHER'],
  ['Wrong currency', t => t.order.purchase_units[0].amount.currency_code = 'USD'],
  ['Capture amount mismatch', t => t.order.purchase_units[0].payments.captures[0].amount.value = '1.00'],
  ['Unknown SKU', t => t.order.purchase_units[0].items[0].sku = 'UNKNOWN'],
  ['Zero quantity', t => t.order.purchase_units[0].items[0].quantity = '0'],
  ['Ledger price mismatch', t => t.order.purchase_units[0].items[0].unit_amount.value = '1.00'],
  ['Insufficient stock', t => t.state.inventory[1][4] = 1],
  ['Missing Inventory tab', t => delete t.sheets.Inventory],
  ['Wrong Orders headers', t => t.state.rows[0][0] = 'Wrong'],
  ['Duplicate inventory SKU', t => t.state.inventory.push(t.state.inventory[1].slice())],
  ['Multiple purchase units', t => t.order.purchase_units.push(t.order.purchase_units[0])],
  ['Incorrect total arithmetic', t => t.order.purchase_units[0].amount.breakdown.shipping.value = '1.00'],
  ['Lock contention', t => t.state.lockBusy = true],
  ['Atomic write failure', t => t.state.failBatch = true],
  ['Live mode prohibited', t => t.props.PAYPAL_ENV = 'live']
]) test(name + ' leaves ledger unchanged', () => {
  const t = setup(); mutate(t); const before = JSON.stringify([t.state.rows, t.state.inventory]);
  assert.equal(t.post(t.event).status, 'error'); assert.equal(t.state.writes, 0);
  assert.equal(JSON.stringify([t.state.rows, t.state.inventory]), before);
});
test('Malformed body rejected', () => {
  const t = setup(); assert.equal(t.context.doPost({ postData: { contents: '{bad' } }).status, 'error');
});
test('Unrelated event ignored', () => {
  const t = setup(); assert.equal(t.post({ event_type: 'UNRELATED' }).status, 'ignored');
});
test('Notification failure does not undo order', () => {
  const t = setup(); t.props.NOTIFY_EMAIL = 'test@example.com';
  assert.equal(t.post(t.event).status, 'ok'); assert.equal(t.state.writes, 1);
});
test('Formula-like customer data is stored as literal typed text', () => {
  const t = setup(); assert.equal(t.post(t.event).status, 'ok');
  assert.equal(t.state.rows[1][3], '=IMPORTXML("bad") Tester');
});
test('Setup check validates configuration without writing orders or stock', () => {
  const t = setup(); t.props.PAYPAL_CLIENT_ID = 'sandbox-client';
  t.props.PAYPAL_CLIENT_SECRET = 'mock-secret';
  t.context.getAccessToken_ = () => 'mock-token';
  assert.equal(t.context.checkSandboxReceiverSetup().ready, true);
  assert.equal(t.state.writes, 0);
});
test('Setup check refuses missing merchant configuration', () => {
  const t = setup(); t.props.PAYPAL_CLIENT_ID = 'sandbox-client';
  t.props.PAYPAL_CLIENT_SECRET = 'mock-secret';
  delete t.props.PAYPAL_MERCHANT_ID;
  assert.throws(() => t.context.checkSandboxReceiverSetup(), /PAYPAL_MERCHANT_ID/);
  assert.equal(t.state.writes, 0);
});
console.log(`${passed} offline tests passed. No real checkout or deployed webhook was tested.`);
