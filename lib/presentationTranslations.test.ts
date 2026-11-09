import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPresentationPrivacyKind,
  isPresentationRoute,
  maskPresentationContacts,
  privatizePresentationText,
  pseudonymizePresentationName,
  translatePresentationText,
} from './presentationTranslations';

test('enables presentation locale only on the buyer walkthrough routes', () => {
  assert.equal(isPresentationRoute('/orders'), true);
  assert.equal(isPresentationRoute('/admin/system-map'), true);
  assert.equal(isPresentationRoute('/admin/ai-employee-messages/weekly-recap'), true);
  assert.equal(isPresentationRoute('/finance/reconciliation'), true);
  assert.equal(isPresentationRoute('/settings/payroll'), true);
  assert.equal(isPresentationRoute('/admin/devices'), true);
  assert.equal(isPresentationRoute('/finance/overview'), true);
  assert.equal(isPresentationRoute('/api/orders'), false);
});

test('translates visible labels while preserving whitespace', () => {
  assert.equal(translatePresentationText('  Заказы  '), '  Orders  ');
  assert.equal(translatePresentationText('0 с'), '0 KGS');
  assert.equal(translatePresentationText('Последняя фиксация: 30.08.2026'), 'Last count: 30.08.2026');
  assert.equal(
    translatePresentationText('Оплаты и админские действия · всего: 1000'),
    'Payments and administrative actions · loaded rows: 1000',
  );
  assert.equal(translatePresentationText('Защита от экранов'), 'Blue-light protection');
  assert.equal(translatePresentationText('Сбор данных по помещению'), 'Premises assessment');
  assert.equal(translatePresentationText('Пересчёт расходников'), 'Consumables count');
  assert.equal(translatePresentationText('Финансовый обзор'), 'Financial overview');
});

test('never changes operational codes, identifiers or contact data', () => {
  for (const value of [
    'NEW',
    'cash',
    'qr',
    'lens_ondemand_pending_count',
    'RF-250117',
    '+996 555 123 456',
    'Asia/Bishkek',
  ]) {
    assert.equal(translatePresentationText(value), value);
  }
});

test('classifies only explicit personal-data labels', () => {
  assert.equal(getPresentationPrivacyKind('Клиент'), 'customer');
  assert.equal(getPresentationPrivacyKind('Employee'), 'employee');
  assert.equal(getPresentationPrivacyKind('Телефон:'), 'phone');
  assert.equal(getPresentationPrivacyKind('Prescription'), 'private');
  assert.equal(getPresentationPrivacyKind('Name'), null);
  assert.equal(getPresentationPrivacyKind('Branch'), null);
});

test('creates stable aliases without changing non-name values', () => {
  const customer = pseudonymizePresentationName('  Иван Иванов  ', 'customer');
  assert.match(customer, /^  Customer \d{3}  $/);
  assert.equal(customer, pseudonymizePresentationName('  Иван Иванов  ', 'customer'));
  assert.match(pseudonymizePresentationName('Akhil Patel', 'employee'), /^Employee \d{3}$/);
  assert.match(pseudonymizePresentationName('Бекенова З,Т', 'customer'), /^Customer \d{3}$/);
  assert.equal(pseudonymizePresentationName('RF-250117', 'customer'), 'RF-250117');
  assert.equal(pseudonymizePresentationName('—', 'employee'), '—');
});

test('masks visible contacts only in presentation privacy transforms', () => {
  assert.equal(maskPresentationContacts('+996 555 123 456'), '+996 *** ** 56');
  assert.equal(maskPresentationContacts('0555 123 456'), '*** *** ** 56');
  assert.match(maskPresentationContacts('hello@example.com'), /^contact-\d{3}@example\.invalid$/);
  assert.equal(maskPresentationContacts('2026-08-30'), '2026-08-30');
  assert.equal(privatizePresentationText('Иван Иванов', 'customer').startsWith('Customer '), true);
  assert.equal(privatizePresentationText('+996 555 123 456', 'phone'), '+996 *** ** 56');
  assert.equal(privatizePresentationText('-1.25', 'private'), '•••');
});
