import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { FAREWELL_TEMPLATE_BODY, isLikelyFarewell, isCustomerAcknowledgementOrPositiveClosure } from './farewellDetect';
import { deriveWhatsappThreadState, reconcileWhatsappThread, WHATSAPP_AUTO_WELCOME, type WhatsappStateMessage, type WhatsappThreadSnapshot } from './whatsappThreadState';

const thread: WhatsappThreadSnapshot = {
  id: 'thread', status: 'waiting_customer', updated_at: '2026-11-15T10:00:00Z',
  first_customer_message_at: '2026-11-15T09:00:00Z', first_seller_response_at: '2026-11-15T09:01:00Z',
  last_customer_message_at: null, last_message_at: '2026-11-15T09:01:00Z', farewell_sent_at: null, closed_at: null,
};
const inbound = (id: string, minute: number, body: string | null, message_type = 'text'): WhatsappStateMessage => ({
  id, direction: 'inbound', message_type, body, status: 'delivered', created_at: `2026-11-15T09:${String(minute).padStart(2, '0')}:00Z`,
});
const outbound = (id: string, minute: number, body: string, status = 'sent'): WhatsappStateMessage => ({
  ...inbound(id, minute, body), direction: 'outbound', status,
});

test('voice/photo, complaints and thanks followed by an unresolved issue are not farewell acknowledgements', () => {
  for (const body of [null, '', ' ', 'очки сломались', 'голова болит', 'Спасибо, но линзы не подходят', 'Хорошо, жду когда вернете деньги', '😡', '???']) {
    assert.equal(isLikelyFarewell(body), false, String(body));
  }
  for (const body of ['Спасибо!', 'Хорошо, спасибо 😊', 'Чоң рахмат', '👍', '[Реакция: ❤️]', 'До свидания']) {
    assert.equal(isLikelyFarewell(body), true, body);
  }
});

test('failed answer restores the customer request and removes the false first response', () => {
  const customer = inbound('a', 0, 'Когда будет готов заказ?');
  const state = deriveWhatsappThreadState(thread, [customer, outbound('b', 1, 'Завтра', 'failed')]);
  assert.equal(state.status, 'waiting_seller');
  assert.equal(state.last_customer_message_at, customer.created_at);
  assert.equal(state.first_seller_response_at, null);
});

test('an older delivery success cannot clear a newer customer question', () => {
  const latest = inbound('c', 2, 'А сколько нужно доплатить?');
  const state = deriveWhatsappThreadState(thread, [inbound('a', 0, 'Когда готов?'), outbound('b', 1, 'Завтра', 'read'), latest]);
  assert.equal(state.status, 'waiting_seller');
  assert.equal(state.last_customer_message_at, latest.created_at);
  assert.equal(state.first_seller_response_at, '2026-11-15T09:01:00Z');
});

test('automatic templates, greeting and branch transfer do not resolve the customer question', () => {
  const customer = inbound('a', 0, 'Где мой заказ?');
  const state = deriveWhatsappThreadState(thread, [customer, outbound('b', 1, WHATSAPP_AUTO_WELCOME),
    outbound('c', 2, 'Секунду, вас сейчас подключит оператор из филиала Токмок 🙂'),
    { ...outbound('d', 3, 'Заказ готов'), message_type: 'template' }]);
  assert.equal(state.status, 'waiting_seller');
  assert.equal(state.first_seller_response_at, null);
});

test('farewell does not erase a complaint, but closes a clear acknowledgement', () => {
  const complaint = deriveWhatsappThreadState(thread, [inbound('a', 0, 'очки сломались'), outbound('b', 1, FAREWELL_TEMPLATE_BODY)]);
  assert.equal(complaint.status, 'waiting_seller');
  assert.equal(complaint.farewell_sent_at, null);
  const ack = deriveWhatsappThreadState(thread, [inbound('a', 0, 'Спасибо'), outbound('b', 1, FAREWELL_TEMPLATE_BODY), inbound('c', 2, '👍')]);
  assert.equal(ack.status, 'waiting_customer');
  assert.equal(ack.farewell_sent_at, '2026-11-15T09:01:00Z');
});

test('audio after farewell reopens the conversation even without body text', () => {
  const audio = inbound('c', 2, null, 'audio');
  const state = deriveWhatsappThreadState(thread, [inbound('a', 0, 'Спасибо'), outbound('b', 1, FAREWELL_TEMPLATE_BODY), audio]);
  assert.equal(state.status, 'waiting_seller');
  assert.equal(state.last_customer_message_at, audio.created_at);
  assert.equal(state.farewell_sent_at, null);
});

test('a complaint followed by thanks stays unresolved; media with a thanks caption is not an ACK', () => {
  const complaint = inbound('a', 0, 'От этих очков болит голова');
  const state = deriveWhatsappThreadState(thread, [complaint, inbound('b', 1, 'Спасибо'), outbound('c', 2, FAREWELL_TEMPLATE_BODY)]);
  assert.equal(state.last_customer_message_at, complaint.created_at);
  assert.equal(state.farewell_sent_at, null);
  assert.equal(state.status, 'waiting_seller');
  const photo = inbound('d', 3, 'Спасибо', 'image');
  const mediaState = deriveWhatsappThreadState(thread, [inbound('a', 0, 'Спасибо'), outbound('b', 1, FAREWELL_TEMPLATE_BODY), photo]);
  assert.equal(mediaState.status, 'waiting_seller');
  assert.equal(mediaState.last_customer_message_at, photo.created_at);
});

test('repeating an unanswered question does not reset the waiting/SLA clock', () => {
  const first = inbound('a', 0, 'Где мой заказ?');
  const repeat = inbound('b', 30, 'Алло, ответьте пожалуйста');
  const state = deriveWhatsappThreadState(thread, [first, repeat], WHATSAPP_AUTO_WELCOME, Date.parse('2026-11-15T09:35:00Z'));
  assert.equal(state.last_customer_message_at, first.created_at);
  assert.equal(state.last_message_at, repeat.created_at);
  assert.equal(state.sla_breached, true);
});

test('explicit positive aftercare feedback can finish with farewell without hiding qualified complaints', () => {
  for (const text of ['Здравствуйте спасибо хорошо сели', 'Удобные', 'Добрый день все отлично',
    'Здравствуйте! Всё хорошо Спасибо вам.', 'Да спасибо очень довольна', 'Здравствуйте, всё хорошо, удобно',
    'Здравствуйте да пока нормально спасибо', 'Всё нормально, спасибо большое 🥰']) {
    assert.equal(isCustomerAcknowledgementOrPositiveClosure(text), true, text);
    assert.equal(deriveWhatsappThreadState(thread, [inbound('a', 0, text), outbound('b', 1, FAREWELL_TEMPLATE_BODY)]).status, 'waiting_customer');
  }
  for (const text of ['Все хорошо, но болит голова', 'Здравствуйте, всё не хорошо', 'Все хорошо?', 'Спасибо, всё хорошо, когда забрать заказ', 'Все хорошо, неудобные очки']) {
    assert.equal(isCustomerAcknowledgementOrPositiveClosure(text), false, text);
  }
  const intro = deriveWhatsappThreadState(thread, [inbound('a', 0, 'Здравствуйте'), inbound('b', 1, 'Спасибо, все норм'), outbound('c', 2, FAREWELL_TEMPLATE_BODY)]);
  assert.equal(intro.status, 'waiting_customer');
  const complaint = deriveWhatsappThreadState(thread, [inbound('a', 0, 'Голова болит'), inbound('b', 1, 'Спасибо, все хорошо'), outbound('c', 2, FAREWELL_TEMPLATE_BODY)]);
  assert.equal(complaint.status, 'waiting_seller');
});

test('alternative closing quick replies cannot mask a complaint either', () => {
  for (const body of ['Благодарим за обращение! Хорошего дня, будем рады помочь снова.',
    'Благодарим за обращение! Хорошего дня, будем рады помочь снова.🥰',
    'Спасибо, что остаётесь с Refocus! Будем рады видеть вас снова.❤️']) {
    const state = deriveWhatsappThreadState(thread, [inbound('a', 0, 'В целом всё хорошо. Но есть ощущение мутности'), outbound('b', 1, body)]);
    assert.equal(state.status, 'waiting_seller', body);
    assert.equal(state.first_seller_response_at, null);
  }
});

test('manual close survives old delivery callbacks; a later inbound can reopen it', () => {
  const closed = { ...thread, status: 'closed', closed_at: '2026-11-15T09:03:00Z' };
  assert.equal(deriveWhatsappThreadState(closed, [inbound('a', 0, 'Вопрос'), outbound('b', 1, 'Ответ', 'failed')]).status, 'closed');
  assert.equal(deriveWhatsappThreadState(closed, [inbound('a', 4, 'Новый вопрос')]).status, 'waiting_seller');
});

test('reconciliation retries a changed thread rather than overwrite its new inbound marker', async () => {
  const requests: Array<{ method: string; url: URL; body: any }> = [];
  const latest = inbound('c', 2, 'Новый вопрос');
  const nextThread = { ...thread, updated_at: '2026-11-15T10:00:01Z', last_message_at: latest.created_at, last_customer_message_at: latest.created_at, status: 'waiting_seller' };
  const replies = [ { auto_welcome_text: WHATSAPP_AUTO_WELCOME }, thread,
    [inbound('a', 0, 'Вопрос'), outbound('b', 1, 'Ответ')], null,
    nextThread, [inbound('a', 0, 'Вопрос'), outbound('b', 1, 'Ответ'), latest], { id: thread.id } ];
  const admin = createClient('https://thread-test.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const req = new Request(input, init);
      requests.push({ method: req.method, url: new URL(req.url), body: req.method === 'PATCH' ? await req.json() : null });
      assert.ok(replies.length);
      return new Response(JSON.stringify(replies.shift()), { headers: { 'content-type': 'application/json' } });
    } },
  });
  await reconcileWhatsappThread(admin, thread.id);
  assert.equal(replies.length, 0);
  const writes = requests.filter(r => r.method === 'PATCH');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].url.searchParams.get('updated_at'), `eq.${thread.updated_at}`);
  assert.equal(writes[1].body.status, 'waiting_seller');
  assert.equal(writes[1].body.last_customer_message_at, latest.created_at);
  assert.equal('unread_count' in writes[1].body, false, 'read acknowledgements must not be overwritten');
});
